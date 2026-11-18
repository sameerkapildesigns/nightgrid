// Back-row 0 km/h diagnosis. 1 real Chromium page + (N-1) Node NetClients on the local server.
// The page uses REAL held ArrowUp (no autodrive). Server-side trace of the page's racer: input frames received,
// queue, starvation, decoded input.up, speed, prog. Usage (from repo dir): node backrow-diag.mjs <slot:front|back> [N]
const slot = process.argv[2] || 'back', N = +(process.argv[3] || 20), MODE = process.argv[4] || 'keys', cwd = process.cwd();   // MODE: keys | auto-before | auto-after
const { startLocalServer } = await import(cwd + '/server/local.mjs');
const { NetClient } = await import(cwd + '/src/net/client.js');
const { driver, waitFor } = await import(cwd + '/tests/net/scenario.mjs');
const { launch } = await import(cwd + '/tests/e2e/harness.mjs');
const WebSocket = (await import(cwd + '/node_modules/ws/index.js')).default;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const srv = await startLocalServer({ port: 0, dist: 'dist-test', netsim: true, lagMs: 50, log: false, createPerMin: 1000, budget: { maxActiveRooms: 4 }, room: { countdownMs: 6000, maxRaceMs: 600000 } });
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } }); const page = await ctx.newPage(); page.setDefaultTimeout(300000);
const errs = [], cons = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (/warn|error/.test(m.type())) cons.push(m.text().slice(0, 200)); });
await page.route('**/*', r => /fonts\.(googleapis|gstatic)\.com/.test(r.request().url()) ? r.abort() : r.continue());
await page.goto(srv.url + '/'); await page.waitForFunction(() => window.NG_DEBUG && NG_DEBUG.state === 'title');
if (MODE === 'auto-before') await page.evaluate(() => __ng.mpAutodrive(true));
const mkClient = i => { const c = new NetClient({ wsUrl: srv.url.replace('http', 'ws'), WebSocketImpl: WebSocket, now: () => performance.now(), build: srv.build, name: 'Racer' + i, onEvent: () => { } }); c.drive = driver(i + 1); return c; };
const cl = []; let code, host;
const joinPage = async () => { await page.click('#mpBtn'); await page.fill('#mpName', 'Page'); await page.fill('#mpCode', code.toLowerCase()); await page.click('[data-act=join]'); await page.waitForFunction(() => NG_DEBUG.mp.inRoom); };
if (slot === 'front') {
  await page.click('#mpBtn'); await page.fill('#mpName', 'Page'); await page.click('[data-act=create]'); await page.waitForFunction(() => NG_DEBUG.mp.inRoom);
  code = await page.evaluate(() => NG_DEBUG.mp.code);
  for (let i = 0; i < N - 1; i++) { const c = mkClient(i); c.connect(code); cl.push(c); await waitFor(() => c.you, 20000); c.ready(true); }
} else {
  code = (await (await fetch(srv.url + '/api/rooms', { method: 'POST' })).json()).code;
  for (let i = 0; i < N - 1; i++) { const c = mkClient(i); c.connect(code); cl.push(c); await waitFor(() => c.you, 20000); c.ready(true); }
  await joinPage();
}
await page.waitForFunction(k => NG_DEBUG.mp.room && NG_DEBUG.mp.room.seats.length === k, N);
if (MODE === 'auto-after') await page.evaluate(() => __ng.mpAutodrive(true));
await page.click('[data-act=ready]');
const pageId = await page.evaluate(() => NG_DEBUG.mp.you);
if (slot === 'front') { await page.waitForFunction(() => NG_DEBUG.mp.room.canStart); await page.click('[data-act=start]'); }
else { await waitFor(() => cl[0].room && cl[0].room.canStart, 30000); cl[0].start(); }
let stop = false; const loop = (async () => { while (!stop) { for (const c of cl) if (c.race) { c.frame(c.drive(c.race.pred)); c.race.pred.decay(0.033); } await sleep(33); } })();
const rs = srv.rooms.get(code);
// server trace every 250 ms
const trace = []; let tr = true;
const tracer = (async () => { while (tr) { const sim = rs.sim, q = rs.inputs && rs.inputs.get(pageId), r = sim && sim.racers.find(x => x.id === pageId);
  trace.push({ t: +(performance.now() / 1000).toFixed(2), phase: rs.room.phase, simT: sim ? +sim.time.toFixed(2) : null, up: r ? r.input.up : null, speedKmh: r ? Math.round(r.speed * 3.6) : null, va: r ? +r.va.toFixed(1) : null, s: r ? +r.s.toFixed(1) : null, d: r ? +r.d.toFixed(1) : null,
    qNext: q ? q.next : null, qBuf: q ? q.buf.size : null, starve: q ? q.starve : null, skipped: q ? q.skipped : null, page: null }); await sleep(250); } })();
