import json
import os
import random
import re
import threading
import time
import urllib.parse
import urllib.request
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from typing import List, Literal

import openai
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from openai import OpenAI
from pydantic import BaseModel

load_dotenv()

app = FastAPI()

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

app.mount(
    "/static",
    StaticFiles(directory=STATIC_DIR),
    name="static"
)


@app.get("/")
def home():
    # no-store makes the browser load the latest index.html every time
    return FileResponse(
        STATIC_DIR / "index.html",
        headers={"Cache-Control": "no-store"}
    )


# max_retries=0 because we do our own retrying below
client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.getenv("OPENROUTER_API_KEY"),
    timeout=45.0,
    max_retries=0
)

# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

OPENROUTER_SITE = "https://openrouter.ai"
MODELS_URL = OPENROUTER_SITE + "/api/v1/models"

MODELS_TTL = 600          # seconds the free-model list is reused
REFRESH_MIN_AGE = 60      # the Refresh button can't hit OpenRouter more often than this
STATS_TTL = 90            # seconds the latency stats are reused
STATS_BUDGET = 12         # max seconds spent collecting latency stats
PROBE_TIMEOUT = 12        # max seconds to wait for a live "is it answering?" test
FASTEST_POOL = 3          # the random pick chooses among this many fastest models
PROBE_BATCH = 4           # models tested at the same time when there are no latency stats
THROTTLE_WINDOW = 600     # a model counts as rate limited for this long after a 429
MEASURED_FRESH = 300      # a live measurement newer than this is shown instead of OpenRouter's median
MEASURED_MAX_AGE = 1800   # live measurements are dropped after this long
AGENT_ONLY_TTL = 86400    # how long a model found to be "agent tools only" stays hidden before being re-checked

# Free-model limits from OpenRouter's documentation. They apply to the whole account,
# not to each model, and buying credits does not change the per-minute limit.
FREE_LIMITS = {
    "per_minute": 20,
    "per_day": 50,
    "per_day_with_credits": 1000,
    "credits_threshold": 10,
}

APP_VERSION = "2.0.0"

SYSTEM_PROMPT = "You are a helpful chatbot."
MAX_TOKENS_CAP = 4096     # longest reply we ask for (lower if the model's own limit is lower)
MAX_HISTORY = 20          # how many recent messages are sent to the model

MAX_IMAGES = 8                  # images accepted in one request
MAX_IMAGE_CHARS = 4_000_000     # size limit of one image, as a base64 data URL
IMAGE_URL = re.compile(r"data:image/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}")

FATAL_STATUSES = {401, 402}                          # would fail for every model
RETRY_STATUSES = {408, 429, 500, 502, 503, 504}      # worth trying the same model again
RETRY_WAITS = (1.5, 3.0)                             # seconds to wait between attempts
MAX_ATTEMPTS = 3

# Routers pick a different model each time, which is not what a fixed chat needs
ROUTER_IDS = {"openrouter/free", "openrouter/auto", "openrouter/bodybuilder"}

# Some free models answer a plain chat request with 403: they only work when called
# from inside an agentic tool (a coding agent, etc.), not from a normal chat request.
# Thinking Machines' Inkling models are the known case at the time of writing, so they
# are hidden from the start rather than waiting for someone to hit the error first.
# Anything else that turns out to behave the same way is detected and hidden automatically
# (see mark_agent_only below), and re-checked after AGENT_ONLY_TTL in case it is fixed.
KNOWN_AGENT_ONLY_IDS = {
    "thinkingmachines/inkling:free",
    "thinkingmachines/inkling-small:free",
    "thinkingmachines/inkling-2:free",
    "thinkingmachines/inkling-2-small:free",
}
AGENT_ONLY_HINTS = (
    "agentic harness",
    "agentic harnesses",
    "only available on",
    "coding agent or productivity app",
)

# Free models that are not general chat models (guardrails and similar)
NON_CHAT_HINTS = (
    "content safety",
    "guardrail model",
    "guard model",
    "safety classifier",
    "reranker",
    "embedding model",
)

# ---------------------------------------------------------------------------
# Categories. Every value comes from the OpenRouter API, nothing is hard coded
# per model. Only the band boundaries below are our choice.
# ---------------------------------------------------------------------------

GROUPINGS = {
    "context": {
        "title": "Context window",
        "hint": "How much text a model can read at once, in tokens",
        "groups": [
            ("1m", "1M+ tokens"),
            ("200k", "200K to 1M tokens"),
            ("100k", "100K to 200K tokens"),
            ("32k", "32K to 100K tokens"),
            ("small", "Under 32K tokens"),
        ],
    },
    "size": {
        "title": "Model size",
        "hint": "Total parameters, only where the model itself states them",
        "groups": [
            ("500b", "500B and up"),
            ("200b", "200B to 500B"),
            ("50b", "50B to 200B"),
            ("10b", "10B to 50B"),
            ("small", "Under 10B"),
            ("unknown", "Size not stated"),
        ],
    },
    "quality": {
        "title": "Benchmark score",
        "hint": "Artificial Analysis Intelligence Index, as reported by OpenRouter",
        "groups": [
            ("40", "40 and above"),
            ("30", "30 to 40"),
            ("20", "20 to 30"),
            ("low", "Under 20"),
            ("none", "Not benchmarked yet"),
        ],
    },
    "input": {
        "title": "Input types",
        "hint": "What you can send to the model",
        "groups": [
            ("multimodal", "Multimodal (audio or video)"),
            ("vision", "Text and images"),
            ("text", "Text only"),
        ],
    },
}


