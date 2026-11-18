// M6 CAPACITY PROTOTYPE: one real Chromium page (SwiftShader software GL) as host + (N-1) headless Node
// NetClients (shipping netcode, line-follower) in the same room on the local server. Measures what ONE
// player's browser pays to show N cars: draw calls, triangles, frame time (software GL: relative only,
// NOT phone FPS), render gaps, RTT, mispredict. Usage: node tests/cap/browser-probe.mjs --n 4,12,20
const { startLocalServer } = await import('../../server/local.mjs');
const { NetClient } = await import('../../src/net/client.js');
const { driver, waitFor } = await import('../net/scenario.mjs');
const { launch } = await import('../e2e/harness.mjs');
const WebSocket = (await import('ws')).default;
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const NS = arg('n', '4,12,20').split(',').map(Number), RACE_S = +arg('secs', 25);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const srv = await startLocalServer({ port: 0, dist: 'dist-test', netsim: true, lagMs: 60, log: false, createPerMin: 1000, budget: { maxActiveRooms: 6 }, room: { countdownMs: 8000, maxRaceMs: 600000 } });
const browser = await launch(); const out = [];
for (const n of NS) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } }); const page = await ctx.newPage(); page.setDefaultTimeout(240000);

  await page.route('**/*', r => /fonts\.(googleapis|gstatic)\.com/.test(r.request().url()) ? r.abort() : r.continue());
  await page.goto(srv.url + '/', { timeout: 240000 }); await page.waitForFunction(() => window.NG_DEBUG && NG_DEBUG.state === 'title', null, { timeout: 240000 });
  await page.click('#mpBtn'); await page.fill('#mpName', 'Host'); await page.click('[data-act=create]');
  await page.waitForFunction(() => NG_DEBUG.mp.inRoom); const code = await page.evaluate(() => NG_DEBUG.mp.code);
  const cl = []; for (let i = 1; i < n; i++) { const c = new NetClient({ wsUrl: srv.url.replace('http', 'ws'), WebSocketImpl: WebSocket, now: () => performance.now(), build: srv.build, name: 'N' + i, onEvent: () => { } }); c.drive = driver(i); c.connect(code); cl.push(c); await waitFor(() => c.you, 10000, 'welcome'); c.ready(true); }
  await page.evaluate(() => __ng.mpAutodrive(true));
  await page.waitForFunction(k => NG_DEBUG.mp.room && NG_DEBUG.mp.room.seats.length === k, n); await page.click('[data-act=ready]');
  await page.waitForFunction(() => NG_DEBUG.mp.room.canStart); await page.click('[data-act=start]');
  let stop = false; const loop = (async () => { while (!stop) { for (const c of cl) if (c.race) { c.frame(c.drive(c.race.pred)); c.race.pred.decay(0.033); } await sleep(33); } })();
  await page.waitForFunction(() => NG_DEBUG.state === 'race', null, { timeout: 120000 });
  await sleep(RACE_S * 1000);
  const r = await page.evaluate(() => { const m = NG_DEBUG.mp, rd = NG_DEBUG.render; return { calls: rd.calls, triangles: rd.triangles, programs: rd.programs, fps: rd.fps, renderGaps: m.renderGaps, rtt: m.rtt, mispredictP95: m.mispredictP95, hard: m.hard, racersDrawn: m.racers.length, bodies: [...new Set(m.racers.map(x => x.body))], heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null }; });
  await page.screenshot({ path: `evidence/m6cap/browser-${n}.jpg`, type: 'jpeg', quality: 70 });
  const rs = srv.rooms.get(code); r.serverTickP95 = rs ? +rs.stats.tickMs.slice().sort((a, b) => a - b)[Math.floor(rs.stats.tickMs.length * .95)].toFixed(2) : null;
  r.nodePeerCorrectionsP95 = cl.length ? Math.max(...cl.map(c => { const a = c.race ? c.race.pred.stats.corrections.slice(10).sort((x, y) => x - y) : []; return a.length ? a[Math.floor(a.length * .95)] : 0; })) : null;
  stop = true; await loop; for (const c of cl) c.leave(); if (rs) rs.closeRoom('test');
  out.push({ n, ...r }); console.log(JSON.stringify({ n, ...r }));
  await ctx.close();
}
await browser.close(); await srv.close();
