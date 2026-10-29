import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makeRoute,atDistance,offsetPath,signalGreen,canCross,trimRoute} from '../js/movement.js';
import {LANDMARKS} from '../js/geo.js';
const data=JSON.parse(readFileSync(new URL('../assets/downtown.json',import.meta.url),'utf8'));
assert.equal(data.version,1);assert(data.buildings.length>2500);assert(data.streets.length>1500);
assert.equal(new Set(data.buildings.map(b=>b.id)).size,data.buildings.length);
for(const b of data.buildings){
  assert(b.h>=2&&b.h<600,`invalid height ${b.id}`);
  for(const ring of b.rings){assert(ring.length>=4,b.id);assert(ring.flat().every(Number.isFinite),b.id);assert.deepEqual(ring[0],ring.at(-1),`unclosed footprint ${b.id}`);}
}
// The survey includes Willis's antenna. A missed feet-to-metres conversion would exceed 1700 m.
assert(data.buildings.find(b=>b.id==='889662-0').h>500&&data.buildings.find(b=>b.id==='889662-0').h<540);
for(const s of data.streets){assert(s.points.length>1,s.id);assert(s.points.flat().every(Number.isFinite),s.id);}
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
console.log(`PASS: ${data.buildings.length} footprints, ${data.streets.length} streets, six landmarks, route interpolation, bridge heights, right-hand lanes, signal conflicts, published data`);
