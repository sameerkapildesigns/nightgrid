// M7: seat-count copy must follow the real room cap (regression: 20-seat room said "4 seats" / "2 to 4").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { MAX_SEATS, MIN_RACERS } from '../../src/core/room.js';
import { errorText, ROOM_LEAD } from '../../src/client/lobby.js';
import { ERROR_TEXT } from '../../src/net/protocol.js';

test('room-full and lobby lead text state the actual cap', () => {
  assert.equal(ERROR_TEXT['room-full'], `That room is full (${MAX_SEATS} seats).`, 'server/protocol text itself is truthful');
  assert.equal(errorText('room-full'), ERROR_TEXT['room-full'], 'client shows the protocol text (no override)');
  assert.ok(ROOM_LEAD.includes(`${MIN_RACERS} to ${MAX_SEATS} racers`), ROOM_LEAD);
});
test('no hard-coded stale 4-seat copy in client UI or README', () => {
  const files = readdirSync(new URL('../../src/client/', import.meta.url)).filter(f => f.endsWith('.js')).map(f => 'src/client/' + f).concat(['index.html', 'README.md', 'src/net/protocol.js']);
  for (const f of files) {
    const t = readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
    for (const bad of [/\b2 to 4 racers/, /\(4 seats\)/, /2–4 racers/, /up to 4 (racers|players)/i]) assert.ok(!bad.test(t), `${f} still has ${bad}`);
  }
});
