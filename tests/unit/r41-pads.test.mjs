import test from 'node:test';import assert from 'node:assert/strict';
import {createSim}from'../../src/core/sim.js';
import {MAP_KEYS}from'../../src/core/maps.js';
import {validVariant}from'../../src/core/variants.js';
import {padContact,HAZ}from'../../src/core/hazards.js';
const dt=1/120;
for(const map of MAP_KEYS)for(const vr of [0,1,2,3]){
 if(!validVariant(map,vr))continue;
 test(`${map} variant ${vr}: gold and green overdrive collect on the visible front and side edges`,()=>{
  const s=createSim({seed:31});s.setTrack(map,vr);s.ghost=true;s.hazards=true;s.addSeats([{id:'p',kind:'human'}],'p');s.drones=[];s.obstacles=[];s.startRace();
  for(const extra of [false,true]){
   const p=s.pads.find(p=>p.kind==='B'&&!!p.extra===extra);assert.ok(p);
   const r=s.player;Object.assign(r,{s:p.s-9,d:p.d+HAZ.PAD_VISUAL_HALF_W+.9,va:0,vd:0,psi:0,h:1,vh:0,speed:0,surgeT:0,padTouch:{},finished:false});
   s.pads=[{...p,readyAt:0}];s.step(dt);assert.ok(r.surgeT>0,'visible outer half grants overdrive');assert.equal(s.pads[0].readyAt,0,'arrows stay ready');
   const until=s.pads[0].readyAt;for(let i=0;i<240;i++){Object.assign(r,{s:p.s-9,d:p.d+HAZ.PAD_VISUAL_HALF_W+.9,va:0,vd:0,psi:0,h:1,vh:0});s.step(dt);}assert.equal(s.pads[0].readyAt,until,'parked overlap cannot farm');
   s.setPickupSeed(31);
  }
 });
}
test('overdrive boundary: vehicle footprint included, outside that footprint rejected; seam and branch distances correct',()=>{
 const p={s:100,d:0,kind:'B'};
 assert.ok(padContact(p,{s:87.5,d:4.1},1000));
 assert.ok(!padContact(p,{s:87.3,d:0},1000));
 assert.ok(!padContact(p,{s:100,d:4.3},1000));
 assert.ok(padContact({...p,s:2},{s:995,d:0},1000));
 assert.ok(!padContact({...p,s:2,br:true},{s:995,d:0},1000));
});
test('race-speed traversal collects at the front of the visible arrow, not only its center',()=>{
 const s=createSim({seed:31});s.setTrack('velocity');s.hazards=true;s.ghost=true;s.addSeats([{id:'p',kind:'human'}],'p');s.drones=[];s.obstacles=[];s.startRace();
 const pad=s.pads.find(p=>p.kind==='B');s.pads=[pad];const r=s.player;Object.assign(r,{s:pad.s-14,d:pad.d,va:137,speed:137,vd:0,psi:0,h:1,vh:0});s.input.up=1;
 for(let i=0;i<8&&!r.surgeT;i++)s.step(dt);
 assert.ok(r.surgeT>0);assert.ok(r.s<pad.s-5,'collection before old central hitbox');
});

test('permanent gold/green arrows grant every simultaneous racer; bottles remain consumable',()=>{
 for(const extra of [false,true]){
  const s=createSim({seed:31});s.setTrack('velocity');s.hazards=true;s.ghost=true;s.addSeats([{id:'p',kind:'human'},{id:'q',kind:'human'}],'p');s.drones=[];s.obstacles=[];s.startRace();
  const p=s.pads.find(p=>p.kind==='B'&&!!p.extra===extra);s.pads=[p];
  const place=(r,p)=>Object.assign(r,{s:p.s,d:p.d,va:0,vd:0,psi:0,h:1,vh:0,speed:0,surgeT:0,meter:0,padTouch:{},path:s.track.MAIN});
  for(const r of s.racers)place(r,p);s.step(dt);
  for(const r of s.racers)assert.ok(r.surgeT>0,'both racers granted');assert.equal(p.readyAt,0);
  // Another immediate entry is valid, without waiting for a shared respawn.
  Object.assign(s.racers[1],{s:p.s+30,va:0,vd:0,psi:0});s.step(dt);place(s.racers[1],p);s.step(dt);assert.ok(s.racers[1].surgeT>0);
  const bottle={...p,kind:'R',readyAt:0};s.pads=[bottle];for(const r of s.racers)place(r,bottle);s.step(dt);
  assert.ok(s.racers[0].meter>.3);assert.equal(s.racers[1].meter,0);assert.ok(bottle.readyAt>s.time);
 }
});

test('gold/green simultaneous authority grants match the shipping predictor after JSON snapshot',async()=>{
 const{Predictor}=await import('../../src/net/netcode.js');const{encodeFrame,decodeFrame}=await import('../../src/net/protocol.js');
 for(const extra of [false,true]){
  const s=createSim({seed:31});s.setTrack('velocity');s.hazards=true;s.ghost=true;s.addSeats([{id:'p',kind:'human'},{id:'q',kind:'human'}],'p');s.drones=[];s.obstacles=[];s.startRace();
  const p=s.pads.find(p=>p.kind==='B'&&!!p.extra===extra);
  for(const r of s.racers)Object.assign(r,{s:p.s-13,d:p.d,va:80,vd:0,psi:0,h:1,vh:0,speed:80});
  const P=new Predictor({seed:31,map:'velocity',mode:'expert',you:'p',step:0,snap:JSON.parse(JSON.stringify(s.snapshot()))});
  for(let i=0;i<10;i++){const f=encodeFrame({});decodeFrame(f,s.input);s.step(dt);P.step(f);}
  for(const r of s.racers)assert.ok(r.surgeT>0);
  // Predictor suppresses presentation-only checkpoint lastSign cues. Compare
  // the actual physics/power/contact state, not that event debounce dictionary.
  const actual=P.sim.racerState('p'),expected=s.racerState('p');delete actual.lastSign;delete expected.lastSign;
  assert.deepEqual(actual,expected);
  assert.ok(s.pads.filter(p=>p.kind==='B').every(p=>p.readyAt===0));
 }
});
