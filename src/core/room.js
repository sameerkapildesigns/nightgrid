import{validVariant}from './variants.js';
// Multiplayer room / lobby model (pure, transport-agnostic; used by the room server).
// Seats: max 4 TOTAL, humans + server-run bots. The host adds/removes bots in empty seats; bots are
// always ready. Host picks map + driving mode; each human picks a car/paint and readies. A race needs
// >= 2 seats (bots count), >= 1 connected human, and every connected human ready.
// Player ids are SERVER-issued (never chosen by a client). Reconnect is by an opaque session token held
// by the server layer, not by this model. All times are passed in (no clocks here).
// M7: 20 seats (user decision 18 Nov: all 20 in one race). Must equal sim.js MAX_RACERS (room.test asserts).
// Release is gated on real-hardware FPS + 20-client gates (HANDOFF), not on this constant.
export const MAX_SEATS = 20, MIN_RACERS = 2, RECONNECT_MS = 15000, STALE_INPUT_MS = 250, NAME_MAX = 16;
export const ROOM_PHASES = ['lobby', 'countdown', 'race', 'results'];
export const MAPS_OK = ['velocity', 'technical', 'casino', 'summit', 'legacy'], MODES_OK = ['assisted', 'expert'];
export const CARS_OK = ['hypercar', 'endurance', 'wedge', 'rally', 'streamliner', 'wipeout', 'kestrel', 'manta'];   // R2: + original procedural ships (paired Worker release)
export const PAINT_COUNT = 4;
export const BOT_PERS = ['GHOST', 'VEX', 'BLITZ'];
export const BOT_CAR = { GHOST: 'wipeout', VEX: 'wedge', BLITZ: 'endurance' };
const err = (code) => ({ ok: false, error: code });

