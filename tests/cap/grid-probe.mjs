// 20-car grid probe: 1 real Chromium page (host) + 19 headless NetClients on the local server.
// Measures on the packed grid (countdown) and 6 s into the race: draw calls, tris, labels/LOD (if present),
// page errors, screenshots. SwiftShader: calls/tris are renderer-independent; FPS is NOT hardware evidence.
// Usage (run from the repo dir): node grid-probe.mjs <tag> [n=20]
const tag = process.argv[2] || 'x', N = +(process.argv[3] || 20), cwd = process.cwd();
const { startLocalServer } = await import(cwd + '/server/local.mjs');
const { NetClient } = await import(cwd + '/src/net/client.js');
const { driver, waitFor } = await import(cwd + '/tests/net/scenario.mjs');
const { launch } = await import(cwd + '/tests/e2e/harness.mjs');
const WebSocket = (await import(cwd + '/node_modules/ws/index.js')).default;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const srv = await startLocalServer({ port: 0, dist: 'dist-test', netsim: true, lagMs: 50, log: false, createPerMin: 1000, budget: { maxActiveRooms: 4 }, room: { countdownMs: 20000, maxRaceMs: 600000 } });
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } }); const page = await ctx.newPage(); page.setDefaultTimeout(300000);
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.route('**/*', r => /fonts\.(googleapis|gstatic)\.com/.test(r.request().url()) ? r.abort() : r.continue());
await page.goto(srv.url + '/'); await page.waitForFunction(() => window.NG_DEBUG && NG_DEBUG.state === 'title');
// BACK-ROW view (worst case): a Node client hosts (seat 0), 18 more join, the browser joins LAST (seat 19)
const code = (await (await fetch(srv.url + '/api/rooms', { method: 'POST' })).json()).code;
const cl = []; for (let i = 0; i < N - 1; i++) { const c = new NetClient({ wsUrl: srv.url.replace('http', 'ws'), WebSocketImpl: WebSocket, now: () => performance.now(), build: srv.build, name: 'Racer' + i, onEvent: () => { } }); c.drive = driver(i + 1); c.connect(code); cl.push(c); await waitFor(() => c.you, 20000); c.ready(true); }
await page.click('#mpBtn'); await page.fill('#mpName', 'Back'); await page.fill('#mpCode', code.toLowerCase()); await page.click('[data-act=join]');
// autodrive AFTER join: set before, mpNet() posts it before 'connect' creates the worker loop and it is dropped
// (M7 diagnosis: that ordering caused the back-row 0 km/h; real held ArrowUp drives normally)
await page.evaluate(() => __ng.mpAutodrive(true));
await page.waitForFunction(k => NG_DEBUG.mp.room && NG_DEBUG.mp.room.seats.length === k, N); await page.click('[data-act=ready]');
await waitFor(() => cl[0].room && cl[0].room.canStart, 30000); cl[0].start();
let stop = false; const loop = (async () => { while (!stop) { for (const c of cl) if (c.race) { c.frame(c.drive(c.race.pred)); c.race.pred.decay(0.033); } await sleep(33); } })();
const grab = async label => { await sleep(4000); const r = await page.evaluate(() => ({ state: NG_DEBUG.state, render: NG_DEBUG.render, crowd: NG_DEBUG.crowd || null, racers: NG_DEBUG.mp.racers.length })); await page.screenshot({ path: `/home/claude/m7-export/probe-${tag}-${label}.jpg`, type: 'jpeg', quality: 72 }); return { label, state: r.state, calls: r.render.calls, tris: r.render.triangles, racers: r.racers, crowd: r.crowd && { labels: r.crowd.labels, full: r.crowd.full, lite: r.crowd.lite, far: r.crowd.far } }; };
await page.waitForFunction(() => NG_DEBUG.state === 'countdown' || NG_DEBUG.state === 'intro', null, { timeout: 120000 });
await page.waitForFunction(() => NG_DEBUG.state === 'countdown', null, { timeout: 120000 }).catch(() => {});
const out = [await grab('grid')];
await page.waitForFunction(() => NG_DEBUG.state === 'race', null, { timeout: 120000 }); await sleep(6000);
out.push(await grab('race6s'));
stop = true; await loop; for (const c of cl) c.leave();
console.log(JSON.stringify({ tag, N, out, pageErrors: errs.length, firstErr: errs[0] || null }));
await browser.close(); await srv.close(); process.exit(0);
