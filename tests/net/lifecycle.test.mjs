// M6 connection lifecycle over real sockets (Node 'ws'), shipping NetClient.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket, { WebSocketServer } from 'ws';
import { startLocalServer } from '../../server/local.mjs';
import { NetClient } from '../../src/net/client.js';
import { waitFor } from './scenario.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const mk = (url, build, onEvent = () => { }) => new NetClient({ wsUrl: url, WebSocketImpl: WebSocket, now: () => performance.now(), build, name: 'T', onEvent });

test('connect() while a previous socket is still connecting/open closes the previous one (no orphan seat)', async () => {
  const srv = await startLocalServer({ port: 0, netsim: true, lagMs: 600, log: false, createPerMin: 1000 });
  try {
    const post = () => fetch(srv.url + '/api/rooms', { method: 'POST' }).then(r => r.json());
    const a = (await post()).code, b = (await post()).code;
    const evs = []; const c = mk(srv.url.replace('http', 'ws'), srv.build, (t, m) => evs.push([t, m && m.code]));
    c.connect(a); await sleep(100); c.connect(b);   // second connect before room A's welcome arrived
    await waitFor(() => c.you && c.room && c.room.code === b, 5000, 'welcome B');
    await sleep(1500);
    const A = srv.rooms.get(a), B = srv.rooms.get(b);
    const humans = r => r.room.seats.filter(s => s.kind === 'human' && !s.left && s.connected).length;
    assert.equal(humans(B), 1, 'seat in B');
    assert.equal(A.conns.size, 0, 'room A socket closed');
    assert.equal(humans(A), 0, 'no connected human left in room A');
    assert.equal(c.code, b); assert.equal(c.room.code, b, 'client state is room B only');
    c.leave();
  } finally { for (const r of [...srv.rooms.values()]) r.closeRoom('test'); await srv.close(); }
});

test('a server that accepts the socket then drops it before welcome does not cause endless reconnects', async () => {
  const wss = new WebSocketServer({ port: 0 }); let opens = 0;
  wss.on('connection', ws => { opens++; setTimeout(() => ws.terminate(), 5); });
  const st = globalThis.setTimeout; globalThis.setTimeout = (f, d, ...a) => st(f, Math.min(d || 0, 5), ...a);   // compress the backoff
  try {
    const evs = []; const c = mk(`ws://127.0.0.1:${wss.address().port}`, 'x', (t, m) => evs.push(t));
    c.connect('ABCDEF', 'tok-from-earlier-session');   // reconnects need a token, as after a real welcome
    await new Promise(r => st(r, 1500));
    c.closedByUser = true; try { c.ws && c.ws.close(); } catch (e) { }
    assert.ok(opens <= 8, `socket opened ${opens} times (bounded retries expected)`);
    assert.ok(evs.includes('closed'), 'gives up with a closed event');
  } finally { globalThis.setTimeout = st; wss.close(); }
});
