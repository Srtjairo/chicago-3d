import {siteAt} from './site-data.js';
import {transitAt} from './transit-data.js';
import {landscapeAt,waterfrontAt,waterfrontLand} from './waterfront-data.js';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { boundsOf, inCoverage, inPolygon, polygonGeometry, boxBatch, segmentBox } from './city-data.js';
import { addTrees } from './terrain.js';
import { rng } from './geo.js';
import {prepareLakeShore} from './lake-shore-data.js';
import {buildLakeShore} from './lake-shore.js';

export function prepareWorld(ctx) {
  const water = ctx.data.water.filter((w) => !w.name.includes('LAKE')).map((w) => ({ ...w, bounds: boundsOf(w.rings[0]) }));
  ctx.waterLevel=(x,z)=>ctx.waterfront.riverSurfaces.some(rings=>inPolygon(x,z,rings))?.2:-.6;
  ctx.isRiver = (x, z) => water.some((w) => x >= w.bounds.x0 && x <= w.bounds.x1 && z >= w.bounds.z0 && z <= w.bounds.z1 && inPolygon(x,z,w.rings));
  ctx.lakeShore=prepareLakeShore(ctx.lakeShoreData,ctx.isRiver);
  ctx.roads = ctx.data.streets.filter((s) => s.class >= 1 && s.class <= 4 && !/LOWER|RAMP|EXPY/.test(s.road) && s.level.every((h) => h >= 0))
    .filter(s=>!ctx.lakeShore.sourceIds.has(s.id))
    .filter((s) => s.points.every(([x,z]) => inCoverage(x,z,80)) || /LAKE SHORE/.test(s.road)&&s.points.every(([x,z])=>waterfrontAt(x,z)))
    .map((s) => {
      const width = /MICHIGAN|COLUMBUS|ROOSEVELT|LAKE SHORE/.test(s.road) ? 20 : s.class <= 3 ? 16 : 12;
      const points = [];
      for (let i = 1; i < s.points.length; i++) {
        const a=s.points[i-1], b=s.points[i], n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/12));
        for(let j=0;j<n;j++) points.push([a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n]);
      }
      points.push(s.points.at(-1));
      const wet=points.map(([x,z])=>ctx.isRiver(x,z));
      const bridge = wet.some(Boolean);
      // Road and moving agents share this gently ramped bridge surface.
      const path=points.map(([x,z],i)=>[x,bridge ? 0.26+4*Math.max(...wet.map((v,j)=>v ? Math.max(0,1-Math.abs(i-j)/4):0)) : 0.26,z]);
      return {...s,width,bridge,path};
    }).concat(ctx.lakeShore.roads);
}

export function buildWaterGeometry(scene, ctx) {
  const mat = new THREE.MeshStandardMaterial({ color:0x285957,roughness:0.3,metalness:0.18,normalMap:ctx.riverNormals,normalScale:new THREE.Vector2(0.12,0.12),side:THREE.DoubleSide });
  const parts=[];
  for(const rings of ctx.waterfront.riverSurfaces) {
    const g=polygonGeometry(rings,0,0.2);
    const p=g.attributes.position, uv=[];
    for(let i=0;i<p.count;i++) uv.push(p.getX(i),p.getZ(i));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    parts.push(g.toNonIndexed()); g.dispose();
  }
  const geo=mergeGeometries(parts,false); parts.forEach(g=>g.dispose());
  const river=new THREE.Mesh(geo,mat);river.name='surveyed-river';river.receiveShadow=true;scene.add(river);
}

