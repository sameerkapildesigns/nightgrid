// Local multiplayer runtime (Node): serves the built game (dist/) and hosts rooms over WebSocket using
// the SAME RoomServer + budget code as the Cloudflare Durable Object deployment. No account needed.
//   node server/local.mjs [--port 8787] [--dist dist] [--host 127.0.0.1] [--netsim] [--lag 100] [--jitter 20]
// Routes:  POST /api/rooms -> { code }   GET /api/rooms/:code -> { ok, phase, seats }   WS /api/rooms/:code/ws
// --netsim enables an artificial network (per-connection delay/jitter/outage, both directions) and a
// localhost-only control endpoint POST /__netsim {lagMs, jitterMs, outageMs}. It is a test tool and is
// never part of the Worker build.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { RoomServer } from './room-server.js';
import { createBudget } from '../src/net/budget.js';
import { makeRoomCode, validCode, normalizeCode } from '../src/net/protocol.js';
import { computeBuildId } from '../scripts/build-id.mjs';

const random = b => webcrypto.getRandomValues(b);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.woff2': 'font/woff2' };

export async function startLocalServer(opts = {}) {
  const o = { port: 8787, host: '127.0.0.1', dist: 'dist', netsim: false, lagMs: 0, jitterMs: 0, origins: null, budget: {}, room: {}, log: true, createPerMin: 10, ...opts };
  const build = o.build || computeBuildId();
  const distDir = resolve(o.dist);
  const budget = createBudget(o.budget);
  const rooms = new Map();   // code -> RoomServer
  const net = { lagMs: o.lagMs, jitterMs: o.jitterMs, outageUntil: 0 };
  const createLimiter = new Map();   // ip -> [timestamps]
  const log = (...a) => { if (o.log) console.log('[ng-local]', ...a); };   // never logs tokens or message bodies
  const allowedOrigin = (origin, host) => {
    if (!origin) return true;   // non-browser clients (tests); browsers always send Origin on WS + POST
    if (o.origins) return o.origins.includes(origin);
    try { const u = new URL(origin); return u.host === host || ['127.0.0.1', 'localhost'].includes(u.hostname); } catch (e) { return false; }
  };
  function makeTimers() {
    let wakeT = null;
    return { now: () => Date.now(), setInterval, clearInterval, setTimeout, clearTimeout,
      wake(ms, fn) { if (wakeT) clearTimeout(wakeT); wakeT = setTimeout(() => { wakeT = null; fn(); }, ms); } };
  }
  function createRoom() {
    let code; do code = makeRoomCode(random); while (rooms.has(code));
    const a = budget.admit(code, Date.now()); if (!a.ok) return { error: a.error };
    const T = makeTimers(); let srv;
    const timers = { ...T, wake: ms => T.wake(ms, () => srv && srv.housekeep()) };
    srv = new RoomServer({ code, build, timers, random, cfg: o.room,
      budget: { beat: c => budget.beat(c, Date.now()), canRace: c => budget.canRace(c, Date.now()), release: c => budget.release(c, Date.now()) },
      onClose: reason => { rooms.delete(code); log('room closed', code, reason, `(${rooms.size} open)`); } });
    rooms.set(code, srv); log('room created', code, `(${rooms.size} open)`); return { code };
  }
  // ---- netsim: ordered, delayed delivery per direction ----
  const delay = () => Math.max(0, net.lagMs / 2 + (Math.random() * 2 - 1) * net.jitterMs / 2);
  function lane() { let tail = 0; return fn => { if (!o.netsim) return fn(); const now = Date.now(); const at = Math.max(tail, now + delay(), net.outageUntil); tail = at; setTimeout(fn, at - now); }; }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'); const host = req.headers.host;
    const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
    if (url.pathname.startsWith('/api/') || url.pathname === '/__netsim') {
      if (!allowedOrigin(req.headers.origin, host)) return json(403, { ok: false, error: 'origin' });
      if (url.pathname === '/__netsim' && o.netsim && req.method === 'POST' && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) {
        let body = ''; for await (const c of req) body += c; const b = JSON.parse(body || '{}');
        if (b.lagMs != null) net.lagMs = +b.lagMs; if (b.jitterMs != null) net.jitterMs = +b.jitterMs; if (b.outageMs) net.outageUntil = Date.now() + +b.outageMs;
        return json(200, { ok: true, ...net });
      }
      if (url.pathname === '/api/rooms' && req.method === 'POST') {
        const ip = req.socket.remoteAddress, now = Date.now(); const ts = (createLimiter.get(ip) || []).filter(t => now - t < 60e3);
        if (ts.length >= o.createPerMin) return json(429, { ok: false, error: 'rate' }); ts.push(now); createLimiter.set(ip, ts);
        const r = createRoom(); return r.error ? json(503, { ok: false, error: r.error }) : json(201, { ok: true, code: r.code });
      }
      const m = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9]+)$/);
      if (m && req.method === 'GET') { const code = normalizeCode(m[1]); const r = validCode(code) && rooms.get(code); if (!r) return json(404, { ok: false, error: 'no-room' }); return json(200, { ok: true, phase: r.room.phase, seats: r.room.seats.length }); }
      if (url.pathname === '/api/health') return json(200, { ok: true, build, rooms: rooms.size, budget: budget.report(Date.now()) });
      return json(404, { ok: false, error: 'not-found' });
    }
    // static files from dist/ (path traversal safe)
    let p = decodeURIComponent(url.pathname); if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(distDir, p)); if (!file.startsWith(distDir)) { res.writeHead(403); return res.end(); }
    try { const st = await stat(file); if (!st.isFile()) throw 0; const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'x-content-type-options': 'nosniff', 'cache-control': /\/assets\//.test(p) ? 'public, max-age=31536000, immutable' : 'no-cache' }); res.end(body);
    } catch (e) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x'); const m = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9]+)\/ws$/);
    const reject = (status) => { socket.write(`HTTP/1.1 ${status}\r\n\r\n`); socket.destroy(); };
    if (!m) return reject('404 Not Found');
    if (!allowedOrigin(req.headers.origin, req.headers.host)) return reject('403 Forbidden');
    const code = normalizeCode(m[1]); const room = validCode(code) && rooms.get(code);
    wss.handleUpgrade(req, socket, head, ws => {
      if (!room) { ws.send(JSON.stringify({ t: 'error', error: 'no-room', fatal: true })); return ws.close(4004, 'no-room'); }
      const up = lane(), down = lane();
      const conn = { send: t => down(() => { if (ws.readyState === 1) ws.send(t); }), close: (c, r) => down(() => ws.close(c, r)), bufferedAmount: () => ws.bufferedAmount };
      room.connect(conn);
      ws.on('message', (data, isBinary) => { if (isBinary) return; const t = data.toString(); up(() => room.message(conn, t)); });
      ws.on('close', () => up(() => room.close(conn)));
      ws.on('error', () => { });
    });
  });
  await new Promise(r => server.listen(o.port, o.host, r));
  const port = server.address().port;
  log(`build ${build} on http://${o.host}:${port}/  (static: ${distDir})${o.netsim ? `  netsim lag ${net.lagMs} ms RTT, jitter ${net.jitterMs} ms` : ''}`);
  return { port, build, rooms, budget, net, url: `http://${o.host}:${port}`,
    setNet: x => Object.assign(net, x), outage: ms => { net.outageUntil = Date.now() + ms; },
    close: () => new Promise(r => { for (const rm of rooms.values()) rm.closeRoom('shutdown'); wss.close(); server.close(() => r()); server.closeAllConnections && server.closeAllConnections(); }) };
}

if (process.argv[1] && import.meta.url === 'file://' + resolve(process.argv[1])) {
  const a = process.argv.slice(2), arg = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
  startLocalServer({ port: +arg('port', process.env.PORT || 8787), host: arg('host', '127.0.0.1'), dist: arg('dist', 'dist'), netsim: a.includes('--netsim'),
    lagMs: +arg('lag', 0), jitterMs: +arg('jitter', 0), room: { ...(arg('max-race-ms') ? { maxRaceMs: +arg('max-race-ms') } : {}), ...(arg('countdown-ms') ? { countdownMs: +arg('countdown-ms') } : {}) }, budget: arg('max-rooms') ? { maxActiveRooms: +arg('max-rooms') } : {}, origins: arg('origins', null) ? arg('origins').split(',') : null });
}
