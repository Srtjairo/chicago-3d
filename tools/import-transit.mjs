import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {source,zipReader,csv} from './transit-source.mjs';
import {project,unproject,inCoverage,COVERAGE_RECTS} from '../js/coverage.js';
import {clean,clipPolyline,nearest,resample,route2,railHeight,round,distance,trackOffset} from '../js/transit-math.js';

const SNAPSHOT='2026-10-29',date=SNAPSHOT.replaceAll('-','');
const correctionBytes=await readFile(new URL('./transit-corrections.json',import.meta.url));
const corrections=JSON.parse(correctionBytes);
function correct(p){let [x,z]=p;for(const c of corrections.alignmentCorrections){const [x0,x1,z0,z1]=c.bounds;if(x>x0&&x<x1&&z>z0&&z<=z1){const i=c.profile.findIndex(q=>q[0]>=z),a=c.profile[Math.max(0,i-1)],b=c.profile[i],t=(z-a[0])/(b[0]-a[0]||1);x=a[1]+(b[1]-a[1])*t;}}return [x,z];}
const inputs=await Promise.all([
  source('gtfs.zip','https://www.transitchicago.com/downloads/sch_data/google_transit.zip'),
  source('lines.json','https://data.cityofchicago.org/resource/xbyr-jnvx.json?$limit=5000'),
  source('stations.json','https://data.cityofchicago.org/resource/3tzw-cg4m.json?$limit=5000'),
  source('stops.json','https://data.cityofchicago.org/resource/8pix-ypme.json?$limit=5000'),
  source('entrances.geojson','https://raw.githubusercontent.com/ChicagoCityscape/gis-data/master/stations_cta/cta_entrances.geojson'),
]);
const read=zipReader(inputs[0].bytes),gisLines=JSON.parse(inputs[1].bytes),gisStations=JSON.parse(inputs[2].bytes),portal=JSON.parse(inputs[3].bytes),entranceSource=JSON.parse(inputs[4].bytes);
const lineInfo={
  Red:['Howard ↔ 95th/Dan Ryan','State Street subway · 24-hour service'],
  Blue:['O’Hare ↔ Forest Park','Milwaukee–Dearborn subway · 24-hour service'],
  Brn:['Kimball ↔ Loop','Counterclockwise around the Loop'],
  G:['Harlem/Lake ↔ Ashland/63rd or Cottage Grove','Lake Street → Wabash → South Side'],
  Org:['Midway ↔ Loop','Clockwise around the Loop'],
  Pink:['54th/Cermak ↔ Loop','Via Morgan and Clinton · clockwise Loop'],
  P:['Linden ↔ Howard / Loop','Downtown express during weekday rush periods'],
  Y:['Dempster-Skokie ↔ Howard','Connect to Red or Purple for downtown'],
};
const order=['Red','Blue','Brn','G','Org','Pink','P','Y'];
const lines=[...csv(read('routes.txt'))].filter(r=>r.route_type==='1').map(r=>({id:r.route_id,name:r.route_long_name,color:'#'+r.route_color,text:'#'+r.route_text_color,url:r.route_url.replace('http:','https:'),terminals:lineInfo[r.route_id][0],description:lineInfo[r.route_id][1]})).sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));
const active=new Set([...csv(read('calendar.txt'))].filter(r=>r.thursday==='1'&&r.start_date<=date&&r.end_date>=date).map(r=>r.service_id));
for(const r of csv(read('calendar_dates.txt')))if(r.date===date){if(r.exception_type==='1')active.add(r.service_id);else active.delete(r.service_id);}
const trips=[...csv(read('trips.txt'))].filter(r=>lineInfo[r.route_id]&&active.has(r.service_id));
if(!trips.length)throw Error('Feed does not cover the fixed snapshot date; do not silently use a newer feed.');
const selected=new Map();for(const t of trips){const id=t.route_id+':'+t.shape_id;if(!selected.has(id))selected.set(id,{id,line:t.route_id,shapeId:t.shape_id,tripId:t.trip_id,direction:t.direction,stops:[],geographic:[]});}
const byTrip=new Map([...selected.values()].map(p=>[p.tripId,p]));
console.log('Reading rail stop sequences from the dated GTFS feed…');
for(const s of csv(read('stop_times.txt')))if(byTrip.has(s.trip_id))byTrip.get(s.trip_id).stops.push({stopId:s.stop_id,sequence:+s.stop_sequence});
const byShape=new Map([...selected.values()].map(p=>[p.shapeId,p]));
for(const s of csv(read('shapes.txt')))if(byShape.has(s.shape_id))byShape.get(s.shape_id).geographic.push([+s.shape_pt_lon,+s.shape_pt_lat,+s.shape_pt_sequence]);
const stopMap=new Map([...csv(read('stops.txt'))].filter(s=>+s.stop_id>=30000&&+s.stop_id<50000).map(s=>[s.stop_id,s]));
// State/Lake is absent from operating GTFS but remains a physical closed station.
for(const s of portal)if(!stopMap.has(s.stop_id))stopMap.set(s.stop_id,{stop_id:s.stop_id,stop_name:s.stop_name,parent_station:s.map_id,stop_lon:s.location.longitude,stop_lat:s.location.latitude});
const serving=new Map();
for(const p of selected.values()){
  p.stops.sort((a,b)=>a.sequence-b.sequence);p.stops=p.stops.map(s=>({...s,stationId:stopMap.get(s.stopId)?.parent_station}));
  p.geographic.sort((a,b)=>a[2]-b[2]);p.geographic=p.geographic.map(p=>p.slice(0,2));p.points=clean(p.geographic.map(project));
  for(const s of p.stops){if(!serving.has(s.stopId))serving.set(s.stopId,new Set());serving.get(s.stopId).add(p.line);}
}
const flags={red:'Red',blue:'Blue',brn:'Brn',g:'G',o:'Org',pnk:'Pink',p:'P',y:'Y'};
const stations=[...new Set([...portal.map(s=>s.map_id),...[...stopMap.values()].map(s=>s.parent_station).filter(Boolean)])].map(id=>{
  const ps=portal.filter(s=>s.map_id===id),children=[...stopMap.values()].filter(s=>s.parent_station===id),parent=stopMap.get(id)||children[0];
  const position=project([+parent.stop_lon,+parent.stop_lat]);const stationLines=[...new Set(children.flatMap(s=>[...(serving.get(s.stop_id)||[])]))];
  if(id==='40260')stationLines.push('Brn','G','Org','Pink','P');
  const name=ps[0]?.station_name||parent.stop_name;
  const platforms=children.map(c=>{const row=portal.find(s=>s.stop_id===c.stop_id),ls=[...(serving.get(c.stop_id)||[])];if(!ls.length&&row)for(const [f,l]of Object.entries(flags))if(row[f])ls.push(l);
    return {id:c.stop_id,stationId:id,name:c.stop_name,lines:ls,direction:row?.direction_id||'',geographic:[+c.stop_lon,+c.stop_lat],position:project([+c.stop_lon,+c.stop_lat]),kind:ls.some(l=>!['Red','Blue'].includes(l))?'elevated':'subway'};});
  return {id,name,displayName:id==='40260'?name:(parent.stop_name||name),geographic:[+parent.stop_lon,+parent.stop_lat],position,inScene:inCoverage(...position),lines:order.filter(l=>stationLines.includes(l)),status:id==='40260'?'closed':'open',platforms,entrances:[],gisIds:[],source:'CTA GTFS + directional stops',accuracy:'Station location; platform dimensions are visual estimates.'};
}).sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
const stationMap=new Map(stations.map(s=>[s.id,s]));
for(const s of stations)s.transfers=[];
for(const t of corrections.transfers){stationMap.get(t.a).transfers.push({stationId:t.b,kind:t.kind,source:t.source});stationMap.get(t.b).transfers.push({stationId:t.a,kind:t.kind,source:t.source});}
for(const t of csv(read('transfers.txt'))){const a=stopMap.get(t.from_stop_id)?.parent_station,b=stopMap.get(t.to_stop_id)?.parent_station;if(!a||!b||a===b||!stationMap.has(a)||!stationMap.has(b))continue;const s=stationMap.get(a);if(!s.transfers.some(t=>t.stationId===b))s.transfers.push({stationId:b,kind:'CTA designated transfer; follow station signs',source:'CTA GTFS transfers.txt'});}
for(const g of gisStations){const p=project(g.the_geom.coordinates);const nearestStation=stations.map(s=>({s,d:Math.min(...s.platforms.map(t=>distance(t.position,p)))})).sort((a,b)=>a.d-b.d)[0];if(nearestStation.d<90){nearestStation.s.gisIds.push(g.station_id);nearestStation.s.address??=g.address;}}

