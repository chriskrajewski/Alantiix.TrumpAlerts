# Alantiix.TrumpAlerts

Serverless alerting pipeline that monitors Donald Trump's activity on X (Twitter) and Truth Social alongside a curated list of high-impact U.S. government accounts. Every new post is scored for expected U.S. financial market impact and delivered to your webhook in real time. The project targets Vercel for high-availability hosting and leverages Upstash Redis for state tracking.

## Key Capabilities
- Polls Truth Social and X for new posts (configurable account lists).
- Classifies financial-market sentiment on a 7-point scale from `Extremely Negative` to `Extremely Positive` with rationale.
- Pushes rich JSON payloads to one or more webhook endpoints.
- Designed for Vercel serverless functions with cron-based scheduling; includes local CLI for manual runs.

## Architecture Overview
- **Triggering**: Vercel cron (`/api/poll`) invokes the polling cycle; manual runs use `npm run poll`.
- **Data ingestion**:  
  - X via [twitter-api-v2](https://github.com/PLhery/node-twitter-api-v2) (Bearer token needed).  
  - Truth Social via its Mastodon-compatible OAuth API (password grant flow inspired by [truthbrush](https://github.com/stanfordio/truthbrush)), with optional proxy fallback.
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
   | `TRUTHSOCIAL_PROXY_URL` | Conditional | Proxy endpoint to fetch Truth Social content (see below). Required if you do not supply account credentials or Cloudflare blocks direct access. |
   | `TRUTHSOCIAL_USERNAME` / `TRUTHSOCIAL_PASSWORD` | Conditional | Truth Social credentials used to request an OAuth token (mirrors [truthbrush](https://github.com/stanfordio/truthbrush)). Provide both to let the app authenticate directly. |
   | `TRUTHSOCIAL_TOKEN` | Optional | Pre-generated Truth Social OAuth token. Takes precedence over username/password when set. |
   | `TRUTHSOCIAL_USER_AGENT` | Optional | Override the User-Agent header for Truth Social API calls. Defaults to a modern Firefox UA string. |
   | `ENABLE_TWITTER` | Optional | Set to `false`/`0`/`off` to disable Twitter polling without removing credentials. Defaults to enabled. |
   | `ENABLE_TRUTHSOCIAL` | Optional | Set to `false`/`0`/`off` to disable Truth Social polling. Defaults to enabled. |
   | `OPENAI_API_KEY` | Optional | Enables OpenAI sentiment scoring. Omit to use heuristic fallback. |
   | `ALERT_WEBHOOK_URL` | Optional | Single webhook target. |
   | `ALERT_WEBHOOK_URLS` | Optional | Comma-separated list of additional webhook URLs. |
   | `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Recommended | Persists last-seen IDs between runs. |

3. **Run a manual polling cycle locally**
   ```bash
   npm run poll
   ```

4. **Vercel deployment**
   - `vercel` to deploy once, `vercel deploy` for production.
   - `vercel env pull` / `vercel env add` to manage secrets.
   - The included `vercel.json` schedules `/api/poll` every 5 minutes by default (`*/5 * * * *`). Adjust as needed.

### Fetching a Truth Social Token
Truth Social’s OAuth endpoint blocks standard `fetch`/`curl` traffic via Cloudflare. If direct username/password auth fails, use the bundled helper (which relies on truthbrush’s `curl_cffi` impersonation) to mint a token locally and paste it into `TRUTHSOCIAL_TOKEN`:

```bash
# one-time dependency
python3 -m pip install --user truthbrush

# fetch token and copy it into your .env
python3 scripts/fetch_truthsocial_token.py \
  --username "you@example.com" \
  --password "your-password"
```

The script prints `{"ok": true, "token": "..."}` on success. Tokens expire, so repeat the command whenever the API starts returning 401/403 responses.

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
- Authenticate directly by supplying `TRUTHSOCIAL_USERNAME` + `TRUTHSOCIAL_PASSWORD` (or `TRUTHSOCIAL_TOKEN`) to request the same OAuth bearer token flow used by [truthbrush](https://github.com/stanfordio/truthbrush). If Cloudflare blocks your region or headless traffic, fall back to the proxy option below.
- Truth Social proxy mode (`TRUTHSOCIAL_PROXY_URL`) should expose either a Mastodon-style status array or `{ "statuses": [...] }`.
- Use `ENABLE_TWITTER=false` or `ENABLE_TRUTHSOCIAL=false` to pause polling without removing credentials.
- For high fidelity sentiment analysis, set `OPENAI_API_KEY`. The heuristic fallback only provides coarse estimates.
- Extend monitored accounts by editing `src/config/accounts.ts` or supplying the env vars above.
- When adding additional webhook consumers, ensure they can handle duplicate deliveries—webhook retries follow a best-effort model.

### Truth Social Proxy Template
The app expects your proxy to respond with JSON shaped like the Mastodon API. A minimal Cloudflare Worker can forward authenticated requests:

```js
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const handle = url.searchParams.get("handle");
    if (!handle) {
      return new Response("Missing handle", { status: 400 });
    }
    const upstream = `https://truthsocial.com/api/v1/accounts/lookup?acct=${handle}`;
    const lookup = await fetch(upstream, { headers: { "user-agent": "Your Worker" } });
    if (!lookup.ok) {
      return new Response("Lookup failed", { status: lookup.status });
    }
    const account = await lookup.json();
    const timeline = await fetch(
      `https://truthsocial.com/api/v1/accounts/${account.id}/statuses?limit=10&exclude_replies=true`,
      { headers: { "user-agent": "Your Worker" } }
    );
    return new Response(await timeline.text(), {
      headers: { "content-type": "application/json" }
    });
  }
};
```

Deploy the worker, note its public URL, and set `TRUTHSOCIAL_PROXY_URL` to something like `https://your-worker.example.com?handle=:handle`.

## Local Development Tips
- Use `LOG_LEVEL=debug` to see verbose logs from serverless handlers.
- `vercel dev` emulates the production environment locally, including the `/api/poll` endpoint.
- To add tests or custom processors, start with the shared types in `src/types/post.ts` and the orchestrator in `src/services/polling.ts`.
