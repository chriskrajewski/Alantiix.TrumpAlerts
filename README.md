# Alantiix.TrumpAlerts

Serverless alerting pipeline that monitors Donald Trump's activity on X (Twitter) and Truth Social alongside a curated list of high-impact U.S. government accounts. Every new post is scored for expected U.S. financial market impact and delivered to your webhook in real time. The project targets Vercel for high-availability hosting and leverages Upstash Redis for state tracking.

## Key Capabilities
- Polls Truth Social and X for new posts (configurable account lists).
- Scans Finnhub's top news feed and surfaces articles that match your keyword watchlist.
- Classifies financial-market sentiment on a 7-point scale from `Extremely Negative` to `Extremely Positive` with rationale.
- Pushes rich JSON payloads to one or more webhook endpoints.
- Designed for Vercel serverless functions with cron-based scheduling; includes local CLI for manual runs.

## Architecture Overview
- **Triggering**: Vercel cron (`/api/poll`) invokes the polling cycle; manual runs use `npm run poll`.
- **Data ingestion**:  
  - X via [twitter-api-v2](https://github.com/PLhery/node-twitter-api-v2) (Bearer token needed).  
  - Truth Social via the public [truthsocial-api.vercel.app](https://truthsocial-api.vercel.app/api-docs) gateway, polling the `statuses` endpoint with `createdAfter` filters to retrieve only new posts.
  - Finnhub Top News via [Finnhub.io](https://finnhub.io/docs/api/market-news), filtered locally against configurable keywords.
- **State tracking**: Upstash Redis stores last-seen IDs per account (automatic in-memory fallback for local/dev).
- **Sentiment analysis**: Optional OpenAI integration (`gpt-4o-mini`) with heuristic fallback when no API key is present.
- **Delivery**: Any HTTPS webhook (Slack, Discord, internal services, etc.) receives structured payloads.

## Quick Start
1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Create an `.env` (or configure Vercel Project Settings)**

   | Variable | Required | Description |
   | --- | --- | --- |
   | `TWITTER_BEARER_TOKEN` | Optional | X API bearer token with read access. Needed for Twitter polling. |
   | `TWITTER_HANDLES` | Optional | Comma-separated overrides/additions (e.g. `realDonaldTrump,POTUS`). Defaults include Trump, POTUS, USTreasury, federalreserve. |
   | `TRUTHSOCIAL_HANDLES` | Optional | Comma-separated Truth Social handles. Defaults to Donald Trump. |
   | `TRUTHSOCIAL_API_BASE_URL` | Optional | Override the Truth Social gateway base URL. Defaults to `https://truthsocial-api.vercel.app`. |
   | `TRUTHSOCIAL_TEST_CREATED_AFTER` | Optional | Test mode override that forces polling to use the provided ISO-8601 timestamp for the Truth Social `createdAfter` filter. |
   | `TRUTHSOCIAL_USER_AGENT` | Optional | Override the User-Agent header for Truth Social API calls. Defaults to a modern Firefox UA string. |
   | `ENABLE_TWITTER` | Optional | Set to `false`/`0`/`off` to disable Twitter polling without removing credentials. Defaults to enabled. |
   | `ENABLE_TRUTHSOCIAL` | Optional | Set to `false`/`0`/`off` to disable Truth Social polling. Defaults to enabled. |
   | `ENABLE_WEBHOOK_METADATA` | Optional | Set to `false`/`0`/`off` to strip the `metadata` object from outbound webhook payloads. Defaults to enabled. |
   | `ENABLE_NEWS` | Optional | Set to `false`/`0`/`off` to disable Finnhub news polling. Defaults to enabled. |
   | `OPENAI_API_KEY` | Optional | Enables OpenAI sentiment scoring. Omit to use heuristic fallback. |
   | `POLL_WEBHOOK_TOKEN` | Optional | Shared secret required in the `X-Poll-Token` header (or `token` query param) when triggering `/api/poll` remotely. |
   | `ALERT_WEBHOOK_URL` | Optional | Single webhook target. |
   | `ALERT_WEBHOOK_URLS` | Optional | Comma-separated list of additional webhook URLs. |
   | `FINNHUB_API_KEY` | Optional | Finnhub API key used to fetch the top news feed. Required when `ENABLE_NEWS` is true. |
   | `FINNHUB_NEWS_CATEGORY` | Optional | Finnhub news category to poll. Defaults to `top news`. |
   | `NEWS_KEYWORDS` | Optional | Comma or newline-separated keywords/topics to match (e.g. `tariff,interest rate,trade policy`). Articles must mention at least one to trigger an alert. |
   | `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Recommended | Persists last-seen IDs between runs. |

3. **Run a manual polling cycle locally**
   ```bash
   npm run poll
   ```

4. **Vercel deployment**
   - `vercel` to deploy once, `vercel deploy` for production.
   - `vercel env pull` / `vercel env add` to manage secrets.
   - The included `vercel.json` schedules `/api/poll` every 5 minutes by default (`*/5 * * * *`). Adjust as needed.

### Triggering polling via webhook
If Vercel’s cron schedule does not meet your needs, you can call the polling endpoint yourself from any scheduler:

```bash
curl -X POST https://your-app.vercel.app/api/poll \
  -H "X-Poll-Token: $POLL_WEBHOOK_TOKEN"
```

- Set `POLL_WEBHOOK_TOKEN` in your environment and include it as the `X-Poll-Token` header (or `?token=` query parameter).  
- Any scheduler capable of making HTTP requests—GitHub Actions, GitLab CI, Cloudflare Workers, n8n, Zapier, etc.—can now trigger the poller on your preferred cadence while the code stays on Vercel.

## Webhook Payload Example
```json
{
  "platform": "twitter",
  "account": {
    "handle": "realDonaldTrump",
    "displayName": "Donald J. Trump",
    "id": "25073877"
  },
  "post": {
    "id": "1234567890",
    "url": "https://twitter.com/realDonaldTrump/status/1234567890",
    "text": "Example post text",
    "createdAt": "2024-04-20T16:23:11.000Z"
  },
  "sentiment": {
    "label": "Negative",
    "rationale": "Model explanation here.",
    "confidence": 0.72,
    "source": "openai"
  },
  "metadata": {
    "dedupeStore": "upstash",
    "openAiConfigured": true
  }
}
```

## Notes & Recommendations
- Truth Social endpoints are rate-limited; keep cron frequency reasonable.
- Finnhub news alerts require both `FINNHUB_API_KEY` and at least one entry in `NEWS_KEYWORDS`; otherwise the feed is skipped each cycle.
- Truth Social polling leverages the public statuses endpoint via `truthsocial-api.vercel.app` and passes a `createdAfter` timestamp to avoid fetching duplicates. If you need a private deployment, point `TRUTHSOCIAL_API_BASE_URL` at your own gateway.
- Set `TRUTHSOCIAL_TEST_CREATED_AFTER` when you want to replay posts from a specific ISO-8601 timestamp during testing; remove the value before production runs to resume normal cursor-based polling.
- Discord webhooks are supported out of the box; dashboard-style embeds surface a quick-action line, sentiment summary, and rationale so teams know what to do at a glance.
- Use `ENABLE_TWITTER=false` or `ENABLE_TRUTHSOCIAL=false` to pause polling without removing credentials.
- For high fidelity sentiment analysis, set `OPENAI_API_KEY`. The heuristic fallback only provides coarse estimates.
- Extend monitored accounts by editing `src/config/accounts.ts` or supplying the env vars above.
- When adding additional webhook consumers, ensure they can handle duplicate deliveries—webhook retries follow a best-effort model.

## Local Development Tips
- Use `LOG_LEVEL=debug` to see verbose logs from serverless handlers.
- `vercel dev` emulates the production environment locally, including the `/api/poll` endpoint.
- To add tests or custom processors, start with the shared types in `src/types/post.ts` and the orchestrator in `src/services/polling.ts`.
