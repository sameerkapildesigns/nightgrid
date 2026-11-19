// Circuit-specific visual landmarks. No physics or shared simulation state.
import * as THREE from 'three';
import {mergeGeometries}from'three/addons/utils/BufferGeometryUtils.js';
export function buildCircuitLandmarks({THEME,MAIN:M},world){
 if(!['casino','summit'].includes(THEME.key))return;
 const families=new Map(),mat={dark:new THREE.MeshStandardMaterial({color:0x17202c,roughness:.7,metalness:.45}),gold:new THREE.MeshBasicMaterial({color:new THREE.Color(3.2,1.6,.25),toneMapped:false}),red:new THREE.MeshBasicMaterial({color:new THREE.Color(3.2,.2,.3),toneMapped:false}),ice:new THREE.MeshBasicMaterial({color:new THREE.Color(1.6,2.6,3.2),toneMapped:false})};
 const add=(g,k)=>{if(!families.has(k))families.set(k,[]);families.get(k).push(g);};
 const box=(x,y,z,w,h,d,k,ry=0)=>add(new THREE.BoxGeometry(w,h,d).rotateY(ry).translate(x,y,z),k);
 const station=s=>{const i=Math.round(s/M.ds)%M.N;return{p:M.P[i],t:M.T[i],u:M.U[i],r:M.R[i],i};};
 const offset=(f,d,h)=>f.p.clone().addScaledVector(f.r,d).addScaledVector(f.u,h);
 if(THEME.key==='casino'){
  // A static roulette-wheel landmark inside the carousel, with readable gold/crimson spokes.
  const f=station(1475),center=f.p.clone().addScaledVector(new THREE.Vector3(f.r.x,0,f.r.z).normalize(),-120),q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),.35);
  center.y=f.p.y+48;
  add(new THREE.TorusGeometry(38,1.1,5,64).applyQuaternion(q).translate(center.x,center.y,center.z),'gold');
  for(let i=0;i<24;i++){const a=i*Math.PI/12,v=new THREE.Vector3(Math.sin(a)*38,Math.cos(a)*38,0).applyQuaternion(q);box(center.x+v.x,center.y+v.y,center.z+v.z,3.2,3.2,2,i%2?'red':'gold');const g=new THREE.BoxGeometry(.45,38,.45).translate(0,19,0).rotateZ(-a).applyQuaternion(q).translate(center.x,center.y,center.z);add(g,i%2?'red':'gold');}
  box(center.x,center.y-35,center.z,5,70,5,'dark');
  // Giant signs and orbital rings stay outside the road/airborne envelope.
  const safe=(p,rad,bottom,top)=>M.P.every((v,i)=>i%5||Math.hypot(v.x-p.x,v.z-p.z)>rad+22||v.y<bottom-10||v.y>top+18);
  for(const [k,s]of[700,1050,1500,2150,3400,4000,4700].entries()){
    const f=station(s),p=offset(f,k%2?105:-105,0),bottom=Math.max(0,p.y-80),h=130+(k%3)*45;
    if(safe(p,30,bottom,bottom+h)){box(p.x,bottom+h/2,p.z,45,h,45,'dark',k*.23);box(p.x,bottom+h+2,p.z,50,3,50,'gold');for(let j=0;j<4;j++)box(p.x-22+j*14,bottom+h/2,p.z-23,2,h,1,'red');}
  }
  for(const [k,s]of[1000,1800,3300,4300].entries()){const f=station(s),p=offset(f,k%2?85:-85,75);if(safe(p,36,p.y-36,p.y+36))add(new THREE.TorusGeometry(32,1.2,5,56).rotateY(Math.atan2(f.t.x,f.t.z)).translate(p.x,p.y,p.z),k%2?'red':'gold');}
  for(let s=50;s<M.L;s+=45)for(const d of[-18,18]){const f=station(s),p=offset(f,d,2.4);box(p.x,p.y,p.z,.7,.7,.7,'gold');}
 }else{
  // Terraced structural mountain, respecting lower roads at the crossover.
  for(let s=900;s<2900;s+=85){const f=station(s),p=offset(f,0,-27),h=Math.max(1,p.y);if(h<5)continue;const clear=M.P.every((v,i)=>i%7||Math.abs(v.x-p.x)>46||Math.abs(v.z-p.z)>46||v.y>p.y+18);if(clear)box(p.x,h/2,p.z,75,h,75,'dark');}
  for(const [j,s]of[2500,2580,2660,2740].entries()){const f=station(s),p=offset(f,j%2?55:-55,0),cy=p.y+36;box(p.x,p.y+18,p.z,2.2,36,2.2,'dark');box(p.x,cy,p.z,2,2,2,'red');for(let k=0;k<3;k++)add(new THREE.BoxGeometry(.7,21,1.1).translate(0,10.5,0).rotateZ(k*Math.PI*2/3+.3).translate(p.x,cy,p.z),'ice');}
  for(let s=900;s<2600;s+=65)for(const d of[-18,18]){const f=station(s),p=offset(f,d,3);box(p.x,p.y,p.z,.4,6,.4,'dark');box(p.x,p.y+3,p.z,2,.25,.8,'ice');}
 }
 for(const [k,gs]of families){const g=mergeGeometries(gs,false),mesh=new THREE.Mesh(g,mat[k]);mesh.name='circuit-'+THEME.key+'-'+k;world.add(mesh);for(const x of gs)x.dispose();}
}
