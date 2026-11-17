// Shared Playwright harness. Serves nothing itself: point it at a running `vite preview`.
// Chromium runs with SwiftShader (software WebGL), so frame rates are far below real GPUs.
import { chromium } from 'playwright';
export const BASE = process.env.NG_BASE || 'http://127.0.0.1:4174/';
export async function launch() {
  return chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
}
// Opens the game; blocks third-party font requests (offline, deterministic).
export async function openGame(browser, { width = 1280, height = 675, query = '', ctxOpts = {}, waitTitle = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, ...ctxOpts });
  const page = await ctx.newPage();
  const logs = [], requests = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
  page.on('requestfinished', async r => { try { const s = await r.sizes(); requests.push({ url: r.url(), bytes: s.responseBodySize, t: Date.now() }); } catch (e) { } });
  await page.route('**/*', r => { const u = r.request().url(); if (/fonts\.(googleapis|gstatic)\.com/.test(u)) return r.abort(); return r.continue(); });
  await page.goto(BASE + query);
  if (waitTitle) await page.waitForFunction(() => window.NG_DEBUG && NG_DEBUG.state === 'title', null, { timeout: 180000 });
  return { ctx, page, logs, requests };
}
export const realErrors = logs => logs.filter(l => !/GL Driver|ERR_FAILED|GPU stall|swiftshader|WebGL|fonts\.g/i.test(l));
export function check(results, name, ok, detail = '') { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); }
