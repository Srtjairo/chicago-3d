import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {boxBatch,segmentBox} from './city-data.js?v=196332b19f6f2af2';
import {rng} from './geo.js?v=196332b19f6f2af2';

// Repeated park objects are instanced. No new lights or shadow casters.
export function buildSouthGrant(parent,data){
 const g=new THREE.Group();g.name='south-grant-details';parent.add(g);
 const concrete=[],white=[],steel=[],bronze=[],courts=[],blue=[],seats=[];
 const mat=color=>new THREE.MeshStandardMaterial({color,roughness:.83});
 const solids=[];
 for(const a of data.anchors.filter(a=>a.id.startsWith('south-'))){
  const {x,z}=a;
  if(a.kind==='court'){
   courts.push([x,.91,z,a.w,.06,a.d]);blue.push([x,.95,z,a.w*.72,.025,a.d*.81]);
   const w=a.sport==='tennis'?10.97:6.1,d=a.sport==='tennis'?23.77:13.41;
   for(const dx of [-w/2,w/2])white.push([x+dx,.98,z,.09,.025,d]);
   for(const dz of [-d/2,0,d/2])white.push([x,.98,z+dz,w,.025,.09]);
   for(const dz of [-1,1]){white.push([x,.98,z+dz*d*.23,w,.025,.09]);white.push([x,.98,z+dz*d*.115,.09,.025,d*.23]);}
   steel.push([x,1.45,z,w+1,.9,.045]);
   for(const dx of [-a.w/2,a.w/2])steel.push([x+dx,2,z,.07,2.3,.07]);
  }
  if(a.kind==='diamond'){
   const ca=Math.cos(a.angle),sa=Math.sin(a.angle),p=(f,r)=>[x+ca*f-sa*r,z+sa*f+ca*r];
   const points=[p(0,0),p(a.size,-a.size),p(a.size*2,0),p(a.size,a.size),p(0,0)];
   for(let i=1;i<points.length;i++)segmentBox(white,points[i-1],points[i],.1,.88,.025);
   for(const q of points.slice(0,4))white.push([q[0],.92,q[1],.42,.08,.42,a.angle]);
   segmentBox(steel,p(-1,-5),p(-1,5),.06,2.5,.1);
   for(const side of [-5,0,5]){const q=p(-1,side);steel.push([q[0],1.8,q[1],.07,2,.07]);}
  }
  if(a.kind==='fence'){
   for(const dx of [-a.w/2,a.w/2])steel.push([x+dx,1.5,z,.07,1.3,a.d]);
   for(const dz of [-a.d/2,a.d/2])steel.push([x,1.5,z+dz,a.w,1.3,.07]);
  }
  if(a.kind==='agora'){
   const torso=new THREE.CylinderGeometry(.49,.61,1.45,7,2,true);torso.scale(1,1,.68);torso.translate(0,2.02,0);
   const parts=[torso];for(const dx of [-.28,.28]){const leg=new THREE.CylinderGeometry(.19,.23,1.3,6);leg.rotateZ(dx*.22);leg.translate(dx,.73,0);parts.push(leg);}
   const geo=mergeGeometries(parts.map(p=>p.toNonIndexed()));parts.forEach(p=>p.dispose());
   const figures=new THREE.InstancedMesh(geo,mat(0x604337),106);figures.name='agora-106-figures';
   const r=rng(106),dummy=new THREE.Object3D();
   for(let i=0;i<106;i++){
    dummy.position.set(x-a.w/2+(i%10)*a.w/10+(r()-.5)*.9,.8,z-a.d/2+Math.floor(i/10)*a.d/11+(r()-.5)*1.6);
    dummy.rotation.y=(r()-.5)*Math.PI;dummy.scale.setScalar(.93+r()*.12);dummy.updateMatrix();figures.setMatrixAt(i,dummy.matrix);
   }figures.computeBoundingSphere();g.add(figures);
  }
  if(a.kind==='skatepark'){
   // Low banks, quarter pipes, stair sets, ledges and handrails within the traced plaza.
   for(const [dx,dz,w,d,h]of [[-10,-30,8,10,1.6],[7,-17,9,12,1.2],[-6,3,9,15,.9],[8,27,8,9,1.8],[-8,34,10,7,1.3]]){
    const geom=new THREE.BoxGeometry(w,h,d,1,1,5),p=geom.attributes.position;
    for(let i=0;i<p.count;i++)if(p.getY(i)>0)p.setY(i,-h/2+h*Math.pow((p.getZ(i)+d/2)/d,2));
    geom.computeVertexNormals();geom.translate(x+dx,.92+h/2,z+dz);solids.push(geom);
    steel.push([x+dx,1.1+h,z+dz+d/2,w,.1,.1]);
   }
   for(let k=0;k<5;k++)concrete.push([x+1+k*.65,1.01+k*.16,z-1,.7,.18,5]);
   steel.push([x-5,1.6,z+16,.08,.08,9]);for(const dz of [12,20])steel.push([x-5,1.25,z+dz,.09,.8,.09]);
   for(const dz of [-37,-5,37])seats.push([x-15,1.2,z+dz,2.5,.55,.7]);
  }
  if(['statue','equestrian','temple','fountain'].includes(a.kind)){
   const base=a.base||.9;
   concrete.push([x,base+1,z,a.kind==='equestrian'?7:3,2,a.kind==='equestrian'?4:3]);
   if(a.kind==='temple'){
    for(const dx of [-2,2])for(const dz of [-2,2])concrete.push([x+dx,3,z+dz,.38,4.3,.38]);
    concrete.push([x,5.3,z,5.6,.5,5.6]);
    const roof=new THREE.ConeGeometry(4.2,1.6,4);roof.rotateY(Math.PI/4);roof.translate(x,6.3,z);solids.push(roof);
    bronze.push([x,3,z,.5,2.4,.6]);
   }else if(a.kind==='equestrian'){
    // Small silhouette of Logan on horseback; no claim of sculptural reproduction.
    bronze.push([x,base+4.4,z,3,1.2,1.1],[x+1.3,base+5.3,z,.65,1.6,.7],[x,base+5.8,z,.6,1.6,.7]);
    for(const dx of [-1,1])for(const dz of [-.4,.4])bronze.push([x+dx,base+3,z+dz,.2,2,.2]);
   }else if(a.kind==='statue')bronze.push([x,3.7,z,.7,3,.55]);
   else{const bowl=new THREE.CylinderGeometry(a.r*.6,a.r*.5,.4,20);bowl.translate(x,2.1,z);solids.push(bowl);concrete.push([x,1.5,z,.7,1.5,.7]);}
  }
 }
 if(solids.length){const geo=mergeGeometries(solids.map(s=>s.toNonIndexed()));solids.forEach(s=>s.dispose());const m=new THREE.Mesh(geo,mat(0xbdb9aa));m.name='park-ramps-and-monuments';g.add(m);}
 for(const [items,color,name]of [[concrete,0xc4c0af,'stone'],[white,0xe0ddc9,'field-lines'],[steel,0x59625d,'rails'],[bronze,0x566355,'monuments'],[courts,0x5f8976,'court-surrounds'],[blue,0x477f9d,'playing-courts'],[seats,0x907858,'seats']])if(items.length)g.add(boxBatch(items,color,'south-'+name));
 return g;
}
