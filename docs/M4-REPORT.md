# M4 report: private-room multiplayer (local test build)

Branch `claude/m4-multiplayer` only. Nothing is merged, released or deployed. No account was created or
used, no login was performed, nothing was spent. `main` and `claude/admiring-meitner-db4ejz` are untouched
(still 53af096). The live single-player site is unchanged.

**Status in one line:** the server-authoritative multiplayer stack works end to end on real sockets, in
real browsers and in local Cloudflare workerd. On this test host's software renderer (~1 FPS per page when
several pages run), browser races are below the playable floor, so several browser quality targets FAIL.
Real phone feel is **unverified** until Sameer's hosted test.

## 1. Starting point and what was kept

| Item | Decision |
|---|---|
| M4-1 5a4dd5a (per-racer sim, full snapshot incl. PRNG, room model) | Kept. Determinism re-verified with new tests. |
| WIP a96269f protocol v1 / RoomServer | Reworked. Problems: client-chosen ids (seat hijack), "latest input wins" (cannot be replayed for prediction), 1-seat races allowed, bot personality/car mismatch, no tokens, no budget. |
| "Non-contact human policy" | Not present in code. Car-car collisions stay ON for every racer (gameplay unchanged). Implication: contact and others' slipstream are not predicted, so they arrive as server corrections (measured below). |

Commits on the branch after a96269f: 736b534 (protocol v2, room, budget, server), f207775 (local runtime,
netcode, net tests), 474cc99 (browser lobby/race, WIP), 1c68295 (slow-render fixes, DO adaptor),
47f75d3 (DO tested in workerd), d74203f (removal of committed local dev state, see §9), d715846
(audit patches, rematch test), 3058630 (budget hard stop), and this report's commit.

## 2. How to run

```bash
npm ci
npm test                    # unit (Node): sim, determinism, room, protocol, budget, room-server, netcode
npm run test:net            # real sockets vs local runtime: 2h, 4h, 1h+3b, 2h+2b, rematch, isolation, origin, capacity
npm run test:matrix         # network matrix (writes docs/evidence/m4/net-matrix.*)
node tests/net/load.mjs --rooms 5 --seconds 60 --lag 100     # event load test
npm run test:worker         # Durable Object adaptor in LOCAL workerd (wrangler dev; no account)
npm run test:mp             # browser multiplayer (Playwright, several contexts) vs local runtime
npm run test:e2e            # single-player browser regression (unchanged suite)
npm run scan                # secret/PII scan
npm run mp                  # play locally: build + http://127.0.0.1:8787 (open two browsers)
```

## 3. Acceptance gates (PASS = run and recorded; evidence under docs/evidence/m4/)

| Gate | Result |
|---|---|
| 1. Unit / build / scan / single-player e2e | Unit **102/102** (65 baseline; old room tests replaced by stricter ones). Scan 0. Prod build has no debug hooks (`NG_DEBUG`, `__ng`, autodrive, render-every: 0 occurrences). GLBs byte-identical to M3, same 8 asset files. JS 763.8 → 795.6 KB (+4.2 %; gzip 215.8 → 227.6 KB), CSS 26.7 → 31.5 KB. Single-player e2e: see §8 (re-run on the final commit). |
| 2. Determinism | **PASS**: snapshot → JSON → import continues bit-identically for 12 s at 120 Hz on all 3 maps, incl. contact (≥1 collision each), boost, crash + respawn (Legacy; Velocity/Kage have rails everywhere, so crash is impossible there by design), PRNG continuation, separate input objects per human. Predictor parity: client predictor = server racer exactly (all maps). Reconcile + silent replay == uninterrupted prediction. |
| 3. Room tests | **PASS** (unit + real sockets): create/join, code validation, 4-seat cap, 5th human and 5th bot rejected without breaking the room, host-only actions (incl. inside the DO), ready/start gate (min 2 racers), map/mode/build/protocol mismatch, bot add/remove, malformed/oversized/rate-limited input, stale/out-of-order/duplicate frames, far-future frames, 250 ms input release, disconnect/reconnect by token, DNF retire after 15 s, teardown (empty/idle/lifetime), isolation of two rooms, **same-room rematch** (same code, new seed, identical results twice), budget fail-closed, budget hard stop. |
| 4. Real browser sessions | **Functional parts PASS, gameplay quality FAIL on this host** (§5). |
| 5. Network matrix | **PASS** for headless clients (§6). Browser clients on this host: below the playable floor (§5). |
| 6. Hosted test | **Not authorized; not done.** See docs/M4-DEPLOY-FREE.md. |

