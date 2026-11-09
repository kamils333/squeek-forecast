# Squeek Forecast 🐹📈

How far will Squeektoshi run today?

[Squeekchain](https://squeekchain.com) is a hamster-powered proof-of-work toychain on Ethereum. Its hamster, Squeektoshi, runs on a real wheel. Squeek Forecast is a daily prediction game: everyone guesses the distance the wheel will record, then gets scored against the real number from the public Squeekchain API.

- **Rounds** follow Squeekchain's own day, 12:00 → 12:00 UTC. You predict the next round before it starts, and you can change your call until then.
- **Scoring:** `100 × (1 − |prediction − actual| ÷ actual)`, floored at 0. The closest call(s) get **+25**.
- **Settlement** happens about 30 minutes after a round ends, from `/v1/measurement/stats`. If there is no data within 24 hours, the round is void.
- **Live view:** the current distance and the running status come from `/v1/status`. The last 7 days of real distances are shown as a guide.
- **Players** pick a unique nickname. There is no wallet and no sign-in. A random player key is stored in your browser, and only that key can predict for your name. You can show it to back it up, and paste it into another browser to restore your account.

Points are a game score only. They are not SQK or tokens.

## Squeekchain

- Genesis Code: https://squeekchain.com/genesis/code
- Docs: https://docs.squeekchain.com/
- API: https://api.squeekchain.com/v1/status (public, read-only, no key)
- Network: Ethereum Sepolia (chain ID 11155111)

## Genesis submission

This is a community project for the Squeekchain Genesis Buildooooor badge. It is not affiliated with Squeekchain.

## Run locally

```bash
npm install
npm run dev
```

Then open http://localhost:3000. Without Redis credentials, the game keeps its data in memory, which is fine for trying it out.

## Deploy (Vercel + Upstash Redis)

1. Import the repository at [vercel.com/new](https://vercel.com/new).
2. In the Vercel project, open **Storage → Create / Connect → Upstash for Redis** (free plan) and connect it to the project. This sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`. `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` also work.
3. Optional: set `CRON_SECRET` so only Vercel can call `/api/cron`.
4. Redeploy.

Rounds settle on their own when anyone loads the page. The daily cron in `vercel.json` (12:30 UTC) is a backup.

## Files

| Path | What |
| --- | --- |
| `lib/rounds.ts` | Round calendar and scoring |
| `lib/server.ts` | Players, predictions, settlement, leaderboard |
| `lib/store.ts` | Upstash Redis, or in-memory when no credentials are set |
| `lib/squeek.ts` | Browser-side Squeekchain API reads |
| `components/Forecast.tsx` | UI |
| `app/api/*` | `state`, `register`, `predict`, `cron` |
