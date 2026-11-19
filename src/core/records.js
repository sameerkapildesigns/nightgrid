// Lap-record validation and storage (pure; storage is injected).
// Production uses window.localStorage; test/dev builds inject an in-memory store so
// automated runs can never write a real record.
export const RECORD_PREFIX = 'nightgrid_v4_rec_';
export const LEGACY_KEYS = { legacy: ['nightgrid_v2_best'] };
// Hard physical ceiling: player top speed is 125 m/s boosted x1.06 slipstream x1.035 car
// mod (~137 m/s). 140 m/s over a whole lap is already impossible; anything faster is rejected.
export const MAX_LAP_SPEED = 140;
export const MAX_LAP_SECONDS = 3600;

// M3: records are kept per driving mode. Pre-M3 records (nightgrid_v4_rec_<map>, nightgrid_v2_best)
// were set under v5b physics, which neither mode reproduces; they are NOT migrated into either mode
// and are left untouched in storage (read-only, never deleted).
// REPLACES records.js line:
//   export function recordKey(mode, map, vr = 0) { return `m3_${mode === 'assisted' ? 'assisted' : 'expert'}_${map}${vr&3 ? '~'+(vr&1?'m':'')+(vr&2?'r':'') : ''}`; }
// Everything else in records.js (RECORD_PREFIX, LEGACY_KEYS, validateLap, createRecordStore) is unchanged.
 
// R4: every circuit's geometry changed in R4 (Shinrai is new), so R4 laps go under a revisioned key.
// Pre-R4 keys (m3_<mode>_<map>[~m|~r|~mr]) stay in storage untouched: never read for R4 records, never
// overwritten, never deleted. The revision sits BEFORE the map key, so game.js lapLenOf
// (k.split('~')[0].endsWith('_' + MAPKEY)) still matches. Bit 4 (night) stays cosmetic: it shares the day record.
export const R4_LAYOUT_REV = 'r4';
// R4.1 changes Velocity/Legacy camber. Keep their older records stored, but
// use separate keys rather than comparing laps under different surface frames.
export const LAYOUT_REV = Object.freeze({ velocity: 'r41', technical: R4_LAYOUT_REV, legacy: 'r41', casino: R4_LAYOUT_REV, summit: R4_LAYOUT_REV, drift: R4_LAYOUT_REV });
const modePart = mode => (mode === 'assisted' ? 'assisted' : 'expert');
const variantPart = vr => (vr & 3 ? '~' + (vr & 1 ? 'm' : '') + (vr & 2 ? 'r' : '') : '');
export function recordKey(mode, map, vr = 0) {
  const rev = Object.prototype.hasOwnProperty.call(LAYOUT_REV, map) ? LAYOUT_REV[map] : '';
  return `m3_${modePart(mode)}_${rev ? rev + '_' : ''}${map}${variantPart(vr)}`;
}
// Exact pre-R4 format, for tests or a later read-only view. Nothing in this batch calls it.
export function preR4RecordKey(mode, map, vr = 0) { return `m3_${modePart(mode)}_${map}${variantPart(vr)}`; }
 

export function minPlausibleLap(lapLenM) { return lapLenM / MAX_LAP_SPEED; }

// lap: { time, lapLen, integrity: { teleport, autopilot, debug } }
export function validateLap(lap) {
  if (!lap || typeof lap.time !== 'number' || !isFinite(lap.time)) return { ok: false, reason: 'not-a-number' };
  if (!(lap.lapLen > 0)) return { ok: false, reason: 'unknown-track-length' };
  if (lap.time <= 0 || lap.time > MAX_LAP_SECONDS) return { ok: false, reason: 'out-of-range' };
  if (lap.time < minPlausibleLap(lap.lapLen)) return { ok: false, reason: 'faster-than-physics' };
  const g = lap.integrity || {};
  if (g.weapons) return { ok: false, reason: 'weapons-mode' };
  if (g.teleport) return { ok: false, reason: 'position-jump' };
  if (g.autopilot) return { ok: false, reason: 'autopilot' };
  if (g.debug) return { ok: false, reason: 'debug-session' };
  if (g.assist) return { ok: false, reason: 'catch-up-assist' };
  return { ok: true, reason: null };
}

export function memoryStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, _map: m };
}

export function createRecordStore(storage, { lapLenOf } = {}) {
  const rejected = [];
  const safeGet = k => { try { return storage.getItem(k); } catch (e) { return null; } };
  return {
    rejected,
    // Returns the best *plausible* stored lap for a map, or Infinity. Implausible stored
    // values (e.g. written by older builds' automated tests) are ignored and reported.
    get(mapKey) {
      const keys = [RECORD_PREFIX + mapKey, ...(LEGACY_KEYS[mapKey] || [])];
      for (const k of keys) {
        const raw = safeGet(k); if (raw == null) continue;
        const v = parseFloat(raw);
        const res = validateLap({ time: v, lapLen: lapLenOf ? lapLenOf(mapKey) : 1 });
        if (res.ok) return v;
        rejected.push({ key: k, value: raw, reason: res.reason });
      }
      return Infinity;
    },
    // Returns { saved, reason }.
    offer(mapKey, lap) {
      const res = validateLap(lap);
      if (!res.ok) { rejected.push({ key: RECORD_PREFIX + mapKey, value: lap && lap.time, reason: res.reason }); return { saved: false, reason: res.reason }; }
      const cur = this.get(mapKey);
      if (!(lap.time < cur)) return { saved: false, reason: 'not-faster' };
      try { storage.setItem(RECORD_PREFIX + mapKey, String(lap.time)); } catch (e) { return { saved: false, reason: 'storage-error' }; }
      return { saved: true, reason: null };
    }
  };
}
