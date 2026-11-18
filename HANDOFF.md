# NIGHTGRID running handoff

## M8 Friday (19 Nov 03:5x IST) — CHECKPOINT, NOT AN RC. Local only, nothing pushed/deployed.
Chat counter (M8 gameplay chat): big 5 (A1 core, B1 visuals, C1 contested test, visual merge, MP feedback gate), small ~4 -> ROTATE NOW.
- Branch claude/m8-friday, base bee26ee (frozen fallback claude/m7-rc20 untouched, build 0661cad63d2e).
- Build id f3edabcf36a8 (core/net/server changed by M8-A1 -> paired Worker+frontend release only after approval). wrangler.toml byte-identical (sha256 f411d961...).
- Visual lane C m8-visual-r2 7a87497 merged (env/* byte-identical, hooks H1-H13 identical). Design: docs/M8-HAZARDS.md, docs/M8-VISUALS.md.
### Gates on the current head
- PASS: unit 170/170 (unit-M2); net 20/20 (net-C1, core identical since); contested real-WS incl. feedback gate (contested-M2);
  e2e 116/116 + rain 6/6 (e2e-M1, merged head before gate commit); prod build ng-build.json f3edabcf36a8; worker dry-run EXIT 0 (bundle f3edabcf36a8);
  rematch/leave two-round matrix n=2,3,4 (rounds-C1, rounds-M1-4-8), n=8 (rounds-M1-8, run alone), n=20 10h+10b (rounds-M1-20).
- FAIL (unclassified, not hidden): rounds-M1-4-8: n=8 'canStart' timeout as the 2nd room after n=4 in the same server; n=8 alone passed. Root cause not found (suspect test-side ordering of config vs ready across sockets).
- FAIL test:mp (mp-M1): 28/30. 'B-4h: every player is racing' (2 of 4 browser clients never left the grid: prog -14/-28) and 'suite crashed (page closed)' late in the run. Host 2 cores, SwiftShader ~1 fps. Same suite NOT yet re-run on bee26ee for A/B -> classify before release.
- NOT RUN yet: test:worker (local workerd) on merged head (was queued after test:mp).
### Next (bounded)
1. Run test:mp on bee26ee and on head, same host, to classify B-4h + crash (~30 min each). 2. test:worker on head (~10 min). 3. n=2,8 back-to-back repro of canStart (~10 min).

# NIGHTGRID running handoff

## M8 visual lane (19 Nov, local only, nothing pushed) -> see docs/M8-VISUALS.md
- Branch claude/m8-visuals on claude/m7-rc20 @ bee26ee. Build id UNCHANGED 0661cad63d2e (client-only: src/client/env/* + tagged hooks H1-H13 in game.js).
- Themes: Velocity "Neon Heights" (cyan/violet, setbacks/spires/halo rings, edge fins), Kage "Harbour" (dusk sky + sun, warehouses/sawtooth, containers, gantry cranes, bollards, teal ground), Legacy "Neon Rain" (magenta palette, heavier rain, posts).
- Hover taxi: procedural, 620 tris, 2 materials, instanced: 7 taxis 49 -> 4 draw calls; contact box (core) untouched.
- Measured (SwiftShader, same poses): calls -27..+11, tris +4.9..+21.0% per view (Kage taxi close-up +21.0/+20.3%; most +5..+14%). Cell-baking perf pass rejected: tris -5.6k..-52.9k but calls +1..+37 (> +10 cap); kept on local branch claude/m8-bake-experiment. (evidence/m8/RENDER-DELTAS.md) No hardware/20-device FPS claimed.
- Unit (npm test) 158/158. test:e2e not run (no Playwright browser bundle in container); visual-shots run with no page errors.

## (older) M5 local-first sync

Chat counter (M6 chat): big 2, small 0 (rotate at 5 big or 10 small).

## M6 bug audit (18 Nov, local only, nothing pushed)
- Base 789aaa0. claude/m6-bugfix-audit @ M6-A = client-only, build id ff3815343186 UNCHANGED (no Worker redeploy).
- claude/m6-net-hardening (worktree ../nightgrid-b) = M6-A + NetClient fixes, NEW id aa3abbdf842b -> paired Worker+frontend release.
- Confirmed+fixed: B1 double Create -> 2 rooms + orphan socket (A: lobby busy until welcome; B: connect() replaces old socket);
  B2 reconnect retry reset on open -> endless loop if server opens then drops (B only); B3 MP winner never saw VICTORY (fo lags, index+1=0) (A);
  B4 Copy code always said copied (A).
- Not reproduced: stale 'closed' from old socket killing new room (L2 passes on base). Not yet audited: late join/tab hide/reconnect in countdown, SP restore, asset failure UX, mobile orientation.
- Tests: unit 126/126 (A,B); browser lifecycle 5/5 (A); test:net 19/19 (B); finish-pos full race (A logic). test:mp on A: scenario A-2h2b all PASS, then STOPPED by scope change (crash line = my kill). Remaining test:mp + test:worker for B still to run before merge.


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

## M5-6 finish fix + full races (200/60, ghost server)
- Review fix 'hold finished cars' REGRESSED: finished cars slid backwards after the line, 30 hard snaps/client (fullrace-new-200-60-HOLDBUG.json). Server keeps finished cars driving -> dead-reckon them; horizon bounds when snapshots stop. Test 'crossing the finish line' fails on the hold version, passes now.
- fullrace-base-200-60.json: wrongRank 38-41% (36-37% at gaps >3 m), gapErr p50 22-24 m, dv>20 1325-1559. fullrace-new-200-60.json: snaps 0, wrongRank 2.1-3.1% (0.3-1.1% >3 m), gapErr p50 0.64-0.75 m, dv>20 1. Results identical on both clients in both runs.
- Unit 126 (present.test 14 + ghost 5).

## Next
- 120 Hz worker->page cadence bench (own car), injected-contact own-correction tuning (client-only), full race + same-room rematch, unit/net/e2e/browser tests, build.

## Repro
- npm ci; node tests/net/smooth.mjs --mode base|new --lag 100 --jitter 30 --secs 40 --tight [--shove 2] [--ram] [--full] --out evidence/m5/X.json; node scripts/smooth-summary.mjs evidence/m5/*.json
- Netsim jitter is in-order (FIFO, like TCP); no seed control for netsim jitter (Math.random); race seed is in each run's server log only.

## Tests/gaps
- Natural human contact not yet produced by scripted drivers (ram attempt: 0 contact steps); using injected shoves as a proxy.
