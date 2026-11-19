import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateMotion,cameraMotion,raceFov,cameraShake } from '../../src/client/comfort.js';

test('R5 comfort migration reaches existing users once without deleting other choices',()=>{
 const old={blur:2,shake:true,mode:'expert',quality:'high',music:false};
 const now=migrateMotion(old);assert.equal(now.comfort,true);assert.equal(now.blur,0);assert.equal(now.shake,false);assert.equal(now.mode,'expert');assert.equal(now.music,false);
 assert.deepEqual(old,{blur:2,shake:true,mode:'expert',quality:'high',music:false});
 const chosen={...now,comfort:false,blur:1,shake:true};assert.deepEqual(migrateMotion(chosen),chosen);
 assert.deepEqual(migrateMotion(chosen,true),{...chosen,comfort:true,blur:0,shake:false});
});
test('Comfort FOV is almost fixed and ignores speed, tow and collision kick',()=>{
 for(const speed of [0,.5,1,2])for(const kick of [0,5,50])for(const tow of [0,1]){
  assert.equal(raceFov(speed,0,kick,tow),72);assert.equal(raceFov(speed,1,kick,tow),72.8);
 }
 assert.ok(raceFov(1,1,5,1,false)>85);
});
test('Shake off is really zero, Comfort reduces remaining shake and chase swing',()=>{
 assert.equal(cameraShake(5,false,true,1,2),0);assert.equal(cameraShake(5,false,false,1,2),0);
 assert.ok(cameraShake(1,true,true)<cameraShake(1,true,false));
 assert.ok(cameraMotion(true).yaw<cameraMotion(false).yaw);assert.ok(cameraMotion(true).lean<.3);assert.equal(cameraMotion(true).boostHeight,0);
});
