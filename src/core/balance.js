// R5 balance targets. Pure constants/helpers shared by authority, prediction and tests.
export const R5_BALANCE=Object.freeze({passive:.10,slipRegen:.12,driftRegen:.30,boostAccel:112,normalAccel:48,draftCap:.09,draftDrag:.5,slingAccel:28,downhillAccel:6,downhillCap:.04});
export function downhill(grade){return Math.max(0,Math.min(1,-grade));}
export function downhillCap(grade){return 1+R5_BALANCE.downhillCap*Math.min(1,downhill(grade)/.45);}
