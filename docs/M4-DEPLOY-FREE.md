# NIGHTGRID multiplayer: hosted path and runbook (NOT deployed; each step needs Sameer's approval)

## Shape (fixed constraints)

```
players' phones/laptops
   │  https://nightgrid.sameerkapil.com   (frontend: Vercel, unchanged; current DNS/CNAME untouched)
   │      page + game assets + /ng-build.json
   │
   └─ direct HTTPS + WSS ──►  https://nightgrid-mp[-staging].<sameer-subdomain>.workers.dev
                               (multiplayer backend only: Cloudflare Worker + Durable Objects, Free plan)
```

* **No DNS / nameserver / zone / domain / route / custom-domain changes, of any kind.** The backend
  lives only on `workers.dev`. `wrangler.toml` has `workers_dev = true` and `routes = []`, and no
  `zone_id`, `route` or `custom_domain`. `scripts/deploy-backend.sh` refuses to run if any appear.
* No Vercel WebSocket rewrite. The page talks to the backend directly. Its URL is set at build time as
  `VITE_MP_API_BASE`, a public URL, not a secret.
* Production builds enable multiplayer only with an `https://` backend that is not localhost/private.
  Otherwise the "Race friends" button is hidden: no silent fallback (src/net/mp-config.js, unit-tested).
* Invite links always use the **frontend** page (`https://nightgrid.sameerkapil.com/?room=CODE`).
* The backend allows browser origins only from its exact `ALLOWED_ORIGINS` list. That covers HTTP
  (CORS with OPTIONS preflight, origin echoed exactly, `Vary: Origin`, no wildcard, no credentials) and
  WebSocket upgrades (Origin checked; foreign → 403).
* Builds must match. Both sides compute `node scripts/build-id.mjs` from the same commit. The frontend
  publishes it in `/ng-build.json`; the backend reports it at `/` and `/api/health`. The env URL does not
  change the id. A client on a different build is refused with "reload to update".
* Rollback: M3 production stays at **53af096** on Vercel's production branch
  `claude/admiring-meitner-db4ejz`. That branch is not pushed until a separate release approval.

## Live deployment record

| Item | Value | Source |
|---|---|---|
| Staging backend | `https://nightgrid-mp-staging.sameerkapildesigns.workers.dev` | deployed by Sameer from his Mac, 18 Nov 2026 11:54 IST |
| Commit / build id | f29795d / `572c37df8548` | `/` and `/api/health` report it (independently checked) |
| Staging `ALLOWED_ORIGINS` | `https://nightgrid.sameerkapil.com`, `https://nightgrid-n7ywtk36c-sameerkapildesigns-9405s-projects.vercel.app` | persisted in `wrangler.toml` `[env.staging.vars]` |
| Vercel preview (hosted test) | `https://nightgrid-n7ywtk36c-sameerkapildesigns-9405s-projects.vercel.app` | Preview env `VITE_MP_API_BASE` = staging URL |
| Production backend | not deployed | separate release gate |
| Production frontend | M3, 53af096 (public build hashes match a rebuild) | unchanged |
| M3 rollback candidate | `nightgrid-h9edolozq-sameerkapildesigns-9405s-projects.vercel.app` (protected) | **source commit still to be confirmed** in Vercel → Deployments → that deployment → Source (expected 53af096) |

The first staging deploy passed `--var ALLOWED_ORIGINS:…` on the command line. That value now lives in
`wrangler.toml`, so a plain redeploy from this branch keeps it:
`sh scripts/deploy-backend.sh staging --deploy`.

**Every new Vercel preview deployment has a new per-deployment URL.** Its exact origin must be added to
`[env.staging.vars] ALLOWED_ORIGINS` (no wildcards), then staging redeployed. Otherwise "Create room" is
blocked by CORS.

## Who does what

| Step | Who | Notes |
|---|---|---|
| Code, tests, local dry runs, docs | assistant (done on `claude/m4-multiplayer`) | no account access |
| `npx wrangler login` | **Sameer, on his Mac** | the OAuth token stays on his Mac; never paste tokens or passwords into chat |
| Backend deploys (staging, then production) | **Sameer runs** `sh scripts/deploy-backend.sh …` after approving | the script confirms the account (`wrangler whoami`) and asks "yes" |
| Vercel env var `VITE_MP_API_BASE`, preview test, production promotion | **Sameer** in the Vercel dashboard | |
| Adding the exact preview origin to `ALLOWED_ORIGINS` | assistant edits `wrangler.toml` on the branch once Sameer shares the preview URL; Sameer redeploys | the URL is public |

