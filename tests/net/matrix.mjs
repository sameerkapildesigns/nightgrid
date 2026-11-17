// Network test matrix (gate 5). Real WebSockets over localhost with artificial delay injected by the
// local runtime's netsim (server/local.mjs): lagMs is the ROUND-TRIP time (half added each direction),
// jitter is +-jitter/2 per direction, delivery stays in order (TCP semantics).
// Usage: node tests/net/matrix.mjs [--quick]  -> docs/evidence/m4/net-matrix.json + .md
import { writeFileSync, mkdirSync } from 'node:fs';
import { scenario } from './scenario.mjs';

const quick = process.argv.includes('--quick'), S = quick ? 8 : 20;
const CASES = [
  { name: 'RTT 50 ms, 2h+2b', humans: 2, bots: 2, lagMs: 50 },
  { name: 'RTT 100 ms, 2h+2b', humans: 2, bots: 2, lagMs: 100 },
  { name: 'RTT 200 ms, 2h+2b', humans: 2, bots: 2, lagMs: 200 },
  { name: 'RTT 100 ms + 20 ms jitter, 2h+2b', humans: 2, bots: 2, lagMs: 100, jitterMs: 20 },
  { name: 'RTT 100 ms, 500 ms outage at 8 s', humans: 2, bots: 2, lagMs: 100, outageAtS: Math.min(8, S / 2), outageMs: 500 },
  { name: 'RTT 100 ms, client 2 disconnect at 6 s + auto-reconnect', humans: 2, bots: 2, lagMs: 100, disconnectAtS: Math.min(6, S / 2) },
  { name: 'RTT 100 ms, 4 humans', humans: 4, bots: 0, lagMs: 100 },
  { name: 'RTT 100 ms, 1h+3b', humans: 1, bots: 3, lagMs: 100 }
];
const out = [];
for (const c of CASES) {
  const t0 = Date.now(); const r = await scenario({ raceSeconds: S, map: 'technical', ...c });
  const row = { name: c.name, ...r }; out.push(row);
  const cl = r.clients;
  console.log(`${c.name}: corr p95 ${cl.map(x => x.corrections && x.corrections.p95 != null ? x.corrections.p95.toFixed(3) : '-').join('/')} m, >1m ${cl.map(x => x.corrections ? x.corrections.over1m : '-').join('/')}, snapAge p95 ${cl.map(x => Math.round(x.snapAgeMs.p95)).join('/')} ms, pendingMax ${cl.map(x => x.maxPending).join('/')}, overruns ${r.server.overruns}, starved ${r.server.starvedFrames} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
mkdirSync('docs/evidence/m4', { recursive: true });
writeFileSync('docs/evidence/m4/net-matrix.json', JSON.stringify({ when: new Date().toISOString(), raceSeconds: S, map: 'technical', note: 'lagMs = round-trip; headless clients (no rendering); localhost + injected delay', cases: out }, null, 1));
const f = (x, d = 2) => x == null ? '-' : (+x).toFixed(d);
let md = '| Case | Client | RTT est. | Lead (steps) | Mispredict median / p95 (m) | >1 m | Corrections/s | Snapshot age p50/p95 (ms) | Max pending | Interp underruns | Up msg/s, B/s | Down msg/s, B/s |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n';
for (const r of out) for (const c of r.clients) md += `| ${r.name} | ${c.you} | ${f(c.rttMs, 0)} | ${c.lead} | ${c.corrections ? f(c.corrections.median, 3) + ' / ' + f(c.corrections.p95, 3) : '-'} | ${c.corrections ? c.corrections.over1m : '-'} | ${c.corrections ? c.corrections.perS : '-'} | ${f(c.snapAgeMs.median, 0)} / ${f(c.snapAgeMs.p95, 0)} | ${c.maxPending} | ${c.interpUnderruns} | ${c.upMsgsPerS}, ${c.upBytesPerS} | ${c.downMsgsPerS}, ${c.downBytesPerS} |\n`;
md += '\n| Case | Server tick p50/p95/max (ms) | Overruns | Late ticks | Dropped sim ms | Starved frames | Skipped frames | Rejected |\n|---|---|---|---|---|---|---|---|\n';
for (const r of out) { const s = r.server; md += `| ${r.name} | ${f(s.tickMs.median, 3)} / ${f(s.tickMs.p95, 3)} / ${f(s.tickMs.max, 3)} | ${s.overruns} | ${s.lateTicks} | ${s.droppedMs} | ${s.starvedFrames} | ${s.skippedFrames} | ${JSON.stringify(s.rejected)} |\n`; }
writeFileSync('docs/evidence/m4/net-matrix.md', md);
console.log('wrote docs/evidence/m4/net-matrix.{json,md}');
