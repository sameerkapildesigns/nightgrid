// R4 synthetic voices, waveform mixes are design choices, not a listening-quality certification.
export const ENGINE_PROFILES=Object.freeze({
  hypercar:{base:52,rise:132,throttle:14,boost:40,ratio:.5,offset:.9,primary:'sawtooth',secondary:'sawtooth',mix:.26,whine:680,whineRise:1600,body:1,air:.8,filter:1.1},
  endurance:{base:39,rise:106,throttle:12,boost:28,ratio:.501,offset:.4,primary:'sawtooth',secondary:'sawtooth',mix:.38,whine:440,whineRise:1200,body:1.1,air:.6,filter:.85},
  wedge:{base:62,rise:156,throttle:10,boost:48,ratio:1.5,offset:.9,primary:'sawtooth',secondary:'triangle',mix:.2,whine:850,whineRise:1800,body:.88,air:.85,filter:1.3},
  rally:{base:31,rise:86,throttle:15,boost:24,ratio:.5,offset:1.7,primary:'square',secondary:'sawtooth',mix:.3,whine:340,whineRise:850,body:.95,air:.4,filter:.8},
  streamliner:{base:45,rise:118,throttle:8,boost:36,ratio:1.002,offset:.2,primary:'triangle',secondary:'sawtooth',mix:.24,whine:720,whineRise:2000,body:.88,air:1.15,filter:1},
  wipeout:{base:80,rise:158,throttle:6,boost:62,ratio:2,offset:0,primary:'sine',secondary:'sawtooth',mix:.2,whine:940,whineRise:2200,body:.75,air:1.45,filter:1.2},
  kestrel:{base:68,rise:142,throttle:9,boost:55,ratio:3.003,offset:.6,primary:'triangle',secondary:'square',mix:.16,whine:1180,whineRise:2500,body:.8,air:1.25,filter:1.3},
  manta:{base:56,rise:106,throttle:5,boost:44,ratio:1.502,offset:.2,primary:'triangle',secondary:'sine',mix:.4,whine:540,whineRise:1750,body:.85,air:1.55,filter:.95}
});
export function engineVoice(key,speed=0,throttle=0,boost=0){
  const p=ENGINE_PROFILES[key]||ENGINE_PROFILES.hypercar;
  const s=Math.max(0,Math.min(1.5,speed)),t=Math.max(0,Math.min(1,throttle)),b=Math.max(0,Math.min(1,boost));
  const fundamental=p.base+s*p.rise+t*p.throttle+b*p.boost;
  return{...p,fundamental,secondaryHz:fundamental*p.ratio+p.offset,whineHz:p.whine+s*p.whineRise+b*700,cutoff:(220+s*1600+t*500+b*1800)*p.filter};
}
 