export function cleanName(name) {
  const s = String(name == null ? '' : name).replace(/[\u0000-\u001f\u007f<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  return s || 'Player';
}
export function createRoom({ code, build, now = 0, map = 'velocity', mode = 'expert' }) {
  return { code, build, phase: 'lobby', hostId: null, seats: [], map, mode, weapons: false, vr: 0, seed: 0, countdownAt: 0, createdAt: now, nextBot: 1, nextHuman: 1, version: 0, results: null };
}
const seatOf = (room, id) => room.seats.find(s => s.id === id);
const bump = room => { room.version++; return { ok: true }; };
const isHost = (room, id) => id != null && id === room.hostId;
const liveHumans = room => room.seats.filter(s => s.kind === 'human' && !s.left);

// New human seat. Returns { ok, id } (server-issued id) or an error.
export function join(room, { name, build }, now) {
  if (build !== room.build) return err('build-mismatch');
  if (room.phase !== 'lobby') return err('race-in-progress');
  if (room.seats.length >= MAX_SEATS) return err('room-full');
  const id = 'p' + room.nextHuman++;
  room.seats.push({ id, kind: 'human', name: cleanName(name), car: 'hypercar', paint: 0, ready: false, connected: true, dcAt: 0, left: false, lastInputAt: now });
  if (!room.hostId || !liveHumans(room).some(s => s.id === room.hostId)) room.hostId = id;
  bump(room); return { ok: true, id };
}
// Existing seat comes back (the server has already matched the session token to this id).
export function reconnect(room, id, now) {
  const s = seatOf(room, id); if (!s || s.kind !== 'human') return err('no-seat'); if (s.left) return err('seat-expired');
  s.connected = true; s.dcAt = 0; s.lastInputAt = now; return bump(room);
}
export function addBot(room, byId) {
  if (!isHost(room, byId)) return err('not-host'); if (room.phase !== 'lobby') return err('not-in-lobby');
  if (room.seats.length >= MAX_SEATS) return err('room-full');
  const used = new Set(room.seats.filter(s => s.kind === 'bot').map(s => s.pers));
  const pers = BOT_PERS.find(p => !used.has(p)) || BOT_PERS[(room.nextBot - 1) % 3];
  room.seats.push({ id: 'bot' + room.nextBot++, kind: 'bot', pers, name: pers, car: BOT_CAR[pers], paint: 0, ready: true, connected: true, left: false });
  return bump(room);
}
export function removeBot(room, byId, botId) {
  if (!isHost(room, byId)) return err('not-host'); if (room.phase !== 'lobby') return err('not-in-lobby');
  const i = room.seats.findIndex(s => s.id === botId && s.kind === 'bot'); if (i < 0) return err('no-such-bot');
  room.seats.splice(i, 1); return bump(room);
}
export function configure(room, byId, { map, mode, weapons, vr }) {
  if (!isHost(room, byId)) return err('not-host'); if (room.phase !== 'lobby') return err('not-in-lobby');
  if (map != null && !MAPS_OK.includes(map)) return err('bad-map');
  if (mode != null && !MODES_OK.includes(mode)) return err('bad-mode');
  if (weapons != null && typeof weapons !== 'boolean') return err('bad-config');
  if (vr != null && (!Number.isInteger(vr)||vr<0||vr>7)) return err('bad-config');
  if(!validVariant(map??room.map,vr??room.vr??0))return err('unsupported-variant');
  const changed = (weapons != null && weapons !== room.weapons) || (vr != null && vr !== room.vr) || (map != null && map !== room.map) || (mode != null && mode !== room.mode);
  if (map != null) room.map = map; if (mode != null) room.mode = mode;
  if (weapons != null) room.weapons = weapons; if (vr != null) room.vr = vr;
  if (changed) for (const s of room.seats) if (s.kind === 'human') s.ready = false;   // settings changed: re-confirm
  return bump(room);
}
export function setCar(room, id, car, paint = 0) {
  const s = seatOf(room, id); if (!s || s.kind !== 'human') return err('no-seat'); if (room.phase !== 'lobby') return err('not-in-lobby');
  if (!CARS_OK.includes(car)) return err('bad-car');
  if (!Number.isInteger(paint) || paint < 0 || paint >= PAINT_COUNT) return err('bad-paint');
  if (s.car !== car) s.ready = false;   // a different car needs a fresh confirmation; a paint change does not
  s.car = car; s.paint = paint; return bump(room);
}
export function setName(room, id, name) {
  const s = seatOf(room, id); if (!s || s.kind !== 'human') return err('no-seat'); if (room.phase !== 'lobby') return err('not-in-lobby');
  s.name = cleanName(name); return bump(room);
}
export function setReady(room, id, ready) {
  const s = seatOf(room, id); if (!s || s.kind !== 'human') return err('no-seat'); if (room.phase !== 'lobby') return err('not-in-lobby');
  s.ready = !!ready; return bump(room);
}
export function canStart(room) {
  const humans = room.seats.filter(s => s.kind === 'human' && s.connected && !s.left);
  return room.phase === 'lobby' && humans.length >= 1 && room.seats.length >= MIN_RACERS && room.seats.length <= MAX_SEATS &&
    room.seats.every(s => s.kind === 'bot' || (s.connected && s.ready));
}
export function startBlocker(room) {
  if (room.phase !== 'lobby') return 'not-in-lobby';
  if (room.seats.length < MIN_RACERS) return 'need-2-racers';
  if (room.seats.some(s => s.kind === 'human' && !s.connected)) return 'player-reconnecting';
  if (room.seats.some(s => s.kind === 'human' && !s.ready)) return 'not-all-ready';
  return null;
}
// host starts: fixes the seed and a shared countdown start time (server clock)
export function start(room, byId, now, seed, countdownMs = 3000) {
  if (!isHost(room, byId)) return err('not-host'); const b = startBlocker(room); if (b) return err(b);
  room.phase = 'countdown'; room.seed = seed >>> 0; room.countdownAt = now + countdownMs; room.results = null; return bump(room);
}
export function toRace(room) { if (room.phase !== 'countdown') return err('not-countdown'); room.phase = 'race'; return bump(room); }
export function toResults(room, results) { room.phase = 'results'; room.results = results; return bump(room); }
// back to the lobby after results: drop seats that left / are gone, humans re-confirm
export function toLobby(room) {
  room.phase = 'lobby'; room.countdownAt = 0;
  room.seats = room.seats.filter(s => s.kind === 'bot' || (!s.left && s.connected));
  for (const s of room.seats) s.ready = s.kind === 'bot';
  migrateHost(room); return bump(room);
}
export function disconnect(room, id, now) {
  const s = seatOf(room, id); if (!s || s.kind !== 'human') return err('no-seat');
  s.connected = false; s.dcAt = now; if (room.phase === 'lobby') s.ready = false;
  migrateHost(room); return bump(room);
}
// explicit leave: lobby -> seat freed now; race -> DNF (car handed to the server, see room-server)
export function leave(room, id) {
  const s = seatOf(room, id); if (!s || s.kind !== 'human') return err('no-seat');
  if (room.phase === 'lobby' || room.phase === 'results') room.seats.splice(room.seats.indexOf(s), 1);
  else { s.left = true; s.connected = false; }
  migrateHost(room); return bump(room);
}
// Host = the earliest-seated connected human (deterministic). If none is connected, the earliest live
// human keeps the marker until someone connects. No humans: null.
function migrateHost(room) {
  const cur = seatOf(room, room.hostId);
  if (cur && cur.kind === 'human' && !cur.left && cur.connected) return;
  const h = room.seats.find(s => s.kind === 'human' && !s.left && s.connected) || room.seats.find(s => s.kind === 'human' && !s.left);
  room.hostId = h ? h.id : null;
}
// periodic housekeeping: expire seats, migrate host, report which humans have stale input
export function tick(room, now) {
  const changes = [], host0 = room.hostId;
  for (const s of room.seats.slice()) {
    if (s.kind !== 'human' || s.connected || s.left) continue;
    if (now - s.dcAt >= RECONNECT_MS) {
      if (room.phase === 'lobby' || room.phase === 'results') room.seats.splice(room.seats.indexOf(s), 1); else s.left = true;   // in a race: DNF
      changes.push(['expired', s.id]);
    }
  }
  migrateHost(room); if (room.hostId !== host0 && room.hostId) changes.push(['host', room.hostId]);
  const stale = room.phase === 'race' ? room.seats.filter(s => s.kind === 'human' && !s.left && now - (s.lastInputAt || 0) > STALE_INPUT_MS).map(s => s.id) : [];
  if (changes.length) room.version++;
  return { changes, stale, empty: !room.seats.some(s => s.kind === 'human' && !s.left) };
}
// What clients may see. Never includes session tokens or other rooms' state.
export function publicState(room) {
  return { code: room.code, phase: room.phase, hostId: room.hostId, map: room.map, mode: room.mode, weapons: !!room.weapons, vr: room.vr || 0, weaponsAllowed: !!room.weaponsAllowed, countdownAt: room.countdownAt, version: room.version,
    seats: room.seats.map(s => ({ id: s.id, kind: s.kind, name: s.name, car: s.car, paint: s.paint || 0, ready: !!s.ready, connected: !!s.connected, left: !!s.left })),
    canStart: canStart(room), blocker: startBlocker(room), maxSeats: MAX_SEATS, results: room.results };
}
