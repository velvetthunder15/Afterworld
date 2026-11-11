// Afterworld on Cloudflare Workers.
//
// Port of main.py (FastAPI on Azure App Service). Same routes, same JSON, same
// streamed plain-text chat replies, so static/index.html works unchanged.
// What changed and why:
//   threading + ThreadPoolExecutor  ->  Promise.all / Promise.race with timeouts
//   urllib / openai SDK (blocking)  ->  fetch() and a small SSE reader (openrouter.js)
//   time.sleep between retries      ->  await sleep()
//   module globals + threading.Lock ->  one Durable Object (state.js), since Workers
//                                       run many short-lived isolates, not one process
//   StaticFiles / FileResponse      ->  Workers Static Assets (the ./static folder)

import {
  KNOWN_AGENT_ONLY_IDS,
  AGENT_ONLY_HINTS,
  normalizeModels,
  publicModel,
  buildGroupings,
  isFree,
} from "./catalog.js";
import { ApiError, baseUrl, fetchJson, createChatStream } from "./openrouter.js";
import {
  HOSTS,
  enabledHosts,
  hostBase,
  hostKey,
  hostLabel,
  parseMistralModels,
  parseOpenAiModels,
  parseWorkersAiModels,
} from "./providers.js";
import { AGENT_ONLY_TTL } from "./state.js";

export { AfterworldState } from "./state.js";

// ---------------------------------------------------------------------------
// Settings (same values as main.py)
// ---------------------------------------------------------------------------

const MODELS_TTL = 600;
const REFRESH_MIN_AGE = 60;
const STATS_TTL = 90;
const STATS_BUDGET = 12;
const PROBE_TIMEOUT = 12;
const FASTEST_POOL = 3;
const PROBE_BATCH = 4;
const THROTTLE_WINDOW = 600;
const MEASURED_FRESH = 300;
const MEASURED_MAX_AGE = 1800;

const FREE_LIMITS = { per_minute: 20, per_day: 50, per_day_with_credits: 1000, credits_threshold: 10 };

const APP_VERSION = "2.0.0";
const CATALOG_SCHEMA = 2;

const SYSTEM_PROMPT = "You are a helpful chatbot.";
const MAX_TOKENS_CAP = 4096;
const MAX_HISTORY = 20;
const CHAT_TIMEOUT = 45;

const MAX_IMAGES = 8;
const MAX_IMAGE_CHARS = 4_000_000;
const IMAGE_URL = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

const FATAL_STATUSES = new Set([401, 402]);
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const RETRY_WAITS = [1.5, 3.0];
const MAX_ATTEMPTS = 3;

const now = () => Date.now() / 1000;
const sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));
const iso = (t) => new Date(t * 1000).toISOString().replace("Z", "+00:00");

class HttpError extends Error {
  constructor(status, detail) {
    super(detail);
    this.status = status;
  }
}

class ModelUnavailable extends Error {}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

function log(...parts) {
  console.log("[Afterworld]", ...parts);
}

// ---------------------------------------------------------------------------
// Per-request context: one read of the shared state, writes batched at the end
// ---------------------------------------------------------------------------

class Ctx {
  constructor(env, execCtx) {
    this.env = env;
    this.execCtx = execCtx;
    this.state = env.STATE.get(env.STATE.idFromName("global"));
    this.snap = null;
    this.events = [];
    // Workers cap outgoing requests per incoming request (50 on the Free plan, 10,000 on
    // Paid). Latency-stat lookups stop early rather than starve the probes and the chat.
    this.subrequestsLeft = Number(env.SUBREQUEST_LIMIT || 50) - 4; // Durable Object calls
  }

  spend(reserve = 0) {
    if (this.subrequestsLeft <= reserve) return false;
    this.subrequestsLeft--;
    return true;
  }

  async load() {
    if (!this.snap) this.snap = await this.state.snapshot(KNOWN_AGENT_ONLY_IDS);
    return this.snap;
  }

  recordRequest(modelId) {
    const at = now();
    const host = modelId.includes("::") ? modelId.split("::")[0] : "openrouter";
    this.events.push({ type: "request", at, host, model: modelId });
    if (this.snap) (this.snap.providerRequests ||= []).push({ at, host, model: modelId });
    if (this.snap && host === "openrouter") {
      this.snap.usage.minute++;
      this.snap.usage.day++;
    }
  }

  recordSuccess(id, ms) {
    const at = now();
    this.events.push({ type: "success", id, ms, at });
    if (this.snap) Object.assign((this.snap.observed[id] ||= {}), { ms, at, ok_at: at });
  }

  recordThrottle(id) {
    const at = now();
    this.events.push({ type: "throttle", id, at });
    if (this.snap) (this.snap.observed[id] ||= {}).throttled_at = at;
  }

  markAgentOnly(id, reason) {
    const at = now();
    this.events.push({ type: "agent_only", id, reason, at });
    if (this.snap) this.snap.agentOnly[id] = { reason, at };
    log(id + (String(reason).startsWith("paid:") ? " needs a paid plan, hiding it: " : " looks like it only works inside an agentic tool, hiding it: ") + reason);
  }

