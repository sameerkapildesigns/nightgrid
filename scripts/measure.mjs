// Cold/warm startup + transfer measurement: v5b baseline vs M1 production build.
// Usage: npm run build && npm run measure [-- --runs 3]
//
// Conditions (stated in the output): headless Chromium (Playwright) with SwiftShader software
// WebGL, 1280x675, both sites served by the SAME local Node static server (no compression,
// `Cache-Control: no-cache` + ETag revalidation), Google Fonts requests aborted for both.
// "before" = reference/v5b-game.html with its expected ./models/<car>.glb.b64.txt files
// (generated here from the same original GLBs) and the three@0.170.0 CDN imports routed to
// the local node_modules copy (as v5b's own test harness did).
// "ready" = the garage "Race" button is enabled (same DOM criterion for both builds).
// These are local lab numbers, not user-device numbers and not acceptance targets.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, createReadStream } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';

const RUNS = +(process.argv.find(a => a.startsWith('--runs='))?.split('=')[1] || 3);
const SETTLE_MS = 25000;
const ROOT = resolve('.');
const CARS = ['hypercar', 'endurance', 'wedge', 'rally', 'streamliner', 'wipeout'];

// --- before site ---
const before = join(tmpdir(), 'nightgrid-v5b-site'); mkdirSync(join(before, 'models'), { recursive: true });
writeFileSync(join(before, 'index.html'), readFileSync('reference/v5b-game.html'));
for (const k of CARS) { const f = join(before, 'models', `${k}.glb.b64.txt`); if (!existsSync(f)) writeFileSync(f, readFileSync(`assets/models/${k}.glb`).toString('base64')); }
if (!existsSync('dist/index.html')) { console.error('run `npm run build` first'); process.exit(1); }

const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.json': 'application/json' };
function serve(dir, port) {
  return new Promise(res => {
    const s = createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
      const f = join(dir, p); if (!f.startsWith(dir) || !existsSync(f) || statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
      const st = statSync(f), etag = `"${st.size}-${Math.round(st.mtimeMs)}"`;
      if (req.headers['if-none-match'] === etag) { rsp.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' }); return rsp.end(); }
      rsp.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream', 'Content-Length': st.size, ETag: etag, 'Cache-Control': 'no-cache' });
      createReadStream(f).pipe(rsp);
    }).listen(port, '127.0.0.1', () => res(s));
  });
}
const sBefore = await serve(before, 4191), sAfter = await serve(resolve('dist'), 4192);
const SITES = { before: 'http://127.0.0.1:4191/', after: 'http://127.0.0.1:4192/' };
const threeDir = join(ROOT, 'node_modules/three/');

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
async function route(page) {
  await page.route('**/*', async r => {
    const u = r.request().url();
    if (u.includes('cdn.jsdelivr.net/npm/three@0.170.0/')) return r.fulfill({ path: threeDir + u.split('three@0.170.0/')[1], contentType: 'application/javascript' });
    if (/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net\/gh\//.test(u)) return r.abort();
    return r.continue();
  });
}
const sample = page => page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  const res = performance.getEntriesByType('resource');
  const local = res.filter(r => r.name.startsWith(location.origin));
  const sum = a => a.reduce((s, r) => s + (r.transferSize || 0), 0);
  const glb = local.filter(r => /\.glb/.test(r.name));
  return { transfer: (nav ? nav.transferSize : 0) + sum(local), glbTransfer: sum(glb), glbFiles: glb.map(r => r.name.split('/').pop().replace(/-[\w-]+\.glb$/, '.glb')), cdnRouted: res.filter(r => r.name.includes('jsdelivr')).length };
});
async function once(site, ctx) {
  const page = await ctx.newPage(); await route(page);
  const t0 = Date.now();
  await page.goto(SITES[site]);
  await page.waitForFunction(() => { const g = document.getElementById('go'); return g && !g.disabled && g.textContent.trim() === 'Race'; }, null, { timeout: 300000, polling: 50 });
  const readyMs = Date.now() - t0;
  const atReady = await sample(page);
  await page.waitForTimeout(SETTLE_MS);
  const settled = await sample(page);
  await page.close();
  return { readyMs, readyTransferMB: +(atReady.transfer / 1048576).toFixed(2), readyGlbMB: +(atReady.glbTransfer / 1048576).toFixed(2), readyModels: atReady.glbFiles, settledTransferMB: +(settled.transfer / 1048576).toFixed(2), settledModels: settled.glbFiles };
}
const med = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const out = { conditions: 'headless Chromium 1.63 (Playwright), SwiftShader software WebGL, 1280x675, 4 vCPU container, local Node static server on 127.0.0.1 (no compression, no-cache+ETag), fonts aborted', settleMs: SETTLE_MS, runs: RUNS, when: new Date().toISOString(), results: {} };
for (const site of ['before', 'after']) {
  const cold = [], warm = [];
  for (let i = 0; i < RUNS; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 675 } });
    cold.push(await once(site, ctx));
    warm.push(await once(site, ctx));   // same context: HTTP cache primed (ETag revalidation)
    await ctx.close();
    console.log(site, 'run', i + 1, JSON.stringify({ cold: cold[i], warm: warm[i] }));
  }
  const agg = arr => ({ readyMsMedian: med(arr.map(r => r.readyMs)), readyMsAll: arr.map(r => r.readyMs), readyTransferMBMedian: med(arr.map(r => r.readyTransferMB)), settledTransferMBMedian: med(arr.map(r => r.settledTransferMB)), readyModels: arr[0].readyModels, settledModels: arr[0].settledModels });
  out.results[site] = { cold: agg(cold), warm: agg(warm) };
}
await browser.close(); sBefore.close(); sAfter.close();
mkdirSync('docs', { recursive: true });
writeFileSync('docs/measurements.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.results, null, 2));