def context_tier(tokens):
    if tokens >= 1_000_000:
        return "1m"
    if tokens >= 200_000:
        return "200k"
    if tokens >= 100_000:
        return "100k"
    if tokens >= 32_000:
        return "32k"
    return "small"


def size_tier(total_b):
    if total_b is None:
        return "unknown"
    if total_b >= 500:
        return "500b"
    if total_b >= 200:
        return "200b"
    if total_b >= 50:
        return "50b"
    if total_b >= 10:
        return "10b"
    return "small"


def quality_tier(score):
    if score is None:
        return "none"
    if score >= 40:
        return "40"
    if score >= 30:
        return "30"
    if score >= 20:
        return "20"
    return "low"


def input_tier(inputs):
    if "audio" in inputs or "video" in inputs:
        return "multimodal"
    if "image" in inputs:
        return "vision"
    return "text"


# ---------------------------------------------------------------------------
# Parameter counts. OpenRouter does not publish a parameter field, so we only
# use sizes that the model itself states: in its id, in its Hugging Face repo
# name, or in the first sentences of its OpenRouter description. Otherwise the
# size is reported as "not stated" and never guessed.
# ---------------------------------------------------------------------------

_TOKEN_TOTAL = re.compile(r"^(\d+(?:\.\d+)?)([bt])$")
_TOKEN_ACTIVE = re.compile(r"^a(\d+(?:\.\d+)?)([bt])$")

_NU = r"(\d+(?:\.\d+)?)[- ]?(billion|trillion|B|T)\b"

# (pattern, order of the captured numbers)
_PAIRED_PATTERNS = [
    # "5.1B active parameters out of 124B total"
    (re.compile(_NU + r"\s+(?i:active\s+param\w*\s+(?:out\s+of|of)\s+(?:the\s+|a\s+)?)" + _NU + r"\s+(?i:total)"),
     "active_total"),
    # "30B total parameters and 3B active", "118B total parameter model with 8B active"
    (re.compile(_NU + r"\s+(?i:total\s+param\w*)(?:\s+\w+){0,2}?\s*(?:,|(?i:and|with))\s*" + _NU + r"\s+(?i:active)"),
     "total_active"),
    # "124B total / 5.5B active"
    (re.compile(_NU + r"\s+(?i:total)\s*/\s*" + _NU + r"\s+(?i:active)"), "total_active"),
    # "33B-A3B"
    (re.compile(r"(\d+(?:\.\d+)?)(B|T)-A(\d+(?:\.\d+)?)(B|T)\b"), "total_active"),
]

# Only accepted from the first sentence of the description
_TOTAL_ONLY_PATTERNS = [
    # "120B-parameter", "12-billion-parameter", "2.4 trillion-parameter"
    re.compile(_NU + r"[- ](?i:param)"),
    # "2.4 trillion total parameters", "552B backbone parameters"
    re.compile(_NU + r"\s+(?i:(?:total|backbone)\s+param)"),
]

_COMPARISON_WORDS = (
    "than", "outperform", "compared", "versus", " vs", "rival",
    "larger", "smaller", "beats", "surpass",
)


def _to_billions(number, unit):
    value = float(number)
    return value * 1000 if unit.lower() in ("t", "trillion") else value


def _sane(total, active):
    if total is None or total <= 0 or total > 100_000:
        return None
    if active is not None and not (0 < active < total):
        active = None
    return total, active


def size_from_identifier(text):
    """Read a size such as 30b-a3b out of a model id or a Hugging Face repo name."""
    totals = set()
    actives = set()

    for token in re.split(r"[^a-z0-9.]+", text.lower()):
        match = _TOKEN_TOTAL.match(token)
        if match:
            totals.add(_to_billions(*match.groups()))
        match = _TOKEN_ACTIVE.match(token)
        if match:
            actives.add(_to_billions(*match.groups()))

    if len(totals) != 1:
        return None

    total = next(iter(totals))
    active = next(iter(actives)) if len(actives) == 1 else None
    return _sane(total, active)


def _sentences(text):
    return re.split(r"(?<=[.!?])\s+(?=[A-Z])", text.strip())


def _is_comparison(text, start):
    before = text[max(0, start - 40):start].lower()
    return any(word in before for word in _COMPARISON_WORDS)


def size_from_description(description):
    """Read a stated size from the first sentences of the description."""
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", description or "")
    sentences = _sentences(text)
    if not sentences:
        return None

    early = " ".join(sentences[:3])

    for pattern, order in _PAIRED_PATTERNS:
        for match in pattern.finditer(early):
            if _is_comparison(early, match.start()):
                continue

            groups = match.groups()
            if len(groups) == 4:
                first = _to_billions(groups[0], groups[1])
                second = _to_billions(groups[2], groups[3])
            else:
                continue

            if order == "active_total":
                active, total = first, second
            else:
                total, active = first, second

            result = _sane(total, active)
            if result:
                return result

    for pattern in _TOTAL_ONLY_PATTERNS:
        match = pattern.search(sentences[0])
        if match and not _is_comparison(sentences[0], match.start()):
            result = _sane(_to_billions(*match.groups()), None)
            if result:
                return result

    return None


def parse_size(entry):
    """Returns (total_b, active_b, source) or (None, None, None)."""
    slug = (entry.get("id") or "").split(":")[0]

    for source, text in (("id", slug), ("weights", entry.get("hugging_face_id") or "")):
        found = size_from_identifier(text)
        if found:
            return found[0], found[1], source

    found = size_from_description(entry.get("description") or "")
    if found:
        return found[0], found[1], "description"

    return None, None, None


