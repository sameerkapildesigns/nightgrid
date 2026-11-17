// Deterministic manual clock for room-server tests (no real time).
export function fakeTimers(start = 1_700_000_000_000) {
  let now = start, id = 0; const jobs = new Map(); let wakeAt = null;
  const T = {
    now: () => now,
    setInterval(fn, ms) { const k = ++id; jobs.set(k, { fn, at: now + ms, every: ms }); return k; },
    clearInterval(k) { jobs.delete(k); }, clearTimeout(k) { jobs.delete(k); },
    setTimeout(fn, ms) { const k = ++id; jobs.set(k, { fn, at: now + ms, every: 0 }); return k; },
    wake(ms) { wakeAt = now + ms; },
    get wakeAt() { return wakeAt; },
    // advance time, firing due jobs in time order; onWake(server) is called when a requested wake is due
    advance(ms, onWake) {
      const end = now + ms;
      for (;;) {
        let next = null; for (const [k, j] of jobs) if (j.at <= end && (!next || j.at < next[1].at)) next = [k, j];
        const w = wakeAt != null && wakeAt <= end && (!next || wakeAt < next[1].at) ? wakeAt : null;
        if (w != null) { now = w; wakeAt = null; if (onWake) onWake(); continue; }
        if (!next) break;
        const [k, j] = next; now = j.at; if (j.every) j.at += j.every; else jobs.delete(k); j.fn();
      }
      now = end;
    },
    pending: () => jobs.size
  };
  return T;
}
// fake socket: records parsed messages
export function fakeConn() {
  const c = { out: [], closed: null, buffered: 0, send(t) { if (c.closed) throw new Error('closed'); c.out.push(JSON.parse(t)); }, close(code, r) { c.closed = [code, r]; }, bufferedAmount: () => c.buffered,
    last: t => [...c.out].reverse().find(m => m.t === t), all: t => c.out.filter(m => m.t === t) };
  return c;
}
let ctr = 1; export const fakeRandom = buf => { for (let i = 0; i < buf.length; i++) { ctr = (ctr * 1103515245 + 12345) >>> 0; buf[i] = ctr >>> 16; } return buf; };
