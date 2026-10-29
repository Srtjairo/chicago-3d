import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import clip from './vendor/polygon-clipping.cjs';
import {siteVolumes} from '../js/site-data.js';
import {inPoly,distanceToLine} from '../js/waterfront-data.js';
import {makeRoute,atDistance} from '../js/movement.js';
const data=JSON.parse(readFileSync('assets/sites.json')),city=JSON.parse(readFileSync('assets/downtown.json')),park=JSON.parse(readFileSync('assets/waterfront.json'));
const area=multi=>multi.reduce((sum,rings)=>sum+rings.reduce((a,r,j)=>a+(j?-1:1)*Math.abs(r.reduce((s,p,i)=>{const q=r[(i+1)%r.length];return s+p[0]*q[1]-q[0]*p[1];},0)/2),0),0);
const rectangle=p=>[[[p.x0,p.z0],[p.x1,p.z0],[p.x1,p.z1],[p.x0,p.z1],[p.x0,p.z0]]];
assert.equal(new Set(data.replacementIds).size,data.replacementIds.length);
for(const id of data.replacementIds)assert(city.buildings.some(b=>b.id===id),id);
const occupied=city.buildings.filter(b=>!data.replacementIds.includes(b.id)&&b.id!=='889662-0');
const overlaps=[];
for(const s of data.sites)for(const p of siteVolumes({sites:[s]}))for(const b of occupied){const a=area(clip.intersection(rectangle(p),b.rings));if(a>1.5)overlaps.push({site:s.id,part:p.id,id:b.id,area:Math.round(a*10)/10});}
console.log({overlaps});assert.equal(overlaps.length,0,'new masses overlap retained source buildings');
const volumes=siteVolumes(data);for(const r of data.routes){const route=makeRoute(r.points);for(let d=0;d<route.length;d+=1){const p=atDistance(route,d);assert(!volumes.some(b=>p.x>b.x0&&p.x<b.x1&&p.z>b.z0&&p.z<b.z1),r.id+' in new structure');assert(!occupied.some(b=>inPoly(p.x,p.z,b.rings)),r.id+' in retained building');}}
assert(data.parking.length<=64);for(const p of data.parking){const lot=data.surfaces.find(f=>f.id===p.lot);assert(lot?.kind==='parking'&&inPoly(p.x,p.z,lot.rings),'parked car outside identified lot');assert(!occupied.some(b=>inPoly(p.x,p.z,b.rings)),'parked car in building');}
assert.equal(park.anchors.find(a=>a.kind==='agora').count,106);assert.equal(park.anchors.filter(a=>a.kind==='diamond').length,16);assert.equal(park.anchors.filter(a=>a.sport==='tennis').length,6);assert.equal(park.anchors.filter(a=>a.sport==='pickleball').length,14);
for(const a of park.anchors.filter(a=>a.kind==='court'))assert(!park.trees.some(t=>Math.abs(t[0]-a.x)<a.w/2+2&&Math.abs(t[1]-a.z)<a.d/2+2),'tree in southern court');
for(const f of park.features.filter(f=>f.id.startsWith('south-')&&['skate','dog','clay','ballast'].includes(f.kind)))assert(!park.trees.some(t=>f.polygons.some(p=>inPoly(t[0],t[1],p))),'tree in '+f.id);
assert.equal(readFileSync('assets/sites.json','utf8'),readFileSync('docs/assets/sites.json','utf8'));
console.log('PASS: explicit replacements, no building overlaps, site routes, parked spaces, southern courts, 106 Agora figures and published site registry');
