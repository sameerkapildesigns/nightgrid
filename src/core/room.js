// Multiplayer room / lobby model (pure, transport-agnostic; used by the room server). Seats: max 4
// TOTAL, humans + server-run bots. The host adds/removes bots in empty seats; bots are always ready.
// Host picks map + driving mode; each human picks a car and readies; the race starts only when every
// seat is ready. Disconnected humans keep their seat for RECONNECT_MS (lobby and race); in a race their
// inputs are released after STALE_INPUT_MS without input. All times are passed in (no clocks here).
export const MAX_SEATS = 4, RECONNECT_MS = 15000, STALE_INPUT_MS = 250;
export const ROOM_PHASES = ['lobby', 'countdown', 'race', 'results'];
const MAPS_OK = ['velocity', 'technical', 'legacy'], MODES_OK = ['assisted', 'expert'];
const CARS_OK = ['hypercar', 'endurance', 'wedge', 'rally', 'streamliner', 'wipeout'];
const err = (code) => ({ ok: false, error: code });

export function createRoom({ code, build, now = 0 }) {
  return { code, build, phase: 'lobby', hostId: null, seats: [], map: 'velocity', mode: 'assisted', seed: 0, countdownAt: 0, createdAt: now, nextBot: 1, version: 0 };
}
const seatOf = (room, id) => room.seats.find(s => s.id === id);
const bump = room => { room.version++; return { ok: true }; };

export function join(room, { id, name, build }, now) {
  if (build !== room.build) return err('build-mismatch');
  const back = seatOf(room, id);
  if (back && back.kind === 'human') { if (back.left) return err('seat-expired'); back.connected = true; back.dcAt = 0; back.lastInputAt = now; return bump(room); }
  if (room.phase !== 'lobby') return err('race-in-progress');
  if (room.seats.length >= MAX_SEATS) return err('room-full');
  room.seats.push({ id, kind: 'human', name: String(name || 'Player').slice(0, 16), car: 'hypercar', ready: false, connected: true, dcAt: 0, left: false, lastInputAt: now });
  if (!room.hostId) room.hostId = id;
  return bump(room);
}
export function addBot(room, byId) {
  if (byId !== room.hostId) return err('not-host'); if (room.phase !== 'lobby') return err('not-in-lobby');
  if (room.seats.length >= MAX_SEATS) return err('room-full');
  const n = room.nextBot++; room.seats.push({ id: 'bot' + n, kind: 'bot', name: 'BOT ' + n, car: ['wedge', 'hypercar', 'endurance'][(n - 1) % 3], ready: true, connected: true, left: false });
  return bump(room);
}
export function removeBot(room, byId, botId) {
  if (byId !== room.hostId) return err('not-host'); if (room.phase !== 'lobby') return err('not-in-lobby');
  const i = room.seats.findIndex(s => s.id === botId && s.kind === 'bot'); if (i < 0) return err('no-such-bot');
  room.seats.splice(i, 1); return bump(room);
}
export function configure(room, byId, { map, mode }) {
  if (byId !== room.hostId) return err('not-host'); if (room.phase !== 'lobby') return err('not-in-lobby');
  if (map != null) { if (!MAPS_OK.includes(map)) return err('bad-map'); room.map = map; }
  if (mode != null) { if (!MODES_OK.includes(mode)) return err('bad-mode'); room.mode = mode; }
  for (const s of room.seats) if (s.kind === 'human') s.ready = false;   // settings changed: re-confirm
  return bump(room);
}
export function setCar(room, id, car) {
  const s = seatOf(room, id); if (!s || s.kind !== 'human') return err('no-seat'); if (room.phase !== 'lobby') return err('not-in-lobby');
  if (!CARS_OK.includes(car)) return err('bad-car'); s.car = car; s.ready = false; return bump(room);
}
export function setReady(room, id, ready) {
  const s = seatOf(room, id); if (!s || s.kind !== 'human') return err('no-seat'); if (room.phase !== 'lobby') return err('not-in-lobby');
  s.ready = !!ready; return bump(room);
}
export function canStart(room) {
  const humans = room.seats.filter(s => s.kind === 'human' && s.connected && !s.left);
  return room.phase === 'lobby' && humans.length >= 1 && room.seats.length >= 1 && room.seats.length <= MAX_SEATS && room.seats.every(s => s.ready && (s.kind === 'bot' || s.connected));
}
// host starts: fixes the seed and a shared countdown start time (server clock)
export function start(room, byId, now, seed, countdownMs = 3000) {
  if (byId !== room.hostId) return err('not-host'); if (!canStart(room)) return err('not-ready');
  room.phase = 'countdown'; room.seed = seed >>> 0; room.countdownAt = now + countdownMs; return bump(room);
}
export function disconnect(room, id, now) {
  const s = seatOf(room, id); if (!s || s.kind !== 'human') return err('no-seat');
  s.connected = false; s.dcAt = now; if (room.phase === 'lobby') s.ready = false; return bump(room);
}
// periodic housekeeping: expire seats, migrate host, report which humans have stale input
export function tick(room, now) {
  const changes = [];
  for (const s of room.seats.slice()) {
    if (s.kind !== 'human' || s.connected || s.left) continue;
    if (now - s.dcAt >= RECONNECT_MS) {
      if (room.phase === 'lobby') room.seats.splice(room.seats.indexOf(s), 1); else s.left = true;   // in a race: DNF, car stays
      changes.push(['expired', s.id]);
    }
  }
  if (!room.seats.some(s => s.id === room.hostId && s.kind === 'human' && !s.left)) {
    const h = room.seats.find(s => s.kind === 'human' && s.connected && !s.left); room.hostId = h ? h.id : null; if (h) changes.push(['host', h.id]);
  }
  const stale = room.phase === 'race' ? room.seats.filter(s => s.kind === 'human' && !s.left && now - (s.lastInputAt || 0) > STALE_INPUT_MS).map(s => s.id) : [];
  if (changes.length) room.version++;
  return { changes, stale, empty: !room.seats.some(s => s.kind === 'human' && !s.left) };
}
export function publicState(room) {
  return { code: room.code, phase: room.phase, hostId: room.hostId, map: room.map, mode: room.mode, countdownAt: room.countdownAt, version: room.version,
    seats: room.seats.map(s => ({ id: s.id, kind: s.kind, name: s.name, car: s.car, ready: s.ready, connected: s.connected, left: !!s.left })), canStart: canStart(room) };
}
