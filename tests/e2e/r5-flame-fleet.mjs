import {createServer} from 'vite';
import {mkdirSync,writeFileSync} from 'node:fs';
import {launch} from './harness.mjs';
const out='/tmp/r5-flame-fleet';mkdirSync(out,{recursive:true});const server=await createServer({mode:'test',server:{host:'127.0.0.1',port:4194,strictPort:true},logLevel:'error'});await server.listen();const browser=await launch();
try{
 const page=await browser.newPage({viewport:{width:1000,height:600}});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/shader|THREE|WebGL/.test(m.text()))errors.push(m.text());});await page.addInitScript(()=>localStorage.setItem('nightgrid_v4_settings',JSON.stringify({quality:'battery'})));await page.route(/fonts\.(googleapis|gstatic)\.com/,r=>r.abort());await page.goto('http://127.0.0.1:4194/');await page.waitForFunction(()=>NG_DEBUG?.state==='title'&&!document.getElementById('go').disabled,null,{timeout:120000});await page.evaluate(()=>__ng.manualClock(true));
 const results=[];
 for(const car of ['hypercar','endurance','wedge','rally','streamliner','wipeout','kestrel','manta']){
  await page.evaluate(k=>{NG_DEBUG.qa.exit();NG_DEBUG.qa.select(k);},car);await page.waitForFunction(k=>NG_DEBUG.assets[k]?.status==='ok',car,{timeout:120000});
  const r=await page.evaluate(()=>{NG_DEBUG.qa.boostDemo();const p=__ng.player;Object.assign(p,{s:180,d:0,h:1,vh:0,psi:0,va:90,speed:90,vd:0,rollAI:0,drift:false});__ng.sim(.1);__ng.render();const sh=p.ship;const rays=sh.boostFlames.map(f=>{const origin=f.getWorldPosition(f.position.clone()),tip=f.localToWorld(f.position.clone().set(0,0,-1));return tip.sub(origin).normalize().dot(p.F);});return{car:sh.key,fallback:sh.fallback,flames:sh.boostFlames.length,active:sh.boostFlames.every(f=>f.visible),rays};});
  if(r.fallback||!r.flames||!r.active||r.rays.some(v=>v>-.9))throw Error(JSON.stringify(r));results.push(r);await page.screenshot({path:`${out}/${car}.png`});
 }
 if(errors.length)throw Error(errors.join('\n'));writeFileSync(`${out}/results.json`,JSON.stringify({results,errors},null,2));console.log(JSON.stringify({results,errors}));
}finally{await browser.close();await server.close();}
