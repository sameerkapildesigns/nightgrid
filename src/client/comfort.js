// R5 presentation only. Shared simulation and road frames stay unchanged.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const COMFORT_REV=1;
export function migrateMotion(s={},reduced=false){
 const out={...s};
 if(out.motionRev!==COMFORT_REV){Object.assign(out,{motionRev:COMFORT_REV,comfort:true,blur:0,shake:false});}
 if(typeof out.comfort!=='boolean')out.comfort=true;
 if(reduced){out.blur=0;out.shake=false;out.comfort=true;}
 return out;
}
export function cameraMotion(comfort=true){return comfort?{yaw:.25,lean:.2,boostDistance:.2,boostHeight:0,airHeight:.25}:{yaw:1,lean:1,boostDistance:1,boostHeight:1,airHeight:.6};}
export function raceFov(speed01,boost,kick,tow,comfort=true){
 return comfort?72+clamp(boost,0,1)*.8:66+clamp(speed01,0,1.15)*9+clamp(boost,0,1)*6+clamp(kick,0,5)+clamp(tow,0,1)*3;
}
export function cameraShake(shake,on,comfort=true,boost=0,speed01=0){
 if(!on)return 0;
 return comfort?clamp(shake,0,1.2)*.2:clamp(shake,0,2)+boost*.03+Math.max(0,speed01-.8)*.035;
}
