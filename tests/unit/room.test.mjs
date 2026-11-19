import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../../src/core/room.js';
const B = 'build-abc';
const room = () => R.createRoom({ code: 'K7Q2MX', build: B });
const j = (r, name, t = 0) => R.join(r, { name, build: B }, t);

test('server-issued ids; first human is host; names are cleaned and bounded', () => {
  const r = room(); const a = j(r, '  <b>Sam</b>   K  '), b = j(r, 'x'.repeat(60));
  assert.equal(a.id, 'p1'); assert.equal(b.id, 'p2'); assert.equal(r.hostId, 'p1');
  assert.equal(r.seats[0].name, 'bSam/b K'); assert.equal(r.seats[1].name.length, R.NAME_MAX); assert.equal(R.cleanName(''), 'Player');
});
test('1 human + bots: bots auto-ready with matching personality/car, seat MAX_SEATS+1 rejected, start needs the human ready', () => {
  const r = room(); const h = j(r, 'h').id; for (let k = 0; k < 3; k++) assert.ok(R.addBot(r, h).ok);
  assert.deepEqual(r.seats.filter(s => s.kind === 'bot').map(s => [s.pers, s.car, s.ready]), [['GHOST', 'hypercar', true], ['VEX', 'wedge', true], ['BLITZ', 'endurance', true]]);
  while (r.seats.length < R.MAX_SEATS) assert.ok(R.addBot(r, h).ok);
  assert.equal(R.addBot(r, h).error, 'room-full'); assert.equal(r.seats.length, R.MAX_SEATS);
  assert.equal(R.canStart(r), false); assert.equal(R.startBlocker(r), 'not-all-ready');
  R.setReady(r, h, true); assert.equal(R.canStart(r), true);
  assert.ok(R.start(r, h, 1000, 123).ok); assert.equal(r.phase, 'countdown'); assert.equal(r.countdownAt, 4000);
});
test('minimum 2 racers: a lone ready human cannot start; a bot makes it startable', () => {
  const r = room(); const h = j(r, 'h').id; R.setReady(r, h, true);
  assert.equal(R.canStart(r), false); assert.equal(R.start(r, h, 0, 1).error, 'need-2-racers');
  R.addBot(r, h); assert.ok(R.start(r, h, 0, 1).ok);
});
test('mixed humans + bots up to MAX_SEATS; all-human room; seat MAX_SEATS+1 (human or bot) is rejected without breaking the room', () => {
  const r = room(); const h1 = j(r, 'a').id; j(r, 'b'); while (r.seats.length < R.MAX_SEATS) R.addBot(r, h1);
  assert.equal(j(r, 'c').error, 'room-full'); assert.equal(r.seats.length, R.MAX_SEATS);
  const q = room(); for (let k = 0; k < R.MAX_SEATS; k++) assert.ok(j(q, 'n' + k).ok);
  assert.equal(j(q, 'extra').error, 'room-full'); assert.equal(R.addBot(q, 'p1').error, 'room-full'); assert.equal(q.seats.length, R.MAX_SEATS);
});
test('host-only controls; settings change un-readies humans only when something changed; car change un-readies that seat', () => {
  const r = room(); const h1 = j(r, 'a').id, h2 = j(r, 'b').id;
  assert.equal(R.addBot(r, h2).error, 'not-host'); assert.ok(R.addBot(r, h1).ok);
  assert.equal(R.removeBot(r, h2, 'bot1').error, 'not-host'); assert.ok(R.removeBot(r, h1, 'bot1').ok); assert.equal(R.removeBot(r, h1, 'bot1').error, 'no-such-bot');
  R.setReady(r, h1, true); R.setReady(r, h2, true);
  assert.ok(R.configure(r, h1, { map: 'velocity', mode: 'expert' }).ok); assert.equal(r.seats.every(s => s.ready), true, 'no-op config keeps ready');
  assert.equal(R.configure(r, h2, { map: 'legacy' }).error, 'not-host');
  assert.ok(R.configure(r, h1, { map: 'legacy', mode: 'expert' }).ok); assert.equal(r.seats.some(s => s.ready), false);
  assert.equal(R.configure(r, h1, { map: 'moon' }).error, 'bad-map'); assert.equal(R.configure(r, h1, { mode: 'god' }).error, 'bad-mode');
  assert.equal(R.setCar(r, h2, 'z32s').error, 'bad-car'); assert.equal(R.setCar(r, h2, 'wedge', 9).error, 'bad-paint');
  R.setReady(r, h2, true); R.setCar(r, h2, 'hypercar', 2); assert.equal(r.seats[1].ready, true, 'paint-only change keeps ready');
  R.setCar(r, h2, 'wipeout', 2); assert.equal(r.seats[1].ready, false);
});
test('build mismatch and joining a running race are rejected', () => {
  const r = room(); assert.equal(R.join(r, { name: 'x', build: 'other' }, 0).error, 'build-mismatch');
  const h = j(r, 'h').id; R.addBot(r, h); R.setReady(r, h, true); R.start(r, h, 0, 1); assert.equal(j(r, 'late').error, 'race-in-progress');
});
test('reconnect within 15 s keeps the seat; after 15 s it expires (lobby: removed, race: left/DNF); host migrates deterministically', () => {
  const r = room(); const a = j(r, 'a').id, b = j(r, 'b').id; R.disconnect(r, a, 1000);
  assert.equal(r.hostId, b, 'lobby: host migrates to the next connected human at once');
  assert.ok(R.reconnect(r, a, 15999).ok); assert.equal(r.seats[0].connected, true); assert.equal(r.hostId, b, 'returning player does not steal host');
  R.disconnect(r, a, 20000); const t = R.tick(r, 35000); assert.deepEqual(t.changes, [['expired', a]]);
  assert.equal(r.seats.length, 1);
  const q = room(); const x = j(q, 'x').id, y = j(q, 'y').id; R.setReady(q, x, true); R.setReady(q, y, true); R.start(q, x, 0, 1); R.toRace(q);
  R.disconnect(q, y, 100); R.tick(q, 15100); assert.equal(q.seats.find(s => s.id === y).left, true); assert.equal(q.seats.length, 2);
  assert.equal(R.reconnect(q, y, 16000).error, 'seat-expired');
});
test('stale input release after 250 ms (race only); explicit leave in lobby frees the seat, in race marks DNF', () => {
  const q = room(); const a = j(q, 'a', 0).id; R.addBot(q, a); R.setReady(q, a, true); R.start(q, a, 0, 1); R.toRace(q);
  q.seats[0].lastInputAt = 1000; assert.deepEqual(R.tick(q, 1200).stale, []); assert.deepEqual(R.tick(q, 1300).stale, [a]);
  const r = room(); const h1 = j(r, 'a').id, h2 = j(r, 'b').id; R.leave(r, h1); assert.equal(r.seats.length, 1); assert.equal(r.hostId, h2);
  const s = room(); const u = j(s, 'u').id, v = j(s, 'v').id; R.setReady(s, u, true); R.setReady(s, v, true); R.start(s, u, 0, 1); R.toRace(s);
  R.leave(s, v); assert.equal(s.seats.length, 2); assert.equal(s.seats[1].left, true);
});
test('results -> lobby: departed seats dropped, humans must re-ready, bots stay ready', () => {
  const r = room(); const a = j(r, 'a').id, b = j(r, 'b').id; R.addBot(r, a); R.setReady(r, a, true); R.setReady(r, b, true);
  R.start(r, a, 0, 1); R.toRace(r); R.leave(r, b); R.toResults(r, []); R.toLobby(r);
  assert.equal(r.phase, 'lobby'); assert.deepEqual(r.seats.map(s => [s.id, s.ready]), [[a, false], ['bot1', true]]);
});
test('publicState exposes no tokens / private fields', () => {
  const r = room(); j(r, 'a'); const p = R.publicState(r); const keys = Object.keys(p.seats[0]).sort();
  assert.deepEqual(keys, ['car', 'connected', 'id', 'kind', 'left', 'name', 'paint', 'ready']);
  assert.ok(!JSON.stringify(p).includes('token'));
});
