import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inPoly,distanceToLine,registerRoute} from '../js/waterfront-data.js';
import {makeRoute,atDistance} from '../js/movement.js';
const d=JSON.parse(readFileSync('assets/waterfront.json')),city=JSON.parse(readFileSync('assets/downtown.json'));
const faults={water:[],buildings:[],boats:[]};
const isLand=(x,z)=>d.land.some(p=>inPoly(x,z,p));
assert(isLand(1800,-1450),'Jardine must stand on land');assert(!isLand(1800,-1210),'opening between Jardine and Navy Pier');assert(isLand(1600,-1075),'pier deck');assert(!isLand(1100,750),'Monroe Harbor');
const replacement=new Set(d.replacementIds),buildings=city.buildings.filter(b=>!replacement.has(b.id));
for(const path of d.paths.filter(p=>p.mode!=='none')){
 const r=makeRoute(path.points),wet=[],hit=new Set();
 for(let s=0;s<=r.length;s+=2){const p=atDistance(r,s);if(!isLand(p.x,p.z)&&path.kind!=='bridge')wet.push([Math.round(p.x),Math.round(p.z)]);
 for(const b of buildings)if(p.y<b.h&&inPoly(p.x,p.z,b.rings))hit.add(b.id);
 for(const a of d.anchors.filter(a=>['glass','dark','brick','hall','hotel','ballroom','rock','shell'].includes(a.kind)))if(p.y<a.h+3&&Math.abs(p.x-a.x)<a.w/2&&Math.abs(p.z-a.z)<a.d/2)hit.add(a.id);
 }
 if(wet.length)faults.water.push({id:path.id,count:wet.length,first:wet[0],last:wet.at(-1)});
 if(hit.size)faults.buildings.push({id:path.id,hit:[...hit]});
}
for(const [x,z]of d.boats)if(isLand(x,z))faults.boats.push([x,z]);
assert.equal(new Set(d.paths.map(p=>p.id)).size,d.paths.length);
const ctx={};registerRoute(ctx,'park',[[0,0,0],[1,0,0]]);registerRoute(ctx,'pier',[[2,0,0],[3,0,0]]);assert.equal(ctx.routes.size,2);assert.throws(()=>registerRoute(ctx,'park',[]));
for(const [x,z]of d.trees){assert(isLand(x,z));assert(!d.features.filter(f=>['pool','play','sand'].includes(f.kind)).some(f=>f.polygons.some(p=>inPoly(x,z,p))),'tree in pool, playground or beach');assert(!d.paths.some(p=>p.mode!=='none'&&distanceToLine(x,z,p.points.map(v=>[v[0],v[2]]))<p.width/2+2),'tree on route');}
console.log(JSON.stringify(faults,null,2));
assert.equal(faults.water.length+faults.buildings.length+faults.boats.length,0,'waterfront routes and boats must stay in their correct spaces');
assert.equal(readFileSync('assets/waterfront.json','utf8'),readFileSync('docs/assets/waterfront.json','utf8'));
console.log('PASS: peninsula, harbor openings, routes, boats, trees, registry and published geography');
