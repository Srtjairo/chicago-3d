// Offline cartography. All coordinates are local metres, georeferenced by ORIGIN.
// Shoreline/footprints: bundled City/County survey. Landscape details: visual
// estimates traced against the official maps listed in sources, not a new survey.
import {readFileSync,writeFileSync} from 'node:fs';
import clip from './vendor/polygon-clipping.cjs';
import {ORIGIN} from '../js/coverage.js';
import {configureShore,SHORE_POINTS,rng,samplePath,shoreX} from '../js/geo.js';
import {inPoly,distanceToLine} from '../js/waterfront-data.js';
const city=JSON.parse(readFileSync(new URL('../assets/downtown.json',import.meta.url)));
const close=r=>[...r,...(r[0][0]===r.at(-1)[0]&&r[0][1]===r.at(-1)[1]?[]:[r[0]])];
const poly=r=>[close(r)],rect=(a,b,c,d)=>poly([[a,b],[c,b],[c,d],[a,d]]);
const circle=(x,z,r,n=48)=>poly(Array.from({length:n},(_,i)=>[x+Math.cos(i/n*Math.PI*2)*r,z+Math.sin(i/n*Math.PI*2)*r]));
const strip=(points,width)=>clip.union(...points.slice(1).map((b,i)=>{const a=points[i],dx=b[0]-a[0],dz=b[1]-a[1],n=Math.hypot(dx,dz)||1,nx=-dz/n*width/2,nz=dx/n*width/2;return poly([[a[0]+nx,a[1]+nz],[b[0]+nx,b[1]+nz],[b[0]-nx,b[1]-nz],[a[0]-nx,a[1]-nz]]);}),...points.map(p=>circle(...p,width/2,12)));
const smooth=(p,closed=false)=>{const a=closed?[p.at(-1),...p,p[0],p[1]]:p;const s=samplePath(a,8);return closed?s.slice(8,-8).concat([p[0]]):s;};
const bounds={minX:200,maxX:3000,minZ:-2600,maxZ:1610},patch=rect(bounds.minX,bounds.minZ,bounds.maxX,bounds.maxZ);
const waters=city.water.map(w=>w.rings);
const land=clip.difference(patch,...waters);
configureShore(city);
const old=poly([[-12000,-9000],...SHORE_POINTS.map(([z,x])=>[x,z]),[-12000,9000]]);
const terrain=clip.union(clip.difference(old,patch),land);
const features=[],paths=[],anchors=[],docks=[],boats=[],trees=[];
const zones=[rect(300,-260,890,1600),poly([[615,-260],[1030,-260],[950,-100],[880,0],[865,120],[615,120]]),poly([[1130,-1250],[1280,-1240],[1350,-1300],[1490,-1580],[1550,-1580],[1550,-1220],[1490,-1150],[1480,-790],[1365,-790],[1350,-945],[1170,-945]]),rect(280,-2450,700,-2110)];
const roads=city.streets.filter(s=>s.class>=1&&s.class<=4&&!/LOWER|RAMP|EXPY/.test(s.road)&&s.points.some(([x,z])=>x>270&&x<1500&&z>-2600&&z<1610)).map(s=>strip(s.points,/MICHIGAN|COLUMBUS|ROOSEVELT|LAKE SHORE/.test(s.road)?29:24));
const masks=clip.union(...roads,...city.buildings.filter(b=>b.rings[0].some(([x,z])=>x>280&&x<1500&&z>-2600&&z<1610)).map(b=>b.rings));
function surface(id,kind,rings,y=.72,cut=true){let polygons=clip.intersection(rings,land);if(cut)polygons=clip.difference(polygons,masks);if(polygons.length)features.push({id,kind,y,polygons,accuracy:'visual estimate, street/shore clipped'});return polygons;}
function route(id,points,width=4,mode='walk',y=1.03,kind='path'){paths.push({id,points:points.map(p=>[p[0],p.length>2?p[2]:y,p[1]]),width,mode,kind});if(kind!=='bridge')surface(id,kind,strip(points,width),y-.12,false);}
function lawn(id,rings){return surface(id,'grass',rings);}
function treeRow(points,spacing=16,size=1){for(let j=1;j<points.length;j++){const a=points[j-1],b=points[j],l=Math.hypot(b[0]-a[0],b[1]-a[1]);for(let t=0;t<l;t+=spacing)trees.push([a[0]+(b[0]-a[0])*t/l,a[1]+(b[1]-a[1])*t/l,size,.72]);}}
// Separate gardens and fields; street and building masks retain Art Institute.
lawn('millennium-grounds',rect(300,-260,600,128));
lawn('maggie-daley',zones[1]);
lawn('butler-field',rect(620,150,865,390));
surface('petrillo-audience','paving',poly([[620,330],[655,302],[700,306],[734,344],[730,392],[620,392]]));
anchors.push({id:'petrillo',x:648,z:358,w:37,d:29,h:12,kind:'shell',sourceIds:['890804-0']});
lawn('grant-formal-west',rect(310,430,583,960));
lawn('buckingham-gardens',rect(620,430,865,960));
lawn('upper-hutchinson',rect(475,1005,585,1510));
lawn('lower-hutchinson',rect(625,1005,860,1510));
lawn('south-grant-groves',rect(280,1005,420,1590));
lawn('arvey-field',rect(625,1450,835,1590));
// Wide east/west fountain axis and the north/south formal promenades.
surface('buckingham-plaza','paving',poly([[665,610],[692,610],[692,585],[785,585],[785,610],[815,610],[840,650],[840,726],[815,765],[785,765],[785,790],[692,790],[692,765],[665,765],[640,726],[640,650]]),.89);
for(const z of [466,563,815,920]){
 route('garden-cross-'+z,[[632,z],[850,z]],6);
 for(const x of [672,807])surface('rose-bed-'+x+'-'+z,'flowers',rect(x-19,z+12,x+19,z+42),.86);
}
for(const x of [635,847])route('garden-axis-'+x,[[x,450],[x,950]],6);
for(const z of [510,875]){
 surface('rose-circle-'+z,'paving',circle(739,z,20),.86);
 surface('rose-center-'+z,'flowers',circle(739,z,10),.89);
 for(const x of [655,823])treeRow([[x,z-45],[x,z+45]],15,1.25);
}
route('buckingham-west',[[471,688],[635,688]],10);
route('buckingham-east',[[843,688],[858,688]],10);
route('fountain-ring',circle(739,688,66,64)[0],5);
for(const z of [490,905])route('west-gardens-'+z,[[318,z],[408,z],[408,z+36],[318,z+36],[318,z]],5);
// Congress Plaza's paired bowed lawns west of the sunken rail corridor.
for(const z of [625,757]){surface('congress-plaza-'+z,'paving',circle(370,z,45),.84);lawn('congress-lawn-'+z,circle(370,z,34));}
surface('rail-cut','ballast',rect(431,425,459,1600),.76,false);
for(const x of [437,445,453])paths.push({id:'rail-'+x,kind:'rail',mode:'none',width:1.5,points:[[x,.9,430],[x,.9,1600]]});
for(const z of [560,690,980,1230,1400]){surface('rail-bridge-'+z,'paving',rect(423,z-7,468,z+7),1.04,false);}
// Twelve representative lower-field diamonds, four upper-field diamonds.
for(const [row,z]of [1060,1200,1340].entries())for(const [col,x]of [665,815].entries())for(const dz of [-1,1]){
 const home=[x,z+dz*29],ang=dz<0?0:Math.PI,rr=25;
 const ring=[home,...Array.from({length:17},(_,i)=>{const a=ang+Math.PI/4+i*Math.PI/2/16;return [home[0]+rr*Math.cos(a),home[1]+rr*Math.sin(a)];})];
 surface('lower-diamond-'+row+'-'+col+'-'+dz,'clay',poly(ring),.82);
 anchors.push({id:'backstop-'+row+'-'+col+'-'+dz,kind:'backstop',x:home[0],z:home[1],angle:ang});
}
for(const z of [1060,1170,1340,1440])surface('upper-diamond-'+z,'clay',poly([[490,z],[510,z-20],[535,z],[510,z+20]]),.82);
for(const [i,r]of [rect(625,1005,855,1425)[0],rect(475,1005,582,1490)[0],rect(623,155,851,391)[0]].entries())route('field-perimeter-'+i,r,5);
for(const x of [315,410,475,575,626,855])treeRow([[x,435],[x,1585]],19,1.05);
for(const z of [452,950,1008,1430,1580])treeRow([[320,z],[850,z]],18,1.15);
// Maggie Daley: northern ribbon and climbing rocks, central lawn, southeast play garden.
const ribbon=smooth([[650,-150],[687,-155],[698,-199],[742,-207],[768,-188],[754,-156],[773,-121],[753,-99],[710,-108],[693,-129],[655,-118]],true);
route('maggie-ribbon',ribbon,8,'walk',1.04,'ribbon');
anchors.push({id:'climbing-west',kind:'rock',x:681,z:-142,w:16,d:11,h:8,sourceIds:['876345-0']},{id:'climbing-east',kind:'rock',x:724,z:-160,w:20,d:20,h:12,sourceIds:['875487-0']});
route('maggie-main',smooth([[630,-235],[810,-225],[830,-130],[803,-50],[820,40],[790,95],[680,95],[642,60],[630,-20],[650,-70]]),5);
route('maggie-play-loop',smooth([[775,-25],[817,-7],[834,28],[823,70],[786,66],[751,41],[747,6]],true),4);
surface('play-garden','play',poly([[775,-20],[810,-13],[830,20],[825,59],[793,72],[752,43],[751,6]]),.85);
for(const [i,[x,z,w,d,h]]of [[770,10,14,8,5],[808,38,8,8,7],[783,50,6,6,4],[813,0,11,6,3]].entries())anchors.push({id:'play-'+i,kind:'play',x,z,w,d,h});
for(const [x,z,rx,rz,h]of [[700,-38,35,36,3.2],[664,39,26,45,2.4],[784,-175,22,34,2.2]])anchors.push({id:'hill-'+x,kind:'hill',x,z,rx,rz,h});
route('survivor-garden',[[837,-220],[851,-220],[851,-75],[837,-75],[837,-220]],4);
for(const x of [847,862])treeRow([[x,-222],[x,-88]],14,.7);
surface('tennis','court',rect(890,-232,976,-185),.83);
// Lakefront trails: follow the surveyed shore, with separate bicycle/pedestrian lanes.
const southWalk=[[1110,-639],[1150,-600],[1186,-490],[1198,-365],[1195,-248],[1150,-133],[1065,-78],[1001,-72],[955,-47],[925,20],[925,125],[925,180],...Array.from({length:26},(_,i)=>{const z=200+i*48;return [shoreX(z)-28,z];})];
const southBike=southWalk.map(([x,z])=>[x-(z>100&&z<190?6:14),z]);
route('lakefront-south-walk',southWalk,5);route('lakefront-south-bike',southBike,4,'cycle',1.03,'cycle');
const northRoad=['34465-0','24233-0','13857-0'].flatMap((id,i)=>city.streets.find(s=>s.id===id).points.slice(i?1:0));
const northCurve=northRoad.map((p,i)=>{const a=northRoad[Math.max(0,i-1)],b=northRoad[Math.min(northRoad.length-1,i+1)],dx=b[0]-a[0],dz=b[1]-a[1],n=Math.hypot(dx,dz)||1;return [p[0]-dz/n*18,p[1]+dx/n*18];});
const northWalk=[[1136,-965],[1142,-1060],[1145,-1160],[1130,-1255],[1082,-1380],[1013,-1510],[947,-1640],[881,-1770],[818,-1900],[755,-2020],...northCurve];
route('lakefront-north-walk',northWalk,4);route('lakefront-north-bike',northWalk.map(([x,z])=>[x-6,z]),4,'cycle',1.03,'cycle');
// Shared crossing of the Chicago River uses the existing Lake Shore bridge.
route('lakefront-river-bridge',[[1136,-965,1.03],[1139,-870,4.9],[1138,-770,4.9],[1134,-677,1.03],[1134,-651,1.03],[1110,-639,1.03]],7,'shared',1.03,'bridge');
// Lakefront lawns and beach contours, clipped to actual land.
lawn('monroe-shore',poly([...southWalk.map(([x,z])=>[x+2,z]),...southBike.toReversed().map(([x,z])=>[x-18,z])]));
surface('oak-beach','sand',poly([[315,-2425],[900,-2425],[900,-2175],[565,-2175],[445,-2188],[377,-2230],[345,-2300]]),.5,true);
surface('ohio-beach','sand',poly([[1138,-1268],[1185,-1280],[1235,-1290],[1283,-1280],[1310,-1270],[1297,-1235],[1240,-1213],[1188,-1226],[1153,-1247]]),.52,true);
lawn('jane-addams-park',poly([[1156,-1220],[1245,-1190],[1368,-1193],[1454,-1225],[1472,-1140],[1160,-1128]]));
lawn('olive-park',poly([[1320,-1250],[1480,-1565],[1540,-1565],[1538,-1270],[1472,-1243],[1425,-1242]]));
route('olive-promenade',[[1310,-1242],[1341,-1300],[1382,-1380],[1422,-1462],[1473,-1556],[1525,-1555]],5);
for(const [i,[x,z,r]]of [[1410,-1320,19],[1452,-1390,13],[1475,-1460,19],[1510,-1510,13],[1484,-1543,17]].entries()){
 surface('olive-fountain-'+i,'paving',circle(x,z,r+3),.82,false);surface('olive-water-'+i,'pool',circle(x,z,r),.88,false);
}
treeRow([[1345,-1280],[1486,-1540]],16,1.2);treeRow([[1517,-1283],[1530,-1530]],17,1.1);
lawn('polk-bros',poly([[1370,-1102],[1478,-1102],[1490,-806],[1380,-812],[1365,-951]]));
surface('polk-fountain-plaza','paving',circle(1426,-1061,31),.85,false);
surface('polk-fountain-water','pool',circle(1426,-1061,19),.92,false);
route('polk-west-walk',smooth([[1385,-1110],[1378,-1030],[1388,-951],[1400,-870],[1460,-845],[1480,-910],[1469,-1005]]),5);
for(const x of [1400,1465])anchors.push({id:'polk-stage-'+x,kind:'stage',x,z:-829,w:19,d:10,h:5});
// Pier deck from GIS water boundary. North marina is present on the 2026 map.
const pierLand=clip.intersection(land,poly([[1490,-1133],[2250,-1144],[2450,-1144],[2450,-1000],[2250,-977],[1490,-995]]));
surface('navy-pier-deck','paving',pierLand,3,false);
const pierZ=x=>-1065-(x-1500)*.018;
const boxes=[['family-pavilion',1557,106,76,22,'glass'],['the-yard',1728,103,52,22,'dark'],['shakespeare',1782,54,65,36,'brick'],['festival-hall',2025,440,65,25,'hall'],['sable',2018,430,17,17,'hotel'],['grand-ballroom',2350,71,66,22,'ballroom']];
for(const [id,x,w,d,h,kind]of boxes){const z=pierZ(x)+(id==='sable'?34:id==='the-yard'?-15:id==='family-pavilion'?-2:id==='festival-hall'||id==='grand-ballroom'?-7:0);anchors.push({id,kind,x,z,w,d,h,angle:.018});}
anchors.push({id:'centennial-wheel',kind:'wheel',x:1658,z:-1052,h:59.7});
route('south-dock',[[1506,-1007],[1650,-1007],[1810,-1010],[2070,-1015],[2248,-1018],[2249,-1047],[2295,-1047],[2399,-1048]],7,'walk',3.16);
route('east-end-loop',[[2408,-1048],[2415,-1060],[2415,-1124],[2390,-1124],[2295,-1124]],5,'walk',3.16);
route('pier-entrance-link',[[1455,-1007,1.03],[1488,-1007,3.16],[1506,-1007,3.16]],6,'walk',3.16,'bridge');
for(let x=1510;x<2250;x+=34){surface('dock-planter-'+x,'planting',rect(x,-1018-(x-1500)*.018,x+12,-1012-(x-1500)*.018),3.35,false);trees.push([x+6,-1015-(x-1500)*.018,.8,3.35]);}
for(const z of [-1100,-1020])treeRow([[1400,z],[1460,z]],18,.9);
// Floating docks sit close to water level. Monroe uses moorings, not an invented marina grid.
for(let j=0;j<7;j++){const z=-500+j*58,x=1270+(j<3?0:-j*4);docks.push({id:'dusable-'+j,points:[[x,z],[1395,z+55]],width:3});for(let k=0;k<7;k++){const bx=x+18+k*23,bz=z+(bx-x)*55/(1395-x);docks.push({id:'finger-'+j+'-'+k,points:[[bx,bz],[bx+6,bz-18]],width:1.4});boats.push([bx+9,bz-11,0,1]);}}
for(let x=1540;x<2220;x+=33){docks.push({id:'navy-marina-'+x,points:[[x,-1133-(x-1500)*.018],[x,-1195-(x-1500)*.018]],width:2});boats.push([x+8,-1175-(x-1500)*.018,0,1.2]);}
const rand=rng(2026);
for(let i=0;i<95;i++){const x=1010+rand()*430,z=220+rand()*1120;if(!land.some(p=>inPoly(x,z,p)))boats.push([x,z,.15+rand()*.3,.75+rand()*.4]);}
// Grove placement uses the same lawn polygons and excludes paths, footprints,
// sports fields and formal central axes. No random trees scattered across fields.
for(const f of features.filter(f=>f.kind==='grass'&&/maggie|jane|polk|millennium|groves/.test(f.id))){for(const p of f.polygons){const xs=p[0].map(v=>v[0]),zs=p[0].map(v=>v[1]);for(let x=Math.min(...xs)+8;x<Math.max(...xs);x+=16)for(let z=Math.min(...zs)+8;z<Math.max(...zs);z+=17){if(!inPoly(x,z,p)||rand()>.55)continue;if(f.id==='millennium-grounds'&&x>430&&z<130||f.id==='maggie-daley'&&x>662&&x<807&&z>-200&&z<75)continue;trees.push([x+(rand()-.5)*6,z+(rand()-.5)*6,.85+rand()*.5,.72]);}}}
const treeFree=features.filter(f=>f.id!=='navy-pier-deck'&&['pool','paving','play','ribbon','sand','clay'].includes(f.kind)).flatMap(f=>f.polygons);
const filteredTrees=trees.filter(([x,z,s])=>land.some(p=>inPoly(x,z,p))&&!treeFree.some(p=>inPoly(x,z,p))&&((x>1490&&z>-1145&&z<-995)||!masks.some(p=>inPoly(x,z,p)))&&!paths.some(p=>p.kind!=='rail'&&distanceToLine(x,z,p.points.map(p=>[p[0],p[2]]))<p.width/2+4.2*s)&&!anchors.some(a=>a.w&&Math.abs(a.x-x)<a.w/2+4&&Math.abs(a.z-z)<a.d/2+4)&&Math.hypot(x-739,z-688)>96);
const replacementIds=city.buildings.filter(b=>{const r=b.rings[0],x=r.reduce((s,p)=>s+p[0],0)/r.length,z=r.reduce((s,p)=>s+p[1],0)/r.length;return x>1490&&x<2420&&z>-1145&&z<-995;}).map(b=>b.id);
replacementIds.push(...anchors.flatMap(a=>a.sourceIds||[]));
const sources=[{name:'City of Chicago waterways',url:'https://data.cityofchicago.org/d/knfe-65pw',use:'measured shoreline polygons; original 2014 snapshot, retains peninsula, harbor openings and breakwater islands'},{name:'Cook County 2022 building footprints',url:city.sources[0].url,use:'measured footprint anchors; pier facade subdivisions and roof forms visually estimated'},{name:'Navy Pier 2026 map',url:'https://navypier.org/wp-content/uploads/2025/10/navy-pier-map-2026.png',use:'current built locations, marina, program'},{name:'Field Operations Navy Pier',url:'https://www.fieldoperations.net/project/navy-pier',use:'Wave Wall, paving, planting and furniture appearance'},{name:'Maggie Daley official map',url:'https://www.maggiedaleypark.com/assets/doc/MDP_ParkMap_1123-7705da9d0d.pdf',use:'ribbon, climbing/play forms, gardens, lawns and paths'},{name:'Grant Park',url:'https://www.chicagoparkdistrict.com/parks-facilities/grant-ulysses-park',use:'built park features, excludes future framework proposals'},{name:'Lakefront Trail Grant Park aerial map',url:'https://www.chicagoparkdistrict.com/media/26906',use:'visual tracing of separated trails, fountain gardens and harbor arrangement'},{name:'Lakefront Trail Oak to Ohio aerial map',url:'https://www.chicagoparkdistrict.com/media/26861',use:'visual tracing of beaches, Olive Park pools and separated routes'}];
const riverSurfaces=city.water.filter(w=>!w.name.includes('LAKE')).flatMap(w=>clip.intersection(w.rings,rect(-12000,-9000,1160,9000)));
const data={version:1,origin:ORIGIN,bounds,sources,riverSurfaces,accuracy:'Shoreline and existing footprints are surveyed source geometry. Landscape shapes, subdivisions, heights, tree placements and docked boats are illustrative visual estimates, typically 5–20 m plan accuracy. Typical summer, not live occupancy.',land,terrain,zones,features,paths,anchors,docks,boats:boats.filter(([x,z])=>!land.some(p=>inPoly(x,z,p))),trees:filteredTrees,replacementIds:[...new Set(replacementIds)]};
writeFileSync(new URL('../assets/waterfront.json',import.meta.url),JSON.stringify(data,(_,v)=>typeof v==='number'?Math.round(v*100)/100:v));
console.log({features:features.length,paths:paths.length,trees:filteredTrees.length,anchors:anchors.length,boats:boats.length,replaced:replacementIds.length});
