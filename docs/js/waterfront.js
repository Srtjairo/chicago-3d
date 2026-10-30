import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {polygonGeometry,boxBatch,segmentBox} from './city-data.js?v=bc893891e5c0c0d3';
import {addTrees} from './terrain.js?v=bc893891e5c0c0d3';
import {buildSouthGrant} from './south-grant.js?v=bc893891e5c0c0d3';
import {grassTexture} from './textures.js?v=bc893891e5c0c0d3';
import {rng} from './geo.js?v=bc893891e5c0c0d3';
import {registerRoute,distanceToLine} from './waterfront-data.js?v=bc893891e5c0c0d3';

const colors={grass:0xd2e6a7,path:0xd6cdb7,paving:0xc9c4b8,flowers:0x907f98,planting:0x547a40,sand:0xe7ce97,clay:0xb18c61,ballast:0x565954,rail:0x4e5553,ribbon:0xa9b8b2,play:0xccb45f,court:0x5b8e7c,pool:0x438f96,cycle:0x6d7771,skate:0xc7bdab,dog:0xc0b9a5,service:0x777b76};
export function buildWaterfront(scene,ctx){
 const data=ctx.waterfront,group=new THREE.Group();group.name='waterfront';scene.add(group);
 const chunks=new Map(),detail=new THREE.Group();detail.name='waterfront-furniture';group.add(detail);
 const grass=grassTexture();grass.repeat.set(1,1);
 for(const f of data.features)for(const rings of f.polygons){const g=f.id==='navy-pier-deck'?polygonGeometry(rings,3.6,-.6):polygonGeometry(rings,0,f.y);const p=g.attributes.position,uv=[];for(let i=0;i<p.count;i++)uv.push(p.getX(i)/55,p.getZ(i)/55);g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));if(!chunks.has(f.kind))chunks.set(f.kind,[]);chunks.get(f.kind).push(g.toNonIndexed());g.dispose();}
 for(const [kind,parts]of chunks){const mat=new THREE.MeshStandardMaterial({color:colors[kind],roughness:kind==='pool'?.24:.91,metalness:kind==='pool'?.25:0,...(kind==='grass'?{map:grass}:{} )});const g=mergeGeometries(parts);parts.forEach(p=>p.dispose());const mesh=new THREE.Mesh(g,mat);mesh.name='waterfront-'+kind;mesh.receiveShadow=true;group.add(mesh);}
 const seats=[],rails=[],timber=[],stone=[],steel=[],white=[],play=[],planting=[];
 const gardenRand=rng(311);
 for(const f of data.features.filter(f=>f.kind==='flowers'))for(const rings of f.polygons){
  const ring=rings[0];for(let i=1;i<ring.length;i++)segmentBox(planting,ring[i-1],ring[i],.75,f.y+.35,.6);
  const xs=ring.map(p=>p[0]),zs=ring.map(p=>p[1]);for(let i=0;i<40;i++){const x=Math.min(...xs)+gardenRand()*(Math.max(...xs)-Math.min(...xs)),z=Math.min(...zs)+gardenRand()*(Math.max(...zs)-Math.min(...zs));if(pointIn(x,z,rings))planting.push([x,f.y+.22,z,1.3,.3,1.3,0,[0x9a8eaf,0xb49a7b,0x8a9d6b,0x728c58][i%4]]);}
 }
 // Six tennis courts occupy the northeast edge shown on the official park map.
 for(let i=0;i<6;i++){const x=896+i*13;for(const z of [-221,-197])white.push([x,1.01,z,10.8,.035,.12]);for(const dx of [-5.4,5.4])white.push([x+dx,1.01,-209,.12,.035,24]);white.push([x,1.01,-209,10.8,.035,.12]);steel.push([x,1.5,-209,11,.8,.07]);}
 for(const path of data.paths){
  if(path.mode!=='none')registerRoute(ctx,path.id,path.points,path.mode);
  for(let i=1;i<path.points.length;i++){
   const p=path.points[i-1],q=path.points[i],a=[p[0],p[2]],b=[q[0],q[2]],y=(p[1]+q[1])/2;
   if(path.kind==='rail')for(const off of [-.72,.72])segmentBox(steel,[a[0]+off,a[1]],[b[0]+off,b[1]],.09,y,.12);
   if(path.kind==='bridge')segmentBox(stone,a,b,path.width,y-.15,.3);
   if(/south-dock|olive-promenade|lakefront-south-walk/.test(path.id)){
    const dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz)||1;
    const nx=-dz/len,nz=dx/len;
    for(let d=15;d<len;d+=33){const x=a[0]+dx*d/len,z=a[1]+dz*d/len;seats.push([x+nx*4,y+.45,z+nz*4,2.8,.42,.65,Math.atan2(dx,dz)]);}
   }
  }
 }
 // Shoreline walls follow surveyed boundaries, including the harbor mouths and
 // peninsula. Do not connect separate rings with a synthetic cross-water edge.
 for(const poly of data.land)for(const ring of poly)for(let i=1;i<ring.length;i++){
  const a=ring[i-1],b=ring[i];if(a[0]<=data.bounds.minX+.1||b[0]<=data.bounds.minX+.1||Math.abs(a[1]-data.bounds.minZ)<.1||Math.abs(a[1]-data.bounds.maxZ)<.1)continue;
  const mid=[(a[0]+b[0])/2,(a[1]+b[1])/2];if(data.features.some(f=>f.kind==='sand'&&f.polygons.some(p=>pointIn(...mid,p)||distanceToLine(...mid,p[0])<1.5)))continue;
  segmentBox(stone,a,b,1.2,-.05,1.2);
 }
 for(const a of data.anchors){
  if(a.kind==='backstop'){const angle=a.angle;for(const side of [-1,1]){const x=a.x+side*6,z=a.z;steel.push([x,2.1,z,.12,3,.12]);}steel.push([a.x,3.5,a.z,12,.1,.1,angle]);}
  if(a.kind==='hill'){
   const g=new THREE.SphereGeometry(1,16,8,0,Math.PI*2,0,Math.PI/2);g.scale(a.rx,a.h,a.rz);g.translate(a.x,.73,a.z);const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:0x648a42,roughness:1}));group.add(m);
  }
  if(a.kind==='rock'){
   const g=new THREE.DodecahedronGeometry(1,0);g.scale(a.w/2,a.h/2,a.d/2);g.translate(a.x,.8+a.h/2,a.z);const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:0x9a9a8b,flatShading:true,roughness:.9}));group.add(m);
   for(let i=0;i<16;i++)play.push([a.x-a.w*.48,.9+i*.6,a.z-3+(i%4)*2,.35,.3,.35,0,[0xe4a851,0x5b7f91,0xa55c50][i%3]]);
  }
  if(a.kind==='play'){
   for(const dx of [-a.w/2,a.w/2])for(const dz of [-a.d/2,a.d/2])timber.push([a.x+dx,.8+a.h/2,a.z+dz,.35,a.h,.35]);
   timber.push([a.x,a.h*.6,a.z,a.w,.4,a.d]);play.push([a.x,a.h+1,a.z,a.w+2,.4,a.d+2,0,0xc29047]);
   for(let k=0;k<10;k++)play.push([a.x+a.w/2+1+k*.7,a.h*.6-k*a.h*.055,a.z,1.8,.16,1.8,0,0x92b4b5]);
  }
  if(a.kind==='stage'){stone.push([a.x,1.5,a.z,a.w,1.2,a.d]);steel.push([a.x,5,a.z,a.w,.3,a.d]);for(const dx of [-a.w/2,a.w/2])steel.push([a.x+dx,3.1,a.z-3,.3,4.4,.3]);}
  if(a.kind==='shell'){
   stone.push([a.x,2,a.z,a.w,2,a.d]);const roof=new THREE.Mesh(new THREE.SphereGeometry(1,24,12,0,Math.PI,0,Math.PI/2),new THREE.MeshStandardMaterial({color:0xd3d3c7,side:THREE.DoubleSide,roughness:.7}));roof.scale.set(23,15,23);roof.position.set(a.x,1,a.z);roof.rotation.y=Math.PI*.7;group.add(roof);
  }
 }
 // Timber play towers connect by an elevated narrow bridge; handrails and
 // sloping slides distinguish the play garden from small park shelters.
 segmentBox(timber,[770,10],[808,38],1.8,3.4,.25);
 for(const side of [-1,1])segmentBox(timber,[770-side*.7,10+side],[808-side*.7,38+side],.1,4.3,.12);
 for(let i=0;i<=10;i++){const x=770+i*3.8,z=10+i*2.8;for(const side of [-1,1])timber.push([x-side*.7,3.85,z+side,.12,1,.12]);}
 // Pier Park's raised terrace and curving timber Wave Wall steps.
 for(let k=0;k<10;k++){
  for(let i=0;i<24;i++){const x=1610+i*4,z=-1029+Math.sin(i/23*Math.PI)*9+k*.9;timber.push([x,3.2+(9-k)*.28,z,4.2,.29,1.1]);}
 }
 stone.push([1660,4.6,-1048,92,3.2,34]);
 // Carousel canopy, simple outdoor tables and terrace furniture.
 const carousel=new THREE.Mesh(new THREE.ConeGeometry(8,4,16),new THREE.MeshStandardMaterial({color:0xc2a46c,roughness:.8}));carousel.position.set(1625,12,-1054);group.add(carousel);
 for(let x=2310;x<2337;x+=8)for(let z=-1097;z<-1040;z+=10){timber.push([x,3.8,z,3,.2,3]);white.push([x,6.2,z,4,.12,4]);}
 for(const dock of data.docks)for(let i=1;i<dock.points.length;i++)segmentBox(timber,dock.points[i-1],dock.points[i],dock.width,ctx.waterLevel((dock.points[i-1][0]+dock.points[i][0])/2,(dock.points[i-1][1]+dock.points[i][1])/2)+.1,.5);
 for(let x=1530;x<2240;x+=28){rails.push([x,3.65,-1000-(x-1500)*.018,.12,1.3,.12]);}
 segmentBox(rails,[1500,-1000],[2240,-1013.3],.12,4.3,.12);
 const [canopy,trunk]=addTrees(group,data.trees,rng(91));canopy.name='waterfront-trees';trunk.name='waterfront-trunks';
 const pools=[[seats,0x94724d,'seating'],[rails,0x526563,'rails'],[timber,0xad8b61,'timber'],[stone,0xc4bdab,'stone'],[steel,0x626d69,'steel'],[white,0xe0d7c4,'terraces'],[play,0xffffff,'play-details'],[planting,0x678951,'planting']];
 for(const [items,color,name]of pools)if(items.length){const m=boxBatch(items,color,'waterfront-'+name);(name==='seating'||name==='rails'||name==='play-details'?detail:group).add(m);}
 buildMooredBoats(group,data.boats,ctx);
 const south=buildSouthGrant(group,data);
 ctx.waterfrontDetailUpdate=camera=>{south.visible=Math.hypot(camera.position.x-590,camera.position.y,camera.position.z-1300)<2500;detail.visible=camera.position.y<1200&&Math.hypot(camera.position.x-1400,camera.position.z+450)<3500;};
 ctx.waterfrontStats={trees:data.trees.length,mooredBoats:data.boats.length,routes:data.paths.filter(p=>p.mode!=='none').length};
}
function pointIn(x,z,rings){let inside=false;for(const r of rings){let v=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])v=!v;}inside=inside!==v;}return inside;}
function buildMooredBoats(group,boats,ctx){
 const hulls=[],cabins=[],masts=[],booms=[];
 for(const [x,z,a,s]of boats){const waterY=ctx.waterLevel(x,z);hulls.push([x,waterY+.05*s,z,2.6*s,.9*s,8*s,a]);cabins.push([x,waterY+.85*s,z,1.8*s,.7*s,3.3*s,a]);masts.push([x,waterY+5.8*s,z,.1,11*s,.1]);booms.push([x+Math.sin(a)*1.6*s,waterY+2.2*s,z+Math.cos(a)*1.6*s,.18,.2,3.2*s,a]);}
 // All boats are docked/moored with furled sails. Existing moving-boat budget stays eight.
 for(const [v,c,n]of [[hulls,0xe3e5dd,'hulls'],[cabins,0xaabfc1,'cabins'],[masts,0xa9b4b1,'masts'],[booms,0xb3c1c8,'furled-sails']])group.add(boxBatch(v,c,'moored-'+n));
}
