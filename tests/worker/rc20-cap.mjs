// RC20 local-only check (no account, no deploy): wrangler dev --env staging (local workerd) serving this build:
// /api/health build id, 20 humans seated, the 21st refused with the cap text, room stays 20.
// Usage: npm run build && node tests/worker/rc20-cap.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
import WebSocket from 'ws';
import { computeBuildId } from '../../scripts/build-id.mjs';
import { PROTOCOL } from '../../src/net/protocol.js';
const PORT = 8990 + Math.floor(Math.random() * 50), BASE = `http://127.0.0.1:${PORT}`, BUILD = computeBuildId(), ORIGIN = 'https://nightgrid.sameerkapil.com';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const proc = spawn('npx', ['--no-install', 'wrangler', 'dev', '--env', 'staging', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', mkdtempSync(join(tmpdir(), 'ng-rc-')), '--define', `__NG_BUILD__:"${BUILD}"`],
  { env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_API_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let out = ''; proc.stdout.on('data', d => out += d); proc.stderr.on('data', d => out += d);
const res = {}; let fails = 0; const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  - ' + d : ''}`); if (!c) fails++; };
try {
  for (let t = 0; !/Ready on/.test(out); t++) { if (t > 900) throw new Error('wrangler not ready: ' + out.slice(-400)); await sleep(100); }
  const h = await (await fetch(BASE + '/api/health', { headers: { origin: ORIGIN } })).json();
  ok('health reports this build', h.build === BUILD, `${h.build} vs ${BUILD}`); ok('staging budget unchanged (2 rooms)', h.budget && h.budget.maxActive === 2, JSON.stringify(h.budget));
  const code = (await (await fetch(BASE + '/api/rooms', { method: 'POST', headers: { origin: ORIGIN } })).json()).code;
  const join = name => new Promise(r => { const ws = new WebSocket(`${BASE.replace('http', 'ws')}/api/rooms/${code}/ws`, { origin: ORIGIN }); const msgs = []; ws.on('message', d => { msgs.push(JSON.parse(d)); }); ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', p: PROTOCOL, build: BUILD, name }))); const c = { ws, msgs }; const iv = setInterval(() => { if (msgs.some(m => m.t === 'welcome' || m.t === 'error')) { clearInterval(iv); r(c); } }, 20); });
  const cs = []; for (let i = 0; i < 20; i++) cs.push(await join('P' + i));
  ok('20 humans seated', cs.every(c => c.msgs.some(m => m.t === 'welcome')));
  await sleep(500); const lob = cs[0].msgs.filter(m => m.t === 'lobby').pop();
  ok('lobby reports 20/20 and maxSeats 20', lob.room.seats.length === 20 && lob.room.maxSeats === 20, `${lob.room.seats.length}/${lob.room.maxSeats}`);
  const x = await join('P21'), e = x.msgs.find(m => m.t === 'error');
  ok('21st refused: room-full', e && e.error === 'room-full', JSON.stringify(e));
  await sleep(500); const lob2 = cs[0].msgs.filter(m => m.t === 'lobby').pop(); ok('room still 20 after refusal', lob2.room.seats.length === 20);
  for (const c of cs.concat([x])) c.ws.close();
} catch (err) { ok('ran', false, err.message); }
try { process.kill(-proc.pid, 'SIGTERM'); } catch (e) { } await sleep(800); process.exit(fails ? 1 : 0);
