// M8 multiplayer pickup feedback gate (pure; used by game.js and tests/net/contested.test.mjs).
// Prediction may claim a pad the server then gives to someone else (contest), so positive pickup feedback
// (SHIELD / OVERDRIVE flash, chime, HUD chip, own shield bubble) is driven by the SERVER-CONFIRMED power
// flags of the local racer (compact racer field `pw` in each snapshot: 1 shield, 2 surge), never by prediction.
// - fires once per rising edge of a confirmed flag; a lost contest never fires;
// - the first snapshot a gate sees only seeds it (page reload / late join mid-race: no stale flash);
// - one gate per race (game.js keeps it on MP.race, which survives a reconnect into the same race), so a
//   reconnect replaying the same state cannot fire twice.
// Single-player is unchanged (immediate, from the local sim).
export const PW_SHIELD = 1, PW_SURGE = 2;
export function createPowerGate() {
  let seen = null;
  return {
    get flags() { return seen || 0; },
    // flags: own pw from an authoritative snapshot; returns newly confirmed kinds ('S' | 'B')
    snap(flags) {
      flags |= 0;
      if (seen === null) { seen = flags; return []; }
      const up = flags & ~seen, out = [];
      if (up & PW_SHIELD) out.push('S'); if (up & PW_SURGE) out.push('B');
      seen = flags; return out;
    }
  };
}
// own pw from a snapshot's compact racer list (index 16 = pw, see src/net/protocol.js COMPACT_FIELDS)
export const ownFlags = (snap, you) => { const x = snap && snap.a && snap.a.find(r => r[0] === you); return x ? x[16] | 0 : null; };
