// Real 20-seat MP results: page (seat 20, touch phone 844x390) + 19 Node clients, race time-capped by the server,
// real results card via the game's own handler. Checks: 20 rows, last row reachable by REAL touch scroll on the
// table, Back visible + hit-testable, REAL tap on Back -> lobby. Usage (repo dir): node results20.mjs [w h]
const W = +(process.argv[2] || 844), H = +(process.argv[3] || 390), cwd = process.cwd();
const { startLocalServer } = await import(cwd + '/server/local.mjs');
const { NetClient } = await import(cwd + '/src/net/client.js');
const { driver, waitFor } = await import(cwd + '/tests/net/scenario.mjs');
const { launch } = await import(cwd + '/tests/e2e/harness.mjs');
const WebSocket = (await import(cwd + '/node_modules/ws/index.js')).default;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const srv = await startLocalServer({ port: 0, dist: 'dist-test', netsim: true, lagMs: 50, log: false, createPerMin: 1000, budget: { maxActiveRooms: 4 }, room: { countdownMs: 5000, maxRaceMs: 20000, resultsHoldMs: 120000 } });
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true }); const page = await ctx.newPage(); page.setDefaultTimeout(300000);
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.route('**/*', r => /fonts\.(googleapis|gstatic)\.com/.test(r.request().url()) ? r.abort() : r.continue());
await page.goto(srv.url + '/?touch'); await page.waitForFunction(() => window.NG_DEBUG && NG_DEBUG.state === 'title');
const code = (await (await fetch(srv.url + '/api/rooms', { method: 'POST' })).json()).code;
const cl = []; for (let i = 0; i < 19; i++) { const c = new NetClient({ wsUrl: srv.url.replace('http', 'ws'), WebSocketImpl: WebSocket, now: () => performance.now(), build: srv.build, name: 'Racer' + i, onEvent: () => { } }); c.drive = driver(i + 1); c.connect(code); cl.push(c); await waitFor(() => c.you, 20000); c.ready(true); }
await page.tap('#mpBtn'); await page.fill('#mpName', 'Page'); await page.fill('#mpCode', code.toLowerCase()); await page.tap('[data-act=join]');
await page.waitForFunction(() => NG_DEBUG.mp.room && NG_DEBUG.mp.room.seats.length === 20);
await page.evaluate(() => __ng.mpAutodrive(true));   // after join (see backrow diagnosis)
await page.tap('[data-act=ready]');
await waitFor(() => cl[0].room && cl[0].room.canStart, 30000); cl[0].start();
let stop = false; const loop = (async () => { while (!stop) { for (const c of cl) if (c.race) { c.frame(c.drive(c.race.pred)); c.race.pred.decay(0.033); } await sleep(33); } })();
await page.waitForFunction(() => NG_DEBUG.mp.results && !document.getElementById('results').classList.contains('hide'), null, { timeout: 240000 });
await sleep(2500);
const geo = () => page.evaluate(() => { const rows = document.querySelectorAll('#resTable tr'), last = rows[rows.length - 1].getBoundingClientRect(), bt = document.getElementById('toGarage').getBoundingClientRect(), sc = document.getElementById('resScroll');
  const hit = document.elementFromPoint(bt.x + bt.width / 2, bt.y + bt.height / 2), hl = document.elementFromPoint(last.x + 20, last.y + last.height / 2);
  return { rows: rows.length - 1, results: NG_DEBUG.mp.results.length, vh: innerHeight, scrollTop: sc ? Math.round(sc.scrollTop) : null, scrollMax: sc ? sc.scrollHeight - sc.clientHeight : null, lastTop: Math.round(last.top), lastBottom: Math.round(last.bottom), lastVisible: last.bottom <= innerHeight && !!hl && !!hl.closest('#resTable'), lastText: rows[rows.length - 1].textContent.slice(0, 40), back: [Math.round(bt.top), Math.round(bt.bottom)], backHit: !!hit && !!hit.closest('#toGarage'), backLabel: document.getElementById('toGarage').textContent }; });
const before = await geo();
await page.screenshot({ path: `test-results/results20-${W}x${H}-top.jpg`, type: 'jpeg', quality: 75 });
// REAL touch scroll: swipe up on the table area via CDP touch events
const box = await page.evaluate(() => { const r = (document.getElementById('resScroll') || document.getElementById('resTable')).getBoundingClientRect(); return { x: r.x + r.width / 2, y0: r.y + r.height * 0.85, y1: r.y + r.height * 0.1 }; });
const cdp = await ctx.newCDPSession(page);
for (let k = 0; k < 4; k++) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y0 }] });
  for (let s = 1; s <= 8; s++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x, y: box.y0 + (box.y1 - box.y0) * s / 8 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(1500);
}
const after = await geo();
await page.screenshot({ path: `test-results/results20-${W}x${H}-scrolled.jpg`, type: 'jpeg', quality: 75 });
await page.tap('#toGarage');
const backOk = await page.waitForFunction(() => !NG_DEBUG.mp.race && document.getElementById('results').classList.contains('hide'), null, { timeout: 60000 }).then(() => true).catch(() => false);
const lobby = await page.evaluate(() => ({ state: NG_DEBUG.state, inRoom: NG_DEBUG.mp.inRoom, phase: NG_DEBUG.mp.room && NG_DEBUG.mp.room.phase, panel: !!document.querySelector('#mpPanel') && getComputedStyle(document.querySelector('#mpPanel')).display !== 'none' }));
stop = true; await loop;
console.log(JSON.stringify({ viewport: [W, H], before, afterTouchScroll: after, backTapReturned: backOk, afterBack: lobby, pageErrors: errs.length, firstErr: errs[0] || null }, null, 1));
for (const c of cl) c.leave(); await browser.close(); await srv.close(); process.exit(0);
