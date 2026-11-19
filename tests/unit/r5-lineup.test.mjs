import test from 'node:test';
import assert from 'node:assert/strict';
import { npcLineup,NPC_NAMES } from '../../src/core/npc-lineup.js';
import { CAR_KEYS,RIVAL_ORDER } from '../../src/core/roster.js';
import { createSim,PERS } from '../../src/core/sim.js';
test('seeded solo lineups are reproducible, unique and vary by race',()=>{
 const a=npcLineup(125,7),b=npcLineup(126,7);assert.deepEqual(a,npcLineup(125,7));assert.notDeepEqual(a,b);assert.equal(new Set(a.map(r=>r.name)).size,7);assert.equal(new Set(a.map(r=>r.car)).size,7);
 for(const r of a){assert.ok(CAR_KEYS.includes(r.car));assert.ok(RIVAL_ORDER.includes(r.persKey));assert.ok(NPC_NAMES.includes(r.name.split(' ')[0]));}
});
test('random display names do not replace the existing AI driving personalities or consume sim RNG',()=>{
 const a=createSim({seed:8}),b=createSim({seed:8});a.setTrack('velocity');b.setTrack('velocity');
 const grid=npcLineup(99,5);a.addRacers(grid);b.addRacers(grid.map(r=>({name:r.persKey})));
 assert.equal(a.rngState,b.rngState);assert.deepEqual(a.racers.slice(1).map(r=>r.pers),grid.map(r=>PERS[r.persKey]));assert.deepEqual(a.racers.slice(1).map(r=>r.npcCar),grid.map(r=>r.car));
});
