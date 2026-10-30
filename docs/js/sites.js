import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {boxBatch,polygonGeometry,segmentBox} from './city-data.js?v=bc893891e5c0c0d3';
import {facadeMaterial} from './textures.js?v=bc893891e5c0c0d3';
import {siteVolumes} from './site-data.js?v=bc893891e5c0c0d3';
import {addTrees} from './terrain.js?v=bc893891e5c0c0d3';
import {rng} from './geo.js?v=bc893891e5c0c0d3';
import {registerRoute} from './waterfront-data.js?v=bc893891e5c0c0d3';

const styles={rookery:[0x915f4d,0x273e48,0],federal:[0xcac4b1,0x34434a,0],limestone:[0xc6bead,0x33434b,0],warehouse:[0x9a6750,0x2b414a,0],concrete:[0xc3c0ae,0x496775,0],glass:[0x93adb8,0x3c647b,1],arches:[0x797c76,0x42637a,0],labs:[0xc7c9c2,0x426e83,1],'brick-glass':[0x98715e,0x42637a,0],'charcoal-brick':[0x665e51,0x334d5b,0],'dark-glass':[0x555b5a,0x38556b,1],screen:[0xb9c3c2,0x404c51,0],dark:[0x353b3d,0x233540,0],catalog:[0x7d6b59,0x334d58,1]};
const material=(color,extra={})=>new THREE.MeshStandardMaterial({color,roughness:.76,...extra});
function addMerged(parent,parts,mat,name){if(!parts.length)return;const flat=parts.map(p=>p.index?p.toNonIndexed():p),geo=mergeGeometries(flat);for(const p of new Set([...parts,...flat]))p.dispose();const m=new THREE.Mesh(geo,mat);m.name=name;parent.add(m);return m;}
function beam(parts,a,b,w=.15){const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),dir=bv.clone().sub(av),geo=new THREE.BoxGeometry(w,w,dir.length());geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),dir.normalize()));geo.translate(...av.add(bv).multiplyScalar(.5).toArray());parts.push(geo);}