## 4. Architecture, protocol, deployment

See docs/M4-ARCHITECTURE.md, docs/M4-PROTOCOL.md and docs/M4-DEPLOY-FREE.md. Summary:
* Server-authoritative fixed 120 Hz sim with a 20 Hz net tick.
* One frame per racer per step. Missing frames are *missed*: held/released input, no waiting, no drift.
* Client prediction with silent replay; remote interpolation at 120 ms.
* Lead steered by the server-observed arrival margin.
* One Durable Object per room plus a Registry DO that enforces the shared budget.

## 5. Browser results (Playwright + Chromium SwiftShader, 2 CPU cores; NOT handset evidence)

Harness rules (after review):
* Functional checks must pass.
* Quality TARGETS are graded against stated thresholds (mispredict p95 ≤ 1 m; hard snaps ≤ 2/min) and never forced to pass.
* Metrics are INFO.
* A human DNF fails "every human finished".
* Default is **unthrottled** rendering.

| Run | FPS per page | Functional | Targets | Notes |
|---|---|---|---|---|
| D: 1 phone (touch 844×390) + 3 bots, Kage, full race | 1.5 | **6/6** | 1/2 (mispredict p95 **0.27 m** PASS; hard snaps 11 in 3 min FAIL) | Human finished (178.2 s) with the shared server order. Server missed **1.4 %** of frames. |
| A: desktop 1280×720 + phone 844×390, 2h+2b, Kage, full race + same-room rematch + leave | 0.8–1.2 | 11/15 | 0/8 | Both humans DNF at the cap. Frame gaps ~1.5 s (above the 1.5 s lead cap), so 77–80 % of frames missed. Lobby, bots, host-only UI, identical result order, no records, leave all PASS. |
| B: 4 humans + 5th refused | ~0.8 | see evidence | — | Long harness actions on this host; result recorded in docs/evidence/m4/browser/. |
| C: 1h+3b + portrait invite | — | Portrait invite panel PASS (screenshot) | — | — |

Fix history driven by these runs (docs/evidence/m4/browser/README.md): missed frames 93.7 % → 61 % →
1.4 % (single phone), human DNF → finished. Bugs found and fixed:
* catch-up capped at 250 ms per call;
* server waiting on missing frames (caused the `time-ahead` cascade seen at 474cc99);
* lead derived from a main-thread-biased clock;
* queue-drop bound below the lead cap;
* stale lead cooldown across rematches.

**Measured finding:** Chromium's `MessageEvent.timeStamp` equals handler time here, so a blocked main
thread inflates measured RTT (380–1500 ms on localhost). That is why lead control now uses
server-reported arrival margins, not the clock estimate.

**Playable floor (measured, this host):** input delivery stays healthy (≤ 2 % missed) while frame gaps
stay below ~0.6 s. Above ~1.5 s per frame, most inputs miss their step and the car mostly coasts. Fair,
enjoyable racing needs far more: **target ≥ 30 FPS sustained, minimum ~20 FPS**. That is a design
target, not a measurement on a phone.

Screenshots (inspected): test-results/mp/ (lobby desktop and phone, 2h+2b race desktop and phone,
results, portrait invite). Selected copies are in docs/screenshots/m4/.

