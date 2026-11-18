// Cross-origin hosted-path smoke (no deploy): frontend on one origin (vite preview, NO /api there),
// multiplayer backend = server/worker.js in LOCAL workerd (wrangler dev, no account) on another origin,
// frontend built with VITE_MP_API_BASE pointing at it and the backend's ALLOWED_ORIGINS = the frontend origin.
// Proves: create/health over CORS, WSS-style direct socket to the backend, Origin checks, invite link on
// the FRONTEND origin, matching build ids, two phones in one room reaching a race start.
import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { launch, check, realErrors } from './harness.mjs';
import { computeBuildId } from '../../scripts/build-id.mjs';

const OUT = 'test-results/xo'; mkdirSync(OUT, { recursive: true });
const results = []; const C = (n, ok, d) => check(results, n, ok, d);
const WP = 8890, FP = 4390, BACK = `http://127.0.0.1:${WP}`, FRONT = `http://127.0.0.1:${FP}`, BUILD = computeBuildId();
const sleep = ms => new Promise(r => setTimeout(r, ms));
execSync(`npx vite build --mode test --outDir dist-xo`, { stdio: 'ignore', env: { ...process.env, VITE_MP_API_BASE: BACK } });
const man = JSON.parse(readFileSync('dist-xo/ng-build.json', 'utf8'));
C('frontend build manifest: same build id as the backend source, backend URL recorded', man.build === BUILD && man.mpApiBase === BACK, JSON.stringify(man));
const procs = [];
const run = (cmd, args, env = {}) => { const p = spawn(cmd, args, { env: { ...process.env, WRANGLER_SEND_METRICS: 'false', ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true }); let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d); procs.push(p); return () => out; };
const wOut = run('npx', ['wrangler', 'dev', '--port', String(WP), '--ip', '127.0.0.1', '--persist-to', mkdtempSync(join(tmpdir(), 'ng-xo-')), '--define', `__NG_BUILD__:"${BUILD}"`, '--var', `ALLOWED_ORIGINS:${FRONT}`]);
const fOut = run('npx', ['vite', 'preview', '--outDir', 'dist-xo', '--port', String(FP), '--strictPort', '--host', '127.0.0.1']);
const until = async (f, ms, what) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timeout ' + what); await sleep(200); } };
const browser = await launch();
try {
  await until(() => /Ready on/.test(wOut()), 90000, 'wrangler'); await until(() => /127\.0\.0\.1:4390/.test(fOut()), 30000, 'preview');
  C('frontend origin has NO multiplayer API (no same-origin fallback possible)', (await fetch(FRONT + '/api/health')).status !== 200);
  const h = await fetch(BACK + '/api/health', { headers: { origin: FRONT } }); const hj = await h.json();
  C('backend health over CORS: exact origin echoed, same build id', h.headers.get('access-control-allow-origin') === FRONT && hj.build === BUILD, JSON.stringify({ acao: h.headers.get('access-control-allow-origin'), build: hj.build }));
  const player = async (name, q = '') => {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage(); page.setDefaultTimeout(180000); const logs = [], urls = [];
    page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); }); page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
    page.on('request', r => urls.push(r.url())); page.on('websocket', ws => urls.push('WS ' + ws.url()));
    await page.route('**/*', r => /fonts\.(googleapis|gstatic)/.test(r.request().url()) ? r.abort() : r.continue());
    await page.goto(FRONT + '/?touch' + q, { timeout: 240000 }); await page.waitForFunction(() => window.NG_DEBUG && NG_DEBUG.state === 'title', null, { timeout: 240000 });
    return { name, ctx, page, logs, urls };
  };
  const mp = p => p.page.evaluate(() => NG_DEBUG.mp);
  const a = await player('Host');
  await a.page.click('#mpBtn'); await a.page.fill('#mpName', 'Host'); await a.page.click('[data-act=create]');
  await a.page.waitForFunction(() => NG_DEBUG.mp.inRoom, null, { timeout: 120000 });
  const code = (await mp(a)).code;
  C('create from the frontend origin went to the backend origin (HTTP + WebSocket)', a.urls.some(u => u === BACK + '/api/rooms') && a.urls.some(u => u.startsWith(`WS ws://127.0.0.1:${WP}/api/rooms/${code}/ws`)), a.urls.filter(u => /api/.test(u)).join(' | '));
  const link = await a.page.evaluate(code => __ng.mpUI().joinLink(code), code);   // the app's own invite link
  await a.page.click('[data-act=copylink]').catch(() => { });
  const b = await player('Guest', '&room=' + code);
  C('invite link is on the FRONTEND origin', link.startsWith(FRONT + '/?room='), link);
  await b.page.fill('#mpName', 'Guest'); await b.page.click('[data-act=join]'); await b.page.waitForFunction(() => NG_DEBUG.mp.inRoom, null, { timeout: 120000 });
  await a.page.waitForFunction(() => NG_DEBUG.mp.room && NG_DEBUG.mp.room.seats.length === 2, null, { timeout: 60000 });
  await a.page.click('[data-act=addbot]'); await a.page.click('[data-act=ready]'); await b.page.click('[data-act=ready]');
  await a.page.waitForFunction(() => NG_DEBUG.mp.room.canStart, null, { timeout: 60000 }); await a.page.click('[data-act=start]');
  for (const p of [a, b]) await p.page.waitForFunction(() => NG_DEBUG.mp.state === 'race' || NG_DEBUG.mp.state === 'countdown', null, { timeout: 180000 });
  await sleep(4000); const ma = await mp(a), mb = await mp(b);
  C('two phones on the frontend origin race in one Room DO on the backend origin (both in the race, worker path)', ma.race && mb.race && ma.worker && mb.worker && ma.code === mb.code, JSON.stringify([ma.state, mb.state, ma.code, mb.code]));
  await a.page.screenshot({ path: `${OUT}/xo-race-host.jpg`, type: 'jpeg', quality: 75 });
  for (const p of [a, b]) C(`${p.name}: no page errors`, realErrors(p.logs).length === 0, realErrors(p.logs).slice(0, 3).join(' | '));
} catch (e) { C('xo suite crashed', false, e.stack); }
await browser.close(); for (const p of procs) { try { process.kill(-p.pid, 'SIGTERM'); } catch (e) { } }
writeFileSync(`${OUT}/xo.json`, JSON.stringify(results, null, 1));
const f = results.filter(r => !r.ok).length; console.log(`\n${results.length - f}/${results.length} cross-origin checks passed`); process.exit(f ? 1 : 0);
