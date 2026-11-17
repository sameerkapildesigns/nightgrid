# M3: road clearance, rain occlusion, handling and pace (feature candidate, not released)

Branch `claude/m3-road-handling`, from released `4d430f1`. Evidence: `docs/evidence/*m3*`, screenshots
in `docs/screenshots/m3/` (matched before/after). All tests ran in a headless SwiftShader container,
not on a real device.

## A. Ground clearance (`src/core/terrain.js`)
- **Swept solid:** full road width + 1.4 m curb/rail strip, surface to +3.2 m along the surface normal
  (below the deck when inverted). Gantry zones (±16 m) widen it to 3.4 m / 15 m. Main + branch.
  The decorative hull skirt under upright road is not swept; it is buried by design, as in v5b.
- **Pits:** dug locally on a 2 m grid with 76° slope-limited embankments. Single-sided ground; matte
  retaining material on pit blocks only. Flat ground keeps the v5b material at y = −0.06.
- **Before → after**, worst raw intersection → slack (proof on the rendered triangles,
  0.25 m × 0.25 m with interpolated frames):

  | Map | Before | Location | After (slack) |
  |---|---|---|---|
  | Velocity | −15.67 m | s 3905, barrel roll | ≥ −1e-6 m |
  | Kage | −1.13 m | — | ≥ 0 |
  | Legacy | −3.79 m | — | ≥ 0 |

- **City foundations:** a direct per-cell proof keeps every pit inside the city's own building
  exclusion zone, and e2e confirms 0 buildings over pits on every map.
- **Limitations:** embankment walls are 76° and faceted at the 2 m grid. Velocity's deepest pit
  is 20.8 m (under the S3 gantry inside the barrel roll).

## B. Rain (`src/core/shelter.js`)
- **Mechanism:** a baked per-map map of the topmost covering surface per 4 m cell. It covers road
  decks (main + branch, full width + rails), tunnel roofs and sky-deck slabs. The shader hides a
  streak whose head is below that height. World gravity is unchanged, depthWrite stays off, and
  there are no CPU raycasts.
- **Frozen camera and weather, rain pixels (shelter off → on):**

  | Spot | Off → On |
  |---|---|
  | Velocity, inverted | 3,686 → 0 |
  | Legacy, inverted | 6,738 → 0 |
  | Legacy, tunnel | 1,788 → 0 |
  | Open road (3 maps) | 89–93 % of rain retained |

- **Cost:** shelter-on vs shelter-off render time is within SwiftShader noise (one texture fetch per
  vertex). Real mobile GPU cost is unmeasured.
- **Conservative limitations:**
  - Rain is also hidden up to one 4 m cell beside a deck or wall, below its top.
  - Buildings occlude only through the depth test (not baked).
  - Opaque car bodies occlude through the depth test; transparent glass does not.
- **Decision for review:** v5b's 280 m sky-deck slabs count as roofs. Rain is therefore now absent
  beneath them, including the Velocity and Legacy start areas. This is physically consistent but
  changes the atmosphere. Excluding the decks is a one-line change (`buildShelter(TD, DECKS)` →
  `buildShelter(TD)`).

## C. Handling (`src/core/pace.js`, `src/core/sim.js`)
- **Modes:** Assisted / Expert, separate from AI difficulty and the input method. Default is
  Assisted on touch devices and Expert on desktop; the choice persists.
- **Total 90 % steering response:** Assisted 0.325 s rise / 0.225 s neutral; Expert 0.283 / 0.217 s
  (v5b: 0.64 / 0.48 s). Yaw lag is 1/16 s.
- **Braking:** brake + steer always brakes. Assisted starts at 20 m/s² and ramps to 46 m/s² over
  0.5 s; Expert brakes at 46 m/s². Drift is explicit (X + steer); the hidden airbrake is removed.
- **Assisted aids:** curvature-lookahead corner easing (lift, ≤ 12 m/s² gentle brake), and edge
  correction capped at 15 % that is off whenever the player steers. Tilt input uses the same filters.

## D. Pace
- **Caps (fastest car, km/h, normal/boost):**

  | Map | Assisted | Expert |
  |---|---|---|
  | Velocity | 240 / 300 | 310 / 380 |
  | Kage | 180 / 225 | 240 / 300 |
  | Legacy | 210 / 260 | 280 / 345 |

  Other cars scale by their modifier ÷ 1.035. In Assisted, a hard ceiling stops gravity, drafting
  and slingshot from exceeding the cap, for the player and the AI. The displayed speed is the real
  speed.
- **AI:** top pace and corner speed are scaled to the mode. Medians at each map's tightest corners
  fall within all six candidate ranges. Lap times stay comparable to an input-only player (ratio
  0.85–1.2), and map character is kept (Velocity > Legacy > Kage average speed).
- **Records:** kept per mode (`m3_<mode>_<map>`). Pre-M3 records are not migrated and not deleted.
- **Known gaps:**
  - The Expert player has no lateral adhesion limit, so an input-only bot carries more than the
    Expert tight-corner range (Velocity median ~300, Kage ~162 km/h).
  - Expert allows drafting above the cap (AI peak 399 km/h on Velocity).
  - Driving feel has not been playtested by a human.

## Tests
- Unit tests: 50/50.
- e2e: 116/116 (including real CDP touch hold/release/multitouch/cancel at three sizes, simulated
  tilt, production debug gating, ground per map, mode defaults and persistence).
- Rain: 6/6.
- Not verified: real devices (the Nothing Phone 3a is unavailable), mobile GPU cost, driving feel.