# ---------------------------------------------------------------------------
# Turning OpenRouter's raw model list into our free chat-model catalog
# ---------------------------------------------------------------------------

def _price(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def is_free(entry):
    pricing = entry.get("pricing") or {}

    if _price(pricing.get("prompt")) != 0 or _price(pricing.get("completion")) != 0:
        return False

    for key in ("request", "image", "internal_reasoning"):
        if key in pricing and _price(pricing[key]) != 0:
            return False

    return True


def is_expired(entry, today):
    expires = entry.get("expiration_date")
    if not expires:
        return False
    try:
        # A model that ends today is treated as already gone
        return datetime.strptime(str(expires)[:10], "%Y-%m-%d").date() <= today
    except ValueError:
        return False


def is_chat_model(entry):
    model_id = entry.get("id") or ""
    if not model_id or model_id.startswith("~") or model_id in ROUTER_IDS:
        return False
    if re.match(r"^google/lyria[-/]", model_id, re.I):
        return False
    if entry.get("alias_target"):
        return False

    architecture = entry.get("architecture") or {}
    if architecture.get("tokenizer") == "Router":
        return False

    inputs = architecture.get("input_modalities") or []
    outputs = architecture.get("output_modalities") or []
    if "text" not in inputs or "text" not in outputs:
        return False

    parameters = entry.get("supported_parameters") or []
    if not any(name in parameters for name in ("max_tokens", "max_completion_tokens")):
        return False

    text = ((entry.get("name") or "") + " " + (entry.get("description") or "")).lower()
    if any(hint in text for hint in NON_CHAT_HINTS):
        return False

    return True


def format_tokens(count):
    if count >= 1_000_000:
        return ("%.2f" % (count / 1_000_000)).rstrip("0").rstrip(".") + "M"
    if count >= 1000:
        return "%dK" % round(count / 1000)
    return str(count)


def format_params(billions):
    if billions >= 1000:
        return "%gT" % (billions / 1000)
    return "%gB" % billions


def clean_description(text):
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text or "")
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > 240:
        text = text[:240].rsplit(" ", 1)[0].rstrip(",;:") + "…"
    return text


def build_model(entry):
    model_id = entry["id"]
    author = model_id.split("/")[0]
    full_name = entry.get("name") or model_id

    provider, _, rest = full_name.partition(": ")
    if not rest:
        provider, rest = author, full_name
    short_name = re.sub(r"\s*\(free\)\s*$", "", rest, flags=re.I).strip() or rest

    architecture = entry.get("architecture") or {}
    inputs = list(architecture.get("input_modalities") or [])
    parameters = entry.get("supported_parameters") or []
    top_provider = entry.get("top_provider") or {}

    context = entry.get("context_length") or top_provider.get("context_length") or 0
    max_output = top_provider.get("max_completion_tokens")
    if not isinstance(max_output, int) or max_output <= 0:
        max_output = None

    total_b, active_b, size_source = parse_size(entry)
    if total_b is None:
        params_label = "Size not stated"
    elif active_b is not None:
        params_label = "%s total, %s active" % (format_params(total_b), format_params(active_b))
    else:
        params_label = format_params(total_b)

    benchmarks = (entry.get("benchmarks") or {}).get("artificial_analysis") or {}
    score = benchmarks.get("intelligence_index")
    score = float(score) if isinstance(score, (int, float)) and not isinstance(score, bool) else None

    created = entry.get("created")
    created_date = None
    if isinstance(created, (int, float)) and created > 0:
        created_date = datetime.fromtimestamp(created, tz=timezone.utc).strftime("%Y-%m-%d")

    expires = entry.get("expiration_date")
    expires = str(expires)[:10] if expires else None

    return {
        "id": model_id,
        "name": short_name,
        "full_name": full_name,
        "provider": provider,
        "provider_key": author,
        "description": clean_description(entry.get("description")),
        "context": context,
        "context_label": format_tokens(context),
        "max_output": max_output,
        "max_output_label": format_tokens(max_output) if max_output else None,
        "params_total_b": total_b,
        "params_active_b": active_b,
        "params_label": params_label,
        "params_source": size_source,
        "input": inputs,
        "vision": "image" in inputs,
        "audio": "audio" in inputs,
        "video": "video" in inputs,
        "reasoning": ("reasoning" in parameters or "include_reasoning" in parameters
                      or isinstance(entry.get("reasoning"), dict)),
        "tools": "tools" in parameters,
        "intelligence": score,
        "created": created_date,
        "expires": expires,
        "tiers": {
            "context": context_tier(context),
            "size": size_tier(total_b),
            "quality": quality_tier(score),
            "input": input_tier(inputs),
            "provider": author,
        },
        "_details": (entry.get("links") or {}).get("details"),
    }


def normalize_models(raw_entries, today=None):
    """Keep only free, currently available chat models."""
    today = today or datetime.now(timezone.utc).date()
    models = {}

    for entry in raw_entries:
        if not isinstance(entry, dict) or not entry.get("id"):
            continue
        if not is_free(entry) or not is_chat_model(entry) or is_expired(entry, today):
            continue
        models[entry["id"]] = build_model(entry)

    return sorted(models.values(), key=lambda m: (m["provider"].lower(), m["name"].lower()))


def public_model(model):
    return {key: value for key, value in model.items() if not key.startswith("_")}


