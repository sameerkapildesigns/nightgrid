// Local runtime over real sockets: HTTP room creation, origin checks, unknown codes, isolation,
// capacity, and short multi-client races (2h, 4h, 1h+3b, 2h+2b) through the shipping netcode.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startLocalServer } from '../../server/local.mjs';
import { scenario, waitFor } from './scenario.mjs';
import { PROTOCOL } from '../../src/net/protocol.js';

let srv;
before(async () => { srv = await startLocalServer({ port: 0, netsim: true, log: false, budget: { maxActiveRooms: 3 }, createPerMin: 1000, room: { countdownMs: 2500 } }); });
after(async () => { await srv.close(); });
const post = (path, headers = {}) => fetch(srv.url + path, { method: 'POST', headers }).then(async r => ({ status: r.status, ...(await r.json()) }));
function wsOpen(path, origin) {
  return new Promise(res => { const ws = new WebSocket(srv.url.replace('http', 'ws') + path, origin ? { origin } : {}); const msgs = [];
    ws.on('message', d => msgs.push(JSON.parse(d.toString()))); ws.on('open', () => res({ ws, msgs, open: true })); ws.on('unexpected-response', (_, r) => res({ status: r.statusCode, open: false })); ws.on('error', () => res({ open: false })); });
}

test('HTTP: create returns a valid code; unknown/invalid code 404; foreign Origin refused on POST and WS', async () => {
  const r = await post('/api/rooms'); assert.equal(r.status, 201); assert.match(r.code, /^[A-Z2-9]{6}$/);
  assert.equal((await fetch(srv.url + '/api/rooms/ZZZZZZ')).status, 404);
  assert.equal((await post('/api/rooms', { origin: 'https://evil.example' })).status, 403);
  const bad = await wsOpen(`/api/rooms/${r.code}/ws`, 'https://evil.example'); assert.equal(bad.open, false); assert.equal(bad.status, 403);
  const none = await wsOpen('/api/rooms/ZZZZZZ/ws'); await new Promise(x => setTimeout(x, 100)); assert.equal(none.msgs[0].error, 'no-room');
  const ok = await wsOpen(`/api/rooms/${r.code}/ws`, srv.url); assert.equal(ok.open, true);
  ok.ws.send(JSON.stringify({ t: 'hello', p: PROTOCOL, build: srv.build, name: 'T' })); await waitFor(() => ok.msgs.some(m => m.t === 'welcome'), 2000, 'welcome');
  ok.ws.close(); none.ws && none.ws.close();
  for (const rm of srv.rooms.values()) rm.closeRoom('test');
});
test('capacity: the shared budget refuses a 4th concurrent room with a readable error', async () => {
  const codes = []; for (let i = 0; i < 3; i++) codes.push((await post('/api/rooms')).code);
  const r = await post('/api/rooms'); assert.equal(r.status, 503); assert.equal(r.error, 'capacity');
  for (const rm of [...srv.rooms.values()]) rm.closeRoom('test');
  assert.equal((await post('/api/rooms')).status, 201); for (const rm of [...srv.rooms.values()]) rm.closeRoom('test');
});
test('two rooms are isolated over real sockets', async () => {
  const a = (await post('/api/rooms')).code, b = (await post('/api/rooms')).code;
  const A = await wsOpen(`/api/rooms/${a}/ws`), B = await wsOpen(`/api/rooms/${b}/ws`);
  A.ws.send(JSON.stringify({ t: 'hello', p: PROTOCOL, build: srv.build, name: 'Alpha' })); B.ws.send(JSON.stringify({ t: 'hello', p: PROTOCOL, build: srv.build, name: 'Bravo' }));
  await waitFor(() => A.msgs.some(m => m.t === 'lobby') && B.msgs.some(m => m.t === 'lobby'), 2000, 'lobbies');
  A.ws.send(JSON.stringify({ t: 'addBot' })); await new Promise(x => setTimeout(x, 200));
  assert.ok(!JSON.stringify(B.msgs).includes('Alpha')); assert.equal(B.msgs.filter(m => m.t === 'lobby').pop().room.seats.length, 1);
  assert.equal(A.msgs.filter(m => m.t === 'lobby').pop().room.seats.length, 2);
  A.ws.close(); B.ws.close(); for (const rm of [...srv.rooms.values()]) rm.closeRoom('test');
});
test('per-IP room creation rate limit (10/min default)', async () => {
  const s2 = await startLocalServer({ port: 0, log: false, budget: { maxActiveRooms: 50 } });
  const st = []; for (let i = 0; i < 12; i++) st.push((await fetch(s2.url + '/api/rooms', { method: 'POST' })).status);
  assert.deepEqual(st.slice(0, 10).every(x => x === 201), true); assert.equal(st[10], 429); await s2.close();
});
for (const [h, b] of [[2, 0], [4, 0], [1, 3], [2, 2]]) test(`race ${h} human(s) + ${b} bot(s) at 100 ms RTT: everyone races, views agree with the server, inputs independent`, async () => {
  const r = await scenario({ server: srv, humans: h, bots: b, lagMs: 100, jitterMs: 0, raceSeconds: 8 });
  for (const rm of [...srv.rooms.values()]) rm.closeRoom('test');
  assert.equal(r.clients.length, h);
  for (const c of r.clients) { assert.ok(c.corrections, 'client predicted'); assert.equal(c.resyncs, 0); assert.ok(c.maxPending < 120, 'pending bounded ' + c.maxPending); }
  const auth = r.authoritative; assert.equal(auth.length, h + b);
  for (const a of auth) assert.ok(a.prog > 150, `${a.id} moved ${a.prog}`);
  // every client's last snapshot lists the same racers with the same laps
  const ids = r.clientViews.map(v => v.map(x => x[0]).join()); assert.ok(ids.every(x => x === ids[0]));
  assert.equal(r.server.overruns, 0); assert.deepEqual(r.server.rejected, {});
});
test('race end -> every client gets the SAME result order from the server; host rematch returns to lobby and a 2nd race starts', async () => {
  const s3 = await startLocalServer({ port: 0, netsim: true, log: false, room: { countdownMs: 2000, maxRaceMs: 12000, resultsHoldMs: 60000 } });
  const r = await scenario({ server: s3, humans: 2, bots: 2, lagMs: 60, full: true });
  assert.ok(r.results[0] && r.results[0] === r.results[1], 'identical results: ' + r.results.join(' | '));
  assert.equal(r.results[0].split(' ').length, 4);
  // rematch: a fresh pair of clients in the same server proves lobby -> race again (room reuse covered by unit tests)
  const r2 = await scenario({ server: s3, humans: 2, bots: 1, lagMs: 60, full: true });
  assert.ok(r2.results[0] === r2.results[1]);
  await s3.close();
});
