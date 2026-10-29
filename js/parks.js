import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PLAZAS, rng } from './geo.js';
import { SLAB_TOP } from './terrain.js';
import { glowSprite } from './textures.js';
import { boxBatch, segmentBox } from './city-data.js';

const BASE = SLAB_TOP + 0.45;

export function buildParks(scene, ctx) {
  cloudGate(scene);
  pritzker(scene, ctx);
  buckingham(scene, ctx);
  millenniumLandscape(scene, ctx);
}

function millenniumLandscape(scene, ctx) {
  const paving=[],planting=[],hedges=[],seats=[],lights=[];
  // Crown Fountain's reflecting plaza and paired glass towers.
  paving.push([338,BASE,93,64,0.2,95]);
  const pool=new THREE.Mesh(new THREE.BoxGeometry(38,.04,62),new THREE.MeshStandardMaterial({color:0x38444a,metalness:.4,roughness:.2}));pool.position.set(338,BASE+.13,93);scene.add(pool);
  const glass=facadeMaterialForFountain();
  const towers=boxBatch([[338,BASE+7.6,57,7,15.2,4],[338,BASE+7.6,129,7,15.2,4]],0,'crown-fountain',glass);scene.add(towers);ctx.glows.push({mat:glass,day:0.02,night:.2});
  // Lurie Garden: low planted beds separated by a diagonal boardwalk and hedges.
  for(let i=0;i<8;i++)for(let j=0;j<4;j++){
    const x=452+i*16,z=57+j*14;
    planting.push([x,BASE+.22,z,13,.3,11,0,[0x727d57,0x657d67,0x8c8773,0x808276][(i+j)%4]]);
  }
  segmentBox(paving,[425,43],[570,118],4,BASE+.12,.2);
  for(const [a,b]of [[[425,35],[580,35]],[[580,35],[580,125]],[[425,125],[580,125]]])segmentBox(hedges,a,b,4,BASE+1.8,3.5);
  for(const z of [-225,-10,135])for(let x=300;x<590;x+=34)seats.push([x,BASE+.5,z,3,.55,.7]);
  for(const x of [305,422,588])for(let z=-210;z<140;z+=32)lights.push([x,BASE+2.5,z,.18,5,.18]);
  // BP Bridge's winding pedestrian deck crosses Columbus, with a raised middle span.
  const curve=new THREE.CatmullRomCurve3([[574,-55],[609,-32],[654,-62],[688,-21],[666,30],[626,43]].map(([x,z],i)=>new THREE.Vector3(x,BASE+(i===0||i===5?0:7),z)));
  const deck=[],rails=[],points=curve.getPoints(90);
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz),y=(a.y+b.y)/2;
    segmentBox(deck,[a.x,a.z],[b.x,b.z],5.4,y,.5);
    for(const side of [-1,1])segmentBox(rails,[a.x-dz/len*2.7*side,a.z+dx/len*2.7*side],[b.x-dz/len*2.7*side,b.z+dx/len*2.7*side],.35,y+.8,1.2);
  }
  scene.add(boxBatch(paving,0xb6ae9e,'park-plazas'),boxBatch(planting,0xffffff,'lurie-plantings'),boxBatch(hedges,0x526044,'garden-hedges'),boxBatch(seats,0x9b8668,'park-benches'),boxBatch(lights,0x4d5654,'park-lamps'),boxBatch(deck,0xa89c85,'bp-bridge-deck'),boxBatch(rails,0xb0b6b5,'bp-bridge-ribbons'));
  ctx.parkWalks=[[[300,BASE+.2,-215],[422,BASE+.2,-215],[422,BASE+.2,140],[300,BASE+.2,140],[300,BASE+.2,-215]],[[435,BASE+.2,35],[584,BASE+.2,35],[584,BASE+.2,130],[435,BASE+.2,130],[435,BASE+.2,35]],points.map(p=>[p.x,p.y+.3,p.z]),[[310,BASE+.2,600],[600,BASE+.2,600],[600,BASE+.2,790],[310,BASE+.2,790],[310,BASE+.2,600]]];
}
function facadeMaterialForFountain(){
  const canvas=document.createElement('canvas');canvas.width=64;canvas.height=128;const c=canvas.getContext('2d');c.fillStyle='#8ca8ae';c.fillRect(0,0,64,128);c.strokeStyle='#53686a';c.lineWidth=1;
  for(let x=0;x<65;x+=8){c.beginPath();c.moveTo(x,0);c.lineTo(x,128);c.stroke();}for(let y=0;y<129;y+=8){c.beginPath();c.moveTo(0,y);c.lineTo(64,y);c.stroke();}
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;return new THREE.MeshStandardMaterial({color:0xd2dedb,map,metalness:.2,roughness:.35,emissive:0x789a9c,emissiveMap:map,emissiveIntensity:0});
}

