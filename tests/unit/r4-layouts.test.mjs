import test from 'node:test';
import assert from 'node:assert/strict';
import {MAP_KEYS,buildTrackData} from '../../src/core/maps.js';
import {buildHazards} from '../../src/core/hazards.js';
import {buildWeaponBoxes} from '../../src/core/weapons.js';
import {createSim} from '../../src/core/sim.js';

const expected={velocity:[5200,5300],technical:[3250,3320],casino:[5300,5400],summit:[6000,6100],drift:[3100,3150],legacy:[5400,5500]};
for(const key of MAP_KEYS)test(`${key} R4: deliberate length, clear distant road corridors, ramps free of obstacles`,()=>{
 const td=buildTrackData(key),M=td.MAIN,[lo,hi]=expected[key];assert.ok(M.L>lo&&M.L<hi);
 // Sampled road envelopes include car/rail breathing room. Adjacent turns are excluded.
 for(let i=0;i<M.N;i+=8)for(let j=i+120;j<M.N;j+=8){if(Math.min(j-i,M.N-j+i)<120)continue;const a=M.P[i],b=M.P[j],r=Math.max(M.WL[i],M.WR[i])+Math.max(M.WL[j],M.WR[j])+2;if(Math.hypot(a.x-b.x,a.z-b.z)<r)assert.ok(Math.abs(a.y-b.y)>14,`${key} road clearance ${i}/${j}`);}
 const h=buildHazards(td),boxes=buildWeaponBoxes(td);assert.equal(h.pads.filter(p=>p.kind!=='R').length,18);assert.ok(boxes.length>=2);
 for(const [a,b]of td.rampZones)for(const o of h.obstacles)assert.ok(o.s<a||o.s>b,`${key} obstacle on takeoff/landing zone`);
 if(key==='drift'){assert.equal(h.obstacles.length,0);assert.ok(M.KG.filter(k=>Math.abs(k)>.005).length>M.N*.35);}
 if(key==='technical')assert.ok(Math.max(...M.P.map(p=>p.y))>30);
 if(key==='casino')assert.ok(Math.max(...M.P.map(p=>p.y))>160);
 if(key==='legacy')assert.ok(M.tag.every(t=>!(t&1)),'no Riviera tunnel');
 if(key==='velocity'){const inverted=M.U.filter(u=>u.y<-.5).length*M.ds;assert.ok(inverted>50&&inverted<180,`short deliberate inversion ${inverted}`);}
});
for(const key of ['drift'])for(const vr of [1,2,3])test(`${key} R4 variant ${vr}: geometry and one bot race remain valid`,()=>{
 const td=buildTrackData(key,vr),M=td.MAIN;for(let i=0;i<M.N;i++){assert.ok(M.P[i].distanceTo(M.P[(i+1)%M.N])<1.05*M.ds);assert.ok(Math.abs(M.T[i].dot(M.U[i]))<1e-5);}
 const s=createSim({seed:101});s.setTrack(td);s.ghost=true;s.hazards=true;s.addSeats([{id:'b',kind:'bot'}]);s.startRace();for(let i=0;i<360*120&&!s.racers[0].finished;i++)s.step(1/120);assert.equal(s.racers[0].finished,true);assert.equal(s.racers[0].crashed,0);const q=createSim();q.importSnapshot(s.snapshot());assert.deepEqual(q.snapshot(),s.snapshot());
});

test('R4 keeps existing Casino/Summit variant restrictions',()=>{for(const k of ['casino','summit'])for(const vr of [1,2,3,4])assert.throws(()=>buildTrackData(k,vr),/unsupported/);});
test('Kage reverse ramp exclusion follows the actual reversed road',()=>{const base=buildTrackData('technical'),rev=buildTrackData('technical',2),M=base.MAIN,pivot=2*Math.round(60/M.ds)*M.ds,L=M.L;for(const [a,b]of base.rampZones)for(let s=a;s<=b;s+=8){const r=((pivot-s)%L+L)%L;assert.ok(rev.rampZones.some(([x,y])=>r>=x-.001&&r<=y+.001));}});
