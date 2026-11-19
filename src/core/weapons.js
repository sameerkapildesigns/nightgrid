// Deterministic combat. No DOM, wall clock, renderer, or global RNG.
// All positions are path-local. Own-car predictors must set predictOnly and never resolve hits.
import { nearestOk, buildHazards, gapS, HAZ } from './hazards.js';
import { mod, clamp } from './math.js';

export const WPN = Object.freeze({
  COLD_TIME: 5, COLD_DIST: 250, BOX_COOLDOWN: 1.5, PICKUP_GUARD: .3, FIRE_COOLDOWN: 1,
  IMMUNITY: 1.5, ARM: 1.25, MISSILE_LIFE: 3.5, MIN_LOCK: 15, MAX_LOCK: 150,
  MISSILE_GAIN: 45, TURN_SPEED: 6, MISSILE_LOSS: .20, MISSILE_MAX_LOSS: 18, MISSILE_RAMP: .25,
  MAX_MISSILES: 20, MAX_MINES: 20, MAX_EVENTS: 256, MAX_ACTIONS: 4, LATE_STEPS: 30, AHEAD_STEPS: 360,
  MINE_ARM: .8, MINE_LIFE: 8, MINE_LOSS: .15, MINE_MAX_LOSS: 12, MINE_RAMP: .2,
  EMP_TIME: 1.25, EMP_BEHIND: 12, EMP_AHEAD: 45, EMP_MAX_TARGETS: 3
});
export const WEAPON_NAMES = ['', 'MISSILE', 'MINE', 'EMP'];
export const activeRacer = r => !r.finished && !r.dnf && !(r.crashed > 0);
export const pathId = (sim, p) => p === sim.track.MAIN ? 0 : 1;
export const pathOf = (sim, n) => n === 0 ? sim.track.MAIN : sim.track.BR;
export const pathGap = (p, a, b) => p.closed ? gapS(a, b, p.L) : b - a;
// Relative swept AABB slab intersection. Parameters are relative s,d,h at t=0 and t=1.
// Return earliest contact fraction or null; includes fast lateral crossing, not just endpoint overlap.
export function sweepBox(a, b, half) {
  let lo = 0, hi = 1;
  for (let k = 0; k < 3; k++) {
    const v = b[k] - a[k];
    if (Math.abs(v) < 1e-10) { if (Math.abs(a[k]) > half[k]) return null; continue; }
    let x = (-half[k] - a[k]) / v, y = (half[k] - a[k]) / v;
    if (x > y) [x,y] = [y,x]; lo = Math.max(lo,x); hi = Math.min(hi,y);
    if (lo > hi) return null;
  }
  return lo;
}
// Stateless draw, independent of AI PRNG. Seat/lap/box make each visit reproducible.
export function weaponHash(seed, seat, lap, box) {
  let n = seed | 0; const s = String(seat) + ':' + lap + ':' + box;
  for (let i=0;i<s.length;i++) n = Math.imul(n ^ s.charCodeAt(i), 16777619);
  n = Math.imul(n ^ n >>> 16, 0x7feb352d); n = Math.imul(n ^ n >>> 15, 0x846ca68b);
  return ((n ^ n >>> 16) >>> 0) / 4294967296;
}
export function rollWeapon(seed, seat, lap, box, rankFraction, slice=1) {
  if (slice === 1) return 1;
  if (slice === 2) return weaponHash(seed,seat,lap,box)<.65?2:3; // Early review: mine/EMP only, no missile grants.
  const u = weaponHash(seed, seat, lap, box), a = rankFraction < .25 ? .2 : rankFraction >= .75 ? .6 : .45;
  return u < a ? 1 : u < .75 ? 2 : 3;
}
export function buildWeaponBoxes(td) {
  if (td.weaponBoxes) return td.weaponBoxes;
  const hz = buildHazards(td), rows = [], boxes = [];
  for (const frac of [.16,.42,.70]) {
    const i = nearestOk(td,frac,{avoid:[...hz.pads.map(p=>({s:p.s,c:150})), ...hz.obstacles.map(p=>({s:p.s,c:80})), ...rows.map(s=>({s,c:400}))]});
    if (i >= 0) rows.push(i * td.MAIN.ds);
  }
  // Legacy has no strict station on the current 18-pad layout. Deliberate paired-gate exception:
  // minimum 65m to a defensive row, still full straight/upright/tunnel/fork/obstacle safety.
  let paired = false;
  if (!rows.length && ['legacy','technical','summit'].includes(td.key)) {
    const i=nearestOk(td,.47,{avoid:[...hz.pads.map(p=>({s:p.s,c:65})),...hz.obstacles.map(p=>({s:p.s,c:80}))]});
    if(i>=0){rows.push(i*td.MAIN.ds);paired=true;}
  }
  if(['drift','technical'].includes(td.key))for(const frac of[.25,.65]){const i=nearestOk(td,frac,{pad:true,avoid:[...hz.pads.filter(p=>p.kind!=='R').map(p=>({s:p.s,c:65})),...rows.map(s=>({s,c:200}))]});if(i>=0)rows.push(i*td.MAIN.ds);}
  if(td.key==='casino'){const i=nearestOk(td,(td.SAm+200)/td.MAIN.L,{allowFork:true,avoid:hz.obstacles.map(p=>({s:p.s,c:80}))});if(i>=0&&!rows.some(s=>Math.abs(s-i*td.MAIN.ds)<100))rows.push(i*td.MAIN.ds);}
  rows.forEach((s,row)=>[-1,1].forEach(side=>boxes.push({s,d:side*.5*td.W0,path:0,row,paired})));
  td.weaponBoxes=boxes; return boxes;
}
export function resetWeaponRacer(r) {
  Object.assign(r,{wpn:0,wpnAt:0,fireCD:0,wImmT:0,empT:0,slowT:0,slowRate:0,wBoxAt:[],wBoxTouch:[],lockId:null,lastAid:0,aLog:[],wAIAt:0,wNetLead:0,wThreats:0,wLastHit:-1e9,wStartProg:null,wDistance:0});
}
export function softLock(sim,r) {
  let target=null, best=Infinity;
  for(const o of sim.racers){
    if(o===r||!activeRacer(o)||o.path!==r.path||Math.abs(o.h-r.h)>1.6)continue;
    const g=pathGap(r.path,r.s,o.s);
    // Do not target lapped cars whose real race progress lies behind the shooter.
    if(g<WPN.MIN_LOCK||g>WPN.MAX_LOCK||o.prog<r.prog||Math.abs(o.d-r.d)>4+.05*g)continue;
    if(g<best){best=g;target=o;}
  }
  return target;
}
export function newWeaponState(){return{nextId:1,nextEvent:1,shots:[],mines:[],pulses:[],events:[]};}
export function createCombat(sim, seed) {
  const pending = new Map(), previous = new Map();
  const emit=(kind,owner,victim,result,shot)=>{
    const st=sim.weaponState,e={id:st.nextEvent++,kind,step:sim.stepIndex,owner:owner?.id??owner??null,victim:victim?.id??null,result,shot};
    st.events.push(e);if(st.events.length>WPN.MAX_EVENTS)st.events.splice(0,st.events.length-WPN.MAX_EVENTS);
    sim.events?.weaponEvent?.(e);return e;
  };
  const hot=r=>sim.raceTime()>=WPN.COLD_TIME&&r.wDistance>=WPN.COLD_DIST;
  const enabled=()=>sim.weapons && (sim.phase==='race'||sim.phase==='finished');
  function canFire(r){
    if(!sim.weapons)return'disabled';if(!enabled()||!activeRacer(r))return'inactive';
    if(!r.wpn)return'no-weapon';if(!hot(r))return'cold';if(r.fireCD>0)return'cooldown';if(sim.time-r.wpnAt<WPN.PICKUP_GUARD)return'busy';return'';
  }
  function fire(r, aid=0){
    const error=canFire(r);if(error)return{ok:false,error,shot:0};
    const st=sim.weaponState, kind=r.wpn;
    if((kind!==1 && sim.weaponSlice===1)||(kind===1&&sim.weaponSlice===2))return{ok:false,error:'disabled',shot:0};
    if(st.shots.filter(p=>p.owner!==r.id).length>=WPN.MAX_MISSILES && kind===1)return{ok:false,error:'busy',shot:0};
    const id=st.nextId++, path=pathId(sim,r.path);
    if(kind===1){
      // At most one live missile per owner. Replacement is explicit, bounded and deterministic.
      st.shots=st.shots.filter(p=>p.owner!==r.id);
      const target=softLock(sim,r);
      st.shots.push({id,kind,owner:r.id,aid,path,s:r.s,d:r.d,h:r.h,age:0,warned:{},arm:WPN.ARM+Math.min(1.5,Math.max(0,target?.wNetLead||0)),target:target?.id??null,speed:Math.min((target?.speed??r.speed)+WPN.MISSILE_GAIN,sim.pace.boost*1.35)});
    } else if(kind===2){
      const pathObj=r.path,drop=pathObj.closed?mod(r.s-6,pathObj.L):r.s-6,i=Math.round(drop/pathObj.ds);
      const td=sim.track;
      if(drop<0||drop>pathObj.L||pathObj.U[i]?.y<.8||(pathObj.tag[i]&1)||Math.abs(pathObj.KG[i])>1/100|| (path===0 && (Math.abs(pathGap(pathObj,60,drop))<300 || Math.min(drop,pathObj.L-drop)<100 || (td.HASBR&&drop>td.SAm-150&&drop<td.SBm+150))))return{ok:false,error:'unsafe-drop',shot:0};
      st.mines=st.mines.filter(p=>p.owner!==r.id);
      if(st.mines.length>=WPN.MAX_MINES)return{ok:false,error:'busy',shot:0};
      st.mines.push({id,kind,owner:r.id,aid,path,s:drop,d:r.d,h:1,age:0});
    } else if(kind===3){
      const victims=sim.racers.filter(o=>o!==r&&activeRacer(o)&&o.path===r.path&&o.wImmT<=0&&Math.abs(o.h-r.h)<=1.6).map(o=>({o,g:pathGap(r.path,r.s,o.s)})).filter(({g})=>g>=-WPN.EMP_BEHIND&&g<=WPN.EMP_AHEAD).sort((a,b)=>Math.abs(a.g)-Math.abs(b.g)||String(a.o.id).localeCompare(String(b.o.id))).slice(0,WPN.EMP_MAX_TARGETS);
      for(const {o} of victims)effect(o,3,r,id);
      st.pulses ||= []; st.pulses=st.pulses.filter(p=>p.owner!==r.id);st.pulses.push({id,kind,owner:r.id,aid,path,s:r.s,d:r.d,h:r.h,age:0});
    } else return{ok:false,error:'disabled',shot:0};
    r.wpn=0;r.fireCD=WPN.FIRE_COOLDOWN;emit(kind,r,null,'fired',id);sim.events?.weaponFire?.(r,kind,id);
    return{ok:true,error:'',shot:id};
  }
  function acknowledge(r,a,result){
    r.lastAid=Math.max(r.lastAid,a[0]);r.aLog.push([a[0],result.ok?1:0,sim.stepIndex,result.error||'',result.shot||0]);
    if(r.aLog.length>8)r.aLog.splice(0,r.aLog.length-8);
  }
  function queue(r,actions){
    let q=pending.get(r.id);if(!q)pending.set(r.id,q=new Map());
    for(const a of actions){
      const [aid,k,kind]=a;if(aid<=r.lastAid||q.has(aid))continue;
      if(aid>r.lastAid+WPN.MAX_ACTIONS)continue; // malformed leaps never move the acknowledgement frontier
      q.set(aid,[aid,k,kind]);
    }
  }
  function actions(){
    for(const r of sim.racers){const q=pending.get(r.id);if(!q)continue;
      for(const [aid,a]of [...q].sort((a,b)=>a[0]-b[0])){
        if(aid<=r.lastAid){q.delete(aid);continue;}
        if(aid!==r.lastAid+1)break;
        const delta=a[1]-sim.stepIndex;
        if(delta>WPN.AHEAD_STEPS){acknowledge(r,a,{ok:false,error:'time-ahead'});q.delete(aid);continue;}
        if(delta>0)break;
        acknowledge(r,a,delta < -WPN.LATE_STEPS?{ok:false,error:'stale'}:fire(r,aid));q.delete(aid);
      }
    }
  }
  function effect(r,kind,owner,shot){
    if(!activeRacer(r)||r.wImmT>0)return false;
    r.wImmT=WPN.IMMUNITY;r.wLastHit=sim.time;
    if(r.shieldT>0){r.shieldT=0;r.passT=HAZ.SHIELD_PASS;emit(kind,owner,r,'blocked',shot);return true;}
    if(kind===3){r.empT=WPN.EMP_TIME;r.boost=false;}
    else {const v=Math.max(0,r.autopilot?r.speed:r.va),loss=Math.min(v*(kind===2?WPN.MINE_LOSS:WPN.MISSILE_LOSS),kind===2?WPN.MINE_MAX_LOSS:WPN.MISSILE_MAX_LOSS);
    r.slowT=kind===2?WPN.MINE_RAMP:WPN.MISSILE_RAMP;r.slowRate=loss/r.slowT;}
    emit(kind,owner,r,'hit',shot);return true;
  }
  function begin(h){
    if(!sim.weapons)return;
    for(const r of sim.racers){
      let prev=previous.get(r.id);if(!prev){prev={};previous.set(r.id,prev);}prev.path=r.path;prev.s=r.s;prev.d=r.d;prev.h=r.h;
      r.fireCD=Math.max(0,r.fireCD-h);r.wImmT=Math.max(0,r.wImmT-h);r.empT=Math.max(0,r.empT-h);
      if(r.slowT>0){const loss=r.slowRate*Math.min(h,r.slowT);if(r.autopilot)r.speed=Math.max(0,r.speed-loss);else r.va=Math.max(0,r.va-loss);r.slowT=Math.max(0,r.slowT-h);}
      if(!activeRacer(r)){if(r.finished||r.dnf)r.wpn=0;continue;}
      r.lapIntegrity.weapons=true;
    }
  }
  function sweepRacer(p,old,r,half){
    const prev=previous.get(r.id);if(!prev||prev.path!==r.path||pathId(sim,r.path)!==p.path)return null;
    const path=r.path,gs=pathGap(path,old.s,prev.s);
    const advanceR=pathGap(path,prev.s,r.s),advanceP=pathGap(path,old.s,p.s);
    const end=gs+advanceR-advanceP;
    if(Math.min(gs,end)>half[0]||Math.max(gs,end)<-half[0])return null;
    const da=prev.d-old.d,db=r.d-p.d;
    if(Math.min(da,db)>half[1]||Math.max(da,db)<-half[1])return null;
    return sweepBox([gs,da,prev.h-old.h],[end,db,r.h-p.h],half);
  }
  function collect(){
    for(const r of sim.racers){
      r.wBoxTouch ||= [];
      const oldTouch=r.wBoxTouch.slice();
      sim.weaponBoxes.forEach((b,i)=>{r.wBoxTouch[i]=pathId(sim,r.path)===b.path&&Math.abs(pathGap(r.path,b.s,r.s))<=4&&Math.abs(r.d-b.d)<=4&&Math.abs(r.h-1)<=3;});
      if(!activeRacer(r)||r.wpn||!hot(r)||r.h>3.5)continue;
      const prev=previous.get(r.id);if(!prev||prev.path!==r.path)continue;
      for(const [i,b]of sim.weaponBoxes.entries()){
        if(oldTouch[i]||pathId(sim,r.path)!==b.path||(r.wBoxAt[i]||0)>sim.time)continue;
        const a=pathGap(r.path,b.s,prev.s),end=a+pathGap(r.path,prev.s,r.s);
        if(sweepBox([a,prev.d-b.d,prev.h-1],[end,r.d-b.d,r.h-1],[4.0,4.0,3.0])===null)continue;
        // One grant per row pass, even when a lateral sweep crosses both boxes.
        sim.weaponBoxes.forEach((other,j)=>{if(other.row===b.row)r.wBoxAt[j]=sim.time+WPN.BOX_COOLDOWN;});
        const rank=sim.racers.filter(o=>o.prog>r.prog).length/Math.max(1,sim.racers.length);
        r.wpn=sim.predictOnly&&sim.weaponSlice!==1?9:rollWeapon(seed,r.id,r.lap,i,rank,sim.weaponSlice);r.wpnAt=sim.time;
        const wait=sim.diff==='hard'?.25:.8,spread=sim.diff==='hard'?.35:.8;
        r.wAIAt=sim.time+wait+spread*weaponHash(seed,r.id,r.lap,i+80);
        sim.events?.weaponPickup?.(r,r.wpn);break;
      }
    }
  }
  function missiles(h){
    const st=sim.weaponState,keep=[];
    for(const p of st.shots){
      const path=pathOf(sim,p.path);if(!path)continue;
      const old={s:p.s,d:p.d,h:p.h};p.age+=h;
      p.warned ||= {};
      for(const r of sim.racers){if(r.id===p.owner||!activeRacer(r)||r.path!==path)continue;const g=pathGap(path,p.s,r.s);if(g>=-5&&g<=200&&p.warned[r.id]===undefined)p.warned[r.id]=sim.time;}

      const target=sim.racers.find(r=>r.id===p.target);
      const targetPrev=target&&previous.get(target.id);
      if(!target||!activeRacer(target)||pathId(sim,target.path)!==p.path||targetPrev?.path!==target.path)p.target=null;
      if(p.target){p.d+=clamp(target.d-p.d,-WPN.TURN_SPEED*h,WPN.TURN_SPEED*h);p.h+=clamp(target.h-p.h,-2*h,2*h);}
      let adv=p.speed*h;
      // Don't overtake a locked target before the usable-warning fuse floor.
      if(p.target&&(p.age<(p.arm||WPN.ARM)||sim.time-(p.warned[target.id]??sim.time)<WPN.ARM+Math.max(0,target.wNetLead||0))){const g=pathGap(path,p.s,target.s);if(g>=0)adv=Math.min(adv,Math.max(0,g-4.5));}
      p.s=path.closed?mod(p.s+adv,path.L):p.s+adv;
      let impact=null;
      // Obstacles and traffic block a missile even while the fuse is cold.
      for(const o of sim.obstacles){if(p.path!==0)continue;
        const gs=pathGap(path,old.s,o.s),end=gs-adv;
        const t=sweepBox([gs,o.d-old.d,1-old.h],[end,o.d-p.d,1-p.h],[o.hl+.7,o.hw+.5,o.h/2+1]);
        if(t!==null&&(!impact||t<impact.t))impact={t,result:'detonated',r:null};
      }
      for(const d of sim.drones){if(p.path!==0)continue;const gs=pathGap(path,old.s,d.s);
        const t=sweepBox([gs,d.d-old.d,d.h-old.h],[gs-adv,d.d-p.d,d.h-p.h],[3.3,1.9,1.6]);
        if(t!==null&&(!impact||t<impact.t))impact={t,result:'detonated',r:null};
      }
      if(p.age>=(p.arm||WPN.ARM))for(const r of sim.racers){
        if(r.id===p.owner||!activeRacer(r))continue;
        if(p.warned[r.id]===undefined||sim.time-p.warned[r.id]<WPN.ARM+Math.max(0,r.wNetLead||0))continue;
        const t=sweepRacer(p,old,r,[3.3,1.9,1.6]);
        if(t!==null&&(!impact||t<impact.t))impact={t,result:r.wImmT>0?'immune':'hit',r};
      }
      if(impact){if(impact.r&&impact.result==='hit')effect(impact.r,1,p.owner,p.id);else emit(1,p.owner,impact.r,impact.result,p.id);continue;}
      if(p.age>=WPN.MISSILE_LIFE||(!path.closed&&(p.s<0||p.s>path.L))){emit(1,p.owner,null,'expired',p.id);continue;}
      keep.push(p);
    }
    st.shots=keep;
  }
  function mines(h){
    const keep=[];
    for(const p of sim.weaponState.mines){
      p.age+=h;if(p.age>=WPN.MINE_LIFE){emit(2,p.owner,null,'expired',p.id);continue;}
      let hit=null;
      if(p.age>=WPN.MINE_ARM)for(const r of sim.racers){
        if(!activeRacer(r)||r.wImmT>0||r.h>2.6)continue;
        const t=sweepRacer(p,p,r,[3.8,2.6,1.6]);if(t!==null&&(!hit||t<hit.t))hit={r,t};
      }
      if(hit)effect(hit.r,2,p.owner,p.id);else keep.push(p);
    }
    sim.weaponState.mines=keep;
    sim.weaponState.pulses=(sim.weaponState.pulses||[]).filter(p=>(p.age+=h)<.5);
  }
  function bots(){
    for(const r of sim.racers){
      if(!r.isAI||!activeRacer(r)||!r.wpn||sim.time<r.wAIAt)continue;
      const target=softLock(sim,r);r.lockId=target?.id??null;
      if(r.wpn===1){if(!target)continue;if(!target.isAI&&sim.time-target.wLastHit<6)continue;if(sim.diff==='hard'&&(target.shieldT>0||target.wImmT>0))continue;}
      else if(r.wpn===2){
        if(sim.time-r.wpnAt<1)continue;
        if(sim.diff==='hard'&&!sim.racers.some(o=>o!==r&&activeRacer(o)&&o.path===r.path&&pathGap(r.path,r.s,o.s)<-30&&pathGap(r.path,r.s,o.s)>-120&&Math.abs(o.d-r.d)<4))continue;
      }else if(r.wpn===3){
        const nearby=sim.racers.filter(o=>o!==r&&activeRacer(o)&&o.path===r.path&&o.wImmT<=0&&pathGap(r.path,r.s,o.s)>=-WPN.EMP_BEHIND&&pathGap(r.path,r.s,o.s)<=WPN.EMP_AHEAD);
        if(!nearby.length)continue;if(sim.diff==='hard'&&nearby.length<2&&!nearby.some(o=>o.boost))continue;
        if(nearby.some(o=>!o.isAI&&sim.time-o.wLastHit<6))continue;
      }
      fire(r);r.wAIAt=sim.time+.5;
    }
  }
  function step(h){
    if(!enabled())return;
    for(const r of sim.racers){
      const prev=previous.get(r.id);
      if(prev&&prev.path===r.path&&activeRacer(r))r.wDistance+=Math.max(0,Math.min(150*h+5,pathGap(r.path,prev.s,r.s)));
      if(!sim.predictOnly && sim.stepIndex%6===0){r.lockId=softLock(sim,r)?.id??null;r.wThreats=sim.weaponState.shots.filter(p=>p.warned?.[r.id]!==undefined && pathOf(sim,p.path)===r.path && pathGap(r.path,p.s,r.s)>=-5 && pathGap(r.path,p.s,r.s)<=200).length;}
    }
    collect();
    if(!sim.predictOnly){actions();bots();missiles(h);mines(h);}
  }
  return {begin,step,fire,queue,effect,hot,canFire,reset(){pending.clear();previous.clear();sim.weaponState=newWeaponState();},snapshotPending:()=>[...pending].map(([id,q])=>[id,[...q.values()]]),restorePending(a=[]){pending.clear();for(const[id,rows]of a)pending.set(id,new Map(rows.map(a=>[a[0],a])));}};
}

