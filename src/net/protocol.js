// NIGHTGRID multiplayer wire protocol (JSON text frames). Shared by browser client, server and tests.
// Rates: client input 20 Hz, server snapshot 20 Hz, simulation fixed 120 Hz (6 steps per net tick).
export const PROTOCOL = 1;
export const NET_HZ = 20, SIM_HZ = 120, STEPS_PER_TICK = SIM_HZ / NET_HZ;
export const MAX_MSG_BYTES = 1024, INPUT_RATE_MAX = 40, MSG_RATE_MAX = 60, BACKPRESSURE_BYTES = 64 * 1024;
export const INTERP_DELAY_MS = 120;
const KEYS = ['up', 'down', 'left', 'right', 'boost', 'drift'];
const TYPES = { hello: 1, input: 1, addBot: 1, removeBot: 1, config: 1, car: 1, ready: 1, start: 1, ping: 1, leave: 1 };
const str = (v, n) => typeof v === 'string' && v.length > 0 && v.length <= n;
// Validates and normalises one client message; returns { ok, msg } or { ok: false, error }.
export function parseClient(text) {
  if (typeof text !== 'string' || text.length > MAX_MSG_BYTES) return { ok: false, error: 'too-large' };
  let m; try { m = JSON.parse(text); } catch (e) { return { ok: false, error: 'bad-json' }; }
  if (!m || typeof m !== 'object' || !TYPES[m.t]) return { ok: false, error: 'bad-type' };
  switch (m.t) {
    case 'hello': if (!str(m.id, 40) || !str(m.build, 80) || (m.name != null && typeof m.name !== 'string')) return { ok: false, error: 'bad-hello' }; break;
    case 'input': {
      if (!Number.isInteger(m.seq) || m.seq < 0) return { ok: false, error: 'bad-input' };
      const k = {}; for (const key of KEYS) { const v = m.k && m.k[key]; if (v != null && (typeof v !== 'number' || !(v >= 0 && v <= 1))) return { ok: false, error: 'bad-input' }; k[key] = v || 0; }
      return { ok: true, msg: { t: 'input', seq: m.seq, k } };
    }
    case 'removeBot': if (!str(m.bot, 20)) return { ok: false, error: 'bad-bot' }; break;
    case 'config': if (m.map != null && typeof m.map !== 'string' || m.mode != null && typeof m.mode !== 'string') return { ok: false, error: 'bad-config' }; break;
    case 'car': if (!str(m.car, 20)) return { ok: false, error: 'bad-car' }; break;
    case 'ready': if (typeof m.ready !== 'boolean') return { ok: false, error: 'bad-ready' }; break;
  }
  return { ok: true, msg: m };
}
// token bucket per connection
export function rateLimiter(perSec, burst = perSec) {
  let tokens = burst, last = 0;
  return now => { tokens = Math.min(burst, tokens + (now - last) * perSec / 1000); last = now; if (tokens >= 1) { tokens--; return true; } return false; };
}
// compact racer state for rival interpolation (rounded; ~60 bytes per racer)
const r3 = v => Math.round(v * 1000) / 1000;
export function compactRacer(r) {
  return [r.id, r.path && r.path.closed ? 0 : 1, r3(r.s), r3(r.d), r3(r.h), r3(r.psi), r3(r.speed), r.lap, r3(r.prog), r.boost ? 1 : 0, r.finished ? 1 : 0, r.crashed > 0 ? 1 : 0, r3(r.roll || r.rollAI || 0), r3(r.steer)];
}
export const COMPACT_FIELDS = ['id', 'path', 's', 'd', 'h', 'psi', 'speed', 'lap', 'prog', 'boost', 'finished', 'crashed', 'roll', 'steer'];
