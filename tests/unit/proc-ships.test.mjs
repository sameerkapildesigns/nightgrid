// R2 original procedural ships: bounded, deterministic, roster/room/livery integration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildProcShip, shipStats, disposeProcShip, PROC_SHIP_KEYS, PROC_LIMITS, PROC_NOZZLES } from '../../src/client/proc-ships.js';
import { CARS, CAR_KEYS, DEFAULT_CAR, bootLoadOrder, raceCarKeys } from '../../src/core/roster.js';
import { CARS_OK } from '../../src/core/room.js';
import { FASTEST_MOD } from '../../src/core/pace.js';

test('roster: both ships listed after the six approved models; GLB roster untouched', () => {
  assert.deepEqual(CAR_KEYS.slice(0, 6), ['hypercar', 'endurance', 'wedge', 'rally', 'streamliner', 'wipeout']);
  assert.deepEqual(CAR_KEYS.slice(6), ['kestrel', 'manta']);
  assert.deepEqual(PROC_SHIP_KEYS.sort(), ['kestrel', 'manta']);
  assert.equal(DEFAULT_CAR, 'hypercar');
  assert.deepEqual(bootLoadOrder('hypercar'), raceCarKeys('hypercar'));
  assert.ok(!bootLoadOrder('hypercar').some(k => CARS[k].proc), 'boot never builds a proc ship unless selected');
  assert.equal(bootLoadOrder('manta')[0], 'manta');
  assert.deepEqual([...CARS_OK], [...CAR_KEYS], 'room server accepts exactly the garage roster');
  for (const k of ['kestrel', 'manta']) {
    const C = CARS[k];
    assert.equal(C.kind, 'ship'); assert.equal(C.proc, true); assert.ok(C.mods.vmax <= FASTEST_MOD);
    assert.ok(C.credit.original); assert.ok(C.stats.top <= 1 && C.stats.acc <= 1 && C.stats.grip <= 1);
  }
});

for (const k of ['kestrel', 'manta']) test(`${k}: bounded, named for livery roles, nose forward, emitters on the nozzles`, () => {
  const g = buildProcShip(k), st = shipStats(g.scene), C = CARS[k];
  assert.ok(st.meshes >= C.minMeshes && st.meshes <= PROC_LIMITS.maxMeshes, JSON.stringify(st));
  assert.ok(st.tris >= C.minTris && st.tris <= PROC_LIMITS.maxTris, JSON.stringify(st));
  const roles = new Set();
  g.scene.traverse(o => { if (!o.isMesh) return; const mn = o.material.name;
    const role = C.glassMat.test(mn) && /Cristal/.test(mn) ? 'glass' : C.neonMat.test(mn) ? 'neon' : C.accentMat.test(mn) ? 'accent' : C.tintMat.test(mn) ? 'shipPaint' : 'other';
    roles.add(role); if (role === 'other') assert.equal(mn, 'Proc_Metal', 'only bare metal keeps its own material');
    assert.ok(o.geometry.attributes.position.array.every(Number.isFinite), 'finite vertices'); });
  assert.deepEqual([...roles].sort(), ['accent', 'glass', 'neon', 'other', 'shipPaint']);
  const b = new THREE.Box3().setFromObject(g.scene), sz = b.getSize(new THREE.Vector3());
  assert.ok(sz.z > 4.5 && sz.z < 5.5 && sz.x < 3.5 && sz.y < 1.6, sz.toArray().join());
  assert.ok(Math.abs(b.max.x + b.min.x) < 1e-6, 'symmetric about x');
  // nose: the frontmost vertex is on the centreline (+z forward, matches buildCar emitters at -z)
  let front = null; g.scene.traverse(o => { if (!o.isMesh) return; const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i++) if (!front || p.getZ(i) > front[2]) front = [p.getX(i), p.getY(i), p.getZ(i)]; });
  assert.ok(Math.abs(front[0]) < 0.3, 'nose on centreline');
  const W = sz.x, H = sz.y;
  C.emitF.forEach(([fx, fy], i) => { const [x, y] = PROC_NOZZLES[k][i];
    assert.ok(Math.abs(fx * W - x) < 0.03 && Math.abs(b.min.y + fy * H - y) < 0.03, `${k} emitter ${i}`); });
});

test('deterministic geometry and full disposal', () => {
  for (const k of ['kestrel', 'manta']) {
    const a = buildProcShip(k), b = buildProcShip(k);
    const arr = g => { const out = []; g.scene.traverse(o => { if (o.isMesh) out.push(Array.from(o.geometry.attributes.position.array)); }); return out; };
    assert.deepEqual(arr(a), arr(b));
    let disposed = 0; a.scene.traverse(o => { if (o.isMesh) { o.geometry.addEventListener('dispose', () => disposed++); o.material.addEventListener('dispose', () => disposed++); } });
    disposeProcShip(a); assert.equal(disposed, 2 * shipStats(a.scene).meshes);
  }
});
