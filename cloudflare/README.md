# Afterworld on Cloudflare Workers

This folder runs Afterworld on Cloudflare Workers. It is a port of `main.py`, which
stays in the repo so the Azure App Service deployment keeps working until the Worker
has been tested in production. Nothing in this folder is read by Azure, and nothing
outside it changed apart from `static/_headers` (ignored by FastAPI) and `.gitignore`.

The frontend (`../static/index.html`) is served unchanged by Workers Static Assets.
Every route returns the same JSON and the same streamed plain-text replies as before.

## What changed from main.py

| main.py (Azure) | Worker |
| --- | --- |
| FastAPI + gunicorn/uvicorn | `src/index.js`, a plain `fetch` handler |
| `openai` SDK and `urllib` (blocking) | `fetch()` and a small SSE reader (`src/openrouter.js`) |
| `ThreadPoolExecutor` for stats and probes | `Promise.all` raced against the same time budgets |
| `time.sleep` between retries | `await` on a timer, same 1.5 s and 3 s waits |
| Module globals + `threading.Lock` | One Durable Object (`src/state.js`), shared by every isolate |
| `StaticFiles` / `FileResponse` | Workers Static Assets, with `/` kept `no-store` via `static/_headers` |
| `OPENROUTER_API_KEY` app setting | Cloudflare secret `OPENROUTER_API_KEY` |

The model filtering and labelling in `src/catalog.js` is a line-by-line port. It was
checked against `main.py` on OpenRouter's full live list (395 models with pricing
forced to free) and gives identical output for every model.

Durable Object state survives restarts, so the request counter, live measurements,
429s and the agent-only list are now shared across all users and isolates, where on
Azure they reset whenever the app restarted.

Two Worker-specific details:

- **Streaming.** Cloudflare gzips `text/plain` by default, which buffers the whole
  reply. `/chat` sends `Content-Encoding: identity` and `Cache-Control: no-transform`
  so text still arrives word by word.
- **Subrequest limit.** The Free plan allows 50 outgoing requests per incoming
  request. Latency-stat lookups stop early to leave room for probes, so a model
  without stats shows "unknown" rather than failing the page. On the Paid plan, set
  `SUBREQUEST_LIMIT` to `1000` under `vars` in `wrangler.jsonc`.

## Requirements

- Node.js 20 or newer
- A Cloudflare account (the Free plan works; the Durable Object is SQLite-backed)

```bash
cd cloudflare
npm install
```

## Run it locally

Create `cloudflare/.dev.vars` (git-ignored) with your key:

```env
OPENROUTER_API_KEY=sk-or-v1-...
```

Then:

```bash
npm run dev          # http://localhost:8787
```

## Tests

```bash
npm test                    # catalog unit tests, expected values taken from main.py
npm run test:integration    # every route, end to end, in the real Workers runtime
```

The integration test starts `wrangler dev` against a mock OpenRouter
(`test/mock-openrouter.mjs`), so it spends no real requests. It covers:

- `GET /` and `/static/index.html`
- `GET /api/models`: filtering, labels, groupings and caching
- `POST /chat`: streaming in several pieces (gzip accepted), history clean-up, and
  retries on 429 with back-off
- `POST /chat`: the retry without a system message after a 400, empty replies,
  provider 429s and errors in mid-stream
- Agent-only models: hidden after a 403
- Image input: forwarded as `image_url` parts, and rejected for text-only models,
  bad data or more than 8 images
- Validation errors: 400, 405 and 422
- `POST /api/probe`, `GET /api/live` and `POST /api/random-model`
- Stopping a reply mid-stream

## Deploy (when you're ready; this was not done for you)

1. Sign in: `npx wrangler login`
2. Store the key as a secret. It never goes in `wrangler.jsonc` or the repo:
   ```bash
   npx wrangler secret put OPENROUTER_API_KEY
   ```
3. Deploy: `npm run deploy`. The Worker goes live at
   `https://afterworld.<your-subdomain>.workers.dev`. No DNS is touched.
4. Test it there (models load, Random fast model, a streamed chat, an image chat).
   Azure keeps serving the existing URL the whole time.
5. Only after that, if you want a custom domain (such as afterworld.biz.id), add it
   under the Worker's Settings, then Domains & Routes. Retire Azure last.

Rolling back is just pointing users at the Azure URL again. The two deployments share
nothing except the OpenRouter key and its free-tier limits.

### Optional: deploy from GitHub Actions

The existing `azure-deploy.yml` is unchanged. A Cloudflare job would run
`npx wrangler deploy` in `cloudflare/` with a `CLOUDFLARE_API_TOKEN` repository secret
(Workers Scripts: Edit permission). It is left out on purpose, so pushing to `main`
can't deploy the Worker before you've tested it.

## Other hosts (optional)

Besides OpenRouter, the Worker can list and chat with models from:

| Host | How to turn it on | Free allowance |
|---|---|---|
| Cloudflare Workers AI | On by default through the `AI` binding in `wrangler.jsonc`. Set the var `WORKERS_AI_ENABLED` to `false` to hide it. | 10,000 Neurons a day, shared by every Workers AI model |
| Groq | `npx wrangler secret put GROQ_API_KEY` | About 30 requests a minute and 1,000 a day per model |
| SambaNova | `npx wrangler secret put SAMBANOVA_API_KEY` | Free tier; new accounts may need a payment method on file |
| Mistral | `npx wrangler secret put MISTRAL_API_KEY` | Off unless a key is set |

A host without a key is left out. Its model ids look like `groq::openai/gpt-oss-120b`, so they never clash with OpenRouter ids. When a host answers that a model needs a paid plan (HTTP 402, or Workers AI's "not available on the Workers Free plan"), the model is hidden from the list, the same way agent-only models are. The page has a new "Host" grouping and shows "via Groq" and similar under each model.