  // Save what this request saw. Runs after the response, so it never slows a reply.
  flush() {
    if (!this.events.length) return Promise.resolve();
    const events = this.events;
    this.events = [];
    return this.state.record(events).catch((error) => log("could not save live data:", String(error)));
  }

  flushLater() {
    this.execCtx.waitUntil(this.flush());
  }
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

class CatalogError extends Error {}

async function fetchOpenRouterModels(ctx) {
  ctx.spend();
  const payload = await fetchJson(ctx.env, baseUrl(ctx.env) + "/api/v1/models", { timeoutMs: 20000 });
  const models = normalizeModels(payload.data || []);
  if (!models.length) throw new Error("OpenRouter returned no free chat models");
  return models;
}

async function fetchHostModels(ctx, key) {
  const env = ctx.env;
  const host = HOSTS[key];
  ctx.spend();
  if (host.kind === "binding") {
    const list = await Promise.race([
      env.AI.models({ task: "Text Generation", per_page: 200, hide_experimental: true }),
      sleep(15).then(() => { throw new Error("timed out"); }),
    ]);
    const paidPlan = String(env.WORKERS_PAID ?? "").toLowerCase() === "true";
    return parseWorkersAiModels(list, undefined, { paidPlan });
  }
  const response = await fetch(hostBase(env, key) + "/models", {
    headers: { Accept: "application/json", Authorization: "Bearer " + hostKey(env, key), "User-Agent": "Afterworld/1.0" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("HTTP " + response.status);
  }
  const payload = await response.json();
  return key === "mistral" ? parseMistralModels(payload) : parseOpenAiModels(key, payload);
}

async function loadCatalog(ctx, force = false) {
  const snap = await ctx.load();
  const age = now() - snap.catalog.fetched_at;
  const have = snap.catalog.models.length > 0;
  const schemaOk = snap.catalog.schema === CATALOG_SCHEMA;
  if (have && schemaOk && age < MODELS_TTL && !(force && age >= REFRESH_MIN_AGE)) return;

  // Every host is fetched at once. A host that fails keeps the models it had last time,
  // so one host being down never empties the list.
  const sources = [["openrouter", () => fetchOpenRouterModels(ctx)]].concat(
    enabledHosts(ctx.env).map((key) => [key, () => fetchHostModels(ctx, key)])
  );
  const results = await Promise.all(
    sources.map(([key, load]) => load().then((models) => [key, models, null], (error) => [key, null, error]))
  );

  const previous = schemaOk ? snap.catalog.models : [];
  const merged = [];
  let fresh = 0;
  for (const [key, models, error] of results) {
    if (models) {
      merged.push(...models);
      fresh++;
    } else {
      log("Could not refresh the " + hostLabel(key) + " model list:", String(error));
      merged.push(...previous.filter((m) => (m.host || "openrouter") === key));
    }
  }

  if (!merged.length) {
    if (have) return; // keep showing the older list
    throw new CatalogError("Couldn't load the free-model list. Check your internet connection and try again.");
  }
  if (!fresh) return;

  const key = (m) => [m.provider.toLowerCase(), m.name.toLowerCase(), m.host || ""];
  merged.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
    return 0;
  });
  snap.catalog = { models: merged, fetched_at: now(), schema: CATALOG_SCHEMA };
  await ctx.state.putCatalog(snap.catalog);
}

function agentOnlyIds(snap) {
  const t = now();
  return new Set(Object.entries(snap.agentOnly).filter(([, info]) => t - info.at <= AGENT_ONLY_TTL).map(([id]) => id));
}

function listModels(snap) {
  const hidden = agentOnlyIds(snap);
  return snap.catalog.models.filter((m) => !hidden.has(m.id));
}

function findModel(snap, id) {
  return snap.catalog.models.find((m) => m.id === id) || null;
}

// ---------------------------------------------------------------------------
// Latency stats
// ---------------------------------------------------------------------------

function endpointsOf(payload) {
  let data = payload && typeof payload === "object" && !Array.isArray(payload) ? payload.data : null;
  if (data && typeof data === "object" && !Array.isArray(data)) data = data.endpoints;
  return (Array.isArray(data) ? data : []).filter((item) => item && typeof item === "object" && !Array.isArray(item));
}

function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function endpointUrls(env, model, statUrls) {
  const site = baseUrl(env);
  const urls = [site + "/api/v1/models/" + encodeURIComponent(model.id).replace(/%2F/gi, "/").replace(/%3A/gi, ":") + "/endpoints"];
  if (model._details) urls.push(site + model._details);
  const unique = [...new Set(urls)];
  const remembered = statUrls[model.id];
  if (remembered && unique.includes(remembered)) {
    unique.splice(unique.indexOf(remembered), 1);
    unique.unshift(remembered);
  }
  return unique;
}

// Requests kept back from the stats lookups for probes (random pick) and the catalog.
const PROBE_RESERVE = 16;

async function fetchModelStats(ctx, model, statUrls, found) {
  const env = ctx.env;
  for (const url of endpointUrls(env, model, statUrls)) {
    if (!ctx.spend(PROBE_RESERVE)) break;
    let payload;
    try {
      payload = await fetchJson(env, url, { timeoutMs: 8000, auth: true });
    } catch {
      continue;
    }
    const free = endpointsOf(payload).filter((ep) => isFree({ pricing: ep.pricing }));
    if (!free.length) continue;

    found[model.id] = url;
    const latencies = [];
    const uptimes = [];
    let healthy = false;

    for (const ep of free) {
      const status = num(ep.status);
      const uptime = num(ep.uptime_last_30m);
      if (uptime !== null) uptimes.push(uptime);
      if ((status !== null && status < 0) || (uptime !== null && uptime < 50)) continue;
      healthy = true;
      const p50 = num((ep.latency_last_30m || {}).p50);
      if (p50 !== null && p50 > 0) latencies.push(p50);
    }

    return {
      raw_latency: latencies.length ? Math.min(...latencies) : null,
      healthy,
      uptime: uptimes.length ? Math.max(...uptimes) : null,
      known: true,
    };
  }
  return { raw_latency: null, healthy: true, uptime: null, known: false };
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

async function collectStats(ctx, snap, models) {
  const results = {};
  const found = {};
  // Every model is checked at the same time; whatever has not answered after
  // STATS_BUDGET seconds is left out, like as_completed(timeout=STATS_BUDGET).
  const work = models.filter((model) => !model.host || model.host === "openrouter").map((model) =>
    fetchModelStats(ctx, model, snap.statUrls, found)
      .then((r) => { results[model.id] = r; })
      .catch(() => {})
  );
  await Promise.race([Promise.all(work), sleep(STATS_BUDGET)]);

  const snapshot = Object.fromEntries(Object.entries(results).map(([id, r]) => [id, { ...r }]));

  // OpenRouter's docs call these numbers milliseconds, but their examples look like seconds.
  // A median below 60 means seconds.
  const raws = Object.values(snapshot).map((r) => r.raw_latency).filter((v) => v !== null);
  const factor = raws.length && median(raws) < 60 ? 1000 : 1;
  for (const r of Object.values(snapshot)) {
    const raw = r.raw_latency;
    delete r.raw_latency;
    r.latency = raw === null ? null : Math.round(raw * factor);
  }

  snap.stats = { results: snapshot, stats_at: now() };
  await ctx.state.putStats(snap.stats, found).catch((e) => log("could not save stats:", String(e)));
  return { ...snapshot };
}

async function refreshStats(ctx, models, { wait = false } = {}) {
  const snap = await ctx.load();
  const have = Object.keys(snap.stats.results).length > 0;
  if (have && now() - snap.stats.stats_at < STATS_TTL) {
    return { ...snap.stats.results };
  }
  // When previous stats exist and caller does not need a blocking wait, serve cached
  // stats immediately and refresh OpenRouter medians in the background.
  if (have && !wait) {
    ctx.execCtx.waitUntil(collectStats(ctx, snap, models).catch((e) => log("bg stats refresh failed:", String(e))));
    return { ...snap.stats.results };
  }
  return collectStats(ctx, snap, models);
}

// ---------------------------------------------------------------------------
// Live info
// ---------------------------------------------------------------------------

function isUpstreamLimit(message) {
  const text = (message || "").toLowerCase();
  return text.includes("upstream") || text.includes("rate-limited");
}

function isAgentOnly(message) {
  const text = (message || "").toLowerCase();
  return AGENT_ONLY_HINTS.some((hint) => text.includes(hint));
}

function liveInfo(stat, obs, t) {
  const known = Boolean(stat && stat.known);
  const healthy = stat ? stat.healthy ?? true : true;

  const throttledAt = obs.throttled_at;
  const okAt = obs.ok_at;
  const recentlyThrottled = Boolean(throttledAt && t - throttledAt < THROTTLE_WINDOW);

  let state;
  if (recentlyThrottled && (!okAt || okAt < throttledAt)) state = "throttled";
  else if (known && !healthy) state = "degraded";
  else if (known || (okAt && t - okAt < MEASURED_MAX_AGE)) state = "healthy";
  else state = "unknown";

  const statMs = stat ? stat.latency ?? null : null;
  const measuredMs = obs.ms ?? null;
  const measuredAge = obs.at !== undefined && obs.at !== null ? t - obs.at : null;
  const measuredOk = measuredMs !== null && measuredAge !== null && measuredAge < MEASURED_MAX_AGE;

  let source = null;
  let ms = null;
  let age = null;
  if (measuredOk && measuredAge < MEASURED_FRESH) [source, ms, age] = ["measured", measuredMs, measuredAge];
  else if (statMs !== null) [source, ms, age] = ["openrouter", statMs, null];
  else if (measuredOk) [source, ms, age] = ["measured", measuredMs, measuredAge];

  return {
    state,
    latency_ms: ms,
    latency_source: source,
    latency_age_s: age === null ? null : Math.round(age),
    uptime: stat ? stat.uptime ?? null : null,
    throttled_age_s: recentlyThrottled ? Math.round(t - throttledAt) : null,
  };
}

// ---------------------------------------------------------------------------
// Probing and the random fast-model pick
// ---------------------------------------------------------------------------

function firstOutput(chunk) {
  if (!chunk.choices.length) return false;
  const delta = chunk.choices[0].delta || {};
  return Boolean(delta.content || delta.reasoning);
}

async function probeModel(ctx, modelId) {
  if (!ctx.spend()) return { ok: false };
  ctx.recordRequest(modelId);
  const started = performance.now();
  let stream = null;

  try {
    stream = await createChatStream(ctx.env, {
      model: modelId,
      messages: [{ role: "user", content: "Say hi." }],
      maxTokens: 16,
      timeoutMs: PROBE_TIMEOUT * 1000,
    });
    for await (const chunk of stream.chunks) {
      if (firstOutput(chunk)) {
        const ms = Math.round(performance.now() - started);
        ctx.recordSuccess(modelId, ms);
        return { ok: true, ms };
      }
    }
    return { ok: false };
  } catch (error) {
    const status = error instanceof ApiError ? error.status : null;
    const message = error?.message || String(error);
    log("probe of " + modelId + " failed (" + (status || error?.kind || error?.name) + "): " + message);

    if (status === 429) {
      ctx.recordThrottle(modelId);
      return { ok: false, throttled: true, upstream: isUpstreamLimit(message) };
    }
    if (status === 403 && isAgentOnly(message)) {
      ctx.markAgentOnly(modelId, message);
      return { ok: false, agent_only: true };
    }
    if (status === 402 && modelId.includes("::")) {
      ctx.markAgentOnly(modelId, "paid: " + message);
      return { ok: false, paid: true };
    }
    return { ok: false };
  } finally {
    stream?.close();
  }
}

async function probeMany(ctx, models) {
  const results = {};
  await Promise.race([
    Promise.all(models.map((m) => probeModel(ctx, m.id).then((r) => { results[m.id] = r; }).catch(() => {}))),
    sleep(PROBE_TIMEOUT + 5),
  ]);
  return results;
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

async function pickRandomFast(ctx, hostFilter = null) {
  await loadCatalog(ctx);
  const snap = await ctx.load();
  const allModels = listModels(snap);
  const models = hostFilter && hostFilter !== "all"
    ? allModels.filter((m) => (m.host || "openrouter") === hostFilter)
    : allModels;
  if (!models.length) {
    throw new ModelUnavailable("No free models are currently available for that host.");
  }
  const stats = await refreshStats(ctx, allModels);
  const t = now();

  const speedOf = (m) => {
    if (hostFilter && hostFilter !== "all") {
      const obs = snap.observed[m.id];
      if (obs && obs.ms != null && obs.at && t - obs.at < MEASURED_MAX_AGE) return obs.ms;
    }
    return stats[m.id]?.latency ?? null;
  };
  const info = (m) => stats[m.id] || { latency: null, healthy: true };

  let healthy = models.filter((m) => info(m).healthy && !atKnownLimit(snap, m));
  const ranked = healthy.filter((m) => speedOf(m) !== null).sort((a, b) => speedOf(a) - speedOf(b));

  const tried = new Set();

  if (ranked.length) {
    const pool = shuffle(ranked.slice(0, FASTEST_POOL));
    const order = pool.concat(ranked.slice(FASTEST_POOL, FASTEST_POOL + 3));
    for (const model of order) {
      tried.add(model.id);
      const result = await probeModel(ctx, model.id);
      if (result.ok) {
        const note = "Picked at random from the " + pool.length + " fastest free models by recent " +
          "latency stats, and confirmed just now (" + result.ms + " ms to first output).";
        return [model, result.ms, "stats", note];
      }
    }
  }

  const remaining = shuffle(healthy.filter((m) => !tried.has(m.id)));
  for (let start = 0; start < Math.min(remaining.length, PROBE_BATCH * 2); start += PROBE_BATCH) {
    const batch = remaining.slice(start, start + PROBE_BATCH);
    const results = await probeMany(ctx, batch);
    const working = batch.filter((m) => results[m.id]?.ok).map((m) => [results[m.id].ms, m]);
    if (working.length) {
      const [ms, model] = working.reduce((best, item) => (item[0] < best[0] ? item : best));
      const note = "OpenRouter's latency stats weren't available, so " + batch.length + " random free models were " +
        "tested live and this one answered fastest (" + ms + " ms to first output).";
      return [model, ms, "probe", note];
    }
  }

  throw new ModelUnavailable(
    "None of the free models answered right now (they may all be rate limited). " +
      "Wait a minute and try again, or pick one from the list."
  );
}

// ---------------------------------------------------------------------------
// Chat helpers
// ---------------------------------------------------------------------------

function validateChatBody(body) {
  const bad = () => new HttpError(422, "The request wasn't in the expected format.");
  if (!body || typeof body !== "object" || typeof body.model !== "string" || !Array.isArray(body.messages)) throw bad();
  if (body.system !== undefined && body.system !== null && typeof body.system !== "string") throw bad();
  const system = typeof body.system === "string" ? body.system.trim().slice(0, 2000) : "";
  return {
    model: body.model,
    system,
    messages: body.messages.map((item) => {
      if (!item || typeof item !== "object" || !["user", "assistant"].includes(item.role)) throw bad();
      const content = item.content === undefined ? "" : item.content;
      const images = item.images === undefined || item.images === null ? [] : item.images;
      if (typeof content !== "string" || !Array.isArray(images) || images.some((u) => typeof u !== "string")) throw bad();
      return { role: item.role, content, images };
    }),
  };
}

function messageContent(text, images) {
  if (!images.length) return text;
  const parts = [];
  if (text) parts.push({ type: "text", text });
  for (const url of images) parts.push({ type: "image_url", image_url: { url } });
  return parts;
}

function buildMessages(items, customSystem = "") {
  let cleaned = [];
  for (const item of items) {
    const text = item.content.trim();
    const images = item.role === "user" ? [...(item.images || [])] : [];
    if (!text && !images.length) continue;

    const previous = cleaned[cleaned.length - 1];
    if (previous && previous.role === item.role) {
      previous.text = [previous.text, text].filter(Boolean).join("\n\n");
      previous.images.push(...images);
    } else {
      cleaned.push({ role: item.role, text, images });
    }
  }

  cleaned = cleaned.slice(-MAX_HISTORY);
  while (cleaned.length && cleaned[0].role !== "user") cleaned.shift();

  const prompt = customSystem || SYSTEM_PROMPT;
  return [{ role: "system", content: prompt }].concat(
    cleaned.map((e) => ({ role: e.role, content: messageContent(e.text, e.images) }))
  );
}

function mergeSystem(messages) {
  const system = messages[0].content;
  const rest = messages.slice(1).map((m) => ({ ...m }));
  if (rest.length && rest[0].role === "user") {
    const content = rest[0].content;
    rest[0].content = Array.isArray(content) ? [{ type: "text", text: system }, ...content] : system + "\n\n" + content;
  }
  return rest;
}

function checkImages(items, model) {
  const urls = [];
  for (const item of items) if (item.role === "user") urls.push(...(item.images || []));
  if (!urls.length) return;
  if (!model.vision) throw new HttpError(400, model.name + " doesn't accept images. Choose a model with image input.");
  if (urls.length > MAX_IMAGES) throw new HttpError(400, "Too many images in one request.");
  for (const url of urls) {
    if (url.length > MAX_IMAGE_CHARS || !IMAGE_URL.test(url)) {
      throw new HttpError(400, "One of the images isn't a valid PNG, JPEG, WebP or GIF, or it is too large.");
    }
  }
}

function accountLimitCriteria() {
  return "OpenRouter limits vary by account and model";
}

function accountLimitSentence() {
  return "OpenRouter is rate limited. Retry time unavailable; try again later.";
}

function describeError(error, name = "This model", host = "openrouter") {
  const status = error instanceof ApiError ? error.status : null;
  const message = error?.message || String(error);

  if (host && host !== "openrouter" && HOSTS[host]) {
    const label = HOSTS[host].label;
    if (status === 429) return label + " is rate limited. " + (error.retryAfter ? "Try again in " + error.retryAfter + " seconds." : "Retry time unavailable. Try again later.");
    if (status === 401 || status === 403) {
      return label + " rejected the request. Check the " + (HOSTS[host].keyVar || "AI binding") + " setting on the Worker.";
    }
    if (status === 402) {
      return host === "workersai"
        ? name + " needs the Workers Paid plan. Choose another model."
        : label + " has no free credit left for that model.";
    }
    if (status === 404) return name + " isn't available on " + label + " any more. Choose another model.";
    if (error?.kind === "timeout") return name + " took too long to respond. Try again or choose another model.";
    if (error?.kind === "connection") return "Couldn't reach " + label + ". Try again or choose another model.";
    return "The model request failed. Try again or choose another model.";
  }

  if (status === 403 && isAgentOnly(message)) {
    return name + " only works inside an agentic tool (like a coding agent), not in a normal " +
      "chat, so it has been removed from the model list. Choose another model.";
  }
  if (status === 429) return (isUpstreamLimit(message) ? "The OpenRouter provider is rate limited. " : "OpenRouter is rate limited. ") + (error.retryAfter ? "Try again in " + error.retryAfter + " seconds." : "Retry time unavailable. Try again later.");
  if (status === 401) return "OpenRouter rejected the API key. Check the OPENROUTER_API_KEY secret on the Worker.";
  if (status === 402) return "This OpenRouter account has no credits left for that model.";
  if (status === 404) return name + " isn't available on OpenRouter any more. Choose another model.";
  if (error?.kind === "timeout") return name + " took too long to respond. Try again or choose another model.";
  if (error?.kind === "connection") return "Couldn't reach OpenRouter. Check your internet connection and try again.";
  return "The model request failed. Try again or choose another model.";
}

async function firstToken(iterator) {
  let firstAt = null;
  while (true) {
    const { value: chunk, done } = await iterator.next();
    if (done) return [null, null];
    if (firstAt === null && firstOutput(chunk)) firstAt = performance.now();
    if (!chunk.choices.length) continue;
    const token = chunk.choices[0].delta?.content;
    if (token) return [token, firstAt ?? performance.now()];
  }
}

async function openStream(ctx, model, messages, signal) {
  let maxTokens = MAX_TOKENS_CAP;
  if (model.max_output) maxTokens = Math.max(256, Math.min(MAX_TOKENS_CAP, model.max_output));

  let plain = false;
  let attempt = 0;
  let lastMessage = "The model did not answer.";

  while (attempt < MAX_ATTEMPTS) {
    attempt++;
    let stream = null;
    ctx.spend();
    ctx.recordRequest(model.id);
    const started = performance.now();

    try {
      stream = await createChatStream(ctx.env, {
        model: model.id,
        messages: plain ? mergeSystem(messages) : messages,
        maxTokens,
        timeoutMs: CHAT_TIMEOUT * 1000,
        signal,
      });
      const iterator = stream.chunks[Symbol.asyncIterator]();
      const [token, firstAt] = await firstToken(iterator);
      if (token !== null) {
        const ttftMs = Math.round(firstAt - started);
        ctx.recordSuccess(model.id, ttftMs);
        return [token, iterator, stream, ttftMs];
      }
      stream.close();
      lastMessage = "The model returned an empty reply. Try again or choose another model.";
      log(model.id + " returned an empty reply");
    } catch (error) {
      stream?.close();
      if (!(error instanceof ApiError)) throw error;
      if (signal?.aborted) throw error;

      const status = error.status;
      lastMessage = describeError(error, model.name, model.host);
      log(model.id + " failed (" + (status || error.kind) + "): " + error.message);

      if (status === 429) ctx.recordThrottle(model.id);
      if (status === 402 && model.host && model.host !== "openrouter") {
        ctx.markAgentOnly(model.id, "paid: " + error.message);
        break;
      }
      if (status === 403 && isAgentOnly(error.message)) {
        ctx.markAgentOnly(model.id, error.message);
        break;
      }
      if (FATAL_STATUSES.has(status)) break;
      if (status === 400 && !plain) {
        plain = true;
        attempt--;
        continue;
      }
      if (status !== null && !RETRY_STATUSES.has(status)) break;
    }

    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_WAITS[attempt - 1]);
  }

  throw new ModelUnavailable(lastMessage);
}

async function requireFreeModel(ctx, modelId) {
  const snap = await ctx.load();
  if (agentOnlyIds(snap).has(modelId) && String(snap.agentOnly[modelId]?.reason || "").startsWith("paid:")) {
    throw new HttpError(400, "That model needs a paid plan on its host, so it has been removed from the model list. Choose another model.");
  }
  if (agentOnlyIds(snap).has(modelId)) {
    throw new HttpError(400, "That model only works inside an agentic tool, not in a normal chat, so it " +
      "has been removed from the model list. Choose another model.");
  }

  try {
    await loadCatalog(ctx);
  } catch (error) {
    if (error instanceof CatalogError) throw new HttpError(503, error.message);
    throw error;
  }

  let model = findModel(snap, modelId);
  if (!model) {
    try {
      await loadCatalog(ctx, true);
    } catch {
      // keep going
    }
    model = findModel(snap, modelId);
  }
  if (!model) throw new HttpError(400, "That model isn't in the current free-model list any more. Choose another model.");
  return model;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

function hostSummary(env, models) {
  const counts = {};
  for (const m of models) counts[m.host || "openrouter"] = (counts[m.host || "openrouter"] || 0) + 1;
  return [{ key: "openrouter", label: "OpenRouter", count: counts.openrouter || 0, limits: accountLimitCriteria() }].concat(
    enabledHosts(env).map((key) => ({ key, label: HOSTS[key].label, count: counts[key] || 0, limits: HOSTS[key].limits }))
  );
}

async function apiModels(ctx, url) {
  const refresh = parseInt(url.searchParams.get("refresh") || "0", 10);
  if (Number.isNaN(refresh)) throw new HttpError(422, "refresh must be a number.");
  try {
    await loadCatalog(ctx, Boolean(refresh));
  } catch (error) {
    if (error instanceof CatalogError) throw new HttpError(502, error.message);
    throw error;
  }
  const snap = await ctx.load();
  const hidden = agentOnlyIds(snap);
  const allIds = new Set(snap.catalog.models.map((m) => m.id));
  const models = listModels(snap);

  return json({
    models: models.map(publicModel),
    groupings: buildGroupings(models),
    count: models.length,
    fetched_at: iso(snap.catalog.fetched_at),
    source: "https://openrouter.ai/api/v1/models",
    hosts: hostSummary(ctx.env, models),
    version: APP_VERSION,
    excluded_agent_only: [...hidden].filter((id) => allIds.has(id) && !String(snap.agentOnly[id]?.reason || "").startsWith("paid:")).length,
    excluded_paid: [...hidden].filter((id) => allIds.has(id) && String(snap.agentOnly[id]?.reason || "").startsWith("paid:")).length,
    limits: { ...FREE_LIMITS },
  });
}

async function apiRandomModel(ctx, request) {
  const body = await request.json().catch(() => null);
  const hostFilter = body && typeof body === "object" && typeof body.host === "string" ? body.host : null;
  try {
    const [model, ms, mode, note] = await pickRandomFast(ctx, hostFilter);
    await ctx.flush();
    return json({ model: publicModel(model), measured_ms: ms, mode, note });
  } catch (error) {
    await ctx.flush();
    if (error instanceof CatalogError) throw new HttpError(502, error.message);
    if (error instanceof ModelUnavailable) throw new HttpError(503, error.message);
    throw error;
  }
}

// Only enforce published limits when they are known for this specific account.
const PROVIDER_LIMITS = {
  openrouter: { limit_per_min: 20, limit_per_day: null, scope: "account", quota_label: "20 req/min shared (:free)", source: "https://openrouter.ai/collections/free-models/" },
  groq: { limit_per_min: null, limit_per_day: null, scope: "model", quota_label: "Per-model free tier", source: "https://console.groq.com/docs/rate-limits" },
  sambanova: { limit_per_min: null, limit_per_day: null, scope: "model", quota_label: "Per-model free tier", source: "https://docs.sambanova.ai/" },
  mistral: { limit_per_min: null, limit_per_day: null, scope: "model", quota_label: "Monthly free plan", source: "https://docs.mistral.ai/admin/billing-usage/usage-limits" },
  workersai: { limit_per_min: null, limit_per_day: null, scope: "model", quota_label: "10,000 Neurons/day shared", source: "https://developers.cloudflare.com/workers-ai/platform/limits/" },
};
function atKnownLimit(snap, model) {
  const host = model.host || "openrouter";
  const config = PROVIDER_LIMITS[host];
  const requests = snap.providerRequests || [];
  const minute = requests.filter((r) => r.host === host && (host !== "openrouter" || r.model.endsWith(":free")) && (config.scope === "account" || r.model === model.id) && r.at > now() - 60).length;
  return (config.limit_per_min != null && minute >= config.limit_per_min && (host !== "openrouter" || model.id.endsWith(":free"))) || (snap.observed[model.id]?.throttled_at > now() - 60);
}

function buildProviderStatus(ctx, snap, models, stats, t) {
  const midnight = t - (t % 86400);
  return ["openrouter", ...enabledHosts(ctx.env)].map((key) => {
    const hostModels = models.filter((m) => (m.host || "openrouter") === key);
    const records = (snap.providerRequests || []).filter((r) => r.host === key);
    const byModel = {};
    for (const r of records) {
      const entry = (byModel[r.model] ||= { minute: 0, day: 0 });
      if (r.at > t - 60) entry.minute++;
      if (r.at >= midnight) entry.day++;
    }
    const measuredFastest = hostModels
      .filter((m) => snap.observed[m.id]?.at > t - MEASURED_MAX_AGE && snap.observed[m.id]?.ms != null && !atKnownLimit(snap, m))
      .sort((a, b) => snap.observed[a.id].ms - snap.observed[b.id].ms)[0];
    let fastest = null;
    if (measuredFastest) {
      fastest = {
        id: measuredFastest.id,
        name: measuredFastest.name,
        latency_ms: snap.observed[measuredFastest.id].ms,
        source: "measured",
        age_s: Math.max(0, Math.round(t - snap.observed[measuredFastest.id].at)),
      };
    } else if (stats && key === "openrouter") {
      const statFastest = hostModels
        .filter((m) => stats[m.id]?.healthy !== false && stats[m.id]?.latency != null && !atKnownLimit(snap, m))
        .sort((a, b) => stats[a.id].latency - stats[b.id].latency)[0];
      if (statFastest) {
        fastest = {
          id: statFastest.id,
          name: statFastest.name,
          latency_ms: stats[statFastest.id].latency,
          source: "openrouter",
          age_s: null,
        };
      }
    }
    let healthyCount = 0;
    let throttledCount = 0;
    for (const m of hostModels) {
      const info = liveInfo(stats ? stats[m.id] : snap.stats.results[m.id], snap.observed[m.id] || {}, t);
      if (info.state === "throttled") throttledCount++;
      else if (info.state === "healthy") healthyCount++;
    }
    return {
      key,
      name: hostLabel(key),
      ...PROVIDER_LIMITS[key],
      model_count: hostModels.length,
      healthy_count: healthyCount,
      throttled_count: throttledCount,
      usage: {
        minute: records.filter((r) => r.at > t - 60).length,
        day: records.filter((r) => r.at >= midnight).length,
        free_minute: records.filter((r) => r.model.endsWith(":free") && r.at > t - 60).length,
      },
      models: byModel,
      fastest,
    };
  });
}

async function apiStatus(ctx) {
  await loadCatalog(ctx);
  const snap = await ctx.load();
  const models = listModels(snap);
  const t = now();
  const providers = buildProviderStatus(ctx, snap, models, snap.stats.results, t);
  return json({ providers, updated_at: iso(t) });
}

async function apiLive(ctx) {
  try {
    await loadCatalog(ctx);
  } catch (error) {
    if (error instanceof CatalogError) throw new HttpError(502, error.message);
    throw error;
  }
  const snap = await ctx.load();
  const hidden = agentOnlyIds(snap);
  const allIds = new Set(snap.catalog.models.map((m) => m.id));
  const models = listModels(snap);
  const stats = await refreshStats(ctx, models);
  const t = now();

  return json({
    updated_at: iso(t),
    stats_at: snap.stats.stats_at ? iso(snap.stats.stats_at) : null,
    models: Object.fromEntries(models.map((m) => [m.id, liveInfo(stats[m.id], snap.observed[m.id] || {}, t)])),
    providers: buildProviderStatus(ctx, snap, models, stats, t),
    usage: snap.usage,
    limits: { ...FREE_LIMITS },
    catalog_count: models.length,
    excluded_agent_only: [...hidden].filter((id) => allIds.has(id) && !String(snap.agentOnly[id]?.reason || "").startsWith("paid:")).length,
    excluded_paid: [...hidden].filter((id) => allIds.has(id) && String(snap.agentOnly[id]?.reason || "").startsWith("paid:")).length,
    version: APP_VERSION,
  });
}

async function apiProbe(ctx, request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.model !== "string") throw new HttpError(422, "The request wasn't in the expected format.");
  const model = await requireFreeModel(ctx, body.model);
  const result = await probeModel(ctx, model.id);
  await ctx.flush();

  let message;
  if (result.ok) message = model.name + " answered in " + result.ms + " ms.";
  else if (result.paid) message = model.name + " needs a paid plan on " + model.host_label + ", so it has been removed from the list.";
  else if (result.agent_only) message = model.name + " only works inside an agentic tool, so it has been removed from the list.";
  else if (result.throttled && model.host && model.host !== "openrouter") message = model.host_label + " is rate limited. Retry time unavailable; try again later.";
  else if (result.throttled) message = result.upstream ? model.name + "'s provider is rate limited right now." : accountLimitSentence();
  else message = model.name + " didn't answer.";

  const snap = await ctx.load();
  const t = now();
  return json({
    ok: result.ok,
    ms: result.ms ?? null,
    throttled: Boolean(result.throttled),
    agent_only: Boolean(result.agent_only),
    paid: Boolean(result.paid),
    removed: Boolean(result.agent_only || result.paid),
    live: liveInfo(snap.stats.results[model.id], snap.observed[model.id] || {}, t),
    message,
  });
}

async function chat(ctx, request) {
  const body = validateChatBody(await request.json().catch(() => null));
  const model = await requireFreeModel(ctx, body.model);
  checkImages(body.messages, model);
  const messages = buildMessages(body.messages, body.system);
  if (messages.length < 2) throw new HttpError(400, "Type a message first.");

  let token, iterator, stream, ttftMs;
  try {
    [token, iterator, stream, ttftMs] = await openStream(ctx, model, messages, request.signal);
    await ctx.flush();
  } catch (error) {
    await ctx.flush();
    if (error instanceof ModelUnavailable) throw new HttpError(503, error.message);
    throw error;
  }

  const encoder = new TextEncoder();
  const body$ = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(token));
    },
    async pull(controller) {
      try {
        // Keep reading until there is answer text: chunks with only reasoning, usage or
        // keep-alives carry none, and a pull() that enqueues nothing is never called again.
        while (true) {
          const { value: chunk, done } = await iterator.next();
          if (done) {
            stream.close();
            controller.close();
            return;
          }
          const piece = chunk.choices.length ? chunk.choices[0].delta?.content : null;
          if (piece) {
            controller.enqueue(encoder.encode(piece));
            return;
          }
        }
      } catch (error) {
        stream.close();
        if (error instanceof ApiError && error.status === 429) {
          ctx.recordThrottle(model.id);
          ctx.flushLater();
        }
        if (!request.signal?.aborted) {
          controller.enqueue(encoder.encode("\n\n[Reply interrupted: " + describeError(error, model.name, model.host) + "]"));
        }
        controller.close();
      }
    },
    cancel() {
      stream.close(); // the browser stopped reading (Stop button or closed tab)
    },
  });

  return new Response(body$, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Model": model.id,
      "X-TTFT-Ms": String(ttftMs ?? ""),
      "Access-Control-Expose-Headers": "X-Model, X-TTFT-Ms",
      // Without these, Cloudflare gzips text/plain, which buffers the reply and
      // breaks word-by-word streaming
      "Cache-Control": "no-store, no-transform",
      "Content-Encoding": "identity",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function serveAsset(env, request) {
  const res = await env.ASSETS.fetch(request);
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/html") || ct.includes("javascript") || ct.includes("text/css")) {
    const headers = new Headers(res.headers);
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
  return res;
}

async function route(request, env, execCtx) {
  const url = new URL(request.url);
  const ctx = new Ctx(env, execCtx);
  const { pathname } = url;
  const method = request.method;

  if (pathname === "/api/models" && method === "GET") return apiModels(ctx, url);
  if (pathname === "/api/status" && method === "GET") return apiStatus(ctx);
  if (pathname === "/api/live" && method === "GET") return apiLive(ctx);
  if (pathname === "/api/random-model" && method === "POST") return apiRandomModel(ctx, request);
  if (pathname === "/api/probe" && method === "POST") return apiProbe(ctx, request);
  if (pathname === "/chat" && method === "POST") return chat(ctx, request);
  if (["/api/models", "/api/status", "/api/live", "/api/random-model", "/api/probe", "/chat"].includes(pathname)) {
    return json({ detail: "Method Not Allowed" }, 405);
  }

  // main.py also served the page at /static/index.html; keep that path working.
  if (pathname.startsWith("/static/")) {
    const assetUrl = new URL(url);
    assetUrl.pathname = pathname.slice("/static".length);
    return serveAsset(env, new Request(assetUrl, request));
  }

  return serveAsset(env, request);
}

export default {
  async fetch(request, env, execCtx) {
    try {
      return await route(request, env, execCtx);
    } catch (error) {
      if (error instanceof HttpError) return json({ detail: error.message }, error.status);
      log("unhandled error:", error?.stack || String(error));
      return json({ detail: "Internal Server Error" }, 500);
    }
  },
};
