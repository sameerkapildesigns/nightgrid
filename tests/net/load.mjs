// Event load test: N simultaneous private rooms x 4 human racers (headless NetClients over real
// WebSockets) against ONE local room-server process, plus a capacity check that room N+1 is refused
// with the quota/capacity message. Measures server tick cost per room, process CPU, event-loop lag,
// incoming/outgoing messages and bytes, and client correction stats. Localhost: no internet latency
// unless --lag is given (RTT, half each way). Headless clients: no rendering.
// Usage: node tests/net/load.mjs [--rooms 5] [--seconds 60] [--lag 100]  -> docs/evidence/m4/load-*.json
import { writeFileSync, mkdirSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { startLocalServer } from '../../server/local.mjs';
import { scenario, summarize } from './scenario.mjs';

const a = process.argv.slice(2), arg = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? +a[i + 1] : d; };
const ROOMS = arg('rooms', 5), SECONDS = arg('seconds', 60), LAG = arg('lag', 100);
const srv = await startLocalServer({ port: 0, netsim: true, lagMs: LAG, log: false, createPerMin: 1000, budget: { maxActiveRooms: ROOMS }, room: { countdownMs: 3000, maxRaceMs: (SECONDS + 30) * 1000 } });
const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable();
const cpu0 = process.cpuUsage(), t0 = performance.now(), mem0 = process.memoryUsage().rss;
const runs = Array.from({ length: ROOMS }, (_, i) => scenario({ server: srv, humans: 4, bots: 0, map: ['technical', 'velocity', 'legacy'][i % 3], lagMs: LAG, raceSeconds: SECONDS }));
// once all rooms exist, one more room must be refused (capacity / quota guard)
await new Promise(r => setTimeout(r, 4000));
const extra = await fetch(srv.url + '/api/rooms', { method: 'POST' }).then(async r => ({ status: r.status, ...(await r.json()) }));
const out = await Promise.all(runs);
const wall = (performance.now() - t0) / 1000, cpu = process.cpuUsage(cpu0); loop.disable();
const all = out.flatMap(r => r.clients);
const corr = all.flatMap(c => c.corrections ? [c.corrections.p95] : []);
const report = {
  when: new Date().toISOString(), rooms: ROOMS, humansPerRoom: 4, raceSeconds: SECONDS, rttMs: LAG, wallS: +wall.toFixed(1),
  note: 'ONE Node process hosts all rooms and the 20 headless clients (clients share the CPU). In production each room is its own Durable Object.',
  extraRoom: extra,
  processCpu: { userS: +(cpu.user / 1e6).toFixed(1), systemS: +(cpu.system / 1e6).toFixed(1), utilisationOfOneCore: +(((cpu.user + cpu.system) / 1e6) / wall).toFixed(3) },
  eventLoopLagMs: { p50: +(loop.percentile(50) / 1e6).toFixed(2), p99: +(loop.percentile(99) / 1e6).toFixed(2), max: +(loop.max / 1e6).toFixed(2) },
  rssMB: { start: Math.round(mem0 / 1048576), end: Math.round(process.memoryUsage().rss / 1048576) },
  perRoomServer: out.map(r => ({ map: r.map, ...r.server })),
  clientsAggregate: { n: all.length, correctionP95Max: Math.max(...corr), correctionP95Median: summarize(corr).median, over1mTotal: all.reduce((s, c) => s + (c.corrections ? c.corrections.over1m : 0), 0), hardSnaps: all.reduce((s, c) => s + c.hardSnaps, 0), resyncs: all.reduce((s, c) => s + c.resyncs, 0), maxPending: Math.max(...all.map(c => c.maxPending)),
    upMsgsPerSPerClient: summarize(all.map(c => c.upMsgsPerS)), upBytesPerSPerClient: summarize(all.map(c => c.upBytesPerS)), downMsgsPerSPerClient: summarize(all.map(c => c.downMsgsPerS)), downBytesPerSPerClient: summarize(all.map(c => c.downBytesPerS)) },
  views: out.map(r => r.authoritative)
};
mkdirSync('docs/evidence/m4', { recursive: true });
const f = `docs/evidence/m4/load-${ROOMS}rooms-${SECONDS}s-rtt${LAG}.json`; writeFileSync(f, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ extraRoom: report.extraRoom, processCpu: report.processCpu, eventLoopLagMs: report.eventLoopLagMs, rss: report.rssMB, tick: report.perRoomServer.map(s => [s.tickMs.median, s.tickMs.p95, s.overruns, s.lateTicks, s.starvedFrames]), clients: report.clientsAggregate }, null, 1));
console.log('wrote', f); await srv.close();