def build_groupings(models):
    groupings = {
        name: {
            "title": config["title"],
            "hint": config["hint"],
            "groups": [{"key": key, "label": label} for key, label in config["groups"]],
        }
        for name, config in GROUPINGS.items()
    }

    counts = {}
    labels = {}
    for model in models:
        key = model["provider_key"]
        counts[key] = counts.get(key, 0) + 1
        labels.setdefault(key, model["provider"])

    ordered = sorted(counts, key=lambda key: (-counts[key], labels[key].lower()))
    groupings["provider"] = {
        "title": "Provider",
        "hint": "The company behind the model",
        "groups": [{"key": key, "label": labels[key]} for key in ordered],
    }
    return groupings


# ---------------------------------------------------------------------------
# Talking to the OpenRouter web API (cached)
# ---------------------------------------------------------------------------

class CatalogError(Exception):
    pass


class ModelUnavailable(Exception):
    def __init__(self, message):
        super().__init__(message)
        self.message = message


_state = {"models": [], "by_id": {}, "fetched_at": 0.0, "stats": {}, "stats_at": 0.0}
_lock = threading.Lock()
_stats_lock = threading.Lock()

_observed = {}       # model id -> what this server has seen itself: last measured speed, last 429
_stat_urls = {}      # model id -> the endpoints URL that worked last time
_requests = deque()  # when this server sent requests to free models (for the usage counter)
_agent_only = {}     # model id -> {"reason": str, "at": timestamp} for models that need an agentic tool


def fetch_json(url, timeout=15, auth=False):
    headers = {"Accept": "application/json", "User-Agent": "Afterworld/1.0"}

    key = os.getenv("OPENROUTER_API_KEY")
    if auth and key:
        headers["Authorization"] = "Bearer " + key

    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def load_catalog(force=False):
    """Fetch the free-model list, reusing the cached copy while it is fresh."""
    with _lock:
        age = time.time() - _state["fetched_at"]
        have = bool(_state["models"])
        if have and age < MODELS_TTL and not (force and age >= REFRESH_MIN_AGE):
            return

    try:
        payload = fetch_json(MODELS_URL, timeout=20)
        models = normalize_models(payload.get("data") or [])
        if not models:
            raise ValueError("OpenRouter returned no free chat models")
    except Exception as error:
        print("[Afterworld] Could not refresh the model list:", error)
        if have:
            return   # keep showing the older list
        raise CatalogError(
            "Couldn't load the free-model list from OpenRouter. "
            "Check your internet connection and try again."
        )

    with _lock:
        _state["models"] = models
        _state["by_id"] = {model["id"]: model for model in models}
        _state["fetched_at"] = time.time()


def list_models():
    hidden = agent_only_ids()
    with _lock:
        return [model for model in _state["models"] if model["id"] not in hidden]


def find_model(model_id):
    with _lock:
        return _state["by_id"].get(model_id)


# ---------------------------------------------------------------------------
# Latency stats and the random "fast model" pick
# ---------------------------------------------------------------------------

def _endpoints_of(payload):
    data = payload.get("data") if isinstance(payload, dict) else None
    if isinstance(data, dict):
        data = data.get("endpoints")
    return [item for item in (data or []) if isinstance(item, dict)]


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def endpoint_urls(model):
    urls = [OPENROUTER_SITE + "/api/v1/models/" + urllib.parse.quote(model["id"], safe="/:") + "/endpoints"]
    if model.get("_details"):
        urls.append(OPENROUTER_SITE + model["_details"])
    urls = list(dict.fromkeys(urls))

    # start with the URL that worked last time
    remembered = _stat_urls.get(model["id"])
    if remembered in urls:
        urls.remove(remembered)
        urls.insert(0, remembered)

    return urls


def fetch_model_stats(model):
    """What OpenRouter reports about the model's free endpoints. Any of it can be unknown."""
    for url in endpoint_urls(model):
        try:
            payload = fetch_json(url, timeout=8, auth=True)
        except Exception:
            continue

        free = [ep for ep in _endpoints_of(payload) if is_free({"pricing": ep.get("pricing")})]
        if not free:
            continue

        _stat_urls[model["id"]] = url

        latencies = []
        uptimes = []
        healthy = False

        for ep in free:
            status = _number(ep.get("status"))
            uptime = _number(ep.get("uptime_last_30m"))

            if uptime is not None:
                uptimes.append(uptime)

            if (status is not None and status < 0) or (uptime is not None and uptime < 50):
                continue

            healthy = True
            p50 = _number((ep.get("latency_last_30m") or {}).get("p50"))
            if p50 is not None and p50 > 0:
                latencies.append(p50)

        return {
            "raw_latency": min(latencies) if latencies else None,
            "healthy": healthy,
            "uptime": max(uptimes) if uptimes else None,
            "known": True,
        }

    return {"raw_latency": None, "healthy": True, "uptime": None, "known": False}   # unknown, not held against the model


def refresh_stats(models):
    with _stats_lock:
        with _lock:
            if _state["stats"] and time.time() - _state["stats_at"] < STATS_TTL:
                return dict(_state["stats"])

        results = {}
        pool = ThreadPoolExecutor(max_workers=12)
        futures = {pool.submit(fetch_model_stats, model): model["id"] for model in models}

        try:
            for future in as_completed(futures, timeout=STATS_BUDGET):
                try:
                    results[futures[future]] = future.result()
                except Exception:
                    pass
        except Exception:
            pass   # out of time, use what we have
        finally:
            for future in futures:
                future.cancel()
            pool.shutdown(wait=False)

        # OpenRouter's docs call these numbers milliseconds, but their examples look like seconds.
        # Decide from the data itself: a hosted model never answers in under 60 ms and never
        # takes a full minute to start, so a median below 60 means seconds.
        raws = [r["raw_latency"] for r in results.values() if r.get("raw_latency") is not None]
        factor = 1000.0 if raws and median(raws) < 60 else 1.0

        for result in results.values():
            raw = result.pop("raw_latency", None)
            result["latency"] = None if raw is None else round(raw * factor)

        with _lock:
            _state["stats"] = results
            _state["stats_at"] = time.time()

        return dict(results)


