// Focused R4.1 regression: desktop setup may scroll, but Race must stay on screen.
// Run: node tests/e2e/menu-viewport.mjs
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch } from './harness.mjs';
const out = process.env.NG_EVIDENCE_DIR || 'test-results/menu-viewport';
mkdirSync(out, { recursive: true });
const server = await createServer({ mode: 'test', server: { host: '127.0.0.1', port: 4191, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await launch();
const results = [];
try {
 const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
 const errors = []; page.on('pageerror', e => errors.push(e.message));
 await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
 await page.goto('http://127.0.0.1:4191/');
 await page.waitForFunction(() => window.NG_DEBUG?.state === 'title' && document.getElementById('go').textContent === 'Race' && !document.getElementById('go').disabled, null, { timeout: 120000 });
 const inspect = () => page.evaluate(() => {
  const inView = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth + .5 && r.bottom <= innerHeight + .5; };
  const go = document.getElementById('go'), options = document.querySelector('.goptions'), bar = document.getElementById('gBar');
  const r = go.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2);
  return { viewport: [innerWidth, innerHeight], raceVisible: inView(go), raceHit: hit === go || go.contains(hit), raceBox: {x:r.x,y:r.y,width:r.width,height:r.height}, optionsOverflow: options.scrollWidth > options.clientWidth + 1, barOverflow: bar.scrollWidth > bar.clientWidth + 1, allMapsVisible: [...document.querySelectorAll('#maps button')].every(inView), optionsScroll: options.scrollHeight > options.clientHeight + 1 };
 });
 for (const [width, height] of [[1280,700],[1366,768],[1440,800],[1024,700],[960,540],[960,400],[960,300]]) {
  await page.setViewportSize({ width, height });
  await page.evaluate(() => document.querySelector('.goptions').scrollTop = 0);
  let r = await inspect();
  if (!r.raceVisible || !r.raceHit || r.optionsOverflow || r.barOverflow || (height >= 540 && !r.allMapsVisible)) throw Error(JSON.stringify(r));
  await page.screenshot({ path: `${out}/${width}x${height}.png` });
  await page.evaluate(() => { const el = document.querySelector('.goptions'); el.scrollTop = el.scrollHeight; });
  const scrolled = await inspect();
  if (!scrolled.raceVisible || !scrolled.raceHit) throw Error('Race lost after setup scroll: ' + JSON.stringify(scrolled));
  results.push(r); console.log('PASS', JSON.stringify(r));
 }
 await page.setViewportSize({ width:1366, height:768 });
 await page.click('#go');
 await page.waitForFunction(() => ['intro','countdown','race'].includes(NG_DEBUG.state), null, {timeout:60000});
 if(errors.length) throw Error(errors.join('\n'));
 results.push({ startRace: true, pageErrors: errors });
 await page.close();
 for(const [width,height] of [[844,390],[390,844]]){
  const ctx=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true});
  const p=await ctx.newPage();
  await p.route(/fonts\.(googleapis|gstatic)\.com/,r=>r.abort());
  await p.goto('http://127.0.0.1:4191/');
  await p.waitForFunction(() => window.NG_DEBUG?.state === 'title' && !document.getElementById('go').disabled, null, { timeout:120000 });
  const touch=await p.evaluate(()=>({touch:document.body.classList.contains('touchmode'),wrapper:getComputedStyle(document.querySelector('.goptions')).display}));
  if(!touch.touch || touch.wrapper!=='contents')throw Error('Touch layout changed');
  await p.screenshot({path:`${out}/touch-${width}x${height}.png`});
  results.push({viewport:[width,height],...touch});
  await ctx.close();
 }
 writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));
} finally { await browser.close(); await server.close(); }
