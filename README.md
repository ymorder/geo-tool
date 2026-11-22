# GEO/AEO Tool

> **Archived.** Replaced by a newer project, GEO Tracker. This repo is kept for reference and is no longer updated.

A practical toolkit for tracking where your domain appears in Google rankings and across the major AI answer engines (Perplexity, Microsoft Copilot, You.com, DeepSeek, Gemini, ChatGPT, Claude, Grok). Includes auto-categorization, prompt research, competitor discovery and a recommendation engine that explains where you are missing and what to do about it.

## Features

1. Add a domain, get an automatic category + sub-category (banking, B2B SaaS, B2C retail, travel, healthcare, education, media, real estate, marketplace, gov, nonprofit, tech hardware, gaming, agency).
2. Manage prompts where the site appears or could appear (manual + auto-research).
3. Manage competitors (manual + auto-discovery via SerpAPI).
4. Run a single tracking pass or schedule recurring runs.
5. Track Google + Bing SERP positions and AI engine citations.
6. Auto-generate recommendations for every prompt where you are not cited (with concrete action items, gap analysis and source-type signals).

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Install Chromium for Playwright (the AI engine scrapers need it)
npx playwright install chromium

# 3. Configure environment
cp .env.example .env
# edit .env to add SERPAPI_KEY (required for Google + Bing)

# 4. Run
npm start
# -> geo-tool listening on http://localhost:3000
```

Open `http://localhost:3000` in your browser.

## Capturing session cookies for AI engines that need login

ChatGPT, Gemini, Claude and Grok all require an active session to surface cited sources. Perplexity, Copilot, You.com and DeepSeek work without login.

To enable the engines that need login:

1. Open the engine in your browser and sign in.
2. Open DevTools > Application > Cookies.
3. Copy the cookies for the engine's domain (e.g. `chatgpt.com`, `gemini.google.com`, `claude.ai`, `grok.com`).
4. Paste them into `.env` as `CHATGPT_SESSION`, `GEMINI_SESSION`, `CLAUDE_SESSION`, or `GROK_SESSION` in either form:
   - JSON array: `[{"name":"__Secure-next-auth.session-token","value":"...","domain":"chatgpt.com"}]`
   - Cookie string: `__Secure-next-auth.session-token=...; cf_clearance=...`

Cookies expire. Expect to refresh them every few weeks. For long-running usage, swap in a paid GEO API such as Profound, Otterly or Peec - the engine layer is designed to be replaceable.

## SerpAPI

Get a key at <https://serpapi.com/> and put it in `.env` as `SERPAPI_KEY` or in Settings inside the app. Required for Google, Bing, PAA expansion and competitor discovery.

## Architecture

```
server/
  index.js              # Express app + route mounting + bootstrap
  db.js                 # better-sqlite3 + schema + settings helpers
  scheduler.js          # node-cron for automatic tracking runs
  categorize-taxonomy.js
  categorize.js         # fetches homepage, runs taxonomy classifier
  routes/
    domains.js          # CRUD + auto-categorize
    prompts.js          # CRUD + auto-research
    competitors.js      # CRUD + auto-find
    tracking.js         # run tracking + run history
    recommendations.js  # generate + list + status
    dashboard.js        # aggregated stats
    settings.js         # keys, engines, cron
    engines.js          # engine registry metadata
  services/
    prompt-research.js  # seed prompts, long-tail, competitor, PAA
    competitors.js      # SerpAPI competitor discovery
    recommender.js      # gap analysis -> recommendations
    tracking-runner.js  # orchestrates a full tracking run
    ai-engines/
      base.js           # shared Playwright helpers
      serp.js           # Google + Bing via SerpAPI
      perplexity.js     # no-login
      copilot.js        # no-login
      you.js            # no-login
      deepseek.js       # no-login
      gemini.js         # needs session cookies
      chatgpt.js        # needs session cookies
      claude.js         # needs session cookies
      grok.js           # needs session cookies
      index.js          # registry
public/
  index.html, app.js, styles.css   # vanilla JS SPA
data/
  geo.db                             # SQLite database (auto-created)
```

## Data model

- `domains` - one row per tracked site. Holds category, sub-category, confidence, signals.
- `prompts` - queries you want to track. `source` is `user` or `auto`, `status` is `tracking` or `candidate`.
- `competitors` - either user-provided or auto-discovered (with overlap score).
- `tracking_runs` - one row per run (manual or cron). Status: running / completed / failed.
- `tracking_results` - one row per (run, prompt, engine). Holds position (Google), cited flag, citation URL, sources, response excerpt.
- `recommendations` - one row per prompt gap, generated after each run. Status: open / in_progress / done / dismissed.
- `settings` - JSON config blob (engines, SerpAPI key, cron expression).

## API

The frontend uses these routes; you can call them directly too:

```
GET    /api/health
GET    /api/engines

GET    /api/domains
POST   /api/domains                     body: { domain }
GET    /api/domains/:id
PATCH  /api/domains/:id
POST   /api/domains/:id/recategorize
DELETE /api/domains/:id

GET    /api/domains/:id/prompts
POST   /api/domains/:id/prompts         body: { text, intent?, source?, status? }
POST   /api/domains/:id/prompts/bulk    body: { prompts: [...] }
POST   /api/domains/:id/prompts/research  body: { limit?, types? }
DELETE /api/prompts/:id

GET    /api/domains/:id/competitors
POST   /api/domains/:id/competitors     body: { domain }
POST   /api/domains/:id/competitors/research  body: { limit? }
DELETE /api/competitors/:id

POST   /api/domains/:id/track           body: { engines?, promptIds? }
GET    /api/domains/:id/runs
GET    /api/runs/list                   query: ?limit=30
GET    /api/runs/:runId

GET    /api/domains/:id/dashboard
GET    /api/domains/:id/recommendations
POST   /api/domains/:id/recommendations/generate
PATCH  /api/recommendations/:id

GET    /api/settings
POST   /api/settings                    body: partial config
POST   /api/settings/test-serpapi
```

## Deployment

Designed to run as a single Node.js process. For a real deployment:

1. Use a process manager (PM2, systemd).
2. Put it behind nginx with HTTPS.
3. Mount a persistent volume for `data/`.
4. Set `HEADLESS_BROWSER=true` (default).
5. Make sure the server has Chromium dependencies installed (Playwright's `npx playwright install-deps chromium` on Linux).

For serverless or containers without GUI, prefer the SerpAPI-only path (Google + Bing + AI Overviews) and replace the Playwright engines with a paid GEO API.

## Honest limits

- AI engine scraping is inherently fragile. UIs change, anti-bot improves, sessions expire. Plan to babysit.
- Source attribution in LLM answers can be subtle. We mark "cited" if any source URL resolves to your root domain or any subdomain. You can audit per-prompt in the run detail view.
- The taxonomy classifier is keyword-based and English-tuned. For niche verticals or non-English sites you may want to plug in an LLM-based classifier (set `OPENAI_API_KEY` and extend `categorize.js`).
- Recommendations are rule-based, not magic. They tell you "Wikipedia ranks, Reddit ranks, you don't" and give a concrete next step. Pair them with human editorial judgement.
