# Evidence produced by the M1 session (17 Nov 2026)

Everything here was generated in this M1 work session, in a cloud Linux container
(4 vCPU), by the scripts in this repository:

* `unit-output.txt`: `npm test` (Node 22, node:test).
* `e2e-results.json`, `e2e-output.txt`: `node tests/e2e/run.mjs` (Playwright 1.63, headless
  Chromium with **SwiftShader software WebGL**, local `vite preview`). Real devices were not
  used. Frame rates here are about 1–2 FPS and are not representative.
* `../screenshots/*.jpg`: captured by the e2e runner in the same environment.
* `../measurements.json`: `npm run measure` (conditions are embedded in the file).

This is **not** independent verification. The test evidence imported with the v5b baseline
(the `source/tests/*.py` scripts in the supplied archive) was not re-run, copied or relabelled
here. User laptop and phone testing is still pending.
