// Unit tests for the catalog port. Expected values were produced by main.py's own
// functions, so these check that the Worker labels models exactly as the Azure app does.
import test from "node:test";
import assert from "node:assert/strict";
import { sizeFromDescription, sizeFromIdentifier, formatTokens, formatParams, normalizeModels, isFree, isExpired, isChatModel } from "../src/catalog.js";
import { parseWorkersAiModels } from "../src/providers.js";

test("excludes structured decision models from chat while retaining normal Workers AI models", () => {
  const names = ["@cf/cloudflare/clairic", "@cf/cloudflare/clef", "@cf/cloudflare/clef-omni", "@cf/cloudflare/clef-flash", "@cf/meta/llama-3.1-8b-instruct"];
  const list = names.map((name) => ({ name, task: { name: "Text Generation" }, properties: [] }));
  assert.deepEqual(parseWorkersAiModels(list).map((m) => m.id), ["workersai::@cf/meta/llama-3.1-8b-instruct"]);
});

test("filters paid-only Workers AI models on free plan and preserves vision/reasoning/LoRA-base properties", () => {
  const list = [
    { name: "@cf/deepseek-ai/deepseek-v4-pro-0813", task: { name: "Text Generation" }, properties: [{ property_id: "require_workers_paid", value: "true" }] },
    { name: "@cf/google/gemma-2b-it-lora", task: { name: "Text Generation" }, properties: [{ property_id: "lora", value: "true" }] },
    { name: "@cf/google/gemma-4-26b-a4b-it", task: { name: "Text Generation" }, properties: [{ property_id: "vision", value: "true" }, { property_id: "reasoning", value: "true" }, { property_id: "context_window", value: "256000" }] },
    { name: "@cf/qwen/qwq-32b", task: { name: "Text Generation" }, properties: [{ property_id: "lora", value: "true" }, { property_id: "reasoning", value: "true" }] },
  ];
  const freeModels = parseWorkersAiModels(list);
  assert.deepEqual(freeModels.map((m) => m.id), ["workersai::@cf/google/gemma-4-26b-a4b-it", "workersai::@cf/qwen/qwq-32b"]);
  assert.equal(freeModels[0].vision, true);
  assert.equal(freeModels[0].reasoning, true);
  assert.equal(freeModels[1].name, "QwQ 32B");
  const paidModels = parseWorkersAiModels(list, "2026-11-11", { paidPlan: true });
  assert.equal(paidModels.length, 3);
});

test("excludes music generation models even when catalog metadata says text", () => {
  const model = { id: "google/lyria-3-pro-preview", architecture: { input_modalities: ["text"], output_modalities: ["text"] }, supported_parameters: ["max_tokens"] };
  assert.equal(isChatModel(model), false);
  assert.equal(isChatModel({ ...model, id: "google/gemma-4" }), true);
});

const CASES = {
  "desc": [
    [
      "A 120B-parameter open model from OpenAI.",
      [
        120.0,
        null
      ]
    ],
    [
      "Mixture of experts with 30B total parameters and 3B active per token.",
      [
        30.0,
        3.0
      ]
    ],
    [
      "It has 5.1B active parameters out of 124B total.",
      [
        124.0,
        5.1
      ]
    ],
    [
      "Larger than the 70B model, this one is fast.",
      null
    ],
    [
      "Built on a 2.4 trillion-parameter base.",
      [
        2400.0,
        null
      ]
    ],
    [
      "124B total / 5.5B active MoE.",
      [
        124.0,
        5.5
      ]
    ],
    [
      "We introduce DeepSeek-V4.1-Flash, a multimodal model with 552B backbone parameters.",
      [
        552.0,
        null
      ]
    ],
    [
      "Nothing about size here. A great model.",
      null
    ]
  ],
  "ids": [
    [
      "qwen/qwen3-30b-a3b:free",
      [
        30.0,
        3.0
      ]
    ],
    [
      "meta-llama/llama-3.3-70b-instruct:free",
      [
        70.0,
        null
      ]
    ],
    [
      "google/gemma-3-4b-it:free",
      [
        4.0,
        null
      ]
    ],
    [
      "x/model-1t",
      [
        1000.0,
        null
      ]
    ],
    [
      "z/no-size",
      null
    ]
  ],
  "tokens": [
    [
      0,
      "0"
    ],
    [
      999,
      "999"
    ],
    [
      1000,
      "1K"
    ],
    [
      8500,
      "8K"
    ],
    [
      9500,
      "10K"
    ],
    [
      32768,
      "33K"
    ],
    [
      131072,
      "131K"
    ],
    [
      1000000,
      "1M"
    ],
    [
      1048576,
      "1.05M"
    ],
    [
      2000000,
      "2M"
    ]
  ],
  "params": [
    [
      7,
      "7B"
    ],
    [
      1.5,
      "1.5B"
    ],
    [
      30,
      "30B"
    ],
    [
      2400,
      "2.4T"
    ],
    [
      1000,
      "1T"
    ],
    [
      0.5,
      "0.5B"
    ]
  ]
};

test("sizes from descriptions match main.py", () => {
  for (const [text, expected] of CASES.desc) assert.deepEqual(sizeFromDescription(text), expected, text);
});

test("sizes from model ids match main.py", () => {
  for (const [id, expected] of CASES.ids) assert.deepEqual(sizeFromIdentifier(id.split(":")[0]), expected, id);
});

test("token and parameter labels match main.py", () => {
  for (const [n, expected] of CASES.tokens) assert.equal(formatTokens(n), expected, String(n));
  for (const [b, expected] of CASES.params) assert.equal(formatParams(b), expected, String(b));
});

test("free, expiry and router filtering", () => {
  assert.equal(isFree({ pricing: { prompt: "0", completion: "0" } }), true);
  assert.equal(isFree({ pricing: { prompt: "0", completion: "0", request: "0.01" } }), false);
  assert.equal(isExpired({ expiration_date: "2026-11-10" }, "2026-11-10"), true);
  assert.equal(isExpired({ expiration_date: "2026-11-11" }, "2026-11-10"), false);
  const base = { pricing: { prompt: "0", completion: "0" }, architecture: { input_modalities: ["text"], output_modalities: ["text"] }, supported_parameters: ["max_tokens"] };
  const list = normalizeModels([
    { ...base, id: "a/one", name: "A: One (free)" },
    { ...base, id: "openrouter/free", name: "Router" },
    { ...base, id: "b/guard", name: "B: Guard", description: "A content safety classifier." },
    { ...base, id: "c/old", name: "C: Old", expiration_date: "2020-01-01" },
  ], "2026-11-10");
  assert.deepEqual(list.map((m) => m.id), ["a/one"]);
  assert.equal(list[0].name, "One");
});
