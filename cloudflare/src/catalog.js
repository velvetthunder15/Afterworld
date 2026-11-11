// Turning OpenRouter's raw model list into Afterworld's free chat-model catalog.
// Line-for-line port of the pure functions in main.py, so both backends show the same list.

export const ROUTER_IDS = new Set(["openrouter/free", "openrouter/auto", "openrouter/bodybuilder"]);

export const KNOWN_AGENT_ONLY_IDS = [
  "thinkingmachines/inkling:free",
  "thinkingmachines/inkling-small:free",
  "thinkingmachines/inkling-2:free",
  "thinkingmachines/inkling-2-small:free",
];

export const AGENT_ONLY_HINTS = [
  "agentic harness",
  "agentic harnesses",
  "only available on",
  "coding agent or productivity app",
];

const NON_CHAT_HINTS = [
  "content safety",
  "guardrail model",
  "guard model",
  "safety classifier",
  "reranker",
  "embedding model",
];

export const GROUPINGS = {
  context: {
    title: "Context window",
    hint: "How much text a model can read at once, in tokens",
    groups: [["1m", "1M+ tokens"], ["200k", "200K to 1M tokens"], ["100k", "100K to 200K tokens"], ["32k", "32K to 100K tokens"], ["small", "Under 32K tokens"]],
  },
  size: {
    title: "Model size",
    hint: "Total parameters, only where the model itself states them",
    groups: [["500b", "500B and up"], ["200b", "200B to 500B"], ["50b", "50B to 200B"], ["10b", "10B to 50B"], ["small", "Under 10B"], ["unknown", "Size not stated"]],
  },
  quality: {
    title: "Benchmark score",
    hint: "Artificial Analysis Intelligence Index, as reported by OpenRouter",
    groups: [["40", "40 and above"], ["30", "30 to 40"], ["20", "20 to 30"], ["low", "Under 20"], ["none", "Not benchmarked yet"]],
  },
  input: {
    title: "Input types",
    hint: "What you can send to the model",
    groups: [["multimodal", "Multimodal (audio or video)"], ["vision", "Text and images"], ["text", "Text only"]],
  },
};

export function contextTier(tokens) {
  if (tokens >= 1_000_000) return "1m";
  if (tokens >= 200_000) return "200k";
  if (tokens >= 100_000) return "100k";
  if (tokens >= 32_000) return "32k";
  return "small";
}

export function sizeTier(totalB) {
  if (totalB === null || totalB === undefined) return "unknown";
  if (totalB >= 500) return "500b";
  if (totalB >= 200) return "200b";
  if (totalB >= 50) return "50b";
  if (totalB >= 10) return "10b";
  return "small";
}

export function qualityTier(score) {
  if (score === null || score === undefined) return "none";
  if (score >= 40) return "40";
  if (score >= 30) return "30";
  if (score >= 20) return "20";
  return "low";
}

export function inputTier(inputs) {
  if (inputs.includes("audio") || inputs.includes("video")) return "multimodal";
  if (inputs.includes("image")) return "vision";
  return "text";
}

// ---------------------------------------------------------------------------
// Parameter counts: only sizes the model itself states, never guessed.
// Python's scoped (?i:...) groups are written out as [xX] classes so the
// patterns behave identically on every JavaScript engine.
// ---------------------------------------------------------------------------

function ci(text) {
  return text.replace(/[a-z]/gi, (ch) => "[" + ch.toLowerCase() + ch.toUpperCase() + "]");
}

const TOKEN_TOTAL = /^(\d+(?:\.\d+)?)([bt])$/;
const TOKEN_ACTIVE = /^a(\d+(?:\.\d+)?)([bt])$/;

const NU = String.raw`(\d+(?:\.\d+)?)[- ]?(billion|trillion|B|T)\b`;

