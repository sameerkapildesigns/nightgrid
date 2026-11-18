# M8 measured render deltas (same seed, same viewpoints, fresh page per map)

SwiftShader software GL in a container. Draw calls and triangles come from renderer.info for one composer frame at the same pose. ms timings in the json (gfxProbe) are CPU wall time on a shared container and are NOT FPS evidence. Before = bee26ee, after = claude/m8-visuals. In the after mobile run the game's adaptive safeguard had lowered pixelRatio to 0.75 (container CPU contention from two parallel runs); calls/tris are independent of pixel ratio.

| map / viewport | view | calls before → after (Δ) | triangles before → after (Δ%) |
|---|---|---|---|
| velocity-desk | chase t=2s | 342 → 344 (+2) | 1345711 → 1454599 (8.1%) |
| velocity-desk | chase t=9s | 323 → 326 (+3) | 1348287 → 1457231 (8.1%) |
| velocity-desk | chase t=17s | 367 → 348 (-19) | 1449487 → 1557949 (7.5%) |
| velocity-desk | taxi close-up | 329 → 317 (-12) | 1389397 → 1498001 (7.8%) |
| velocity-desk | elevated wide | 365 → 346 (-19) | 1414599 → 1523061 (7.7%) |
| velocity-desk | WORLD meshes | 67 → 72 | |
| technical-desk | chase t=2s | 325 → 323 (-2) | 1004379 → 1056935 (5.2%) |
| technical-desk | chase t=9s | 379 → 361 (-18) | 1044170 → 1096274 (5.0%) |
| technical-desk | chase t=17s | 326 → 323 (-3) | 1045843 → 1098383 (5.0%) |
| technical-desk | taxi close-up | 143 → 130 (-13) | 248688 → 300970 (21.0%) |
| technical-desk | elevated wide | 348 → 339 (-9) | 1049309 → 1101673 (5.0%) |
| technical-desk | WORLD meshes | 60 → 67 | |
| legacy-desk | chase t=2s | 358 → 352 (-6) | 1188945 → 1271105 (6.9%) |
| legacy-desk | chase t=9s | 321 → 326 (+5) | 1180664 → 1263024 (7.0%) |
| legacy-desk | chase t=17s | 119 → 130 (+11) | 593198 → 675682 (13.9%) |
| legacy-desk | taxi close-up | 375 → 349 (-26) | 990252 → 1071988 (8.3%) |
| legacy-desk | elevated wide | 130 → 141 (+11) | 610061 → 692545 (13.5%) |
| legacy-desk | WORLD meshes | 81 → 86 | |
| velocity-mob | chase t=2s | 342 → 344 (+2) | 1345711 → 1454599 (8.1%) |
| velocity-mob | chase t=9s | 342 → 339 (-3) | 1348587 → 1457357 (8.1%) |
| velocity-mob | chase t=17s | 367 → 348 (-19) | 1449487 → 1557949 (7.5%) |
| velocity-mob | taxi close-up | 334 → 321 (-13) | 1437617 → 1545601 (7.5%) |
| velocity-mob | elevated wide | 374 → 355 (-19) | 1459461 → 1567923 (7.4%) |
| velocity-mob | WORLD meshes | 67 → 72 | |
| technical-mob | chase t=2s | 321 → 322 (+1) | 1006519 → 1057761 (5.1%) |
| technical-mob | chase t=9s | 377 → 359 (-18) | 1046320 → 1097110 (4.9%) |
| technical-mob | chase t=17s | 333 → 327 (-6) | 1051285 → 1102419 (4.9%) |
| technical-mob | taxi close-up | 142 → 131 (-11) | 250860 → 301840 (20.3%) |
| technical-mob | elevated wide | 346 → 339 (-7) | 1051459 → 1102509 (4.9%) |
| technical-mob | WORLD meshes | 60 → 66 | |
| legacy-mob | chase t=2s | 360 → 353 (-7) | 1192399 → 1271365 (6.6%) |
| legacy-mob | chase t=9s | 321 → 324 (+3) | 1184098 → 1263266 (6.7%) |
| legacy-mob | chase t=17s | 121 → 131 (+10) | 599438 → 678754 (13.2%) |
| legacy-mob | taxi close-up | 390 → 363 (-27) | 999263 → 1077821 (7.9%) |
| legacy-mob | elevated wide | 128 → 138 (+10) | 613453 → 692769 (12.9%) |
| legacy-mob | WORLD meshes | 81 → 86 | |

Summary (per view, all 30 rows): draw calls -27..+11 (taxis 49 -> 4 calls; new themed families +5..+8 meshes);
triangles +4.9..+21.0%. Most views are +5..+14%; the outliers are the Kage taxi close-up, +21.0% on desktop and
+20.3% on mobile. That pose sees few buildings, so the fixed ~52k extra (sawtooth roofs, glazing, containers,
bollards) is a larger share of a 250k-triangle frame. Absolute extra: +52k Kage, +80k Legacy, +108k Velocity. Those
are whole-city instanced families (setback tiers in the building mesh, crowns, spires, edge dressing), not frustum-split.

## Perf pass tried and rejected (branch claude/m8-bake-experiment @ 288b40a, local, NOT in the bundle)
All env families (skyline + edge dressing) were baked into 500 m cells, at most 3 merged meshes per cell (lit /
solid / containers), with exact bounds and normal frustum culling. Same seed and poses. Columns:
bee26ee -> 52ffc5d -> bake.

