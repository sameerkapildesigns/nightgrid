// The core must be importable without a browser or Three.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../../src/core/', import.meta.url);
const files = readdirSync(dir).filter(f => f.endsWith('.js'));

test('core modules import nothing outside src/core', () => {
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const m of src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/gm)) assert.ok(m[1].startsWith('./'), `${f} imports ${m[1]}`);
    assert.ok(!/\b(window|document|localStorage|requestAnimationFrame|THREE)\b/.test(src.replace(/\/\/.*$/gm, '')), `${f} references a browser/Three global`);
  }
});

test('every core module loads in plain Node', async () => {
  for (const f of files) { const m = await import(new URL(f, dir)); assert.ok(Object.keys(m).length > 0, f); }
});
