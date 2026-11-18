// one line per client from tests/net/smooth.mjs JSON files
import { readFileSync } from 'node:fs';
for (const f of process.argv.slice(2)) {
  const o = JSON.parse(readFileSync(f, 'utf8'));
  for (const c of o.clients) console.log([f.split('/').pop().padEnd(28), c.you, 'rtt', c.rttMs, 'lead', c.leadMs + 'ms', 'snapGap95', c.snapGapMs.p95, 'gapErr50/95', c.displayedGapErrM.p50 + '/' + c.displayedGapErrM.p95,
    'closeErr50', c.closePassGapErrM.p50, 'hudFlips', c.hudRankFlips, 'true', c.trueRankFlips, 'wrongRank%', (100 * c.wrongRankFrames / Math.max(1, c.rankFrames)).toFixed(1),
    'ownCorr95/max', c.ownCorrectionM.p95 + '/' + c.ownCorrectionM.max, 'ownHard', c.ownHardSnaps, 'remJump99/max', c.remoteFrameJumpM.p99 + '/' + c.remoteFrameJumpM.max, '>1m', c.remoteJumpsOver1m, 'dv>20', c.remoteDvOver20, 'underr', c.interpUnderruns, c.results ? 'res ' + c.results : ''].join(' '));
  if (o.resultsAgree != null) console.log('  resultsAgree', o.resultsAgree, 'server', JSON.stringify(o.server));
}
