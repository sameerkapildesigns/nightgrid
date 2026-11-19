# NIGHTGRID Release 3

Base: Release 2, e0191792d12953d5e1c41e9b8acd621731996a8f.
No track geometry changes in this release. Existing R2 ships, music, lap/NPC settings and earlier fixes remain.

## Pickups and boost
- Gold boost pads, green refill canisters and shields respawn in 1.5 seconds, down from 6. Weapon-box personal cooldown is 1.5 seconds, down from 10. Existing cold-start and inventory rules remain.
- Leaving and re-entering is required for the same racer to reclaim a pickup. Parking on one does not farm it.
- Extra boost strips use a fresh solo-race seed. Rooms use the server's seed, including reconnects and snapshots. Up to six safe strips are added; placement can yield fewer. Starts, forks, unsafe banking, obstacles and weapon boxes are avoided.
- Existing boost strips stay gold. Extra strips are green. Both are flat outlined road chevrons, with no hovering cone. Refill canisters and shield diamonds are unchanged.
- Passive meter recovery: 6% to 8% per second after the unchanged 0.75-second release delay. Pickups still refill 35%.
- Held boost drains 25% per second, previously 32%, giving about 4 seconds from full rather than 3.125 seconds. Boost acceleration is 88 rather than 80 m/s² before drag. Boosted speed targets rise about 5%; normal speed targets stay unchanged.
- Expert boosted targets, fastest vehicle before drag: Velocity 400, Kage 315, Casino 370, Summit 355, Legacy 360 km/h. Previous targets: 380, 300, 350, 340, 345. Vehicle stats, corners and drag affect actual speed.
- Stored pad overdrive stays capped at 3.6 seconds. Driving over separate pads can still sustain it; this release does not remove that driving line.

## Recovery and drafting
- Solo recovery presets: Off, Standard, Strong. Strong is the default unless recovery was explicitly disabled.
- Strong scales from zero bonus at 4 seconds behind the nearest unfinished racer ahead, to +25% normal and boosted speed targets at 20 seconds. At 12 seconds it gives +12.5%.
- Standard scales from 6 seconds to +15% at 30 seconds.
- Either enabled preset grants an additional 25% boost meter at 12+ seconds behind, at most once every 8 seconds. Meter cannot exceed 100%.
- Leaders, rooms, finished players and autopilot do not receive the recovery aid. Assisted laps remain ineligible for records. Preset and bonus cooldown survive snapshots.
- Existing slipstream remains: wake 5-42 metres ahead, tow builds after 0.4 seconds and reaches full around 1.5 seconds; Expert cap bonus up to 6%, reduced drag and brief slingshot on pulling out. Height and heading checks now reject overhead/crossing cars. It is a bounded multiplier, not an accumulating speed stack.

## Presentation and controls
- Music bass onsets drive a smoothed neon/barrier/billboard pulse, capped at 38% extra brightness. One analyser uses the playing local MP3, not a guessed BPM timer. Muting, pausing, reduced motion, Battery quality and automatic low-FX fallback disable it.
- Boost gains no longer display +BOOST, refill, overdrive or recovery text in the centre. The meter and a quiet green edge glow show gains instead. Glow respects reduced motion and low-FX quality and is rate-limited.
- Shield: dim thin edge-lit shell, body-based sizing, correct scaled normals, faint slow scan detail, brief impact ripple/collapse. No bright glossy fill.
- Desktop: hold C to look behind. Release C, blur or pause clears it. Controls hint updated.

## Checks and limits
322 unit tests passed on final gameplay code. Production/test builds and production-browser ship selection passed. Three focused local workerd tests passed on the final paired build, including two humans and a bot. A real-WebSocket weapon/reconnect case passed. Actual browser checks cover seeded pads, playing-MP3 light response, mute/Battery disable, no boost text, slipstream visuals, shield/ripple and C rear view. Screenshots were inspected. Secret scan: zero findings.

No real-phone FPS or input-latency benchmark, long hosted soak, full balance matrix, or human musical-seam review. Strong recovery and longer boost change balance materially. Beat reaction is energy/onset driven, not beat-grid analysis. No hosted deployment was performed while preparing this package.

## Separate next release
New drift-friendly circuit; Velocity turns and shorter inverted sections; longer Kage with safe jump ramps; per-vehicle synthetic engine sounds. Split-screen is separately scoped, not part of R3.
