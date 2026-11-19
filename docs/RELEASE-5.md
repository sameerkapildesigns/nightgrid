# NIGHTGRID R5, combined with R4.1

One paired frontend and multiplayer Worker release. This supersedes the held R4.1 candidate. No separate R4.1 deployment is needed. The preparer has not pushed or deployed it.

## Driving and comfort

- Comfort is the new default, including a one-time migration for returning players: motion blur and camera shake off, much smaller FOV changes, less extra camera roll and drift-heading swing. Dynamic remains available in Settings. Road inversions still rotate the road-following camera.
- Higher base speed with a smaller boost top-speed gap. Boost improves acceleration more than top speed. Faster passive boost refill, doubled slipstream refill, stronger draft and solo Strong catch-up. Standard and Off remain available. Rooms keep catch-up off.
- Drift earns more boost only on real corners. Downhill can add a little speed; uphill adds no gravity braking penalty. Absolute speed bounds remain enforced.
- Music is louder, engine effects quieter. Boost flames use each car's actual exhaust anchors.

## Circuits

- Velocity: open-sky climb, 300 m half-twist into two inverted sweepers, then a 300 m half-twist back upright. No full longitudinal road barrel or vertical loop in the redesigned route. About 5.19 km, two laps.
- Casino: neon slalom and high-roller split, with two authored drops. About 5.22 km, three laps.
- Summit: 180 m ridge, broad sweepers, a short ridge air crest and three descending drops. About 5.62 km, two laps.
- Shinrai: linked drift chains, short resets, wide road and no obstacles. About 3.04 km, three laps.
- Kage and Legacy geometry, including Legacy's existing stunt sections, match R4 exactly. Shared driving, comfort and pickup changes still apply.

## Jumps and traffic

- Six authored jumps: two Casino drops and four Summit crests/drops. Flight follows a world-height ballistic arc above the road; the route still guides horizontal motion. This is not unrestricted free flight.
- Optional body rolls: X + steer on keyboard, or Brake + steer on touch. A roll starts only when predicted airtime can cover it. At most two per jump. The camera does not follow the body roll.
- Clean landings earn boost. Each ramp has one reward opportunity per racer per lap; repeats, wall contacts and messy landings cannot farm rewards. Continuous airborne meter farming is removed.
- Seven traffic taxis per circuit move around the full route instead of wrapping inside a small zone. They fade before steep/inverted/jump corridors; faded traffic has no contact, avoidance or near-miss effect.

## R4.1 fixes included

- Desktop Race button remains visible, with setup scrolling only when needed. Touch layout remains separate.
- Extra vehicle and camera lean point inward. Velocity's new road banks are on-camber.
- Solo results have Next map; multiplayer keeps the host-selected map.
- Gold and green arrow pads are permanent. Every racer gets their grant on entry, even simultaneously. Parked overlap cannot farm repeated grants. Bottles and shields remain consumable.
- Overdrive decals and collection bounds share their 20 m length and include the car footprint.
- Rival names and approved car models shuffle for every solo start and restart. Models preload before the intro.
- JSON snapshots canonicalize sparse arrays. New jump state survives snapshots and reconciliation.

## Compatibility and records

Protocol 4 appends the body-roll field without changing earlier compact-row indices. A matching Worker is required. Stale tabs must reload. During a paired rollout multiplayer can refuse mismatched builds until both sides match.

R5 record keys isolate the new physics and layouts. Old stored records are not deleted or overwritten.

Frontend stays on the existing Vercel project. Multiplayer stays on the existing free workers.dev backend. No DNS, nameserver, paid-plan, credit or reset step is part of this release.

## Verification and limits

- Full unit suite: 422/422. Final focused jump, network-prediction and preserved-geometry checks: 16/16.
- Production build and secret scan passed; zero findings in 498 files.
- Four local Worker tests passed, including a two-human/one-bot race, origin/capacity checks, runtime kill, storage restore and same-seat reconnect. Two focused real-socket tests passed, including shared permanent pads.
- Six-map headless soak: 600 simulated seconds per map, twenty bots, five laps, hazards and weapons. All 120 race entries finished, finite state throughout, no crash/DNF, JSON snapshot restore passed.
- Actual rendered checks covered all six authored jumps, inverted Velocity sweepers, touch Brake + steer rolls, taxi opacity, eight-car exhaust flames, inward banks, randomized restart, Next map and desktop Race visibility.
- No hosted soak, real-phone FPS benchmark, full network/balance matrix or blind audio comparison is claimed. Software-rendered test FPS is not a phone performance estimate.

Deployment remains the user's action. The package guards the source/build identity and checks the actual frontend before offering the matching Worker update. Keep its logs and use its resume script if the frontend is not ready. Do not run older release/resume scripts after R5 ships. Rollback must restore a matching frontend/Worker pair, not only one side.
