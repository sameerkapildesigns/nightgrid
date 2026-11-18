# NIGHTGRID running handoff (M5 local-first sync)

Chat counter: big 1, small 2 (rotate at 5 big or 10 small).

## Verified state (git remote read 13:2x 18 Nov)
- origin/main, origin/claude/admiring-meitner-db4ejz: 53af096 (M3). Do NOT push either. Production-linked branch is UNRESOLVED.
- origin/claude/m4-perf-fix: 670be01 (live frontend build). origin/claude/m4-multiplayer: 80c3f5f (live backend + 3-origin config).
- Work branch (local only, not pushed): `claude/m5-local-first-sync` = 670be01 + merge of 80c3f5f (config/docs only: wrangler.toml staging ALLOWED_ORIGINS, deploy doc). No conflicts.
- Previous chat's uncommitted work: not visible from this container (fresh clone). Nothing to preserve here.

## Standing rules
No pushes to main/production candidates; no micro-pushes (Vercel previews). No Cloudflare/DNS/Vercel actions. No spend, no resets. Report via Instinct only. Release only after exact production branch is confirmed + explicit release instruction. Tested facts separate from assumptions; software-renderer FPS is not hardware evidence.

## Build id (computed, scripts/build-id.mjs)
- Live/backends: 572c37df8548. This branch: 572c37df8548 (no src/core, src/net, room-server, package.json change). Recheck before any release.

## Diagnosis (verified in code + measured)
- Server has car-car contact (sim.js collideRacers) + slipstream; predictor removes other cars -> contact arrives as own-car correction.
- Own car drawn at server step + lead (100-300 ms); remotes were drawn at serverNow-120 ms -> displayed gap error 13-24 m p50; HUD P# flipped 2-9x more than truth.
- Fixed 120 ms interp delay underran ~4000x at 200/60 -> velocity spikes.

## Done
- tests/net/smooth.mjs harness (+ scripts/smooth-summary.mjs); raw JSON in evidence/m5/ (base-* = before, new-* = after).
- src/client/present.js RemotePresenter: remotes dead-reckoned to local step + soft offset (250 ms tau, <=25 m/s close, snap >30 m counted); sticky HUD rank (+-2 m band); stepOf(view.time) == Predictor.seq (0 mismatches).
- game.js wired (snap event -> presenter; HUD rank). Interpolator no longer used by page.

## Next
- 120 Hz worker->page cadence bench (own car), injected-contact own-correction tuning (client-only), full race + same-room rematch, unit/net/e2e/browser tests, build.

## Repro
- npm ci; node tests/net/smooth.mjs --mode base|new --lag 100 --jitter 30 --secs 40 --tight [--shove 2] [--ram] [--full] --out evidence/m5/X.json; node scripts/smooth-summary.mjs evidence/m5/*.json
- Netsim jitter is in-order (FIFO, like TCP); no seed control for netsim jitter (Math.random); race seed is in each run's server log only.

## Tests/gaps
- Natural human contact not yet produced by scripted drivers (ram attempt: 0 contact steps); using injected shoves as a proxy.
