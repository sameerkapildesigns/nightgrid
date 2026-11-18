// Multiplayer worker host + input loop (the code that runs inside the browser's Web Worker), exercised in
// Node with real WebSockets against the local runtime.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startLocalServer } from '../../server/local.mjs';
import { createWorkerHost, STATE_MS } from '../../src/net/worker-host.js';
import { createInputLoop, STALE_PAGE_MS } from '../../src/net/input-loop.js';
import { encodeFrame, decodeFrame, ZERO_FRAME } from '../../src/net/protocol.js';
import { waitFor } from './scenario.mjs';

let srv;
before(async () => { srv = await startLocalServer({ port: 0, netsim: true, lagMs: 40, log: false, createPerMin: 1000, room: { countdownMs: 1500, maxRaceMs: 9000, resultsHoldMs: 60000 } }); });
after(async () => { await srv.close(); });
const newRoom = () => fetch(srv.url + '/api/rooms', { method: 'POST' }).then(r => r.json()).then(j => j.code);
function mkHost(opts = {}) {
  const out = []; const host = createWorkerHost({ post: m => out.push(JSON.parse(JSON.stringify(m))), WebSocketImpl: WebSocket, now: () => performance.now(), ...opts });
  return { host, out, last: t => [...out].reverse().find(m => m.t === t), evs: type => out.filter(m => m.t === 'ev' && m.type === type) };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('input loop starts NEUTRAL (frame 0 would be full left), holds the last page frame, releases after the stale-page window', () => {
  assert.equal(decodeFrame(0).left, 1, 'sanity: raw frame 0 is full left');
  let t = 0; const sent = []; const fakeNc = { race: null, frame: k => sent.push({ ...k }), view: () => null };
  const L = createInputLoop({ nc: fakeNc, now: () => t, publish: () => { } });
  L.tick(); assert.deepEqual([sent[0].up, sent[0].left, sent[0].right, sent[0].boost], [0, 0, 0, 0]);
  L.setFrame(encodeFrame({ up: 1, right: 0.5 })); t += 8; L.tick(); assert.equal(sent[1].up, 1); assert.equal(sent[1].right, 0.5);
  t += STALE_PAGE_MS - 100; L.tick(); assert.equal(sent[2].up, 1, 'held while the page is merely slow');
  t += 200; L.tick(); assert.equal(sent[3].up, 0); assert.equal(sent[3].right, 0); assert.equal(L.stats.staleReleases, 1);
  L.setFrame(ZERO_FRAME); L.setFrame(encodeFrame({ boost: 1, left: 1 })); t += 8; L.tick(); assert.equal(sent[4].boost, 1); assert.equal(sent[4].left, 1);
  L.setFrame(ZERO_FRAME); t += 8; L.tick(); assert.deepEqual([sent[5].up, sent[5].left, sent[5].boost], [0, 0, 0], 'explicit release applies at once');
});
test('worker host: connect -> welcome/lobby events with state; allow-listed calls only; timed state publication; leave stops the loop', async () => {
  const code = await newRoom(); const { host, out, last, evs } = mkHost();
  host.onMessage({ t: 'connect', wsUrl: srv.url.replace('http', 'ws'), build: srv.build, name: 'W', code });
  await waitFor(() => evs('welcome').length && evs('lobby').length, 5000, 'welcome');
  assert.equal(evs('welcome')[0].st.you, 'p1'); assert.equal(evs('welcome')[0].st.code, code);
  host.onMessage({ t: 'call', op: 'addBot' }); await waitFor(() => last('ev') && last('ev').type === 'lobby' && last('ev').m.room.seats.length === 2, 3000, 'bot');
  host.onMessage({ t: 'call', op: 'leave' }); host.onMessage({ t: 'call', op: 'constructor' }); host.onMessage({ t: 'call', op: 'recv', args: ['{"t":"results"}'] });
  await sleep(200); assert.equal(host.nc.status, 'open', 'non-allow-listed ops ignored'); assert.equal(host.nc.results, null);
  const n0 = out.filter(m => m.t === 'state').length; await sleep(STATE_MS * 2 + 200);
  assert.ok(out.filter(m => m.t === 'state').length >= n0 + 2, 'state published on a timer');
  host.onMessage({ t: 'autodrive', on: true }); assert.equal(host.loop.driver, null, 'autodrive refused unless allowed (production)');
  host.onMessage({ t: 'leave' }); assert.equal(host.nc, null); const ticks = out.length; await sleep(300); assert.ok(out.length <= ticks + 2, 'loop stopped');
});
test('worker host: race end to end - keys reach the server racer (via frames), view published, results, same-room rematch', async () => {
  const code = await newRoom(); const { host, last, evs } = mkHost({ allowAutodrive: true });
  host.onMessage({ t: 'connect', wsUrl: srv.url.replace('http', 'ws'), build: srv.build, name: 'R', code });
  await waitFor(() => evs('welcome').length, 5000, 'welcome');
  host.onMessage({ t: 'call', op: 'addBot' }); host.onMessage({ t: 'call', op: 'ready', args: [true] });
  await waitFor(() => last('state') && last('state').st.room && last('state').st.room.canStart, 5000, 'canStart');
  host.onMessage({ t: 'call', op: 'start' }); await waitFor(() => evs('race').length, 5000, 'race');
  host.onMessage({ t: 'keys', f: encodeFrame({ up: 1, right: 1 }) }); await sleep(2500);
  const room = srv.rooms.get(code), me = room.sim.racers.find(r => r.id === 'p1');
  assert.equal(me.input.up, 1); assert.equal(me.input.right, 1, 'server racer uses the page keys');
  host.onMessage({ t: 'keys', f: ZERO_FRAME }); await sleep(400); assert.equal(me.input.up, 0); assert.equal(me.input.right, 0, 'release reaches the server');
  const v = last('view').v; assert.ok(v && v.me && typeof v.me.s === 'number' && v.drones.length === 7);
  host.onMessage({ t: 'autodrive', on: true });
  await waitFor(() => evs('results').length, 20000, 'results (time cap)');
  host.onMessage({ t: 'call', op: 'toLobby' }); await waitFor(() => last('ev').type === 'lobby' && last('ev').m.room.phase === 'lobby', 5000, 'lobby');
  host.onMessage({ t: 'call', op: 'ready', args: [true] }); await waitFor(() => last('state').st.room.canStart, 5000, 'canStart 2');
  host.onMessage({ t: 'call', op: 'start' }); await waitFor(() => evs('race').length === 2, 5000, 'second race in the same room');
  assert.equal(evs('race')[1].m.seed !== evs('race')[0].m.seed, true);
  host.onMessage({ t: 'leave' });
});
test('worker host: server drops the socket -> auto-reconnect to the same seat; unknown room -> fatal error event', async () => {
  const code = await newRoom(); const { host, evs } = mkHost();
  host.onMessage({ t: 'connect', wsUrl: srv.url.replace('http', 'ws'), build: srv.build, name: 'D', code });
  await waitFor(() => evs('welcome').length, 5000, 'welcome');
  host.nc.ws.terminate();
  await waitFor(() => evs('welcome').length === 2, 8000, 're-welcome'); assert.equal(evs('welcome')[1].st.you, 'p1');
  assert.ok(evs('reconnecting').length >= 1); host.onMessage({ t: 'leave' });
  const bad = mkHost(); bad.host.onMessage({ t: 'connect', wsUrl: srv.url.replace('http', 'ws'), build: srv.build, name: 'X', code: 'ZZZZZZ' });
  await waitFor(() => bad.evs('error').length, 5000, 'no-room'); assert.equal(bad.evs('error')[0].m.error, 'no-room'); bad.host.onMessage({ t: 'leave' });
});