await page.waitForFunction(() => NG_DEBUG.state === 'countdown' || NG_DEBUG.state === 'race', null, { timeout: 120000 });
const pageInfo = async () => page.evaluate(() => ({ state: NG_DEBUG.state, kmh: NG_DEBUG.speedFx.kmh, fps: NG_DEBUG.render.fps, keys: NG_DEBUG.mobile.keys, net: NG_DEBUG.mp.net, worker: NG_DEBUG.mp.worker, pending: NG_DEBUG.mp.pending, me: NG_DEBUG.mp.me }));
await page.evaluate(() => { window.__kd = []; addEventListener('keydown', e => window.__kd.push([e.code, Math.round(performance.now()), Math.round(e.timeStamp)]), true); });
const pinfo = []; pinfo.push({ when: 'pre', ...(await pageInfo()) });
const issuedAt = await page.evaluate(() => Math.round(performance.now()));
const tDownNode = performance.now() / 1000; if (MODE === 'keys') await page.keyboard.down('ArrowUp');   // REAL key, held from countdown through the race
const t0 = performance.now(); await page.waitForFunction(() => NG_DEBUG.state === 'race', null, { timeout: 120000 }); const raceAt = (performance.now() - t0) / 1000;
for (let k = 0; k < 4; k++) { await sleep(2000); pinfo.push({ when: 'held+' + (2 * (k + 1)) + 's', ...(await pageInfo()) }); }
if (MODE === 'keys') await page.keyboard.up('ArrowUp'); await sleep(1500); pinfo.push({ when: 'released', ...(await pageInfo()) });
await page.screenshot({ path: `/home/claude/m7-export/backrow-diag-${slot}-${MODE}.jpg`, type: 'jpeg', quality: 72 });
tr = false; await tracer; stop = true; await loop;
const raceTrace = trace.filter(x => x.phase === 'race');
const kd = await page.evaluate(() => window.__kd);
const firstUpAny = trace.find(x => x.up === 1), firstUp = raceTrace.find(x => x.up === 1), firstMove = raceTrace.find(x => x.speedKmh > 0);
const srvSlot = rs.sim.racers.findIndex(x => x.id === pageId);
console.log(JSON.stringify({ slot, N, MODE, keydownIssuedPageMs: issuedAt, keydownHandledPageMs: kd, serverFirstUpSimT: firstUp ? firstUp.simT : null, keyToServerUpS: firstUpAny ? +(firstUpAny.t - tDownNode).toFixed(2) : null, phaseAtKeydown: (trace.filter(x => x.t <= tDownNode).pop() || {}).phase, simTAtKeydown: (trace.filter(x => x.t <= tDownNode).pop() || {}).simT, serverFirstMoveSimT: firstMove ? firstMove.simT : null, finalServerKmh: raceTrace.length ? raceTrace[raceTrace.length - 1].speedKmh : null, pageId, gridIndex: srvSlot, raceStartWaitS: +raceAt.toFixed(1), pageErrors: errs.length, consoleWarn: cons.slice(0, 5), pageSamples: pinfo, serverTraceRace: raceTrace.filter((_, i) => i % 4 === 0) }, null, 1));
for (const c of cl) c.leave(); await browser.close(); await srv.close(); process.exit(0);
