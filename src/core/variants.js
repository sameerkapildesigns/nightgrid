// Data-space variants, never negative scene scale. Legacy fork transforms stay unsupported.
export function transformTrack(raw,vr,sectors){
  const mirror=!!(vr&1),reverse=!!(vr&2);if(!mirror&&!reverse)return raw;
  if(raw.branch)throw new Error('unsupported-variant');
  const a=raw.main,N=a.N,start=Math.round(60/a.ds),out={...a};
  for(const k of ['P','T','U','R','W','sec','tag'])out[k]=[];
  out.KG=new Float32Array(N);out.KN=new Float32Array(N);
  for(let j=0;j<N;j++){
    const i=reverse?((2*start-j)%N+N)%N:j;
    const p=a.P[i].slice(),t=a.T[i].map(x=>reverse?-x:x),u=a.U[i].slice();
    if(mirror){p[0]*=-1;t[0]*=-1;u[0]*=-1;}
    const r=[t[1]*u[2]-t[2]*u[1],t[2]*u[0]-t[0]*u[2],t[0]*u[1]-t[1]*u[0]];
    out.P.push(p);out.T.push(t);out.U.push(u);out.R.push(r);out.W.push(a.W[i]);out.tag.push(a.tag[i]);out.sec.push(reverse?(sectors-a.sec[i])%sectors:a.sec[i]);
    out.KG[j]=a.KG[i]*(mirror?-1:1)*(reverse?-1:1);out.KN[j]=a.KN[i];
  }
  return{...raw,main:out};
}
export function variantLabel(vr=0){return[vr&4?'Night':'',vr&1?'Mirrored':'',vr&2?'Reverse':''].filter(Boolean).join(' · ');}
export function validVariant(map,vr){return Number.isInteger(vr)&&vr>=0&&vr<=7&&!(map==='legacy'&&(vr&3))&&!(['casino','summit'].includes(map)&&vr!==0);}