const PAIRED_PATTERNS = [
  [NU + String.raw`\s+` + ci("active") + String.raw`\s+` + ci("param") + String.raw`\w*\s+(?:` + ci("out") + String.raw`\s+` + ci("of") + "|" + ci("of") + String.raw`)\s+(?:` + ci("the") + String.raw`\s+|` + ci("a") + String.raw`\s+)?` + NU + String.raw`\s+` + ci("total"), "active_total"],
  [NU + String.raw`\s+` + ci("total") + String.raw`\s+` + ci("param") + String.raw`\w*(?:\s+\w+){0,2}?\s*(?:,|` + ci("and") + "|" + ci("with") + String.raw`)\s*` + NU + String.raw`\s+` + ci("active"), "total_active"],
  [NU + String.raw`\s+` + ci("total") + String.raw`\s*/\s*` + NU + String.raw`\s+` + ci("active"), "total_active"],
  [String.raw`(\d+(?:\.\d+)?)(B|T)-A(\d+(?:\.\d+)?)(B|T)\b`, "total_active"],
].map(([source, order]) => [new RegExp(source, "g"), order]);

const TOTAL_ONLY_PATTERNS = [
  new RegExp(NU + "[- ]" + ci("param")),
  new RegExp(NU + String.raw`\s+(?:` + ci("total") + "|" + ci("backbone") + String.raw`)\s+` + ci("param")),
];

const COMPARISON_WORDS = ["than", "outperform", "compared", "versus", " vs", "rival", "larger", "smaller", "beats", "surpass"];

function toBillions(number, unit) {
  const value = parseFloat(number);
  const u = unit.toLowerCase();
  return u === "t" || u === "trillion" ? value * 1000 : value;
}

function sane(total, active) {
  if (total === null || total === undefined || total <= 0 || total > 100_000) return null;
  if (active !== null && active !== undefined && !(active > 0 && active < total)) active = null;
  return [total, active ?? null];
}

export function sizeFromIdentifier(text) {
  const totals = new Set();
  const actives = new Set();

  for (const token of text.toLowerCase().split(/[^a-z0-9.]+/)) {
    let match = TOKEN_TOTAL.exec(token);
    if (match) totals.add(toBillions(match[1], match[2]));
    match = TOKEN_ACTIVE.exec(token);
    if (match) actives.add(toBillions(match[1], match[2]));
  }

  if (totals.size !== 1) return null;
  const total = [...totals][0];
  const active = actives.size === 1 ? [...actives][0] : null;
  return sane(total, active);
}

function sentences(text) {
  const trimmed = text.trim();
  if (!trimmed) return [""]; // Python's re.split on "" returns [""]
  return trimmed.split(/(?<=[.!?])\s+(?=[A-Z])/);
}

function isComparison(text, start) {
  const before = text.slice(Math.max(0, start - 40), start).toLowerCase();
  return COMPARISON_WORDS.some((word) => before.includes(word));
}

const MD_LINK = /\[([^\]]+)\]\([^)]*\)/g;

export function sizeFromDescription(description) {
  const text = (description || "").replace(MD_LINK, "$1");
  const parts = sentences(text);
  if (!parts.length) return null;

  const early = parts.slice(0, 3).join(" ");

  for (const [pattern, order] of PAIRED_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of early.matchAll(pattern)) {
      if (isComparison(early, match.index)) continue;
      const groups = match.slice(1);
      if (groups.length !== 4) continue;
      const first = toBillions(groups[0], groups[1]);
      const second = toBillions(groups[2], groups[3]);
      const [active, total] = order === "active_total" ? [first, second] : [second, first];
      const result = sane(total, active);
      if (result) return result;
    }
  }

  for (const pattern of TOTAL_ONLY_PATTERNS) {
    const match = pattern.exec(parts[0]);
    if (match && !isComparison(parts[0], match.index)) {
      const result = sane(toBillions(match[1], match[2]), null);
      if (result) return result;
    }
  }

  return null;
}

export function parseSize(entry) {
  const slug = (entry.id || "").split(":")[0];
  for (const [source, text] of [["id", slug], ["weights", entry.hugging_face_id || ""]]) {
    const found = sizeFromIdentifier(text);
    if (found) return [found[0], found[1], source];
  }
  const found = sizeFromDescription(entry.description || "");
  if (found) return [found[0], found[1], "description"];
  return [null, null, null];
}

