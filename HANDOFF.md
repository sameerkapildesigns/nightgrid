# NIGHTGRID running handoff (M5 local-first sync)

Chat counter: big 1, small 5 (rotate at 5 big or 10 small).

## Verified state (git remote read 13:2x 18 Nov)
- origin/main, origin/claude/admiring-meitner-db4ejz: 53af096 (M3). Do NOT push either. Production-linked branch is UNRESOLVED.
- origin/claude/m4-perf-fix: 670be01 (live frontend build). origin/claude/m4-multiplayer: 80c3f5f (live backend + 3-origin config).
- Work branch (local only, not pushed): `claude/m5-local-first-sync` = 670be01 + merge of 80c3f5f (config/docs only: wrangler.toml staging ALLOWED_ORIGINS, deploy doc). No conflicts.
- Previous chat's uncommitted work: not visible from this container (fresh clone). Nothing to preserve here.

## Standing rules
No pushes to main/production candidates; no micro-pushes (Vercel previews). No Cloudflare/DNS/Vercel actions. No spend, no resets. Report via Instinct only. Release only after exact production branch is confirmed + explicit release instruction. Tested facts separate from assumptions; software-renderer FPS is not hardware evidence.

## Build id (computed, scripts/build-id.mjs)
- Live backend/frontend: 572c37df8548. Up to b19be0f the branch was still 572c37df8548 (page-only).
- Ghost mode (approved 13:30, small task 3) changes src/core/sim.js, server/room-server.js, src/net/netcode.js -> NEW id (ff3815343186 at ghost commit; recompute before release). Release = ONE batch: Worker + frontend with the same id. Cloudflare step: ask parent; user runs it on his Mac.

## Diagnosis (verified in code + measured)
- Server has car-car contact (sim.js collideRacers) + slipstream; predictor removes other cars -> contact arrives as own-car correction.
- Own car drawn at server step + lead (100-300 ms); remotes were drawn at serverNow-120 ms -> displayed gap error 13-24 m p50; HUD P# flipped 2-9x more than truth.
- Fixed 120 ms interp delay underran ~4000x at 200/60 -> velocity spikes.

## Done
- tests/net/smooth.mjs harness (+ scripts/smooth-summary.mjs); raw JSON in evidence/m5/ (base-* = before, new-* = after).
- src/client/present.js RemotePresenter: remotes dead-reckoned to local step + soft offset (250 ms tau, <=25 m/s close, snap >30 m counted); sticky HUD rank (+-2 m band); stepOf(view.time) == Predictor.seq (0 mismatches).
- game.js wired (snap event -> presenter; HUD rank). Interpolator no longer used by page.

## Ghost mode (M5-3)
- sim.ghost (default false = single-player keeps contact); server sets true for rooms; carried in snapshot; predictor sets true. Removes car-car push/impulse/bump for humans+bots. Kept: walls, drones (road traffic), slipstream, near-miss scoring, AI avoidance steering. tests/unit/ghost.test.mjs (5).

## Evidence added (M5-3)
- ghost-100-30-botsonto.json: 56 forced bot-onto-human overlaps, own correction 0. control-contact-100-30-botsonto.json (contact on): up to 0.81 m.
- ghost-200-60-fullrace.json: full 4-car race 200/60, results identical on both clients; server starved 0.
- evidence/m5/test-net-ghost.log: test:net 17/17 incl. same-room rematch, after ghost.
- Interrupted/not produced: base vs new full race with wrongRank split (rerun pending); drawn-jerk metric (inconclusive on main-thread path, superseded by cadence bench).

## Review fixes (small 5)
- Finished remote cars no longer dead-reckoned (held + glide); remotes sampled at fractional stepAt(OwnSmoother.t) -> no repeats at 120 Hz; own HUD prog advanced with smoothed s; OwnSmoother resets on any backwards view time.
- tests/unit/present.test.mjs (13): wrap, branch, crash, finished, out-of-order/missing k, horizon, snap, soft cap, rank band + server finish order + rematch, stepOf/stepAt, OwnSmoother cadence/bounds/reset/wrap, softCorr; asserts WORKER_CORR_RATE == netcode SMOOTH_RATE.
- smooth.mjs: config ack on all clients before ready; try/finally cleanup. cadence.mjs: remote cars at 120 Hz (cadence2-*.json).
- Unit 124/124, build id ff3815343186. Headline numbers are per-run (seed/noise differ), not paired guarantees.

## Next
- 120 Hz worker->page cadence bench (own car), injected-contact own-correction tuning (client-only), full race + same-room rematch, unit/net/e2e/browser tests, build.

## Repro
- npm ci; node tests/net/smooth.mjs --mode base|new --lag 100 --jitter 30 --secs 40 --tight [--shove 2] [--ram] [--full] --out evidence/m5/X.json; node scripts/smooth-summary.mjs evidence/m5/*.json
- Netsim jitter is in-order (FIFO, like TCP); no seed control for netsim jitter (Math.random); race seed is in each run's server log only.

## Tests/gaps
- Natural human contact not yet produced by scripted drivers (ram attempt: 0 contact steps); using injected shoves as a proxy.
