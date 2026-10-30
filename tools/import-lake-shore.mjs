// Narrow, reproducible supplement to the downtown street snapshot.
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {project} from '../js/coverage.js';
const root=new URL('../',import.meta.url),cache=new URL('.cache/',root);
mkdirSync(cache,{recursive:true});
const query=new URLSearchParams({'$where':"street_nam like '%LAKE SHORE%'",'$limit':'50000','$select':'the_geom,objectid,street_nam,street_typ,pre_dir,dir_travel,fnode_id,tnode_id,f_zlev,t_zlev,class'});
const url='https://data.cityofchicago.org/resource/pr57-gg9e.json?'+query;
const path=new URL('lake-shore-'+createHash('sha256').update(url).digest('hex').slice(0,12)+'.json',cache);
let bytes;
if(existsSync(path))bytes=readFileSync(path,'utf8');
else {const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error('Lake Shore source HTTP '+r.status);bytes=await r.text();JSON.parse(bytes);writeFileSync(path,bytes);}
const raw=JSON.parse(bytes);
if(!Array.isArray(raw))throw new Error('Invalid source: '+bytes.slice(0,200));
const streets=raw.flatMap(s=>(s.the_geom?.coordinates||[]).map((p,i)=>({id:s.objectid+'-'+i,name:[s.pre_dir,s.street_nam,s.street_typ].filter(Boolean).join(' '),road:s.street_nam,from:s.fnode_id,to:s.tnode_id,dir:s.dir_travel,level:[Number(s.f_zlev||0),Number(s.t_zlev||0)],class:Number(s.class),points:p.map(project)})));
const main=streets.filter(s=>s.road==='LAKE SHORE'&&s.class===1),byNode=new Map();
for(const s of main)for(const n of [s.from,s.to]){if(!byNode.has(n))byNode.set(n,[]);byNode.get(n).push(s);}
const same=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])<.11;
const corrections=[];
function trace(seed,node){
  const used=new Set([seed]),out=[];let last=main.find(s=>s.id===seed),point=last.from===node?last.points[0]:last.points.at(-1);
  while(point[1]>-6200&&point[1]<5600){
    let options=(byNode.get(node)||[]).filter(s=>!used.has(s.id));
    if(!options.length){
      options=main.filter(s=>!used.has(s.id)&&(same(s.points[0],point)||same(s.points.at(-1),point)));
      if(options.length===1)corrections.push({from:last.id,to:options[0].id,at:point,reason:'Coincident surveyed endpoints use different source node IDs; no coordinates changed.'});
    }
    if(options.length!==1)throw new Error('Ambiguous or missing continuation at '+node);
    const s=options[0],reverse=s.to===node||same(s.points.at(-1),point);
    out.push({street:s,reverse});used.add(s.id);node=reverse?s.from:s.to;point=reverse?s.points[0]:s.points.at(-1);last=s;
    if(out.length>200)throw new Error('Unbounded mainline');
  }
  return out;
}
const chains=[['west','36058-0'],['east','23986-0']].map(([id,seed])=>{
  const s=main.find(s=>s.id===seed),north=trace(seed,s.from),south=trace(seed,s.to);
  const segments=[...north.reverse().map(o=>({street:o.street,reverse:!o.reverse})),{street:s,reverse:false},...south];
  return {id,segments:segments.map(({street,reverse})=>({id:street.id,from:reverse?street.to:street.from,to:reverse?street.from:street.to,level:reverse?[...street.level].reverse():street.level,points:reverse?[...street.points].reverse():street.points}))};
});
const data={version:1,captured:'2026-10-30',source:{name:'City of Chicago street centerlines',url,vintage:'2016 portal snapshot',sha256:createHash('sha256').update(bytes).digest('hex')},notes:['Only the two connected outer-drive carriageways are included. Coordinates are surveyed centerlines; widths, lane markings and vertical profiles are visual estimates.','Negative source levels describe topological separation, not metric heights. The southern underpass is presented at the scene ground; its omitted upper approach is not connected to highway traffic.'],corrections,chains};
writeFileSync(new URL('assets/lake-shore.json',root),JSON.stringify(data));
console.log(JSON.stringify({chains:chains.map(c=>({id:c.id,segments:c.segments.length,from:c.segments[0].points[0],to:c.segments.at(-1).points.at(-1)})),corrections,bytes:JSON.stringify(data).length}));