export function buildStreets(scene,ctx) {
  const roads=[],walks=[],marks=[],rails=[],posts=[],lamps=[],bridgeSteel=[],furniture=[],trees=[];
  const rand=rng(1661);
  const junctions=new Map();
  for(const road of ctx.roads) {
    if(road.highway)continue;
    const {path,width}=road;
    for(let i=1;i<path.length;i++) {
      const a=path[i-1],b=path[i],aa=[a[0],a[2]],bb=[b[0],b[2]], y=(a[1]+b[1])/2;
      segmentBox(walks,aa,bb,width+7,y-0.08,0.25);
      segmentBox(roads,aa,bb,width,y+0.07,0.12);
      if(i%2===0 && Math.hypot(b[0]-a[0],b[2]-a[2])>3) segmentBox(marks,aa,bb,0.18,y+0.14,0.02);
      if(road.bridge && y>3.8) {
        const dx=b[0]-a[0],dz=b[2]-a[2],len=Math.hypot(dx,dz),nx=-dz/len,nz=dx/len;
        for(const side of [-1,1]) {
          const off=side*(width/2+2.6),p=[aa[0]+nx*off,aa[1]+nz*off],q=[bb[0]+nx*off,bb[1]+nz*off];
          segmentBox(rails,p,q,0.45,y+1.25,1.15);
          bridgeSteel.push([p[0],y+0.65,p[1],0.6,1.8,0.6]);
        }
      }
    }
    if(path.length<3) continue;
    for(const [id,p,neighbor] of [[road.from,path[0],path[1]],[road.to,path.at(-1),path.at(-2)]]) {
      if(!junctions.has(id)) junctions.set(id,{p,roads:[]});
      junctions.get(id).roads.push({road,neighbor});
    }
    // Street trees, benches and lamp posts follow the actual sidewalks.
    if(!road.bridge && road.class>1 && !/LAKE SHORE/.test(road.road)) for(let i=2;i<path.length-2;i+=5) {
      const a=path[i-1],p=path[i],dx=p[0]-a[0],dz=p[2]-a[2],len=Math.hypot(dx,dz);if(len<1)continue;
      const side=i%2===0?1:-1,off=side*(width/2+2);
      const x=p[0]-dz/len*off,z=p[2]+dx/len*off;
      if(siteAt(ctx,x,z)||transitAt(ctx,x,z)||ctx.isRiver(x,z)||landscapeAt(x,z)||waterfrontAt(x,z)&&!waterfrontLand(x,z))continue;
      // Reject positions inside the measured footprints, including overhanging podiums.
      if(ctx.measuredBuildings.some(b=>x>b.x0-1&&x<b.x1+1&&z>b.z0-1&&z<b.z1+1&&inPolygon(x,z,b.rings)))continue;
      posts.push([x,3.6,z,0.16,7,0.16]);lamps.push([x,7.2,z,1.3,0.18,0.7]);
      if(rand()<0.65){
        // Move along the sidewalk, never five metres inward into the traffic lane.
        const tx=x+dx/len*5,tz=z+dz/len*5;
        if(!siteAt(ctx,tx,tz)&&!transitAt(ctx,tx,tz)&&!ctx.measuredBuildings.some(b=>tx>b.x0-1&&tx<b.x1+1&&tz>b.z0-1&&tz<b.z1+1&&inPolygon(tx,tz,b.rings)))trees.push([tx,tz,0.6+rand()*0.16]);
      }
      if(rand()<0.2) furniture.push([x,0.9,z,1.6,0.45,0.55,Math.atan2(dx,dz)]);
    }
  }
  const signals=[];
  for(const [id,j] of junctions) {
    if(j.roads.length<3 || j.p[1]>1) continue;
    for(const {road,neighbor} of j.roads) {
      const p=j.p,dx=neighbor[0]-p[0],dz=neighbor[2]-p[2],len=Math.hypot(dx,dz);if(len<1)continue;
      const ux=dx/len,uz=dz/len,offset=13;
      for(let k=-road.width/2+1;k<road.width/2;k+=2.5) marks.push([p[0]+ux*offset-uz*k,p[1]+0.16,p[2]+uz*offset+ux*k,1.1,0.03,3.5,Math.atan2(ux,uz)]);
      const x=p[0]+ux*16-uz*(road.width/2+1),z=p[2]+uz*16+ux*(road.width/2+1);
      posts.push([x,2.5,z,0.2,5,0.2]);
      signals.push({x,z,axis:Math.abs(dx)>Math.abs(dz)?0:1,id:Number(id)||0});
    }
  }
  const glow=new THREE.MeshStandardMaterial({color:0xe3d7bd,emissive:0xffc982,emissiveIntensity:0,roughness:0.65});
  ctx.glows.push({mat:glow,day:0,night:0.8});
  const group=new THREE.Group();group.name='surveyed-streets';
  for(const [items,color,name,mat] of [[walks,0xa7a499,'sidewalks'],[roads,0x363c40,'roads'],[marks,0xc7c4ae,'lane-markings'],[rails,0x705747,'bridge-rails'],[bridgeSteel,0x5c4038,'bridge-steel'],[posts,0x424a4b,'street-furniture'],[lamps,0,'lamps',glow],[furniture,0x776b57,'benches']]) {
    const mesh=boxBatch(items,color,name,mat);mesh.receiveShadow=items===roads||items===walks;group.add(mesh);
  }
  scene.add(group);addTrees(scene,trees,rand);ctx.signals=signals;ctx.junctions=junctions;
  buildLakeShore(scene,ctx);
  buildRiverwalk(scene,ctx);
}

function buildRiverwalk(scene,ctx) {
  // South-bank promenade, below Wacker, from Lake Street to the lakefront.
  const path=[[-780,-458],[-706,-518],[-637,-550],[-490,-551],[-265,-550],[-30,-550],[65,-582],[120,-658],[206,-688],[300,-687],[580,-682],[650,-639],[890,-639],[1110,-639]];
  const walks=[],rails=[],seats=[],steps=[];
  for(let i=1;i<path.length;i++) {
    segmentBox(walks,path[i-1],path[i],8,0.48,0.4);
    const a=path[i-1],b=path[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);
    segmentBox(rails,[a[0]+dz/len*4,a[1]-dx/len*4],[b[0]+dz/len*4,b[1]-dx/len*4],0.3,1.1,0.85);
    for(let t=12;t<len;t+=35) seats.push([a[0]+dx*t/len,1.1,a[1]+dz*t/len,2.7,0.5,0.7,Math.atan2(dx,dz)]);
  }
  for(const x of [-500,-260,-10,285,610]) for(let k=0;k<5;k++) steps.push([x,0.45+k*0.18,x<0?-549+k*1.2:-681+k*1.2,8,0.2,1.3]);
  scene.add(boxBatch(walks,0xbfb5a0,'riverwalk'),boxBatch(rails,0x4b5a5a,'riverwalk-railing'),boxBatch(seats,0x8d7254,'riverwalk-seats'),boxBatch(steps,0xb6ad9b,'riverwalk-steps'));
  ctx.riverwalkPath=path.map(([x,z])=>[x,0.7,z]);
}
