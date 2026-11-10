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

// What Groq, SambaNova and Mistral list at /models (OpenAI-style, with their own extras)
const HOST_MODELS = {
  groq: [
    { id: "mock/ok", name: "Groq Mock OK", owned_by: "Mock", active: true, context_window: 131072, max_completion_tokens: 8192, input_modalities: ["text"], output_modalities: ["text"], supported_features: ["tools", "reasoning"] },
    { id: "whisper-large-v3", name: "Whisper", owned_by: "OpenAI", active: true, input_modalities: ["audio"], output_modalities: ["transcription"] },
    { id: "meta-llama/llama-prompt-guard-2-22m", name: "Prompt Guard 2 22M", owned_by: "Meta", active: true, input_modalities: ["text"], output_modalities: ["text"] },
  ],
  sambanova: [
    { id: "Meta-Llama-3.3-70B-Instruct", owned_by: "no-reply@sambanova.ai", context_length: 131072, max_completion_tokens: 3072 },
    { id: "mock/paid-host", owned_by: "no-reply@sambanova.ai", context_length: 8192 },
  ],
  mistral: [
    { id: "mistral-small-2506", name: "mistral-small-2506", capabilities: { completion_chat: true, vision: true, function_calling: true }, max_context_length: 131072, description: "Small model" },
    { id: "mistral-small-latest", name: "mistral-small-2506", capabilities: { completion_chat: true, vision: true, function_calling: true }, max_context_length: 131072, description: "Small model" },
    { id: "mistral-embed", name: "mistral-embed", capabilities: { completion_chat: false } },
    { id: "mistral-old", name: "mistral-old", capabilities: { completion_chat: true }, deprecation: "2020-01-01T00:00:00Z" },
  ],
};

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
    let path = url.pathname;
    const hostMatch = path.match(/^\/(groq|sambanova|mistral)(\/.*)$/);
    const host = hostMatch ? hostMatch[1] : null;
    if (hostMatch) path = hostMatch[2] === "/models" ? "/host-models" : "/api/v1" + hostMatch[2];
    calls.push({ method: req.method, path: url.pathname, host, auth: req.headers.authorization || null, body: body ? JSON.parse(body) : null });

    if (path === "/host-models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ object: "list", data: HOST_MODELS[host] }));
    }

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

    if (path === "/api/v1/chat/completions") {
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
        case "Meta-Llama-3.3-70B-Instruct":
          return sse(res, words("SambaNova says hi."));
        case "mock/paid-host":
          res.writeHead(402, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: { code: "PAYMENT_METHOD_REQUIRED", message: "A payment method is required." } }));
        case "mistral-small-latest":
          return sse(res, words("Mistral says hi."));
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
