// M7: split of wrangler.test.mjs "restart -> ready kept" (intermittent false !== true, M7 boost run 1).
// Source facts: ws.terminate() -> DO webSocketClose -> RoomServer.close -> Room.disconnect() sets ready=false
// in the lobby (intended semantics) -> save() -> storage.put. The old test then SIGTERMs workerd ~0 ms later,
// so whether the restored seat is ready depends on which wins. This file (local workerd only, no account):
//  1. sweep: the old sequence with 0 ms vs 1500 ms between terminate and kill, restored ready recorded (evidence)
//  2. graceful disconnect: observer SEES the unready lobby before the kill -> restored seat must be unready
//  3. abrupt runtime death (SIGKILL, sockets still open): observer SEES ready=true before the kill -> ready survives
// M7 run 2 finding: SIGTERM is NOT an abrupt death: with sockets still open, a SIGTERM shutdown restored ready=false
// 4/4 (shutdown delivered close events -> Room.disconnect -> persisted), while run 1 restored true 3/3 at gap 0.
// So the old assertion depends on workerd shutdown timing, not on game semantics.
// Usage: npm run build && node --test --test-concurrency=1 tests/worker/restore-race.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { computeBuildId } from '../../scripts/build-id.mjs';
import { PROTOCOL } from '../../src/net/protocol.js';
import { waitFor } from '../net/scenario.mjs';

const PORT = 8899 + Math.floor(Math.random() * 100), BASE = `http://127.0.0.1:${PORT}`, BUILD = computeBuildId();
const STATE = mkdtempSync(join(tmpdir(), 'ng-restore-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let proc = null;
async function startWrangler() {
  proc = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', STATE, '--define', `__NG_BUILD__:"${BUILD}"`, '--var', 'MAX_ACTIVE_ROOMS:20'],
    { env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_API_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let out = ''; proc.stdout.on('data', d => { out += d; }); proc.stderr.on('data', d => { out += d; });
  await waitFor(() => /Ready on/.test(out), 90000, 'wrangler ready: ' + out.slice(-500));
}
async function killWrangler(sig = 'SIGTERM') { if (!proc) return; try { process.kill(-proc.pid, sig); } catch (e) { } await sleep(1500); proc = null; }
const open = path => new Promise((res, rej) => { const ws = new WebSocket(BASE.replace('http', 'ws') + path); const msgs = []; ws.on('message', d => msgs.push(JSON.parse(d.toString()))); ws.on('open', () => res({ ws, msgs })); ws.on('error', rej); });
const lobbyOf = c => c.msgs.filter(m => m.t === 'lobby').pop();
async function joinRoom(code, name, token) { const c = await open(`/api/rooms/${code}/ws`); c.ws.send(JSON.stringify({ t: 'hello', p: PROTOCOL, build: BUILD, name, token })); await waitFor(() => c.msgs.some(m => m.t === 'welcome'), 8000, 'welcome ' + name); c.welcome = c.msgs.find(m => m.t === 'welcome'); return c; }
async function setup() {
  const code = (await (await fetch(BASE + '/api/rooms', { method: 'POST' })).json()).code;
  const keep = await joinRoom(code, 'Keep'); keep.ws.send(JSON.stringify({ t: 'addBot' })); keep.ws.send(JSON.stringify({ t: 'ready', ready: true }));
  const obs = await joinRoom(code, 'Obs');
  await waitFor(() => { const l = lobbyOf(obs); return l && l.room.seats.find(s => s.id === keep.welcome.id)?.ready === true; }, 8000, 'observer sees Keep ready');
  return { code, keep, obs };
}
async function restoredSeat(code, token, id) {
  const w2 = await joinRoom(code, 'Keep', token);
  await waitFor(() => lobbyOf(w2), 8000, 'lobby after restart');
  const l = lobbyOf(w2), s = l.room.seats.find(x => x.id === id); w2.ws.close();
  return { sameSeat: w2.welcome.id === id, seats: l.room.seats.length, ready: s ? s.ready : null };
}
before(async () => { await startWrangler(); });
after(async () => { await killWrangler(); });

test('sweep (evidence): old sequence terminate -> SIGTERM after 0 ms vs 1500 ms, restored ready recorded', async () => {
  const rows = [];
  for (const gap of [0, 1500, 0, 1500, 0, 1500]) {
    const { code, keep, obs } = await setup(); const tok = keep.welcome.token, id = keep.welcome.id;
    keep.ws.terminate(); await sleep(gap);
    const seen = lobbyOf(obs).room.seats.find(s => s.id === id);
    obs.ws.terminate(); await killWrangler(); await startWrangler();
    const r = await restoredSeat(code, tok, id);
    rows.push({ gapMs: gap, observerSawBeforeKill: { connected: seen.connected, ready: seen.ready }, restored: r });
  }
  console.log('# SWEEP ' + JSON.stringify(rows));
  for (const r of rows) assert.ok(r.restored.sameSeat && r.restored.seats === 3, 'seat + bot + observer seat restored');
  for (const r of rows.filter(x => x.gapMs === 1500)) assert.equal(r.restored.ready, false, 'after a processed disconnect the restored seat is unready (Room.disconnect semantics)');
});

test('graceful disconnect: observed unready before the kill -> restored seat is unready (same seat via token)', async () => {
  const { code, keep, obs } = await setup(); const tok = keep.welcome.token, id = keep.welcome.id;
  keep.ws.terminate();
  await waitFor(() => { const s = lobbyOf(obs).room.seats.find(x => x.id === id); return s && s.ready === false; }, 8000, 'observer sees Keep unready');
  await sleep(500);   // storage.put follows the broadcast in the same handler; margin for the write
  obs.ws.terminate(); await killWrangler(); await startWrangler();
  const r = await restoredSeat(code, tok, id); console.log('# GRACEFUL ' + JSON.stringify(r));
  assert.equal(r.sameSeat, true); assert.equal(r.seats, 3); assert.equal(r.ready, false);
});

test('abrupt runtime death (SIGKILL, sockets still open): observed ready=true before the kill -> restored state recorded', async () => {
  const { code, keep, obs } = await setup(); const tok = keep.welcome.token, id = keep.welcome.id;
  const seen = lobbyOf(obs).room.seats.find(s => s.id === id);
  assert.equal(seen.ready, true, 'observed ready before kill');
  await killWrangler('SIGKILL'); keep.ws.terminate(); obs.ws.terminate(); await startWrangler();   // SIGKILL: no shutdown close events
  const r = await restoredSeat(code, tok, id); console.log('# ABRUPT ' + JSON.stringify({ observedBeforeKill: seen.ready, restored: r }));
  assert.equal(r.sameSeat, true, 'same seat via token'); assert.equal(r.seats, 3, 'bot + observer restored');
  assert.equal(r.ready, true, 'last persisted (observed) ready state survives a runtime death');
});
