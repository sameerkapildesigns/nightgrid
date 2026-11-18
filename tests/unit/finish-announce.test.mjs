import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finishAnnounce } from '../../src/client/finish-pos.js';
test('finish announcement waits for the server order (M6: old code read index+1 = 0 before it arrived)', () => {
  assert.equal(finishAnnounce([], 'p1'), null);            // our prediction finished, server has not listed us
  assert.equal(finishAnnounce(['p2'], 'p1'), null);        // someone else confirmed, still unknown for us
  assert.equal(finishAnnounce(['p1'], 'p1'), 'VICTORY');
  assert.equal(finishAnnounce(['p2', 'p1'], 'p1'), 'PLACED');
  assert.equal(finishAnnounce(undefined, 'p1'), null);
});
