import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { facadeMaterial } from './textures.js?v=196332b19f6f2af2';
import {boxBatch} from './city-data.js?v=196332b19f6f2af2';

const DECK = 3;

export function buildNavyPier(scene, ctx) {
  const materials={
    pavilion:facadeMaterial({color:0xc1b19a,glass:0x50757d,cell:[6,5],winA:[.68,.7],lit:.2,seed:89}),
    glass:facadeMaterial({color:0xc2c9be,glass:0x54838b,style:1,cell:[4,4],lit:.2,seed:90}),
    dark:facadeMaterial({color:0x515652,glass:0x354b50,cell:[4,4],lit:.2,seed:91}),
    brick:facadeMaterial({color:0x9b7061,glass:0x31474c,cell:[3,4],lit:.25,seed:92}),
    hall:facadeMaterial({color:0xd4c8b1,glass:0x43616b,cell:[9,12],winA:[.64,.7],lit:.25,seed:93}),
    hotel:facadeMaterial({color:0xd5cebd,glass:0x415d65,cell:[3.5,5.2],winA:[.78,.7],lit:.35,seed:94}),
    ballroom:facadeMaterial({color:0xc7b79c,glass:0x385963,cell:[4.5,5],winA:[.6,.7],lit:.25,seed:95})
  };
  const roof=new THREE.MeshStandardMaterial({color:0x768786,roughness:.78});
  const cream=new THREE.MeshStandardMaterial({color:0xe0d6c3,roughness:.8});
  const group=new THREE.Group();group.name='navy-pier-architecture';scene.add(group);
  const add=(geo,mat,x,y,z)=>{const mesh=new THREE.Mesh(geo,mat);mesh.position.set(x,y,z);mesh.receiveShadow=true;group.add(mesh);return mesh;};
  const cornices=[],frames=[];
  for(const a of ctx.waterfront.anchors.filter(a=>materials[a.kind])){
    const body=add(new THREE.BoxGeometry(a.w,a.h,a.d),a.kind==='glass'?materials.pavilion:materials[a.kind],a.x,DECK+a.h/2,a.z);body.rotation.y=a.angle;body.name=a.id;
    ctx.collisionBuildings.push({id:a.id,x0:a.x-a.w/2,x1:a.x+a.w/2,z0:a.z-a.d/2,z1:a.z+a.d/2,h:DECK+a.h+4});
    for(const y of [DECK+.4,DECK+a.h])cornices.push([a.x,y,a.z,a.w+1.2,.65,a.d+1.2,a.angle]);
    if(a.kind==='hall'||a.kind==='glass'){
      const r=new THREE.CylinderGeometry(a.d/2,a.d/2,a.w,24,1,false,0,Math.PI);r.rotateZ(Math.PI/2);r.scale(1,a.kind==='glass'?.32:.22,1);
      const m=add(r,a.kind==='glass'?new THREE.MeshStandardMaterial({color:0x78999f,metalness:.35,roughness:.3}):roof,a.x,DECK+a.h,a.z);m.rotation.y=a.angle;
      if(a.kind==='glass'){
        const ribs=[];for(let x=a.x-a.w/2;x<=a.x+a.w/2;x+=10){const curve=new THREE.CatmullRomCurve3(Array.from({length:17},(_,i)=>{const t=i/16*Math.PI;return new THREE.Vector3(x,DECK+a.h+Math.sin(t)*a.d*.16,a.z+Math.cos(t)*a.d/2);}));ribs.push(new THREE.TubeGeometry(curve,16,.22,4,false));}const g=mergeGeometries(ribs);ribs.forEach(r=>r.dispose());add(g,cream,0,0,0);
      }
      for(let x=a.x-a.w/2+6;x<a.x+a.w/2;x+=17)frames.push([x,DECK+a.h*.5,a.z+a.d/2-(x-a.x)*.018,.5,a.h,.7]);
    }
    if(a.kind==='hotel')for(let y=DECK+4;y<DECK+a.h;y+=3.4)cornices.push([a.x,y,a.z+a.d/2+.25,a.w,.18,.6,a.angle]);
    if(a.kind==='ballroom'){
      const end=add(new THREE.CylinderGeometry(a.d/2,a.d/2,a.h,32),materials.ballroom,a.x+a.w/2-8,DECK+a.h/2,a.z);end.scale.x=.72;
      add(new THREE.SphereGeometry(a.d/2,32,12,0,Math.PI*2,0,Math.PI/2).scale(1.5,.48,1),roof,a.x+9,DECK+a.h,a.z);
      for(const dz of [-29,29]){add(new THREE.BoxGeometry(10,32,10),cream,a.x-a.w/2,DECK+16,a.z+dz);add(new THREE.ConeGeometry(8,8,4),roof,a.x-a.w/2,DECK+36,a.z+dz);}
    }
  }
  group.add(boxBatch(cornices,0xdcd3be,'pier-cornices'),boxBatch(frames,0xbacac6,'pier-frames'));
  // Centennial Wheel: 196 ft tall, 42 gondolas
  const R = 29;
  const anchor=ctx.waterfront.anchors.find(a=>a.kind==='wheel');
  const hub = new THREE.Vector3(anchor.x, DECK + 33, anchor.z);
  const white = new THREE.MeshStandardMaterial({ color: 0xeef0f2, metalness: 0.6, roughness: 0.35 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xe8ecef, metalness: 0.5, roughness: 0.3, emissive: 0xffffff, emissiveIntensity: 0 });
  const wheel = new THREE.Group();
  wheel.position.copy(hub);
  const parts = [];
  for (const dz of [-1.6, 1.6]) parts.push(new THREE.TorusGeometry(R, 0.55, 8, 96).translate(0, 0, dz));
  for (let i = 0; i < 42; i++) {
    const a = i / 42 * Math.PI * 2;
    for (const dz of [-1.6, 1.6]) {
      const spoke = new THREE.CylinderGeometry(0.12, 0.12, R, 4);
      spoke.translate(0, R / 2, 0);
      spoke.rotateX(Math.sign(dz) * 0.05);
      spoke.rotateZ(a);
      spoke.translate(0, 0, dz * 0.2);
      parts.push(spoke);
    }
  }
  const rim = new THREE.Mesh(mergeGeometries(parts), rimMat);
  rim.castShadow = false;
  wheel.add(rim);
  wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 6, 16).rotateX(Math.PI / 2), white));
  scene.add(wheel);
  // A-frame legs
  const legs = [];
  for (const dz of [-6, 6]) {
    for (const dx of [-12, 12]) {
      const a = new THREE.Vector3(hub.x + dx, DECK, hub.z + dz);
      const len = a.distanceTo(hub);
      const leg = new THREE.CylinderGeometry(0.7, 1, len, 8);
      leg.translate(0, len / 2, 0);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), hub.clone().sub(a).normalize());
      leg.applyQuaternion(q);
      leg.translate(a.x, a.y, a.z);
      legs.push(leg);
    }
  }
  add(mergeGeometries(legs), white, 0, 0, 0);

  const gondolaMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.2 });
  const gondolas = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 2.7, 2.4), gondolaMat, 42);
  const gc = new THREE.Color();
  for (let i = 0; i < 42; i++) gondolas.setColorAt(i, gc.setHSL(0.55 + (i % 3) * 0.02, 0.15, 0.85));
  gondolas.castShadow = false;
  scene.add(gondolas);

  ctx.glows.push({ mat: rimMat, day: 0, night: 1.4 });
  const m = new THREE.Matrix4();
  ctx.updaters.push((time, night) => {
    const spin = time * 0.035;
    wheel.rotation.z = spin;
    for (let i = 0; i < 42; i++) {
      const a = spin + i / 42 * Math.PI * 2;
      m.makeTranslation(hub.x + Math.cos(a) * (R + 0.5), hub.y + Math.sin(a) * (R + 0.5) - 1.8, hub.z);
      gondolas.setMatrixAt(i, m);
    }
    gondolas.instanceMatrix.needsUpdate = true;
    // The rim cycles through colors after dark, like the real wheel's LED show
    if (night > 0.05) rimMat.emissive.setHSL((time * 0.03) % 1, 0.8, 0.55);
  });
}
