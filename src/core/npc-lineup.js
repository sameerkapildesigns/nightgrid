// Presentation lineup uses an isolated RNG, never the simulation's physics stream.
import { mulberry32 } from './math.js';
import { CAR_KEYS,RIVAL_ORDER } from './roster.js';
export const NPC_NAMES=['NOVA','FLUX','RIFT','ECHO','ION','ONYX','APEX','CIPHER','KIRA','ORBIT','PULSE','LYNX','EMBER','ZEN','VECTOR','RUNE','ASTRA','LUX','NERO','QUARK','SOL','VOLT','YUKI','ZERO'];
export function npcLineup(seed,count=5){
 const rnd=mulberry32((seed|0)^0x51ca77),names=NPC_NAMES.slice(),cars=CAR_KEYS.slice();
 const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
 shuffle(names);shuffle(cars);
 return Array.from({length:Math.max(0,Math.min(7,count))},(_,i)=>({name:names[i]+' #'+String(Math.floor(rnd()*100)).padStart(2,'0'),persKey:RIVAL_ORDER[i%3],car:cars[i%cars.length]}));
}