// Cloud Gate: a mirror-polished bean, 20 m long, with the arched "omphalos" underneath
function cloudGate(scene) {
  const g = new THREE.SphereGeometry(1, 96, 48);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    if (y < 0) p.setY(i, y * (1 - 0.88 * Math.exp(-(x * x) / 0.16)));
  }
  g.computeVertexNormals();
  g.scale(10, 5, 6.5);
  g.translate(0, 5, 0);
  g.computeBoundingBox();
  g.translate(0, -g.boundingBox.min.y, 0); // the two feet meet the plaza
  const chrome = new THREE.MeshStandardMaterial({ color: 0xc9ced3, metalness: 1, roughness: 0.07 });
  const bean = new THREE.Mesh(g, chrome);
  bean.position.set(PLAZAS.bean.x, BASE, PLAZAS.bean.z);
  bean.rotation.y = 0.15;
  bean.castShadow = true;
  scene.add(bean);
}

// Jay Pritzker Pavilion: curling steel ribbons over the stage, and the pipe trellis over the lawn
function pritzker(scene, ctx) {
  const { x, z } = PLAZAS.pritzker;
  const steel = new THREE.MeshStandardMaterial({ color: 0xd5d8db, metalness: 0.9, roughness: 0.22, side: THREE.DoubleSide });
  const stageMat = new THREE.MeshStandardMaterial({ color: 0x5b4a3c, roughness: 0.8 });

  const stage = new THREE.Mesh(new THREE.BoxGeometry(30, 12, 34), stageMat);
  stage.position.set(x, BASE + 6, z - 10);
  stage.rotation.y = -Math.PI / 2;
  stage.castShadow = true;
  scene.add(stage);

  const ribbons = [];
  const count = 11;
  for (let k = 0; k < count; k++) {
    const phi = THREE.MathUtils.lerp(-1.25, 1.25, k / (count - 1));
    const curl = 1 - Math.abs(phi) / 1.6;
    const pts = [];
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const s = i / steps;
      const up = 9 + 26 * s * curl + 6 * Math.sin(s * Math.PI);
      const back = -4 - 10 * s * s + (s > 0.7 ? (s - 0.7) * 22 : 0);
      const ang = phi * (1 + 0.45 * s);
      pts.push(new THREE.Vector3(back, up * Math.cos(ang), up * Math.sin(ang) * 1.05));
    }
    // build a strip, widened along the local x axis and slightly twisted
    const pos = [];
    const idx = [];
    pts.forEach((pt, i) => {
      const wdt = 7 + 5 * Math.sin((i / steps) * Math.PI);
      const tw = (i / steps) * 0.6 * Math.sign(phi || 1);
      const ox = Math.cos(tw) * wdt / 2, oy = Math.sin(tw) * wdt / 2;
      pos.push(pt.x - ox, pt.y - oy, pt.z, pt.x + ox, pt.y + oy, pt.z);
      if (i > 0) { const a = i * 2; idx.push(a - 2, a - 1, a, a - 1, a + 1, a); }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    ribbons.push(geo);
  }
  const crown = new THREE.Mesh(mergeGeometries(ribbons), steel);
  crown.position.set(x, BASE, z - 8);
  crown.rotation.y = -Math.PI / 2;
  crown.castShadow = true;
  scene.add(crown);

  // Trellis: a lattice of steel pipes arching over the Great Lawn
  const l = PLAZAS.lawn;
  const cx = (l.minX + l.maxX) / 2, cz = (l.minZ + l.maxZ) / 2;
  const hAt = (px, pz) => 24 - 9 * ((pz - cz) / ((l.maxZ - l.minZ) / 2)) ** 2 - 5 * ((px - l.minX) / (l.maxX - l.minX)) ** 2;
  const tubes = [];
  const tube = (fn) => {
    const curve = new THREE.CatmullRomCurve3(Array.from({ length: 13 }, (_, i) => fn(i / 12)));
    tubes.push(new THREE.TubeGeometry(curve, 24, 0.35, 5, false));
  };
  for (let px = l.minX; px <= l.maxX + 0.1; px += (l.maxX - l.minX) / 6) {
    tube((s) => { const pz = l.minZ + s * (l.maxZ - l.minZ); return new THREE.Vector3(px, hAt(px, pz), pz); });
  }
  for (let pz = l.minZ; pz <= l.maxZ + 0.1; pz += (l.maxZ - l.minZ) / 9) {
    tube((s) => { const px = l.minX - 10 + s * (l.maxX - l.minX + 10); return new THREE.Vector3(px, hAt(px, pz), pz); });
  }
  for (const [px, pz] of [[l.minX, l.minZ], [l.minX, l.maxZ], [l.maxX, l.minZ], [l.maxX, l.maxZ], [cx, l.minZ], [cx, l.maxZ]]) {
    tubes.push(new THREE.CylinderGeometry(0.8, 1, hAt(px, pz), 8).translate(px, hAt(px, pz) / 2, pz));
  }
  const trellis = new THREE.Mesh(mergeGeometries(tubes), steel);
  trellis.position.y = BASE;
  trellis.castShadow = true;
  scene.add(trellis);
  void ctx;
}

// Buckingham Fountain: three tiers of pink Georgia marble in a 280 ft pool
function buckingham(scene, ctx) {
  const { x, z } = PLAZAS.fountain;
  const marble = new THREE.MeshStandardMaterial({ color: 0xdcbcaa, roughness: 0.6 });
  const pool = new THREE.MeshStandardMaterial({
    color: 0x3d7f95, roughness: 0.06, metalness: 0.4, emissive: 0x2a7fa8, emissiveIntensity: 0,
  });
  ctx.glows.push({ mat: pool, day: 0, night: 0.7 });
  const g = new THREE.Group();
  const add = (geo, mat, y) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  add(new THREE.CylinderGeometry(43, 43, 1.2, 96), marble, 0.6);                   // basin rim
  add(new THREE.CylinderGeometry(42, 42, 0.4, 96), pool, 1.1);                     // water
  add(new THREE.CylinderGeometry(15.7, 13.5, 2.6, 48), marble, 2.3);               // lower tier
  add(new THREE.CylinderGeometry(15.2, 15.2, 0.3, 48), pool, 3.7);
  add(new THREE.CylinderGeometry(3.2, 4, 3.2, 24), marble, 5.2);
  add(new THREE.CylinderGeometry(9.1, 7.5, 1.6, 40), marble, 7.4);                 // middle tier
  add(new THREE.CylinderGeometry(2.2, 2.6, 3, 20), marble, 9.6);
  add(new THREE.CylinderGeometry(3.7, 3, 1.1, 32), marble, 11.6);                  // top tier
  add(new THREE.CylinderGeometry(1, 1.4, 2.4, 16), marble, 13);
  // Four sea horses representing the states that border Lake Michigan
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    const h = add(new THREE.SphereGeometry(2.2, 12, 10), new THREE.MeshStandardMaterial({ color: 0x5f7a5c, metalness: 0.6, roughness: 0.4 }), 3);
    h.scale.set(1, 1.5, 0.8);
    h.position.x = Math.cos(a) * 26;
    h.position.z = Math.sin(a) * 26;
  }
  g.position.set(x, BASE, z);
  scene.add(g);

  // Water jets: one tall center jet plus rings of smaller jets
  const jets = [];
  const rand = rng(1927);
  const add3 = (ox, oy, oz, vx, vy, vz, n) => { for (let i = 0; i < n; i++) jets.push([ox, oy, oz, vx, vy, vz, rand()]); };
  add3(0, 14, 0, 0, 29, 0, 72);
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2;
    add3(Math.cos(a) * 15, 4, Math.sin(a) * 15, -Math.cos(a) * 3.2, 9, -Math.sin(a) * 3.2, 8);
  }
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + Math.PI / 4;
    add3(Math.cos(a) * 24, 4, Math.sin(a) * 24, -Math.cos(a) * 4.5, 10, -Math.sin(a) * 4.5, 12);
  }
  const pos = new Float32Array(jets.length * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xe8f6ff, size: 1.3, map: glowSprite(), transparent: true, opacity: 0.85, depthWrite: false,
  });
  const spray = new THREE.Points(geo, mat);
  spray.name = 'fountain-spray';
  spray.position.set(x, BASE, z);
  spray.frustumCulled = false;
  scene.add(spray);

  const G = 9.8;
  let lastUpdate = -1;
  ctx.updaters.push((time, night) => {
    if (time - lastUpdate < 1 / 30) return;
    lastUpdate = time;
    for (let i = 0; i < jets.length; i++) {
      const [ox, oy, oz, vx, vy, vz, ph] = jets[i];
      const T = (2 * vy) / G + Math.sqrt(2 * oy / G) * 0.6;
      const t = ((time / T + ph) % 1) * T;
      const spread = (ph - 0.5) * 0.12 * vy;
      pos[i * 3] = ox + (vx + spread * Math.cos(i)) * t;
      pos[i * 3 + 1] = Math.max(1.2, oy + vy * t - 0.5 * G * t * t);
      pos[i * 3 + 2] = oz + (vz + spread * Math.sin(i)) * t;
    }
    geo.attributes.position.needsUpdate = true;
    mat.color.setRGB(0.9 + night * 0.4, 0.97 + night * 0.6, 1 + night * 1.4);
  });
}
