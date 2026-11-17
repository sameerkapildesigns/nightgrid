// Gate 4: real browser multiplayer sessions (Playwright/Chromium, SwiftShader) over the local room
// server (server/local.mjs) serving the test build (dist-test, debug hooks on). Each player is a separate
// browser context (separate storage/session). Inputs go through the real keyboard/touch -> frames path;
// NG_DEBUG-only autodrive presses keys from a line-follower so races progress on a software renderer.
// Usage: npm run test:mp   -> test-results/mp/*.jpg + mp.json
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { launch, realErrors, check } from './harness.mjs';
import { startLocalServer } from '../../server/local.mjs';

const OUT = 'test-results/mp'; mkdirSync(OUT, { recursive: true });
if (!existsSync('dist-test/index.html') || process.env.NG_REBUILD) execSync('npx vite build --mode test --outDir dist-test', { stdio: 'inherit' });
const ONLY = (process.env.NG_ONLY || '').split(',').filter(Boolean), run = k => !ONLY.length || ONLY.includes(k);
const MAXRACE = +(process.env.NG_MAXRACE || 75000);
const srv = await startLocalServer({ port: 0, dist: 'dist-test', netsim: true, lagMs: +(process.env.NG_LAG || 0), log: false, createPerMin: 1000, budget: { maxActiveRooms: 6 }, room: { countdownMs: 6000, maxRaceMs: MAXRACE, resultsHoldMs: 60000 } });
const BASE = srv.url + '/';
const results = []; const C = (n, ok, d) => check(results, n, ok, d);
// quality targets: graded against a stated threshold, reported separately (TARGET PASS/FAIL), never forced to pass
const targets = []; const T = (n, ok, d) => { targets.push({ name: n, ok: !!ok, detail: d }); console.log(`${ok ? 'TARGET PASS' : 'TARGET FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const infos = []; const I = (n, d) => { infos.push({ name: n, detail: d }); console.log(`INFO  ${n}  — ${d}`); };
const TGT = { mispredictP95M: 1.0, hardSnapsPerMin: 2 };   // stated targets (gate 5: p95 > 1 m is a tuning investigation)
const browser = await launch();
const VIEW = { desk: { width: 1280, height: 720 }, phone: { width: 844, height: 390 }, portrait: { width: 390, height: 844 } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const THROTTLE = +(process.env.NG_RENDER_EVERY || 1);   // default 1 = every frame rendered (no throttling). >1 is a diagnostic option only, reported in the output
async function shot(p, n) {
  await p.page.evaluate(() => { window.__ngRenderEvery = 1; }); await sleep(1500);
  await p.page.screenshot({ path: `${OUT}/${n}.jpg`, type: 'jpeg', quality: 75 });
  await p.page.evaluate(t => { window.__ngRenderEvery = t; }, THROTTLE);
}
async function player(name, kind = 'desk', query = '') {
  const touch = kind !== 'desk';
  const ctx = await browser.newContext({ viewport: VIEW[kind], hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); const logs = [];
  page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); }); page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
  await page.route('**/*', r => /fonts\.(googleapis|gstatic)\.com/.test(r.request().url()) ? r.abort() : r.continue());
  await page.goto(BASE + (touch ? '?touch' + (query ? '&' + query.slice(1) : '') : query));
  await page.waitForFunction(() => window.NG_DEBUG && NG_DEBUG.state === 'title', null, { timeout: 240000 });
  return { name, kind, ctx, page, logs };
}
const mp = p => p.page.evaluate(() => Object.assign(NG_DEBUG.mp, { fps: NG_DEBUG.render.fps }));
const waitMp = (p, fn, ms = 60000, arg) => p.page.waitForFunction(new Function('a', `const m = NG_DEBUG.mp; return (${fn})(m, a);`), arg, { timeout: ms, polling: 200 });
async function create(p) {
  await p.page.click('#mpBtn'); await p.page.fill('#mpName', p.name); await p.page.click('[data-act=create]');
  await waitMp(p, 'm => m.inRoom'); return (await mp(p)).code;
}
async function joinByLink(p, code) {   // the invite link opens the panel with the code filled in
  await p.page.goto(BASE + (p.kind !== 'desk' ? '?touch&' : '?') + 'room=' + code);
  await p.page.waitForFunction(() => window.NG_DEBUG && NG_DEBUG.state === 'title', null, { timeout: 240000 });
  await p.page.fill('#mpName', p.name); await p.page.click('[data-act=join]');
  await waitMp(p, 'm => m.inRoom');
}
async function joinByCode(p, code) { await p.page.click('#mpBtn'); await p.page.fill('#mpName', p.name); await p.page.fill('#mpCode', code.toLowerCase()); await p.page.click('[data-act=join]'); await waitMp(p, 'm => m.inRoom'); }
const click = (p, sel) => p.page.click(sel);
async function readyAll(ps) { for (const p of ps) { await click(p, '[data-act=ready]'); } }
async function raceAndFinish(ps, { label, full = false, shots = true }) {
  const host = ps[0];
  await waitMp(host, 'm => m.room && m.room.canStart', 30000);
  const rsv = [...srv.rooms.values()].find(r => r.room.seats.some(x => x.name === host.name)); if (rsv) rsv.cfg.maxRaceMs = full ? 300000 : 50000;
  await click(host, '[data-act=start]');
  for (const p of ps) await waitMp(p, 'm => m.race', 60000);
  for (const p of ps) await p.page.evaluate(t => { __ng.mpAutodrive(true); window.__ngRenderEvery = t; }, THROTTLE);
  for (const p of ps) await waitMp(p, 'm => m.state === "race"', 60000);
  const tRace = Date.now();
  await sleep(9000);
  if (shots) for (const p of ps) await shot(p, `${label}-race-${p.name}-${p.kind}`);
  const mid = await Promise.all(ps.map(mp));
  C(`${label}: every player is racing (local car moving)`, mid.every(m => m.me && m.me.prog > 30), mid.map(m => m.me && m.me.prog).join(','));
  await Promise.all(ps.map(p => waitMp(p, 'm => m.results', (full ? 300000 : 50000) + 60000)));
  const res = await Promise.all(ps.map(mp)); for (const m of res) m.raceS = (Date.now() - tRace) / 1000;
  const orders = res.map(m => JSON.stringify(m.results));
  C(`${label}: every client shows the SAME server result order`, orders.every(o => o === orders[0]), orders[0]);
  const humanIds = res.map(m => m.you), humanRows = res[0].results.filter(x => humanIds.includes(x[1]));
  if (full) C(`${label}: every HUMAN finished the race (no human DNF)`, humanRows.every(x => !x[3]), JSON.stringify(humanRows));
  else I(`${label}: time-capped race (DNF expected)`, JSON.stringify(humanRows));
  const rs = [...srv.rooms.values()].find(r => r.room.seats.some(x => x.name === ps[0].name));
  if (rs) { const t = rs.stats.tickMs.slice().sort((x, y) => x - y); C(`${label}: server tick never overran its 50 ms budget`, rs.stats.overruns === 0, `ticks ${rs.stats.ticks}, tick p95 ${t[Math.floor(t.length * .95)].toFixed(2)} ms, overruns ${rs.stats.overruns}, late ticks ${rs.stats.lateTicks}, dropped ${Math.round(rs.stats.droppedMs)} ms, starved frames ${rs.stats.starved}, skipped frames ${rs.stats.skippedFrames}, rejected ${JSON.stringify(rs.stats.rejected)}`); }
  if (rs) for (const m of res) { const q = rs.inputs.get(m.you); if (q) I(`${label} ${m.you}: server input`, `frames consumed ${q.next}, missed ${q.starve} (${(100 * q.starve / Math.max(1, q.next)).toFixed(1)} %), skipped ${q.skipped}, max queued ${q.maxQ}`); }
  C(`${label}: no records offered from multiplayer`, res.every(m => m.recordsOffered === 0));
  for (const m of res) {
    const mins = Math.max(0.1, (m.raceS || 60) / 60);
    T(`${label} ${m.you}: mispredict p95 <= ${TGT.mispredictP95M} m`, m.mispredictP95 <= TGT.mispredictP95M, `${(+m.mispredictP95).toFixed(3)} m`);
    T(`${label} ${m.you}: hard snaps <= ${TGT.hardSnapsPerMin}/min`, m.hard / mins <= TGT.hardSnapsPerMin, `${m.hard} in ${mins.toFixed(1)} min`);
    I(`${label} ${m.you}: client`, `rtt ${m.rtt} ms, lead ${m.lead}, fps ${m.fps}, render every ${THROTTLE}, main thread ${JSON.stringify(m.net)}`);
  }
  await sleep(3500);
  if (shots) for (const p of ps) await shot(p, `${label}-results-${p.name}-${p.kind}`);
  return res;
}
async function backToLobby(ps) { for (const p of ps) { await click(p, '#toGarage'); await waitMp(p, 'm => !m.race && m.state === "title"'); } }
const close = async ps => { for (const p of ps) { C(`${p.name}: no page errors`, realErrors(p.logs).length === 0, realErrors(p.logs).slice(0, 3).join(' | ')); await p.ctx.close(); } };

try {
  if (run('A')) {   // 2 humans: desktop host + phone guest via invite link; host adds 2 bots -> 2h+2b; rematch; leave
    const a = await player('Ana'), b = await player('Ben', 'phone');
    const code = await create(a); await shot(a, 'A-lobby-host-desk');
    await joinByLink(b, code);
    await waitMp(a, 'm => m.room.seats.length === 2');
    await click(a, '[data-act=addbot]'); await click(a, '[data-act=addbot]');
    await click(a, '[data-act=map][data-map=technical]'); await click(a, '[data-act=mode][data-mode=assisted]');
    await waitMp(b, 'm => m.room.seats.length === 4 && m.room.map === "technical"');
    const nb = await b.page.locator('[data-act=addbot]').count(); C('A: guest sees no host-only bot controls', nb === 0);
    await readyAll([a, b]); await sleep(600);
    await shot(a, 'A-lobby-2h2b-desk'); await shot(b, 'A-lobby-2h2b-phone');
    const lob = await mp(a); C('A: lobby shows 2 humans + 2 bots, host marker, all ready', lob.room.seats.length === 4 && lob.room.seats.filter(s => s.kind === 'bot').length === 2 && lob.room.canStart, JSON.stringify(lob.room.seats.map(s => [s.name, s.kind, s.ready])));
    const r1 = await raceAndFinish([a, b], { label: 'A-2h2b', full: true });
    C('A: 4 racers in results', r1[0].results.length === 4);
    await backToLobby([a, b]);
    await waitMp(a, 'm => m.room.phase === "lobby"', 70000);
    await shot(a, 'A-back-in-lobby-desk');
    // rematch (short): remove a bot, ready, start again
    await click(a, '[data-act=rmlastbot]'); await readyAll([a, b]);
    await raceAndFinish([a, b], { label: 'A-rematch-2h1b', shots: false });
    await backToLobby([a, b]);
    // guest leaves: seat freed for the host
    await click(b, '[data-act=leave]'); await waitMp(a, 'm => m.room.seats.filter(s => s.kind === "human").length === 1', 20000);
    C('A: guest leave frees the seat', true);
    await close([a, b]);
  }
  if (run('B')) {   // 4 humans (3 desktop + 1 phone); a 5th human is refused without breaking the room
    const ps = [await player('Cy'), await player('Di'), await player('Ed'), await player('Fay', 'phone')];
    const code = await create(ps[0]);
    for (const p of ps.slice(1)) await joinByCode(p, code);
    await waitMp(ps[0], 'm => m.room.seats.length === 4');
    const fifth = await player('Gus');
    await fifth.page.click('#mpBtn'); await fifth.page.fill('#mpName', 'Gus'); await fifth.page.fill('#mpCode', code); await fifth.page.click('[data-act=join]');
    await fifth.page.waitForFunction(() => document.querySelector('#mpPanel .err'), null, { timeout: 15000 });
    const errTxt = await fifth.page.textContent('#mpPanel .err'); await shot(fifth, 'B-fifth-refused-desk');
    C('B: 5th human sees a readable "room is full" error', /full/i.test(errTxt), errTxt);
    C('B: room still has 4 seats after the refusal', (await mp(ps[0])).room.seats.length === 4);
    await fifth.ctx.close();
    await readyAll(ps); await raceAndFinish(ps, { label: 'B-4h' });
    await close(ps);
  }
  if (run('C')) {   // 1 human + 3 bots, full race, Kage; portrait lobby screenshot on a phone
    const a = await player('Hal'); const code = await create(a);
    for (let i = 0; i < 3; i++) await click(a, '[data-act=addbot]');
    C('C: Add bot disabled at 4 seats', await a.page.locator('[data-act=addbot]').isDisabled());
    await click(a, '[data-act=map][data-map=technical]'); await readyAll([a]);
    const pp = await player('Ivy', 'portrait', '?room=' + code);
    await sleep(800); await shot(pp, 'C-portrait-invite-phone');
    const vis = await pp.page.evaluate(() => { const p = document.getElementById('mpPanel'); const r = p.getBoundingClientRect(); return !p.classList.contains('hide') && r.width > 300 && getComputedStyle(document.getElementById('rotate')).display === 'none'; });
    C('C: portrait phone opening an invite link sees the room panel (rotate prompt deferred)', vis);
    await pp.ctx.close();
    await raceAndFinish([a], { label: 'C-1h3b', full: true });
    await close([a]);
  }
  if (run('D')) {   // unthrottled single PHONE (touch, 844x390) + 3 bots, full race on Kage
    const a = await player('Joy', 'phone'); const code = await create(a); void code;
    for (let i = 0; i < 3; i++) await click(a, '[data-act=addbot]');
    await click(a, '[data-act=map][data-map=technical]'); await readyAll([a]);
    await raceAndFinish([a], { label: 'D-phone-1h3b', full: true });
    await close([a]);
  }
} catch (e) { C('suite crashed', false, e.stack); }
await browser.close(); await srv.close();
writeFileSync(`${OUT}/mp.json`, JSON.stringify({ renderEvery: THROTTLE, targets: TGT, functional: results, quality: targets, info: infos }, null, 1));
const fails = results.filter(r => !r.ok).length, tf = targets.filter(t => !t.ok).length;
console.log(`\n${results.length - fails}/${results.length} functional checks passed; ${targets.length - tf}/${targets.length} quality targets met (render every ${THROTTLE} frame(s))`); process.exit(fails ? 1 : 0);
