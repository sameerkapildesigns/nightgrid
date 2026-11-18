// Gate 4: real browser multiplayer sessions (Playwright/Chromium, SwiftShader) over the local room
// server (server/local.mjs) serving the test build (dist-test, debug hooks on). Each player is a separate
// browser context (separate storage/session). Inputs go through the real keyboard/touch -> frames path;
// NG_DEBUG-only autodrive presses keys from a line-follower so races progress on a software renderer.
// Usage: npm run test:mp   -> test-results/mp/*.jpg + mp.json
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { launch, realErrors, check } from './harness.mjs';
import { startLocalServer } from '../../server/local.mjs';
import { MAX_SEATS } from '../../src/core/room.js';   // M7: capacity checks follow the real cap (20), not a literal 4
import { NetClient } from '../../src/net/client.js';
import WebSocket from 'ws';

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
const VIEW = { desk: { width: 1280, height: 720 }, phone: { width: 844, height: 390 }, portrait: { width: 390, height: 844 }, l667: { width: 667, height: 375 }, l852: { width: 852, height: 393 }, p344: { width: 344, height: 740 } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const THROTTLE = +(process.env.NG_RENDER_EVERY || 1);   // default 1 = every frame rendered (no throttling). >1 is a diagnostic option only, reported in the output
async function shot(p, n) {
  await p.page.evaluate(() => { window.__ngRenderEvery = 1; }); await sleep(1500);
  await p.page.screenshot({ path: `${OUT}/${n}.jpg`, type: 'jpeg', quality: 75 });
  await p.page.evaluate(t => { window.__ngRenderEvery = t; }, THROTTLE);
}
const OPEN = [];
async function player(name, kind = 'desk', query = '') {
  const touch = kind !== 'desk';
  const ctx = await browser.newContext({ viewport: VIEW[kind], hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); const logs = []; page.setDefaultTimeout(180000);   // several software-GL pages saturate 2 cores: actions wait for a busy main thread
  page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); }); page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
  await page.route('**/*', r => /fonts\.(googleapis|gstatic)\.com/.test(r.request().url()) ? r.abort() : r.continue());
  await page.goto(BASE + (touch ? '?touch' + (query ? '&' + query.slice(1) : '') : query), { timeout: 240000 });   // boot on software GL with several pages open takes minutes
  await page.waitForFunction(() => window.NG_DEBUG && NG_DEBUG.state === 'title', null, { timeout: 240000 });
  const p = { name, kind, ctx, page, logs }; OPEN.push(p); return p;
}
const mp = p => p.page.evaluate(() => Object.assign(NG_DEBUG.mp, { fps: NG_DEBUG.render.fps }));
const waitMp = (p, fn, ms = 180000, arg) => p.page.waitForFunction(new Function('a', `const m = NG_DEBUG.mp; return (${fn})(m, a);`), arg, { timeout: ms, polling: 200 });
async function create(p) {
  await p.page.click('#mpBtn'); await p.page.fill('#mpName', p.name); await p.page.click('[data-act=create]');
  await waitMp(p, 'm => m.inRoom'); return (await mp(p)).code;
}
async function joinByLink(p, code) {   // the invite link opens the panel with the code filled in
  await p.page.goto(BASE + (p.kind !== 'desk' ? '?touch&' : '?') + 'room=' + code, { timeout: 240000 });
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
  // the test driver is armed in every page BEFORE start (it only acts once the worker has a race), in
  // parallel: on software GL each page.evaluate waits for a render frame (7-14 s with 4 pages), so arming it
  // page by page after start let a 50 s capped race end before any desktop car got throttle (B-4h: server
  // saw up=0 for the whole race; only the phone's touch auto-throttle drove, and it shoved the others)
  await Promise.all(ps.map(p => p.page.evaluate(t => { __ng.mpAutodrive(true); window.__ngRenderEvery = t; }, THROTTLE)));
  await click(host, '[data-act=start]');
  await Promise.all(ps.map(p => waitMp(p, 'm => m.race || m.results', 180000)));
  await Promise.all(ps.map(p => waitMp(p, 'm => m.state === "race" || m.state === "finished" || m.results', 180000)));
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
  if (rs) { const t = rs.stats.tickMs.slice().sort((x, y) => x - y); T(`${label}: server ticks over the 50 ms budget <= 0.5 % (server shares this host's 2 cores with the browsers)`, rs.stats.overruns <= rs.stats.ticks * 0.005, `ticks ${rs.stats.ticks}, tick p95 ${t[Math.floor(t.length * .95)].toFixed(2)} ms, overruns ${rs.stats.overruns}, late ticks ${rs.stats.lateTicks}, dropped ${Math.round(rs.stats.droppedMs)} ms, starved frames ${rs.stats.starved}, skipped frames ${rs.stats.skippedFrames}, rejected ${JSON.stringify(rs.stats.rejected)}`); }
  if (rs) for (const m of res) { const q = rs.inputs.get(m.you); if (q) I(`${label} ${m.you}: server input`, `frames consumed ${q.next}, missed ${q.starve} (${(100 * q.starve / Math.max(1, q.next)).toFixed(1)} %), skipped ${q.skipped}, max queued ${q.maxQ}`); }
  C(`${label}: no records offered from multiplayer`, res.every(m => m.recordsOffered === 0));
  for (const m of res) {
    const mins = Math.max(0.1, (m.raceS || 60) / 60);
    T(`${label} ${m.you}: mispredict p95 <= ${TGT.mispredictP95M} m`, m.mispredictP95 <= TGT.mispredictP95M, `${(+m.mispredictP95).toFixed(3)} m`);
    T(`${label} ${m.you}: hard snaps <= ${TGT.hardSnapsPerMin}/min`, m.hard / mins <= TGT.hardSnapsPerMin, `${m.hard} in ${mins.toFixed(1)} min`);
    I(`${label} ${m.you}: client`, `worker ${m.worker}, rtt ${m.rtt} ms, lead ${m.lead}, fps ${m.fps}, render every ${THROTTLE}, render gaps ${JSON.stringify(m.renderGaps)}, net ${JSON.stringify(m.net)}`);
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
  if (run('B')) {   // 4 humans (3 desktop + 1 phone) full race. Capacity (seat MAX_SEATS+1 refused) is scenario K.
    // boot + create/join one browser at a time (an open room panel throttles that page's garage rendering)
    const ps = [await player('Cy')]; const code = await create(ps[0]);
    for (const [n, k] of [['Di', 'desk'], ['Ed', 'desk'], ['Fay', 'phone']]) { const p = await player(n, k); await joinByCode(p, code); ps.push(p); }
    await waitMp(ps[0], 'm => m.room.seats.length === 4');
    C(`B: 4 humans seated, room shows 4/${MAX_SEATS}`, (await mp(ps[0])).room.maxSeats === MAX_SEATS);
    await readyAll(ps); await raceAndFinish(ps, { label: 'B-4h' });
    await close(ps);
  }
  if (run('K')) {   // capacity at the REAL cap: ONE software browser at a time + Node peers (never MAX_SEATS browsers)
    const peers = [], mkPeer = (code, i) => { const c = new NetClient({ wsUrl: srv.url.replace('http', 'ws'), WebSocketImpl: WebSocket, now: () => performance.now(), build: srv.build, name: 'Peer' + i, onEvent: () => { } }); c.connect(code); peers.push(c); return c; };
    const until = async (f, ms = 20000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timeout'); await sleep(50); } };
    // K1: browser host + (MAX_SEATS-1) Node peers -> full room: Add bot disabled, count MAX_SEATS/MAX_SEATS
    const h = await player('Kay', 'l667'); const code1 = await create(h);
    for (let i = 1; i < MAX_SEATS; i++) { const c = mkPeer(code1, i); await until(() => c.you); }
    await waitMp(h, `m => m.room.seats.length === ${MAX_SEATS}`); await sleep(800); await shot(h, `K-full-${MAX_SEATS}-host-667`);
    C(`K: Add bot disabled at ${MAX_SEATS} seats`, await h.page.locator('[data-act=addbot]').isDisabled());
    C(`K: seat count reads ${MAX_SEATS}/${MAX_SEATS}`, (await h.page.textContent('#mpCount')).startsWith(`${MAX_SEATS}/${MAX_SEATS}`), await h.page.textContent('#mpCount'));
    await close([h]); for (const c of peers.splice(0)) c.leave();
    // K2: MAX_SEATS Node peers fill a room; the ONE browser is seat MAX_SEATS+1 -> readable, truthful full error
    const code2 = (await (await fetch(srv.url + '/api/rooms', { method: 'POST' })).json()).code;
    for (let i = 0; i < MAX_SEATS; i++) { const c = mkPeer(code2, i); await until(() => c.you); }
    const x = await player('Xtra', 'l667');
    const lead = await x.page.evaluate(() => { document.getElementById('mpBtn').click(); return new Promise(r => setTimeout(() => r((document.querySelector('#mpPanel .lead') || {}).textContent || ''), 500)); });
    C(`K: entry text states 2 to ${MAX_SEATS} racers`, lead.includes(`to ${MAX_SEATS} racers`), lead);
    await x.page.fill('#mpName', 'Xtra'); await x.page.fill('#mpCode', code2); await x.page.click('[data-act=join]');
    await x.page.waitForFunction(() => document.querySelector('#mpPanel .err'), null, { timeout: 15000 });
    const errTxt = await x.page.textContent('#mpPanel .err'); await shot(x, `K-seat${MAX_SEATS + 1}-refused-667`);
    C(`K: seat ${MAX_SEATS + 1} sees a readable "room is full (${MAX_SEATS} seats)" error`, /full/i.test(errTxt) && errTxt.includes(String(MAX_SEATS)), errTxt);
    C(`K: room still has ${MAX_SEATS} seats after the refusal`, peers[0].room && peers[0].room.seats.length === MAX_SEATS);
    await x.ctx.close(); for (const c of peers.splice(0)) c.leave();
  }
  if (run('C')) {   // 1 human + 3 bots, full race, Kage; portrait lobby screenshot on a phone
    const a = await player('Hal'); const code = await create(a);
    for (let i = 0; i < 3; i++) await click(a, '[data-act=addbot]');
    C(`C: Add bot still enabled at 4 seats (cap ${MAX_SEATS}; full-room UI is scenario K)`, MAX_SEATS > 4 ? !(await a.page.locator('[data-act=addbot]').isDisabled()) : await a.page.locator('[data-act=addbot]').isDisabled());
    await click(a, '[data-act=map][data-map=technical]'); await readyAll([a]);
    const pp = await player('Ivy', 'portrait', '?room=' + code);
    await sleep(800); await shot(pp, 'C-portrait-invite-phone');
    const vis = await pp.page.evaluate(() => { const p = document.getElementById('mpPanel'); const r = p.getBoundingClientRect(); return !p.classList.contains('hide') && r.width > 300 && getComputedStyle(document.getElementById('rotate')).display === 'none'; });
    C('C: portrait phone opening an invite link sees the room panel (rotate prompt deferred)', vis);
    await pp.ctx.close();
    await raceAndFinish([a], { label: 'C-1h3b', full: true });
    await close([a]);
  }
  if (run('U')) {   // phone UI: room code, seats and main action visible + hit-testable; results action on screen
    const hit = (p, sels) => p.page.evaluate(sels => sels.map(sel => { const e = document.querySelector(sel); if (!e) return [sel, 'missing']; const r = e.getBoundingClientRect();
      const inView = r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight + 0.5 && r.right <= innerWidth + 0.5; const x = r.left + r.width / 2, y = r.top + r.height / 2; const at = document.elementFromPoint(x, y);
      return [sel, inView && at && (at === e || e.contains(at)) ? 'ok' : `not hit-testable (${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} in ${innerWidth}x${innerHeight}, top=${at && (at.id || at.className)})`, Math.round(r.height)]; }), sels);
    for (const kind of ['phone', 'l667', 'l852']) {
      const a = await player('Uma', kind); const code = await create(a);
      for (let i = 0; i < 3; i++) await click(a, '[data-act=addbot]');
      await waitMp(a, 'm => m.room.seats.length === 4'); await sleep(800); await shot(a, `U-lobby-host-4seats-${kind}`);
      const h = await hit(a, ['#mpRoomCode', '#mpCount', '[data-act=copylink]', '[data-act=close]', '[data-act=ready]', '[data-act=start]', '#mpSeats li:nth-child(1)', '#mpSeats li:nth-child(4)']);
      const seatsVisible = await a.page.evaluate(() => { const b = document.querySelector('#mpPanel .mpbody').getBoundingClientRect(); return [...document.querySelectorAll('#mpSeats li')].every(li => { const r = li.getBoundingClientRect(); return r.top >= b.top - 1 && r.bottom <= b.bottom + 1; }); });
      C(`U ${kind}: room code, seat count, copy/close, Ready/Start visible + hit-testable`, h.slice(0, 6).every(x => x[1] === 'ok'), JSON.stringify(h.slice(0, 6)));
      C(`U ${kind}: all 4 seats visible without scrolling`, seatsVisible && h.slice(6).every(x => x[1] === 'ok'), JSON.stringify(h.slice(6)));
      C(`U ${kind}: main buttons >= 36 px tall`, h.filter(x => /ready|start/.test(x[0])).every(x => x[2] >= 36), JSON.stringify(h.map(x => [x[0], x[2]])));
      if (kind === 'phone') {   // results screen at 844x390: time-capped race, then the Back to lobby action must be on screen
        const rs = [...srv.rooms.values()].find(r => r.room.code === code); rs.cfg.maxRaceMs = 9000;
        await click(a, '[data-act=ready]'); await waitMp(a, 'm => m.room.canStart'); await click(a, '[data-act=start]');
        await waitMp(a, 'm => m.results', 120000); await sleep(1500); await shot(a, 'U-results-phone');
        const r = await hit(a, ['#toGarage', '#resTable']); C('U phone: results table + BACK TO LOBBY visible and hit-testable at 844x390', r.every(x => x[1] === 'ok'), JSON.stringify(r));
      }
      await close([a]);
    }
    for (const kind of ['p344', 'portrait']) {
      const host = await player('Vic', 'phone'); const code = await create(host);
      const g = await player('Wes', kind, '?room=' + code); await sleep(800); await shot(g, `U-invite-${kind}`);
      const h = await hit(g, ['#mpName', '#mpCode', '[data-act=join]']); C(`U ${kind}: portrait invite shows name, code and Join (hit-testable)`, h.every(x => x[1] === 'ok'), JSON.stringify(h));
      await close([host, g]);
    }
  }
  if (run('T')) {   // REAL touch route: CDP touch on the DOM buttons -> page -> input worker -> server racer input (no autodrive)
    const a = await player('Tia', 'phone'); const code = await create(a);
    await click(a, '[data-act=addbot]'); await readyAll([a]); await waitMp(a, 'm => m.room.canStart');
    const rs = srv.rooms.get(code); rs.cfg.maxRaceMs = 300000;
    await click(a, '[data-act=start]'); await waitMp(a, 'm => m.state === "race"', 180000);
    const cdp = await a.ctx.newCDPSession(a.page);
    const center = async k => a.page.evaluate(k => { const r = document.querySelector(`#touch button[data-k="${k}"]`).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, k);
    const P = {}; for (const k of ['left', 'right', 'down', 'boost']) P[k] = await center(k);
    const touch = (type, keysDown) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: keysDown.map((k, i) => ({ x: P[k].x, y: P[k].y, id: i + 1 })) });
    const inp = () => { const r = rs.sim && rs.sim.racers.find(x => x.id === 'p1'); return r ? { ...r.input } : null; };
    const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = inp(); if (v && fn(v)) return Date.now() - t; await sleep(20); } return -1; };
    const lat = {};
    lat.throttle = await until(v => v.up === 1); C('T: auto-throttle reaches the server (no touch)', lat.throttle >= 0, JSON.stringify(inp()));
    await touch('touchStart', ['right']); lat.right = await until(v => v.right === 1 && v.left === 0); C('T: hold RIGHT steer -> server right=1', lat.right >= 0, JSON.stringify(inp()));
    await touch('touchEnd', []); lat.rightUp = await until(v => v.right === 0); C('T: release -> server right=0', lat.rightUp >= 0, JSON.stringify(inp()));
    await touch('touchStart', ['down']); lat.brake = await until(v => v.down === 1 && v.up === 0); C('T: hold BRAKE -> server down=1, throttle off', lat.brake >= 0, JSON.stringify(inp()));
    await touch('touchEnd', []); lat.brakeUp = await until(v => v.down === 0 && v.up === 1); C('T: release brake -> throttle back on', lat.brakeUp >= 0, JSON.stringify(inp()));
    await touch('touchStart', ['left']); await touch('touchMove', ['left', 'boost']); lat.multi = await until(v => v.left === 1 && v.boost === 1); C('T: multitouch LEFT + BOOST -> both at the server', lat.multi >= 0, JSON.stringify(inp()));
    await touch('touchCancel', []); lat.cancel = await until(v => v.left === 0 && v.boost === 0); C('T: touchcancel -> everything released at the server', lat.cancel >= 0, JSON.stringify(inp()));
    // main-thread stall while steering: worker keeps the held input flowing; server does not starve
    await touch('touchStart', ['right']); await until(v => v.right === 1);
    const q = rs.inputs.get('p1'), m0 = q.starve, c0 = q.next;
    const stallP = a.page.evaluate(() => { const t = performance.now(); while (performance.now() - t < 1800); });
    await sleep(900); const mid = inp(); await stallP;
    C('T: during an 1.8 s page main-thread stall the server still receives RIGHT (held by the worker)', mid && mid.right === 1, JSON.stringify(mid));
    I('T: server input during/after the stall', `missed ${q.starve - m0} of ${q.next - c0} frames`);
    await touch('touchEnd', []); await until(v => v.right === 0);
    // focus loss / hidden page release immediately, independent of the next render
    await touch('touchStart', ['boost']); await until(v => v.boost === 1);
    await a.page.evaluate(() => window.dispatchEvent(new Event('blur'))); lat.blur = await until(v => v.boost === 0 && v.up === 0, 4000);
    C('T: window blur -> server input released', lat.blur >= 0, JSON.stringify(inp()));
    await touch('touchEnd', []); await sleep(300);
    await touch('touchStart', ['left']); await until(v => v.left === 1);
    await a.page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }); lat.hidden = await until(v => v.left === 0, 4000);
    C('T: page hidden -> server input released', lat.hidden >= 0, JSON.stringify(inp()));
    I('T: touch -> server latency (ms; includes this host\'s ~1 FPS main thread + 0 ms netsim)', JSON.stringify(lat));
    await shot(a, 'T-touch-race-phone');
    await close([a]);
  }
  if (run('E')) {   // ACCEPTANCE: four phone-sized touch browsers, 4 humans, full race + same-room rematch full race
    const LAG = +(process.env.NG_LAG || 0), names = ['Kai', 'Lea', 'Max', 'Noa'];
    const host = await player(names[0], 'phone'); const code = await create(host); const ps = [host];
    for (const n of names.slice(1)) { const p = await player(n, 'phone'); await joinByCode(p, code); ps.push(p); }   // one browser at a time
    await waitMp(host, 'm => m.room.seats.length === 4 && m.room.seats.every(s => s.connected)');
    await click(host, '[data-act=map][data-map=technical]'); await click(host, '[data-act=mode][data-mode=assisted]');
    await waitMp(ps[3], 'm => m.room.map === "technical"');
    await readyAll(ps); await waitMp(host, 'm => m.room.canStart');
    for (const p of ps) await shot(p, `E-rtt${LAG}-lobby-${p.name}`);
    const lob = await mp(host); C(`E rtt${LAG}: 4 humans in one room, all ready`, lob.room.seats.length === 4 && lob.room.seats.every(s => s.kind === 'human' && s.ready), JSON.stringify(lob.room.seats.map(s => [s.name, s.ready])));
    const w = await Promise.all(ps.map(mp)); C(`E rtt${LAG}: all four use the input worker`, w.every(m => m.worker), w.map(m => m.worker).join());
    await raceAndFinish(ps, { label: `E-rtt${LAG}-race1-4phones`, full: true });
    await backToLobby(ps);
    if (await host.page.locator('[data-act=tolobby]').count()) await click(host, '[data-act=tolobby]');
    for (const p of ps) await waitMp(p, 'm => m.room && m.room.phase === "lobby"');
    const lob2 = await mp(host); C(`E rtt${LAG}: same room after results (code unchanged, 4 seats, one room on the server)`, lob2.code === code && lob2.room.seats.length === 4 && srv.rooms.size === 1, `${lob2.code} ${lob2.room.seats.length} rooms=${srv.rooms.size}`);
    await readyAll(ps);
    await raceAndFinish(ps, { label: `E-rtt${LAG}-race2-rematch-4phones`, full: true });
    await close(ps);
  }
  if (run('D')) {   // unthrottled single PHONE (touch, 844x390) + 3 bots, full race on Kage
    const a = await player('Joy', 'phone'); const code = await create(a); void code;
    for (let i = 0; i < 3; i++) await click(a, '[data-act=addbot]');
    await click(a, '[data-act=map][data-map=technical]'); await readyAll([a]);
    await raceAndFinish([a], { label: 'D-phone-1h3b', full: true });
    await close([a]);
  }
} catch (e) {
  C('suite crashed', false, e.stack);
  for (const p of OPEN) { try { const st = await p.page.evaluate(() => ({ mp: (({ inRoom, code, status, lastErr, state }) => ({ inRoom, code, status, lastErr, state }))(NG_DEBUG.mp), panelOpen: !document.getElementById('mpPanel').classList.contains('hide'), panel: document.getElementById('mpPanel').innerText.slice(0, 160).replace(/\n/g, ' | '), fps: NG_DEBUG.render.fps }), null); console.log(`DIAG ${p.name}: ${JSON.stringify(st)}`); await shot(p, 'crash-' + p.name); } catch (x) { console.log(`DIAG ${p.name}: closed/unavailable`); } }
}
await browser.close(); await srv.close();
writeFileSync(`${OUT}/mp.json`, JSON.stringify({ renderEvery: THROTTLE, targets: TGT, functional: results, quality: targets, info: infos }, null, 1));
const fails = results.filter(r => !r.ok).length, tf = targets.filter(t => !t.ok).length;
console.log(`\n${results.length - fails}/${results.length} functional checks passed; ${targets.length - tf}/${targets.length} quality targets met (render every ${THROTTLE} frame(s))`); process.exit(fails ? 1 : 0);
