// M6 lifecycle checks in real Chromium against the local room server (dist-test build, debug hooks).
// Each case prints PASS/FAIL and the evidence; exit code 1 if any case fails.
//  L1 double Create while the welcome is slow (netsim 3 s RTT): must end in ONE room, no orphan seat.
//  L2 Leave then Create again at once (400 ms RTT): the old socket's late 'closed' must not kill the new room.
//  L3 Copy code / Copy link when the clipboard refuses: must not claim it was copied.
// Usage: npx vite build --mode test --outDir dist-test && node tests/e2e/lifecycle-run.mjs [L1,L2,L3]
import { launch, realErrors, check } from './harness.mjs';
import { startLocalServer } from '../../server/local.mjs';

const ONLY = (process.argv[2] || '').split(',').filter(Boolean), run = k => !ONLY.length || ONLY.includes(k);
const srv = await startLocalServer({ port: 0, dist: 'dist-test', netsim: true, log: false, createPerMin: 1000, budget: { maxActiveRooms: 10 } });
const BASE = srv.url + '/', results = [], C = (n, ok, d) => check(results, n, ok, d);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await launch();
async function open(name, init) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage(); const logs = []; page.setDefaultTimeout(120000);
  page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); }); page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
  await page.route('**/*', r => /fonts\.(googleapis|gstatic)\.com/.test(r.request().url()) ? r.abort() : r.continue());
  if (init) await page.addInitScript(init);
  await page.goto(BASE, { timeout: 240000 });
  await page.waitForFunction(() => window.NG_DEBUG && NG_DEBUG.state === 'title', null, { timeout: 240000 });
  await page.click('#mpBtn'); await page.fill('#mpName', name);
  return { ctx, page, logs };
}
const mp = p => p.page.evaluate(() => { const m = NG_DEBUG.mp; return { inRoom: m.inRoom, code: m.code, status: m.status, lastErr: m.lastErr, seats: m.room ? m.room.seats.length : 0 }; });
const humansIn = () => [...srv.rooms.values()].map(r => ({ code: r.code, humans: r.room.seats.filter(s => s.kind === 'human' && !s.left).length, conns: r.conns.size }));
const closeAll = () => { for (const r of [...srv.rooms.values()]) r.closeRoom('test'); };

if (run('L1')) {
  srv.setNet({ lagMs: 3000, jitterMs: 0 });
  const p = await open('Dbl');
  // impatient second tap: an in-page observer clicks Create again the moment it is enabled while not yet in a room
  await p.page.evaluate(() => { window.__clicks = 0; const tryClick = () => { const b = document.querySelector('#mpPanel [data-act=create]'); if (b && !b.disabled && window.__clicks === 1 && !NG_DEBUG.mp.inRoom) { window.__clicks++; b.click(); } };
    new MutationObserver(tryClick).observe(document.getElementById('mpPanel'), { childList: true, subtree: true, attributes: true }); document.querySelector('#mpPanel [data-act=create]').click(); window.__clicks = 1; });
  await sleep(2500); const second = (await p.page.evaluate(() => window.__clicks)) === 2;
  await p.page.waitForFunction(() => NG_DEBUG.mp.inRoom, null, { timeout: 20000 }); await sleep(6000);
  const rooms = humansIn(), me = await mp(p);
  const orphan = rooms.filter(r => r.code !== me.code);
  C('L1 double Create during slow welcome -> one room, no orphan seat/socket', rooms.length === 1 && orphan.length === 0,
    `secondClickPossible=${second} rooms=${JSON.stringify(rooms)} client=${me.code}`);
  await p.ctx.close(); closeAll(); srv.setNet({ lagMs: 0 });
}
if (run('L2')) {
  srv.setNet({ lagMs: 400, jitterMs: 0 });
  const p = await open('Re');
  await p.page.click('[data-act=create]'); await p.page.waitForFunction(() => NG_DEBUG.mp.inRoom, null, { timeout: 20000 });
  const first = (await mp(p)).code;
  await p.page.click('[data-act=leave]');
  await p.page.click('[data-act=create]');
  await p.page.waitForFunction(c => NG_DEBUG.mp.inRoom && NG_DEBUG.mp.code !== c, first, { timeout: 20000 }).catch(() => { });
  await sleep(4000);
  const me = await mp(p);
  C('L2 Leave then Create at once -> new room survives the old socket closing', me.inRoom && me.code && me.code !== first && !me.lastErr,
    `first=${first} now=${JSON.stringify(me)} rooms=${JSON.stringify(humansIn())}`);
  await p.ctx.close(); closeAll(); srv.setNet({ lagMs: 0 });
}
if (run('L3')) {
  const deny = () => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) } }); document.execCommand = () => false; };
  const p = await open('Clip', deny);
  await p.page.click('[data-act=create]'); await p.page.waitForFunction(() => NG_DEBUG.mp.inRoom, null, { timeout: 20000 });
  await p.page.click('[data-act=copycode]'); await sleep(300);
  const t1 = await p.page.evaluate(() => (document.querySelector('#mpPanel .note') || {}).textContent || '');
  await p.page.click('[data-act=copylink]'); await sleep(300);
  const t2 = await p.page.evaluate(() => ({ btn: document.querySelector('[data-act=copylink]').textContent, note: (document.querySelector('#mpPanel .note') || {}).textContent || '' }));
  C('L3 Copy code with clipboard refused -> does not say copied, shows the code', !/copied/i.test(t1) && /[A-Z2-9]{6}/.test(t1), JSON.stringify(t1));
  C('L3 Copy link with clipboard refused -> button not "Copied", link shown', !/copied/i.test(t2.btn) && /room=/.test(t2.note), JSON.stringify(t2));
  const errs = realErrors(p.logs); C('L3 no page errors', errs.length === 0, errs.join(' | '));
  await p.ctx.close(); closeAll();
}
await browser.close(); await srv.close();
const fail = results.filter(r => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`); process.exit(fail ? 1 : 0);
