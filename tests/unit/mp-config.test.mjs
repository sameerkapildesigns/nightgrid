import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMpConfig, inviteLink } from '../../src/net/mp-config.js';
const PAGE = 'https://nightgrid.sameerkapil.com/';
test('production: requires an https, non-local backend; no silent fallback', () => {
  assert.deepEqual(resolveMpConfig({ mode: 'production', apiBase: '', pageUrl: PAGE }), { enabled: false, reason: 'no-backend-configured' });
  assert.equal(resolveMpConfig({ mode: 'production', apiBase: 'http://nightgrid-mp.x.workers.dev', pageUrl: PAGE }).reason, 'insecure-backend-url');
  for (const b of ['https://localhost:8787', 'https://127.0.0.1', 'https://192.168.1.5', 'https://10.0.0.2']) assert.equal(resolveMpConfig({ mode: 'production', apiBase: b, pageUrl: PAGE }).reason, 'insecure-backend-url', b);
  assert.equal(resolveMpConfig({ mode: 'production', apiBase: 'https://x.workers.dev/?a=1', pageUrl: PAGE }).reason, 'bad-backend-url');
  assert.equal(resolveMpConfig({ mode: 'production', apiBase: 'not a url', pageUrl: PAGE }).reason, 'bad-backend-url');
  const c = resolveMpConfig({ mode: 'production', apiBase: 'https://nightgrid-mp.example.workers.dev/', pageUrl: PAGE });
  assert.deepEqual(c, { enabled: true, http: 'https://nightgrid-mp.example.workers.dev', ws: 'wss://nightgrid-mp.example.workers.dev', crossOrigin: true });
});
test('dev/test: same-origin without a base; explicit http base allowed for local cross-origin tests', () => {
  assert.deepEqual(resolveMpConfig({ mode: 'development', apiBase: '', pageUrl: 'http://127.0.0.1:5173/' }), { enabled: true, http: 'http://127.0.0.1:5173', ws: 'ws://127.0.0.1:5173', crossOrigin: false });
  const t = resolveMpConfig({ mode: 'test', apiBase: 'http://127.0.0.1:8799', pageUrl: 'http://127.0.0.1:4173/' });
  assert.equal(t.enabled, true); assert.equal(t.ws, 'ws://127.0.0.1:8799'); assert.equal(t.crossOrigin, true);
});
test('invite links point at the frontend page, never the backend', () => {
  assert.equal(inviteLink('https://nightgrid.sameerkapil.com/?touch#x', 'ABC234'), 'https://nightgrid.sameerkapil.com/?room=ABC234');
});
