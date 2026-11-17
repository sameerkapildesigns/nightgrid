# NIGHTGRID

Anti-gravity night-city racer (Three.js). This branch is **M1, the portable single-player
baseline**. The v5b single-file game is restructured into a Vite + ES-module project with a pure,
testable simulation core. Gameplay, the six detailed models, maps and UI are preserved.
Nothing here is deployed.

## Run

```bash
npm install
npm run dev          # http://127.0.0.1:5173 (debug hooks + QA panel on)
npm run build        # production build -> dist/ (debug code compiled out)
npm run preview      # serve dist/
```

## Test

```bash
npm test             # unit tests (Node, no browser): track parity, sim, clock, records, roster, core purity
npm run test:e2e     # builds dist-test/ + dist/, Playwright/Chromium parity checks -> test-results/
npm run measure      # cold/warm startup + transfer, v5b vs M1 -> docs/measurements.json
npm run scan         # secret / PII scan of tracked files
```

## Layout

| Path | Owns | Depends on |
|---|---|---|
| `src/core/` | **Pure** simulation: track generator (`track.js`, verbatim v5b), map catalogue + track data + frame sampling (`maps.js`), racer physics / AI / collisions / laps / drones (`sim.js`), fixed-step clock (`clock.js`), lap-record validation + storage interface (`records.js`), roster + load policy (`roster.js`), `vec.js`, `math.js` | nothing outside `src/core` (no DOM, no Three.js; enforced by `tests/unit/purity.test.mjs`) |
| `src/client/` | Browser: renderer, post-FX, world/city/props meshes, GLB loading + car building, garage, exhaust/sparks/rain, camera, HUD, audio, input + touch, cinematics, map switching, boot, main loop | `three`, `src/core` |
| `src/client/model-urls.js` | URLs of the original binary GLBs (content-hashed by Vite) | `assets/models/` |
| `assets/models/` | The six original GLBs (unchanged, see NOTICE.md) | — |
| `public/licenses/` | Licence texts shipped with the build | — |
| `reference/v5b-game.html` | The supplied v5b baseline, kept verbatim for parity tests and before/after measurement | — |

The simulation talks to presentation only through `sim.events` (flash, sfx, sparks, lap,
finish, …). The client reads racer state to draw it. `sim.step(SIM_DT)` advances one
fixed 1/120 s step.

## Timing model

* Fixed 1/120 s simulation steps, driven by **wall-clock** frame time. Below 20 FPS the race no
  longer runs in slow motion (v5b capped dt at 50 ms). Catch-up is bounded at 250 ms per frame,
  which keeps real time down to 4 FPS.
* Frame gaps of 250 ms to 1 s simulate 250 ms and report the rest as dropped. Gaps of 1 s or more
  (tab suspension, debugger, sleep) are not simulated at all. A race is auto-paused for gaps of
  3 s or more and whenever the tab is hidden. Dropped time is never added to the race clock, and
  the cars don't move during it.
* The intro cinematic and countdown run on the wall clock. Shaders for every race material are
  precompiled and textures uploaded **before** the intro clock starts.
* FPS is measured on wall-clock frame times, so it can report below 20.

## Records and debug gating

* Laps are validated before they are stored (`src/core/records.js`): a physical speed bound
  (lap time ≥ lap length / 140 m/s), no forward position jumps, no autopilot, no debug session.
  Implausible values already in storage are ignored.
* Production build: `localStorage`. Dev and `--mode test` builds use an in-memory store, so
  automated or debug sessions cannot write a real record.
* `window.NG_DEBUG`, `window.__ng` and the QA panel exist only in dev and test builds. In
  production, `DEBUG` is a compile-time `false` and the code is removed.

See `NOTICE.md` for model attribution and licences, and `docs/M1-REPORT.md` for the M1 report.
