// M8 visual lane: matched before/after screenshots + render diagnostics for the environment themes.
// Usage: node tests/e2e/visual-shots.mjs <distDir> <outDir> [label]
// Deterministic: fixed sim seed, player on autopilot, fixed race times; same camera math before/after.
// SwiftShader (software GL): render ms are NOT hardware FPS; calls/triangles are the comparable numbers.
import { preview } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const [dir, out, label = 'shot'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const srv = await preview({ root: dir.replace(/\/dist-test$/, ''), build: { outDir: dir }, preview: { port: +(process.env.NG_PORT || 4176), strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
const b = await chromium.launch({ executablePath: process.env.NG_CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const maps = (process.env.NG_MAPS || 'velocity,technical,legacy').split(',');
const vps = [['desk', 1280, 720], ['mob', 844, 390]].filter(v => !process.env.NG_VPS || process.env.NG_VPS.split(',').includes(v[0]));
const report = {};
for (const [vp, w, h] of vps) for (const map of maps) {   // fresh page per map: sim state carries across map switches
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.route('**/*', r => /fonts\.(googleapis|gstatic)\.com/.test(r.request().url()) ? r.abort() : r.continue());
  await page.goto(`http://127.0.0.1:${process.env.NG_PORT || 4176}/`);
  await page.waitForFunction(() => window.NG_DEBUG && NG_DEBUG.state === 'title', null, { timeout: 180000 });
  await page.waitForFunction(() => document.getElementById('go').textContent === 'Race' && !document.getElementById('go').disabled, null, { timeout: 180000 });
  {
    if (await page.evaluate(() => NG_DEBUG.state) !== 'title') await page.evaluate(() => NG_DEBUG.qa.exit());
    await page.evaluate(() => __ng.manualClock(true));
    if (await page.evaluate(() => NG_DEBUG.map.key) !== map) { await page.evaluate(k => document.querySelector(`[data-map="${k}"]`).click(), map); await page.waitForFunction(k => NG_DEBUG.map.key === k && document.getElementById('go').textContent === 'Race', map, { timeout: 180000 }); }
    await page.evaluate(() => document.getElementById('go').click());
    await page.waitForFunction(() => NG_DEBUG.state === 'intro', null, { timeout: 60000 });
    await page.keyboard.press('Enter'); await page.evaluate(() => __ng.sim(3.4));
    await page.evaluate(() => { __ng.player.autopilot = true; });
    const rec = report[`${map}-${vp}`] = { shots: [] };
    let tPrev = 0;
    for (const t of [2, 9, 17]) {
      await page.evaluate(dt => __ng.sim(dt), t - tPrev); tPrev = t;
      const info = await page.evaluate(() => { __ng.render(); __ng.renderer.info.reset(); __ng.render(); const r = NG_DEBUG.render; const p = __ng.player; return { calls: r.calls, tris: r.triangles, s: Math.round(p.s), kmh: Math.round(p.speed * 3.6) }; });
      const f = `${out}/${label}-${map}-${vp}-chase${t}.jpg`;
      await page.screenshot({ path: f, type: 'jpeg', quality: 82 });
      rec.shots.push({ f, t, ...info });
    }
    // taxi (road traffic) close-up: camera behind/above the nearest drone ahead of the player, looking along the road
    const ti = await page.evaluate(() => {
      const d = __ng.drones[0], c = __ng.camera, M = __ng.MAIN, i = Math.round(d.s / M.ds) % M.N, T = M.T[i], U = M.U[i], R = M.R[i], P = d.world;
      c.position.set(P.x - T.x * 9 + U.x * 3.4 + R.x * 4, P.y - T.y * 9 + U.y * 3.4 + R.y * 4, P.z - T.z * 9 + U.z * 3.4 + R.z * 4); c.up.set(U.x, U.y, U.z); c.lookAt(P.x + T.x * 6, P.y + T.y * 6, P.z + T.z * 6);
      c.fov = 60; c.updateProjectionMatrix(); document.getElementById('hud').classList.remove('on');
      __ng.render(); __ng.renderer.info.reset(); __ng.render(); const r = NG_DEBUG.render; return { calls: r.calls, tris: r.triangles };
    });
    await page.screenshot({ path: `${out}/${label}-${map}-${vp}-taxi.jpg`, type: 'jpeg', quality: 82 });
    rec.taxi = ti;
    // elevated wide: skyline/landmarks read
    const wi = await page.evaluate(() => {
      const p = __ng.player.world, c = __ng.camera, M = __ng.MAIN, i = Math.round(__ng.player.s / M.ds) % M.N, T = M.T[i];
      c.position.set(p.x - T.x * 120, p.y + 70, p.z - T.z * 120); c.up.set(0, 1, 0); c.lookAt(p.x + T.x * 200, p.y + 10, p.z + T.z * 200);
      c.fov = 68; c.updateProjectionMatrix(); __ng.render(); __ng.renderer.info.reset(); __ng.render(); const r = NG_DEBUG.render; return { calls: r.calls, tris: r.triangles };
    });
    await page.screenshot({ path: `${out}/${label}-${map}-${vp}-wide.jpg`, type: 'jpeg', quality: 82 });
    rec.wide = wi;
    // render cost (software GL, same scene): ms per composer frame at the last chase pose
    rec.gfx = await page.evaluate(() => __ng.gfxProbe(4));
    rec.worldMeshes = await page.evaluate(() => NG_DEBUG.map.worldMeshes);
    console.log(map, vp, JSON.stringify({ shots: rec.shots.map(s => [s.t, s.calls, s.tris, s.kmh]), taxi: ti, wide: wi, gfx: rec.gfx }));
  }
  report[`errors-${map}-${vp}`] = errs;
  await ctx.close();
}
writeFileSync(`${out}/${label}-render.json`, JSON.stringify(report, null, 1));
await b.close(); srv.httpServer.close();
