# M8 hazards: obstacles, shield and self-boost (gameplay lanes A and B)

Branch `claude/m8-friday` (base `bee26ee` / build `0661cad63d2e`, which stays frozen as `claude/m7-rc20`).
This changes `src/core`, `src/net` and `server/room-server.js`, so the **build id changes**. That means a paired Worker + frontend release, and only after approval. Nothing here has been pushed or deployed.

## Rules (authoritative sim = room server; clients only predict their own car)
- **Layout** (`src/core/hazards.js`) is built from track geometry only, with no RNG, so the server, the predictor and the renderer all build the same list from the map key.
  - Velocity: 4 obstacles. Kage: 3. Legacy: 3. Every map: 2 pad rows × 3 pads (S·B·S and B·S·B).
  - Nothing is placed within 300 m of the start/finish line, within 100 m of the lap seam, in tunnels, on steep/inverted track (U.y < 0.8), where the road widens, or after a corner. The run-up must be 120 m back with curvature ≤ 1/260.
  - Obstacles are ≥ 180 m apart and ≥ 80 m from pads.
- **Obstacle**: a static 3.2 × 2.4 × 1.6 m block at ±0.4·W. It blocks ≤ 25% of the road and the open side is ≥ 3 car widths.
  - Contact uses the least-overlap axis.
  - Side contact: push out, 0.3 restitution.
  - Nose contact: one debounced penalty (keep 60% of speed, lose ≤ 35 m/s), a glance of ≤ 6 m/s toward the open side, and a lateral slide-out of ≤ 0.35 m per step. The car is never pushed backwards or stopped.
  - Cars airborne above 1.6 m clear the block. Taxis hop over it deterministically. Bots steer around it.
- **Pads**: claims are checked every step after collisions.
  - Order is seat order: the first seat wins an exact same-step tie. This is a **deterministic tiebreak favouring earlier seats (the host is seat 0), not random and not "fair"**. A tie needs both cars on the pad in the same 120 Hz step (8.3 ms). Otherwise the car that arrives first wins.
  - Not claimable: finished, crashed, airborne (> 2.5 m), off the main path, or on a 6 s per-racer cooldown. You also can't take a kind you already hold. The pad then stays for others.
  - Pads respawn after 6 s of sim time.
- **Shield**: lasts 15 s, or until it absorbs one obstacle or taxi hit (then 0.4 s pass-through). Consumed on the server.
- **Self-boost (OVERDRIVE)**: fires automatically for 1.8 s and doesn't drain the meter. No new input bit, so the input protocol is unchanged.
- **Wire**:
  - Racer power fields ride in `me` and the race snapshot.
  - The `s` tick carries `pk` (remaining respawn seconds per pad, 0 = ready).
  - The compact racer carries `pw` (1 = shield, 2 = surge) for remote visuals.
  - `Predictor.reconcile` applies the server's `pk` before replaying, so pad availability is always the server's.
- **Restore**:
  - Sim snapshots keep every timer (`shieldT`, `surgeT`, `powCD`, `obT`, `passT`, pad `readyAt`). Unit test: a resume mid-cooldown matches an uninterrupted run.
  - A Worker restart during a race aborts that race (existing RC20 behaviour). The rematch starts with all powers and pads cleared (`placeRacer`/`gridUp`).
- **Single-player**: hazards are on, with the same layout. Record keys are unchanged.

## Measured over real sockets (`tests/net/contested.test.mjs`: 100 ms RTT, jitter, adaptive lead ~21 frames)
- Shield row (exact tie): both clients predicted the shield. The server gave it to seat 0. The loser's prediction was removed after ~280 ms, which is the window where the loser sees a false SHIELD flash and bubble.
- Boost row (not tied): exactly one claim. The loser's prediction was corrected after ~210 ms.
- After H1's socket was killed and it reconnected, both predictors agreed with the server on power flags and pad state. Rematch cleared everything.
- No hard snaps. Correction p95 ≤ 0.08 m, max 0.71 m.

## Known limits / not done
- Loser-side false pickup feedback lasts ~RTT + lead (0.2–0.3 s). A client-only fix would delay the FLASH until a server tick confirms it, at the cost of ~0.2 s of winner feedback. Not applied; needs a decision.
- The scripted test drivers sit behind taxis unless told to pass them. That is pre-existing RC20 traffic contact, not M8.
- Screenshots come from SwiftShader. No real-device FPS or touch testing here.
