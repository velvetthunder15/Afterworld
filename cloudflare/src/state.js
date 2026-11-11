// Shared state for every Worker isolate, kept in one Durable Object.
//
// On Azure this lived in module globals guarded by threading.Lock, which only works
// because App Service runs one long-lived process. Workers run many short-lived
// isolates, so the cached catalog, latency stats, live measurements, 429s, the request
// counter and the agent-only list are kept here instead. A Durable Object handles one
// call at a time, which replaces the locks.

import { DurableObject } from "cloudflare:workers";

export const AGENT_ONLY_TTL = 86400; // seconds before an agent-only model is re-checked
const DAY = 86400;

export class AfterworldState extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return;
    const stored = await this.ctx.storage.get(["catalog", "stats", "observed", "requests", "agentOnly", "statUrls", "seeded", "seededIds"]);
    this.catalog = stored.get("catalog") || { models: [], fetched_at: 0, schema: 0 };
    this.stats = stored.get("stats") || { results: {}, stats_at: 0 };
    this.observed = stored.get("observed") || {};
    this.requests = stored.get("requests") || [];
    this.agentOnly = stored.get("agentOnly") || {};
    this.statUrls = stored.get("statUrls") || {};
    this.seeded = stored.get("seeded") || false;
    this.seededIds = new Set(stored.get("seededIds") || []);
    this.loaded = true;
  }

  pruneAgentOnly(now) {
    let changed = false;
    for (const [id, info] of Object.entries(this.agentOnly)) {
      if (now - info.at > AGENT_ONLY_TTL) {
        delete this.agentOnly[id];
        changed = true;
      }
    }
    return changed;
  }

  pruneRequests(now) {
    const cutoff = now - DAY;
    let i = 0;
    while (i < this.requests.length && (typeof this.requests[i] === "number" ? this.requests[i] : this.requests[i].at) < cutoff) i++;
    if (i) this.requests = this.requests.slice(i);
    return i > 0;
  }

  // Everything a request needs, in one call.
  async snapshot(seedAgentOnly = []) {
    await this.load();
    const now = Date.now() / 1000;
    let changed = this.pruneAgentOnly(now);
    // Like main.py's seed_known_agent_only(): hidden from the start, then re-checked after
    // AGENT_ONLY_TTL like any other agent-only model. Track per-id so newly discovered known
    // agent-only ids get seeded once even on existing Durable Object storage.
    let seededChanged = false;
    for (const id of seedAgentOnly) {
      if (!this.seededIds.has(id)) {
        this.agentOnly[id] ||= { reason: "Known to only work inside an agentic tool.", at: now };
        this.seededIds.add(id);
        seededChanged = true;
        changed = true;
      }
    }
    if (!this.seeded) {
      this.seeded = true;
      seededChanged = true;
      changed = true;
    }
    if (changed) {
      const patch = { agentOnly: this.agentOnly, seeded: true };
      if (seededChanged) patch.seededIds = [...this.seededIds];
      await this.ctx.storage.put(patch);
    }
    return {
      catalog: this.catalog,
      stats: this.stats,
      observed: this.observed,
      agentOnly: this.agentOnly,
      statUrls: this.statUrls,
      usage: this.usage(now),
      providerRequests: this.requests.filter((r) => typeof r === "object"),
    };
  }

  usage(now = Date.now() / 1000) {
    this.pruneRequests(now);
    const midnight = now - (now % DAY); // start of the current UTC day
    let minute = 0;
    let day = 0;
    for (const t of this.requests) {
      const at = typeof t === "number" ? t : t.at;
      if (typeof t !== "number" && t.host !== "openrouter") continue;
      if (at > now - 60) minute++;
      if (at >= midnight) day++;
    }
    return { minute, day };
  }

  async putCatalog(catalog) {
    await this.load();
    this.catalog = catalog;
    await this.ctx.storage.put("catalog", catalog);
  }

  async putStats(stats, statUrls) {
    await this.load();
    this.stats = stats;
    Object.assign(this.statUrls, statUrls || {});
    await this.ctx.storage.put({ stats: this.stats, statUrls: this.statUrls });
  }

  // events: [{type: "request", at} | {type: "success", id, ms, at} | {type: "throttle", id, at} | {type: "agent_only", id, reason, at}]
  async record(events) {
    await this.load();
    for (const event of events || []) {
      if (event.type === "request") {
        this.requests.push({ at: event.at, host: event.host || "openrouter", model: event.model || "" });
      } else if (event.type === "success") {
        const obs = (this.observed[event.id] ||= {});
        obs.ms = event.ms;
        obs.at = event.at;
        obs.ok_at = event.at;
      } else if (event.type === "throttle") {
        (this.observed[event.id] ||= {}).throttled_at = event.at;
      } else if (event.type === "agent_only") {
        this.agentOnly[event.id] = { reason: event.reason, at: event.at };
      }
    }
    this.requests.sort((a, b) => (typeof a === "number" ? a : a.at) - (typeof b === "number" ? b : b.at));
    this.pruneRequests(Date.now() / 1000);
    await this.ctx.storage.put({ observed: this.observed, requests: this.requests, agentOnly: this.agentOnly });
  }
}