# ---------------------------------------------------------------------------
# What this server has seen itself (speed of real replies, 429s, request counts)
# ---------------------------------------------------------------------------

def record_request():
    with _lock:
        _requests.append(time.time())


def record_success(model_id, ms):
    now = time.time()
    with _lock:
        _observed.setdefault(model_id, {}).update(ms=ms, at=now, ok_at=now)


def record_throttle(model_id):
    with _lock:
        _observed.setdefault(model_id, {})["throttled_at"] = time.time()


def is_upstream_limit(message):
    """True for a 429 from the model's own provider; False for our OpenRouter account limit."""
    text = (message or "").lower()
    return "upstream" in text or "rate-limited" in text


def is_agent_only(message):
    text = (message or "").lower()
    return any(hint in text for hint in AGENT_ONLY_HINTS)


def mark_agent_only(model_id, reason):
    with _lock:
        _agent_only[model_id] = {"reason": reason, "at": time.time()}
    print("[Afterworld] %s looks like it only works inside an agentic tool, hiding it: %s"
          % (model_id, reason))


def agent_only_ids():
    """Ids currently hidden for being agent-tool-only, dropping entries old enough to re-check."""
    now = time.time()
    with _lock:
        stale = [mid for mid, info in _agent_only.items() if now - info["at"] > AGENT_ONLY_TTL]
        for mid in stale:
            del _agent_only[mid]
        return set(_agent_only)


def agent_only_reason(model_id):
    with _lock:
        info = _agent_only.get(model_id)
        return info["reason"] if info else None


def seed_known_agent_only():
    for model_id in KNOWN_AGENT_ONLY_IDS:
        with _lock:
            _agent_only.setdefault(model_id, {"reason": "Known to only work inside an agentic tool.", "at": time.time()})


seed_known_agent_only()


def usage_snapshot(now=None):
    now = now or time.time()
    midnight = now - (now % 86400)   # start of the current UTC day

    with _lock:
        while _requests and _requests[0] < now - 86400:
            _requests.popleft()
        minute = sum(1 for moment in _requests if moment > now - 60)
        day = sum(1 for moment in _requests if moment >= midnight)

    return {"minute": minute, "day": day}


def live_info(stat, obs, now):
    """Combine OpenRouter's stats with what this server has measured."""
    known = bool(stat and stat.get("known"))
    healthy = stat.get("healthy", True) if stat else True

    throttled_at = obs.get("throttled_at")
    ok_at = obs.get("ok_at")
    recently_throttled = bool(throttled_at and now - throttled_at < THROTTLE_WINDOW)

    if recently_throttled and (not ok_at or ok_at < throttled_at):
        state = "throttled"
    elif known and not healthy:
        state = "degraded"
    elif known or (ok_at and now - ok_at < MEASURED_MAX_AGE):
        state = "healthy"
    else:
        state = "unknown"

    stat_ms = stat.get("latency") if stat else None
    measured_ms = obs.get("ms")
    measured_age = now - obs["at"] if obs.get("at") is not None else None
    measured_ok = measured_ms is not None and measured_age is not None and measured_age < MEASURED_MAX_AGE

    if measured_ok and measured_age < MEASURED_FRESH:
        source, ms, age = "measured", measured_ms, measured_age
    elif stat_ms is not None:
        source, ms, age = "openrouter", stat_ms, None
    elif measured_ok:
        source, ms, age = "measured", measured_ms, measured_age
    else:
        source, ms, age = None, None, None

    return {
        "state": state,
        "latency_ms": ms,
        "latency_source": source,
        "latency_age_s": None if age is None else round(age),
        "uptime": stat.get("uptime") if stat else None,
        "throttled_age_s": round(now - throttled_at) if recently_throttled else None,
    }


def first_output(chunk):
    if not chunk.choices:
        return False
    delta = chunk.choices[0].delta
    return bool(getattr(delta, "content", None) or getattr(delta, "reasoning", None))


def probe_model(model_id):
    """Send a tiny request and time how long the first output takes."""
    record_request()
    started = time.monotonic()
    stream = None

    try:
        stream = client.with_options(timeout=PROBE_TIMEOUT).chat.completions.create(
            model=model_id,
            messages=[{"role": "user", "content": "Say hi."}],
            max_tokens=16,
            stream=True
        )

        for chunk in stream:
            if first_output(chunk):
                ms = round((time.monotonic() - started) * 1000)
                record_success(model_id, ms)
                return {"ok": True, "ms": ms}

        return {"ok": False}

    except Exception as error:
        status = getattr(error, "status_code", None)
        upstream_message = getattr(error, "message", "") or str(error)
        print("[Afterworld] probe of %s failed (%s): %s"
              % (model_id, status or type(error).__name__, upstream_message))

        if status == 429:
            record_throttle(model_id)
            return {"ok": False, "throttled": True, "upstream": is_upstream_limit(upstream_message)}

        if status == 403 and is_agent_only(upstream_message):
            mark_agent_only(model_id, upstream_message)
            return {"ok": False, "agent_only": True}

        return {"ok": False}

    finally:
        if stream is not None:
            try:
                stream.close()
            except Exception:
                pass