## 6. Network matrix (headless clients, real sockets, injected delay; `lagMs` = RTT, half each way)

See docs/evidence/m4/net-matrix.md (Kage, 2h+2b unless stated). Highlights:
* At 50/100/200 ms RTT and 100 ms + 20 ms jitter: mispredict p95 **0.000 m**. Local input is applied
  immediately (prediction), never delayed by RTT.
* 4 humans at 100 ms: p95 up to 0.26 m (contact corrections).
* 500 ms outage: p95 ≤ 0.10 m, one correction > 1 m per client, no crash, pending bounded (84).
* Disconnect + auto-reconnect: rejoined the same seat mid-race with the full snapshot.
* Server tick p95 < 1 ms per 50 ms tick; 0 overruns.
* Cadence: up ~16 messages/s (~0.97 KB/s), down ~20.7 snapshots/s (~37–43 KB/s per client).

## 7. Event load test (measured) and cost model

`node tests/net/load.mjs --rooms 5 --seconds 60 --lag 100`: **one Node process** hosted 5 rooms and
all 20 headless clients (2 cores):

| Measure | Value |
|---|---|
| 6th room | refused: HTTP 503 `capacity` |
| Server tick per room | p50 0.31–0.35 ms, p95 0.43–0.51 ms, max ≤ 5.8 ms; 0 overruns |
| Process CPU (rooms + 20 clients) | 23 % of one core |
| Event-loop lag | p99 11.5 ms |
| RSS | 63 → 264 MB |
| 20 clients | mispredict p95 median 0.18 m, max 0.34 m; 0 hard snaps; 0 resyncs; max pending 37 frames |
| Per client | up 16.2 msg/s (967 B/s); down 20.7 msg/s (43.4 KB/s) |

Free-plan limits were rechecked 17 Nov 2026 from the official pages (docs/M4-DEPLOY-FREE.md):
100,000 DO requests/day, incoming WS messages at 20:1, outgoing free, 13,000 GB-s/day.

**Estimates (not measured on Cloudflare; not guarantees):**
* Incoming per human-minute: 16.2 × 60 = 972 messages = **~49 DO requests**.
* 20 humans × 10 race-minutes (= 200 human-minutes): **~9,700 requests**, plus ~20 WS connects,
  ~5–6 room creations, Registry RPCs and alarms (~1–2 per room-minute, ~100). That is **~10,000/day, ~10 %**
  of the free 100k. Sameer's rough model (~12,000) is the same order.
* Duration: a racing room cannot hibernate. Assuming the 128 MB allocation, 5 rooms × 10 min =
  50 room-minutes = 3,000 s × 0.125 GB = **375 GB-s (~3 %)**. Lobbies use the Hibernation API.
