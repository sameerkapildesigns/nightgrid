# M5: local-first multiplayer sync and ghost rooms

Branch `claude/m5-local-first-sync` (base 670be01 + 80c3f5f config). Network build id changes to the value printed by
`node scripts/build-id.mjs` (ff3815343186 at 24f6b33): the room Worker and the frontend must ship together.

## Symptom
Two people on two M1 Pro laptops: "positions fluctuate". Intent: approximate is fine, own car local, remote cars
smooth and loose, no visible hard snaps; laps, finish order and results stay server-authoritative.

## Diagnosis (code + measurement)
1. **Two timelines on one screen.** The local car is predicted at server step + lead (100-300 ms measured). Remote
   cars were drawn by snapshot interpolation at `serverNow - 120 ms` (netcode.js `Interpolator`, game.js mpFrame).
   Relative to you, a remote car was shown 13-24 m (p50) behind where it really was. The HUD position (`sim.ranks`
   over those mismatched values) therefore flipped 2-9x more often than the true order.
2. **Fixed 120 ms interpolation delay.** At 200 ms RTT / 60 ms jitter the buffer underran ~4000 times per client and
   fell back to bounded extrapolation: ~117 per-frame remote velocity spikes > 20 m/s.
3. **Own car at 120 Hz.** The worker publishes a view every second 8 ms tick (`publishMs = 12`), i.e. every
   16.7 ms. On a 120 Hz display half the frames repeated the local car (and chase camera) and the next doubled it.
4. **Contact.** The server had car-to-car contact (`collideRacers`); the predictor contains only the local car, so
   every contact arrived as an own-car correction.

## Changes
- `src/client/present.js` (page-only):
  - `RemotePresenter`: remote cars dead-reckoned along the track from the newest snapshot to the local
    presentation step; differences when newer snapshots arrive become a visual offset decaying at 4/s, closing at
    <= 25 m/s; snaps only > 30 m, branch change or crash (counted). Crashed cars are held; finished cars keep
    being dead-reckoned (the server keeps driving them; holding them slid them backwards, see HOLDBUG evidence).
    Horizon <= 1 s.
  - HUD position: server finish order first, then progress in the local timeline with a sticky +-2 m band.
  - `OwnSmoother`: local car between worker views via a presentation clock (<= 50 ms extrapolation from
    finite-difference rates); slower visual correction decay (5/s vs worker 12/s), capped at 6 m.
  - `stepOf` / `stepAt`: local step from the view's sim time (no change to the worker or protocol).
- `src/client/game.js`: wiring (snapshot -> presenter; own smoother; remote sampling at the same instant; HUD).
- Ghost rooms (approved 18 Nov 13:30): `sim.ghost` (default false: single-player keeps contact). Room server sets
  it; it travels in the snapshot; predictor sets it. No car-to-car push/impulse/bump for humans and bots. Kept:
  walls, drones (road traffic), slipstream, near-miss scoring, AI avoidance steering.

## Evidence (raw JSON in `evidence/m5/`; one run each, seeds recorded, not paired)
Headless Node over real WebSockets against `server/local.mjs` with in-order netsim jitter; the shipping netcode
plus the page presentation math. Not GPU / real-hardware evidence.

| metric | before (`base-*`) | after (`new-*`) |
|---|---|---|
| displayed gap error vs server truth p50, 0 / 100-30 / 200-60 | 13.8 / 16.7 / 23.1 m | 0.22 / 0.21 / 0.43 m |
| HUD position flips vs true flips (tight runs) | 9-56 vs 4-8 | 3-6 vs 4-6 |
| remote per-frame velocity spikes > 20 m/s, 200-60 | ~117 | 1-2 |
| own car repeated frames at 120 Hz (`cadence2-*`) | 917 / 1832 | 0 / 1832 |
| own car per-frame error p99 at 120 Hz | 0.955 m | 0.068 m |
| remote per-frame error p99 / max at 120 Hz | 0.096 / 0.132 m | 0.095 / 0.126 m |
| full 4-car race 200-60: HUD rank wrong frames (gap > 3 m) | 38-41% (36-37%) | 2.1-3.1% (0.3-1.1%) |
| full race: remote hard snaps / max per-frame jump | n/a / 3.9 m | 0 / 1.44 m |
| forced overlaps (bots teleported onto human 1), own correction max | 0.81 m (contact on, control) | 0 (ghost) |

Remote p50/p95 per-frame error at 120 Hz rose slightly (0.002/0.035 -> 0.013/0.070 m): the soft offset gliding.

## Reproduce
```
npm ci
node tests/net/smooth.mjs --mode base|new --lag 200 --jitter 60 --tight [--full] [--bots-onto 1 [--contact-on]] --out evidence/m5/X.json
node tests/net/cadence.mjs --mode base|smooth --hz 120 --secs 15 --lag 100 --jitter 30 --out evidence/m5/Y.json
node scripts/smooth-summary.mjs evidence/m5/*.json
npm test        # unit, incl. tests/unit/present.test.mjs, tests/unit/ghost.test.mjs
```

## Known gaps
- Slipstream from other cars is still server-only, so occasional own corrections remain (seen up to ~0.5 m, soft).
- Scripted drivers never produced natural contact; ghost was verified with forced overlaps and unit tests.
- Browser `postMessage` queueing is not modelled in the cadence bench (Node delivers views synchronously).
- No physical M1 Pro measurement from this environment.
