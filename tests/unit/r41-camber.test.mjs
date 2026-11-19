import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, MAP_KEYS } from '../../src/core/maps.js';
import { transformTrack, validVariant } from '../../src/core/variants.js';
import { TRK } from '../../src/core/track.js';
import { bodyLean, cameraLean } from '../../src/client/lean.js';

// Signed plan-view curvature and horizontal normal, not dT dot U: the latter
// confuses hill compression with road camber. Exclude deliberate walls/loops.
for (const key of MAP_KEYS.filter(k=>k!=='legacy')) test(`${key}: ordinary banked corners lean inward`, () => {
 const raw = MAPS[key].build();
 for(const vr of [0,1,2,3]) {
  if(!validVariant(key,vr))continue;
  const M=transformTrack(raw,vr,MAPS[key].sectors.length).main;
  let inward=0,outward=0,flat=0;
  for(let i=4;i<M.N-4;i++) {
   const t=M.T[i],u=M.U[i],a=M.T[i-4],b=M.T[i+4];
   const yaw=(t[2]*(b[0]-a[0])-t[0]*(b[2]-a[2]))/(8*M.ds);
   if(u[1]<.75 || Math.abs(t[1])>.25 || Math.abs(yaw)<.001)continue;
   const bank=(u[0]*t[2]-u[2]*t[0])*Math.sign(yaw);
   if(Math.abs(bank)<.02)flat++;else if(bank>0)inward++;else outward++;
  }
  assert.equal(outward,0,`${key} variant ${vr}: outward samples`);
  if(key==='technical')assert.ok(flat>100,'Kage remains flat-camber');
  else assert.ok(inward>100,`${key} variant ${vr}: meaningful inward bank`);
 }
});

test('Legacy preserves the complete R4 route and surface frames unchanged',()=>{
 assert.deepEqual(MAPS.legacy.build(),TRK.assemble({fastMonaco:true}));
});

test('body and chase camera extra roll both lean into left and right turns',()=>{
 for(const steer of [-1,1]){
  const r={autopilot:false,steer,speed:80,vl:0};
  // +Z-forward mesh: positive roll tips its up vector toward -X.
  assert.ok(-Math.sin(bodyLean(r,true))*steer>0);
  // Camera looks +Z but its local +Z points backwards: positive camera roll tips up toward +X.
  assert.ok(Math.sin(cameraLean(-steer,1))*steer>0);
  assert.ok(-Math.sin(bodyLean({autopilot:true,rollAI:steer*.3},true))*steer>0);
 }
 assert.ok(Math.abs(bodyLean({autopilot:false,steer:0,speed:0,vl:0},true))<1e-12);
 assert.ok(Math.abs(cameraLean(100,1))<=.12);
});

test('R4.1 records preserve R4 values without comparing different camber',async()=>{
 const {recordKey,RECORD_PREFIX,memoryStorage,createRecordStore}=await import('../../src/core/records.js');
 const mem=memoryStorage();for(const key of ['velocity']){
  const old=`m3_expert_r4_${key}`;mem.setItem(RECORD_PREFIX+old,'90');
  const st=createRecordStore(mem,{lapLenOf:()=>5400});
  assert.notEqual(recordKey('expert',key),old);
  assert.equal(st.get(recordKey('expert',key)),Infinity);
  assert.equal(mem.getItem(RECORD_PREFIX+old),'90');
 }
 assert.equal(recordKey('expert','drift'),'m3_expert_r4_drift');
 assert.equal(recordKey('expert','legacy'),'m3_expert_r4_legacy');
});

test('snapshot array gaps are JSON-canonical before transport',async()=>{
 const {createSim}=await import('../../src/core/sim.js');const s=createSim({seed:6});s.setTrack('velocity');s.addSeats([{id:'p',kind:'human'}],'p');s.startRace();s.step(1/120);s.player.curSplits[2]=12;
 const snap=s.snapshot();assert.deepEqual(snap,JSON.parse(JSON.stringify(snap)));
 const restored=createSim({seed:7});restored.importSnapshot(JSON.parse(JSON.stringify(snap)));assert.deepEqual(restored.snapshot(),snap);
});
