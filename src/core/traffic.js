// Traffic keeps a continuous along-road route. Unsafe stretches fade out well
// before ramps/inversions, with contact disabled for the entire fade.
import {mod,smooth} from './math.js';
export function trafficProfile(td){
 const M=td.MAIN,N=M.N,unsafe=new Uint8Array(N),dist=new Float32Array(N);dist.fill(1e6);
 const ramps=td.ramps?.length?td.ramps.map(r=>[r.lip-80,r.landB+100]):['casino','summit'].includes(td.key)?(td.rampZones||[]):[];
 for(let i=0;i<N;i++){
  const s=i*M.ds;
  unsafe[i]=M.U[i].y<.82||Math.abs(M.T[i].y)>.22||M.KN[i]<-.012||ramps.some(([a,b])=>s>=a&&s<=b)?1:0;
  if(unsafe[i])dist[i]=0;
 }
 // Circular nearest-unsafe distance, independent of RNG and client frame rate.
 for(let j=0;j<N*2;j++){const i=j%N,prev=mod(i-1,N);dist[i]=Math.min(dist[i],dist[prev]+M.ds);}
 for(let j=N*2-1;j>=0;j--){const i=j%N,next=(i+1)%N;dist[i]=Math.min(dist[i],dist[next]+M.ds);}
 return {alpha:Float32Array.from(dist,d=>smooth(Math.max(0,Math.min(1,(d-35)/65)))),N,ds:M.ds,L:M.L};
}
export function trafficAlpha(profile,s){const f=mod(s,profile.L)/profile.ds,i=Math.floor(f)%profile.N,t=f-Math.floor(f);return profile.alpha[i]*(1-t)+profile.alpha[(i+1)%profile.N]*t;}
export function trafficStarts(profile,count=7){
 const candidates=[];
 for(let i=0;i<profile.N;i+=5){const s=i*profile.ds,g=mod(s-60,profile.L);if(profile.alpha[i]>=.99&&g>320&&g<profile.L-160)candidates.push(s);}
 if(!candidates.length)return Array.from({length:count},(_,i)=>mod(440+i*profile.L/count,profile.L));
 return Array.from({length:count},(_,i)=>candidates[Math.floor((i+.35)*candidates.length/count)]);
}
