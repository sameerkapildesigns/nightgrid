// Durable Object adaptor tests in LOCAL workerd via `wrangler dev` (no Cloudflare account, no login,
// no deploy, metrics off). Exercises server/worker.js for real: Worker routing + static assets, the
// Registry DO (shared budget), Room DOs (WebSocket Hibernation API accept, attachments, storage, alarms),
// a 2-human + bot race through the shipping NetClient, Origin refusal, capacity refusal, unknown code,
// and a workerd RESTART (process kill) to exercise restore-from-storage + session-token reconnect.
// Not covered here: actual hibernation eviction timing, Cloudflare's billing/limits, real networks.
// Usage: npm run test:worker   (needs `npm run build` first for dist/)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { computeBuildId } from '../../scripts/build-id.mjs';
import { NetClient } from '../../src/net/client.js';
import { PROTOCOL } from '../../src/net/protocol.js';
import { driver, waitFor } from '../net/scenario.mjs';

const PORT = 8799 + Math.floor(Math.random() * 100), BASE = `http://127.0.0.1:${PORT}`, BUILD = computeBuildId();
const FRONT = 'https://nightgrid.sameerkapil.com', PREVIEW = 'https://nightgrid-git-m4-example.vercel.app';
const STATE = mkdtempSync(join(tmpdir(), 'ng-wrangler-'));
let proc = null;
async function startWrangler() {
  proc = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', STATE, '--define', `__NG_BUILD__:"${BUILD}"`, '--var', 'MAX_ACTIVE_ROOMS:2', '--var', `ALLOWED_ORIGINS:${FRONT},${PREVIEW}`],
    { env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_API_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let out = ''; proc.stdout.on('data', d => { out += d; }); proc.stderr.on('data', d => { out += d; });
  await waitFor(() => /Ready on/.test(out), 90000, 'wrangler ready: ' + out.slice(-500));
}
async function stopWrangler(sig = 'SIGTERM') { if (!proc) return; try { process.kill(-proc.pid, sig); } catch (e) { } await new Promise(r => setTimeout(r, 1500)); proc = null; }
before(async () => { await startWrangler(); });
let cleanupClients = () => { };
after(async () => { cleanupClients(); await stopWrangler(); });
const post = (p, h = {}) => fetch(BASE + p, { method: 'POST', headers: h }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const open = (path, origin) => new Promise(res => { const ws = new WebSocket(BASE.replace('http', 'ws') + path, origin ? { origin } : {}); const msgs = [];
  ws.on('message', d => msgs.push(JSON.parse(d.toString()))); ws.on('open', () => res({ ws, msgs, open: true })); ws.on('unexpected-response', (_, r) => res({ open: false, status: r.statusCode })); ws.on('error', () => res({ open: false })); });
const client = (name, onEvent = () => { }) => new NetClient({ wsUrl: BASE.replace('http', 'ws'), WebSocketImpl: WebSocket, now: () => performance.now(), build: BUILD, name, onEvent });

test('worker: API only (no game pages on workers.dev); health reports this build; unknown room 404', async () => {
  const h = await fetch(BASE + '/api/health').then(r => r.json()); assert.equal(h.build, BUILD); assert.equal(h.budget.maxActive, 2);
  const root = await fetch(BASE + '/'); assert.equal(root.status, 200); const rt = await root.text(); assert.match(rt, /multiplayer API ok/); assert.ok(rt.includes(BUILD));
  assert.equal((await fetch(BASE + '/index.html')).status, 404, 'no game pages here');
  assert.equal((await fetch(BASE + '/api/rooms/ZZZZZZ')).status, 404);
  const w = await open('/api/rooms/ZZZZZZ/ws'); await waitFor(() => w.msgs.length, 5000, 'no-room msg'); assert.equal(w.msgs[0].error, 'no-room'); w.ws.close();
});
test('worker CORS: strict allow-list, OPTIONS preflight, exact origin echo, no wildcard/credentials; WS Origin enforced', async () => {
  for (const o of [FRONT, PREVIEW]) {
    const pf = await fetch(BASE + '/api/rooms', { method: 'OPTIONS', headers: { origin: o, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
    assert.equal(pf.status, 204, o); assert.equal(pf.headers.get('access-control-allow-origin'), o); assert.match(pf.headers.get('access-control-allow-methods'), /POST/);
    assert.equal(pf.headers.get('access-control-allow-credentials'), null); assert.match(pf.headers.get('vary') || '', /Origin/);
    const hh = await fetch(BASE + '/api/health', { headers: { origin: o } }); assert.equal(hh.status, 200); assert.equal(hh.headers.get('access-control-allow-origin'), o);
  }
  for (const o of ['https://evil.example', 'https://nightgrid.sameerkapil.com.evil.example', 'http://nightgrid.sameerkapil.com', 'null']) {
    const pf = await fetch(BASE + '/api/rooms', { method: 'OPTIONS', headers: { origin: o, 'access-control-request-method': 'POST' } });
    assert.equal(pf.status, 403, o); assert.equal(pf.headers.get('access-control-allow-origin'), null);
    const c = await fetch(BASE + '/api/rooms', { method: 'POST', headers: { origin: o } }); assert.equal(c.status, 403, o); assert.equal(c.headers.get('access-control-allow-origin'), null);
    const ws = await open('/api/rooms/ZZZZZZ/ws', o); assert.equal(ws.open, false, 'ws ' + o); assert.equal(ws.status, 403);
  }
  const cr = await fetch(BASE + '/api/rooms', { method: 'POST', headers: { origin: FRONT } }); assert.equal(cr.status, 201);
  assert.equal(cr.headers.get('access-control-allow-origin'), FRONT); const { code } = await cr.json();
  const ws = await open(`/api/rooms/${code}/ws`, FRONT); assert.equal(ws.open, true, 'allowed origin opens the room socket');
  ws.ws.send(JSON.stringify({ t: 'hello', p: PROTOCOL, build: BUILD, name: 'C' })); await waitFor(() => ws.msgs.some(m => m.t === 'welcome'), 5000, 'welcome'); ws.ws.close();
});
test('worker: 2 humans + 1 bot race 14 s in a Room DO through the shipping NetClient (both cars move, host-only enforced; no finish/results in this test); Registry capacity refuses a 3rd room', async () => {
  const r = await post('/api/rooms'); assert.equal(r.status, 201);
  const ev = []; let a, b; cleanupClients = () => { try { a && a.leave(); b && b.leave(); } catch (e) { } };
  a = client('A', (t, m) => ev.push(['a', t, m && m.error]));
  b = client('B', (t, m) => ev.push(['b', t, m && m.error]));
  a.connect(r.code); await waitFor(() => a.you, 10000, 'a welcome'); b.connect(r.code); await waitFor(() => b.you, 10000, 'b welcome');
  assert.equal(a.you, 'p1'); assert.equal(b.you, 'p2');
  a.addBot(); a.config({ map: 'casino', mode: 'expert', weapons: true }); await waitFor(() => a.room && a.room.seats.length === 3 && a.room.map === 'casino' && a.room.weapons === true, 5000, 'bot');
  b.addBot(); await new Promise(x => setTimeout(x, 300)); assert.ok(ev.some(e => e[0] === 'b' && e[2] === 'not-host'), 'host-only enforced in the DO');
  a.ready(true); b.ready(true); await waitFor(() => a.room.canStart, 5000, 'canStart'); a.start();
  await waitFor(() => a.race && b.race, 10000, 'race');
  assert.equal(a.room.weaponsAllowed, true); assert.equal(a.race.pred.sim.weapons, true); assert.equal(a.race.pred.sim.weaponSlice, 2);
  const da = driver(0), db = driver(1); let stop = false;
  const loop = (async () => { while (!stop) { a.frame(da(a.race && a.race.pred)); b.frame(db(b.race && b.race.pred)); a.race && a.race.pred.decay(0.016); b.race && b.race.pred.decay(0.016); await new Promise(x => setTimeout(x, 16)); } })();
  await new Promise(x => setTimeout(x, 14000)); stop = true; await loop;
  const la = a.race.last, lb = b.race.last; assert.ok(la && lb, 'snapshots'); const me = la.a.find(x => x[0] === 'p1'), them = lb.a.find(x => x[0] === 'p2');
  assert.ok(me[8] > 50 && them[8] > 50, `both moved: ${me[8]} ${them[8]}`);
  const c1 = a.race.pred.stats.corrections.slice(10).sort((x, y) => x - y); console.log(`# DO race: p1 mispredict p95 ${c1[Math.floor(c1.length * 0.95)]} m, rtt ${a.clock.rtt.toFixed(1)} ms, snaps ${a.stats.snaps}`);
  a.leave(); b.leave();
  // capacity: keep creating until the shared Registry refuses (cap = MAX_ACTIVE_ROOMS 2 incl. rooms still open from earlier tests)
  const st = []; for (let i = 0; i < 3; i++) { const x = await post('/api/rooms'); st.push(x.status); if (x.status === 503) { assert.equal(x.error, 'capacity'); break; } }
  assert.equal(st[st.length - 1], 503, 'refused at the cap: ' + st.join(','));
});
test('worker: workerd runtime death (SIGKILL) -> Room DO restores the lobby from storage; the session token reconnects to the same seat (ready kept)', async () => {
  // the previous test's rooms have no connected players: their storage ALARM closes them (empty 60 s) and releases the budget
  let h = null; await waitFor(() => { fetch(BASE + '/api/health').then(x => x.json()).then(j => { h = j; }); return h && h.budget.active === 0; }, 150000, 'alarm-driven empty-room close');
  console.log('# rooms released by alarms: ' + JSON.stringify(h.budget));
  const r = await post('/api/rooms'); const code = r.code; assert.equal(r.status, 201, JSON.stringify(r));
  const w = await open(`/api/rooms/${code}/ws`); w.ws.send(JSON.stringify({ t: 'hello', p: PROTOCOL, build: BUILD, name: 'Keep' }));
  await waitFor(() => w.msgs.some(m => m.t === 'welcome'), 5000, 'welcome');
  const tok = w.msgs.find(m => m.t === 'welcome').token; w.ws.send(JSON.stringify({ t: 'addBot' })); w.ws.send(JSON.stringify({ t: 'ready', ready: true }));
  await new Promise(x => setTimeout(x, 800));
  // M7: abrupt runtime death = SIGKILL with the socket still open. The old terminate()+SIGTERM raced Room.disconnect()
  // (lobby disconnect -> ready=false, persisted) against shutdown: restored ready was true 7/12, false 5/12
  // (tests/worker/restore-race.test.mjs). Graceful disconnect -> unready is covered there, not asserted here.
  await stopWrangler('SIGKILL'); w.ws.terminate(); await startWrangler();
  const w2 = await open(`/api/rooms/${code}/ws`); w2.ws.send(JSON.stringify({ t: 'hello', p: PROTOCOL, build: BUILD, name: 'Keep', token: tok }));
  await waitFor(() => w2.msgs.some(m => m.t === 'lobby'), 8000, 'lobby after restart');
  const wel = w2.msgs.find(m => m.t === 'welcome'), lob = w2.msgs.filter(m => m.t === 'lobby').pop();
  assert.equal(wel.id, 'p1', 'same seat via token'); assert.equal(lob.room.seats.length, 2, 'bot restored'); assert.equal(lob.room.seats[0].ready, true, 'ready kept');
  w2.ws.close();
});
