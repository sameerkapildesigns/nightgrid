# NIGHTGRID R4.1 candidate, held for remaining feedback

Base: f302b13516c5ab315a1ec7105ebd041245c0658e (R4).
No hosted changes or push have been made while preparing this candidate.
Do not release until Sameer finishes his manual map review.

## Implemented locally

- Desktop menu: separate, fixed action column keeps Race visible. Circuit choices wrap within the available width. Setup has its own capped scroll area at very short window heights. Touch layout remains separate.
- Velocity: reverse the erroneous local road-bank sign, increase its visible peak bank from about 18 degrees to about 29 degrees. Centerline, corner radii, loop and barrel positions are unchanged.
- Legacy: correct the inherited outward camber in the Eau Rouge and Suzuka linked bends. Main/shortcut centerlines and stunt frames remain unchanged.
- Casino, Summit and Shinrai: measured inward ordinary-corner camber, no change needed. Kage is flat-camber, not outward.
- Vehicle extra roll and chase camera extra roll now tip into the turn. Existing road-following alignment remains.
- Solo results: Next map names the next circuit, loads it in its default variant and starts its race. Order follows the garage circuit list and wraps after Legacy. Hidden in multiplayer so it cannot change a room's host-selected map.
- Gold/green arrow pads are permanent boost zones. Every racer can collect on entry, including simultaneous racers; arrows never dim or become unavailable. Bottles and shield pickups retain their existing consumption/respawn rule. Parked overlap cannot farm repeated grants.
- Diagnostic renders after all six local racers cross gold/green arrows were visually inspected: both arrows stay bright and visible, all six receive overdrive.
- Pad trigger bounds include the full 20m overdrive decal plus the car footprint, rather than only the central 10m. The renderer uses the same dimensions as collection.
- Snapshot encoding: array gaps become null before JSON transport, preventing sparse-array versus null divergence when a sector split is skipped. Exposed by the changed Velocity pad positions.
- Velocity and Legacy records use new revision keys for the changed surface frames. Existing R4 records remain stored and are never deleted or overwritten. Other maps retain their R4 keys.

## Verification

- Desktop renders at 1280x700, 1366x768 and 1440x800 visually inspected. Race and all six circuit buttons are visible.
- Also checked 1024x700, 960x540, 960x400. At 960x300 the setup scrolls while Race stays visible and clickable, including after scrolling.
- Touch 844x390 and portrait gate at 390x844 checked separately.
- Signed horizontal curvature/road-normal audit: no outward ordinary-corner bank across the six maps and supported mirrored/reverse variants. Excludes deliberate loops, wall climbs and barrel inversions.
- Rendered left/right Velocity bank and solo results with Next map inspected. Actual click moves Velocity results to Kage intro, no page errors.
- Production build and secret scan passed. 383/383 unit tests passed after permanent pads; an added authority/predictor regression and the real-socket permanent-pad test also pass. Three short local Worker checks and a real-socket reconnect race passed; permanent gold/green-pad simultaneous claims and bottle consumption were separately verified over real sockets.

## Release implications

The bank and snapshot fixes change the shared multiplayer build. This expanded candidate needs a matched frontend and Worker deployment. It is not the earlier menu-only frontend patch. Do not mix this candidate into the ongoing R4 deployment. No DNS change, new project, reset or spend is needed.

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
