// Shared free-tier guard (pure; one instance for ALL rooms: a singleton Durable Object in production,
// one in-process object locally). Rooms must be admitted before they exist, report their open time
// (heartbeat), and close. Charging is deliberately conservative: a room's whole open wall time counts,
// whether it is racing (ticking, cannot hibernate) or idling in the lobby. All times in ms, passed in.
export const DEFAULT_BUDGET = {
  dailyRoomMs: 4 * 3600e3,        // 4 room-hours/day app budget (adjustable; NOT a Cloudflare guarantee)
  safety: 0.85,                   // admit only while usage + reservations stay below 85 % of the budget
  maxActiveRooms: 3,              // concurrent rooms
  reserveMs: 10 * 60e3,           // each open room reserves 10 min of budget ahead of its heartbeats
  roomMaxLifetimeMs: 60 * 60e3,   // a room closes after 60 min whatever happens
  staleMs: 3 * 60e3,              // a room that stops heart-beating is reaped (charged to its last beat)
  maxCreatesPerDay: 200           // hard cap on room creations per day
};
const dayOf = now => new Date(now).toISOString().slice(0, 10);   // UTC day (Cloudflare's daily limits reset at 00:00 UTC)

export function createBudget(cfg = {}, state = null) {
  const C = { ...DEFAULT_BUDGET, ...cfg };
  const S = state || { day: '', usedMs: 0, creates: 0, active: {} };
  function roll(now) { const d = dayOf(now); if (S.day !== d) { S.day = d; S.usedMs = 0; S.creates = 0; for (const a of Object.values(S.active)) a.chargedTo = now; } }
  function reap(now) {
    for (const [code, a] of Object.entries(S.active)) if (now - a.last > C.staleMs) { S.usedMs += Math.max(0, a.last - a.chargedTo); delete S.active[code]; }
  }
  const limit = () => C.dailyRoomMs * C.safety;
  const outstanding = () => Object.keys(S.active).length * C.reserveMs;
  const api = {
    cfg: C, state: S,
    // returns { ok } or { ok:false, error:'capacity'|'daily-budget' }
    admit(code, now) {
      roll(now); reap(now);
      if (S.active[code]) return { ok: false, error: 'exists' };
      if (Object.keys(S.active).length >= C.maxActiveRooms) return { ok: false, error: 'capacity' };
      if (S.creates >= C.maxCreatesPerDay || S.usedMs + outstanding() + C.reserveMs > limit()) return { ok: false, error: 'daily-budget' };
      S.active[code] = { since: now, last: now, chargedTo: now }; S.creates++; return { ok: true, closeAt: now + C.roomMaxLifetimeMs };
    },
    // a room reports it is alive; charges its time since the last beat. Returns { ok, close? }.
    beat(code, now) {
      roll(now); const a = S.active[code]; if (!a) return { ok: false, close: 'unknown-room' };
      S.usedMs += Math.max(0, now - a.chargedTo); a.chargedTo = now; a.last = now; reap(now);
      if (now - a.since >= C.roomMaxLifetimeMs) return { ok: true, close: 'lifetime' };
      return { ok: true };
    },
    // may this room start a race now? (budget left for at least one reservation)
    canRace(code, now) { roll(now); reap(now); if (!S.active[code]) return { ok: false, error: 'unknown-room' }; return S.usedMs + outstanding() <= limit() ? { ok: true } : { ok: false, error: 'daily-budget' }; },
    release(code, now) { roll(now); const a = S.active[code]; if (!a) return; S.usedMs += Math.max(0, now - a.chargedTo); delete S.active[code]; },
    report(now) { roll(now); reap(now); return { day: S.day, usedMin: +(S.usedMs / 60e3).toFixed(1), budgetMin: C.dailyRoomMs / 60e3, limitMin: +(limit() / 60e3).toFixed(1), active: Object.keys(S.active).length, maxActive: C.maxActiveRooms, creates: S.creates }; }
  };
  return api;
}
