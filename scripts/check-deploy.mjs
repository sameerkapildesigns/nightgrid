#!/usr/bin/env node
// Read-only deploy check (safe any time; creates nothing): does the Vercel frontend and the workers.dev
// backend run the same build, and does the backend's CORS allow exactly the frontend origin?
// Usage: node scripts/check-deploy.mjs --frontend https://nightgrid.sameerkapil.com --backend https://nightgrid-mp.<you>.workers.dev
const a = process.argv.slice(2), arg = k => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : null; };
const FRONT = (arg('frontend') || '').replace(/\/+$/, ''), BACK = (arg('backend') || '').replace(/\/+$/, '');
if (!FRONT || !BACK) { console.error('usage: --frontend <url> --backend <url>'); process.exit(2); }
const origin = new URL(FRONT).origin; let fails = 0;
const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  - ' + d : ''}`); if (!c) fails++; };
try {
  const fm = await fetch(FRONT + '/ng-build.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
  ok('frontend /ng-build.json present', !!fm, fm ? JSON.stringify(fm) : 'missing (M3 frontend has none: expected before the M4 frontend is deployed)');
  const hr = await fetch(BACK + '/api/health', { headers: { origin } }); const h = await hr.json().catch(() => ({}));
  ok('backend /api/health reachable', hr.ok, `${hr.status} build ${h.build}`);
  ok('backend allows the frontend origin (exact echo, no credentials)', hr.headers.get('access-control-allow-origin') === origin && !hr.headers.get('access-control-allow-credentials'), String(hr.headers.get('access-control-allow-origin')));
  if (fm) { ok('same build id frontend <-> backend', fm.build === h.build, `${fm.build} vs ${h.build}`); ok('frontend points at this backend', (fm.mpApiBase || '').replace(/\/+$/, '') === BACK, String(fm.mpApiBase)); }
  const pf = await fetch(BACK + '/api/rooms', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST' } });
  ok('preflight from the frontend origin -> 204', pf.status === 204, String(pf.status));
  const bad = await fetch(BACK + '/api/rooms', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
  ok('preflight from a foreign origin -> 403 without CORS header', bad.status === 403 && !bad.headers.get('access-control-allow-origin'), String(bad.status));
  if (h.budget) console.log(`INFO  budget today: ${JSON.stringify(h.budget)}`);
} catch (e) { ok('checks ran', false, e.message); }
process.exit(fails ? 1 : 0);
