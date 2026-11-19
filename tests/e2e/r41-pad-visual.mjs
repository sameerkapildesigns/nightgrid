import{createServer}from'vite';import{mkdirSync,writeFileSync}from'node:fs';import{launch}from'./harness.mjs';
const out=process.env.NG_EVIDENCE_DIR||'test-results/r41-pads';mkdirSync(out,{recursive:true});
const server=await createServer({mode:'test',server:{host:'127.0.0.1',port:4191,strictPort:true},logLevel:'error'});await server.listen();const browser=await launch();
try{
 const page=await browser.newPage({viewport:{width:1100,height:700}});await page.route(/fonts\.(googleapis|gstatic)\.com/,r=>r.abort());await page.goto('http://127.0.0.1:4191/');await page.waitForFunction(()=>window.NG_DEBUG?.state==='title'&&!document.getElementById('go').disabled,null,{timeout:120000});
 await page.evaluate(()=>{__ng.manualClock(true);__ng.start();});await page.waitForFunction(()=>NG_DEBUG.state==='intro');await page.keyboard.press('Enter');await page.evaluate(()=>__ng.sim(3.4));
 const results=[];
 for(const extra of [false,true]){
  const result=await page.evaluate(extra=>{
   const sim=__ng.simCore,p=sim.pads.find(p=>p.kind==='B'&&!!p.extra===extra),M=__ng.MAIN;
   sim.ghost=true;sim.drones=[];sim.obstacles=[];
   for(const r of sim.racers)Object.assign(r,{path:M,s:p.s,d:p.d,h:1,vh:0,va:0,vd:0,speed:0,psi:0,surgeT:0,padTouch:{}});
   __ng.sim(.05);__ng.render();
   const i=Math.round(p.s/M.ds)%M.N,center=M.P[i].clone().addScaledVector(M.R[i],p.d),camera=__ng.camera;
   camera.position.copy(center).addScaledVector(M.T[i],-22).addScaledVector(M.U[i],20).addScaledVector(M.R[i],12);camera.up.copy(M.U[i]);camera.lookAt(center.x,center.y,center.z);camera.updateMatrixWorld();__ng.renderer.setRenderTarget(null);__ng.renderer.clear();__ng.renderer.render(__ng.scene,camera);
   document.getElementById('hud').style.visibility='hidden';
   return{extra,readyAt:p.readyAt,grants:sim.racers.map(r=>r.surgeT>0)};
  },extra);
  if(result.readyAt!==0||result.grants.some(x=>!x))throw Error(JSON.stringify(result));results.push(result);
  await page.screenshot({path:`${out}/${extra?'green':'gold'}-after-all-racers.png`});
 }
 writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await browser.close();await server.close();}
