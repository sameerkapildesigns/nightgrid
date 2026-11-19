# NIGHTGRID R4 candidate

Cumulative release on GitHub main Release 2, e0191792d12953d5e1c41e9b8acd621731996a8f. Includes all Release 3 changes plus the Release 4 changes below. Use only the cumulative R4 package, not the earlier R3 package. No hosted deployment was performed while preparing it.

## Tracks

- Shinrai Driftway: sixth map, linked curves, 3.12 km, no roadblocks. Uses the licensed Kage instrumental intentionally, with no extra audio download.
- Velocity: flowing S section, shorter loop and barrel, local corner banking instead of a half-lap accumulated roll. About 5.25 km.
- Kage: longer 3.28 km harbour course with several height changes and launch crests. Ramp takeoff/landing exclusion zones also follow the reversed variant.
- Casino: rebuilt slalom course, steep launches and drops, about 5.36 km. Raised split retained.
- Summit: opening curves retained, final long straight replaced with sweepers, 180 m main climb and further height changes. About 6.01 km.
- Legacy: slow narrow tunnel/hairpin sector replaced by open, wider Riviera sweepers. Existing speed caps and AI pace parameters retained. About 5.45 km.

## Visual and audio direction

Decorative sky-deck slabs and hanging cities removed, drivable overpasses remain. Near-road Legacy/Velocity buildings shortened. Rooftop tiers and signs follow their host buildings rather than floating at old heights. Purple horizon, brighter stars and banded moon use the existing dome, with extra sky effects disabled in Battery/low-FX.

Eight synthetic engine profiles vary waveform mix, pitch range, subvoice ratio, filter and whine. Existing parked-engine silence remains the default. Parameter and browser selection checks are not a human listening-quality review.

Per-map procedural landmarks add Casino pyramids/rings, Kage cranes and lighthouses, Summit peaks, Shinrai waterfront sheds/pagodas and spaced masts for Velocity/Legacy. They use at most two merged meshes and 3,000 triangles per map. Landmark footprints exclude the road and generated city buildings.

## Records and compatibility

All six layouts use R4-specific record keys. Old records stay in local storage untouched but are not shown as records for the new geometry. Driving modes, mirrored and reverse records stay separate; Night shares its layout record. Casino/Summit retain their existing no-variant restriction, Legacy retains Night only, and Velocity/Kage/Shinrai support mirrored/reverse/Night.

Frontend and Worker must use the same build, 7925f89b4b85. Existing build-mismatch protection prevents old-layout clients from racing on a different geometry. This package checks the custom-domain frontend build before offering the existing Worker deployment confirmation. It changes no DNS or hosting-project settings.

## Checks

- Full final unit suite: 356/356 passed.
- Production and test builds passed.
- Three focused local workerd checks passed on build 7925f89b4b85: API/build routing, CORS/Origin rules and a 14-second two-human/one-bot Casino race through the shipping client, with host-only and capacity checks. These are local checks, not hosted-CPU evidence.
- Real-WebSocket Shinrai check: two humans and one bot, reconnect during the race, no resyncs or rejected inputs.
- Actual browser renders inspected across all six maps, no page or shader errors. Eight engine profile selections checked. Legacy/Velocity building-road envelope audit found no intersection.
- Touch/mobile-sized landscape Battery rendering inspected, with extra sky effects and bloom off. Portrait keeps the existing rotate-phone gate.
- New tests cover road separation, seams, inversion length, ramp exclusion zones after reversal, human-input ramp traversal, predictor agreement, bounded landmark geometry and old-record preservation.
- Final secret scan: zero findings. No repeated long soak or balance matrix was run.

## Verification notes

Track-space hover is still the shared game physics, not a new free-flight simulation. Do not describe the ramps as unrestricted airborne ballistics. Software-rendered local browser checks do not establish mobile device frame rate. Test fixtures that claimed to be on a straight now use an actual straight on the revised course. Old exact-layout comparisons are replaced only where R4 intentionally changes geometry, with continuity, road-clearance, terrain, variant and race-completion checks retained.


No real-phone FPS/input-latency benchmark, human blind audio comparison, full balance matrix, or long hosted soak has been completed. The synthetic voices are distinct in parameters and waveforms, not certified by a listening panel. Legacy speed caps and AI pace parameters remain unchanged, but removing its slow sector changes lap time. Kage pickup placement can move because safe takeoff/landing space takes priority. Shinrai intentionally has no roadblocks. These are geometry and balance changes, so keep the old frontend/Worker pair together if reverting.
