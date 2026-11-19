# Release 2 local validation addendum, 19 Nov 2026

Claude-generated implementation reviewed on actual d60cfa9 baseline. Original downstream notes below preserve earlier generation limits and are historical, not the final state.

- Both ships passed actual mobile-size garage and race checks with no page errors and active exhaust particles. Real-phone performance remains unmeasured.
- Two-client local Worker race selects Kestrel and Manta; recovery assist confirmed off in both predictors.
- Catch-up snapshot flag added during review with JSON restore/deterministic continuation regression test.
- Intended old roster/first NPC expectations updated.
- Five actual CC0 source files downloaded by the release reviewer; source/license pages read directly and complete files passed automated no-speech checks. MP3s encoded locally, 15ms in/25ms out ramps, all below2.5MB. Mapping enabled. Human taste and musical-seam listening remain unverified. Source credits shipped in public/licenses/music-credits.txt.
- No live push or deploy performed in this review. Claude Code UI separately confirms repo connection and branch visibility, not main write permission.

Final validation at 19:10 IST:
- 305/305 actual repository unit tests pass.
- Production/test builds pass. Actual production browser selects both ships with debug absent and no page errors.
- Three focused actual local Worker tests pass, including two-client Kestrel/Manta plus GHOST bot Casino Mine/EMP race.
- Five actual local MP3 files play per map with no decode errors; error fallback is unit-tested.
- Ambient and engine idle default levels verified silent in browser; ambient opt-in restores original level.
- Laps/NPC persistence and same-map private-room isolation browser check passes.
- Secret scan: 0 findings. No full soak/matrix or hosted CPU measurements.

## Original generation report (historical)

# NIGHTGRID Release 2: partial implementation notes (19 Nov 2026)

Base: d60cfa9 / build 05bac0276941. The source came from the in-message ZIP (12 files). Not pushed, not deployed.

## Changed files
| File | Change |
| --- | --- |
| `src/core/catchup.js` (new) | Solo-only catch-up assist. Pure module. |
| `src/core/sim.js` | `sim.catchup` flag (default false). `updateCatchup()` runs each racing step. Player caps × `r.catchMul`. Lap integrity gains `assist`. |
| `src/core/records.js` | `integrity.assist` → lap rejected (`catch-up-assist`). |
| `src/client/music-map.js` (new) | Per-map track table and fallback rule. Pure. |
| `src/client/music.js` | Uses `musicSource()`. A failed new file falls back for the rest of the session. |
| `src/client/audio-mix.js` (new) | Ambient and engine-idle levels. Pure. |
| `src/client/proc-ships.js` (new) | KESTREL and MANTA builders: original procedural ships. |
| `src/core/roster.js` | `kestrel`, `manta` (kind `ship`, `proc: true`) added to `CAR_KEYS` after the six approved models. |
| `src/core/room.js` | `CARS_OK` += kestrel, manta. **Needs a paired Worker release.** |
| `src/client/game.js` | Settings: catch-up, ambient, engine idle. Proc-ship loader branch. Ship livery roles `neonMat` / `accentMat`. Garage source text, car tag, `FB_MAP`. |
| `index.html` | Three settings rows; credits line for the original ships. |
| `tests/unit/*.test.mjs` | New tests: catchup (9), music-map (3), audio-mix (3), proc-ships (4). |
| `scripts/catchup-bench.mjs` | Full-race on/off bench. |

## 1. Catch-up assist
- Solo only. Engages when the player is more than 6 s behind the nearest racer ahead, at 62 m/s of progress per second (the same constant as the NPC rubber band).
- Smoothstep from +0 % at 6 s to +5 % at 14 s on the player's own normal and boost caps.
- NPC code is untouched. Within 6 s it is exactly off, and runs are bit-identical to off (tested).
- Off when `sim.ghost` is set (rooms), when the room server is running (it never sets `sim.catchup`), when there is more than one human, after finishing, and under autopilot.
- Laps with the assist active don't count for records.
- Settings > Catch-up assist: default **On**, persisted.

**Measured** with `node scripts/catchup-bench.mjs`. Setup: baseline sim.js + main 0af38c2 maps/track/hazards + a weapons stub, 3 NPCs, input-only test driver (a crude bot, not a human):