// Compact wire entities. Presentation-only visibility never changes authoritative collision.
export function encodeWeaponEntities(sim, viewerId, cache = null) {
  const ids=sim.racers.map(r=>r.id),r=sim.racers.find(r=>r.id===viewerId),all=sim.weaponState.shots.concat(sim.weaponState.mines,sim.weaponState.pulses||[]);
  const visible=all.filter(p=>{if(!r)return true;if(p.owner===r.id||p.target===r.id)return true;const path=pathOf(sim,p.path);return path===r.path&&Math.abs(pathGap(path,r.s,p.s))<=200;});
  const priority=p=>p.target===viewerId?0:p.owner===viewerId?1:2;
  visible.sort((a,b)=>priority(a)-priority(b)||Math.abs(pathGap(pathOf(sim,a.path),r.s,a.s))-Math.abs(pathGap(pathOf(sim,b.path),r.s,b.s))||a.id-b.id);
  return visible.slice(0,6).map(p=>cache?.get(p.id) || [
    p.id,p.kind,ids.indexOf(p.owner),p.path,+p.s.toFixed(2),+p.d.toFixed(2),+p.h.toFixed(2),p.target?ids.indexOf(p.target):-1,+p.age.toFixed(2),+(p.speed||0).toFixed(1),p.aid||0
  ]);
}
export function decodeWeaponEntities(rows,ids){return(rows||[]).map(a=>({id:a[0],kind:a[1],owner:ids[a[2]],path:a[3],s:a[4],d:a[5],h:a[6],target:ids[a[7]]??null,age:a[8],speed:a[9],aid:a[10]}));}
const EVENT_RESULTS=['fired','hit','blocked','detonated','expired','immune'];
export function encodeWeaponEvents(sim,viewer,cursor){const ids=sim.racers.map(r=>r.id);return sim.weaponState.events.filter(e=>e.id>cursor&&e.result!=='fired'&&(e.owner===viewer||e.victim===viewer)).map(e=>[e.id,e.kind,e.step,ids.indexOf(e.owner),ids.indexOf(e.victim),EVENT_RESULTS.indexOf(e.result),e.shot]);}
export function decodeWeaponEvents(rows,ids){return(rows||[]).map(a=>({id:a[0],kind:a[1],step:a[2],owner:ids[a[3]]??null,victim:ids[a[4]]??null,result:EVENT_RESULTS[a[5]],shot:a[6]}));}
