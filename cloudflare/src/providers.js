// Hosts other than OpenRouter: Groq, SambaNova, Mistral and Cloudflare Workers AI.
//
// Each one is optional. A host with no API key (or, for Workers AI, no AI binding) is
// simply left out of the catalog, so the Worker runs with OpenRouter alone as before.
// Their models get ids of the form "<host>::<model id>" so they can never clash with an
// OpenRouter id, and every model carries `host` / `host_label` so the page can show
// where a chat is sent.

import {
  cleanDescription,
  contextTier,
  formatTokens,
  inputTier,
  parseSize,
  qualityTier,
  sizeTier,
  formatParams,
} from "./catalog.js";

export const OPENROUTER = { key: "openrouter", label: "OpenRouter" };

// kind "openai": an OpenAI-compatible API at `base` (GET /models, POST /chat/completions).
// kind "binding": the Workers AI binding (env.AI), no key needed.
export const HOSTS = {
  groq: {
    label: "Groq",
    kind: "openai",
    base: "https://api.groq.com/openai/v1",
    keyVar: "GROQ_API_KEY",
    baseVar: "GROQ_BASE_URL",
    free: "Groq free plan",
    limits: "Limits vary by model and account",
  },
  sambanova: {
    label: "SambaNova",
    kind: "openai",
    base: "https://api.sambanova.ai/v1",
    keyVar: "SAMBANOVA_API_KEY",
    baseVar: "SAMBANOVA_BASE_URL",
    free: "SambaNova free tier",
    limits: "Limits vary by model and account",
  },
  mistral: {
    label: "Mistral",
    kind: "openai",
    base: "https://api.mistral.ai/v1",
    keyVar: "MISTRAL_API_KEY",
    baseVar: "MISTRAL_BASE_URL",
    free: "Mistral free plan (monthly credit)",
    limits: "Limits vary by model and account",
  },
  workersai: {
    label: "Workers AI",
    kind: "binding",
    free: "Workers AI daily free allocation",
    limits: "Workers AI's free allocation: 10,000 Neurons a day, shared by every Workers AI model",
  },
};

export const SEP = "::";

export function hostOf(modelId) {
  const at = modelId.indexOf(SEP);
  if (at > 0) {
    const key = modelId.slice(0, at);
    if (HOSTS[key]) return { key, raw: modelId.slice(at + SEP.length), host: HOSTS[key] };
  }
  return { key: OPENROUTER.key, raw: modelId, host: null };
}

export function hostLabel(key) {
  return key === OPENROUTER.key ? OPENROUTER.label : HOSTS[key]?.label || key;
}

export function hostEnabled(env, key) {
  const host = HOSTS[key];
  if (!host) return false;
  const flag = key === "workersai" ? "WORKERS_AI_ENABLED" : key.toUpperCase() + "_ENABLED";
  if (String(env[flag] ?? "").toLowerCase() === "false") return false;
  if (host.kind === "binding") return Boolean(env.AI && typeof env.AI.run === "function");
  return Boolean(env[host.keyVar]);
}

export function enabledHosts(env) {
  return Object.keys(HOSTS).filter((key) => hostEnabled(env, key));
}

export function hostBase(env, key) {
  const host = HOSTS[key];
  return (env[host.baseVar] || host.base).replace(/\/+$/, "");
}

export function hostKey(env, key) {
  return env[HOSTS[key].keyVar] || "";
}

// ---------------------------------------------------------------------------
// Catalog entries
// ---------------------------------------------------------------------------

// Things that are not chat models, by id or name
const NOT_CHAT = [
  "whisper", "tts", "orpheus", "playai", "guard", "safeguard", "embed", "moderation",
  "rerank", "ocr", "transcri", "voxtral-mini-transcribe", "-lora", "bge-", "flux", "stable-diffusion",
];

const MAKERS = {
  openai: "OpenAI", "meta-llama": "Meta", meta: "Meta", qwen: "Qwen", google: "Google",
  mistralai: "Mistral", mistral: "Mistral", deepseek: "DeepSeek", "deepseek-ai": "DeepSeek",
  moonshotai: "MoonshotAI", "z-ai": "Z.ai", zai: "Z.ai", ibm: "IBM", "ibm-granite": "IBM",
  microsoft: "Microsoft", nvidia: "NVIDIA", minimax: "MiniMax", sdaia: "SDAIA", unknown: "Other",
  "zai-org": "Z.ai", cloudflare: "Cloudflare", "swiss-ai": "Swiss AI", "utter-project": "UTTER Project",
  "daily-co": "Daily", aisingapore: "AI Singapore", tencent: "Tencent",
};

