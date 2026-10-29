import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makeRoute,atDistance,offsetPath,signalGreen,canCross,trimRoute} from '../js/movement.js';
import {LANDMARKS} from '../js/geo.js';
import {COVERAGE_RECTS,COVERAGE,inCoverage,project,unproject} from '../js/coverage.js';
const data=JSON.parse(readFileSync(new URL('../assets/downtown.json',import.meta.url),'utf8'));
assert.equal(data.version,1);assert(data.buildings.length>2500);assert(data.streets.length>1500);
assert.equal(new Set(data.buildings.map(b=>b.id)).size,data.buildings.length);
assert.equal(new Set(data.streets.map(s=>s.id)).size,data.streets.length,'overlap must not duplicate road segments');
assert.deepEqual(data.coverage,COVERAGE_RECTS,'imported coverage and runtime coverage must agree');
assert(inCoverage(-2200,-800));assert(inCoverage(-1775,-800));assert(inCoverage(0,0));
assert(!inCoverage(-2200,0),'extension must not fill the entire western strip');
assert.deepEqual(project(unproject([-2145.5,-794.1])),[-2145.5,-794.1]);
for(const id of ['relativity','ondean']){
  const l=LANDMARKS.find(l=>l.id===id);assert(l?.collision&&l.facts&&l.listMeta,id);
  assert(inCoverage(l.x,l.z),id);assert(l.x>COVERAGE.minX&&l.x<COVERAGE.maxX,'office must be on orientation map');
  for(const id of l.footprintIds){const b=data.buildings.find(b=>b.id===id);assert(b,`missing office footprint ${id}`);
    const xs=b.rings[0].map(p=>p[0]),zs=b.rings[0].map(p=>p[1]);
    assert(l.x>=Math.min(...xs)&&l.x<=Math.max(...xs)&&l.z>=Math.min(...zs)&&l.z<=Math.max(...zs),'office center must be within its source footprint bounds');
  }
}
assert(LANDMARKS.find(l=>l.id==='relativity').facts.some(([k,v])=>k==='Office'&&v==='20th floor'));
assert.equal(LANDMARKS.find(l=>l.id==='ondean').year,undefined,'do not invent an opening date');
const tourSource=readFileSync(new URL('../js/tour.js',import.meta.url),'utf8');
const tourIds=[...tourSource.match(/const TOUR = \[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map(m=>m[1]);
assert.deepEqual(tourIds,['grantpark','fountain','board','willis','riverside','mart','marina','trump','wrigley','tribune','hancock','navypier','stregis','aqua','aon','carbide','pritzker','bean'],'the guided tour must stay unchanged');
for(const b of data.buildings){
  assert(b.h>=2&&b.h<600,`invalid height ${b.id}`);
  for(const ring of b.rings){assert(ring.length>=4,b.id);assert(ring.flat().every(Number.isFinite),b.id);assert.deepEqual(ring[0],ring.at(-1),`unclosed footprint ${b.id}`);}
}
// The survey includes Willis's antenna. A missed feet-to-metres conversion would exceed 1700 m.
assert(data.buildings.find(b=>b.id==='889662-0').h>500&&data.buildings.find(b=>b.id==='889662-0').h<540);
for(const s of data.streets){assert(s.points.length>1,s.id);assert(s.points.flat().every(Number.isFinite),s.id);}
// The added street network must connect Carpenter/Kinzie to downtown through
// real shared source nodes, not merely sit inside overlapping rectangles.
const roads=data.streets.filter(s=>s.class>=1&&s.class<=4&&!/LOWER|RAMP|EXPY/.test(s.road)&&s.level.every(h=>h>=0)&&s.points.every(([x,z])=>inCoverage(x,z,80)));
const adjacency=new Map(),nodes=new Map();
for(const s of roads){for(const [id,other,p] of [[s.from,s.to,s.points[0]],[s.to,s.from,s.points.at(-1)]]){if(!adjacency.has(id))adjacency.set(id,new Set());adjacency.get(id).add(other);nodes.set(id,p);}}
const nearby=roads.filter(s=>s.road==='CARPENTER'&&s.points.some(([x,z])=>Math.hypot(x+2145.5,z+794.05)<90));
assert(nearby.length,'Carpenter frontage road missing');
const reached=new Set([nearby[0].from]),queue=[...reached];for(let i=0;i<queue.length;i++)for(const id of adjacency.get(queue[i])||[])if(!reached.has(id)){reached.add(id);queue.push(id);}
assert([...reached].some(id=>{const [x,z]=nodes.get(id);return x>-800&&x<0&&z>-1000&&z<500;}),'Fulton Market roads must connect to the Loop');
const expected=['aqua','tribune','carbide','mart','board','riverside'];
for(const id of expected){const l=LANDMARKS.find(l=>l.id===id);assert(l&&l.roof>100&&l.r>0,id);}
const route=makeRoute([[0,0,0],[0,0,30],[40,0,30]]);
assert.equal(route.length,70);
assert.deepEqual([atDistance(route,45).x,atDistance(route,45).z],[15,30]);
assert.equal(atDistance(route,-5).z,0);assert.equal(atDistance(route,100).x,40);
const ramp=makeRoute([[0,0,0],[0,4,12]]);assert(Math.abs(atDistance(ramp,ramp.length/2).y-2)<1e-9);
const repeated=makeRoute([[0,0,0],[0,0,0],[10,0,0]]);assert(Number.isFinite(atDistance(repeated,0).angle));
const lane=offsetPath([[0,0,0],[0,0,-100]],3);assert.equal(lane[0][0],3,'northbound traffic keeps right');
const opposite=offsetPath([[0,0,-100],[0,0,0]],3);assert.equal(opposite[0][0],-3);
assert.equal(makeRoute(trimRoute(route.points,10,10)).length,50);
assert.equal(trimRoute([[0,0,0],[0,0,10]],6,6),null);
for(let id=0;id<8;id++)for(let t=0;t<100;t+=.125)assert(!(signalGreen(t,0,id)&&signalGreen(t,1,id)),'conflicting green signals');
for(let t=0;t<40;t+=.25)for(const axis of [0,1])if(canCross(t,axis,0,14))for(let dt=0;dt<14;dt+=.5)assert(!signalGreen(t+dt,axis,0),'pedestrian clearance overlaps traffic green');
const published=readFileSync(new URL('../docs/assets/downtown.json',import.meta.url),'utf8');
assert.equal(published,readFileSync(new URL('../assets/downtown.json',import.meta.url),'utf8'),'published city data is stale');
console.log(`PASS: ${data.buildings.length} footprints, ${data.streets.length} streets, office parcels/cards, connected coverage, unchanged tour, route interpolation, bridge heights, right-hand lanes, signal conflicts, published data`);
