// M6 capacity prototype: results overlay with N rows in a phone landscape viewport (844x390 touch) and
// desktop. Fills #resTable like mpShowResults (N rows), shows the MP results card, then checks: last row
// reachable by scrolling the table, BACK button inside the viewport and hit-testable. Layout only.
import { launch } from '../e2e/harness.mjs';
import { startLocalServer } from '../../server/local.mjs';
const srv = await startLocalServer({ port: 0, dist: 'dist-test', log: false });
const b = await launch(); let fails = 0;
for (const [w, h, touch] of (process.env.NG_QUICK ? [[844, 390, true]] : [[844, 390, true], [667, 375, true], [1280, 720, false]])) for (const n of [4, 12, 20]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch }); const p = await ctx.newPage();
  await p.route('**/*', r => /fonts\.(googleapis|gstatic)\.com/.test(r.request().url()) ? r.abort() : r.continue());
  await p.goto(srv.url + '/' + (touch ? '?touch' : ''), { timeout: 240000 }); await p.waitForFunction(() => window.NG_DEBUG && NG_DEBUG.state === 'title', null, { timeout: 240000 });
  const r = await p.evaluate(n => {
    document.body.classList.add('mprace'); const R = document.getElementById('results'); R.classList.remove('hide');
    let h = '<tr><th>POS</th><th>PILOT</th><th>BEST LAP</th><th>TIME</th></tr>'; for (let i = 1; i <= n; i++) h += `<tr><td>P${i}</td><td><span class="sw"></span>PLAYER ${i}</td><td>1:04.123</td><td>3:15.456</td></tr>`;
    document.getElementById('resTable').innerHTML = h; document.getElementById('resLaps').innerHTML = 'LAP 1 1:05.000 · LAP 2 1:04.900 · LAP 3 1:04.800<br><span>Multiplayer races never change single-player records.</span>';
    document.getElementById('toGarage').textContent = 'BACK TO LOBBY';
    const sc = document.getElementById('resScroll'); if (sc) sc.scrollTop = 1e6;
    const rows = document.querySelectorAll('#resTable tr'), last = rows[rows.length - 1].getBoundingClientRect(), bt = document.getElementById('toGarage').getBoundingClientRect();
    const hit = document.elementFromPoint(bt.x + bt.width / 2, bt.y + bt.height / 2), hitLast = document.elementFromPoint(last.x + 20, last.y + last.height / 2);
    return { vh: innerHeight, lastBottom: Math.round(last.bottom), backTop: Math.round(bt.top), backBottom: Math.round(bt.bottom), backHit: !!hit && (hit.id === 'toGarage' || hit.closest('#toGarage') !== null), lastRowHit: !!hitLast && !!hitLast.closest('#resTable tr:last-child') };
  }, n);
  const ok = r.backBottom <= r.vh && r.backHit && r.lastBottom <= r.vh && r.lastRowHit; if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${w}x${h} rows=${n}  ${JSON.stringify(r)}`);
  if (n === 20 && w === 844) await p.screenshot({ path: 'evidence/m6cap/results-20-844x390.jpg', type: 'jpeg', quality: 75 });
  await ctx.close();
}
await b.close(); await srv.close(); process.exit(fails ? 1 : 0);
