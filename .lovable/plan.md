
# Tracker Bot — X posts + Eldorado.gg prices → Discord

A single-user app that lets you manage a list of X (Twitter) accounts and Eldorado.gg product URLs to watch. Every hour the backend checks each of them, and when there's a new post or the price of a product changes, it sends a message to your Discord channel via a webhook.

## What you'll get

- A simple dashboard (single user, no login) with two tabs:
  - **X accounts** — add/remove handles (e.g. `@elonmusk`), see the last known tweet and time checked.
  - **Eldorado listings** — paste an Eldorado.gg product/listing URL, give it a label, see the current price, previous price, and full price history chart.
- Discord alerts:
  - New X post → username, tweet text, link.
  - Price change → product label, old price → new price (with ↑/↓ and %), link.
- An hourly automatic check, plus a manual "Check now" button per item.

## How it works (technical)

1. **Storage — Lovable Cloud**
   - `tracked_x_accounts` (handle, x_user_id, last_tweet_id, last_checked_at)
   - `tracked_products` (url, label, last_price, currency, last_checked_at)
   - `price_history` (product_id, price, checked_at) for the chart
   - `settings` singleton row storing the Discord webhook URL (stored as a secret, not in the table — see step 4)
   - Since it's single-user, RLS policies allow full read/write to `anon` for simplicity, OR we keep it behind a tiny access check. Recommend: keep the app private and use narrow policies.

2. **X integration — X connector (app-only Bearer)**
   - Uses `standard_connectors--connect` for `x` (auth_type `api_key`).
   - Calls `/2/users/by/username/{handle}` once on add to resolve `x_user_id`, then `/2/users/{id}/tweets?max_results=5&since_id=...` on each check.

3. **Eldorado price scraping — Firecrawl connector**
   - Uses Firecrawl `/scrape` with `formats: [{ type: 'json', prompt: 'Extract the current listed price and currency' }]` on each product URL.
   - Falls back to `markdown` + regex if JSON extraction returns nothing.

4. **Discord webhook**
   - Stored via `add_secret` as `DISCORD_WEBHOOK_URL`.
   - Server posts `{ content, embeds: [...] }` to it on any detected change.

5. **Hourly job — pg_cron → public API route**
   - Server route: `src/routes/api/public/run-checks.ts` that iterates all tracked rows, calls X + Firecrawl, updates DB, sends Discord messages.
   - Protected by an `X-Cron-Secret` header check (secret generated with `generate_secret`).
   - A `pg_cron` migration schedules an hourly `net.http_post` to `https://project--{id}.lovable.app/api/public/run-checks` with that header.

6. **Server functions (`createServerFn`)** for dashboard actions: `addXAccount`, `removeXAccount`, `addProduct`, `removeProduct`, `runChecksNow`, `listAll`.

## Files to add

- `supabase/migrations/*` — tables, RLS, pg_cron schedule
- `src/lib/tracker.functions.ts` — server functions for CRUD + manual run
- `src/lib/tracker.server.ts` — X + Firecrawl + Discord helpers
- `src/routes/api/public/run-checks.ts` — cron endpoint
- `src/routes/index.tsx` — dashboard (replaces placeholder), with two tabs and a price history chart (recharts)

## Setup you'll do once

1. Approve enabling **Lovable Cloud**.
2. Approve connecting the **X** connector (app-only API key, free tier is fine for hourly reads on a small list).
3. Approve connecting the **Firecrawl** connector for Eldorado scraping.
4. Paste your **Discord webhook URL** into the secure form I open after Cloud is enabled.

## Limits & caveats

- X free-tier read quotas are tight; hourly checks on ~5–15 accounts fit comfortably. Above that you may hit rate limits.
- Eldorado listings can disappear/change layout; if scraping fails the row is flagged in the UI and skipped for that run, not deleted.
- No login means anyone with the app URL can see and edit your list — keep the published URL private, or add auth later.
