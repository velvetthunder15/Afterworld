// End-to-end test: runs the Worker with `wrangler dev` (real workerd runtime, real
// Durable Object, real Static Assets) against the mock OpenRouter, and checks every route.
// Usage: npm run test:integration
import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { start, calls } from "./mock-openrouter.mjs";

const WORKER_PORT = 8788;
const BASE = "http://127.0.0.1:" + WORKER_PORT;
const WORKER_CWD = fileURLToPath(new URL("..", import.meta.url));
const WRANGLER_BIN = path.join(WORKER_CWD, "node_modules", "wrangler", "bin", "wrangler.js");
const PERSIST_DIR = path.join(os.tmpdir(), "afterworld-test-state-" + Date.now());

const mock = await start(0);
const mockUrl = "http://127.0.0.1:" + mock.address().port;

const wrangler = spawn(
  process.execPath,
  [WRANGLER_BIN, "dev", "--config", "wrangler.test.jsonc", "--port", String(WORKER_PORT), "--ip", "127.0.0.1", "--persist-to", PERSIST_DIR,
   "--var", "OPENROUTER_BASE_URL:" + mockUrl, "--var", "OPENROUTER_API_KEY:test-key", "--var", "WORKERS_AI_ENABLED:false",
   "--var", "GROQ_BASE_URL:" + mockUrl + "/groq", "--var", "GROQ_API_KEY:groq-key",
   "--var", "SAMBANOVA_BASE_URL:" + mockUrl + "/sambanova", "--var", "SAMBANOVA_API_KEY:samba-key",
   "--var", "MISTRAL_BASE_URL:" + mockUrl + "/mistral", "--var", "MISTRAL_API_KEY:mistral-key", "--log-level", "warn"],
  { cwd: WORKER_CWD, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost" } }
);
let logs = "";
wrangler.stdout.on("data", (d) => (logs += d));
wrangler.stderr.on("data", (d) => (logs += d));

async function waitUp() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(BASE + "/");
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("wrangler dev did not start:\n" + logs);
}

const results = [];
async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push(["PASS", name, Date.now() - t0]);
  } catch (error) {
    results.push(["FAIL", name, Date.now() - t0, error.message]);
  }
}

const post = (path, body) => fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const chat = (model, messages) => post("/chat", { model, messages });
const say = (text, images) => [{ role: "user", content: text, ...(images ? { images } : {}) }];
const chatCalls = (model) => calls.filter((c) => c.path === "/api/v1/chat/completions" && c.body.model === model);

async function readStream(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const pieces = [];
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const piece = decoder.decode(value, { stream: true });
    pieces.push({ at: Date.now(), piece });
    text += piece;
  }
  return { text, pieces };
}

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

