// M6 repro: what position does the client's local-finish path (game.js mpLocalFinish) compute at the
// moment its own prediction first reports `finished`? It reads the last snapshot's finish order (fo).
// Full race, 2 humans, 100 ms RTT. Prints JSON: per client {localFinishFoIncludesMe, oldPos, newPos, serverPos}.
import { scenario } from '../net/scenario.mjs';
import { finishAnnounce } from '../../src/client/finish-pos.js';
const seen = new Map();
const r = await scenario({ humans: 2, bots: 0, lagMs: +(process.env.LAG || 100), jitterMs: 10, full: true, onFrame: c => {
  const fo = c.race.last ? c.race.last.fo : [];
  if (!seen.has(c.you)) { if (!c.race.pred.me.finished) return; seen.set(c.you, { fo: fo.slice(), foIncludesMe: fo.includes(c.you), oldPos: fo.indexOf(c.you) + 1, announced: null }); }
  const s = seen.get(c.you); if (!s.announced) s.announced = finishAnnounce(fo, c.you);
} });
const order = r.results[0].split(' ').map(x => x.split(':'));
const out = [...seen].map(([id, v]) => ({ id, ...v, oldVictory: v.oldPos === 1, newVictory: v.announced === 'VICTORY', serverPos: +order.find(o => o[1] === id)[0] }));
console.log(JSON.stringify({ results: r.results, clients: out }, null, 1));
