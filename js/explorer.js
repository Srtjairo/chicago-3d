import * as THREE from 'three';
import { LANDMARKS } from './geo.js';
import { COVERAGE } from './coverage.js';
export const DISTRICTS={
  southpark:{name:'South Grant Park',pos:[1050,660,1850],target:[595,5,1305]},
  fulton:{name:'Fulton Market',pos:[-2450,290,-390],target:[-2040,28,-670]},
  willisbase:{name:'Willis Tower base',pos:[-744,99,453],target:[-670,18,389]},
  river:{name:'River & bridges',pos:[420,245,-420],target:[-100,65,-640]},
  loop:{name:'The Loop',pos:[-1000,420,1050],target:[-230,65,170]},
  avenue:{name:'Michigan Avenue',pos:[580,210,-560],target:[285,75,-1180]},
  park:{name:'Millennium Park',pos:[850,230,340],target:[430,20,-70]},
  harbors:{name:'Harbors & beaches',pos:[2440,1350,-260],target:[1110,5,-990]},
  lake:{name:'Lakefront skyline',pos:[2400,520,1300],target:[150,140,-450]},
};
export function setupExplorer({ctx,camera,controls,flyer,ui}){
  const host=document.createElement('section');host.className='explore glass';host.setAttribute('aria-label','Explore Chicago');
  host.innerHTML='<label for="district">Explore a district</label><select id="district"><option value="">Choose a view</option>'+Object.entries(DISTRICTS).map(([id,d])=>`<option value="${id}">${d.name}</option>`).join('')+'</select><div class="explore-actions"><button id="life-toggle" type="button" aria-pressed="false">Pause city life</button><button id="map-toggle" type="button" aria-expanded="false" aria-controls="orientation">Map</button></div><div id="orientation" hidden><canvas id="mini-map" width="320" height="220" aria-label="Downtown map with camera position and north at the top"></canvas><p>North ↑ · River blue · View red</p></div><button id="sources-open" type="button">About this model</button>';
  document.body.append(host);
  const district=host.querySelector('#district'),life=host.querySelector('#life-toggle');
  district.onchange=()=>{const d=DISTRICTS[district.value];if(!d)return;flyer.cancel();ui.setTouring(false);ui.hideInfo();flyer.flyTo(new THREE.Vector3(...d.pos),new THREE.Vector3(...d.target),3);};
  const syncLife=()=>{life.setAttribute('aria-pressed',String(ctx.life.paused));life.textContent=ctx.life.paused?'Resume city life':'Pause city life';};
  syncLife();life.onclick=()=>{ctx.life.paused=!ctx.life.paused;syncLife();};
  const orientation=host.querySelector('#orientation');host.querySelector('#map-toggle').onclick=(e)=>{orientation.hidden=!orientation.hidden;e.currentTarget.setAttribute('aria-expanded',String(!orientation.hidden));};
  const canvas=host.querySelector('canvas'),draw=canvas.getContext('2d');
  const px=x=>(x-COVERAGE.minX+100)/(COVERAGE.maxX-COVERAGE.minX+200)*320,pz=z=>(z-Math.min(COVERAGE.minZ,ctx.waterfront.bounds.minZ)+100)/(COVERAGE.maxZ-Math.min(COVERAGE.minZ,ctx.waterfront.bounds.minZ)+200)*220;
  const base=document.createElement('canvas');base.width=320;base.height=220;const b=base.getContext('2d');
  b.fillStyle='#1e2a31';b.fillRect(0,0,320,220);
  b.strokeStyle='#53616a';b.lineWidth=.65;
  for(const r of ctx.roads){b.beginPath();r.path.forEach((p,i)=>i?b.lineTo(px(p[0]),pz(p[2])):b.moveTo(px(p[0]),pz(p[2])));b.stroke();}
  b.fillStyle='#416d7c';
  for(const water of ctx.data.water){b.beginPath();for(const ring of water.rings){ring.forEach(([x,z],i)=>i?b.lineTo(px(x),pz(z)):b.moveTo(px(x),pz(z)));b.closePath();}b.fill('evenodd');}
  for(const f of ctx.waterfront.features){b.fillStyle={grass:'#61875c',sand:'#cdb887',pool:'#416d7c',paving:'#777d73'}[f.kind]||'#88927b';for(const rings of f.polygons){b.beginPath();for(const ring of rings){ring.forEach(([x,z],i)=>i?b.lineTo(px(x),pz(z)):b.moveTo(px(x),pz(z)));b.closePath();}b.fill('evenodd');}}
  b.strokeStyle='#9ba88c';b.lineWidth=.5;for(const path of ctx.waterfront.paths.filter(p=>p.mode!=='none')){b.beginPath();path.points.forEach(([x,y,z],i)=>i?b.lineTo(px(x),pz(z)):b.moveTo(px(x),pz(z)));b.stroke();}
  for(const s of ctx.sites.sites){b.fillStyle='#8e9899';b.beginPath();s.rings[0].forEach(([x,z],i)=>i?b.lineTo(px(x),pz(z)):b.moveTo(px(x),pz(z)));b.closePath();b.fill();}
  b.fillStyle='#e3d2ac';for(const l of LANDMARKS){b.beginPath();b.arc(px(l.x),pz(l.z),1.6,0,Math.PI*2);b.fill();}
  const dialog=document.createElement('dialog');dialog.id='model-about';dialog.innerHTML='<form method="dialog"><button class="about-close" aria-label="Close about this model">×</button></form><h2>A living model of Chicago</h2><p>Explore downtown architecture from the river to the lake. Traffic, walkers, cyclists, boats, and trains are illustrative animations.</p><p>Building footprints and measured heights: <a href="https://gis.cookcountyil.gov/traditional/rest/services/buildingFootprint_2022/MapServer/0" target="_blank" rel="noopener">Cook County GIS, 2022 lidar and imagery</a>. Streets and water: <a href="https://data.cityofchicago.org/d/pr57-gg9e" target="_blank" rel="noopener">City of Chicago</a>. Geographic data is simplified; measured heights may include rooftop equipment. Landmark forms and heights are curated separately.</p><p>This site provides applications using data that has been modified for use from its original source, www.cityofchicago.org, the official website of the City of Chicago.</p><p>Architectural references: <a href="https://www.architecture.org/online-resources/buildings-of-chicago" target="_blank" rel="noopener">Chicago Architecture Center</a>, <a href="https://www.skyscrapercenter.com" target="_blank" rel="noopener">The Skyscraper Center</a>, and <a href="https://www.themart.com/about/" target="_blank" rel="noopener">THE MART</a>.</p><p>Waterfront landscape details follow the <a href="https://navypier.org/plan-your-visit/navy-pier-map/" target="_blank" rel="noopener">Navy Pier map</a> and <a href="https://www.chicagoparkdistrict.com/lakefront-trail" target="_blank" rel="noopener">Park District trail maps</a>. Gardens, trees and boats illustrate a typical summer day; landscape dimensions are visual estimates.</p><p>Southern Grant Park includes the existing courts, skate plaza and 106 Agora figures. Fulton Market adds completed office buildings through October 2026. Facade details and new-building setbacks are visual estimates from architects and owners; parked cars are illustrative occupancy of identified lots.</p><p>City data is packaged with this site. No live location or transit tracking.</p>';
  document.body.append(dialog);host.querySelector('#sources-open').onclick=()=>dialog.showModal();
  let timer=0;
  return {update(dt){timer-=dt;if(timer>0||orientation.hidden)return;timer=.1;draw.drawImage(base,0,0);draw.strokeStyle='#ef6658';draw.lineWidth=1.5;draw.beginPath();draw.moveTo(px(camera.position.x),pz(camera.position.z));draw.lineTo(px(controls.target.x),pz(controls.target.z));draw.stroke();draw.fillStyle='#ff796a';draw.beginPath();draw.arc(px(camera.position.x),pz(camera.position.z),3.2,0,Math.PI*2);draw.fill();}};
}
