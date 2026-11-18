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
| velocity-mob | chase t=9s | 342 → 334 (-8) | 1348587 → 1457317 (8.1%) |
| velocity-mob | chase t=17s | 367 → 348 (-19) | 1449487 → 1557949 (7.5%) |
| velocity-mob | taxi close-up | 334 → 322 (-12) | 1437617 → 1546221 (7.6%) |
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

Summary: draw calls -27..+11 per view (taxis 49 -> 4 calls; new themed families +5..+7 instanced meshes); triangles +5..+14% (+52k Kage, +80k Legacy, +108k Velocity), mostly whole-city instanced families (setback tiers, crowns, edge dressing) that are not frustum-split. Taxi model 620 tris x 7 instances.