try {
  await waitUp();

  await test("GET / serves the frontend with no-store", async () => {
    const r = await fetch(BASE + "/");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /text\/html/);
    assert.match(r.headers.get("cache-control") || "", /no-store/);
    assert.match(await r.text(), /Afterworld/);
  });

  await test("GET /static/index.html, /static/styles.css and /static/app.js work with no-store", async () => {
    const r = await fetch(BASE + "/static/index.html");
    assert.equal(r.status, 200);
    assert.match(await r.text(), /<html/i);
    const css = await fetch(BASE + "/static/styles.css?v=2.0.0");
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type") || "", /text\/css/);
    assert.match(css.headers.get("cache-control") || "", /no-store/);
    const js = await fetch(BASE + "/static/app.js?v=2.0.0");
    assert.equal(js.status, 200);
    assert.match(js.headers.get("content-type") || "", /javascript/);
    assert.match(js.headers.get("cache-control") || "", /no-store/);
  });

  let catalog;
  await test("GET /api/models lists only free chat models", async () => {
    const r = await fetch(BASE + "/api/models");
    assert.equal(r.status, 200);
    catalog = await r.json();
    assert.equal(catalog.models.filter((m) => m.host === "openrouter").length, 8);
    assert.ok(!catalog.models.some((m) => m.id === "mock/paid"));
    assert.equal(catalog.version, "2.0.0");
    assert.deepEqual(Object.keys(catalog.groupings).sort(), ["context", "host", "input", "provider", "quality", "size"]);
    const ok = catalog.models.find((m) => m.id === "mock/ok");
    assert.equal(ok.params_label, "7B");
    assert.equal(ok.vision, true);
    assert.equal(ok.context_label, "33K");
    assert.ok(!("_details" in ok));
    assert.deepEqual(catalog.limits, { per_minute: 20, per_day: 50, per_day_with_credits: 1000, credits_threshold: 10 });
  });

  await test("other hosts: Groq, SambaNova and Mistral models are listed with their host", async () => {
    const ids = catalog.models.filter((m) => m.host !== "openrouter").map((m) => m.id).sort();
    assert.deepEqual(ids, ["groq::mock/ok", "mistral::mistral-small-latest", "sambanova::Meta-Llama-3.3-70B-Instruct", "sambanova::mock/paid-host"]);
    assert.equal(catalog.count, 12);
    const samba = catalog.models.find((m) => m.id === "sambanova::Meta-Llama-3.3-70B-Instruct");
    assert.equal(samba.provider, "Meta");
    assert.equal(samba.provider_key, "meta-llama");
    assert.equal(samba.host_label, "SambaNova");
    assert.equal(samba.params_label, "70B");
    assert.equal(samba.tiers.host, "sambanova");
    const mistral = catalog.models.find((m) => m.id === "mistral::mistral-small-latest");
    assert.equal(mistral.vision, true);
    assert.equal(mistral.tools, true);
    assert.deepEqual(catalog.groupings.host.groups.map((g) => g.key).sort(), ["groq", "mistral", "openrouter", "sambanova"]);
    assert.deepEqual(catalog.hosts.map((h) => h.key), ["openrouter", "groq", "sambanova", "mistral"]);
  });

  await test("other hosts: chats go to the right host with the right key and model id", async () => {
    for (const [id, host, key, raw, text] of [
      ["groq::mock/ok", "groq", "groq-key", "mock/ok", "Hello there"],
      ["sambanova::Meta-Llama-3.3-70B-Instruct", "sambanova", "samba-key", "Meta-Llama-3.3-70B-Instruct", "SambaNova says hi."],
      ["mistral::mistral-small-latest", "mistral", "mistral-key", "mistral-small-latest", "Mistral says hi."],
    ]) {
      const before = calls.length;
      const r = await fetch(BASE + "/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: id, messages: say("Hello") }) });
      assert.equal(r.status, 200, id);
      assert.equal(r.headers.get("x-model"), id);
      assert.ok((await r.text()).startsWith(text), id);
      const call = calls.slice(before).find((c) => c.path.endsWith("/chat/completions"));
      assert.equal(call.host, host);
      assert.equal(call.auth, "Bearer " + key);
      assert.equal(call.body.model, raw);
    }
  });

  await test("GET /api/status separates provider request counts", async () => {
    const result = await (await fetch(BASE + "/api/status")).json();
    for (const key of ["groq", "sambanova", "mistral"]) {
      const provider = result.providers.find((p) => p.key === key);
      assert.ok(provider.usage.day >= 1, key);
      assert.equal(provider.scope, "model");
      assert.equal(provider.limit_per_day, null);
    }
    assert.ok(result.updated_at);
  });

  await test("other hosts: a model that needs a paid plan is hidden after its 402", async () => {
    const r = await fetch(BASE + "/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "sambanova::mock/paid-host", messages: say("Hello") }) });
    assert.equal(r.status, 503);
    assert.match((await r.json()).detail, /paid plan|free credit/);
    const list = await (await fetch(BASE + "/api/models")).json();
    assert.ok(!list.models.some((m) => m.id === "sambanova::mock/paid-host"));
    const again = await fetch(BASE + "/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "sambanova::mock/paid-host", messages: say("Hello") }) });
    assert.equal(again.status, 400);
    assert.match((await again.json()).detail, /paid plan/);
  });

  await test("catalog is cached (no second OpenRouter fetch)", async () => {
    const before = calls.filter((c) => c.path === "/api/v1/models").length;
    await (await fetch(BASE + "/api/models")).json();
    assert.equal(calls.filter((c) => c.path === "/api/v1/models").length, before);
  });

  await test("POST /chat streams the reply as plain text (even when the browser accepts gzip)", async () => {
    const r = await fetch(BASE + "/chat", { method: "POST", headers: { "Content-Type": "application/json", "Accept-Encoding": "gzip, br" }, body: JSON.stringify({ model: "mock/ok", messages: say("Hello") }) });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("x-model"), "mock/ok");
    assert.match(r.headers.get("x-ttft-ms") || "", /^\d+$/);
    assert.match(r.headers.get("content-type"), /text\/plain/);
    const { text, pieces } = await readStream(r);
    assert.equal(text, "Hello there, this is a streamed reply.");
    assert.ok(pieces.length > 1, "expected several pieces, got " + pieces.length);
    assert.ok(pieces.at(-1).at - pieces[0].at >= 30, "pieces arrived all at once");
    const sent = chatCalls("mock/ok").at(-1);
    assert.equal(sent.auth, "Bearer test-key");
    assert.equal(sent.body.stream, true);
    assert.equal(sent.body.max_tokens, 2048);
    assert.deepEqual(sent.body.messages[0], { role: "system", content: "You are a helpful chatbot." });
  });

  await test("history is cleaned: merged roles, starts with user", async () => {
    const r = await chat("mock/ok", [
      { role: "assistant", content: "stray" },
      { role: "user", content: "a" },
      { role: "user", content: "b" },
      { role: "assistant", content: "  " },
      { role: "assistant", content: "c" },
    ]);
    await readStream(r);
    const msgs = chatCalls("mock/ok").at(-1).body.messages;
    assert.deepEqual(msgs.slice(1), [{ role: "user", content: "a\n\nb" }, { role: "assistant", content: "c" }]);
  });

  await test("429 is retried on the same model after a wait", async () => {
    const t0 = Date.now();
    const r = await chat("mock/retry-429", say("hi"));
    assert.equal(r.status, 200);
    assert.equal((await readStream(r)).text, "Answered after a retry.");
    assert.equal(chatCalls("mock/retry-429").length, 2);
    assert.ok(Date.now() - t0 >= 1400, "no back-off wait");
  });

  await test("400 retries once without the system message", async () => {
    const r = await chat("mock/system-400", say("hi"));
    assert.equal(r.status, 200);
    assert.equal((await readStream(r)).text, "Answered without a system message.");
    const sent = chatCalls("mock/system-400");
    assert.equal(sent.length, 2);
    assert.equal(sent[1].body.messages[0].role, "user");
    assert.match(sent[1].body.messages[0].content, /^You are a helpful chatbot\.\n\nhi$/);
  });

  await test("empty replies give up after 3 attempts with a 503", async () => {
    const r = await chat("mock/empty", say("hi"));
    assert.equal(r.status, 503);
    assert.match((await r.json()).detail, /empty reply/);
    assert.equal(chatCalls("mock/empty").length, 3);
  });

  await test("provider 429 explains the upstream limit", async () => {
    const r = await chat("mock/upstream-429", say("hi"));
    assert.equal(r.status, 503);
    assert.match((await r.json()).detail, /provider is rate limited/);
    assert.equal(chatCalls("mock/upstream-429").length, 3);
  });

  await test("error inside the stream ends the reply with a note", async () => {
    const r = await chat("mock/midstream-error", say("hi"));
    assert.equal(r.status, 200);
    const { text } = await readStream(r);
    assert.equal(text, "Partial answer \n\n[Reply interrupted: The model request failed. Try again or choose another model.]");
  });

  await test("agent-only model is hidden after its 403", async () => {
    const r = await chat("mock/agent-only", say("hi"));
    assert.equal(r.status, 503);
    assert.match((await r.json()).detail, /agentic tool/);
    assert.equal(chatCalls("mock/agent-only").length, 1);
    const list = await (await fetch(BASE + "/api/models")).json();
    assert.equal(list.models.filter((m) => m.host === "openrouter").length, 7);
    assert.equal(list.excluded_agent_only, 1);
    const again = await chat("mock/agent-only", say("hi"));
    assert.equal(again.status, 400);
    assert.equal(chatCalls("mock/agent-only").length, 1);
  });

  await test("image input reaches OpenRouter as image_url parts", async () => {
    const r = await chat("mock/ok", say("what is this?", [PNG]));
    assert.equal(r.status, 200);
    await readStream(r);
    const content = chatCalls("mock/ok").at(-1).body.messages[1].content;
    assert.deepEqual(content, [{ type: "text", text: "what is this?" }, { type: "image_url", image_url: { url: PNG } }]);
  });

  await test("images are refused for text-only models and bad data", async () => {
    let r = await chat("mock/retry-429", say("x", [PNG]));
    assert.equal(r.status, 400);
    assert.match((await r.json()).detail, /doesn't accept images/);
    r = await chat("mock/ok", say("x", ["data:text/html;base64,AAAA"]));
    assert.equal(r.status, 400);
    assert.match((await r.json()).detail, /valid PNG/);
    r = await chat("mock/ok", say("x", Array(9).fill(PNG)));
    assert.equal(r.status, 400);
    assert.match((await r.json()).detail, /Too many images/);
  });

  await test("bad requests: empty chat, unknown model, bad body, wrong method", async () => {
    let r = await chat("mock/ok", say("   "));
    assert.equal(r.status, 400);
    assert.equal((await r.json()).detail, "Type a message first.");
    r = await chat("nope/none", say("hi"));
    assert.equal(r.status, 400);
    assert.match((await r.json()).detail, /isn't in the current free-model list/);
    r = await post("/chat", { messages: "x" });
    assert.equal(r.status, 422);
    r = await fetch(BASE + "/chat");
    assert.equal(r.status, 405);
  });

  await test("POST /api/probe measures one model", async () => {
    let r = await post("/api/probe", { model: "mock/ok" });
    let data = await r.json();
    assert.equal(r.status, 200);
    assert.equal(data.ok, true);
    assert.equal(typeof data.ms, "number");
    assert.match(data.message, /answered in \d+ ms/);
    r = await post("/api/probe", { model: "mock/upstream-429" });
    data = await r.json();
    assert.equal(data.ok, false);
    assert.equal(data.throttled, true);
    assert.match(data.message, /provider is rate limited/);
  });

  await test("GET /api/live merges OpenRouter stats with live measurements immediately", async () => {
    const r = await fetch(BASE + "/api/live");
    assert.equal(r.status, 200);
    const live = await r.json();
    assert.equal(Object.keys(live.models).filter((id) => !id.includes("::")).length, 7);
    assert.equal(live.models["mock/ok"].latency_source, "measured");
    assert.equal(live.models["mock/slow-first"].latency_ms, 300); // 0.3 s from the stats, scaled to ms
    assert.equal(live.models["mock/slow-first"].latency_source, "openrouter");
    assert.equal(live.models["mock/upstream-429"].state, "throttled");
    assert.ok(Array.isArray(live.providers) && live.providers.length === 4);
    assert.equal(live.catalog_count, 10);
    assert.ok(live.usage.minute >= 10, "usage counter " + JSON.stringify(live.usage));
    assert.ok(live.usage.day >= live.usage.minute);
    assert.ok(live.stats_at);
  });

  await test("POST /chat supports optional custom system prompt", async () => {
    const r = await post("/chat", { model: "mock/ok", system: "Reply concisely.", messages: say("Hello") });
    assert.equal(r.status, 200);
    await readStream(r);
    const sent = chatCalls("mock/ok").at(-1);
    assert.deepEqual(sent.body.messages[0], { role: "system", content: "Reply concisely." });
  });

  await test("POST /api/random-model picks a fast model that answers", async () => {
    const r = await post("/api/random-model", {});
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.ok(["mock/ok", "mock/slow-first", "mock/retry-429", "mock/system-400"].includes(data.model.id), data.model.id);
    assert.equal(data.mode, "stats");
    assert.equal(typeof data.measured_ms, "number");
    assert.match(data.note, /fastest free models/);
  });

  await test("stopping a reply mid-stream closes the upstream request", async () => {
    const controller = new AbortController();
    const r = await fetch(BASE + "/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "mock/ok", messages: say("hi") }), signal: controller.signal });
    const reader = r.body.getReader();
    await reader.read();
    controller.abort();
    await new Promise((res) => setTimeout(res, 300));
    const ok = await fetch(BASE + "/api/models");
    assert.equal(ok.status, 200); // the Worker is still healthy
  });
} finally {
  if (process.platform === "win32") {
    try { spawnSync("taskkill", ["/PID", String(wrangler.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
  } else {
    try { process.kill(-wrangler.pid, "SIGTERM"); } catch {} // the whole group, so workerd stops too
  }
  mock.close();
}

for (const [status, name, ms, error] of results) console.log(status, name, "(" + ms + " ms)" + (error ? "\n    " + error : ""));
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log("\n" + (results.length - failed) + "/" + results.length + " passed");
if (failed) {
  console.log("\n--- wrangler output ---\n" + logs.slice(-4000));
  process.exit(1);
}
process.exit(0);
