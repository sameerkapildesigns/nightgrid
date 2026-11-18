// NIGHTGRID multiplayer wire protocol v2 (JSON text frames). Shared by browser client, servers and tests.
// See docs/M4-PROTOCOL.md. Simulation is fixed 120 Hz; clients send their per-step input FRAMES in
// batches at ~20 Hz; the server consumes exactly one frame per racer per simulation step and sends
// one snapshot per network tick (20 Hz). Frames carry sequence numbers so the client can replay
// un-acknowledged input after an authoritative correction (prediction / reconciliation).
import { MAX_SEATS } from '../core/room.js';   // room-full text states the real cap
export const PROTOCOL = 2;
export const NET_HZ = 20, SIM_HZ = 120, STEPS_PER_TICK = SIM_HZ / NET_HZ;
export const MAX_MSG_BYTES = 1024;          // client -> server text frame cap
export const MAX_FRAMES_PER_MSG = 24;       // 200 ms of input per message at most
export const FRAME_RATE_MAX = 150, FRAME_BURST = 300;  // per-connection input frames/s (sim is 120/s); burst covers catch-up + lead growth after a stall
export const MSG_RATE_MAX = 40, MSG_BURST = 40;        // all messages per connection per second
export const MAX_AHEAD_FRAMES = 360;        // frames more than 3 s ahead of the server are a time-manipulation attempt
export const QUEUE_DROP_FRAMES = 240;       // >2 s queued: the server skips ahead (bounded latency); must exceed MAX_LEAD_FRAMES
export const MAX_LEAD_FRAMES = 180;         // client never runs more than 1.5 s ahead of the server (slow devices)
export const BACKPRESSURE_BYTES = 64 * 1024;
export const INTERP_DELAY_MS = 120;         // remote cars render ~120 ms in the past
export const EXTRAP_MAX_MS = 100;           // bounded extrapolation when snapshots are late
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';   // no I L O U 0 1 (readable aloud)
export const CODE_LEN = 6;                  // 30^6 = 7.3e8 codes (~29 bits)
const TYPES = { hello: 1, in: 1, addBot: 1, removeBot: 1, config: 1, car: 1, name: 1, ready: 1, start: 1, ping: 1, leave: 1, lobby: 1 };
const str = (v, n) => typeof v === 'string' && v.length > 0 && v.length <= n;
const bad = error => ({ ok: false, error });

// ---- input frame encoding: one small integer per simulation step ----
// bits 0..3: up, down, boost, drift; bits 4..11: steer + 100 (0..200, steer in hundredths, analogue tilt)
export function encodeFrame(k) {
  const st = Math.round(Math.max(-1, Math.min(1, (+k.right || 0) - (+k.left || 0))) * 100);
  return (k.up ? 1 : 0) | (k.down ? 2 : 0) | (k.boost ? 4 : 0) | (k.drift ? 8 : 0) | ((st + 100) << 4);
}
export function decodeFrame(f, out = {}) {
  const st = ((f >> 4) & 0xff) - 100;
  out.up = f & 1; out.down = (f >> 1) & 1; out.boost = (f >> 2) & 1; out.drift = (f >> 3) & 1;
  out.right = st > 0 ? st / 100 : 0; out.left = st < 0 ? -st / 100 : 0; return out;
}
export const validFrame = f => Number.isInteger(f) && f >= 0 && f <= ((200 << 4) | 15) && ((f >> 4) & 0xff) <= 200;
export const ZERO_FRAME = encodeFrame({});

