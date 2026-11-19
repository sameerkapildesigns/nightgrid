// Original circuits. Explicit offline-solved pieces, no runtime closure connector.
import {TRK} from './track.js';
const PI=Math.PI;
const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*t*(10+t*(-15+6*t));};
const rise=(s,a,b)=>smooth((s-a)/(b-a));
function turnProgress(u){const e=.12;return u<e?u*u/(2*e*(1-e)):u>1-e?1-(1-u)**2/(2*e*(1-e)):(u-e/2)/(1-e);}
// Unlike the old accumulated-roll pieces, bank is an absolute on-camber target.
function circuit(pieces,height){
 let x=0,z=0,psi=0,s=0;const dense=[];
 for(const pc of pieces){const n=Math.ceil(pc.len/.25),ds=pc.len/n;
  for(let k=0;k<n;k++){
   const u=(k+.5)/n,ang=psi+(pc.yaw||0)*turnProgress(u);
   x+=Math.sin(ang)*ds;z+=Math.cos(ang)*ds;s+=ds;
   const y=height(s),grade=(height(s+.1)-height(s-.1))/.2,theta=Math.atan(grade);
   const f=TRK.frameOf(ang,theta,(pc.bank||0)*Math.min(1,u/.2,(1-u)/.2));
   dense.push({p:[x,y,z],U:f.U,sec:pc.sec,w:pc.w,tag:pc.tag||0});
  }psi+=pc.yaw||0;
 }
 const closure=Math.hypot(x,z,height(s));if(closure>.02)throw Error('unsolved circuit closure '+closure);
 const main=TRK.finalize([{p:[0,height(0),0],U:[0,1,0],sec:0,w:14,tag:0},...dense.slice(0,-1)],true);main.marks={};return{main,branch:null};
}
export function buildCasino(){
 const p=(len,yaw=0,bank=0,sec=0,w=12)=>({len,yaw,bank,sec,w});
 const pieces=[p(450,0,0,0,14),p(400,PI/2,.35,0,14),p(300),p(650,3*PI/2,.6,1),p(119.00236518,0,0,1),p(220,-PI/2,-.4,2),p(88.94189912,0,0,2),p(220,-PI/2,-.4,2),p(612.05573569,0,0,2),p(90,.8,.3,3,10.5),p(90,-.8,-.3,3,10.5),p(90,-.8,-.3,3,10.5),p(90,.8,.3,3,10.5),p(200,0,0,3),p(180,PI,.4,3),p(400,0,0,3)];
 // The carousel and atrium return bridge both earlier crossings with 24 m clearance.
 return highRoller(circuit(pieces,s=>24*(rise(s,1150,1800)-rise(s,2700,3000))));
}
export const NEW_TRACK_INTERNALS={circuit,turnProgress};

function highRoller(raw){
 const M=raw.main,a=Math.round(2500/M.ds),b=Math.round(2900/M.ds),off=22,dense=[];
 for(let i=a;i<=b;i++){const u=(i-a)/(b-a),h=8*Math.sin(PI*u)**2;dense.push({p:M.P[i].map((x,k)=>x+off*M.R[i][k]+h*M.U[i][k]),U:M.U[i].slice(),sec:2,w:8,tag:0});}
 const branch=TRK.finalize(dense,false);branch.sA=a;branch.sB=b;branch.off=off;return{...raw,branch};
}
export function buildSummit(){
 const p=(len,yaw=0,bank=0,sec=0,w=12,tag=0)=>({len,yaw,bank,sec,w,tag});
 const pieces=[p(420,0,0,0,14),p(480,PI/2,.3,0,14),p(180,PI,.4,1),p(180,0,0,1),p(180,-PI,-.4,1),p(200,0,0,1),p(180,PI,.4,1),p(180,0,0,1),p(180,-PI,-.4,1),p(200,0,0,1),p(300,0,0,2),p(350.00002368,PI/2,.35,3),p(100.02802974,0,0,3),p(390.17722233,PI/2,.35,3),p(201.00310586,0,0,3),p(500,-PI/2,-.35,3),p(220,0,0,3,12,1),p(250,0,0,3),p(180,PI,.4,3),p(1028.74735988,0,0,3)];
 // Arcology ascent and return. Initial prototype is longer than the plan's 5 km target.
 const gradeRise=(s,a,b)=>{const t=Math.max(0,Math.min(1,(s-a)/(b-a))),e=.04;return t<e?t*t/(2*e*(1-e)):t>1-e?1-(1-t)**2/(2*e*(1-e)):(t-e/2)/(1-e);};
 return circuit(pieces,s=>180*(gradeRise(s,100,2500)-gradeRise(s,2800,5200))); 
}
