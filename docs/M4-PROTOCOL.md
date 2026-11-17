# NIGHTGRID multiplayer protocol v2

JSON text WebSocket frames. Source of truth: `src/net/protocol.js` (shared by browser, Node runtime,
Durable Object and tests). `PROTOCOL = 2`.

## Endpoints

| Method | Path | Result |
|---|---|---|
| POST | `/api/rooms` | `201 {ok, code}` or `503 {ok:false, error:'capacity'|'daily-budget'}`, `429 rate` (local runtime), `403 origin` |
| GET | `/api/rooms/:code` | `{ok, phase, seats}` or `404 no-room` |
| WS | `/api/rooms/:code/ws` | room socket; foreign `Origin` refused (403); unknown code: `error no-room` + close 4004 |

Room codes: 6 characters from `ABCDEFGHJKMNPQRSTVWXYZ23456789` (no I/L/O/U/0/1), CSPRNG, ~29 bits.
Codes are case-insensitive on input. Invite link: `https://<host>/?room=CODE`.

## Handshake

Client → `{t:'hello', p:2, build, name, token?}`.
`build` is `scripts/build-id.mjs` (SHA-256 over core + net + room server); a different build or protocol
gets a **fatal** `{t:'error', error:'build-mismatch'|'protocol-mismatch', fatal:true}` and the socket
closes: the UI says to reload.
Server → `{t:'welcome', p, id, token, code, notice, serverNow}`. `id` is **server-issued** (`p1`..). `token` is a
48-hex session token kept in the tab's `sessionStorage` and sent back on reconnect. It is never sent to
other clients, logged or committed. An unknown token in a running race is refused (`race-in-progress`).

The race message carries everything both sides must agree on:
`{t:'race', p, build, map, mode, seed, countdownAt, serverNow, step, seats:[{id,kind,name,car,paint,pers}], you, snap}`.
`snap` is the full authoritative simulation snapshot (incl. PRNG state), so a reconnecting client resumes mid-race.

## Lobby messages (client → server; the server validates all of them)

`addBot`, `removeBot {bot}`, `config {map?, mode?}` (host only), `car {car, paint}`, `name {name}`,
`ready {ready}`, `start` (host only; refused with the blocker: `need-2-racers`, `not-all-ready`,
`player-reconnecting`, `daily-budget`), `lobby` (host only, from results), `leave`, `ping {c}`.
Server → `{t:'lobby', room}` (public state only: no tokens), `{t:'results', order, map, mode, seed, steps}`,
`{t:'closed', reason}`, `{t:'error', error, fatal}`, `{t:'pong', c, s}`.

## Input: sequenced per-step frames

One integer per 120 Hz simulation step: bits 0-3 = up, down, boost, drift; bits 4-11 = steer×100+100
(analogue tilt in hundredths). `{t:'in', q: firstSeq, f:[frame, ...]}`, 1-24 frames per message, sent
about every 50 ms (and from a 25 ms timer, not from render frames). Frame `k` is the input for race step `k`
(step 0 = lights out). Unknown fields are dropped. There is **no** message that can set a position,
speed, lap, checkpoint or result.

Server rules (`server/room-server.js`):
* exactly one frame per racer per step; a frame not present when its step runs is **missed**: the last
  input is held, or every input is released if nothing arrived for 250 ms (no stuck throttle); the frame
  is discarded if it arrives later. Latency is therefore bounded and cannot drift; stalled clients cannot bank time;
* frames > 240 steps (2 s) ahead of the server's step: rejected `time-ahead`;
* > 72 frames queued (600 ms): the oldest are skipped (`skippedFrames`);
* token buckets per connection: 150 frames/s (burst 150), 40 messages/s; 1 KB text cap (local runtime
  also caps ws payload at 4 KB).

## Snapshots (server → client, 20 Hz)

`{t:'s', k, sn, ph, rt, tm, ack, q, ms, me, a, dr, fo}`.

| Field | Meaning |
|---|---|
| `k` | server step |
| `sn` | server time (ms) |
| `ack` | last frame sequence consumed for this client (`q.next-1`) |
| `q` | frames queued for this client |
| `ms` | total missed frames for this client |
| `me` | the client's own full racer state (for reconciliation) |
| `a` | compact state of every racer: `id, branch, s, d, h, psi, speed, lap, prog, boost, finished, crashed, roll, steer, drift, thr` |
| `dr` | drones `[s, h, vh]` |
| `fo` | finish order (ids) |

Measured size: about 1.8 KB per snapshot (~37 KB/s per client down), see docs/M4-REPORT.md.
Snapshots are skipped, never queued, when a socket's buffer exceeds 64 KB.

## Authoritative vs presentation events

Authoritative (server only): physics, collisions, boost meter and use, crash/respawn, checkpoints and
laps, finish order and times, AI, DNF. Presentation (client, from prediction; may be undone by a
correction): sounds, flashes (LAP, SLINGSHOT, sector splits), sparks, shake. Replays after a correction
are silent, so effects do not repeat. "FINISH"/"VICTORY" are shown from the server state, not from prediction.
Multiplayer never writes single-player lap records.