// Validates and normalises one client message; returns { ok, msg } or { ok: false, error }.
export function parseClient(text) {
  if (typeof text !== 'string' || text.length > MAX_MSG_BYTES) return bad('too-large');
  let m; try { m = JSON.parse(text); } catch (e) { return bad('bad-json'); }
  if (!m || typeof m !== 'object' || Array.isArray(m) || !TYPES[m.t]) return bad('bad-type');
  switch (m.t) {
    case 'hello':
      if (m.p !== PROTOCOL) return bad('protocol-mismatch');
      if (!str(m.build, 80) || (m.name != null && typeof m.name !== 'string') || (m.token != null && !str(m.token, 64))) return bad('bad-hello');
      return { ok: true, msg: { t: 'hello', p: m.p, build: m.build, name: m.name == null ? '' : String(m.name).slice(0, 40), token: m.token || null } };
    case 'in': {
      if (!Number.isInteger(m.q) || m.q < 0 || m.q > 1e7 || !Array.isArray(m.f) || m.f.length < 1 || m.f.length > MAX_FRAMES_PER_MSG || !m.f.every(validFrame)) return bad('bad-input');
      return { ok: true, msg: { t: 'in', q: m.q, f: m.f } };
    }
    case 'removeBot': if (!str(m.bot, 12)) return bad('bad-bot'); return { ok: true, msg: { t: m.t, bot: m.bot } };
    case 'config':
      if ((m.map != null && !str(m.map, 16)) || (m.mode != null && !str(m.mode, 16))) return bad('bad-config');
      return { ok: true, msg: { t: m.t, map: m.map == null ? null : m.map, mode: m.mode == null ? null : m.mode } };
    case 'car': if (!str(m.car, 16) || (m.paint != null && !Number.isInteger(m.paint))) return bad('bad-car'); return { ok: true, msg: { t: m.t, car: m.car, paint: m.paint || 0 } };
    case 'name': if (typeof m.name !== 'string' || m.name.length > 40) return bad('bad-name'); return { ok: true, msg: { t: m.t, name: m.name } };
    case 'ready': if (typeof m.ready !== 'boolean') return bad('bad-ready'); return { ok: true, msg: { t: m.t, ready: m.ready } };
    case 'ping': if (typeof m.c !== 'number' || !isFinite(m.c)) return bad('bad-ping'); return { ok: true, msg: { t: 'ping', c: m.c } };
  }
  return { ok: true, msg: { t: m.t } };
}
// token bucket per connection (times in ms, supplied by the caller)
export function rateLimiter(perSec, burst = perSec) {
  let tokens = burst, last = null;
  return (now, cost = 1) => { if (last == null) last = now; tokens = Math.min(burst, tokens + Math.max(0, now - last) * perSec / 1000); last = now; if (tokens >= cost) { tokens -= cost; return true; } return false; };
}
// Unguessable short room code from a CSPRNG supplied by the runtime (crypto.getRandomValues).
export function makeRoomCode(getRandomValues) {
  const n = CODE_ALPHABET.length, lim = 256 - (256 % n), out = []; const buf = new Uint8Array(16);
  while (out.length < CODE_LEN) { getRandomValues(buf); for (const b of buf) if (b < lim && out.length < CODE_LEN) out.push(CODE_ALPHABET[b % n]); }
  return out.join('');
}
export const normalizeCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const validCode = s => typeof s === 'string' && s.length === CODE_LEN && [...s].every(c => CODE_ALPHABET.includes(c));
export function makeToken(getRandomValues) { const b = new Uint8Array(24); getRandomValues(b); return [...b].map(x => x.toString(16).padStart(2, '0')).join(''); }

// compact racer state for remote-car interpolation (rounded)
const r3 = v => Math.round(v * 1000) / 1000, r2 = v => Math.round(v * 100) / 100;
export const COMPACT_FIELDS = ['id', 'br', 's', 'd', 'h', 'psi', 'speed', 'lap', 'prog', 'boost', 'finished', 'crashed', 'roll', 'steer', 'drift', 'thr'];
export function compactRacer(r, branch) {
  return [r.id, r.path === branch ? 1 : 0, r3(r.s), r3(r.d), r3(r.h), r3(r.psi), r2(r.speed), r.lap, r2(r.prog), r.boost ? 1 : 0, r.finished ? 1 : 0, r.crashed > 0 ? 1 : 0, r3(r.autopilot ? r.rollAI : r.steer * 0.34), r3(r.steer), r.drift ? 1 : 0, r2(r.thr)];
}
export function expandRacer(a) { const o = {}; COMPACT_FIELDS.forEach((k, i) => { o[k] = a[i]; }); return o; }
// human-readable error text for the lobby UI
export const ERROR_TEXT = {
  'room-full': `That room is full (${MAX_SEATS} seats).`, 'race-in-progress': 'That room is already racing. Wait for it to finish.',
  'build-mismatch': 'Your game version differs from the room server. Reload the page to update.', 'protocol-mismatch': 'Your game version differs from the room server. Reload the page to update.',
  'no-room': 'No room with that code. Check the code or create a new room.', 'bad-code': 'Room codes are 6 letters/numbers.',
  'capacity': 'All race servers are busy right now. Try again in a few minutes.', 'daily-budget': "Today's free race time is used up. Try again tomorrow.",
  'not-host': 'Only the host can do that.', 'need-2-racers': 'Add a bot or wait for a friend: a race needs at least 2 racers.', 'not-all-ready': 'Waiting for everyone to be ready.',
  'player-reconnecting': 'Waiting for a player to reconnect.', 'seat-expired': 'Your seat expired after disconnecting. Join again from the lobby.',
  'origin': 'This page is not allowed to join rooms.', 'server-unreachable': 'Multiplayer server not reachable. Check your connection, or this site may be single-player only.', 'connection-lost': 'Connection to the room was lost.', 'budget-unavailable': 'The race server could not confirm free capacity, so the room closed. Try again later.', 'time-ahead': 'Your clock jumped; reconnecting may help.', 'rate': 'Too many requests. Slow down.', 'room-closed': 'The room was closed.'
};
