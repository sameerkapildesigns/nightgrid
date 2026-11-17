import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../../src/core/room.js';
const B = 'build-abc';
const room = () => R.createRoom({ code: 'K7Q2', build: B });
const j = (r, id, t = 0) => R.join(r, { id, name: id, build: B }, t);

test('1 human + 3 bots: host fills seats, bots auto-ready, human readies, start', () => {
  const r = room(); assert.ok(j(r, 'h1').ok); for (let k = 0; k < 3; k++) assert.ok(R.addBot(r, 'h1').ok);
  assert.equal(R.addBot(r, 'h1').error, 'room-full');
  assert.equal(r.seats.filter(s => s.kind === 'bot').every(s => s.ready), true);
  assert.equal(R.canStart(r), false); R.setReady(r, 'h1', true); assert.equal(R.canStart(r), true);
  assert.ok(R.start(r, 'h1', 1000, 123).ok); assert.equal(r.phase, 'countdown'); assert.equal(r.countdownAt, 4000);
});
test('2 humans + 2 bots; 4 humans; a 5th (human or bot) is rejected', () => {
  const r = room(); j(r, 'h1'); j(r, 'h2'); R.addBot(r, 'h1'); R.addBot(r, 'h1');
  assert.equal(j(r, 'h3').error, 'room-full');
  const q = room(); for (const id of ['a', 'b', 'c', 'd']) assert.ok(j(q, id).ok);
  assert.equal(j(q, 'e').error, 'room-full'); assert.equal(R.addBot(q, 'a').error, 'room-full');
});
test('host-only controls; bots removable; settings change un-readies humans', () => {
  const r = room(); j(r, 'h1'); j(r, 'h2');
  assert.equal(R.addBot(r, 'h2').error, 'not-host'); assert.ok(R.addBot(r, 'h1').ok);
  assert.equal(R.removeBot(r, 'h2', 'bot1').error, 'not-host'); assert.ok(R.removeBot(r, 'h1', 'bot1').ok);
  R.setReady(r, 'h1', true); R.setReady(r, 'h2', true); assert.ok(R.configure(r, 'h1', { map: 'legacy', mode: 'expert' }).ok);
  assert.equal(r.seats.some(s => s.ready), false); assert.equal(R.configure(r, 'h1', { map: 'moon' }).error, 'bad-map');
  assert.equal(R.setCar(r, 'h2', 'z32s').error, 'bad-car'); assert.ok(R.setCar(r, 'h2', 'wipeout').ok);
});
test('build hash mismatch and joining a running race are rejected', () => {
  const r = room(); assert.equal(R.join(r, { id: 'x', build: 'other' }, 0).error, 'build-mismatch');
  j(r, 'h1'); R.setReady(r, 'h1', true); R.start(r, 'h1', 0, 1); assert.equal(j(r, 'late').error, 'race-in-progress');
});
test('reconnect within 15 s keeps the seat; after 15 s the seat expires (lobby: removed, race: DNF); host migrates', () => {
  const r = room(); j(r, 'h1'); j(r, 'h2'); R.disconnect(r, 'h1', 1000);
  assert.ok(j(r, 'h1', 15999).ok); assert.equal(r.seats.find(s => s.id === 'h1').connected, true);
  R.disconnect(r, 'h1', 20000); const t = R.tick(r, 35000); assert.deepEqual(t.changes, [['expired', 'h1'], ['host', 'h2']]);
  assert.equal(r.seats.length, 1); assert.equal(r.hostId, 'h2');
  const q = room(); j(q, 'a'); j(q, 'b'); R.setReady(q, 'a', true); R.setReady(q, 'b', true); R.start(q, 'a', 0, 1); q.phase = 'race';
  R.disconnect(q, 'b', 100); R.tick(q, 15100); assert.equal(q.seats.find(s => s.id === 'b').left, true); assert.equal(q.seats.length, 2);
  assert.equal(j(q, 'b', 16000).error, 'seat-expired');
});
test('stale input release after 250 ms (race only)', () => {
  const q = room(); j(q, 'a', 0); R.setReady(q, 'a', true); R.start(q, 'a', 0, 1); q.phase = 'race';
  q.seats[0].lastInputAt = 1000; assert.deepEqual(R.tick(q, 1200).stale, []); assert.deepEqual(R.tick(q, 1300).stale, ['a']);
});