| Map | Case | Off | On |
| --- | --- | --- | --- |
| Kage | driver waits 15 s on the grid | 23.0 s behind the last NPC | 11.8 s |
| Kage | waits 0 s / 30 s | no change | ≤0.2 s change |
| Legacy | waits 0 s | 19.1 s | 17.5 s |
| Legacy | waits 30 s | 186.9 s | 187.3 s |
| Velocity | all cases | stuck / no change | no change |

The bot gets stuck or crashes on Velocity and in some Legacy runs, so these numbers don't show real-player balance. The only conclusion they support: the assist is capped, and it helps when top speed is what limits the player. It does nothing for time lost in corners. **A human playtest is required before calling the balance done.**

## 2. Music
- Mapping done and tested. **Assets PENDING**: opengameart.org is blocked from the build sandbox, so no file was downloaded, heard or loop-checked.
- While every `ready` flag is false, output is identical to the pre-R2 mapping (tested). Casino and Summit currently play race-0.
- An automated page read confirmed CC0 for Melodic EDM Loops and Funky House only.
- Second Cruise and Slampe: the license and author fields came back blank. MicroWave: the page couldn't be read (robots).
- Funky House: its page says the seamless-loop version is in Loop Box #4, not the posted file.
- To ship: drop `public/audio/race-{velocity,kage,casino,summit,legacy}.mp3` (≤2.5 MB, ~128 kbps), confirm no vocals and a clean seam by listening, set `ready: true`, and add credits plus NOTICE lines.

## 3. Original ships: KESTREL (AG-K7) and MANTA (AG-M3)
- KESTREL: twin-hull catamaran with canards, swept wing, pod fins and 3 nozzles.
- MANTA: wide delta body with a ring-duct engine, tip fins, dorsal blade and flank intakes.
- 5 merged meshes each, about 2.9k / 2.7k tris. Built once per session; instances share geometry. `disposeProcShip` is available.
- Both go through the existing `buildCar` ship path: scaling, livery, emitters, shadow, underglow.
- Rendered headless (Chrome + SwiftShader, standalone viewer) for visual checks.
- **Not checked:** in-game garage and race rendering, emitter trails in motion, the mobile frame rate, and two clients picking them in a room.
- Rooms need the Worker with the new `CARS_OK`. An old server rejects them with `bad-car`.
- The baseline's own roster test, if it asserts exactly six keys, needs updating to the eight keys.

## 4. Audio audit
Always on before this change, from the first gesture onward, on every screen:
- hum: 140 Hz low-passed noise at 0.22
- rain: 1.2–7 kHz noise at 0.035
- engine idle floor: 46 Hz saw + ~24 Hz square, Q5 low-pass, 0.09, 6.5 Hz vibrato
- 600 Hz sine at 0.006

What changed:
- Settings now has **Ambient rain & city hum** (default Off) and **Engine idle hum** (default Off).
- With idle Off, the floor fades in with throttle or speed. It is identical to before at throttle 1 or ≥20 % speed, and silent when parked or in menus.
- Turning both On reproduces the old mix exactly (tested).
- Music, wind, drift, scrape, impacts, beeps and weapon cues are unchanged.

## 5. Building pop
Not reproduced. No change made. The only distance culling in game.js is `cullGround()`, which affects ground tiles only and is horizontal-only beyond 3/fog-density. The building code (`src/client/env/skyline.js`, `env/circuit-landmarks.js`) was not in the ZIP. Needed:
- map name and variant
- rough spot (sector name, or seconds after the start line)
- chase or cinematic camera
- quality mode
- a short screen recording or two frames (before and after)
- those two files

## Tests run
- Upstream main 0af38c2 + catch-up patch: `npm test` passed 202 / 0.
- Baseline overlay on main with a weapons stub: all new tests pass.
- 8 old main tests fail against baseline files:
  - 7 of those also fail without these changes (main's tests vs baseline code).
  - The roster "six models" test fails because of the intended roster change.
- Not run: the baseline's own test suite, vite build, e2e, multiplayer, and the in-browser game. The missing source modules made these impossible.
