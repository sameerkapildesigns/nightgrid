import { createServer } from 'vite';
import { mkdirSync,writeFileSync } from 'node:fs';
import { launch } from './harness.mjs';
const out=process.env.NG_EVIDENCE_DIR||'test-results/r41-flow';mkdirSync(out,{recursive:true});
const server=await createServer({mode:'test',server:{host:'127.0.0.1',port:4191,strictPort:true},logLevel:'error'});await server.listen();
const browser=await launch();
const results=[];
try{
 const page=await browser.newPage({viewport:{width:1280,height:720}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route(/fonts\.(googleapis|gstatic)\.com/,r=>r.abort());await page.goto('http://127.0.0.1:4191/');
 await page.waitForFunction(()=>window.NG_DEBUG?.state==='title'&&!document.getElementById('go').disabled,null,{timeout:120000});
 await page.evaluate(()=>{__ng.manualClock(true);__ng.start();});
 await page.waitForFunction(()=>NG_DEBUG.state==='intro',null,{timeout:60000});
 await page.keyboard.press('Enter');await page.evaluate(()=>__ng.sim(3.4));
 // A real rendered right-hand bank, with steering/body and chase roll active.
 const pose=await page.evaluate(()=>{
  const p=__ng.player;Object.assign(p,{s:325,d:0,psi:0,va:80,vd:0,speed:80,autopilot:false,h:1,vh:0,vl:0,roll:0,yawV:0});Object.assign(__ng.keys,{up:1,right:.2,left:0});
  __ng.sim(.25);__ng.render();const M=__ng.MAIN,i=Math.round(p.s/M.ds)%M.N,t=M.T[i],u=M.U[i],a=M.T[(i+M.N-4)%M.N],b=M.T[(i+4)%M.N],q=t.z*(b.x-a.x)-t.x*(b.z-a.z);
  return {s:p.s,roadInward:(u.x*t.z-u.z*t.x)*Math.sign(q),bodyRoll:p.roll,cameraUp:__ng.camera.up.toArray(),state:NG_DEBUG.state};
 });
 if(pose.roadInward<=0||pose.bodyRoll>=0)throw Error(JSON.stringify(pose));results.push(pose);
 await page.screenshot({path:`${out}/velocity-inward-bank.png`});
 const left=await page.evaluate(()=>{
  const p=__ng.player;Object.assign(p,{s:1220,d:0,psi:0,va:80,vd:0,speed:80,autopilot:false,h:1,vh:0,vl:0,roll:0,yawV:0});Object.assign(__ng.keys,{up:1,right:0,left:.2});
  __ng.sim(.25);__ng.render();const M=__ng.MAIN,i=Math.round(p.s/M.ds)%M.N,t=M.T[i],u=M.U[i],a=M.T[(i+M.N-4)%M.N],b=M.T[(i+4)%M.N],q=t.z*(b.x-a.x)-t.x*(b.z-a.z);
  return{s:p.s,roadInward:(u.x*t.z-u.z*t.x)*Math.sign(q),bodyRoll:p.roll,state:NG_DEBUG.state};
 });
 if(left.roadInward<=0||left.bodyRoll<=0)throw Error(JSON.stringify(left));results.push(left);
 await page.screenshot({path:`${out}/velocity-left-bank.png`});
 // Finish using the existing deterministic test hooks, then use the visible Next map button.
 await page.evaluate(()=>{const p=__ng.player,L=__ng.MAIN.L;Object.assign(__ng.keys,{up:0,right:0,left:0});p.lap=NG_DEBUG.map.laps-1;p.autopilot=true;p.pers={vmax:92,lat:84,acc:26,brake:46,off:0,short:0,aggr:0,block:0,boostUse:0,margin:4};p.s=(60-120+L)%L;p.prevS=p.s;p.lastRd=L-120;p.prog=(p.lap+1)*L-120;p.speed=80;p.va=80;p.lapTimes=Array(p.lap).fill(40);p.lapValid=Array(p.lap).fill(false);__ng.sim(4);});
 await page.keyboard.press('Enter');await page.evaluate(()=>__ng.sim(.2));
 await page.waitForSelector('#results:not(.hide)');
 await page.waitForFunction(() => +getComputedStyle(document.getElementById('results')).opacity > .99 && +getComputedStyle(document.getElementById('cine')).opacity < .01);
 if(!/Kage/.test(await page.locator('#nextMap').innerText()))throw Error('Wrong next map');
 await page.screenshot({path:`${out}/results-next-map.png`});
 await page.click('#nextMap');
 await page.waitForFunction(()=>__ng.map==='technical'&&['intro','countdown','race'].includes(NG_DEBUG.state),null,{timeout:60000});
 results.push({nextMap:'technical',state:await page.evaluate(()=>NG_DEBUG.state)});
 if(errors.length)throw Error(errors.join('\n'));
 writeFileSync(`${out}/results.json`,JSON.stringify({results,errors},null,2));console.log(JSON.stringify({results,errors}));
}finally{await browser.close();await server.close();}