// ---------------------------------------------------------------------------
// Filtering and normalising
// ---------------------------------------------------------------------------

function price(value) {
  if (value === null || value === undefined || typeof value === "boolean") return value === true ? 1 : value === false ? 0 : null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) && String(value).trim() !== "" ? n : null;
}

export function isFree(entry) {
  const pricing = entry.pricing || {};
  if (price(pricing.prompt) !== 0 || price(pricing.completion) !== 0) return false;
  for (const key of ["request", "image", "internal_reasoning"]) {
    if (key in pricing && price(pricing[key]) !== 0) return false;
  }
  return true;
}

export function todayUtc(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

export function isExpired(entry, today) {
  const expires = entry.expiration_date;
  if (!expires) return false;
  const day = String(expires).slice(0, 10);
  if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(day)) return false;
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return false;
  return date.toISOString().slice(0, 10) <= today; // a model that ends today is already gone
}

export function isChatModel(entry) {
  const modelId = entry.id || "";
  if (!modelId || modelId.startsWith("~") || ROUTER_IDS.has(modelId)) return false;
  // Lyria generates music rather than text chat, even when catalog metadata says text output.
  if (/^google\/lyria[-/]/i.test(modelId)) return false;
  if (entry.alias_target) return false;

  const architecture = entry.architecture || {};
  if (architecture.tokenizer === "Router") return false;

  const inputs = architecture.input_modalities || [];
  const outputs = architecture.output_modalities || [];
  if (!inputs.includes("text") || !outputs.includes("text")) return false;

  const parameters = entry.supported_parameters || [];
  if (!["max_tokens", "max_completion_tokens"].some((name) => parameters.includes(name))) return false;

  const text = ((entry.name || "") + " " + (entry.description || "")).toLowerCase();
  if (NON_CHAT_HINTS.some((hint) => text.includes(hint))) return false;

  return true;
}

function roundHalfEven(x) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export function formatTokens(count) {
  if (count >= 1_000_000) return (count / 1_000_000).toFixed(2).replace(/0+$/, "").replace(/\.$/, "") + "M";
  if (count >= 1000) return roundHalfEven(count / 1000) + "K";
  return String(count);
}

function g(value) {
  return String(Number(value.toPrecision(6)));
}

export function formatParams(billions) {
  return billions >= 1000 ? g(billions / 1000) + "T" : g(billions) + "B";
}

