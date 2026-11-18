// Multiplayer finish announcement. The server's finish order (snapshot `fo`) lags the local prediction by
// lead + half the round trip, so at the moment our prediction crosses the line it almost never lists us
// (M6 repro: tests/m6/finish-pos.mjs, fo was [] for both racers). Before M6 the page used
// fo.indexOf(me) + 1 there, i.e. 0 -> a winner never saw VICTORY. Now: FINISH at once, then VICTORY only
// when the server confirms P1 (a photo finish decided by 0.07 s must not be claimed by the loser).
// Returns null while unknown, 'VICTORY' when the server lists us first, 'PLACED' when it lists us later.
export function finishAnnounce(fo, me) { const i = (fo || []).indexOf(me); return i < 0 ? null : i === 0 ? 'VICTORY' : 'PLACED'; }
