import test from 'node:test';import assert from 'node:assert/strict';import WebSocket from 'ws';
import {startLocalServer}from'../../server/local.mjs';import{NetClient}from'../../src/net/client.js';import{waitFor}from'./scenario.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('R4.1 real sockets: simultaneous racers both get permanent gold/green arrows; bottle stays first-racer-only', {timeout:20000},async()=>{
 const srv=await startLocalServer({port:0,log:false,room:{countdownMs:100,maxRaceMs:30000}});const clients=[];
 try{
  const code=(await(await fetch(srv.url+'/api/rooms',{method:'POST'})).json()).code;
  for(let i=0;i<2;i++){const c=new NetClient({wsUrl:srv.url.replace('http','ws'),WebSocketImpl:WebSocket,now:()=>performance.now(),build:srv.build,name:'P'+i});c.connect(code);clients.push(c);await waitFor(()=>c.you,3000,'welcome');}
  const [a,b]=clients;a.config({map:'velocity',mode:'expert'});a.ready(true);b.ready(true);await waitFor(()=>a.room?.canStart,3000,'ready');a.start();
  const room=srv.rooms.get(code);await waitFor(()=>clients.every(c=>c.race)&&room.sim?.phase==='race',5000,'race');
  const s=room.sim;s.ghost=true;s.drones=[];s.obstacles=[];s.weapons=false;
  const original=s.pads.slice();
  const put=(r,p)=>Object.assign(r,{path:s.track.MAIN,s:p.s,d:p.d,h:1,vh:0,va:0,vd:0,speed:0,psi:0,yawV:0,surgeT:0,meter:0,padTouch:{},finished:false});
  for(const extra of [false,true]){
   const p=original.find(p=>p.kind==='B'&&!!p.extra===extra);assert.ok(p);s.pads=[p];for(const r of s.racers)put(r,p);
   await waitFor(()=>s.racers.every(r=>r.surgeT>1),2000,'both server grants');assert.equal(p.readyAt,0);
   await waitFor(()=>clients.every(c=>c.race.last?.a.find(r=>r[0]===c.you)?.[16]&2),2000,'both confirmed surge snapshots');
   console.log(extra?'green: both server-confirmed client grants':'gold: both server-confirmed client grants');
   for(const r of s.racers){r.s=p.s+40;r.surgeT=0;}await sleep(80);
  }
  const can=original.find(p=>p.kind==='R'&&!p.br);s.pads=[can];for(const r of s.racers)put(r,can);
  await waitFor(()=>can.readyAt>s.time,2000,'bottle consumed');assert.ok(s.racers[0].meter>.3);assert.ok(s.racers[1].meter<.01);console.log('bottle: first racer only');
 }finally{for(const c of clients)c.leave();await srv.close();}
});
