// Deterministic-ish stall regressions for the input timeline (src/net/input-loop.js + NetClient), with
// the room server in a SEPARATE process (so blocking this process does not slow the server):
//  1. page stall: the page reports new input only every 1.5 s (renders at ~0.7 FPS) while the input loop
//     runs on its own timer -> the server must not starve (missed frames ~0), prediction stays tight;
//  2. loop stall: the input loop itself is frozen 700 ms every 3 s -> bounded lead/pending, no time-ahead,
//     the server never waits (bots keep racing), recovery to ~0 misses after the stalls stop;
//  3. reconnect while stalling -> same seat, race continues.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { NetClient } from '../../src/net/client.js';
import { createInputLoop } from '../../src/net/input-loop.js';
import { driveLine } from '../../src/net/driver.js';
import { encodeFrame, MAX_LEAD_FRAMES } from '../../src/net/protocol.js';
import { MAX_PENDING } from '../../src/net/netcode.js';
import { computeBuildId } from '../../scripts/build-id.mjs';
import { waitFor } from './scenario.mjs';

let proc, BASE; const BUILD = computeBuildId();
before(async () => {
  proc = spawn(process.execPath, ['server/local.mjs', '--port', '0', '--netsim', '--lag', '100', '--countdown-ms', '2500', '--max-race-ms', '60000'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; proc.stdout.on('data', d => { out += d; }); proc.stderr.on('data', d => { out += d; });
  await waitFor(() => /on http:\/\/127\.0\.0\.1:(\d+)/.test(out), 15000, 'server up'); BASE = 'http://127.0.0.1:' + out.match(/127\.0\.0\.1:(\d+)/)[1];
});
const cleanup = [];
after(() => { for (const f of cleanup) f(); proc.kill('SIGTERM'); });
const health = () => fetch(BASE + '/api/health').then(r => r.json());
const busy = ms => { const t = Date.now(); while (Date.now() - t < ms); };   // blocks THIS process only
async function race(bots = 1) {
  const code = (await fetch(BASE + '/api/rooms', { method: 'POST' }).then(r => r.json())).code;
  const nc = new NetClient({ wsUrl: BASE.replace('http', 'ws'), WebSocketImpl: WebSocket, now: () => performance.now(), build: BUILD, name: 'H' });
  nc.connect(code); await waitFor(() => nc.you, 5000, 'welcome');
  for (let i = 0; i < bots; i++) nc.addBot(); nc.config({ map: 'technical', mode: 'assisted' });
  await waitFor(() => nc.room && nc.room.seats.length === 1 + bots, 5000, 'bots');
  const loop = createInputLoop({ nc, now: () => performance.now(), publish: () => { } });
  const timer = setInterval(() => loop.tick(), 8);
  nc.ready(true); await waitFor(() => nc.room.canStart, 5000, 'canStart'); nc.start();
  await waitFor(() => nc.race, 5000, 'race');
  const stop = () => { clearInterval(timer); try { nc.leave(); } catch (e) { } }; cleanup.push(stop);
  return { nc, loop, code, stop };
}
const roomOf = async code => (await health()).debug.find(r => r.code === code);

test('page stall: input reported every 1.5 s, the worker loop still delivers frames on time (server misses ~0)', async () => {
  const { nc, loop, code, stop } = await race(1);
  let t = 0; const page = setInterval(() => { if (nc.race) loop.setFrame(encodeFrame(driveLine(nc.race.pred))); }, 1500);   // the "page" at ~0.7 FPS
  await new Promise(r => setTimeout(r, 2500 + 20000)); clearInterval(page); void t;
  const rm = await roomOf(code), q = rm.inputs[nc.you];
  const corr = nc.race.pred.stats.corrections.slice(10).sort((a, b) => a - b), p95 = corr[Math.floor(corr.length * 0.95)];
  console.log(`# page-stall: consumed ${q.consumed}, missed ${q.missed}, mispredict p95 ${p95.toFixed(3)} m, hard ${nc.race.pred.stats.hard}, lead ${nc.lead}, loop max gap ${loop.stats.maxGapMs.toFixed(0)} ms`);
  assert.ok(q.missed / q.consumed < 0.01, `missed ${q.missed}/${q.consumed}`); assert.ok(p95 < 1, 'p95 ' + p95); assert.equal(nc.race.pred.stats.hard, 0);
  assert.deepEqual(rm.stats.rejected, {});
  stop();
});
test('loop stall: input loop frozen 700 ms every 3 s -> bounded lead/pending, no time-ahead, server never waits, recovers', async () => {
  const { nc, code, stop } = await race(1);
  let maxPend = 0, maxLead = 0; const watch = setInterval(() => { if (nc.race) { maxPend = Math.max(maxPend, nc.race.pred.pending); maxLead = Math.max(maxLead, nc.lead); } }, 50);
  const t0 = Date.now(); const st0 = (await health()).debug.find(r => r.code === code).step || 0;
  while (Date.now() - t0 < 18000) { await new Promise(r => setTimeout(r, 2300)); busy(700); }   // stalls
  const mid = await roomOf(code); const stepsDuring = mid.step - st0;
  const q1 = mid.inputs[nc.you];
  await new Promise(r => setTimeout(r, 6000));   // recovery window, no stalls
  const end = await roomOf(code), q2 = end.inputs[nc.you];
  clearInterval(watch);
  const recMissRate = (q2.missed - q1.missed) / Math.max(1, q2.consumed - q1.consumed);
  console.log(`# loop-stall: server steps during stalls ${stepsDuring} (~${(stepsDuring / 120).toFixed(1)} s of race in ${((Date.now() - t0 - 6000) / 1000).toFixed(1)} s), missed during stalls ${q1.missed}/${q1.consumed}, after recovery ${(recMissRate * 100).toFixed(2)} %, max pending ${maxPend}, max lead ${maxLead}, resyncs ${nc.race.pred.stats.resyncs}, ahead rejections ${(nc.stats.ahead || []).length}`);
  assert.ok(stepsDuring / 120 > 15, 'the server kept racing in real time while this client stalled');
  assert.ok(maxPend <= MAX_PENDING && maxLead <= MAX_LEAD_FRAMES, 'bounded');
  assert.equal((nc.stats.ahead || []).length, 0, 'no time-ahead'); assert.deepEqual(end.stats.rejected, {});
  assert.ok(recMissRate < 0.02, 'recovers after stalls: ' + recMissRate);
  const bot = end.racers.find(r => r.ai); assert.ok(bot.prog > 400, 'bot kept racing: ' + bot.prog);
  stop();
});
test('reconnect while stalling: socket dropped during a stall -> same seat; handshake loss reported separately; steady-state input recovers (< 2 % missed)', async () => {
  const { nc, code, stop } = await race(1);
  try {
    let raceMsgs = 0; const onEv = nc.onEvent; nc.onEvent = (t, m) => { if (t === 'race') raceMsgs++; onEv(t, m); };
    await new Promise(r => setTimeout(r, 6000));
    const id = nc.you, before = (await roomOf(code)).inputs[id];
    const tDrop = performance.now(); nc.ws.terminate(); busy(600);
    await waitFor(() => raceMsgs >= 1 && nc.you === id && nc.status === 'open', 15000, 'reconnected + race snapshot received');
    const tBack = performance.now(); await new Promise(r => setTimeout(r, 1000));   // resync settle (lead adapts on the new predictor)
    const a = (await roomOf(code)).inputs[id];
    await new Promise(r => setTimeout(r, 5000));
    const b = (await roomOf(code)).inputs[id];
    const handshakeMissed = a.missed - before.missed, steady = (b.missed - a.missed) / Math.max(1, b.consumed - a.consumed);
    console.log(`# reconnect: same seat ${id}; outage+handshake ${(tBack - tDrop).toFixed(0)} ms; missed from drop to 1 s after resync ${handshakeMissed} frames (~${(handshakeMissed / 120).toFixed(2)} s); steady-state after: ${b.missed - a.missed}/${b.consumed - a.consumed} (${(steady * 100).toFixed(2)} %); lead ${nc.lead}`);
    assert.ok(steady < 0.02, 'steady-state recovery ' + steady);
    assert.ok(handshakeMissed / 120 < (tBack - tDrop) / 1000 + 1.5, 'loss bounded by the outage + 1.5 s');
  } finally { stop(); }
});
