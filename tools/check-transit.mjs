import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createTransitSimulation,CAR_LENGTH,CAR_SPACING} from '../js/transit-simulation.js';
import {atDistance,makeRoute} from '../js/movement.js';
import {inPoly} from '../js/waterfront-data.js';
import {nearest,resample,clipPolyline,distance,simplifyRail,trackOffset} from '../js/transit-math.js';
import {project,inCoverage,COVERAGE_RECTS} from '../js/coverage.js';
const text=readFileSync(new URL('../assets/transit.json',import.meta.url),'utf8'),d=JSON.parse(text),byId=new Map(d.stations.map(s=>[s.id,s]));
assert.equal(d.snapshot,'2026-10-29');assert.deepEqual(d.lines.map(l=>l.id),['Red','Blue','Brn','G','Org','Pink','P','Y']);assert.equal(d.stations.filter(s=>s.inScene).length,25);assert.equal(new Set(d.stations.map(s=>s.id)).size,d.stations.length);
const sourceLock=JSON.parse(readFileSync(new URL('./transit-sources.lock.json',import.meta.url),'utf8'));
for(const src of d.sources){assert.match(src.sha256,/^[a-f0-9]{64}$/);assert.equal(src.sha256,sourceLock.find(s=>s.url===src.url)?.sha256,'source differs from the pinned snapshot: '+src.url);}
assert.equal(d.corrections.sha256,createHash('sha256').update(readFileSync(new URL('./transit-corrections.json',import.meta.url))).digest('hex'));
for(const s of d.stations){assert.deepEqual(s.position,project(s.geographic));assert(s.lines.length,s.id);assert(s.kind,s.id);if(s.inScene&&s.status!=='closed')assert(s.entrances.length,s.name);for(const e of s.entrances){assert.deepEqual(e.position,project(e.geographic));assert(e.source&&e.confidence);}}
const termini={Red:['Howard','95th/Dan Ryan'],Blue:["O'Hare",'Forest Park'],Brn:['Kimball'],G:['Harlem/Lake','Ashland/63rd','Cottage Grove'],Org:['Midway'],Pink:['54th/Cermak'],P:['Linden','Howard'],Y:['Dempster-Skokie','Howard']};
for(const [line,names]of Object.entries(termini)){const ends=d.patterns.filter(p=>p.line===line).flatMap(p=>[byId.get(p.stops[0].stationId).name,byId.get(p.stops.at(-1).stationId).name]);for(const n of names)assert(ends.includes(n),`${line} missing terminal ${n}`);}
for(const p of d.patterns){assert(p.stops.length>1);for(const stop of p.stops)assert(byId.get(stop.stationId)?.platforms.some(s=>s.id===stop.stopId),`unmatched stop ${stop.stopId}`);}
assert(!d.stations.some(s=>/130th|Michigan\/|111th.*Red/.test(s.name)&&s.lines.includes('Red')),'no future Red extension');
assert.equal(byId.get('40260').status,'closed');assert.equal(byId.get('41660').status,'open');
assert(!d.routes.some(r=>['Red','Blue','Y'].includes(r.line)),'subway/Yellow cannot appear as downtown elevated trains');
const subsequence=(a,seq)=>{let i=0;for(const value of a)if(value===seq[i])i++;return i===seq.length;};
for(const r of d.routes){assert(r.points.flat().every(Number.isFinite));assert(r.stops.every((s,i)=>!i||s.d>r.stops[i-1].d));assert(!r.stops.some(s=>s.stationId==='40260'));
  const ids=r.stops.map(s=>s.stationId);if(r.line==='Brn')assert(subsequence(ids,['40730','40040','40160','40850','40680','41700','40380']),'Brown must be counterclockwise');
  if(['Org','Pink','P'].includes(r.line))assert(subsequence([...ids,...ids],['40380','41700','40680','40850','40160','40040','40730']),'clockwise Loop order');
  if(r.line==='G')assert(!ids.some(id=>['40040','40730','40160','40850'].includes(id)),'Green must not circle the Loop');
  for(const p of r.points.slice(1,-1))assert(inCoverage(p[0],p[2],9),'train path must follow coverage union');
  for(const s of r.stops){const p=byId.get(s.stationId).platforms.find(p=>p.id===s.stopId);assert(p.length>(r.cars-1)*CAR_SPACING+CAR_LENGTH,`train does not fit ${s.name}`);}
}
for(const s of d.segments){assert(!s.lines.some(l=>['Red','Blue','Y'].includes(l)));for(const p of s.points)assert(inCoverage(p[0],p[2],.1));}
// Render optimization must retain the vertical and Roosevelt widening profiles.
for(const s of d.segments){const profile=p=>[...p,trackOffset(p[0],p[2])],simple=simplifyRail(s.points).map(profile);for(const raw of s.points){const p=profile(raw);let error=Infinity;for(let i=1;i<simple.length;i++){const a=simple[i-1],v=simple[i].map((n,k)=>n-a[k]),len=v.reduce((n,x)=>n+x*x,0),t=len?Math.max(0,Math.min(1,p.reduce((n,x,k)=>n+(x-a[k])*v[k],0)/len)):0;error=Math.min(error,Math.hypot(...p.map((x,k)=>x-a[k]-t*v[k])));}assert(error<=.030001,'rendered rail profile moved: '+s.id);}}
assert.deepEqual(clipPolyline([[-20,0],[20,0]],[{minX:-10,maxX:2,minZ:-1,maxZ:1},{minX:0,maxX:10,minZ:-1,maxZ:1}]),[[[-10,0],[10,0]]]);
// First arrival at a repeated corridor must win over the return traversal.
assert(nearest([[0,0],[0,100],[10,100],[10,0]],[4,50],0,true).d<100);
// Full car envelope, including curve overhang, against retained source buildings.
const city=JSON.parse(readFileSync(new URL('../assets/downtown.json',import.meta.url),'utf8'));
for(const id of d.replacementIds)assert(city.buildings.some(b=>b.id===id),'unknown replacement '+id);
const buildings=city.buildings.filter(b=>!d.replacementIds.includes(b.id)).map(b=>{const xs=b.rings[0].map(p=>p[0]),zs=b.rings[0].map(p=>p[1]);return {...b,x0:Math.min(...xs),x1:Math.max(...xs),z0:Math.min(...zs),z1:Math.max(...zs)};}),buildingHits=new Set();
for(const source of d.routes){const r=makeRoute(source.points);for(let at=150;at<r.length-150;at+=4){const p=atDistance(r,at);if(!inCoverage(p.x,p.z))continue;const corners=[[-1,-1],[-1,1],[1,-1],[1,1],[0,0]].map(([a,b])=>[p.x+Math.sin(p.angle)*7.3*a+Math.cos(p.angle)*1.325*b,p.z+Math.cos(p.angle)*7.3*a-Math.sin(p.angle)*1.325*b]);for(const b of buildings)if(p.x>b.x0-9&&p.x<b.x1+9&&p.z>b.z0-9&&p.z<b.z1+9&&b.h>p.y&&corners.some(q=>inPoly(...q,b.rings)))buildingHits.add(b.id);}}
assert.equal(buildingHits.size,0,'train envelopes intersect retained footprints: '+[...buildingHits].join(', '));
// Independent car-volume audit at 4 Hz over two illustrative hours.
const sim=createTransitSimulation(d,{warmup:0});let collisions=0,examples=[],samples=0;
function overlap(a,b){const dx=b.x-a.x,dz=b.z-a.z;if(Math.hypot(dx,dz)>16)return false;for(const angle of [a.angle,b.angle])for(const axis of [0,Math.PI/2]){const theta=angle+axis,x=Math.sin(theta),z=Math.cos(theta),span=p=>Math.abs(Math.cos(p.angle-theta))*CAR_LENGTH/2+Math.abs(Math.sin(p.angle-theta))*1.325;if(Math.abs(dx*x+dz*z)>=span(a)+span(b)-.1)return false;}return true;}
for(let step=0;step<7200*20;step++){sim.step(.05);if(step%5)continue;samples++;const poses=sim.trains.filter(t=>t.wait<=0).map(t=>({t,cars:Array.from({length:t.route.cars},(_,i)=>({at:t.d-i*CAR_SPACING,...atDistance(t.route,t.d-i*CAR_SPACING)})).filter(p=>p.at>=0&&p.at<=t.route.length&&inCoverage(p.x,p.z))}));for(let i=0;i<poses.length;i++)for(let j=i+1;j<poses.length;j++)for(const p of poses[i].cars)for(const q of poses[j].cars)if(overlap(p,q)){collisions++;if(examples.length<5)examples.push({time:sim.time,a:poses[i].t.id,b:poses[j].t.id,p:[p.x,p.z],q:[q.x,q.z]});}}
assert.equal(collisions,0,JSON.stringify(examples));assert(sim.trains.every(t=>t.cycle>=2),'all services must exit/re-enter without deadlock');assert(sim.stats.stops>300);assert(sim.trains.every(t=>!t.visits.includes('40260')));
const positions=sim.trains.map(t=>t.d);sim.update(.1,true);assert.deepEqual(sim.trains.map(t=>t.d),positions);for(let i=0;i<600;i++)sim.update(.1,false);assert(sim.trains.every((t,i)=>t.d!==positions[i]),'all trains must make progress after resume');
assert.equal(readFileSync(new URL('../docs/assets/transit.json',import.meta.url),'utf8'),text,'published transit asset stale');
const revision=JSON.parse(readFileSync(new URL('../docs/revision.json',import.meta.url),'utf8')).revision;
for(const file of readdirSync(new URL('../js/',import.meta.url)).filter(f=>f.startsWith('transit'))){const source=readFileSync(new URL('../js/'+file,import.meta.url),'utf8').replace(/from (['"])(\.\/[^'"]+\.js)\1/g,(_,q,p)=>`from ${q}${p}?v=${revision}${q}`);assert.equal(readFileSync(new URL('../docs/js/'+file,import.meta.url),'utf8'),source,'published module stale: '+file);}
assert.equal(readFileSync(new URL('../docs/assets/transit.css',import.meta.url),'utf8'),readFileSync(new URL('../assets/transit.css',import.meta.url),'utf8'));
assert(readFileSync(new URL('../docs/index.html',import.meta.url),'utf8').includes(`assets/transit.css?v=${revision}`));
console.log(`PASS: 8 lines, ${d.patterns.length} patterns, 25 complexes, ${d.segments.length} shared corridors, terminals/Loop directions/closures, ${samples} collision samples, ${sim.stats.cycles} exits, pause/resume, source hashes and published data`);
