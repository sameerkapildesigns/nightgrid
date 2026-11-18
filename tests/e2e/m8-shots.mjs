// M8 visual evidence: deterministic screenshots of obstacles, pads, shield and taxi traffic per map
// (software WebGL / SwiftShader: image content only, frame rates are NOT hardware evidence).
// Usage: node tests/e2e/m8-shots.mjs <distDir> <outPrefix> [port]
// Works on builds without hazards too (RC20 "before"): spots then fall back to the same track metres.
import { preview } from 'vite';
import { launch, openGame, realErrors } from './harness.mjs';
const [dir, prefix, port = '4174', only = 'velocity,technical,legacy', kinds = 'obstacle,pad,taxi', vp = '1280x720'] = process.argv.slice(2);
const [VW, VH] = vp.split('x').map(Number), TOUCH = VH < 500;
const srv = await preview({ root: process.cwd(), build: { outDir: dir }, preview: { port: +port, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
const b = await launch();
const { page, logs } = await openGame(b, { width: VW, height: VH, query: TOUCH ? '?touch' : '', ctxOpts: TOUCH ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {} });
await page.waitForFunction(() => document.getElementById('go').textContent === 'Race' && !document.getElementById('go').disabled, null, { timeout: 180000 });
// fixed track spots so before/after builds frame the same metres (taken from the M8 layout)
const SPOTS = { velocity: { obstacle: 794, pad: 363, taxi: 1100 }, technical: { obstacle: 463, pad: 826, taxi: 1000 }, legacy: { obstacle: 832, pad: 2287, taxi: 600 } };
const out = [];
for (const map of only.split(',')) {
  if (await page.evaluate(() => NG_DEBUG.state) !== 'title') await page.evaluate(() => NG_DEBUG.qa.exit());
  await page.evaluate(() => __ng.manualClock(true));
  if (await page.evaluate(() => NG_DEBUG.map.key) !== map) { await page.evaluate(k => document.querySelector(`[data-map="${k}"]`).click(), map); await page.waitForFunction(k => NG_DEBUG.map.key === k && document.getElementById('go').textContent === 'Race', map, { timeout: 180000 }); }
  await page.evaluate(() => document.getElementById('go').click());
  await page.waitForFunction(() => NG_DEBUG.state === 'intro', null, { timeout: 60000 });
  await page.keyboard.press('Enter'); await page.evaluate(() => __ng.sim(3.4));
  for (const [kind, s] of Object.entries(SPOTS[map]).filter(([k]) => kinds.split(',').includes(k))) {
    const info = await page.evaluate(([kind, s]) => {
      const S = __ng.simCore, p = __ng.player, M = __ng.MAIN, L = M.L;
      const ob = (S.obstacles || [])[0], pads = S.pads || [];
      let tgt = s, d = 0;
      if (kind === 'obstacle' && ob) { const o = S.obstacles.reduce((a, x) => (Math.abs(x.s - s) < Math.abs(a.s - s) ? x : a)); tgt = o.s; d = 0; }
      if (kind === 'pad' && pads.length) tgt = pads.reduce((a, x) => (Math.abs(x.s - s) < Math.abs(a.s - s) ? x : a)).s;
      if (kind === 'taxi') { const dr = __ng.drones.reduce((a, x) => (Math.abs(((x.s - s) % L + L) % L) < Math.abs(((a.s - s) % L + L) % L) ? x : a)); tgt = dr.s; d = dr.d + 3.2; for (const x of __ng.drones) x.speed = 0; }
      const back = kind === 'taxi' ? 12 : 34;
      p.s = ((tgt - back) % L + L) % L; p.d = d; p.va = 0; p.vd = 0; p.psi = 0; p.prevS = undefined; p.h = 1;
      p.shieldT = kind === 'pad' ? 9 : 0;   // show the bubble on the own car in the pad shot
      S.pose(p); return { tgt: Math.round(tgt), d: +d.toFixed(1), hazards: !!S.hazards, obstacles: (S.obstacles || []).length, pads: pads.length };
    }, [kind, s]);
    await page.evaluate(() => __ng.sim(0.5));
    await page.evaluate(() => { const r = __ng.renderer; r.info.reset(); __ng.render(); });
    const ri = await page.evaluate(() => ({ calls: __ng.renderer.info.render.calls, tris: __ng.renderer.info.render.triangles }));
    const f = `${prefix}-${map}-${kind}.jpg`;
    await page.screenshot({ path: f, type: 'jpeg', quality: 82 });
    out.push({ map, kind, ...info, ...ri, file: f });
    console.log(JSON.stringify(out[out.length - 1]));
  }
}
console.log('errors', JSON.stringify(realErrors(logs)));
await b.close(); srv.httpServer.close();
