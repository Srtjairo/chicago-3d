import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inPoly,distanceToLine} from '../js/waterfront-data.js';
import {prepareLakeShore,lakeShoreIntersects,highwayOffset,highwayFade} from '../js/lake-shore-data.js';
const read=name=>JSON.parse(readFileSync(new URL('../assets/'+name+'.json',import.meta.url)));
const data=read('lake-shore'),city=read('downtown'),waterfront=read('waterfront');
const rivers=city.water.filter(w=>!w.name.includes('LAKE'));
const isRiver=(x,z)=>rivers.some(w=>inPoly(x,z,w.rings));
const isLand=(x,z)=>waterfront.terrain.some(r=>inPoly(x,z,r));
const result=prepareLakeShore(data,isRiver);
assert.equal(result.chains.length,2);assert.equal(result.sourceIds.size,179);
assert.match(data.source.url,/data\.cityofchicago\.org/);assert.match(data.source.sha256,/^[a-f0-9]{64}$/);
for(const id of ['3766-0','36058-0','23986-0','49863-0','13857-0'])assert(result.sourceIds.has(id),'missing original endpoint/approach '+id);
assert(!result.sourceIds.has('18654-0'),'inner Lake Shore Drive must remain a local road');
let checked=0,minimumWidth=Infinity;
for(const chain of result.chains){
  assert(chain.path[0][2]<-6200&&chain.path.at(-1)[2]>5600,'both mainlines must reach beyond the procedural scene');
  assert.equal(highwayFade(chain,0),0);assert.equal(highwayFade(chain,chain.path.length-1),0);
  const other=result.chains.find(c=>c!==chain);
  for(let i=0;i<chain.path.length;i++){
    const p=chain.path[i],half=chain.halfWidths[i];assert(p.every(Number.isFinite));assert(half>4.4&&half<=8);minimumWidth=Math.min(minimumWidth,half*2);
    assert(lakeShoreIntersects(result,p[0]-.1,p[2]-.1,p[0]+.1,p[2]+.1),'road reservation must cover every route sample');
    for(const side of [-1,0,1]){
      const q=highwayOffset(chain.path,i,side*half);assert(q.every(Number.isFinite));
      assert(isLand(q[0],q[2])||isRiver(q[0],q[2]),'highway may cross the river but cannot enter Lake Michigan');
      if(!isLand(q[0],q[2]))assert(q[1]>2,'bridge road must clear water');
    }
    if(Math.abs(p[2]+2100)<250){
      const separation=distanceToLine(p[0],p[2],other.points);assert(half<separation/2,'tight Oak Street curve must retain a median');
    }
    if(i){assert(chain.distances[i]>chain.distances[i-1]);assert(Math.abs(p[1]-chain.path[i-1][1])<=.51,'continuous bridge grade');}
    checked++;
  }
  const roads=result.roads.filter(r=>r.highwayChain===chain.id);
  for(let i=0;i<roads.length;i++){
    const r=roads[i];assert(r.width/4+1.3<r.width/2,'vehicles must fit within the narrow source curve');
    if(i){assert.equal(roads[i-1].to,r.from,'mainline traffic must continue across every original cutoff');assert.deepEqual(roads[i-1].path.at(-1),r.path[0],'road positions/heights must meet');}
  }
}
assert(!lakeShoreIntersects(result,-1800,-1000,-1700,-900),'reserve only the highway corridor');
for(const chain of data.chains)for(let i=1;i<chain.segments.length;i++)assert(Math.hypot(...chain.segments[i].points[0].map((v,k)=>v-chain.segments[i-1].points.at(-1)[k]))<.11,'source-backed joins must be coincident');
assert.deepEqual(JSON.parse(readFileSync(new URL('../docs/assets/lake-shore.json',import.meta.url))),data,'published highway data must match the checked source');
console.log(`PASS: ${checked} highway samples, 179 source segments, both continuations, land/river clearance, continuous grades, ${minimumWidth.toFixed(2)}m minimum carriageway, median, traffic fit and exact corridor reservation`);
