import {createServer} from 'vite';
import {mkdirSync,writeFileSync} from 'node:fs';
import {launch} from './harness.mjs';
const out=process.env.NG_EVIDENCE_DIR||'/tmp/r5-comfort-evidence';mkdirSync(out,{recursive:true});
const server=await createServer({mode:'test',server:{host:'127.0.0.1',port:4193,strictPort:true},logLevel:'error'});await server.listen();
const browser=await launch();
try{
 const page=await browser.newPage({viewport:{width:1366,height:768}});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/shader|WebGL|THREE/.test(m.text()))errors.push(m.text());});
 await page.addInitScript(()=>localStorage.setItem('nightgrid_v4_settings',JSON.stringify({blur:2,shake:true,quality:'battery',mode:'expert',music:true})));
 await page.route(/fonts\.(googleapis|gstatic)\.com/,r=>r.abort());await page.goto('http://127.0.0.1:4193/');
 await page.waitForFunction(()=>NG_DEBUG?.state==='title'&&!document.getElementById('go').disabled,null,{timeout:120000});
 await page.evaluate(()=>{__ng.manualClock(true);});
 await page.click('#homeMore summary');await page.click('#setBtn');await page.waitForSelector('#setComfort');await page.locator('#setComfort').scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/settings.png`});
 const initial=await page.evaluate(()=>({setting:NG_DEBUG.speedFx.setting}));
 if(!initial.setting.comfort||initial.setting.blur!==0||initial.setting.shake)throw Error(JSON.stringify(initial));
 await page.locator('[data-comfort="0"]').click();if((await page.evaluate(()=>NG_DEBUG.speedFx.setting.comfort))!==false)throw Error('Dynamic control failed');await page.locator('[data-comfort="1"]').click();
 await page.evaluate(()=>{document.getElementById('setPanel').classList.add('hide');__ng.start();});await page.waitForFunction(()=>NG_DEBUG.state==='intro',null,{timeout:120000});await page.keyboard.press('Enter');await page.evaluate(()=>__ng.sim(3.4));
 const lineup=await page.evaluate(()=>__ng.racers.filter(r=>r.isAI).map(r=>({name:r.name,car:r.ship.key,asset:r.ship.fallback})));if(lineup.some(r=>r.asset||!r.car||/^(GHOST|VEX|BLITZ)/.test(r.name)))throw Error(JSON.stringify(lineup));
 const race=await page.evaluate(()=>{const p=__ng.player;Object.assign(p,{s:350,d:0,va:90,vd:0,speed:90,h:1,vh:0,psi:0});Object.assign(__ng.keys,{up:1,boost:1});__ng.sim(.5);__ng.render();return NG_DEBUG.speedFx;});
 if(race.fov>73.2)throw Error(JSON.stringify(race));await page.screenshot({path:`${out}/boost-comfort.png`});if(errors.length)throw Error(errors.join('\n'));
 writeFileSync(`${out}/results.json`,JSON.stringify({initial,race,lineup,errors},null,2));console.log(JSON.stringify({initial,race,lineup,errors}));
}finally{await browser.close();await server.close();}
