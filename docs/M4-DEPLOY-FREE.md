# NIGHTGRID multiplayer: free Cloudflare deployment (NOT done; needs Sameer's approval)

Nothing in this branch has been deployed. No account was created or used. No login was performed. No secrets exist.
Follow this only after an explicit go-ahead. It stays on the **Workers Free** plan, with no card and no paid add-ons.

## What gets deployed

One Worker (`server/worker.js`) that:
* serves the built game from `dist/` as Workers static assets;
* exposes `/api/rooms` and `/api/rooms/:code/ws`;
* hosts one SQLite-backed Durable Object per room (`Room`) plus one singleton `Registry` DO for the
  shared budget.

Config: `wrangler.toml` (no secrets). Free accounts can only create SQLite-backed DOs. The config uses
`new_sqlite_classes`.

## Official free limits (rechecked 17 Nov 2026; recheck again before deploying)

| Limit | Value | Source |
|---|---|---|
| DO requests | 100,000 per day (HTTP, RPC, WebSocket messages, alarms). Over the limit, operations fail. Reset 00:00 UTC. | developers.cloudflare.com/durable-objects/platform/pricing |
| DO duration | 13,000 GB-s per day | same |
| Incoming WebSocket messages | billed 20:1 (100 incoming = 5 requests). Outgoing messages and protocol pings are not charged. | same |
| Hibernation | idle hibernatable objects are not billed for duration. `accept()` without the Hibernation API bills the whole connection time (we use `ctx.acceptWebSocket`). | same |
| SQLite storage | 5 GB total; 100,000 rows written/day; 5 M rows read/day | same |
| Worker requests | 100,000 per day; 10 ms CPU per HTTP request; 128 MB memory per isolate | developers.cloudflare.com/workers/platform/limits |
| DO CPU | 30 s per request, reset by each incoming WebSocket message | developers.cloudflare.com/durable-objects/platform/limits |
| Static assets | 20,000 files, 25 MiB per file (our largest GLB is about 10 MB) | workers limits |

Duration arithmetic (assumption: a DO is billed at the 128 MB memory allocation): 1 active second =
0.125 GB-s. So 13,000 GB-s is about 104,000 active DO-seconds, or 28.9 DO-hours per day.

## App-side guard (enforced across all rooms by the Registry DO)

`DAILY_ROOM_MINUTES=240` (4 room-hours) × `BUDGET_SAFETY=0.85`, `MAX_ACTIVE_ROOMS=3`, `ROOM_MAX_MINUTES=60`,
`MAX_CREATES_PER_DAY=200`. When the guard refuses, players see:
* "All race servers are busy right now. Try again in a few minutes." (capacity), or
* "Today's free race time is used up. Try again tomorrow." (daily budget).

These numbers are a conservative app budget, not a Cloudflare guarantee. See docs/M4-REPORT.md for
the measured cost per human-minute.

## Steps for Sameer (after approval)

1. Create a **free** Cloudflare account yourself at dash.cloudflare.com. Do not add a card. Do not pick a
   paid plan. Workers Free is the default.
2. On your computer: `git checkout claude/m4-multiplayer && npm ci && npm run build`.
3. `npx wrangler login`. A browser window opens and you sign in yourself. Never paste a password or token into chat.
4. Check that the plan is Free: dashboard → Workers & Pages → Plans shows "Free".
5. Deploy (prints a `*.workers.dev` URL):
   `npx wrangler deploy --define __NG_BUILD__:"\"$(node scripts/build-id.mjs)\""`
6. Health check: open `https://<name>.<account>.workers.dev/api/health`. It should show the same build id
   as `node scripts/build-id.mjs`.
7. Hosted test: one Android phone (Nothing Phone 3a, Chrome) + a second device. Create a room, join by
   link, race 2 humans + 2 bots, then reconnect (toggle airplane mode for about 5 s).
8. Check usage: dashboard → Workers & Pages → nightgrid → Metrics, and Durable Objects usage.

To stop everything: `npx wrangler delete` (removes the Worker and its Durable Objects). The custom
domain for the single-player site is not touched by any of this.

## What has and has not been tested

* `server/worker.js` (Worker routing, Registry DO, Room DOs, WebSocket Hibernation API accept, attachments,
  storage, alarms) runs in **local workerd** via `wrangler dev` (no account, no login): `npm run test:worker`,
  3/3 (docs/evidence/m4/worker-wrangler-tests.txt). This found and fixed two DO-only bugs: eviction lost
  the idle/empty timer baselines, and the constructor's `setAlarm` cancelled the alarm being delivered.
* Node (`server/local.mjs`) cannot run `cloudflare:workers`. Node tests cover `RoomServer`, protocol and
  netcode, not the DO adaptor.
* **Not verified until hosted:**
  - real hibernation eviction timing in Cloudflare;
  - Cloudflare's request/duration accounting and Free-plan enforcement;
  - Registry behaviour across Cloudflare locations;
  - real phone networks.

## Guarding against accidental paid usage

* The Free plan has no overage billing. Per Cloudflare's pricing page, once a free limit is exceeded,
  further operations of that type **fail with an error** until 00:00 UTC. The app shows "Today's free
  race time is used up" / "All race servers are busy".
* Paid usage requires subscribing to Workers Paid in the dashboard with a payment method. Nothing in
  `wrangler.toml` or the steps above does that. Do not click "Upgrade" or "Purchase Workers Paid", and do
  not add a card.
* `wrangler.toml` uses only Free-compatible features: SQLite DOs, static assets, vars. No KV, R2, D1,
  Queues, Logpush, paid observability or custom domains.
