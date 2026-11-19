import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTrackData,MAP_KEYS} from '../../src/core/maps.js';
import {trafficProfile,trafficAlpha,trafficStarts} from '../../src/core/traffic.js';
import {createSim} from '../../src/core/sim.js';
import {gapS} from '../../src/core/hazards.js';
for(const key of MAP_KEYS)test(`${key}: seven traffic starts spread across safe road including straights`,()=>{
 const td=buildTrackData(key),p=trafficProfile(td),a=trafficStarts(p);assert.equal(a.length,7);assert.equal(new Set(a).size,7);assert.ok(Math.max(...a)-Math.min(...a)>td.MAIN.L*.5);
 for(const s of a){assert.ok(trafficAlpha(p,s)>=.99);const i=Math.floor(s/td.MAIN.ds);assert.ok(td.MAIN.U[i].y>=.82);}
 assert.ok(a.some(s=>Math.abs(td.MAIN.KG[Math.floor(s/td.MAIN.ds)])<1/260),'traffic is present on straights too');
 for(let i=0;i<td.MAIN.N;i++)if(td.MAIN.U[i].y<.82||Math.abs(td.MAIN.T[i].y)>.22)assert.equal(trafficAlpha(p,i*td.MAIN.ds),0);
});
for(const key of ['casino','summit'])test(`${key}: taxis no longer loop in a small cluster or teleport at zone ends`,()=>{
 const s=createSim({seed:73});s.setTrack(key);s.addSeats([{id:'p',kind:'human'}],'p');s.startRace();assert.equal(s.drones.length,7);
 const before=s.drones.map(d=>d.s);for(let i=0;i<600;i++){
  const old=s.drones.map(d=>[d.s,d.visibility]);s.step(1/120);
  for(let k=0;k<s.drones.length;k++){const d=s.drones[k];assert.ok(Math.abs(gapS(old[k][0],d.s,s.track.MAIN.L)-d.speed/120)<1e-8);assert.ok(Math.abs(d.visibility-old[k][1])<.02);}
 }
 assert.ok(s.drones.every((d,i)=>Math.abs(gapS(before[i],d.s,s.track.MAIN.L))>100));
 const restored=createSim();restored.importSnapshot(JSON.parse(JSON.stringify(s.snapshot())));s.step(1/120);restored.step(1/120);assert.deepEqual(restored.snapshot(),s.snapshot());
});
