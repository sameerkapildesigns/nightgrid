// Matched before/after screenshots of the worst ground-intersection sections (same camera math).
// Usage: node tests/e2e/ground-shots.mjs <distDir> <outPrefix>
import { preview } from 'vite';
import { launch, openGame } from './harness.mjs';
const [dir, prefix] = process.argv.slice(2);
const srv = await preview({ root: dir.replace(/\/dist-test$/, ''), build: { outDir: dir }, preview: { port: 4174, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
const b = await launch();
const spots = [['velocity', 3905, 'top'], ['velocity', 3905, 'drive'], ['velocity', 3935, 'inverted'], ['technical', 1481, 'top'], ['technical', 1481, 'drive'], ['legacy', 2443, 'top'], ['legacy', 2443, 'drive']];
const { page } = await openGame(b, { width: 960, height: 540 });
await page.waitForFunction(() => document.getElementById('go').textContent === 'Race' && !document.getElementById('go').disabled, null, { timeout: 120000 });
for (const [map, s, view] of spots) {
  if (await page.evaluate(() => NG_DEBUG.state) !== 'title') { await page.evaluate(() => NG_DEBUG.qa.exit()); }
  await page.evaluate(() => __ng.manualClock(true));
  if (await page.evaluate(() => NG_DEBUG.map.key) !== map) { await page.evaluate(k => document.querySelector(`[data-map="${k}"]`).click(), map); await page.waitForFunction(k => NG_DEBUG.map.key === k && document.getElementById('go').textContent === 'Race', map, { timeout: 120000 }); }
  await page.evaluate(() => document.getElementById('go').click());
  await page.waitForFunction(() => NG_DEBUG.state === 'intro', null, { timeout: 60000 });
  await page.keyboard.press('Enter'); await page.evaluate(() => __ng.sim(3.4));
  const info = await page.evaluate(([s, view]) => {
    const M = __ng.MAIN, i = Math.round(s / M.ds) % M.N, P = M.P[i], T = M.T[i], R = M.R[i], c = __ng.camera;
    const flat = (v) => { const n = Math.hypot(v.x, v.z) || 1; return { x: v.x / n, z: v.z / n }; };
    const t = flat(T), side = { x: -t.z, z: t.x };
    if (view === 'top') { c.position.set(P.x - t.x * 25, P.y + 75, P.z - t.z * 25); c.up.set(t.x, 0, t.z); c.lookAt(P.x, P.y, P.z); }
    else if (view === 'inverted') { const U = M.U[i]; c.position.set(P.x + U.x * 3.2, P.y + U.y * 3.2, P.z + U.z * 3.2); c.up.set(U.x, U.y, U.z); const k2 = (i + 60) % M.N, Q = M.P[k2]; c.lookAt(Q.x, Q.y, Q.z); }
    else { const j = (i - 70 + M.N) % M.N, Q = M.P[j], U = M.U[j]; c.position.set(Q.x + U.x * 3.2, Q.y + U.y * 3.2, Q.z + U.z * 3.2); c.up.set(U.x, U.y, U.z); c.lookAt(P.x, P.y, P.z); }
    c.fov = 70; c.updateProjectionMatrix();
    for (const r of __ng.racers) if (r.ship) r.ship.root.visible = false;
    document.getElementById('hud').classList.remove('on'); __ng.render(); return { i, y: +P.y.toFixed(2), Ry: +R.y.toFixed(2) };
  }, [s, view]);
  await page.screenshot({ path: `${prefix}-${map}-${s}-${view}.jpg`, type: 'jpeg', quality: 80 });
  console.log(map, s, view, JSON.stringify(info));
  await page.evaluate(() => { for (const r of __ng.racers) if (r.ship) r.ship.root.visible = true; });
}
await b.close(); srv.httpServer.close();
