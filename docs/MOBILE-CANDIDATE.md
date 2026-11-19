# NIGHTGRID local candidate, 19 November 2026

Status: ready for design review, NOT released. Based on 24c292b91d0885b96ac26f37e8528994a9121fec. Core build 683a2ad0905f. Requires matching frontend and multiplayer backend on eventual release. No commit, push or deployment performed.

## Request checklist

| Request | Local status |
|---|---|
| More competitive NPCs and a harder Hard tier | Implemented. Normal pace/corner confidence 1.00/1.05; Hard 1.06/1.18 with 1.25x eligible boost frequency. Map-relative self-boost eligibility fixes the old fixed-speed threshold. Existing rubber-banding and mode caps unchanged. |
| NPCs accelerate straight in their starting lanes | Implemented: lane hold for opening 140 m, blend to normal line over next 80 m, obstacle avoidance still wins. Tested 4 and 20 racers on every map/mode. |
| Expert default, not Assisted | Implemented for fresh phone/desktop settings and new rooms. Explicit saved Assisted choice preserved. |
| Ground speed pads visible and more pickups | Implemented: 18 pickups in six rows per map, previously six in two rows. Longer amber ground chevrons and blue shield decals. Original obstacle layout preserved. Stations still avoid tunnels, inversion, blind corners and fork/merge areas, so spacing is not uniform. |
| Shield explanation and purpose | Implemented: HUD says 1 HIT and remaining seconds; brief pickup message; Settings explains one barrier/traffic hit, 15 second expiry, not walls or other racers. Existing shield mechanics unchanged. |
| Missiles | Not started, separate combat candidate, not silently included in this patch. |
| More tracks | Not started, separate map candidate. Three existing maps remain. |
| Synthwave music on tracks | Implemented: three Tomasz Kucza loops, one per map; Kevin MacLeod menu track. Local MP3 playback, credits, persisted music toggle, 14% playback volume, no playback before pointer/keyboard gesture. Existing engine/effects retained. |
| Mobile home declutter | Implemented: dedicated car hero area, compact left configuration, one primary Race button, Friends secondary, other tools under Menu. Stats/dots/empty record text removed from phone home, not from game data. |
| Car visible, smaller buttons, less unnecessary UI | Implemented on phone. Steering 60px, boost 64px, brake 48px, Menu at least 44px. Paint hit areas 44px. No permanent central speedometer over car. |
| Asphalt-inspired race controls/layout | Implemented: left/right steering at opposite bottom corners, boost above right pedal, small brake beside left pedal, Menu top-right, speed/time top-right, boost meter top-center. |
| Better phone render quality | Implemented Auto/Battery/High, with DPR caps 1.5/1.0/2.0, low-FPS safety reduction and gradual resolution recovery. Real-phone FPS/heat/battery not measured. |
| Faster boost recharge | Implemented 6%/s after 0.75 seconds released, previously 4%/s after 1.5 seconds. Empty-to-full 17.42 vs 26.5 seconds. Drain and skill rewards unchanged. |
| Mobile pause/menu | Implemented: Solo pauses and offers Resume, Settings, Restart, Garage. Online race continues with clear notice, no Restart, inputs released, Resume returns to view, Leave requires a second tap. |
| Clean readable minimap | Implemented: outline track, dark edge, neutral rival dots, cyan directional player marker, no panel, top-left under position. Phone 104px, desktop 154px. |
| Speedometer off the car | Implemented: speed/time/lap readout top-right, old central dial hidden. |
| Desktop also | Implemented shared hierarchy, keyboard Esc plus visible Menu, small key hints, no touch controls. Inspected at 1366x768 and 1920x1080. |

## Verification

- Unit tests: 193/193 pass.
- Focused network order/worker-host tests: 7/7 pass.
- Mobile real touch hit-testing, holds/releases, steer+boost multitouch, touchcancel, orientation and shared desktop check: 32/32 pass.
- Touch cinematic skip, control sizing/overlap and acceleration: 5/5 pass.
- Mode default/persistence and production no-debug/boot/start checks: 7/7 pass.
- Browser checks at phone 667x375 and 844x390 and desktop 1366x768 and 1920x1080: home, race, frozen solo pause clock, High selection, Resume, no page errors.
- Local authoritative multiplayer menu: race clock advances, paused=false, no held inputs, Restart hidden, Resume works, Leave confirms and disconnects. No page errors.
- Music: silent before gesture, decoded media readyState 4, currentTime advances for menu and race, mute pauses, no media error. This verifies playback, not headphone listening quality.
- Actual pixels inspected for phone/desktop home/race/menu, ground chevrons and shield HUD. Race screenshots use deterministic test stepping for composition, not a phone performance claim.
- Test and production builds pass; production manifest points at the existing workers.dev backend, but no new build was uploaded.
- git diff --check clean.

The entire historical multiplayer/browser suite was not rerun. Focused current checks do not replace a full release validation, real handset test or extended online soak.

## Final full-race benchmark

Three seeds per map/mode/tier, three opponents, hazards and new pickups enabled. All 108 bot runs finished. Zero Assisted cap violations. Mean bot finish time in seconds:

| Map/mode | Released Normal | New Normal | New Hard |
|---|---:|---:|---:|
| Velocity Assisted | 180.23 | 175.06 | 170.84 |
| Kage Assisted | 171.51 | 163.08 | 157.14 |
| Legacy Assisted | 280.55 | 268.74 | 260.71 |
| Velocity Expert | 140.07 | 135.71 | 128.32 |
| Kage Expert | 132.12 | 127.16 | 121.29 |
| Legacy Expert | 213.59 | 206.95 | 195.66 |

New Normal is 2.87-4.92% faster than released Normal. Hard is 4.62-5.45% faster than new Normal in Expert and 2.41-3.64% in Assisted. These are deterministic races against a fixed reference, not measured human win rates.

Recharge comparison holds the new NPC/pickup code fixed and changes only the old/new regeneration constants. Across 120 second scripted human-driver trials, the new recharge adds approximately 3.5-8.7 seconds of active boost. Forward progress varies -0.95% to +3.46%, because corners/collisions matter. It is not a guaranteed lap-time improvement or a claim of balance neutrality.

## Music provenance

Race source: https://opengameart.org/content/retro-synthwave-loops
Author credit: Tomasz Kucza. License CC BY 4.0: https://creativecommons.org/licenses/by/4.0/
Used deadly_contracts-loop1, going_undercover-loop1, hostile_territory-loop1. Converted to MP3 for browser compatibility, originals retained.

Menu official metadata: https://incompetech.com/music/royalty-free/pieces.json
Entry: Neon Laser Horizon, ISRC USUAN2000023, Kevin MacLeod.
Official license and credit generator: https://incompetech.com/music/royalty-free/licenses/
Official download: https://incompetech.com/music/royalty-free/mp3-royaltyfree/Neon%20Laser%20Horizon.mp3
Credit: "Neon Laser Horizon" Kevin MacLeod (incompetech.com). Licensed under Creative Commons: By Attribution 4.0.
Full attribution is in licenses/MUSIC.md and the in-game Credits menu.

## Remaining release work

- User design review of the actual phone and desktop screenshots.
- Real handset FPS, thermal, battery, music-level and thumb ergonomics check. High costs more GPU/battery.
- Full paired frontend/backend release validation and extended multiplayer soak before any live rollout.
- Missiles and new tracks remain separate work, not complete.
