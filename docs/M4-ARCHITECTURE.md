# M4 multiplayer architecture

```
browser (src/client)            src/net (pure, shared)             server/
 game.js  render + HUD   <--   client.js  NetClient  ---- WS ---->  local.mjs   Node runtime (dev/tests)
 lobby.js room panel            netcode.js Predictor/Interp/Clock   worker.js   Workers + Durable Objects (prod)
                                protocol.js wire v2, codes, limits      \--> room-server.js  RoomServer (authoritative)
                                budget.js  shared free-tier guard   src/core   sim.js room.js  (pure, same code everywhere)
```

| Module | Owns | Depends on |
|---|---|---|
| `src/core/sim.js` | physics, AI, collisions, laps, snapshot/import incl. PRNG | nothing (pure) |
| `src/core/room.js` | lobby/seat rules: 4 seats incl. bots, host, ready/start gate, reconnect, DNF, host migration | nothing |
| `src/net/protocol.js` | wire format, validation, input frames, rate limits, room codes, tokens, error texts | nothing |
| `src/net/budget.js` | admission + heartbeats + daily room-time + active-room cap, shared by all rooms | nothing |
| `src/net/netcode.js` | client prediction/reconciliation, interpolation, clock sync | core |
| `src/net/client.js` | connection, reconnect, lobby actions, race timeline (lead), input batching | netcode, protocol |
| `server/room-server.js` | one authoritative room: transport-agnostic; fixed 120 Hz sim, 20 Hz net tick | core, net |
| `server/local.mjs` | Node HTTP + `ws` adaptor, static dist, Origin check, netsim (tests) | room-server, budget |
| `server/worker.js` | Cloudflare adaptor: `Room` DO per code (hibernation API, alarms), `Registry` DO singleton budget | room-server, budget |
| `src/client/lobby.js` | lobby DOM | net/protocol, core data |
| `src/client/game.js` | rendering; MP race view uses NetClient state (render sim not stepped) | everything client |

## Input worker (since 0cdfc72)

The browser runs the connection, input timeline and prediction in a **Web Worker**:
* `src/net/net-worker.js` wires `self`;
* the logic is in `src/net/worker-host.js` and `src/net/input-loop.js`, tested in Node;
* `src/client/net-proxy.js` is the page side, with the same API as `NetClient`.

How it works:
* The page pushes its current input frame on every input event (keys, touch, auto-throttle). It forces a
  neutral frame on blur, hidden, pagehide and touch/pointer cancel.
* The worker samples the latest frame on its own 8 ms timer, steps prediction, sends 20 Hz batches and
  publishes a plain-data render view (~12 ms) plus state (500 ms).
* The page renders the latest view and interpolates remote cars from forwarded snapshots.

Why: on a slow or stalled render thread, input used to arrive late and was counted as missed, so the car
coasted. Now the worker keeps delivering the last input on time.
* Single phone at ~1.3 FPS: 93.7 % → 0.0 % missed.
* 1.8 s page stall with steer held: 0 frames missed.

Safety net: input not re-confirmed by the page for 10 s is released. Fallback when Worker is unavailable,
or with `?mpworker=0`: the same NetClient on the page thread.

## Timing

* Server: race step `k` happens at `countdownAt + k/120 s` (server clock). A 50 ms interval advances
  the sim with `core/clock.js` (<= 250 ms per tick, >= 1 s gaps dropped and counted). No catch-up loop
  can run away. The interval exists only during countdown/race; it stops at results/close.
* Client: `ClockSync` estimates server time from ping/pong. It uses the socket event receive timestamp,
  so a slow render frame does not inflate RTT. The client predicts `lead` steps ahead of the server so
  frame `k` arrives just before step `k`. Lead floor = own frame interval + RTT/2 + 2 steps. It rises
  when the server reports missed frames or an empty queue, falls when the queue is long, and is capped at
  60 steps (500 ms). Input sampling, prediction steps and sending run on a 25 ms timer, not on render
  frames. After a main-thread stall of more than 1 s of steps, the client re-syncs (jumps) instead of
  replaying a backlog. The server counts those frames as missed.

## Prediction and interpolation

* Local car: private sim with only the local racer + drones (imported from the authoritative race
  snapshot). On each snapshot: reset to `me` at `ack`, silently replay un-acked frames, blend the visual
  error (decay 12/s), hard-snap above 6 m or on crash. Pending frames capped at 360.
* Not predicted: contact with other cars and their slipstream (server only). These arrive as corrections.
  Collisions stay ON for all racers (no "non-contact" mode exists in code: the WIP note mentioned one,
  but it was never implemented). Gameplay is unchanged from single player.
* Remote cars: snapshot buffer rendered 120 ms in the past, lap-seam-aware lerp, branch switch snaps,
  extrapolation capped at 100 ms, crash shown from the server's crashed flag.

## Disconnect policy

| When | What happens |
|---|---|
| Lobby | A socket drop keeps the seat for 15 s (shown as RECONNECTING; host passes at once to the next connected human). After 15 s the seat is freed. |
| Race, short gap | Last input is held for < 250 ms, then every input is released: the car coasts, no stuck throttle. |
| Race, rejoin | The client auto-reconnects with its session token within 15 s and gets the full race snapshot. |
| Race, gone > 15 s or Leave race | The car is retired: slow server AI drives it (still collides, so it is not an invincible ghost) and it is marked DNF. |
| Finish | When all active humans finish, or 30 s after the first human finishes, or at 8 min, the server publishes one result order. Results hold 20 s (host can return earlier), then the lobby. |
| Room close | No connected human for 60 s, lobby idle 15 min, or room lifetime 60 min. Budget released. |
| Room object restart mid-race | The race is aborted (state is not persisted). Players return to the lobby with a notice. |
