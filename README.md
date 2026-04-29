# Amici Mining

Geo-targeted catering-prospect pipeline for Amici Market (Palm Beach, FL).

Scrapes businesses inside the Rybovich → Forest Hill / east-of-Olive zone via Google Places, scores them for catering fit, and lets you draft outreach emails in Maurizio's voice.

## Stack

- **Next.js 16** — App Router, server components for data fetching
- **Turso** (libSQL) — cheap, fast, file-like Postgres replacement
- **Google Places API (New)** — business discovery
- **Anthropic Claude Sonnet** — outreach email drafts
- **Leaflet + OSM tiles** — the map view (free)
- **Vercel** — hosting

## Setup (local)

```bash
cp .env.local.example .env.local
# Fill in TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, GOOGLE_PLACES_API_KEY, ANTHROPIC_API_KEY
npm install
npm run schema:push        # apply Turso schema
npm run scrape             # populate businesses (real API; ~$2-3 cost)
npm run dev                # http://localhost:3000
```

If you want to demo without an API key first:

```bash
npm run seed:demo          # inserts ~10 plausible businesses
```

## Scrape scoping

```bash
# Just professional services (lawyers, accountants, real estate)
npm run scrape -- --groups=professional

# Skip per-website email scrape (faster, cheaper)
npm run scrape -- --no-emails

# Multiple groups
npm run scrape -- --groups=marine,medical_wellness
```

Available groups: `professional`, `marine`, `medical_wellness`, `beauty`, `retail_luxury`, `fitness`, `hospitality`.

## Deploying to Vercel

```bash
vercel link                # interactive
vercel env add TURSO_DATABASE_URL production
vercel env add TURSO_AUTH_TOKEN production
vercel env add GOOGLE_PLACES_API_KEY production
vercel env add ANTHROPIC_API_KEY production
vercel deploy --prod
```

## Architecture notes

- `src/lib/geo.ts` — Amici target polygon + grid generator. Single source of truth for the geography.
- `src/lib/places.ts` — thin Google Places client + a best-effort email-from-website regex.
- `src/lib/scoring.ts` — explainable rule-based catering-fit scorer (0-100).
- `src/lib/claude.ts` — outreach-email generator. Brand voice baked into the system prompt.
- `src/lib/db.ts` — Turso client + schema (`businesses`, `email_drafts`, `scrape_runs`). No multi-tenancy; this is a single-shop tool.
