// R4 original drift circuit. Half-turn symmetry closes the plan exactly, no seam connector.
import{NEW_TRACK_INTERNALS}from'./new-tracks.js';
const PI=Math.PI;
export function buildDrift(){
  const p=(len,yaw=0,bank=0,sec=0)=>({len,yaw,bank,sec,w:12.5});
  const half=[p(180),p(130,1.1,.18),p(200,-2.2,-.22),p(130,1.1,.18),p(65),p(190,PI/2,.2),p(85),p(190,PI/2,.2),p(90),p(150,.9,.16),p(150,-.9,-.16)];
  const pieces=[...half.map((p,i)=>({...p,sec:i<5?0:1})),...half.map((p,i)=>({...p,sec:i<5?2:3}))];
  return NEW_TRACK_INTERNALS.circuit(pieces,()=>0);
}

// R4 Velocity: keep the released route identity, introduce another flowing S-complex,
// then make banking local rather than accumulating132 degrees for half the lap.
import{TRK}from'./track.js';
export function buildVelocityR4(){
  const a=TRK.DEFS.velocity().map(p=>({...p,roll:0}));
  a[0].len=144.47449154082;a[2].len=193.99995631943;
  a[9]={...a[9],len:170,yaw:-.7};a.splice(10,0,{len:250,yaw:1.4,sec:1,w:14},{len:170,yaw:-.7,sec:1,w:14});
  a.find(p=>p.pitch>6).len=230;a.find(p=>p.pitch>6).shift=52;
  const barrel=a.find(p=>p.len===250&&!p.pitch&&p.sec===2);barrel.roll=PI*2;barrel.len=170;
  const raw=TRK.turtle(a,{p:[0,0,0],psi:0});
  let offset=0;
  for(const pc of a){const n=Math.ceil(pc.len/.25);if(pc.yaw){const bank=-Math.sign(pc.yaw)*Math.min(.5,Math.abs(pc.yaw)*.32);for(let k=0;k<n;k++){const d=raw.out[offset+k],prev=raw.out[Math.max(0,offset+k-1)],next=raw.out[Math.min(raw.out.length-1,offset+k+1)],t=TRK.v.norm(TRK.v.sub(next.p,prev.p)),ang=bank*Math.sin(PI*(k+.5)/n)**2;d.U=TRK.v.norm(TRK.v.add(TRK.v.mul(d.U,Math.cos(ang)),TRK.v.mul(TRK.v.cross(t,d.U),Math.sin(ang))));}}offset+=n;}
  const main=TRK.finalize([{p:[0,0,0],U:[0,1,0],sec:0,w:14,tag:0},...raw.out.slice(0,-1)],true);main.marks={};return{main,branch:null};
}

const ease=t=>{t=Math.max(0,Math.min(1,t));return t*t*t*(10+t*(-15+6*t));};
function hump(s,a,peak,b,h){return s<a||s>b?0:s<peak?h*ease((s-a)/(peak-a)):h*(1-ease((s-peak)/(b-peak)));}
export function buildKageR4(){
  const old=TRK.assembleCustom(TRK.DEFS.technical()).main,scale=1.35;
  const ramps=[[430,610,800,18],[1360,1590,1810,25],[2220,2310,2400,14]];
  const dense=[];
  for(let i=0;i<old.N;i++)for(let j=0;j<6;j++){const u=j/6,p=old.P[i].map((v,c)=>v+(old.P[(i+1)%old.N][c]-v)*u),s=(i+u)*old.ds*scale,y=p[1]+ramps.reduce((v,r)=>v+hump(s,...r),0)+6*Math.exp(-(((s-610)/25)**2))+7*Math.exp(-(((s-1590)/28)**2));dense.push({p:[p[0]*scale,y,p[2]*scale],U:[0,1,0],sec:old.sec[i],w:10.5,tag:old.tag[i]});}
  const main=TRK.finalize(dense,true);main.marks={};return{main,branch:null,rampZones:ramps.map(r=>[r[0]-30,r[2]+90])};
}

export function buildCasinoR4(){
  const p=(len,yaw=0,bank=0)=>({len,yaw,bank,sec:0,w:14});
  const half=[p(260),p(150,.9,.3),p(240,-1.8,-.42),p(150,.9,.3),p(600),p(250,PI/2,.48),p(180),p(250,PI/2,.48),p(200),p(160,.8,.28),p(160,-.8,0)];
  const halfL=half.reduce((v,p)=>v+p.len,0),pieces=[...half,...half].map((p,i)=>({...p,sec:i<4?0:i<half.length?1:i<half.length+5?2:3}));
  const hills=[[800,1090,1400,150],[halfL+800,halfL+1100,halfL+1400,110]];
  const raw=NEW_TRACK_INTERNALS.circuit(pieces,s=>hills.reduce((v,r)=>v+hump(s,...r),0)+15*Math.exp(-(((s-1090)/40)**2)));
  const M=raw.main,a=Math.round((halfL+35)/M.ds),b=Math.round((halfL+245)/M.ds),off=24,dense=[];
  for(let i=a;i<=b;i++){const u=(i-a)/(b-a),h=14*Math.sin(PI*u)**2;dense.push({p:M.P[i].map((x,k)=>x+off*M.R[i][k]+h*M.U[i][k]),U:M.U[i].slice(),sec:2,w:8,tag:0});}
  const branch=TRK.finalize(dense,false);branch.sA=a;branch.sB=b;branch.off=off;
  return{...raw,branch,rampZones:hills.map(r=>[r[0]-40,r[2]+90])};
}

export function buildSummitR4(){
  const data=[[474.2857608854954,0,0,0,14,0],[480,1.5707963267948966,0.3,0,14,0],[180,3.141592653589793,0.4,1,12,0],[180,0,0,1,12,0],[180,-3.141592653589793,-0.4,1,12,0],[200,0,0,1,12,0],[180,3.141592653589793,0.4,1,12,0],[180,0,0,1,12,0],[180,-3.141592653589793,-0.4,1,12,0],[200,0,0,1,12,0],[300.0000040728307,0,0,2,12,0],[350.00002368,1.5707963267948966,0.35,3,12,0],[100.02802974,0,0,3,12,0],[390.17722233,1.5707963267948966,0.35,3,12,0],[201.00310586,0,0,3,12,0],[500,-1.5707963267948966,-0.35,3,12,0],[220,0,0,3,12,1],[250,0,0,3,12,0],[180,3.141592653589793,0.4,3,12,0],[200,-0.65,-0.23,3,12,0],[300,1.3,0.32,3,12,0],[200,-0.65,-0.23,3,12,0],[328.74735988,0,0,3,12,0]];
  const pieces=data.map(([len,yaw,bank,sec,w,tag])=>({len,yaw,bank,sec,w,tag}));
  const rise=(s,a,b)=>ease((s-a)/(b-a));
  const height=s=>180*(rise(s,140,1750)-rise(s,1950,3200))+hump(s,3650,3930,4220,65)+hump(s,4850,5080,5370,35);
  const raw=NEW_TRACK_INTERNALS.circuit(pieces,height);return{...raw,rampZones:[[3850,4120],[4980,5250]]};
}