def probe_many(models):
    results = {}
    pool = ThreadPoolExecutor(max_workers=max(1, len(models)))
    futures = {pool.submit(probe_model, model["id"]): model["id"] for model in models}

    try:
        for future in as_completed(futures, timeout=PROBE_TIMEOUT + 5):
            try:
                results[futures[future]] = future.result()
            except Exception:
                pass
    except Exception:
        pass
    finally:
        pool.shutdown(wait=False)

    return results


def pick_random_fast():
    """A random free model from the fastest ones that are answering right now."""
    load_catalog()
    models = list_models()
    stats = refresh_stats(models)

    def info(model):
        return stats.get(model["id"]) or {"latency": None, "healthy": True}

    healthy = [m for m in models if info(m)["healthy"]] or models
    ranked = sorted((m for m in healthy if info(m)["latency"] is not None),
                    key=lambda m: info(m)["latency"])

    tried = set()

    if ranked:
        pool = ranked[:FASTEST_POOL]
        random.shuffle(pool)
        order = pool + ranked[FASTEST_POOL:FASTEST_POOL + 3]

        for model in order:
            tried.add(model["id"])
            result = probe_model(model["id"])
            if result["ok"]:
                note = ("Picked at random from the %d fastest free models by OpenRouter's recent "
                        "latency stats, and confirmed just now (%d ms to first output)."
                        % (len(pool), result["ms"]))
                return model, result["ms"], "stats", note

    remaining = [m for m in healthy if m["id"] not in tried]
    random.shuffle(remaining)

    for start in range(0, min(len(remaining), PROBE_BATCH * 2), PROBE_BATCH):
        batch = remaining[start:start + PROBE_BATCH]
        results = probe_many(batch)
        working = [(results[m["id"]]["ms"], m) for m in batch
                   if results.get(m["id"], {}).get("ok")]

        if working:
            ms, model = min(working, key=lambda item: item[0])
            note = ("OpenRouter's latency stats weren't available, so %d random free models were "
                    "tested live and this one answered fastest (%d ms to first output)."
                    % (len(batch), ms))
            return model, ms, "probe", note

    raise ModelUnavailable(
        "None of the free models answered right now (they may all be rate limited). "
        "Wait a minute and try again, or pick one from the list."
    )


# ---------------------------------------------------------------------------
# API routes for the dashboard
# ---------------------------------------------------------------------------

@app.get("/api/models")
def api_models(refresh: int = 0):
    try:
        load_catalog(force=bool(refresh))
    except CatalogError as error:
        raise HTTPException(status_code=502, detail=str(error))

    hidden = agent_only_ids()
    with _lock:
        fetched_at = _state["fetched_at"]
        all_ids = {model["id"] for model in _state["models"]}

    models = list_models()

    return {
        "models": [public_model(model) for model in models],
        "groupings": build_groupings(models),
        "count": len(models),
        "fetched_at": datetime.fromtimestamp(fetched_at, tz=timezone.utc).isoformat(),
        "source": MODELS_URL,
        "version": APP_VERSION,
        "excluded_agent_only": len(hidden & all_ids),
        "limits": dict(FREE_LIMITS),
    }


@app.post("/api/random-model")
def api_random_model():
    try:
        model, ms, mode, note = pick_random_fast()
    except CatalogError as error:
        raise HTTPException(status_code=502, detail=str(error))
    except ModelUnavailable as error:
        raise HTTPException(status_code=503, detail=error.message)

    return {"model": public_model(model), "measured_ms": ms, "mode": mode, "note": note}


class ProbeRequest(BaseModel):
    model: str


def iso(timestamp):
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat()


def _build_provider_status(models, stats, observed, now):
    usage = usage_snapshot(now)
    fastest_obs = [
        m for m in models
        if observed.get(m["id"], {}).get("at", 0) > now - MEASURED_MAX_AGE
        and observed.get(m["id"], {}).get("ms") is not None
    ]
    fastest_obs.sort(key=lambda m: observed[m["id"]]["ms"])
    fastest = None
    if fastest_obs:
        top = fastest_obs[0]
        fastest = {
            "id": top["id"],
            "name": top["name"],
            "latency_ms": observed[top["id"]]["ms"],
            "source": "measured",
            "age_s": max(0, round(now - observed[top["id"]]["at"])),
        }
    else:
        stat_candidates = [
            m for m in models
            if (stats.get(m["id"]) or {}).get("healthy", True)
            and (stats.get(m["id"]) or {}).get("latency") is not None
        ]
        stat_candidates.sort(key=lambda m: stats[m["id"]]["latency"])
        if stat_candidates:
            top = stat_candidates[0]
            fastest = {
                "id": top["id"],
                "name": top["name"],
                "latency_ms": stats[top["id"]]["latency"],
                "source": "openrouter",
                "age_s": None,
            }

    healthy_count = 0
    throttled_count = 0
    for m in models:
        st = live_info(stats.get(m["id"]), observed.get(m["id"], {}), now)["state"]
        if st == "throttled":
            throttled_count += 1
        elif st == "healthy":
            healthy_count += 1

    return [{
        "key": "openrouter",
        "name": "OpenRouter",
        "limit_per_min": FREE_LIMITS["per_minute"],
        "limit_per_day": None,
        "scope": "account",
        "quota_label": "20 req/min shared (:free)",
        "source": "https://openrouter.ai/collections/free-models/",
        "model_count": len(models),
        "healthy_count": healthy_count,
        "throttled_count": throttled_count,
        "usage": {
            "minute": usage["minute"],
            "day": usage["day"],
            "free_minute": usage["minute"],
        },
        "models": {},
        "fastest": fastest,
    }]