const MAKER_KEYS = {
  "meta-llama": "meta-llama", meta: "meta-llama", mistralai: "mistralai", mistral: "mistralai",
  "deepseek-ai": "deepseek", deepseek: "deepseek", qwen: "qwen", openai: "openai", google: "google",
  zai: "z-ai", "z-ai": "z-ai", "zai-org": "z-ai", "ibm-granite": "ibm-granite", ibm: "ibm-granite",
};

function guessMaker(rawId, ownedBy) {
  const id = rawId.replace(/^@cf\/|^@hf\//, "");
  const lower = id.toLowerCase();
  let key = id.includes("/") ? id.split("/")[0].toLowerCase() : "";
  if (!key) {
    if (/^(llama|meta-llama)/.test(lower)) key = "meta-llama";
    else if (/^(qwen|qwq)/.test(lower)) key = "qwen";
    else if (/^deepseek/.test(lower)) key = "deepseek";
    else if (/^gpt-oss/.test(lower)) key = "openai";
    else if (/^gemma/.test(lower)) key = "google";
    else if (/^(mistral|ministral|magistral|codestral|devstral|pixtral|open-mistral)/.test(lower)) key = "mistralai";
    else if (/^glm/.test(lower)) key = "z-ai";
    else if (/^minimax/.test(lower)) key = "minimax";
    else if (/^(kimi|moonshot)/.test(lower)) key = "moonshotai";
    else if (/^allam/.test(lower)) key = "sdaia";
    else if (ownedBy && !ownedBy.includes("@")) key = ownedBy.toLowerCase().replace(/\s+/g, "-");
    else key = "unknown";
  }
  if (ownedBy && ownedBy.includes("@")) ownedBy = "";
  const label = MAKERS[key] || ownedBy || key.replace(/(^|-)([a-z])/g, (_, a, b) => a + b.toUpperCase());
  return { key: MAKER_KEYS[key] || key, label };
}

function prettyName(rawId) {
  const last = rawId.split("/").pop();
  return last
    .replace(/[-_]+/g, " ")
    .replace(/\b([a-z])/g, (ch) => ch.toUpperCase())
    .replace(/\bGpt\b/g, "GPT")
    .replace(/\bOss\b/g, "OSS")
    .replace(/\b(\d+)b\b/gi, "$1B")
    .replace(/\bFp8\b/g, "FP8")
    .replace(/\bAwq\b/g, "AWQ")
    .replace(/\bA(\d+(?:\.\d+)?)b\b/gi, "A$1B")
    .replace(/\bIt\b/g, "IT")
    .replace(/\bGlm\b/g, "GLM")
    .replace(/\bQwq\b/g, "QwQ")
    .replace(/\bVl\b/g, "VL")
    .replace(/\bMoe\b/g, "MoE")
    .replace(/\bDeepseek\b/g, "DeepSeek")
    .replace(/\bEurollm\b/g, "EuroLLM")
    .replace(/\bPhonellm\b/g, "PhoneLLM")
    .replace(/\bSea Lion\b/g, "SEA-LION")
    .trim();
}

function int(value) {
  const n = typeof value === "string" ? parseInt(value, 10) : value;
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Builds a model with the same fields as catalog.buildModel(), from what a host lists.
export function buildHostModel(hostKey, info) {
  const { rawId, name, description = "", ownedBy = "", context = null, maxOutput = null, inputs = ["text"],
    reasoning = false, tools = false } = info;
  const maker = guessMaker(rawId, ownedBy);
  const shortName = (name && name !== rawId && !name.includes("/") ? name : prettyName(name || rawId)).trim();
  const ctx = int(context) || 0;
  const out = int(maxOutput);

  const [totalB, activeB, sizeSource] = parseSize({ id: rawId, name: shortName, description, hugging_face_id: info.hfId || "" });
  let paramsLabel;
  if (totalB === null) paramsLabel = "Size not stated";
  else if (activeB !== null) paramsLabel = formatParams(totalB) + " total, " + formatParams(activeB) + " active";
  else paramsLabel = formatParams(totalB);

  const label = HOSTS[hostKey].label;
  return {
    id: hostKey + SEP + rawId,
    name: shortName,
    full_name: maker.label + ": " + shortName + " (via " + label + ")",
    provider: maker.label,
    provider_key: maker.key,
    host: hostKey,
    host_label: label,
    description: cleanDescription(description) || "Served by " + label + " (" + HOSTS[hostKey].free + ").",
    context: ctx,
    context_label: ctx ? formatTokens(ctx) : "Not stated",
    max_output: out,
    max_output_label: out ? formatTokens(out) : null,
    params_total_b: totalB,
    params_active_b: activeB,
    params_label: paramsLabel,
    params_source: sizeSource,
    input: inputs,
    vision: inputs.includes("image"),
    audio: inputs.includes("audio"),
    video: inputs.includes("video"),
    reasoning: Boolean(reasoning),
    tools: Boolean(tools),
    intelligence: null,
    created: null,
    expires: null,
    tiers: {
      context: contextTier(ctx),
      size: sizeTier(totalB),
      quality: qualityTier(null),
      input: inputTier(inputs),
      provider: maker.key,
      host: hostKey,
    },
  };
}

function notChat(...texts) {
  const text = texts.filter(Boolean).join(" ").toLowerCase();
  return NOT_CHAT.some((hint) => text.includes(hint));
}

// Groq and SambaNova list OpenAI-style models with a few extra fields.
export function parseOpenAiModels(hostKey, payload) {
  const models = [];
  for (const m of (payload && payload.data) || []) {
    if (!m || typeof m.id !== "string") continue;
    if (m.active === false) continue;
    const inputs = Array.isArray(m.input_modalities) ? m.input_modalities : ["text"];
    const outputs = Array.isArray(m.output_modalities) ? m.output_modalities : ["text"];
    if (!inputs.includes("text") || outputs.length !== 1 || outputs[0] !== "text") continue;
    if (notChat(m.id, m.name)) continue;
    const features = Array.isArray(m.supported_features) ? m.supported_features : [];
    models.push(buildHostModel(hostKey, {
      rawId: m.id,
      name: m.name || m.id,
      ownedBy: m.owned_by,
      context: m.context_length || m.context_window || m.max_context_length,
      maxOutput: m.max_completion_tokens || m.max_output_length,
      inputs,
      reasoning: features.includes("reasoning"),
      tools: features.includes("tools") || features.includes("function_calling"),
      hfId: m.hugging_face_id,
    }));
  }
  return models;
}

// Mistral lists every alias as its own entry; keep one per model, preferring "-latest".
export function parseMistralModels(payload, today = new Date().toISOString().slice(0, 10)) {
  const byName = new Map();
  for (const m of (payload && payload.data) || []) {
    if (!m || typeof m.id !== "string") continue;
    const caps = m.capabilities || {};
    if (caps.completion_chat !== true) continue;
    if (m.deprecation && String(m.deprecation).slice(0, 10) <= today) continue;
    if (m.archived) continue;
    if (notChat(m.id, m.name, m.description)) continue;
    const key = m.name || m.id;
    const current = byName.get(key);
    if (current && !m.id.endsWith("-latest")) continue;
    byName.set(key, m);
  }
  return [...byName.values()].map((m) => {
    const caps = m.capabilities || {};
    return buildHostModel("mistral", {
      rawId: m.id,
      name: prettyName(m.id.replace(/-latest$/, "")),
      description: m.description || "",
      ownedBy: "Mistral",
      context: m.max_context_length,
      inputs: caps.vision ? ["text", "image"] : ["text"],
      reasoning: Boolean(caps.reasoning),
      tools: Boolean(caps.function_calling),
    });
  });
}

// Workers AI: env.AI.models() returns the catalog with a list of properties per model.
export function parseWorkersAiModels(list, today = new Date().toISOString().slice(0, 10), { paidPlan = false } = {}) {
  const models = [];
  for (const m of list || []) {
    if (!m || typeof m.name !== "string") continue;
    // These decision and prediction models need structured inputs, not chat messages.
    if (/^@cf\/cloudflare\/(?:clairic|clef(?:-omni|-flash)?)$/i.test(m.name)) continue;
    const task = (m.task && (m.task.name || m.task.id)) || "";
    if (task && task !== "Text Generation") continue;
    const props = {};
    for (const p of m.properties || []) props[p.property_id] = p.value;
    if (props.planned_deprecation_date && String(props.planned_deprecation_date).slice(0, 10) <= today) continue;
    if (!paidPlan && String(props.require_workers_paid) === "true") continue;
    if (notChat(m.name)) continue;
    const vision = String(props.vision) === "true" || /vision|llama-4-scout/i.test(m.name);
    const reasoning = String(props.reasoning) === "true" || /deepseek-r1|qwq|reasoning|gpt-oss|qwen3/i.test(m.name);
    models.push(buildHostModel("workersai", {
      rawId: m.name,
      name: prettyName(m.name),
      description: m.description || "",
      context: props.context_window || props.max_input_tokens,
      maxOutput: props.max_total_tokens ? null : props.max_output_tokens,
      inputs: vision ? ["text", "image"] : ["text"],
      reasoning,
      tools: String(props.function_calling) === "true",
      hfId: props.hugging_face_id || "",
    }));
  }
  return models;
}
