// Headless: 20 NetClients (shipping netcode + line driver) in one local room; does every seat (incl. back row) move?
const cwd = process.cwd();
const { startLocalServer } = await import(cwd + '/server/local.mjs');
const { NetClient } = await import(cwd + '/src/net/client.js');
const { driver, waitFor } = await import(cwd + '/tests/net/scenario.mjs');
const WebSocket = (await import(cwd + '/node_modules/ws/index.js')).default;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const srv = await startLocalServer({ port: 0, dist: 'dist-test', netsim: true, lagMs: 50, log: false, createPerMin: 1000, budget: { maxActiveRooms: 4 }, room: { countdownMs: 3000, maxRaceMs: 600000 } });
const code = (await (await fetch(srv.url + '/api/rooms', { method: 'POST' })).json()).code;
const cl = []; for (let i = 0; i < 20; i++) { const c = new NetClient({ wsUrl: srv.url.replace('http', 'ws'), WebSocketImpl: WebSocket, now: () => performance.now(), build: srv.build, name: 'R' + i, onEvent: () => { } }); c.drive = driver(i); c.connect(code); cl.push(c); await waitFor(() => c.you, 20000); c.ready(true); }
await waitFor(() => cl[0].room && cl[0].room.canStart, 30000); cl[0].start();
let stop = false; const loop = (async () => { while (!stop) { for (const c of cl) if (c.race) { c.frame(c.drive(c.race.pred)); c.race.pred.decay(0.033); } await sleep(33); } })();
await waitFor(() => cl.every(c => c.race), 30000); await sleep(12000);
const rs = srv.rooms.get(code), sim = rs.sim || rs.room && rs.sim;
const rows = (sim ? sim.racers : []).map(r => [r.id, Math.round(r.d * 10) / 10, Math.round(r.speed * 3.6), Math.round(r.prog)]);
console.log(JSON.stringify(rows));
stop = true; await loop; for (const c of cl) c.leave(); await srv.close(); process.exit(0);
