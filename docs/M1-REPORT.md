# NIGHTGRID M1: portable single-player baseline (report)

Branch `claude/admiring-meitner-db4ejz` in `sameerkapildesigns/nightgrid`. **Not deployed. Not a
shipped release.** Scope is M1 only: no rooms, networking, accounts, new models or maps, and no
geometry or LOD changes.

## 1. Baseline inspected

* Supplied `source/game.html` (v5b, 3,353 lines / 250 KB) is kept verbatim as `reference/v5b-game.html`.
  It held all CSS, HTML, the pure `TRK` track generator and one 2,700-line module script that
  imported three@0.170.0 from jsDelivr.
* Models: v5b fetched `./models/<car>.glb.b64.txt` (base64 text, about +33 % size) with a jsDelivr
  fallback for the five Collect Cars models. At boot it **awaited three cars** (hypercar,
  endurance, wedge) and then lazily downloaded **the whole roster** in the background.
* Timing: `dt = min(frameDt, 50 ms)` with ≤1/120 s substeps. **Below 20 FPS the race and its
  clock ran in slow motion**, and the FPS readout averaged the capped dt, so it could never report
  below 20.
* Records were written from any lap, including laps set by the automated tests (the v5b flow
  test teleports the car and stores a 40 s Velocity lap, which is physically impossible on a
  5.87 km track).
* `window.NG_DEBUG` / `window.__ng` and the QA button were always present.
* Asset archives: `assets-1` was attached twice; both uploads are byte-identical (same MD5),
  so it was used once. All six GLBs match the archives by SHA-256 (see NOTICE.md).

## 2. Module boundaries

| Module | Owns | May import |
|---|---|---|
| `src/core/track.js` | v5b `TRK` generator, **verbatim** | — |
| `src/core/maps.js` | map catalogue (names, laps, widths, sectors as CSS colours), per-map track data (`buildTrackData`), frame sampling (`frameAt`, `raceS`, `rdist`) | core only |
| `src/core/sim.js` | racers, player physics, AI (Normal/Hard), collisions, slipstream, near-miss, laps, sectors/splits, finish order, drones, crash/respawn. It reports side effects as **events**. | core only |
| `src/core/clock.js` | fixed-step accumulator, catch-up bound, stall detection, wall-clock FPS meter | — |
| `src/core/records.js` | lap validation (physics bound + integrity flags), injected record storage | — |
| `src/core/roster.js` | the six cars, liveries, rivals, load-order / race-readiness policy | — |
| `src/client/game.js` | everything with a DOM or Three.js dependency (moved from v5b): renderer and post-FX, world/city/props, GLB loading and car building, garage, FX, camera, HUD, audio, input/touch, cinematics, map switching, boot, main loop. It subscribes to `sim.events`. | `three`, core |
| `src/client/model-urls.js` | hashed URLs of the original binary GLBs | assets |

Core purity is enforced by `tests/unit/purity.test.mjs`: no imports outside `src/core`, and no
`window`, `document`, `localStorage`, `requestAnimationFrame` or `THREE`. The whole race can run
headless in Node (`tests/unit/sim.test.mjs`).

## 3. What M1 changed

| M1 item | Implementation |
|---|---|
| Vite + ES modules | `vite@6.3.5`, `three@0.170.0` from npm (same version as the v5b CDN import). Debug builds via `--mode test`. |
| Pure core | See §2. Physics/AI code moved with the logic unchanged. Only these were swapped out: DOM/audio/FX calls (now events), `gameTime` (now `sim.time`), `keys` (now `sim.input`). |
| Binary GLBs | Original files are served as `model/gltf-binary` with content-hashed names. Base64 and the jsDelivr fallback are removed. |
| Selected car first, others on demand | Boot requests the **selected car** first. The garage appears once it has loaded. The **rival cars** (wedge, endurance; hypercar is shared) follow and gate "Race". Rally, Streamliner and Wipeout are fetched **only when selected**. The roster never blocks startup. |
| Fixed step + truthful clock | `SIM_DT = 1/120 s`, advanced by **wall-clock** frame time. Up to 250 ms per frame is simulated (real time down to 4 FPS). For gaps of 250 ms to 1 s, 250 ms is simulated and the rest is reported as dropped. Gaps of 1 s or more are a stall: nothing is simulated and the gap is counted. The race is **auto-paused for gaps of 3 s or more or a hidden tab** ("Auto-paused: the game was suspended for X s"). Dropped time never enters the race clock, and the cars don't move during it. The FPS meter uses wall-clock frame times. |
| Precompile before intro timing | On "Race": rival bodies are rebuilt if needed, then `renderer.compileAsync(scene)`, then every scene texture is uploaded with `initTexture`. **Only then** does the intro wall clock start. |
| Wall-clock intro / skip | The intro is timed as `performance.now() − introStart` (6.0 s, or 2.6 s with reduced motion). Enter, Space, the skip chip or a tap ends it. The countdown runs on wall time. |
| Debug gating | `DEBUG` is a build-time constant. Production has no `NG_DEBUG`, no `__ng` and no QA button (verified in e2e). |
| Impossible-record rejection | `validateLap`: rejects a lap faster than lap length ÷ 140 m/s, a forward position jump, autopilot, or a debug session. Garbage and implausible stored values are ignored. |
| Tests can't write real records | Dev and test builds use an in-memory record store. Production uses localStorage, with validation. |
| Licences | `NOTICE.md`, `licenses/` (originals + three.js) and `public/licenses/` (shipped). The Z-32S licence moved to `licenses/archived/`, and the model is not shipped. |