@app.get("/api/status")
def api_status():
    try:
        load_catalog()
    except CatalogError as error:
        raise HTTPException(status_code=502, detail=str(error))

    models = list_models()
    now = time.time()
    with _lock:
        observed = {key: dict(value) for key, value in _observed.items()}
        stats = dict(_state["stats"])

    return {
        "providers": _build_provider_status(models, stats, observed, now),
        "updated_at": iso(now),
    }


@app.get("/api/live")
def api_live():
    """Live numbers for the dashboard: speed and health per model, plus our request counter."""
    try:
        load_catalog()
    except CatalogError as error:
        raise HTTPException(status_code=502, detail=str(error))

    hidden = agent_only_ids()
    models = list_models()
    stats = refresh_stats(models)
    now = time.time()

    with _lock:
        observed = {key: dict(value) for key, value in _observed.items()}
        stats_at = _state["stats_at"]
        all_ids = {model["id"] for model in _state["models"]}

    return {
        "updated_at": iso(now),
        "stats_at": iso(stats_at) if stats_at else None,
        "models": {
            model["id"]: live_info(stats.get(model["id"]), observed.get(model["id"], {}), now)
            for model in models
        },
        "providers": _build_provider_status(models, stats, observed, now),
        "usage": usage_snapshot(now),
        "limits": dict(FREE_LIMITS),
        "catalog_count": len(models),
        "excluded_agent_only": len(hidden & all_ids),
        "excluded_paid": 0,
        "version": APP_VERSION,
    }


@app.post("/api/probe")
def api_probe(data: ProbeRequest):
    """Test one model right now. This sends one small request, which counts toward the free limit."""
    model = require_free_model(data.model)
    result = probe_model(model["id"])

    if result["ok"]:
        message = "%s answered in %d ms." % (model["name"], result["ms"])
    elif result.get("agent_only"):
        message = model["name"] + " only works inside an agentic tool, so it has been removed from the list."
    elif result.get("throttled"):
        message = (
            (model["name"] + "'s provider is rate limited right now.")
            if result.get("upstream")
            else account_limit_sentence()
        )
    else:
        message = model["name"] + " didn't answer."

    return {
        "ok": result["ok"],
        "ms": result.get("ms"),
        "throttled": bool(result.get("throttled")),
        "agent_only": bool(result.get("agent_only")),
        "message": message,
    }


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------

class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str = ""
    images: List[str] = []      # images attached to a user message, as data URLs


class ChatRequest(BaseModel):
    model: str
    messages: List[Message]
    system: str = ""


def message_content(text, images):
    """Plain text, or text plus images in the format OpenRouter expects."""
    if not images:
        return text

    parts = []
    if text:
        parts.append({"type": "text", "text": text})
    for url in images:
        parts.append({"type": "image_url", "image_url": {"url": url}})
    return parts


def build_messages(items, custom_system=""):
    """Turn the chat history sent by the browser into a clean message list."""
    cleaned = []

    for item in items:
        text = item.content.strip()
        images = list(getattr(item, "images", None) or []) if item.role == "user" else []

        if not text and not images:
            continue

        # Some models reject two messages in a row from the same role, so merge them
        if cleaned and cleaned[-1]["role"] == item.role:
            previous = cleaned[-1]
            previous["text"] = "\n\n".join(part for part in (previous["text"], text) if part)
            previous["images"].extend(images)
        else:
            cleaned.append({"role": item.role, "text": text, "images": images})

    cleaned = cleaned[-MAX_HISTORY:]

    # The conversation must start with a user message
    while cleaned and cleaned[0]["role"] != "user":
        cleaned.pop(0)

    prompt = (custom_system or "").strip()[:2000] or SYSTEM_PROMPT
    messages = [{"role": "system", "content": prompt}]
    for entry in cleaned:
        messages.append({
            "role": entry["role"],
            "content": message_content(entry["text"], entry["images"])
        })

    return messages


def merge_system(messages):
    """For models that refuse a system message: put it inside the first user message."""
    system = messages[0]["content"]
    rest = [dict(message) for message in messages[1:]]

    if rest and rest[0]["role"] == "user":
        content = rest[0]["content"]

        if isinstance(content, list):
            rest[0]["content"] = [{"type": "text", "text": system}] + content
        else:
            rest[0]["content"] = system + "\n\n" + content

    return rest


def check_images(items, model):
    """Images are only allowed for models that accept image input, and only real image data URLs."""
    urls = []
    for item in items:
        if item.role == "user":
            urls.extend(getattr(item, "images", None) or [])

    if not urls:
        return

    if not model.get("vision"):
        raise HTTPException(
            status_code=400,
            detail=model["name"] + " doesn't accept images. Choose a model with image input."
        )

    if len(urls) > MAX_IMAGES:
        raise HTTPException(status_code=400, detail="Too many images in one request.")

    for url in urls:
        if len(url) > MAX_IMAGE_CHARS or not IMAGE_URL.fullmatch(url):
            raise HTTPException(
                status_code=400,
                detail="One of the images isn't a valid PNG, JPEG, WebP or GIF, or it is too large."
            )


def account_limit_criteria():
    """The bare numbers, e.g. '20 requests a minute and 50 a day (1,000 once you've bought $10 of credits)'."""
    return (
        "%d requests a minute and %d a day (%s once you've bought $%d of credits)"
        % (FREE_LIMITS["per_minute"], FREE_LIMITS["per_day"],
           "{:,} a day".format(FREE_LIMITS["per_day_with_credits"]), FREE_LIMITS["credits_threshold"])
    )


