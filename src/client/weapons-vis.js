import * as THREE from 'three';
import { WEAPON_NAMES } from '../core/weapons.js';
const m=new THREE.Matrix4(),x=new THREE.Vector3(),scale=new THREE.Vector3(),c=new THREE.Color();
function put(mesh,i,path,s,d,h,size,spin=0){
  const k=Math.max(0,Math.min(path.N-1,Math.round(s/path.ds)%path.N)),P=path.P[k],U=path.U[k],R=path.R[k],T=path.T[k];
  x.copy(R).negate();m.makeBasis(x,U,T);if(spin)m.multiply(new THREE.Matrix4().makeRotationY(spin));
  m.scale(scale.set(size,size,size));m.setPosition(P.x+R.x*d+U.x*h,P.y+R.y*d+U.y*h,P.z+R.z*d+U.z*h);mesh.setMatrixAt(i,m);
}
export function createWeaponVis({WORLD,sim}){
  const reduced=!!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const group=new THREE.Group();group.name='WEAPONS';WORLD.add(group);
  const material=new THREE.MeshBasicMaterial({color:0xff625a,toneMapped:false});
  const boxes=new THREE.InstancedMesh(new THREE.OctahedronGeometry(1.2,0),new THREE.MeshBasicMaterial({color:0xffb64c,wireframe:true,toneMapped:false}),Math.max(1,sim.weaponBoxes.length));
  const shots=new THREE.InstancedMesh(new THREE.ConeGeometry(.4,3,5).rotateX(Math.PI/2),material,20);
  const mines=new THREE.InstancedMesh(new THREE.OctahedronGeometry(1.2,0),material.clone(),20);
  const rings=new THREE.InstancedMesh(new THREE.TorusGeometry(2,.12,4,20).rotateX(Math.PI/2),new THREE.MeshBasicMaterial({color:0x5bddff,toneMapped:false}),40);
  group.add(boxes,shots,mines,rings);
  for(const mesh of[boxes,shots,mines,rings])mesh.frustumCulled=false; // Dynamic instance positions outlive the initial empty bounding sphere.
  function update(){
    group.visible=sim.weapons;
    if(!sim.weapons)return;
    boxes.count=sim.weaponBoxes.length;
    sim.weaponBoxes.forEach((b,i)=>{const p=b.path?sim.track.BR:sim.track.MAIN;const ready=!(sim.player?.wBoxAt[i]>sim.time);put(boxes,i,p,b.s,b.d,2,ready?1:.25,reduced?0:sim.time);});
    shots.count=Math.min(20,sim.weaponState.shots.length);sim.weaponState.shots.slice(0,20).forEach((p,i)=>put(shots,i,p.path?sim.track.BR:sim.track.MAIN,p.s,p.d,p.h,1));
    mines.count=Math.min(20,sim.weaponState.mines.length);sim.weaponState.mines.slice(0,20).forEach((p,i)=>put(mines,i,p.path?sim.track.BR:sim.track.MAIN,p.s,p.d,.8,1));
    rings.count=0;for(const p of sim.weaponState.mines.slice(0,20)){const size=p.age<.8?reduced?.8:.7+.3*Math.sin(p.age*12):1;put(rings,rings.count++,p.path?sim.track.BR:sim.track.MAIN,p.s,p.d,.15,size);}
    for(const p of(sim.weaponState.pulses||[]).slice(0,20))put(rings,rings.count++,p.path?sim.track.BR:sim.track.MAIN,p.s,p.d,.15,1+p.age*8);for(const o of[boxes,shots,mines,rings])o.instanceMatrix.needsUpdate=true;
  }
  update();return{group,update};
}
export function updateWeaponHUD(sim,p,{enabled,racing,online=false,pending=false,camera=null,warningTone=null}={}){
  const button=document.getElementById('fireWeapon'),slot=document.getElementById('weaponSlot'),notice=document.getElementById('weaponWarning'),target=document.getElementById('weaponTarget');
  const on=!!enabled&&racing&&document.getElementById('pause').classList.contains('hide');button.hidden=slot.hidden=notice.hidden=target.hidden=!on;document.body.classList.toggle('empLocked',on&&p?.empT>0);if(!on||!p)return;
  const cold=!sim.weaponHot(p),name=pending?'PENDING':p.wpn===9?'ROLLING':WEAPON_NAMES[p.wpn]||'EMPTY';
  const glyph=p.wpn===1?'↑':p.wpn===2?'⬡':p.wpn===3?'≋':'·';
  button.classList.toggle('cold',cold);button.classList.toggle('armed',!!p.wpn&&!cold);button.setAttribute('aria-label',`Fire ${name.toLowerCase()}`);button.textContent=pending?'…':cold?'LOCK':glyph;
  button.classList.toggle('target',!!p.lockId&&p.wpn===1);
  const victim=sim.racers.find(r=>r.id===p.lockId);target.hidden=true;if(p.wpn===1&&victim&&camera){const screen=victim.world.clone().project(camera);if(screen.z>-1&&screen.z<1&&Math.abs(screen.x)<.96&&Math.abs(screen.y)<.9){target.hidden=false;target.style.left=(screen.x*.5+.5)*100+'%';target.style.top=(-screen.y*.5+.5)*100+'%';}}
  slot.textContent=`${cold?'COLD':name}${document.body.classList.contains('touchmode')?'':' · F'}`;
  const incoming=sim.weaponState.shots.filter(s=>s.target===p.id);notice.textContent=p.empT>0?'EMP · BOOST LOCKED':(incoming.length||p.wThreats)?'MISSILE INCOMING':'';notice.hidden=!notice.textContent;
  if((incoming.length||p.wThreats)&&performance.now()-(notice._toneAt||0)>800){notice._toneAt=performance.now();warningTone?.();}
}
