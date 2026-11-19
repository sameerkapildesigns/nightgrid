# NIGHTGRID R4.1 candidate, held for remaining feedback

Base: f302b13516c5ab315a1ec7105ebd041245c0658e (R4).
No hosted changes or push have been made while preparing this candidate.
Do not release until Sameer finishes his manual map review.

## Implemented locally

- Desktop menu: separate, fixed action column keeps Race visible. Circuit choices wrap within the available width. Setup has its own capped scroll area at very short window heights. Touch layout remains separate.
- Velocity: reverse the erroneous local road-bank sign, increase its visible peak bank from about 18 degrees to about 29 degrees. Centerline, corner radii, loop and barrel positions are unchanged.
- Legacy and Kage: preserve the R4 route and surface frames exactly, per the final preference that both feel good. The earlier local Legacy camber experiment is removed.
- Casino, Summit and Shinrai: measured inward ordinary-corner camber, no change needed. Kage is flat-camber, not outward.
- Vehicle extra roll and chase camera extra roll now tip into the turn. Existing road-following alignment remains.
- Solo results: Next map names the next circuit, loads it in its default variant and starts its race. Order follows the garage circuit list and wraps after Legacy. Hidden in multiplayer so it cannot change a room's host-selected map.
- Gold/green arrow pads are permanent boost zones. Every racer can collect on entry, including simultaneous racers; arrows never dim or become unavailable. Bottles and shield pickups retain their existing consumption/respawn rule. Parked overlap cannot farm repeated grants.
- Diagnostic renders after all six local racers cross gold/green arrows were visually inspected: both arrows stay bright and visible, all six receive overdrive.
- Pad trigger bounds include the full 20m overdrive decal plus the car footprint, rather than only the central 10m. The renderer uses the same dimensions as collection.
- Snapshot encoding: array gaps become null before JSON transport, preventing sparse-array versus null divergence when a sector split is skipped. Exposed by the changed Velocity pad positions.
- Velocity records use a new revision key for the changed surface frames. Legacy and all other maps retain their R4 keys. Existing R4 records remain stored and are never deleted or overwritten. Other maps retain their R4 keys.

## Verification

- Desktop renders at 1280x700, 1366x768 and 1440x800 visually inspected. Race and all six circuit buttons are visible.
- Also checked 1024x700, 960x540, 960x400. At 960x300 the setup scrolls while Race stays visible and clickable, including after scrolling.
- Touch 844x390 and portrait gate at 390x844 checked separately.
- Signed horizontal curvature/road-normal audit: no outward ordinary-corner bank across Velocity, Casino, Summit, Shinrai and supported mirrored/reverse variants; Kage remains flat-camber. Legacy is explicitly exempt to preserve its preferred R4 feel. Excludes deliberate loops, wall climbs and barrel inversions.
- Rendered left/right Velocity bank and solo results with Next map inspected. Actual click moves Velocity results to Kage intro, no page errors.
- Production build and secret scan passed. 383/383 unit tests passed after permanent pads; an added authority/predictor regression and the real-socket permanent-pad test also pass. Three short local Worker checks and a real-socket reconnect race passed; permanent gold/green-pad simultaneous claims and bottle consumption were separately verified over real sockets.

## Release implications

The bank and snapshot fixes change the shared multiplayer build. This expanded candidate needs a matched frontend and Worker deployment. It is not the earlier menu-only frontend patch. Legacy geometry is not part of the camber changes. Do not mix this candidate into the ongoing R4 deployment. No DNS change, new project, reset or spend is needed.

## Held R5 feedback, not implemented here

Await the final review before choosing values or changing mechanics:
- Rewarding drift and more boost earned from drifting.
- Stronger overdrive and green boosts, more boost pads on straights.
- More jumps across the game. The follow-up word "lots" may mean many jumps, but that interpretation is not confirmed.
- Louder music, quieter engines.
- Higher base top speed, with a smaller boosted top-speed gap. Boost should mostly improve acceleration. A stronger overall sense of speed. FOV, speed lines, camera and scenery are possible treatments, not individually confirmed settings.
- Downhill adds speed; uphill must not impose a speed penalty. This replaces the earlier decrease-speed wording.
- Random NPC car models and names each race.
- Spread traffic/taxis across the circuit, including straights, instead of clustering.
- Stronger catch-up speed for racers behind, through both rubber-banding and slipstream (confirmed).
- Visible exhaust flames during boost. Existing exhaust particles should be reviewed rather than duplicated blindly.

## Velocity restoration note

R2 had a 360m loop piece and 250m barrel; R4 shortened these to 230m/170m and replaced accumulated corner roll with local bank. The measured inverted distance (up.y below -0.5) fell from about 372m to 72m. That was an overcorrection: open-sky visibility does not require removing deliberate inversions. Planned next: restore longer deliberate loop/barrel/vertical sections while retaining inward ordinary-corner bank and no sky decks. Do not restore the inherited outward corner-roll bug. Route changes await the rest of the manual review and closure/clearance tests.

## Map identity preference

Kage and Legacy feel good to Sameer. Preserve their route/handling identity. Velocity, Casino, Summit and Shinrai feel alike and need distinct identities in the next design pass. Shared menu, pickup and visual-lean fixes still apply unless otherwise directed.

Next design pass for Velocity/Casino/Summit/Shinrai: distinct vertical/upside-down sections, larger jumps and longer air time, with stable upright controllable landings. Preserve Kage/Legacy's preferred identity. This calls for deliberate airborne/landing behavior review, not merely a visual ramp, and is not implemented in the held R4.1 bugfix.

## Purposeful inversion rule, held next pass

Replace arbitrary full 360-degree longitudinal barrels with a 180-degree half-twist into an inverted section, two or three turns while upside down, then another 180-degree half-twist back upright. No route edits have been made for this direction yet. Existing R4 barrels are Legacy Suzuka (104m, about 2.62km after start) and Velocity S3 (170m, about 4.16km after start). Legacy's Eau Rouge wall climb/inverted run/150m half-roll recovery and the Legacy shortcut/Velocity sky loops are different features, not full longitudinal barrels. Kage, Casino, Summit and Shinrai have no full barrel in their R4 builders.

## Motion comfort priority, awaiting clarification

After about one hour of play, Sameer reported his head/brain felt a little hurt. Do not turn this into a medical diagnosis. Prioritize comfort review before adding stronger speed-camera effects: reduce extra roll, drift-heading camera swing and FOV pumping; preserve actual-speed improvements separately. He says 360-degree turns where cars seem about to fly off feel wrong. This may mean barrels, spirals/full-circle bends or vertical loops, still unconfirmed. Ask for the map/sector or a short clip before removing a feature. No motion settings or route changes have been made for this note yet.

Slipstream request at 22:23: recharge the boost bar at 2x the current slipstream recharge rate (the typo in the original is interpreted as slipstream). This is in addition to the confirmed stronger slipstream/catch-up direction. Do not silently interpret it as doubling every passive or drift gain. Held for next pass, not implemented.
Base boost-bar fill should also be a little faster, a modest unspecified bump separate from the slipstream 2x change. Preserve that distinction when selecting values. Held, not implemented.