### Bugs found and fixed while porting (each is covered by a test)

1. **v5b input bug:** `#title > *{pointer-events:auto}` overrode `.overlay.hide{pointer-events:none}`.
   During races the *invisible* garage controls (car arrows, map buttons, chips) still caught
   taps and clicks, so a tap on the lower half of the screen could not skip the intro. Fixed with
   one CSS rule; there is no visual change.
2. **v5b fallback crash:** the procedural-fallback map had no entry for `rally` or `streamliner`,
   so a failed download of either would have thrown. Mapped.
3. **Shipped credits named the archived Z-32S.** Removed from the page (the licence is archived).
4. Found during M1 development and fixed before commit: an intro over-count (the intro could end
   about one frame early at very low FPS), a production-only crash when the QA panel markup was
   removed, and a duplicate `__ng.sim` key.

### Behaviour differences from v5b (deliberate)

* Below 20 FPS the race now runs in real time. In v5b it ran in slow motion.
* Racer random phases (AI noise and boost timing) come from a seeded simulation RNG. The
  procedural city keeps v5b's seed and stream, so the first map's city is unchanged.
* Rival bodies appear once their GLBs arrive, rather than all three cars being awaited at boot.
* Drone orientation uses the nearest 1 m track sample rather than an interpolated frame
  (visually indistinguishable at 1 m).

## 4. Commands run and results (this session)

| Command | Result |
|---|---|
| `npm test` | **27/27 pass**: byte-for-byte v5b track parity on all 3 maps (v5b `TRK` evaluated straight from the reference HTML), map catalogue, headless races on all maps, determinism, Hard faster than Normal, autopilot/teleport laps flagged, a lap driven only through keyboard input validates, clock (60/20/10/5/4 FPS ⇒ race time = wall time; 600 ms hitch; 5 s stall; slow-mo), records, roster, core purity |
| `node tests/e2e/run.mjs` | **70/70 pass** (final build, after the garage/touch fixes). See `docs/evidence/e2e-results.json` |
| `npm run build` | OK. `index.js` 751 KB (212 KB gzip), CSS 24 KB, six GLBs at their original sizes |
| ESLint `no-undef`/`no-dupe-keys` over `src/` | 0 errors (16 unused-variable warnings, mostly inherited from v5b) |
| `npm run scan` | 0 findings |

E2E coverage: boot order and network (selected car requested first, only 3 GLBs at boot, no
base64 or CDN, served bytes = original sizes); roster (6 models, Hypercar default, no Z-32S, all
race bodies real glTF); on-demand loading (Off-roader fetches only `rally.glb`, Wipeout only when
selected, no refetch); garage arrows exactly **44×44** and on-screen at 1280×675, 844×390 and
390×844; all 3 maps build with v5b lengths and laps; Race → intro → Enter skip → countdown →
race → pause → restart → finish camera → Enter → results (5 rows) → race again → garage;
teleported test lap rejected and localStorage untouched; timing (10 FPS and 4 FPS frames ⇒ 1:1
race time, 600 ms hitch ⇒ +250 ms with 350 ms reported dropped, 5 s stall ⇒ not simulated and
auto-paused, clock frozen while paused, clean resume, hidden tab pauses, real-time invariant
"race + dropped = loop wall time", intro length on the wall clock); touch layout in landscape and
portrait (4 controls ≥ 44 px, on-screen, non-overlapping, credits strip 12 px tall and clear of
the controls, tap skips intro, auto-throttle drives); production build (no debug globals, Race →
intro → skip → countdown with no page errors).

## 5. Measurements

Command: `npm run build && npm run measure` (raw data in `docs/measurements.json`; script `scripts/measure.mjs`).
**Conditions:** headless Chromium 1.63 with SwiftShader software WebGL, 1280×675, 4-vCPU cloud
container, and one local Node static server for both builds (127.0.0.1, no compression,
`no-cache` + ETag). Fonts were aborted. One discarded warm-up navigation; before/after order
alternated. "Title" = loading screen done (garage visible). "Ready" = Race button enabled.
"Before" is the v5b HTML with its base64 model files and three.js routed locally. These are
local lab numbers, not device numbers and not acceptance targets.

