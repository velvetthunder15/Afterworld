// A small async OpenRouter client for Workers, replacing the synchronous `openai` SDK
// and urllib calls in main.py. Errors carry the same information the SDK's did
// (status code and message), so the retry and error-message rules are unchanged.

import { hostOf, hostBase, hostKey } from "./providers.js";

export class ApiError extends Error {
  // kind: "status" (HTTP error), "stream" (error sent inside the stream),
  //       "timeout", or "connection"
  constructor(kind, message, status = null) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

export function baseUrl(env) {
  return (env.OPENROUTER_BASE_URL || "https://openrouter.ai").replace(/\/+$/, "");
}

function timeoutError(error) {
  return error && (error.name === "TimeoutError" || error.name === "AbortError" || error instanceof IdleTimeout);
}

class IdleTimeout extends Error {}

export async function fetchJson(env, url, { timeoutMs = 15000, auth = false } = {}) {
  const headers = { Accept: "application/json", "User-Agent": "Afterworld/1.0" };
  if (auth && env.OPENROUTER_API_KEY) headers.Authorization = "Bearer " + env.OPENROUTER_API_KEY;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("HTTP " + response.status + " from " + url);
  }
  return response.json();
}

// Reads Server-Sent Events from OpenRouter and yields each parsed chunk.
// `idleMs` plays the role of the SDK's read timeout: the time allowed between pieces.
export async function* sseChunks(body, idleMs) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data = [];

  const read = () => {
    let timer;
    const idle = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new IdleTimeout("idle")), idleMs);
    });
    return Promise.race([reader.read(), idle]).finally(() => clearTimeout(timer));
  };

  try {
    while (true) {
      let result;
      try {
        result = await read();
      } catch (error) {
        if (timeoutError(error)) throw new ApiError("timeout", "Request timed out.");
        throw new ApiError("connection", "Connection error.");
      }
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });

      let newline;
      while ((newline = buffer.search(/\r\n|\r|\n/)) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + (buffer.startsWith("\r\n", newline) ? 2 : 1));

        if (line === "") {
          if (data.length) {
            const payload = data.join("\n");
            data = [];
            if (payload === "[DONE]") return;
            yield parseChunk(payload);
          }
          continue;
        }
        if (line.startsWith(":")) continue; // keep-alive comment (": OPENROUTER PROCESSING")
        if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
    }
    if (data.length) {
      const payload = data.join("\n");
      if (payload !== "[DONE]") yield parseChunk(payload);
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

function parseChunk(payload) {
  let chunk;
  try {
    chunk = JSON.parse(payload);
  } catch {
    return { choices: [] };
  }
  if (chunk && chunk.error) {
    const message = typeof chunk.error === "object" ? chunk.error.message || JSON.stringify(chunk.error) : String(chunk.error);
    throw new ApiError("stream", message, null);
  }
  if (!Array.isArray(chunk.choices)) {
    // Workers AI's own stream format: {"response": "text", ...}
    chunk.choices = typeof chunk.response === "string" && chunk.response
      ? [{ index: 0, delta: { content: chunk.response } }]
      : [];
  }
  return chunk;
}

// Starts a streamed chat completion. Resolves once OpenRouter answers with headers;
// returns an async iterator of chunks plus a close() to stop it early.
export async function createChatStream(env, { model, messages, maxTokens, timeoutMs, signal }) {
  const target = hostOf(model);
  if (target.host && target.host.kind === "binding") {
    return createWorkersAiStream(env, { model: target.raw, messages, maxTokens, timeoutMs, signal });
  }
  const url = target.host
    ? hostBase(env, target.key) + "/chat/completions"
    : baseUrl(env) + "/api/v1/chat/completions";
  const apiKey = target.host ? hostKey(env, target.key) : env.OPENROUTER_API_KEY || "";
  model = target.raw;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), timeoutMs);
  const onAbort = () => controller.abort(signal.reason);
  signal?.addEventListener("abort", onAbort);

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: "Bearer " + apiKey,
        "User-Agent": "Afterworld/1.0",
      },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, stream: true }),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    if (controller.signal.aborted && controller.signal.reason?.name === "TimeoutError") {
      throw new ApiError("timeout", "Request timed out.");
    }
    throw new ApiError("connection", "Connection error.");
  }
  clearTimeout(timer);

  if (!response.ok) {
    signal?.removeEventListener("abort", onAbort);
    const text = await response.text().catch(() => "");
    let detail = text;
    let inner = "";
    try {
      const body = JSON.parse(text);
      inner = body?.error?.message || "";
      detail = JSON.stringify(body);
    } catch {
      // keep the raw text
    }
    // Same shape as the openai SDK's message, so the text checks in main.py still apply
    const message = "Error code: " + response.status + (detail ? " - " + detail : "") + (inner && !detail.includes(inner) ? " " + inner : "");
    const error = new ApiError("status", message, response.status);
    const retry = response.headers.get("retry-after");
    if (retry) { const seconds = Number(retry); error.retryAfter = Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : Math.max(0, Math.ceil((Date.parse(retry) - Date.now()) / 1000)) || null; }
    throw error;
  }

  const chunks = sseChunks(response.body, timeoutMs);
  return {
    chunks,
    close() {
      signal?.removeEventListener("abort", onAbort);
      chunks.return?.().catch(() => {});
      controller.abort();
    },
  };
}

// Workers AI through the AI binding. Its errors are exceptions with a message and a
// numeric code rather than HTTP statuses, so they are mapped onto the statuses the
// retry and error-message rules already understand.
export function workersAiStatus(message) {
  const text = (message || "").toLowerCase();
  if (/neuron|daily free allocation|rate limit|too many requests|capacity|429|3040|4006/.test(text)) return 429;
  if (/paid plan|workers paid|upgrade/.test(text)) return 402;
  if (/no such model|not found|5007/.test(text)) return 404;
  if (/bad input|invalid|5006|schema|required properties/.test(text)) return 400;
  if (/auth|10000|permission/.test(text)) return 401;
  return 500;
}

async function createWorkersAiStream(env, { model, messages, maxTokens, timeoutMs, signal }) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ApiError("timeout", "Request timed out.")), timeoutMs);
  });
  let body;
  try {
    body = await Promise.race([
      env.AI.run(model, { messages, max_tokens: maxTokens, stream: true }, signal ? { signal } : undefined),
      timeout,
    ]);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const message = error?.message || String(error);
    throw new ApiError("status", "Workers AI: " + message, workersAiStatus(message));
  } finally {
    clearTimeout(timer);
  }
  if (!(body instanceof ReadableStream)) {
    // Some models ignore stream: true and answer in one piece
    const text = (body && (body.response ?? body.choices?.[0]?.message?.content)) || "";
    const chunks = (async function* () {
      if (text) yield { choices: [{ index: 0, delta: { content: String(text) } }] };
    })();
    return { chunks, close() {} };
  }
  const chunks = sseChunks(body, timeoutMs);
  return {
    chunks,
    close() {
      chunks.return?.().catch(() => {});
    },
  };
}