export function cleanDescription(text) {
  text = (text || "").replace(MD_LINK, "$1").replace(/\s+/g, " ").trim();
  if ([...text].length > 240) {
    const cut = [...text].slice(0, 240).join("");
    const space = cut.lastIndexOf(" ");
    text = (space >= 0 ? cut.slice(0, space) : cut).replace(/[,;:]+$/, "") + "…";
  }
  return text;
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function buildModel(entry) {
  const modelId = entry.id;
  const author = modelId.split("/")[0];
  const fullName = entry.name || modelId;

  const sep = fullName.indexOf(": ");
  let provider = sep >= 0 ? fullName.slice(0, sep) : fullName;
  let rest = sep >= 0 ? fullName.slice(sep + 2) : "";
  if (!rest) {
    provider = author;
    rest = fullName;
  }
  const shortName = rest.replace(/\s*\(free\)\s*$/i, "").trim() || rest;

  const architecture = entry.architecture || {};
  const inputs = [...(architecture.input_modalities || [])];
  const parameters = entry.supported_parameters || [];
  const topProvider = entry.top_provider || {};

  const context = entry.context_length || topProvider.context_length || 0;
  let maxOutput = topProvider.max_completion_tokens;
  if (!Number.isInteger(maxOutput) || maxOutput <= 0) maxOutput = null;

  const [totalB, activeB, sizeSource] = parseSize(entry);
  let paramsLabel;
  if (totalB === null) paramsLabel = "Size not stated";
  else if (activeB !== null) paramsLabel = formatParams(totalB) + " total, " + formatParams(activeB) + " active";
  else paramsLabel = formatParams(totalB);

  const bench = (entry.benchmarks || {}).artificial_analysis || {};
  const score = isNumber(bench.intelligence_index) ? bench.intelligence_index : null;

  const created = entry.created;
  const createdDate = isNumber(created) && created > 0 ? new Date(created * 1000).toISOString().slice(0, 10) : null;

  const expires = entry.expiration_date ? String(entry.expiration_date).slice(0, 10) : null;

  return {
    id: modelId,
    name: shortName,
    full_name: fullName,
    provider,
    provider_key: author,
    host: "openrouter",
    host_label: "OpenRouter",
    description: cleanDescription(entry.description),
    context,
    context_label: formatTokens(context),
    max_output: maxOutput,
    max_output_label: maxOutput ? formatTokens(maxOutput) : null,
    params_total_b: totalB,
    params_active_b: activeB,
    params_label: paramsLabel,
    params_source: sizeSource,
    input: inputs,
    vision: inputs.includes("image"),
    audio: inputs.includes("audio"),
    video: inputs.includes("video"),
    reasoning: parameters.includes("reasoning") || parameters.includes("include_reasoning") ||
      (entry.reasoning !== null && typeof entry.reasoning === "object" && !Array.isArray(entry.reasoning)),
    tools: parameters.includes("tools"),
    intelligence: score,
    created: createdDate,
    expires,
    tiers: {
      context: contextTier(context),
      size: sizeTier(totalB),
      quality: qualityTier(score),
      input: inputTier(inputs),
      provider: author,
      host: "openrouter",
    },
    _details: (entry.links || {}).details || null,
  };
}

export function normalizeModels(rawEntries, today = todayUtc()) {
  const models = new Map();
  for (const entry of rawEntries || []) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || !entry.id) continue;
    if (!isFree(entry) || !isChatModel(entry) || isExpired(entry, today)) continue;
    models.set(entry.id, buildModel(entry));
  }
  const key = (m) => [m.provider.toLowerCase(), m.name.toLowerCase()];
  return [...models.values()].sort((a, b) => {
    const [ap, an] = key(a);
    const [bp, bn] = key(b);
    return ap < bp ? -1 : ap > bp ? 1 : an < bn ? -1 : an > bn ? 1 : 0;
  });
}

export function publicModel(model) {
  return Object.fromEntries(Object.entries(model).filter(([key]) => !key.startsWith("_")));
}

export function buildGroupings(models) {
  const groupings = {};
  for (const [name, config] of Object.entries(GROUPINGS)) {
    groupings[name] = {
      title: config.title,
      hint: config.hint,
      groups: config.groups.map(([key, label]) => ({ key, label })),
    };
  }

  const counts = new Map();
  const labels = new Map();
  for (const model of models) {
    const key = model.provider_key;
    counts.set(key, (counts.get(key) || 0) + 1);
    if (!labels.has(key)) labels.set(key, model.provider);
  }

  const ordered = [...counts.keys()].sort((a, b) => {
    if (counts.get(a) !== counts.get(b)) return counts.get(b) - counts.get(a);
    const la = labels.get(a).toLowerCase();
    const lb = labels.get(b).toLowerCase();
    return la < lb ? -1 : la > lb ? 1 : 0;
  });

  groupings.provider = {
    title: "Provider",
    hint: "The company behind the model",
    groups: ordered.map((key) => ({ key, label: labels.get(key) })),
  };

  const hostCounts = new Map();
  const hostLabels = new Map();
  for (const model of models) {
    const key = model.host || "openrouter";
    hostCounts.set(key, (hostCounts.get(key) || 0) + 1);
    if (!hostLabels.has(key)) hostLabels.set(key, model.host_label || "OpenRouter");
  }
  groupings.host = {
    title: "Host",
    hint: "The service Afterworld sends the chat to",
    groups: [...hostCounts.keys()]
      .sort((a, b) => hostCounts.get(b) - hostCounts.get(a) || (hostLabels.get(a) < hostLabels.get(b) ? -1 : 1))
      .map((key) => ({ key, label: hostLabels.get(key) })),
  };
  return groupings;
}
