import test from 'node:test';
import assert from 'node:assert/strict';
import{createHash}from'node:crypto';
import{readFileSync}from'node:fs';
import{MAPS}from'../../src/core/maps.js';
const golden=JSON.parse(readFileSync(new URL('./r5-preserved-fixtures.json',import.meta.url),'utf8'));
// Generated from an isolated archive of R4 main f302b13, not the R5 candidate.
const hash=r=>createHash('sha256').update(JSON.stringify(r,(_,v)=>typeof v==='number'?Math.round(v*1e6)/1e6:v)).digest('hex');
for(const k of['technical','legacy'])test(`${k}: complete geometry is unchanged from deployed R4`,()=>{
 assert.equal(hash(MAPS[k].build()),golden.geometry[k]);
});
