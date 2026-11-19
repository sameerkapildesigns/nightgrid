import test from 'node:test';
import assert from 'node:assert/strict';
import { R5_BALANCE as B,downhill,downhillCap } from '../../src/core/balance.js';
import { createSim } from '../../src/core/sim.js';
import {buildTrackData,MAP_KEYS} from '../../src/core/maps.js';
import {paceFor} from '../../src/core/pace.js';
import {recordKey,RECORD_PREFIX,memoryStorage,createRecordStore} from '../../src/core/records.js';
test('R5 pace has higher normal speed with boost mostly acceleration and a 9-12 percent cap gap',()=>{
 const old={velocity:[240,310],technical:[180,240],casino:[210,280],summit:[205,275],drift:[185,245],legacy:[210,280]};
 for(const key of MAP_KEYS)for(const [i,mode] of ['assisted','expert'].entries()){
  const p=paceFor(key,mode);assert.ok(p.normal*3.6>old[key][i]*1.10);assert.ok(p.boost/p.normal<1.12);assert.ok(p.boost>p.normal);
 }
 assert.equal(B.slipRegen,.06*2);assert.equal(B.passive,.08*1.25);assert.ok(Math.abs(B.driftRegen-.2*1.5)<1e-12);assert.ok(B.boostAccel>B.normalAccel*2);
});
test('uphill adds no gravity slowdown, downhill gains are finite and bounded',()=>{
 assert.equal(downhill(.9),0);assert.equal(downhillCap(.9),1);assert.equal(downhill(-.5),.5);assert.equal(downhillCap(-1),1.04);
 const run=grade=>{const td=buildTrackData('velocity');for(let i=0;i<td.MAIN.N;i++){td.MAIN.T[i].set(0,grade,Math.sqrt(1-grade*grade));td.MAIN.KG[i]=td.MAIN.KN[i]=0;}const s=createSim({seed:77});s.setTrack(td);s.addSeats([{id:'p',kind:'human'}],'p');s.drones=[];s.startRace();Object.assign(s.player,{s:400,va:65,speed:65,vd:0,psi:0});s.input.up=1;s.step(1/120);return s.player.va;};
 const flat=run(0),up=run(.3),down=run(-.3);assert.ok(Math.abs(up-flat)<1e-10,`${up} ${flat}`);assert.ok(down>flat,`${down} ${flat}`);
});
test('stacked surge, tow, solo assist and overspeed cannot exceed the shared absolute ceiling',()=>{
 const s=createSim({seed:1});s.setTrack('velocity');s.addSeats([{id:'p',kind:'human'}],'p');s.drones=[];s.startRace();const p=s.player;
 for(let i=0;i<600;i++){Object.assign(p,{s:400,va:170,vd:30,speed:173,tow:1,slingT:1,surgeT:2,catchMul:1.3});s.input.up=1;s.input.boost=1;s.step(1/120);assert.ok(p.speed<=140+1e-9);assert.ok(Number.isFinite(p.s));}
});
test('all R5 records isolate previous R4 and R4.1 physics without deleting storage',()=>{
 const mem=memoryStorage();const st=createRecordStore(mem,{lapLenOf:()=>5400});for(const map of MAP_KEYS){for(const rev of ['r4','r41'])mem.setItem(RECORD_PREFIX+`m3_expert_${rev}_${map}`,'90');assert.equal(st.get(recordKey('expert',map)),Infinity);for(const rev of ['r4','r41'])assert.equal(mem.getItem(RECORD_PREFIX+`m3_expert_${rev}_${map}`),'90');assert.equal(recordKey('expert',map),`m3_expert_r5_${map}`);}
});