| Condition | Metric | v5b (before) | M1 (after) |
|---|---|---|---|
| Local, cold (3 runs) | Garage visible | 958 / 989 / 936 ms | 890 / 696 / 660 ms |
| | Race enabled | 963 / 992 / 938 ms | 1531 / 1339 / **4475** ms |
| | Bytes transferred by Race-ready | 13.73 MB | 10.87 MB |
| | Bytes after 20 s idle in garage | **43.8 MB** (whole roster as base64) | **10.87 MB** (3 GLBs) |
| Throttled 20 Mbit/s, 40 ms RTT, cold (2 runs) | Garage visible | 6249 / 6247 ms | **3041 / 3888 ms** |
| | Race enabled | 6258 / 6934 ms | **10166 / 9535 ms** |

Honest reading:
* **Transfer:** M1 moves about 21 % fewer bytes before Race is enabled, and about 75 % fewer in a
  garage session, because it no longer downloads the roster in the background and sends binary
  instead of base64.
* **Garage visible:** M1 is faster, roughly 2× under throttling, because it waits only for the
  selected car.
* **Race enabled: M1 is slower** (about +0.4–0.6 s locally, plus one 4.5 s outlier, and about
  +3 s throttled). The likely cause is that rival cars are fetched *after* the selected car
  (selected-first ordering) instead of in parallel, as v5b did. Under Chromium's network emulation
  a parallel fetch appears not to share the bandwidth cap, which favours v5b. If the user prefers,
  rivals can be requested in parallel once the selected car's request has started. That is a
  one-line policy change, not made here.
* **"Warm" runs are not warm:** the server saw 0 × 304 and full 200 responses on every reload,
  because Playwright request routing (used to block fonts and route the CDN) disables the
  browser HTTP cache. The "warm" figures in the JSON are therefore cold repeats and should be
  disregarded. A real warm-cache measurement is unverified.
* The 4.5 s outliers coincide with SwiftShader frames of about 1–4 s. In this environment that
  noise is the same order as the effect. Real-device timings are pending.

## 6. Screenshots (`docs/screenshots/`, SwiftShader, from the e2e run)

`garage-desktop.jpg` (960×540, captured before the bar fix), `garage-960x540.jpg`, `garage-1024x576.jpg`, `garage-1152x648.jpg` (after the fix), `garage-wipeout.jpg`,
`garage-landscape-phone.jpg`, `garage-portrait-phone.jpg`, `intro.jpg`, `race.jpg`,
`results.jpg`, `touch-landscape.jpg`, `touch-portrait.jpg`.

## 7. Known issues and failures (not fixed in M1)

* ~~Garage bar overflow~~ **fixed after checkpoint review:** in v5b's CSS the desktop bar
  overflowed between 901 and 1279 px (Race off-screen at 1024×576, 1024×768 and 1152×648).
  For that range, the existing bar may now wrap onto a second row (circuit + Race). Nothing is
  resized or removed. e2e checks Race, both arrows (44×44) and all three circuit buttons
  on-screen, with no horizontal scroll, at 960×540, 1024×576, 1024×768, 1152×648, 1280×675,
  1366×768 and 1920×1080. Screenshots: `garage-960x540.jpg`, `garage-1024x576.jpg`,
  `garage-1152x648.jpg`.
* **Touch speedometer** (fixed after review, minimal offset only): in touch mode the speedometer
  cluster moves left of the Brake/Boost column (landscape), or above it on screens ≤ 600 px wide.
  e2e checks for no overlap. Trade-off: on a 390 px portrait phone the lifted speedometer now
  overlaps the lower part of the car view (see `touch-portrait.jpg`). It is not resized.
* **Clock caveat (by design):** simulation time is *dropped*, not caught up, for any frame gap
  over 250 ms. A gap from 250 ms to 1 s simulates 250 ms. A gap of 1 s or more simulates nothing,
  and 3 s or more (or a hidden tab) also auto-pauses the race. So below 4 FPS, or across a long
  stall, race time runs slower than wall time. Every dropped millisecond is counted (`droppedMs`,
  `stalls` in the debug clock) and never added to lap times. In this container SwiftShader runs at
  about 1–2 FPS, so a real-time sample showed 4.87 s of loop time = 1.43 s simulated + 3.43 s
  dropped. Real-time play could not be judged here.
* The first checkpoint commit carries a GitHub noreply-style author address based on the repo
  owner's handle; later commits use the session's default identity.

## 8. Not verified / pending

* **User laptop and phone testing is pending.** No real GPU or device was used.
* There is no numeric v5b-vs-M1 lap-time comparison. Physics parity rests on the moved code
  (logic unchanged), track parity tests and headless race sanity. Driving feel is unverified.
* Audio was not checked (headless).
* The proposed audit targets were **not** treated as acceptance numbers. The measurements above
  are local lab figures only.
* The v5b Python test scripts in the source archive were not re-run.
* Production record persistence in localStorage was exercised by unit tests (injected
  storage), not by an end-to-end human lap in a production build.

## 9. Source state

Commits on `claude/admiring-meitner-db4ejz`; see `git log`. Nothing is deployed and no pull
request has been opened.
