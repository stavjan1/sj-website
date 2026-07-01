# SJ הנדסת חשמל — website + quote app

Marketing site for SJ Electrical Engineering plus an internal quote-generation
app with AI pricing/phrasing agents and a public AI assistant.

Static HTML/CSS/JS hosted on **Cloudflare Pages**, with a few **Pages Functions**
(`/functions/api/*`) for the server-side AI proxy and lead email. No build step.

## Structure

```
index.html              Home (services, guides carousel, testimonials, FAQ, contact)
about.html              About / story / values / process
contact.html            Contact info + form (web3forms)
articles.html           12 electrical guides (FAQ/HowTo schema → Google AI / LLMs)
certificates.html       Licenses & certifications
projects.html           Project showcase
calculator.html         Voltage-drop calculator
login.html              Staff login → /sale (sets localStorage, then redirects)
styles.css  app.js      Main-site styles + interactions
assistant.js            Public AI chat widget (self-injects on every public page)
llms.txt  sitemap.xml  robots.txt  _redirects

sale/                   Quote-generation app (projects, AI pricing chat, quote
                        editor, PDF export, Google Drive sync) — see sale/

functions/api/
  _ai.js                Shared multi-provider AI core (not a route; leading "_")
  chat.js               POST /api/chat      — pricing/phrasing agents
  assistant.js          POST /api/assistant — public assistant (server-side prompt)
  lead.js               POST /api/lead      — "email me this conversation"
```

## Environment variables (Cloudflare Pages → Settings → Environment variables)

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | recommended (primary) | Google AI Studio key — primary AI engine (free tier). aistudio.google.com/apikey |
| `GEMINI_API_KEY_2` | optional | A second Gemini key (e.g. a backup Google account). Tried automatically, per-request, the moment the primary key hits a quota/auth error — before falling through to DeepSeek/Grok/Cloudflare. No shared "requests used today" counter needed. |
| `DEEPSEEK_API_KEY` | recommended (fallback) | DeepSeek key — automatic fallback when Gemini is out of quota. platform.deepseek.com/api_keys |
| `XAI_API_KEY` | optional | xAI/Grok key (third option). |
| `AI_PROVIDER` | optional | Force a default provider (`gemini` \| `deepseek` \| `grok`). Default: gemini. |
| `RESEND_API_KEY` | optional | If set, `/api/lead` emails the visitor directly from SJ via Resend (needs a verified `sj-eng.co.il` domain in Resend). Without it, the lead is emailed to SJ via web3forms. |
| `RESEND_FROM` | optional | Override the From address (default `SJ הנדסת חשמל <info@sj-eng.co.il>`). |
| `FIRECRAWL_API_KEY` | optional | If set, `/api/scrape` uses Firecrawl (handles JS-rendered / anti-bot supplier sites). Without it, a free server-side fetch is used (good for normal pages). |

## Price catalog (sale app → "מאגר מחירים" tab)

Scrape a supplier page once → the AI extracts a `{name, price, unit}` list →
saved to the per-user catalog (localStorage + Drive sync). The pricing agent
then receives the catalog as a reference block, so material estimates use real
supplier prices instead of guesses. Prices can also be added/edited manually
(usually the most accurate — trade prices aren't on public sites). Endpoint:
`POST /api/scrape { url, provider?, model? }`.

After changing any variable: **Save → redeploy**. At least one of `GEMINI_API_KEY`
/ `DEEPSEEK_API_KEY` must be set or the AI features return a clear "not configured"
message (and the assistant degrades to a contact card).

## AI architecture (multi-provider with auto-fallback)

- The browser always speaks **one format**: OpenAI-style `messages` in, `choices[…]`
  out (streaming or not), and just names a `provider`.
- `_ai.js` translates to/from each provider (including Gemini's different request
  shape and SSE stream) and normalizes responses back to OpenAI shape.
- On a quota/auth/5xx error it **falls back** to the next provider that has a key,
  and signals this with the `X-AI-Fallback-From` response header. The clients show
  a notice and switch the model selector to the engine that answered.
- The public assistant's system prompt + scope live **server-side** in
  `assistant.js` so visitors can't read or re-role it.

## Data storage & safety (sale app)

- All quotes/projects/settings live in the browser's `localStorage`, namespaced
  per signed-in user (`sj_user_<email>_*`). Optional **Google Drive sync** keeps a
  per-user JSON backup.
- Safeguards (see `saveProjects`, `syncDatabaseToDrive`, `syncDatabaseFromDrive`):
  - The cloud backup is **never overwritten with an empty local dataset** (guards
    against a corrupt/blank local load wiping Drive).
  - A recoverable `sj_user_<email>_sj_local_backup` snapshot is taken **before**
    any cloud copy / manual recover / import replaces local data.
  - Import **replaces** (not merges) and warns + snapshots first.

## Local development

No build step. Serve the folder statically, e.g.:

```
python3 -m http.server 8099   # then open http://localhost:8099
```

Note: `/api/*` are Cloudflare Pages Functions and only run on a Pages deploy (or
`wrangler pages dev`). Locally without them, the AI features degrade gracefully
(the sale app falls back to a personal key if configured; the assistant shows a
contact card).