export function buildSites(scene,ctx){
 const root=new THREE.Group();root.name='site-details';scene.add(root);const lod=[];
 const groundGroups=new Map();
 for(const f of ctx.sites.surfaces){if(!groundGroups.has(f.kind))groundGroups.set(f.kind,[]);groundGroups.get(f.kind).push(polygonGeometry(f.rings,0,f.y));}
 for(const [kind,parts]of groundGroups)addMerged(root,parts,material({parking:0x4e5456,gravel:0x9a9688,grass:0x637f47,paving:0xb8b5a9}[kind]),'site-ground-'+kind);
 for(const s of ctx.sites.sites){
  const group=new THREE.Group(),detail=new THREE.Group();group.name='site-'+s.id;detail.name=s.id+'-fine-detail';group.add(detail);root.add(group);
  const center=s.parts[0];lod.push({group:detail,x:center.x,z:center.z});
  const trim=[],frames=[],plant=[],equipment=[],glass=[],geometry=[];
  for(const p of s.parts){
   const [color,glazing,style]=styles[p.style]||styles.warehouse;
   const mat=facadeMaterial({color,glass:glazing,style,cell:p.style==='catalog'?[2.3,5]:p.style==='warehouse'?[3.1,4.6]:[2.2,4.15],winA:p.style==='concrete'?[.68,.77]:[.73,.79],seed:s.seed,lit:style?.44:.36,roughness:style?.38:.8});
   const mass=boxBatch([[p.x,p.y+p.h/2,p.z,p.w,p.h,p.d]],color,s.id+'-mass',mat);mass.receiveShadow=true;group.add(mass);
   trim.push([p.x,p.y+p.h+.15,p.z,p.w+.12,.3,p.d+.12,0,p.style==='catalog'?0xb8b1a3:0x777b74]);
   // Clear structural bays and floor bands differentiate glass offices and warehouses.
   const floor=p.style==='catalog'?5:p.style==='warehouse'?4.6:4.15;
   for(let y=p.y+floor;y<p.y+p.h-.5;y+=floor){
    const band=p.style==='warehouse'?.22:.35;
    for(const side of [-1,1])frames.push([p.x,y,p.z+side*(p.d/2+.08),p.w,band,.16],[p.x+side*(p.w/2+.08),y,p.z,.16,band,p.d]);
   }
   for(const side of [-1,1]){
    for(let x=p.x-p.w/2+2;x<p.x+p.w/2-1;x+=p.style==='catalog'?6:6.5)frames.push([x,p.y+p.h/2,p.z+side*(p.d/2+.12),.28,p.h,.22]);
    for(let z=p.z-p.d/2+2;z<p.z+p.d/2-1;z+=6.5)frames.push([p.x+side*(p.w/2+.12),p.y+p.h/2,z,.22,p.h,.28]);
   }
   equipment.push([p.x,p.y+p.h+1,p.z,Math.min(8,p.w*.2),1.6,Math.min(8,p.d*.2)]);
   if(p.y<1&&p.style!=='catalog')for(let x=p.x-p.w/2+5;x<p.x+p.w/2-3;x+=8){glass.push([x,2.8,p.z+p.d/2+.15,5.7,4.1,.12]);frames.push([x,5,p.z+p.d/2+.6,6,.3,1.2]);}
  }
  const p=s.parts[0];
  if(s.style==='rookery'){
   for(const y of [7,12,34,45,53.7])for(const side of [-1,1])trim.push([p.x,y,p.z+side*(p.d/2+.23),p.w+.5,.8,.7,0,0xa97d65],[p.x+side*(p.w/2+.23),y,p.z,.7,.8,p.d+.5,0,0xa97d65]);
   // Heavy Romanesque entrance arch faces west toward LaSalle.
   arch(geometry,p.x-p.w/2-.25,7,p.z,4.5,Math.PI/2);
  }
  if(s.style==='federal'){
   for(let z=p.z-p.d/2+5;z<p.z+p.d/2-3;z+=5){const c=new THREE.CylinderGeometry(.6,.74,15,10);c.translate(p.x+p.w/2+.22,10,z);geometry.push(c);trim.push([p.x+p.w/2+.22,17.5,z,1.8,.8,1.8]);}
   trim.push([p.x+p.w/2+.2,20,p.z,1.5,1.2,p.d]);
  }
  if(s.style==='arches')for(const side of [-1,1]){
   for(let x=p.x-p.w/2+4;x<p.x+p.w/2-2;x+=6.5){arch(geometry,x,p.h-5,p.z+side*(p.d/2+.2),2.7);arch(geometry,x,5,p.z+side*(p.d/2+.2),2.7);}
   for(let z=p.z-p.d/2+4;z<p.z+p.d/2-2;z+=6.5)arch(geometry,p.x+side*(p.w/2+.2),p.h-5,z,2.7,Math.PI/2);
  }
  if(s.style==='braced'){
   const bx=p.x+p.w/2+.3;
   for(let y=6;y<78;y+=24){beam(geometry,[bx,y,p.z-p.d/2],[bx,y+22,p.z+p.d/2],.7);beam(geometry,[bx,y,p.z+p.d/2],[bx,y+22,p.z-p.d/2],.7);}
   for(const q of s.parts.slice(1))plant.push([q.x-q.w/2-2,q.y+.3,q.z,2.5,.6,q.d*.7]);
  }
  if(s.style==='labs'){
   // Bright horizontal lab-floor ribbons, dark mechanical crown and stepped roof garden.
   for(let y=8;y<p.h-5;y+=4.5)for(const side of [-1,1])trim.push([p.x,y,p.z+side*(p.d/2+.25),p.w,.85,.35,0,0xc0c6bf]);
   equipment.push([p.x+8,p.h+2,p.z,25,3,18]);
  }
  if(s.style==='dual-glass'){
   const q=s.parts[0];for(let x=q.x-q.w/2+1;x<q.x+q.w/2;x+=1.8)frames.push([x,11,q.z+q.d/2+.25,.15,13,.3]);
   for(const side of [-1,1])beam(geometry,[-1776+side*28,1,-733],[-1776+side*15,19,-733],1.3);
  }
  if(s.style==='terraced'){
   for(const q of s.parts.slice(1))plant.push([q.x-q.w/2-1,q.y+.25,q.z,1.3,.5,q.d*.8]);
   // Glazed connector to the retained factory on the east, below the tower.
   glass.push([-1873,7,-433,3,13,28]);
  }
  if(s.style==='catalog')catalog(group,detail,trim,frames,plant,glass,geometry);
  for(const [items,color,name]of [[trim,0xb3ad9d,'roof-cornice'],[frames,s.style==='warehouse'?0x6d5144:0x4d5657,'facade-frames'],[plant,0x6b884a,'terrace-planting'],[equipment,0x747c79,'roof-equipment'],[glass,0x2c4857,'entrances']])if(items.length)(name==='roof-cornice'?group:detail).add(boxBatch(items,color,s.id+'-'+name));
  addMerged(detail,geometry,material(s.style==='federal'?0xc1b9a6:0x747975),'site-'+s.id+'-architecture');
 }
 // Parked vehicles use only the explicitly identified parking-space rows.
 const bodies=[],windows=[],wheels=[],lines=[],fences=[],racks=[],trees=[];
 const colors=[0xd0d0c7,0x3d454e,0x7b3631,0x8b959c,0x30393a,0xe1ddd1];
 for(const [i,p]of ctx.sites.parking.entries()){
  bodies.push([p.x,1.1,p.z,1.8,.9,4.2,p.angle,colors[i%colors.length]]);windows.push([p.x,1.7,p.z,1.55,.55,2.4,p.angle]);
  for(const off of [-1.35,1.35]){const x=p.x+Math.sin(p.angle)*off,z=p.z+Math.cos(p.angle)*off;wheels.push([x,.75,z,1.93,.5,.45,p.angle]);}
  lines.push([p.x+Math.cos(p.angle)*1.45,.69,p.z-Math.sin(p.angle)*1.45,.09,.025,5.2,p.angle]);
 }
 for(const f of ctx.sites.furniture){
  if(f.kind==='tree')trees.push([f.x,f.z,.7]);
  if(f.kind==='bollard')fences.push([f.x,1.12,f.z,.22,.95,.22]);
  if(f.kind==='rack'){racks.push([f.x,1.3,f.z,.08,.08,1.2]);for(const dz of [-.55,.55])racks.push([f.x,1,f.z+dz,.08,.6,.08]);}
 }
 for(const f of ctx.sites.surfaces.filter(f=>f.kind==='parking'||f.kind==='gravel'))for(let i=1;i<f.rings[0].length;i++){const a=f.rings[0][i-1],b=f.rings[0][i];if(i===1)continue;segmentBox(fences,a,b,.08,1.6,.12);const n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/3);for(let j=0;j<n;j++)fences.push([a[0]+(b[0]-a[0])*j/n,1.2,a[1]+(b[1]-a[1])*j/n,.08,1.3,.08]);}
 const furnitureGroup=new THREE.Group();furnitureGroup.name='fulton-furniture';root.add(furnitureGroup);lod.push({group:furnitureGroup,x:-2160,z:-780});
 for(const [items,color,name]of [[bodies,0xffffff,'parked-vehicles'],[windows,0x2d4755,'parked-glass'],[wheels,0x24292a,'parked-wheels'],[lines,0xbdbba8,'parking-markings'],[fences,0x525d5b,'parcel-fences'],[racks,0x78827d,'bike-racks']])if(items.length)furnitureGroup.add(boxBatch(items,color,name));
 addTrees(root,trees,rng(360));
 for(const r of ctx.sites.routes)registerRoute(ctx,r.id,r.points);
 ctx.collisionBuildings.push(...siteVolumes(ctx.sites));
 ctx.siteDetailUpdate=camera=>{for(const d of lod)d.group.visible=Math.hypot(camera.position.x-d.x,camera.position.y,camera.position.z-d.z)<1700;};
 ctx.siteStats={sites:ctx.sites.sites.length,parked:ctx.sites.parking.length,volumes:siteVolumes(ctx.sites).length};
 buildLakeStructure(root,ctx);
}
function arch(parts,x,y,z,r,angle=0){const g=new THREE.TorusGeometry(r,.23,4,16,Math.PI);g.rotateY(angle);g.translate(x,y,z);parts.push(g);}
function catalog(group,detail,trim,frames,plant,glass,geometry){
 const x=-671,z=399;
 // Gensler's three-story southern podium with warm upper panels and glazed entries.
 for(let px=-709;px<-629;px+=6){frames.push([px,8,420.25,.35,14,.35]);glass.push([px,5.3,420.25,5.5,8,.14]);trim.push([px,12.6,420.35,5.5,3,.18,0,0x92795e]);}
 glass.push([x,5.1,421,13,8.8,.12]);trim.push([x,9.7,422.1,16,.25,3]);
 // 75 x 90 ft gridshell: shallow curved skylight, not a dome or flat slab.
 const w=22.86,d=27.43,base=15.8;
 const geo=new THREE.PlaneGeometry(w,d,16,16);geo.rotateX(-Math.PI/2);
 const p=geo.attributes.position;for(let i=0;i<p.count;i++){const xx=p.getX(i),zz=p.getZ(i);p.setY(i,3.3*Math.cos(xx/w*Math.PI)*Math.cos(zz/d*Math.PI));}geo.computeVertexNormals();geo.translate(x,base,z);
 const roof=new THREE.Mesh(geo,material(0x759ca9,{roughness:.22,metalness:.45,side:THREE.DoubleSide}));roof.name='catalog-curved-skylight';group.add(roof);
 for(let i=0;i<=8;i++)for(let j=0;j<12;j++){
  const a=-w/2+i*w/8,b=-d/2+j*d/12,c=b+d/12;
  beam(geometry,[x+a,base+3.3*Math.cos(a/w*Math.PI)*Math.cos(b/d*Math.PI)+.08,z+b],[x+a,base+3.3*Math.cos(a/w*Math.PI)*Math.cos(c/d*Math.PI)+.08,z+c],.13);
 }
 for(let i=0;i<=8;i++)for(let j=0;j<12;j++){
  const a=-d/2+i*d/8,b=-w/2+j*w/12,c=b+w/12;
  beam(geometry,[x+b,base+3.3*Math.cos(b/w*Math.PI)*Math.cos(a/d*Math.PI)+.08,z+a],[x+c,base+3.3*Math.cos(c/w*Math.PI)*Math.cos(a/d*Math.PI)+.08,z+a],.13);
 }
 const roofTrees=[];
 for(const px of [-703,-640]){
  // Curved planted islands and pale winding paving, following the completed garden.
  const shape=new THREE.Shape();shape.absellipse(0,0,6.3,13,0,Math.PI*2,false,0);
  const lawn=new THREE.ShapeGeometry(shape,24);lawn.rotateX(-Math.PI/2);lawn.translate(px,15.96,399);
  const island=new THREE.Mesh(lawn,material(0x68824b));detail.add(island);
  for(const dz of [-10,3,11]){roofTrees.push([px+(dz===3?2:-2),399+dz,.45,16]);trim.push([px+(px<-670?7:-7),16.4,399+dz,2.8,.45,.7,0,0xb59b75]);}
 }
 addTrees(detail,roofTrees,rng(233));
 for(const side of [-1,1])frames.push([-671,16.5,399+side*20.2,86,.1,.1]);
 // Four glass Skydeck boxes on the west face at the 103rd-floor level.
 for(const dz of [-8,-3,3,8]){glass.push([-708.1,414.3,344+dz,1.3,3.2,2.7]);frames.push([-708.8,412.7,344+dz,.12,.12,2.8]);}
}
function buildLakeStructure(parent,ctx){
 const deck=[],rails=[],columns=[],stations=[],stairs=[];
 // Continue the existing Loop's Lake Street structure west through Morgan.
 const points=[[-2550,-382],[-2207,-390],[-2014,-394],[-1724,-401],[-1300,-408],[-950,-409],[-800,-400],[-509,-387]];
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i];segmentBox(deck,a,b,7,8.35,.6);
  for(const off of [-2.2,-.8,.8,2.2])segmentBox(rails,[a[0],a[1]+off],[b[0],b[1]+off],.15,8.85,.18);
  const n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/24);for(let j=0;j<n;j++){const x=a[0]+(b[0]-a[0])*j/n,z=a[1]+(b[1]-a[1])*j/n;for(const side of [-1,1])columns.push([x,4.2,z+side*4.5,.5,8,.5]);columns.push([x,7.8,z,.6,.6,10]);}
 }
 for(const side of [-1,1]){stations.push([-1960,8.8,-395+side*5.8,110,.55,3]);stations.push([-1960,12.5,-395+side*5.8,85,.3,3.6]);for(let x=-2000;x<-1920;x+=15)columns.push([x,10.6,-395+side*5.8,.2,3.4,.2]);}
 // Morgan station's glass pedestrian bridge and stair towers.
 stations.push([-1918,14,-395,5,.5,19]);for(const side of [-1,1])for(let i=0;i<22;i++)stairs.push([-2003+i*.55,.7+i*.37,-395+side*9, .6,.22,2]);
 for(const [items,color,name]of [[deck,0x555e58,'lake-elevated-deck'],[rails,0x909997,'lake-elevated-rails'],[columns,0x687569,'lake-elevated-columns'],[stations,0xaab4b0,'morgan-station'],[stairs,0x959b91,'morgan-station-stairs']])parent.add(boxBatch(items,color,name));
 // Existing four trains remain on their existing Loop route.
}