// Imported surface centerlines. Red and Blue are underground throughout our footprint;
// the GIS UIC–Clinton segment's coarse "Elevated or At Grade" label is not a portal.
const physical=gisLines.filter(l=>l.type!=='Subway'&&!/Red|Blue/.test(l.lines)).flatMap((l,i)=>l.the_geom.coordinates.flatMap(ps=>clipPolyline(ps.map(project),COVERAGE_RECTS).map((points,j)=>({id:`rail-${i}-${j}`,description:l.description,source:'CTA GIS xbyr-jnvx',kind:'elevated',points:clean(points),lines:[]}))));
for(const p of physical)p.points=resample(p.points,4).map(correct);
const northTurn=clipPolyline(selected.get('Brn:309200017').points,[{minX:115,maxX:160,minZ:520,maxZ:568}])[0];
physical.push({id:'tower12-north-turn',description:'Tower 12 north-turn connection',source:'CTA GTFS; north-turn connector is absent from the GIS segment split',kind:'junction',points:northTurn,lines:['Brn','Org','P','Pink']});
const closest=p=>physical.map(s=>({segment:s,...nearest(s.points,p)})).sort((a,b)=>a.error-b.error)[0];
// Directional track paths share surveyed corridor centers; a 1.8 m right-hand
// offset separates the two tracks. Distances are recomputed in metres, never
// assumed from GTFS shape_dist_traveled.
const mainShapes=new Set(['309200017','309200024','309200034','309200035','309200012','309200011','309200009','309200010']);
const routes=[];const comparisons=[];
for(const p of selected.values())if(mainShapes.has(p.shapeId))for(const [partIndex,part]of clipPolyline(p.points,COVERAGE_RECTS).entries()){
  const segmentSequence=[];
  const sampled=resample(part,4).map(correct).map(q=>{const c=closest(q);if(segmentSequence.at(-1)!==c.segment.id)segmentSequence.push(c.segment.id);if(c.error>5)comparisons.push({pattern:p.id,point:q,error:round(c.error)});if(!c.segment.lines.includes(p.line))c.segment.lines.push(p.line);return c.error<5?c.point:q;});
  const points=clean(sampled).map((q,i,arr)=>{const a=arr[Math.max(0,i-1)],b=arr[Math.min(arr.length-1,i+1)],d=distance(a,b)||1,offset=trackOffset(...q);return [round(q[0]-(b[1]-a[1])/d*offset),round(railHeight(...q)),round(q[1]+(b[0]-a[0])/d*offset)];});
  const center=points.map(p=>[p[0],p[2]]),r=route2(center),stops=[];let last=0;
  for(const stop of p.stops){const st=stationMap.get(stop.stationId),platform=st?.platforms.find(s=>s.id===stop.stopId);if(!st?.inScene||st.status==='closed'||!platform)continue;const n=nearest(center,st.id==='41400'?[101.1,1628]:platform.position,last,true);
    if(n.error<40){stops.push({stationId:st.id,stopId:platform.id,d:round(n.d),name:st.name});last=n.d+20;platform.trackPosition=n.point.map(round);platform.angle=n.angle;platform.railY=railHeight(...n.point);}}
  // Extend a train-length beyond each cut for gradual entrance/exit, not wrapping.
  const extend=(p,q,amount)=>{const dx=p[0]-q[0],dz=p[2]-q[2],d=Math.hypot(dx,dz);return [round(p[0]+dx/d*amount),p[1],round(p[2]+dz/d*amount)];};
  points.unshift(extend(points[0],points[1],150));points.push(extend(points.at(-1),points.at(-2),150));for(const s of stops)s.d=round(s.d+150);
  const destination=stationMap.get(p.stops.at(-1).stationId)?.name||lineInfo[p.line][0];
  routes.push({id:p.id+':'+partIndex,line:p.line,patternId:p.id,segmentSequence,points,stops,destination,cars:({Brn:8,Org:8,Pink:4,P:6,G:6})[p.line],entry:150,exit:r.length+150});
}
for(const s of stations){
  s.kind=[...new Set(s.platforms.map(p=>p.kind))].join(' + ');
  if(!s.inScene){const options=gisLines.filter(g=>s.lines.some(id=>g.lines.includes(({Brn:'Brown',G:'Green',Org:'Orange',P:'Purple',Y:'Yellow'})[id]||id))).flatMap(g=>g.the_geom.coordinates.map(ps=>({type:g.type,...nearest(ps.map(project),s.position)}))).sort((a,b)=>a.error-b.error);s.kind=options[0]?.type==='Subway'?'subway':'elevated or at grade';for(const p of s.platforms)p.kind=s.kind;continue;}
  for(const p of s.platforms.filter(p=>p.kind==='elevated')){
    if(!p.trackPosition){const n=closest(p.position);p.trackPosition=n.point.map(round);p.angle=n.angle;p.railY=railHeight(...n.point);}
    // Length/width are explicit representative estimates, independent of station point.
    p.length=({41700:126,41510:130,40460:130,40710:128,41400:130,40040:126})[s.id]||126;p.width=s.id==='41700'?4.2:3.3;
    p.style=({41700:'wave',40040:'historic',41510:'glass',40460:'mart',40380:'transfer',41400:'transfer'})[s.id]||'canopy';
    if(s.id==='41400'){p.layout='island';p.width=6.4;p.length=122;p.center=[101.1,1628];}
  }
}
// CC0 entrance points are historical observations, not surveyed/current guarantees.
// Match by coordinate AND named line, keeping all source coordinates unchanged.
const names={Brown:'Brn',Green:'G',Orange:'Org',Purple:'P',Pink:'Pink',Blue:'Blue',Red:'Red',Yellow:'Y'};
for(const [i,f]of entranceSource.features.entries()){
  const position=project(f.geometry.coordinates);if(!inCoverage(...position))continue;
  const ls=Object.entries(names).filter(([n])=>f.properties.line?.includes(n)).map(([,l])=>l);
  const matches=stations.filter(s=>s.inScene&&s.lines.some(l=>ls.includes(l))).map(s=>({s,d:distance(position,s.position)})).sort((a,b)=>a.d-b.d);
  const match=matches[0];if(!match||match.d>260||match.s.status==='closed')continue;
  const s=match.s;const subway=ls.every(l=>['Red','Blue'].includes(l))||f.properties.name==='Roosevelt/State';
  s.entrances.push({id:'entrance-'+i,geographic:f.geometry.coordinates,position,kind:subway?'subway':'elevated',source:'Yonah Freemark / Chicago Cityscape (CC0)',confidence:'historical source; appearance estimated',name:f.properties.name,angle:Math.abs(position[0]-s.position[0])>Math.abs(position[1]-s.position[1])?Math.PI/2:0});
}
const junctions=[{id:'tower18',name:'Lake / Wells junction',position:[-502.1,-409.6],radius:48},{id:'tower12',name:'Wabash / Van Buren junction',position:[151.8,587.9],radius:48},{id:'lake-wabash',name:'Lake / Wabash curve block',position:[128,-399],radius:62},{id:'wells-vanburen',name:'Wells / Van Buren curve block',position:[-488,555],radius:62},{id:'chicago-clearance',name:'Chicago approach clearance block',position:[-690,-1790],radius:550},{id:'balbo-clearance',name:'Balbo curve clearance block',position:[132,790],radius:95},{id:'mart-clearance',name:'Merchandise Mart approach clearance block',position:[-590,-905],radius:115},{id:'roosevelt-clearance',name:'Roosevelt island approach clearance block',position:[101,1630],radius:170}];
for(const r of routes){r.junctions=[];const ps=r.points.map(p=>[p[0],p[2]]),rt=route2(ps);for(const j of junctions){let start=null;for(let i=0;i<ps.length;i++){const inside=distance(ps[i],j.position)<j.radius;if(inside&&start===null)start=rt.lengths[i];if(start!==null&&(!inside||i===ps.length-1)){r.junctions.push({id:j.id,start:round(start),end:round(rt.lengths[i])});start=null;}}}}
const asset={version:1,snapshot:SNAPSHOT,scenario:'Illustrative weekday rush-period service',sources:inputs.map(s=>s.meta),coverage:COVERAGE_RECTS,lines,stations,patterns:[...selected.values()].map(({tripId,...p})=>p),segments:physical.map(s=>({...s,points:s.points.map(p=>[round(p[0]),round(railHeight(...p)),round(p[1])])})),routes,junctions,corrections:{...corrections,sha256:createHash('sha256').update(correctionBytes).digest('hex')},replacementIds:corrections.replacements.map(r=>r.id),closures:[{stationId:'40260',message:'State/Lake elevated closed for reconstruction into 2029; trains pass without stopping.',url:'https://www.transitchicago.com/brownline/'},{id:'lake-bridge-road',message:'Rail service restored October 29, 2026; lower roadway remains closed.',url:'https://www.transitchicago.com/lake-street-bridge-west-leaf-reconstruction-complete-cta-green-and-pink-line-service-to-return-to-normal-thursday-morning-/'}],accuracy:{trackCenterlines:'CTA GIS, checked against dated GTFS; tracks generally offset 1.8 m from shared corridor centers, widening around the Roosevelt island platform.',elevation:'Estimated local rail profiles: 8.9 m typical, rising over double-deck river bridges. Not surveyed.',platforms:'Location and direction from CTA; dimensions and architecture are representative exterior models.',entrances:'CC0 historical entrance points; not a current accessibility or entrance-availability guide.',trains:'Representative consists: Brown/Orange 8, Green/Purple 6, Pink 4 cars. Illustrative assignment, not live fleet data.',reviews:comparisons}};
await writeFile(new URL('../assets/transit.json',import.meta.url),JSON.stringify(asset));
console.log(JSON.stringify({lines:lines.length,stations:stations.length,downtown:stations.filter(s=>s.inScene).length,entrances:stations.reduce((n,s)=>n+s.entrances.length,0),segments:physical.length,routes:routes.length,reviewPoints:comparisons.length,bytes:JSON.stringify(asset).length},null,2));