* **Sequential vs parallel heats:** the same human-minutes give about the same incoming-message requests
  and about the same racing room-minutes (duration). Parallel heats only change **wall-clock** time
  (5 heats at once ≈ one heat's duration; sequential ≈ 5×), plus the concurrency settings.
* App guard: the default `MAX_ACTIVE_ROOMS=3` refuses a 4th concurrent room. Five parallel heats need
  `MAX_ACTIVE_ROOMS=5`, a config change that needs approval. The daily guard is now a **hard stop**
  (worst-case overshoot = active rooms × 1 min).

## 8. Single-player regression

Result on the final commit: see the "Final verification" section appended below.

## 9. Honest notes / known gaps

* Local workerd state (`.wrangler/`) from one manual `wrangler dev` run was committed in 47f75d3 and
  removed in d74203f. It contains only local throwaway test-room data (incl. test session tokens of
  rooms that never existed outside this machine). It **remains in branch history** (no force-push).
  The scan now rejects such paths.
* `npm audit`: ws (8.23.0) and vite (6.4.6) were patched. Residual: picomatch 4.0.7 (latest) flagged `*`
  through vite/tinyglobby. It is build-time only; npm's only remedy is a vite downgrade with older advisories.
* Snapshots are ~1.8 KB (the full own-racer state). That is ~43 KB/s per phone, ~26 MB per 10 min.
  Trimming `me` to physics fields is a cheap next optimization.
* Not predicted: contact and others' slipstream (server corrections). Remote cars are 120 ms in the
  past, so close racing shows small visual offsets.
* Worker race test in workerd runs 14 s and does not reach results (titled so).
* A room restart mid-race aborts the race (by design; not persisted).
* No spectator/host screen yet (see §10).

## 10. Event readiness plan: Fun Friday (~20 people), 4-seat rooms (no 20-car race)

**Format**
* Five heats of 4 (bots fill a short heat). The heat winners (or the top 4 by time) race a final.
* Kage (3 laps, ~2.5–3 min) or Velocity (2 laps). Assisted mode for everyone (phones).

**Joining (non-technical)**
1. The organiser opens the site on a laptop and taps "Race friends". They create rooms and share the
   **invite link** (`…/?room=CODE`) in the chat, or read out the 6-character code (no I/L/O/U/0/1).
2. Phones open the link, type a name, tap Join, then turn sideways to race (the panel says so).

**Parallel vs sequential**
* Five rooms at once: ~10–15 min of wall clock in total. Needs `MAX_ACTIVE_ROOMS=5` and the load test
  passing on Cloudflare.
* Sequential: about the same free-tier cost, ~5× the wall clock, but 1 room at a time (lowest risk).
* Recommendation: run the first hosted event **sequentially or 2–3 rooms in parallel**. Go to 5 parallel
  only after a hosted dry run.

**Spectating (optional, not built)**
* A read-only "host screen" socket that receives snapshots without a seat (the interpolator already
  renders any car), shown on a TV. About one milestone.
* Not needed for the core: players see the results table.

**Quota messages**
* Already in the UI: "All race servers are busy right now. Try again in a few minutes." and
  "Today's free race time is used up. Try again tomorrow."

**Before promising the event**
1. Hosted dry run with the Nothing Phone + a second device.
2. One heat with 4 real phones.
3. Check the Cloudflare usage page after.

**Not promised:** the event is not supported until those hosted tests pass.

## 11. Three-role critique (one author, three lenses; not independent reviewers)

**Tech lead**
* Netcode is sound on real networks in headless tests. It degrades **gracefully but badly** on slow
  render loops (the main thread drives input).
* The next real fix for weak devices is a Web Worker running the input timer + prediction.
* The Registry DO is a single global object (fine at this scale; one RPC/min/room).
* Hibernation is tested only via workerd restart/eviction, not Cloudflare's real eviction timing.

**Product manager**
* The core loop (create → share → race → shared results → rematch) works.
* The biggest risk for the 20-person event is **mixed device quality**: one slow phone coasts and DNFs
  (fair for others, bad for that person).
* Second risk: venue Wi-Fi.
* Keep heats short. Have a laptop fallback.
* Do not schedule the event until the hosted dry run.

**Game designer — fairness**
* Assisted is shared per room.
* Bots use the same pace caps.
* Contact is authoritative.
* Higher-latency players see their own car immediately but others ~120 ms late, a small disadvantage in
  close fights.
* Reconnect keeps the car racing for ≤ 250 ms of held input, then it coasts. After 15 s it is retired
  as DNF (slow AI so it is not an obstacle-ghost). That is fair to others but harsh on a flaky phone.
* Rubber-band AI follows the leading human (unchanged).

## 12. Approval needed next

1. Sameer reviews this branch.
2. Approval to create **his own free Cloudflare account** and run the documented free deploy
   (docs/M4-DEPLOY-FREE.md).
3. Hosted test with the Nothing Phone (3a) + a second device.
4. After that, decisions on `MAX_ACTIVE_ROOMS` for the event, and whether to build the host screen.

No merge to `main` or production without a fresh explicit release gate.