def account_limit_sentence():
    """A full sentence for when this limit itself is the news, e.g. after hitting it."""
    return "You've hit OpenRouter's free-tier limit: " + account_limit_criteria() + ". That limit is shared by every free model."


def describe_error(error, name="This model"):
    status = getattr(error, "status_code", None)
    message = getattr(error, "message", "") or str(error)

    if status == 403 and is_agent_only(message):
        return (
            name + " only works inside an agentic tool (like a coding agent), not in a normal "
            "chat, so it has been removed from the model list. Choose another model."
        )
    if status == 429:
        if is_upstream_limit(message):
            return (
                name + "'s provider is rate limited right now, separately from your own "
                "OpenRouter usage. Try again shortly, choose another model, or add your own "
                "provider key at openrouter.ai/settings/integrations."
            )
        return account_limit_sentence() + " Wait a bit, or choose another model."
    if status == 401:
        return "OpenRouter rejected the API key. Check OPENROUTER_API_KEY in your .env file."
    if status == 402:
        return "This OpenRouter account has no credits left for that model."
    if status == 404:
        return name + " isn't available on OpenRouter any more. Choose another model."
    if isinstance(error, openai.APITimeoutError):
        return name + " took too long to respond. Try again or choose another model."
    if isinstance(error, openai.APIConnectionError):
        return "Couldn't reach OpenRouter. Check your internet connection and try again."

    return "The model request failed: %s" % getattr(error, "message", error)


def first_token(iterator):
    """Read the stream until the first piece of answer text arrives.

    Returns the text and the moment the model first produced anything (reasoning included).
    """
    first_at = None

    for chunk in iterator:
        if first_at is None and first_output(chunk):
            first_at = time.monotonic()

        if not chunk.choices:
            continue

        token = chunk.choices[0].delta.content

        if token:
            return token, first_at or time.monotonic()

    return None, None


def open_stream(model, messages):
    """Start a reply from the chosen model. The model is never swapped for another one."""
    max_tokens = MAX_TOKENS_CAP
    if model.get("max_output"):
        max_tokens = max(256, min(MAX_TOKENS_CAP, model["max_output"]))

    plain = False       # True once we had to fold the system prompt into the user message
    attempt = 0
    last_message = "The model did not answer."

    while attempt < MAX_ATTEMPTS:
        attempt += 1
        stream = None

        record_request()
        started = time.monotonic()

        try:
            stream = client.chat.completions.create(
                model=model["id"],
                messages=merge_system(messages) if plain else messages,
                max_tokens=max_tokens,
                stream=True
            )

            iterator = iter(stream)
            token, first_at = first_token(iterator)

            if token is not None:
                ttft_ms = round((first_at - started) * 1000)
                record_success(model["id"], ttft_ms)
                return token, iterator, stream, ttft_ms

            stream.close()
            last_message = "The model returned an empty reply. Try again or choose another model."
            print("[Afterworld] %s returned an empty reply" % model["id"])

        except openai.APIError as error:
            if stream is not None:
                stream.close()

            status = getattr(error, "status_code", None)
            upstream_message = getattr(error, "message", "") or str(error)
            last_message = describe_error(error, model["name"])
            print("[Afterworld] %s failed (%s): %s"
                  % (model["id"], status or type(error).__name__, upstream_message))

            if status == 429:
                record_throttle(model["id"])

            if status == 403 and is_agent_only(upstream_message):
                mark_agent_only(model["id"], upstream_message)
                break

            if status in FATAL_STATUSES:
                break

            # Some models reject the system message, so try once without it
            if status == 400 and not plain:
                plain = True
                attempt -= 1
                continue

            if status is not None and status not in RETRY_STATUSES:
                break

        if attempt < MAX_ATTEMPTS:
            time.sleep(RETRY_WAITS[attempt - 1])

    raise ModelUnavailable(last_message)


def require_free_model(model_id):
    reason = agent_only_reason(model_id)
    if reason:
        raise HTTPException(
            status_code=400,
            detail="That model only works inside an agentic tool, not in a normal chat, so it "
                   "has been removed from the model list. Choose another model."
        )

    try:
        load_catalog()
    except CatalogError as error:
        raise HTTPException(status_code=503, detail=str(error))

    model = find_model(model_id)

    if model is None:
        # The list may have changed since it was cached
        try:
            load_catalog(force=True)
        except CatalogError:
            pass
        model = find_model(model_id)

    if model is None:
        raise HTTPException(
            status_code=400,
            detail="That model isn't in the current free-model list any more. Choose another model."
        )

    return model


@app.post("/chat")
def chat(data: ChatRequest):

    model = require_free_model(data.model)
    check_images(data.messages, model)
    messages = build_messages(data.messages, data.system)

    if len(messages) < 2:
        raise HTTPException(status_code=400, detail="Type a message first.")

    try:
        token, iterator, stream, ttft_ms = open_stream(model, messages)
    except ModelUnavailable as error:
        raise HTTPException(status_code=503, detail=error.message)

    def generate():
        try:
            yield token

            for chunk in iterator:

                if not chunk.choices:
                    continue

                piece = chunk.choices[0].delta.content

                if piece:
                    yield piece

        except Exception as error:
            yield "\n\n[Reply interrupted: %s]" % describe_error(error, model["name"])

        finally:
            stream.close()

    return StreamingResponse(
        generate(),
        media_type="text/plain",
        headers={
            "X-Model": model["id"],
            "X-TTFT-Ms": str(ttft_ms),
            "Access-Control-Expose-Headers": "X-Model, X-TTFT-Ms",
            "Cache-Control": "no-store"
        }
    )
