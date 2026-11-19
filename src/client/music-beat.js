// Bounded bass-energy envelope. No timers or guessed beats.
export function bassEnergy(bins,sampleRate,fftSize){
  const hz=sampleRate/fftSize,lo=Math.max(1,Math.ceil(40/hz)),hi=Math.min(bins.length-1,Math.floor(190/hz));
  let sum=0,n=0;for(let i=lo;i<=hi;i++){const v=bins[i]/255;sum+=v*v;n++;}
  return n?Math.sqrt(sum/n):0;
}
export function smoothBeat(prev,energy,dt,active=true){
  if(!active)return 0;
  const target=Math.max(0,Math.min(1,energy));
  return prev+(target-prev)*(1-Math.exp(-Math.min(.1,Math.max(0,dt))*(target>prev?22:7)));
}
export const beatGlow=beat=>1+.38*Math.max(0,Math.min(1,beat));

// Remove the moving bass floor so sustained notes do not pin lights at full brightness.
export function bassOnset(average,energy,dt){
  const a=average+(energy-average)*(1-Math.exp(-Math.min(.1,Math.max(0,dt))*3));
  return{average:a,target:Math.max(0,Math.min(1,(energy-a)*8))};
}