Alternative (not recommended, needs its own explicit approval): the assistant runs wrangler remotely
with an OAuth flow that Sameer approves in his browser for that remote machine only. No credentials or
tokens are ever copied from the Mac.

## Runbook (Mac, Apple silicon M1 Pro)

0. **Prereqs:** `node -v` (20+), git. Repo checkout:
   `git fetch origin && git checkout claude/m4-multiplayer && git pull --ff-only && npm ci`
1. **Local confidence (optional):** `npm test && npm run test:net`
2. **Dry run (uploads nothing):** `sh scripts/deploy-backend.sh staging`
3. **Login (once, his Mac only):** `npx wrangler login`, then `npx wrangler whoami` (correct account?).
   Dashboard → Workers & Pages → **Plans** shows **Free**. Do not click Upgrade. Do not add a card.
   If Cloudflare asks to choose a `workers.dev` subdomain, that is a workers.dev name, **not** DNS for
   sameerkapil.com.
4. **Staging backend:** `sh scripts/deploy-backend.sh staging --deploy`
   → `https://nightgrid-mp-staging.<sub>.workers.dev`. Check:
   `curl https://nightgrid-mp-staging.<sub>.workers.dev/` prints `API ok` and the same build as
   `node scripts/build-id.mjs`.
5. **Frontend preview (Vercel):**
   - Project → Settings → Environment Variables: add `VITE_MP_API_BASE` = the staging URL, scope
     **Preview** (optionally restricted to branch `claude/m4-multiplayer`). Do not add it to Production yet.
   - Redeploy the latest preview of `claude/m4-multiplayer` and note its exact URL (`https://….vercel.app`).
   - Note: if Vercel Deployment Protection is on, only signed-in team members can open previews. That is
     fine for this test.
6. **Allow the preview origin:** share the preview URL. The assistant adds it to
   `[env.staging.vars] ALLOWED_ORIGINS`. Then pull and re-run `sh scripts/deploy-backend.sh staging --deploy`.
7. **Check (read-only):**
   `npm run check:deploy -- --frontend https://<preview>.vercel.app --backend https://nightgrid-mp-staging.<sub>.workers.dev`
   It checks: same build id, the frontend points at this backend, exact CORS echo, preflight 204,
   foreign origin 403.
8. **Hosted test:** Nothing Phone (3a) in Chrome + a second device on the **preview** URL.
   - Create a room, join by link, 2 humans + 2 bots, full race, rematch.
   - Airplane mode for ~5 s mid-race: the client reconnects to the same seat.
   - Check usage in the dashboard afterwards.
9. **Production (separate explicit release gate):**
   1. `sh scripts/deploy-backend.sh production --deploy` → `https://nightgrid-mp.<sub>.workers.dev`
      (`ALLOWED_ORIGINS` = `https://nightgrid.sameerkapil.com` only).
   2. Vercel: `VITE_MP_API_BASE` = production backend URL, scope **Production**.
   3. Release: only with a fresh approval, bring the reviewed commit to `claude/admiring-meitner-db4ejz`
      (Vercel production branch).
   4. `npm run check:deploy -- --frontend https://nightgrid.sameerkapil.com --backend https://nightgrid-mp.<sub>.workers.dev`
10. **Rollback:**
    - Frontend: Vercel → Deployments → the M3 deployment (commit 53af096) → Instant Rollback /
      Promote. Single-player M3 does not use the backend.
    - Backend: `npx wrangler rollback` (previous version), or `npx wrangler delete` for the staging name.
      DNS is never involved.

**Order matters:** deploy the backend first (same commit), then the frontend. If they differ,
players see "Your game version differs from the room server. Reload the page to update."

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

## What has and has not been tested

* `server/worker.js` (Worker routing, Registry DO, Room DOs, WebSocket Hibernation API accept, attachments,
  storage, alarms, CORS/Origin allow-list) runs in **local workerd** via `wrangler dev` (no account, no login):
  `npm run test:worker`, 4/4 (docs/evidence/m4/worker-wrangler-tests.txt).
* Cross-origin hosted shape (frontend on one origin with no API, backend in local workerd on another,
  `VITE_MP_API_BASE` build): `npm run test:xo` (docs/evidence/m4/xo-cross-origin.txt).
* `wrangler deploy --dry-run` bundles both the production and staging configs locally. This found and fixed two DO-only bugs: eviction lost
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
* `wrangler.toml` uses only Free-compatible features: SQLite DOs and vars (no static assets: the frontend is on Vercel). No KV, R2, D1,
  Queues, Logpush, paid observability or custom domains.
