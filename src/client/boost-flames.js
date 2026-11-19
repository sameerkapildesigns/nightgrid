// Compact nozzle-attached flames, not long camera-space trails. No extra lights.
import * as THREE from 'three';
export function attachBoostFlames(ship){
 const flames=[];
 for(const emitter of ship.emitters||[]){
  const group=new THREE.Group();group.name='BoostFlame';group.visible=false;
  const make=(radius,length,color,opacity)=>{
   const geo=new THREE.ConeGeometry(radius,length,7,1,true);geo.translate(0,length/2,0);geo.rotateX(-Math.PI/2);
   const mat=new THREE.MeshBasicMaterial({color,transparent:true,opacity,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,toneMapped:false});
   const mesh=new THREE.Mesh(geo,mat);mesh.frustumCulled=false;group.add(mesh);
  };
  const sz=Math.min(1.3,emitter.userData.sz||1);
  make(.20*sz,1.65*sz,0x167dff,.52);make(.095*sz,.95*sz,0xaefaff,.88);
  emitter.add(group);flames.push(group);
 }
 ship.boostFlames=flames;
 return flames;
}
export function updateBoostFlames(ship,on,speed,time){
 let n=0;for(const flame of ship.boostFlames||[]){flame.visible=!!on&&speed>4;flame.scale.z=.88+.10*Math.sin(time*31+n++*1.7);}
}