| map / viewport | view | calls bee26ee → 52ffc5d → bake (Δ vs 52ffc5d) | tris bee26ee → 52ffc5d → bake (Δ vs 52ffc5d) |
|---|---|---|---|
| velocity-desk | chase t=2 | 342 → 344 → 357 (+13) | 1345711 → 1454599 → 1432015 (-22584; vs bee26ee 6.4%) |
| velocity-desk | chase t=9 | 323 → 326 → 340 (+14) | 1348287 → 1457231 → 1433987 (-23244; vs bee26ee 6.4%) |
| velocity-desk | chase t=17 | 367 → 348 → 377 (+29) | 1449487 → 1557949 → 1545421 (-12528; vs bee26ee 6.6%) |
| velocity-desk | taxi | 329 → 317 → 340 (+23) | 1389397 → 1498001 → 1483589 (-14412; vs bee26ee 6.8%) |
| velocity-desk | wide | 365 → 346 → 379 (+33) | 1414599 → 1523061 → 1511841 (-11220; vs bee26ee 6.9%) |
| technical-desk | chase t=2 | 325 → 323 → 328 (+5) | 1004379 → 1056935 → 1004895 (-52040; vs bee26ee 0.1%) |
| technical-desk | chase t=9 | 379 → 361 → 370 (+9) | 1044170 → 1096274 → 1079710 (-16564; vs bee26ee 3.4%) |
| technical-desk | chase t=17 | 326 → 323 → 324 (+1) | 1045843 → 1098383 → 1058795 (-39588; vs bee26ee 1.2%) |
| technical-desk | taxi | 143 → 130 → 139 (+9) | 248688 → 300970 → 270658 (-30312; vs bee26ee 8.8%) |
| technical-desk | wide | 348 → 339 → 340 (+1) | 1049309 → 1101673 → 1062085 (-39588; vs bee26ee 1.2%) |
| legacy-desk | chase t=2 | 358 → 352 → 363 (+11) | 1188945 → 1271105 → 1256225 (-14880; vs bee26ee 5.7%) |
| legacy-desk | chase t=9 | 321 → 326 → 335 (+9) | 1180664 → 1263024 → 1244232 (-18792; vs bee26ee 5.4%) |
| legacy-desk | chase t=17 | 119 → 130 → 133 (+3) | 593198 → 675682 → 649450 (-26232; vs bee26ee 9.5%) |
| legacy-desk | taxi | 375 → 349 → 364 (+15) | 990252 → 1071988 → 1062724 (-9264; vs bee26ee 7.3%) |
| legacy-desk | wide | 130 → 141 → 144 (+3) | 610061 → 692545 → 666313 (-26232; vs bee26ee 9.2%) |
| velocity-mob | chase t=2 | 342 → 344 → 359 (+15) | 1345711 → 1454599 → 1432471 (-22128; vs bee26ee 6.4%) |
| velocity-mob | chase t=9 | 342 → 339 → 350 (+11) | 1348587 → 1457357 → 1436857 (-20500; vs bee26ee 6.5%) |
| velocity-mob | chase t=17 | 367 → 348 → 377 (+29) | 1449487 → 1557949 → 1545421 (-12528; vs bee26ee 6.6%) |
| velocity-mob | taxi | 334 → 321 → 345 (+24) | 1437617 → 1545601 → 1531809 (-13792; vs bee26ee 6.6%) |
| velocity-mob | wide | 374 → 355 → 392 (+37) | 1459461 → 1567923 → 1557687 (-10236; vs bee26ee 6.7%) |
| technical-mob | chase t=2 | 321 → 322 → 329 (+7) | 1006519 → 1057761 → 1004897 (-52864; vs bee26ee -0.2%) |
| technical-mob | chase t=9 | 377 → 359 → 371 (+12) | 1046320 → 1097110 → 1079986 (-17124; vs bee26ee 3.2%) |
| technical-mob | chase t=17 | 333 → 327 → 328 (+1) | 1051285 → 1102419 → 1061987 (-40432; vs bee26ee 1.0%) |
| technical-mob | taxi | 142 → 131 → 142 (+11) | 250860 → 301840 → 270686 (-31154; vs bee26ee 7.9%) |
| technical-mob | wide | 346 → 339 → 343 (+4) | 1051459 → 1102509 → 1064335 (-38174; vs bee26ee 1.2%) |
| legacy-mob | chase t=2 | 360 → 353 → 366 (+13) | 1192399 → 1271365 → 1256549 (-14816; vs bee26ee 5.4%) |
| legacy-mob | chase t=9 | 321 → 324 → 335 (+11) | 1184098 → 1263266 → 1244232 (-19034; vs bee26ee 5.1%) |
| legacy-mob | chase t=17 | 121 → 131 → 135 (+4) | 599438 → 678754 → 652262 (-26492; vs bee26ee 8.8%) |
| legacy-mob | taxi | 390 → 363 → 381 (+18) | 999263 → 1077821 → 1072219 (-5602; vs bee26ee 7.3%) |
| legacy-mob | wide | 128 → 138 → 144 (+6) | 613453 → 692769 → 666313 (-26456; vs bee26ee 8.6%) |

Result: triangles -5.6k..-52.9k per view vs 52ffc5d. Kage benefits most and comes back to bee26ee level in
open chase views. Draw calls rise +1..+37: Velocity +11..+37, Legacy +3..+18, Kage +1..+12. That breaks the
+10-call cap. It also leaves Velocity's main cost untouched, because the setback tiers live in the pre-existing
whole-city building mesh. Per your rule, 52ffc5d is retained; no further tuning was done.
