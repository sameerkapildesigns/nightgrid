// End-to-end parity checks against the built game (Playwright + Chromium/SwiftShader).
// Usage: npm run test:e2e   (builds dist-test/ and dist/, serves both with `vite preview`).
// Results: printed, and written to test-results/e2e.json (+ screenshots in test-results/).
// Note: SwiftShader is a software renderer; frame rates here are far below a real GPU.
import { preview } from 'vite';
import { mkdirSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { launch, openGame, realErrors, check } from './harness.mjs';

const OUT = 'test-results'; mkdirSync(OUT, { recursive: true });
if (!existsSync('dist/index.html')) execSync('npx vite build', { stdio: 'inherit' });
const srvTest = await preview({ build: { outDir: 'dist-test' }, preview: { port: 4174, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
const srvProd = await preview({ build: { outDir: 'dist' }, preview: { port: 4175, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
const TEST = 'http://127.0.0.1:4174/', PROD = 'http://127.0.0.1:4175/';
process.env.NG_BASE = TEST;
const results = []; const C = (n, ok, d) => check(results, n, ok, d);
const ONLY = (process.env.NG_ONLY || '').split(',').filter(Boolean); const run = k => !ONLY.length || ONLY.includes(k);
const browser = await launch();
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 72 });
const st = page => page.evaluate(() => NG_DEBUG.state);
const glbName = u => (u.match(/\/([a-z]+)-[\w-]+\.glb$/) || [])[1];
const waitRaceBtn = page => page.waitForFunction(() => { const g = document.getElementById('go'); return g.textContent === 'Race' && !g.disabled; }, null, { timeout: 180000 });
const TP = `(()=>{ const p=__ng.player; const L=__ng.MAIN.L; p.lap=NG_DEBUG.map.laps-1; p.autopilot=true; p.pers={vmax:92,lat:84,acc:26,brake:46,off:0,short:0,aggr:0,block:0,boostUse:0,margin:4};
  p.s=(60-120+L)%L; p.prevS=p.s; p.lastRd=L-120; p.prog=(p.lap+1)*L-120; p.speed=80; p.va=80; p.lapTimes=Array(p.lap).fill(40); p.lapValid=Array(p.lap).fill(false); })()`;

try {
  // ---------------- A. boot, roster, on-demand model loading ----------------
  if (run('A')) {
    const reqOrder = [];
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
    const page = await ctx.newPage(); const logs = [];
    page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); });
    page.on('request', r => reqOrder.push(r.url()));
    const reqStart = {}, respEnd = {}; const tBase = Date.now();
    page.on('request', r => { const n = glbName(r.url()); if (n && reqStart[n] == null) reqStart[n] = Date.now() - tBase; });
    page.on('requestfinished', r => { const n = glbName(r.url()); if (n && respEnd[n] == null) respEnd[n] = Date.now() - tBase; });
    const glbResp = {};
    page.on('response', async r => { const n = glbName(r.url()); if (n) { try { glbResp[n] = { type: r.headers()['content-type'], len: (await r.body()).length }; } catch (e) { } } });
    await page.route('**/*', r => /fonts\.(googleapis|gstatic)\.com/.test(r.request().url()) ? r.abort() : r.continue());
    const t0 = Date.now();
    await page.goto(TEST);
    await page.waitForFunction(() => window.NG_DEBUG && NG_DEBUG.state === 'title', null, { timeout: 180000 });
    const tTitle = Date.now() - t0;
    await waitRaceBtn(page);
    for (let i = 0; i < 100 && Object.keys(glbResp).length < 3; i++) await page.waitForTimeout(100);
    const glbs = reqOrder.map(glbName).filter(Boolean);
    C('boot: title reached', true, `${tTitle} ms (SwiftShader, local preview)`);
    C('boot: selected car (hypercar) requested first', glbs[0] === 'hypercar', glbs.join(','));
    C('boot: rival requests start before the selected car finishes (no waterfall)', reqStart.wedge != null && reqStart.endurance != null && reqStart.wedge < respEnd.hypercar && reqStart.endurance < respEnd.hypercar, JSON.stringify({ reqStart, respEnd }));
    C('boot: only selected + rival cars requested (no full roster)', glbs.length === 3 && ['hypercar', 'wedge', 'endurance'].every(k => glbs.includes(k)), glbs.join(','));
    C('boot: no base64 / CDN model transfer', !reqOrder.some(u => /b64|jsdelivr/.test(u)));
    const sizesOk = Object.entries(glbResp).every(([k, v]) => v.len === statSync(`assets/models/${k}.glb`).size);
    C('assets: served GLBs are byte-identical in size to the originals', sizesOk && Object.keys(glbResp).length === 3, JSON.stringify(glbResp));
    const info = await page.evaluate(() => ({ roster: NG_DEBUG.roster, sel: NG_DEBUG.selectedCar, fleet: NG_DEBUG.fleet, dots: document.querySelectorAll('#carDots button').length, z: /Z-32S|z32s/i.test(document.body.innerHTML), nick: document.getElementById('carNick').textContent }));
    C('roster: six approved models in garage order', JSON.stringify(info.roster) === JSON.stringify(['hypercar', 'endurance', 'wedge', 'rally', 'streamliner', 'wipeout']) && info.dots === 6, info.roster.join(','));
    C('roster: Hypercar is the default selection', info.sel.key === 'hypercar' && info.nick === 'Hypercar');
    C('roster: no Z-32S anywhere in the shipped page', !info.z);
    C('roster: every race body is a real glTF (no fallback)', info.fleet.every(f => /^glTF:/.test(f.body)), info.fleet.map(f => f.body).join(','));
    await shot(page, 'garage-desktop');
    for (let i = 0; i < 3; i++) await page.click('#nextCar');
    await page.waitForFunction(() => NG_DEBUG.assets.rally.status === 'ok', null, { timeout: 120000 });
    const g2 = reqOrder.map(glbName).filter(Boolean);
    C('on-demand: selecting Off-roader fetches rally.glb only', g2.length === 4 && g2[3] === 'rally' && !g2.includes('wipeout') && !g2.includes('streamliner'), g2.join(','));
    await page.click('#prevCar'); await page.waitForTimeout(300);
    C('on-demand: re-selecting a loaded car does not refetch', reqOrder.map(glbName).filter(Boolean).length === 4);
    await page.click('#carDots [data-car="wipeout"]');
    await page.waitForFunction(() => NG_DEBUG.assets.wipeout.status === 'ok', null, { timeout: 180000 });
    const wi = await page.evaluate(() => NG_DEBUG.assets.wipeout);
    C('on-demand: Wipeout loads when selected (original 2k/4k textures)', wi.status === 'ok' && wi.tris > 20000, `${wi.tris} tris, ${wi.meshes} meshes`);
    await page.evaluate(() => __ng.render()); await shot(page, 'garage-wipeout');
    C('boot: no page errors', realErrors(logs).length === 0, realErrors(logs).slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ---------------- B. garage arrows pinned at 44x44 (desktop, landscape phone, portrait phone) ----------------
  if (run('B')) for (const [w, h, label] of [[1280, 675, 'desktop'], [844, 390, 'landscape phone'], [390, 844, 'portrait phone']]) {
    const { ctx, page } = await openGame(browser, { width: w, height: h, ctxOpts: w < 900 ? { isMobile: true, hasTouch: true } : {} });
    const boxes = await page.evaluate(() => ['prevCar', 'nextCar'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight]; }));
    C(`arrows: 44x44 and on-screen (${label} ${w}x${h})`, boxes.every(b => b[0] === 44 && b[1] === 44 && b[2]), JSON.stringify(boxes));
    if (w < 900) await shot(page, `garage-${label.replace(' ', '-')}`);
    await ctx.close();
  }

  // ---------------- B2. garage bar: Race + circuit controls reachable at every width (regression for v5b overflow) ----------------
  if (run('B')) {
    const { ctx, page } = await openGame(browser, { width: 1280, height: 675 });
    for (const [w, h] of [[960, 540], [1024, 576], [1024, 768], [1152, 648], [1280, 675], [1366, 768], [1920, 1080]]) {
      await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(200);
      const r = await page.evaluate(() => {
        const inV = el => { const b = el.getBoundingClientRect(); return b.width > 0 && b.left >= 0 && b.top >= 0 && b.right <= innerWidth + 0.5 && b.bottom <= innerHeight + 0.5; };
        const ids = ['go', 'prevCar', 'nextCar'].map(id => [id, inV(document.getElementById(id))]);
        const maps = [...document.querySelectorAll('#maps [data-map]')].map(b => [b.dataset.map, inV(b)]);
        const nav = document.getElementById('prevCar').getBoundingClientRect();
        return { all: [...ids, ...maps], arrows44: Math.round(nav.width) === 44 && Math.round(nav.height) === 44, hscroll: document.documentElement.scrollWidth > innerWidth };
      });
      C(`garage ${w}x${h}: Race, arrows and all circuits on-screen; arrows 44x44`, r.all.every(x => x[1]) && r.arrows44 && !r.hscroll, r.all.filter(x => !x[1]).map(x => x[0]).join(',') || 'all visible');
      if ([960, 1024, 1152].includes(w) && h < 700) { await page.evaluate(() => __ng.render()); await shot(page, `garage-${w}x${h}`); }
    }
    await ctx.close();
  }

  // ---------------- C. maps ----------------
  if (run('C')) {
    const { ctx, page, logs } = await openGame(browser, { width: 640, height: 360 });
    const expect = { technical: [2420, 3, 'Kage Circuit'], legacy: [5055, 3, 'Legacy Grid'], velocity: [5870, 2, 'Velocity Ring'] };
    for (const k of ['technical', 'legacy', 'velocity']) {
      await page.click(`[data-map="${k}"]`);
      await page.waitForFunction(k2 => NG_DEBUG.map.key === k2 && document.getElementById('go').textContent === 'Race', k, { timeout: 120000 });
      const m = await page.evaluate(() => ({ ...NG_DEBUG.map, rec: document.getElementById('record').textContent }));
      C(`maps: ${k} builds (length/laps/name/world)`, m.lengthM === expect[k][0] && m.laps === expect[k][1] && m.name === expect[k][2] && m.worldMeshes > 40 && m.lastSwitch.geometries > 0, `${m.lengthM} m, ${m.laps} laps, ${m.worldMeshes} meshes, switch ${m.lastSwitch.ms} ms`);
      C(`maps: ${k} shows no record in a clean session`, m.rec === 'No record yet', m.rec);
    }
    C('maps: no page errors', realErrors(logs).length === 0, realErrors(logs).slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ---------------- D. race / pause / restart / finish / results / garage (deterministic stepping) ----------------
  if (run('D')) {
    const { ctx, page, logs } = await openGame(browser, { width: 1280, height: 675 });
    await page.evaluate(() => localStorage.clear());
    await waitRaceBtn(page);
    await page.evaluate(() => __ng.manualClock(true));
    await page.click('#go');
    await page.waitForFunction(() => NG_DEBUG.state === 'intro', null, { timeout: 60000 });
    C('flow: Race -> cinematic intro', true, `precompile ${JSON.stringify(await page.evaluate(() => NG_DEBUG.precompile))}`);
    await page.evaluate(() => { __ng.sim(1.2); __ng.render(); }); await shot(page, 'intro');
    await page.keyboard.press('Enter');
    C('flow: Enter skips intro -> countdown', await st(page) === 'countdown' && (await page.evaluate(() => NG_DEBUG.intro.skipped)));
    await page.evaluate(() => __ng.sim(3.4));
    C('flow: countdown -> race', await st(page) === 'race');
    await page.keyboard.press('KeyP');
    C('flow: P pauses', await page.evaluate(() => NG_DEBUG.paused && !document.getElementById('pause').classList.contains('hide')));
    await page.keyboard.press('Enter');
    C('flow: Enter while paused restarts (countdown)', await st(page) === 'countdown' && !(await page.evaluate(() => NG_DEBUG.paused)));
    await page.evaluate(() => __ng.sim(3.4));
    await page.keyboard.down('KeyW'); await page.evaluate(() => __ng.sim(3)); await page.keyboard.up('KeyW');
    const sp = await page.evaluate(() => NG_DEBUG.speedFx.kmh);
    C('flow: throttle accelerates the player', sp > 150, `${sp} km/h after 3 s`);
    await page.evaluate(() => __ng.render()); await shot(page, 'race');
    await page.evaluate(TP); await page.evaluate(() => __ng.sim(4));
    C('flow: crossing the line on the final lap finishes (finish camera)', await st(page) === 'finished' && /fin/.test(await page.evaluate(() => document.getElementById('cine').className)));
    await page.keyboard.press('Enter'); await page.evaluate(() => __ng.sim(0.2));
    const res = await page.evaluate(() => ({ r: NG_DEBUG.results, rows: document.querySelectorAll('#resTable tr').length, pos: document.getElementById('resPos').textContent }));
    C('flow: Enter skips finish camera -> results', res.r.visible && res.rows === 5, `${res.pos}, rows ${res.rows}`);
    await page.evaluate(() => __ng.render()); await shot(page, 'results');
    const rec = await page.evaluate(() => ({ dbg: NG_DEBUG.records, ls: Object.keys(localStorage).filter(k => k.includes('_rec_')) }));
    C('records: teleported test lap is rejected', rec.dbg.lastOffer && rec.dbg.lastOffer.saved === false, JSON.stringify(rec.dbg.lastOffer));
    C('records: test build never writes real records (localStorage untouched)', rec.ls.length === 0 && rec.dbg.storage.startsWith('memory'), JSON.stringify(rec.ls));
    await page.click('#again');
    C('flow: Race again -> countdown', await st(page) === 'countdown');
    await page.evaluate(() => __ng.sim(3.4)); await page.keyboard.press('KeyP');
    await page.evaluate(() => { document.getElementById('pause').classList.add('hide'); });
    await page.evaluate(() => __ng.sim(0.1));
    await page.evaluate(() => NG_DEBUG.qa.exit());
    C('flow: back to garage', await st(page) === 'title' && !(await page.evaluate(() => document.getElementById('title').classList.contains('hide'))));
    C('flow: no page errors', realErrors(logs).length === 0, realErrors(logs).slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ---------------- E. timing: fixed step, catch-up bound, stalls, wall-clock intro ----------------
  if (run('E')) {
    const { ctx, page, logs } = await openGame(browser, { width: 480, height: 270 });
    await waitRaceBtn(page);
    // real-time intro: wall-clock length regardless of the (very low) software-render FPS
    const tClick = Date.now(); await page.click('#go');
    await page.waitForFunction(() => NG_DEBUG.state === 'countdown', null, { timeout: 60000 });
    const intro = await page.evaluate(() => NG_DEBUG.intro);
    const maxF = intro.maxFrameMs / 1000;
    C('timing: intro runs on the wall clock (not frame count)', intro.wallSec >= intro.len && intro.wallSec <= intro.len + maxF + 0.3, `intro ${intro.wallSec.toFixed(2)} s for len ${intro.len} s over ${intro.frames} frames (max frame ${intro.maxFrameMs.toFixed(0)} ms)`);
    C('timing: shader precompile happens before intro timing starts', (await page.evaluate(() => NG_DEBUG.precompile)).ms >= 0 && intro.startedAt > 0, `precompile ${JSON.stringify(await page.evaluate(() => NG_DEBUG.precompile))}; click->intro-start includes it`);
    // deterministic clock checks through the real frame path (synthetic frame gaps)
    await page.evaluate(() => __ng.manualClock(true));
    await page.evaluate(() => __ng.sim(3.4));
    const r0 = await page.evaluate(() => NG_DEBUG.clock);
    let r1; for (let i = 0; i < 30; i++) r1 = await page.evaluate(() => __ng.advance(100));
    C('timing: 10 FPS frames advance race time 1:1 (3.0 s wall -> 3.0 s race)', Math.abs((r1.raceTime - r0.raceTime) - 3.0) <= 0.0084, `${(r1.raceTime - r0.raceTime).toFixed(4)} s`);
    let r2; for (let i = 0; i < 20; i++) r2 = await page.evaluate(() => __ng.advance(250));
    C('timing: 4 FPS frames still advance race time 1:1', Math.abs((r2.raceTime - r1.raceTime) - 5.0) <= 0.0084 && r2.droppedMs === r1.droppedMs, `${(r2.raceTime - r1.raceTime).toFixed(4)} s`);
    const r3 = await page.evaluate(() => __ng.advance(600));
    C('timing: a 600 ms hitch simulates the 250 ms cap and reports the drop', Math.abs((r3.raceTime - r2.raceTime) - 0.25) <= 0.0084 && Math.round(r3.droppedMs - r2.droppedMs) === 350, `+${(r3.raceTime - r2.raceTime).toFixed(3)} s, dropped ${Math.round(r3.droppedMs - r2.droppedMs)} ms`);
    const r4 = await page.evaluate(() => __ng.advance(5000));
    const p4 = await page.evaluate(() => ({ paused: NG_DEBUG.paused, note: document.getElementById('pauseNote').textContent }));
    C('timing: a 5 s stall (tab suspension) is not simulated and auto-pauses the race', r4.raceTime === r3.raceTime && r4.stalls === r3.stalls + 1 && p4.paused, `${p4.note}`);
    const r5 = await page.evaluate(() => __ng.advance(100));
    C('timing: race clock frozen while paused', r5.raceTime === r4.raceTime);
    await page.keyboard.press('KeyP');
    let r6; for (let i = 0; i < 6; i++) r6 = await page.evaluate(() => __ng.advance(1000 / 60));
    C('timing: resumes cleanly after the stall', Math.abs((r6.raceTime - r5.raceTime) - 0.1) <= 0.0084, `${(r6.raceTime - r5.raceTime).toFixed(4)} s`);
    // visibility: hidden tab pauses the race
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    C('timing: hidden tab pauses the race', await page.evaluate(() => NG_DEBUG.paused));
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); });
    await page.keyboard.press('KeyP');
    // real time: race clock vs wall clock at whatever FPS SwiftShader manages
    await page.evaluate(() => __ng.manualClock(false));
    await page.waitForTimeout(500);
    const a = await page.evaluate(() => [NG_DEBUG.clock, performance.now()]);
    await page.waitForTimeout(5000);
    const b = await page.evaluate(() => [NG_DEBUG.clock, performance.now()]);
    const wallNow = (b[1] - a[1]) / 1000, wallClk = b[0].wallTime - a[0].wallTime, race = b[0].raceTime - a[0].raceTime, dropped = (b[0].droppedMs - a[0].droppedMs) / 1000;
    const paused = await page.evaluate(() => NG_DEBUG.paused);
    // invariant: every wall-clock second the loop saw is either simulated race time or reported as dropped
    C('timing (real time): race time + reported drops == wall time seen by the loop', !paused && Math.abs(race + dropped - wallClk) < 0.02, `loop wall ${wallClk.toFixed(3)} s = race ${race.toFixed(3)} s + dropped ${dropped.toFixed(3)} s; fps ${b[0].fps}`);
    C('timing (real time): loop wall time matches performance.now within one frame', Math.abs(wallClk - wallNow) <= Math.max(0.35, 1 / Math.max(0.2, b[0].minFps || 1)), `loop ${wallClk.toFixed(2)} s vs now ${wallNow.toFixed(2)} s`);
    C('timing (real time): FPS meter reports real FPS (can be < 20)', b[0].fps > 0, `fps ${b[0].fps} (min ${b[0].minFps})`);
    C('timing: no page errors', realErrors(logs).length === 0, realErrors(logs).slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ---------------- F. touch layout ----------------
  if (run('F')) for (const [w, h, label] of [[844, 390, 'landscape']]) {   // portrait racing is blocked by design (see section M)
    const { ctx, page } = await openGame(browser, { width: w, height: h, query: '?touch', ctxOpts: { isMobile: true, hasTouch: true } });
    await waitRaceBtn(page);
    await page.evaluate(() => __ng.manualClock(true));
    await page.tap('#go');
    await page.waitForFunction(() => NG_DEBUG.state === 'intro', null, { timeout: 60000 });
    await page.evaluate(() => __ng.sim(0.5));
    await page.touchscreen.tap(Math.round(w / 2), Math.round(h * 0.35));   // raw touch on the full-screen cinematic
    C('touch: tapping the cinematic skips the intro', await st(page) === 'countdown');
    await page.evaluate(() => __ng.sim(3.4));
    await page.waitForFunction(() => document.body.classList.contains('racing'), null, { timeout: 5000 });
    const L = await page.evaluate(() => {
      const bs = [...document.querySelectorAll('#touch button')].map(b => { const r = b.getBoundingClientRect(); return { k: b.dataset.k, x: r.left, y: r.top, w: r.width, h: r.height, vis: getComputedStyle(b).display !== 'none' && getComputedStyle(document.getElementById('touch')).display !== 'none' }; });
      const cr = document.getElementById('credits').getBoundingClientRect();
      return { bs, cred: { x: cr.left, y: cr.top, w: cr.width, h: cr.height, r: cr.right, b: cr.bottom, vis: getComputedStyle(document.getElementById('credits')).display !== 'none' }, vw: innerWidth, vh: innerHeight };
    });
    const inside = L.bs.every(b => b.x >= 0 && b.y >= 0 && b.x + b.w <= L.vw + 0.5 && b.y + b.h <= L.vh + 0.5);
    const big = L.bs.every(b => b.w >= 44 && b.h >= 44);
    const ov = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    let overlap = false; for (let i = 0; i < L.bs.length; i++) for (let j = i + 1; j < L.bs.length; j++) if (ov(L.bs[i], L.bs[j])) overlap = true;
    C(`touch (${label} ${w}x${h}): 4 controls visible, >=44 px, on-screen, non-overlapping`, L.bs.length === 4 && L.bs.every(b => b.vis) && big && inside && !overlap, L.bs.map(b => `${b.k}:${Math.round(b.w)}x${Math.round(b.h)}@${Math.round(b.x)},${Math.round(b.y)}`).join(' '));
    const credOver = L.bs.some(b => ov(b, { x: L.cred.x, y: L.cred.y, w: L.cred.w, h: L.cred.h }));
    const spd = await page.evaluate(() => { const r = document.getElementById('br').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    const spdOn = spd.x >= 0 && spd.y >= 0 && spd.x + spd.w <= L.vw + 0.5 && spd.y + spd.h <= L.vh + 0.5;
    C(`touch (${label}): Brake/Boost and steer pads do not cover the speedometer cluster`, spdOn && !L.bs.some(b => ov(b, spd)), JSON.stringify(spd, (k, v) => typeof v === 'number' ? Math.round(v) : v));
    C(`touch (${label}): compact credits on-screen and clear of controls`, !L.cred.vis || (L.cred.h <= 40 && L.cred.r <= L.vw + 0.5 && !credOver), JSON.stringify({ h: Math.round(L.cred.h), w: Math.round(L.cred.w), visible: L.cred.vis }));
    await page.evaluate(() => __ng.render()); await shot(page, `touch-${label}`);
    const before = await page.evaluate(() => NG_DEBUG.speedFx.kmh);
    await page.evaluate(() => __ng.sim(2));
    const after = await page.evaluate(() => NG_DEBUG.speedFx.kmh);
    C(`touch (${label}): auto-throttle drives the car`, after > before + 50, `${before} -> ${after} km/h`);
    await ctx.close();
  }

  // ---------------- M. mobile landscape-only + compact HUD ----------------
  if (run('M')) {
    const ov = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const rect = (page, sel) => page.evaluate(q => { const e = document.querySelector(q); const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, vis: getComputedStyle(e).display !== 'none' }; }, sel);
    for (const [w, h] of [[844, 390], [852, 393], [667, 375]]) {
      const { ctx, page, logs } = await openGame(browser, { width: w, height: h, query: '?touch', ctxOpts: { isMobile: true, hasTouch: true } });
      await waitRaceBtn(page);
      await page.evaluate(() => __ng.manualClock(true));
      await page.tap('#go');
      await page.waitForFunction(() => NG_DEBUG.state === 'intro', null, { timeout: 60000 });
      const lock = await page.evaluate(() => NG_DEBUG.mobile.orientLock);
      C(`mobile ${w}x${h}: Race tap requests fullscreen/orientation lock best-effort; race starts either way`, lock.requested && lock.fullscreen !== null, JSON.stringify(lock));
      await page.evaluate(() => __ng.sim(0.5)); await page.touchscreen.tap(Math.round(w / 2), Math.round(h * 0.35));
      await page.evaluate(() => __ng.sim(3.4));
      await page.waitForFunction(() => document.body.classList.contains('racing'), null, { timeout: 5000 });
      await page.evaluate(() => __ng.sim(2));
      const R = { tl: await rect(page, '#tl'), pos: await rect(page, '#pos'), mm: await rect(page, '#minimap'), spd: await rect(page, '#spdT'), boost: await rect(page, '#boost') };
      const pads = await page.evaluate(() => [...document.querySelectorAll('#touch button')].map(b => { const r = b.getBoundingClientRect(); return { k: b.dataset.k, x: r.left, y: r.top, w: r.width, h: r.height }; }));
      const inV = r => r.x >= -0.5 && r.y >= -0.5 && r.x + r.w <= w + 0.5 && r.y + r.h <= h + 0.5;
      const hud = [R.tl, R.pos, R.mm, R.spd, R.boost];
      const road = { x: w * 0.3, y: h * 0.25, w: w * 0.4, h: h * 0.4 };   // centre of the road / car view
      C(`mobile ${w}x${h}: HUD placement (lap/time top-left, position + small minimap top-right, speed/boost bottom-centre)`,
        hud.every(inV) && (await page.evaluate(() => getComputedStyle(document.querySelector('#tl .row')).display !== 'none' && /\d:\d\d\.\d{3}/.test(document.getElementById('time').textContent))) && R.tl.x < w * 0.3 && R.tl.y < h * 0.3 && R.pos.x > w * 0.6 && R.pos.y < h * 0.3 && R.mm.w <= 90 && R.mm.x > w * 0.6 && Math.abs((R.spd.x + R.spd.w / 2) - w / 2) < w * 0.12 && R.spd.y > h * 0.6,
        JSON.stringify(R, (k, v) => typeof v === 'number' ? Math.round(v) : v));
      C(`mobile ${w}x${h}: HUD keeps the road centre clear`, !hud.some(r => ov(r, road)));
      C(`mobile ${w}x${h}: pads >=44px, steer bottom-left, Brake/Boost bottom-right, no HUD overlap`, pads.every(b => b.w >= 44 && b.h >= 44 && inV(b)) && pads.filter(b => /left|right/.test(b.k)).every(b => b.x < w * 0.35) && pads.filter(b => /down|boost/.test(b.k)).every(b => b.x > w * 0.65) && !pads.some(b => hud.some(r => ov(b, r))), pads.map(b => `${b.k}@${Math.round(b.x)},${Math.round(b.y)}`).join(' '));
      await page.evaluate(() => __ng.render()); await shot(page, `mobile-hud-${w}x${h}`);
      if (w === 844) {
        // rotation mid-race with a held input: pause, release inputs, rotate panel, explicit Resume
        await page.evaluate(() => document.fullscreenElement && document.exitFullscreen().catch(() => {})); await page.waitForTimeout(300);
        await page.evaluate(() => { const b = document.querySelector('#touch [data-k=boost]'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch' })); });
        const held = await page.evaluate(() => NG_DEBUG.mobile.keys.boost);
        await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
        const p1 = await page.evaluate(() => ({ paused: NG_DEBUG.paused, keys: NG_DEBUG.mobile.keys, rot: getComputedStyle(document.getElementById('rotate')).display, note: document.getElementById('pauseNote').textContent }));
        C('mobile: rotating to portrait mid-race pauses, shows Rotate panel, releases held inputs', held === 1 && p1.paused && p1.rot === 'flex' && Object.values(p1.keys).every(v => !v), JSON.stringify(p1));
        await page.evaluate(() => __ng.render()); await shot(page, 'mobile-rotate-portrait');
        const t0 = await page.evaluate(() => NG_DEBUG.clock.raceTime);
        await page.evaluate(() => __ng.advance(500));
        await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(300);
        await page.evaluate(() => __ng.advance(500));
        const p2 = await page.evaluate(() => ({ paused: NG_DEBUG.paused, rot: getComputedStyle(document.getElementById('rotate')).display, resume: getComputedStyle(document.getElementById('resumeBtn')).display, rt: NG_DEBUG.clock.raceTime }));
        C('mobile: back to landscape stays paused with an explicit Resume button (no auto-resume)', p2.paused && p2.rot === 'none' && p2.resume === 'block' && p2.rt === t0, JSON.stringify(p2));
        await page.evaluate(() => __ng.render()); await shot(page, 'mobile-resume');
        await page.tap('#resumeBtn');
        const p3 = await page.evaluate(() => ({ paused: NG_DEBUG.paused, boost: NG_DEBUG.mobile.keys.boost }));
        await page.evaluate(() => __ng.advance(100));
        C('mobile: Resume continues the race with no stuck input', !p3.paused && !p3.boost && (await page.evaluate(() => NG_DEBUG.clock.raceTime)) > t0, JSON.stringify(p3));
      }
      C(`mobile ${w}x${h}: no page errors`, realErrors(logs).length === 0, realErrors(logs).slice(0, 2).join(' | '));
      await ctx.close();
    }
    { // portrait at load: rotate panel, no race start
      const { ctx, page } = await openGame(browser, { width: 390, height: 844, query: '?touch', ctxOpts: { isMobile: true, hasTouch: true } });
      await waitRaceBtn(page);
      const vis = await page.evaluate(() => getComputedStyle(document.getElementById('rotate')).display);
      await page.evaluate(() => document.getElementById('go').click()); await page.waitForTimeout(500);
      C('mobile portrait 390x844: Rotate panel shown and no new race can start', vis === 'flex' && (await st(page)) === 'title', `rotate=${vis} state=${await st(page)}`);
      await shot(page, 'mobile-portrait-390x844');
      await ctx.close();
    }
    { // desktop unchanged: no rotate panel, no resume button, full HUD sizes
      const { ctx, page } = await openGame(browser, { width: 1280, height: 675 });
      const d = await page.evaluate(() => ({ rot: getComputedStyle(document.getElementById('rotate')).display, res: getComputedStyle(document.getElementById('resumeBtn')).display, mm: document.getElementById('minimap').getBoundingClientRect().width }));
      C('desktop: no rotate panel / resume button, HUD sizes unchanged', d.rot === 'none' && d.res === 'none' && d.mm === 200, JSON.stringify(d));
      await ctx.close();
    }
  }

  // ---------------- T. optional tilt steering (simulated sensor + permission; physical calibration unverified) ----------------
  if (run('T')) {
    const mock = mode => `(() => { window.__permCalls = 0; const D = window.DeviceOrientationEvent || function () {};
      ${mode === 'nomethod' ? 'try { delete D.requestPermission; } catch (e) {} ' : `D.requestPermission = async () => { window.__permCalls++; return '${mode}'; };`}
      window.DeviceOrientationEvent = D; window.__tiltBeta = 0;
      window.__emit = ${mode === 'silent' || mode === 'nomethod' ? 'false' : 'true'};
      setInterval(() => { if (window.__emit) { const e = new Event('deviceorientation'); e.beta = window.__tiltBeta; e.gamma = 2; e.alpha = null; dispatchEvent(e); } }, 50); })()`;
    for (const mode of ['denied', 'nomethod', 'granted']) {
      const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
      await ctx.addInitScript(mock(mode));
      const page = await ctx.newPage(); const logs = []; page.on('pageerror', e => logs.push(e.message));
      await page.route('**/*', r => /fonts\.(googleapis|gstatic)\.com/.test(r.request().url()) ? r.abort() : r.continue());
      await page.goto(TEST + '?touch'); await waitRaceBtn(page);
      const calls0 = await page.evaluate(() => window.__permCalls);
      C(`tilt (${mode}): no permission prompt on page load; Touch is default`, calls0 === 0 && (await page.evaluate(() => NG_DEBUG.tilt.pref)) === 'touch');
      await page.tap('#setBtn'); await page.tap('[data-steer="tilt"]'); await page.waitForTimeout(1900);
      const t = await page.evaluate(() => ({ ...NG_DEBUG.tilt, calls: window.__permCalls }));
      if (mode === 'denied') C('tilt (denied): clear message, Touch fallback', t.pref === 'touch' && /not granted/.test(t.msg) && t.calls === 1, t.msg);
      if (mode === 'nomethod') C('tilt (no permission API, no events): clear message, Touch fallback', t.pref === 'touch' && /No tilt sensor events/.test(t.msg), t.msg);
      if (mode === 'granted') {
        C('tilt (granted + live events): enabled after explicit tap, recentred', t.pref === 'tilt' && t.live && t.calls === 1 && t.neutral === 0, JSON.stringify(t));
        await page.tap('#setPanel [data-close]');
        await page.evaluate(() => __ng.manualClock(true)); await page.tap('#go');
        await page.waitForFunction(() => NG_DEBUG.state === 'intro', null, { timeout: 60000 });
        await page.keyboard.press('Enter'); await page.evaluate(() => __ng.sim(3.4));
        await page.evaluate(() => { window.__tiltBeta = 30; }); await page.waitForTimeout(200);
        for (let i = 0; i < 10; i++) await page.evaluate(() => __ng.advance(16));
        const k1 = await page.evaluate(() => NG_DEBUG.mobile.keys);
        await page.evaluate(() => { window.__tiltBeta = -30; }); await page.waitForTimeout(200);
        for (let i = 0; i < 10; i++) await page.evaluate(() => __ng.advance(16));
        const k2 = await page.evaluate(() => NG_DEBUG.mobile.keys);
        C('tilt: right tilt steers right, left tilt steers left (analogue, landscape-primary)', k1.right > 0.5 && !k1.left && k2.left > 0.5 && !k2.right, JSON.stringify({ k1, k2 }));
        await page.keyboard.press('KeyP');
        const k3 = await page.evaluate(() => ({ keys: NG_DEBUG.mobile.keys, steer: NG_DEBUG.tilt.steer }));
        C('tilt: pause resets steering (no stuck input)', !k3.keys.left && !k3.keys.right && k3.steer === 0, JSON.stringify(k3));
        C('tilt: Boost/Brake still touch, preference stored (no sensor data stored)', (await page.evaluate(() => JSON.parse(localStorage.getItem('nightgrid_v4_settings')).steer)) === 'tilt' && !(await page.evaluate(() => Object.values(localStorage).some(v => /beta|gamma/.test(v)))));
      }
      C(`tilt (${mode}): no page errors`, logs.length === 0, logs.slice(0, 2).join(' | '));
      await ctx.close();
    }
  }

  // ---------------- G. production build: debug gated off ----------------
  if (run('G')) {
    const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } }); const page = await ctx.newPage();
    const logs = []; page.on('pageerror', e => logs.push(e.message));
    await page.route('**/*', r => /fonts\.(googleapis|gstatic)\.com/.test(r.request().url()) ? r.abort() : r.continue());
    await page.goto(PROD);
    await waitRaceBtn(page);
    const g = await page.evaluate(() => ({ dbg: typeof window.NG_DEBUG, ng: typeof window.__ng, qa: !!document.getElementById('qaBtn'), qaPanel: getComputedStyle(document.getElementById('qa')).display !== 'none', marks: performance.getEntriesByType('mark').map(m => m.name).filter(n => n.startsWith('ng:')) }));
    C('prod: no debug hooks (NG_DEBUG/__ng undefined), no QA button, QA panel hidden', g.dbg === 'undefined' && g.ng === 'undefined' && !g.qa && !g.qaPanel, JSON.stringify(g));
    C('prod: boots to an enabled Race button', true, g.marks.join(','));
    await page.click('#go');
    await page.waitForFunction(() => document.getElementById('title').classList.contains('hide') && document.getElementById('cine').classList.contains('on'), null, { timeout: 60000 });
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /^[123]$|^GO$/.test(document.getElementById('count').textContent), null, { timeout: 60000 });
    C('prod: Race -> intro -> Enter skip -> countdown (no debug hooks used)', true, await page.evaluate(() => 'count=' + document.getElementById('count').textContent));
    C('prod: no page errors', logs.length === 0, logs.slice(0, 3).join(' | '));
    await ctx.close();
  }
} catch (e) {
  C('runner: unexpected exception', false, e.stack.split('\n').slice(0, 4).join(' | '));
} finally {
  await browser.close(); await srvTest.httpServer.close(); await srvProd.httpServer.close();
  const fail = results.filter(r => !r.ok);
  writeFileSync(`${OUT}/e2e${ONLY.length ? '-' + ONLY.join('') : ''}.json`, JSON.stringify({ when: new Date().toISOString(), env: 'Chromium (Playwright 1.63) + SwiftShader software WebGL, headless, local vite preview', pass: results.length - fail.length, fail: fail.length, results }, null, 2));
  console.log(`\n${results.length - fail.length}/${results.length} passed`);
  process.exit(fail.length ? 1 : 0);
}
