// A stand-in for OpenRouter, used by the integration tests so retries, errors and
// streaming can be tested without spending real requests.
// Behaviour is picked by the model id: mock/ok, mock/retry-429, mock/system-400,
// mock/agent-only, mock/empty, mock/midstream-error, mock/upstream-429, mock/slow-first
import http from "node:http";

const free = { prompt: "0", completion: "0" };
const model = (id, extra = {}) => ({
  id,
  name: "Mock: " + id.split("/")[1] + " (free)",
  description: "A 7B-parameter test model.",
  context_length: 32768,
  pricing: free,
  architecture: { input_modalities: ["text", ...(extra.vision ? ["image"] : [])], output_modalities: ["text"], tokenizer: "Other" },
  supported_parameters: ["max_tokens"],
  top_provider: { context_length: 32768, max_completion_tokens: 2048 },
  ...extra.fields,
});

const MODELS = [
  model("mock/ok", { vision: true }),
  model("mock/retry-429"),
  model("mock/system-400"),
  model("mock/agent-only"),
  model("mock/empty"),
  model("mock/midstream-error"),
  model("mock/upstream-429"),
  model("mock/slow-first"),
  model("mock/paid", { fields: { pricing: { prompt: "0.000001", completion: "0" } } }),
];

export const calls = [];
const attempts = new Map();

function sse(res, chunks, { delayMs = 15, comment = true } = {}) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  if (comment) res.write(": OPENROUTER PROCESSING\n\n");
  let i = 0;
  const next = () => {
    if (i < chunks.length) {
      res.write("data: " + JSON.stringify(chunks[i++]) + "\n\n");
      setTimeout(next, delayMs);
    } else {
      res.write("data: [DONE]\n\n");
      res.end();
    }
  };
  next();
}

const delta = (content, extra = {}) => ({ choices: [{ index: 0, delta: { content, ...extra } }] });

function words(text) {
  return text.split(/(?<= )/).map((w) => delta(w));
}

export function start(port = 0) {
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    const url = new URL(req.url, "http://x");
    calls.push({ method: req.method, path: url.pathname, auth: req.headers.authorization || null, body: body ? JSON.parse(body) : null });

    if (url.pathname === "/api/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: MODELS }));
    }

    const ep = url.pathname.match(/^\/api\/v1\/models\/(.+)\/endpoints$/);
    if (ep) {
      const id = decodeURIComponent(ep[1]);
      const latency = { "mock/ok": 0.4, "mock/retry-429": 0.9, "mock/system-400": 1.2, "mock/slow-first": 0.3 }[id];
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: { endpoints: [{ pricing: free, status: 0, uptime_last_30m: 99, latency_last_30m: latency ? { p50: latency } : null }] } }));
    }

    if (url.pathname === "/api/v1/chat/completions") {
      const request = JSON.parse(body);
      const id = request.model;
      const n = (attempts.get(id) || 0) + 1;
      attempts.set(id, n);
      const err = (status, message) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: status, message } }));
      };
      const probe = request.max_tokens === 16;

      switch (id) {
        case "mock/ok":
          if (probe) return sse(res, [{ choices: [{ delta: { reasoning: "thinking" } }] }, ...words("Hi!")]);
          // reasoning-only and empty chunks between pieces of the answer, like real reasoning models send
          return sse(res, [{ choices: [{ delta: { reasoning: "thinking" } }] }, ...words("Hello there, this is a streamed reply.").flatMap((c) => [c, { choices: [{ delta: { reasoning: "more" } }] }, { choices: [] }])]);
        case "mock/retry-429":
          if (!probe && n % 2 === 1) return err(429, "Rate limit exceeded: free-models-per-min.");
          return sse(res, words("Answered after a retry."));
        case "mock/system-400":
          if (request.messages[0].role === "system") return err(400, "Developer instruction is not enabled for this model");
          return sse(res, words("Answered without a system message."));
        case "mock/agent-only":
          return err(403, "This model is only available on agentic harnesses such as a coding agent or productivity app.");
        case "mock/empty":
          return sse(res, []);
        case "mock/midstream-error":
          return sse(res, [delta("Partial "), delta("answer "), { error: { code: 502, message: "Provider disconnected" } }]);
        case "mock/upstream-429":
          return err(429, "mock/upstream-429 is temporarily rate-limited upstream. Please retry shortly.");
        case "mock/slow-first":
          return setTimeout(() => sse(res, words("slow but fine")), probe ? 100 : 2000);
        default:
          return err(404, "No endpoints found for " + id);
      }
    }

    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (import.meta.url === "file://" + process.argv[1]) {
  const server = await start(Number(process.argv[2] || 8799));
  console.log("mock OpenRouter on", server.address().port);
}
