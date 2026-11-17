// M3-B rain occlusion: frozen camera + frozen weather, rain pixel count with shelter OFF (v5b
// behaviour) vs ON, at inverted / tunnel / open spots on each map. Writes test-results/rain.json
// and matched screenshots docs/screenshots/m3/rain-<spot>-{off,on}.jpg.
import { preview } from 'vite';
import { writeFileSync, mkdirSync } from 'node:fs';
import { launch, openGame } from './harness.mjs';
mkdirSync('docs/screenshots/m3', { recursive: true });
const srv = await preview({ build: { outDir: 'dist-test' }, preview: { port: 4174, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
const b = await launch();
const { page } = await openGame(b, { width: 640, height: 360 });
const out = [];
for (const map of ['velocity', 'legacy', 'technical']) {
  if (await page.evaluate(() => NG_DEBUG.state) !== 'title') await page.evaluate(() => NG_DEBUG.qa.exit());
  if (await page.evaluate(() => NG_DEBUG.map.key) !== map) { await page.evaluate(k => document.querySelector(`[data-map="${k}"]`).click(), map); await page.waitForFunction(k => NG_DEBUG.map.key === k && document.getElementById('go').textContent === 'Race', map, { timeout: 120000 }); }
  await page.waitForFunction(() => document.getElementById('go').textContent === 'Race' && !document.getElementById('go').disabled, null, { timeout: 120000 });
  await page.evaluate(() => __ng.manualClock(true)); await page.evaluate(() => document.getElementById('go').click());
  await page.waitForFunction(() => NG_DEBUG.state === 'intro', null, { timeout: 60000 }); await page.keyboard.press('Enter'); await page.evaluate(() => __ng.sim(3.4));
  const spots = await page.evaluate(() => { const M = __ng.MAIN, s = []; let inv = -1, tun = -1, open = -1;
    for (let i = 0; i < M.N; i++) { if (inv < 0 && M.U[i].y < -0.95) inv = i; if (tun < 0 && (M.tag[i] & 1)) tun = i + 40; if (open < 0 && M.U[i].y > 0.99 && M.P[i].y < 1 && i > 200 && __ng.shelterAt(M.P[i].x - M.T[i].x * 8, M.P[i].z - M.T[i].z * 8) < M.P[i].y + 2 && __ng.shelterAt(M.P[i].x + M.T[i].x * 20, M.P[i].z + M.T[i].z * 20) < M.P[i].y + 2) open = i; }
    if (inv >= 0) s.push(['inverted', inv + 30]); if (tun >= 0) s.push(['tunnel', tun]); if (open >= 0) s.push(['open', open]); return s; });
  for (const [kind, i] of spots) {
    const r = await page.evaluate(([i]) => {
      const M = __ng.MAIN, P = M.P[i], U = M.U[i], T = M.T[i], c = __ng.camera, rm = __ng.rainMat.uniforms;
      // chase-camera-like viewpoint on the car side of the deck: 2.6 m off the surface, 8 m back, looking ahead
      c.position.set(P.x + U.x * 2.6 - T.x * 8, P.y + U.y * 2.6 - T.y * 8, P.z + U.z * 2.6 - T.z * 8); c.up.set(U.x, U.y, U.z);
      c.lookAt(P.x + T.x * 20 + U.x * 1.5, P.y + T.y * 20 + U.y * 1.5, P.z + T.z * 20 + U.z * 1.5); c.updateMatrixWorld();
      rm.uTime.value = 123.4; rm.uCam.value.copy(c.position); rm.uVel.value.set(0, 0, 0);
      document.getElementById('hud').classList.remove('on'); for (const r of __ng.racers) if (r.ship) r.ship.root.visible = false;
      const gl = __ng.renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      const grab = () => { __ng.render(); const a = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, a); return a; };
      const count = (on) => { rm.uShelterOn.value = on; __ng.rain.visible = true; const A = grab(); __ng.rain.visible = false; const B = grab(); __ng.rain.visible = true; let n = 0; for (let k = 0; k < A.length; k += 4) if (Math.abs(A[k] - B[k]) + Math.abs(A[k + 1] - B[k + 1]) + Math.abs(A[k + 2] - B[k + 2]) > 12) n++; return n; };
      const off = count(0), on = count(1);
      const tm = (fn) => { fn(); __ng.render(); gl.finish(); const t = performance.now(); for (let k = 0; k < 8; k++) __ng.render(); gl.finish(); return +((performance.now() - t) / 8).toFixed(2); };
      const msShelterOn = tm(() => { rm.uShelterOn.value = 1; }), msShelterOff = tm(() => { rm.uShelterOn.value = 0; }), msRainHidden = tm(() => { __ng.rain.visible = false; }); __ng.rain.visible = true;
      return { off, on, px: W * H, msShelterOn, msShelterOff, msRainHidden, sheltTopAtCam: +(__ng.shelterAt(c.position.x, c.position.z)).toFixed(1), Uy: +U.y.toFixed(2), camSheltered: NG_DEBUG.rain.camSheltered };
    }, [i]);
    for (const on of [0, 1]) { await page.evaluate(v => { __ng.rainMat.uniforms.uShelterOn.value = v; __ng.render(); }, on); await page.screenshot({ path: `docs/screenshots/m3/rain-${map}-${kind}-${on ? 'on' : 'off'}.jpg`, type: 'jpeg', quality: 80 }); }
    out.push({ map, kind, i, ...r }); console.log(map, kind, i, JSON.stringify(r));
  }
  await page.evaluate(() => { for (const r of __ng.racers) if (r.ship) r.ship.root.visible = true; __ng.rainMat.uniforms.uShelterOn.value = 1; NG_DEBUG.qa.exit(); });
}
writeFileSync('test-results/rain.json', JSON.stringify(out, null, 2));
let fail = 0;
for (const r of out) {
  const ok = r.kind === 'open' ? r.on >= 0.8 * r.off && r.off > 1000 : r.off > 500 && r.on === 0;
  if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  rain ${r.map} ${r.kind}: rain pixels shelter OFF ${r.off} -> ON ${r.on}`);
}
console.log(`${out.length - fail}/${out.length} rain checks passed`); process.exitCode = fail ? 1 : 0;
await b.close(); srv.httpServer.close();
