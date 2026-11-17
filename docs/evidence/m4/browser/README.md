# Browser multiplayer runs (single-phone + 3 bots, Kage, unthrottled rendering, software WebGL on 2 cores)

Each file is the PASS/FAIL/TARGET/INFO output of `NG_ONLY=D node tests/e2e/mp-run.mjs` at successive fixes.
Not handset evidence: this host renders about 1.5-2 FPS.

| Run | Change | Missed frames | Human | Mispredict p95 | Hard snaps |
|---|---|---|---|---|---|
| mpD | before | 93.7 % | DNF | 2.10 m | 462 / 5 min |
| mpD2 | catch-up 30 -> 120 steps per call | 61.0 % | finished | 2.00 m | 167 / 3.5 min |
| mpD3 | lead from server arrival margin, cap 1.5 s (queue bound still 600 ms: conflict) | 92.5 % (32,981 skipped) | DNF | 3.12 m | 487 / 5 min |
| mpD4 | consistent bounds (lead 1.5 s < queue drop 2 s < time-ahead 3 s) | 1.4 % | finished | 0.27 m | 11 / 3 min |
