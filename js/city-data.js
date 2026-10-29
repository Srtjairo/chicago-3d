import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { facadeMaterial } from './textures.js';
import { LANDMARKS, rng } from './geo.js';
import { inCoverage } from './coverage.js';
export { COVERAGE, inCoverage } from './coverage.js';

export async function loadCityData() {
  const url = new URL('../assets/downtown.json', import.meta.url);
  url.search = new URL(import.meta.url).search;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (data.version !== 1 || !data.buildings?.length || !data.streets?.length || !data.water?.length) throw new Error('Incomplete city data');
    return data;
  } catch (cause) {
    const error=new Error('Chicago’s map data could not load. Check your connection and reload the page.',{cause});
    error.code='CITY_DATA';throw error;
  }
}
export function polygonShape(rings) {
  const shape = new THREE.Shape(rings[0].map(([x, z]) => new THREE.Vector2(x, -z)));
  for (const hole of rings.slice(1)) shape.holes.push(new THREE.Path(hole.map(([x, z]) => new THREE.Vector2(x, -z))));
  return shape;
}
export function polygonGeometry(rings, height = 0, y = 0) {
  const shape = polygonShape(rings);
  const g = height ? new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, steps: 1, curveSegments: 1 }) : new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2); g.translate(0, y, 0);
  return g;
}
export function boundsOf(ring) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return { x0, x1, z0, z1, x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 };
}
export function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export const inPolygon = (x, z, rings) => pointInRing(x, z, rings[0]) && !rings.slice(1).some((r) => pointInRing(x, z, r));
export function boxBatch(items, color, name, material) {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material || new THREE.MeshStandardMaterial({ color, roughness: 0.82 }), items.length);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (const [i, v] of items.entries()) {
    const [x, y, z, w, h, d, a = 0] = v;
    m.compose(p.set(x, y, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, a), s.set(w, h, d)); mesh.setMatrixAt(i, m);
    if (v[7] !== undefined) mesh.setColorAt(i, new THREE.Color(v[7]));
  }
  mesh.name = name; mesh.computeBoundingSphere();
  return mesh;
}
export function segmentBox(items, a, b, width, y, thickness = 0.08) {
  const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
  if (length < 0.01) return;
  items.push([(a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2, width, thickness, length + 0.1, Math.atan2(dx, dz)]);
}

// Each footprint is replaced individually, not by clearing an entire city block.
export const REPLACED = new Set(['889662-0','824823-0','859995-0','858242-0','864656-0','869193-0','869122-0','863296-0','862723-0','866027-0','855557-0','866163-0','861246-0','893691-0','869294-0']);
for(const l of LANDMARKS)for(const id of l.footprintIds||[])REPLACED.add(id);
const FAMILIES = [
  { color: 0xb7aa95, glass: 0x303941, cell: [2.8, 4], winA: [0.53, 0.62], seed: 101 },
  { color: 0x987d68, glass: 0x252e33, cell: [2.9, 3.5], winA: [0.58, 0.65], seed: 102 },
  { color: 0xd1c9b8, glass: 0x3d4950, cell: [2.2, 3.7], winA: [0.5, 0.68], seed: 103 },
  { color: 0x8097a2, glass: 0x426678, style: 1, cell: [1.65, 3.6], roughness: 0.32, seed: 104 },
  { color: 0x444b50, glass: 0x283b48, style: 1, cell: [2.8, 3.8], roughness: 0.4, seed: 105 },
  { color: 0xaaa69c, glass: 0x3a454d, cell: [3.8, 4.2], winA: [0.76, 0.68], seed: 106 },
];
export function buildMeasuredCity(scene, ctx) {
  const group = new THREE.Group(); group.name = 'measured-city';
  const materials = FAMILIES.map((f) => facadeMaterial({ ...f, lit: 0.28, features:true }));
  const chunks = new Map(), details = new Map(), distant = new Map(), chunkViews = new Map();
  const rand = rng(2022); const boxes = ctx.cityBoxes;
  const buildings = [];
  for (const b of ctx.data.buildings) {
    const v = boundsOf(b.rings[0]);
    if (!inCoverage(v.x, v.z) || REPLACED.has(b.id) || ctx.waterfront.replacementIds.includes(b.id)) continue;
    // Navy Pier and Millennium Park already have hand-built structures.
    if ((v.x > 280 && v.x < 610 && v.z > -220 && v.z < 60)) continue;
    // One Prudential's antenna belongs above its roof, not across its whole footprint.
    const h = b.id==='870263-0' ? 183.2 : b.h; if (v.w < 2 || v.d < 2) continue;
    const family = h > 130 ? (Number(b.id.split('-')[0]) % 3 === 0 ? 4 : 3)
      : v.x < -550 && v.z < -650 ? (rand() < 0.7 ? 1 : 5) : Math.floor(rand() * 3);
    const cell = `${Math.floor(v.x / 600)},${Math.floor(v.z / 600)}`;
    const key = cell + ':' + family;
    if (!chunks.has(key)) chunks.set(key, []);
    const geometry=polygonGeometry(b.rings,h,.6);
    geometry.setAttribute('aSeed',new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count).fill(Number(b.id.split('-')[0])%10007),1));
    chunks.get(key).push(geometry);
    if(!distant.has(cell))distant.set(cell,[]);
    distant.get(cell).push([v.x,h/2+.6,v.z,v.w,h,v.d,0,FAMILIES[family].color,FAMILIES[family].style||0]);
    if (!details.has(cell)) details.set(cell, { roof: [], trim: [], entry: [], x: Math.floor(v.x / 600) * 600 + 300, z: Math.floor(v.z / 600) * 600 + 300 });
    const detail = details.get(cell);
    // Top outline follows the actual footprint, including courtyard edges.
    if (h > 16 && h < 140) for (const ring of b.rings) for (let i = 1; i < ring.length; i++) segmentBox(detail.trim, ring[i - 1], ring[i], 0.65, h + 0.65, 0.7);
    if (h > 35 && pointInRing(v.x, v.z, b.rings[0])) detail.roof.push([v.x, h + 2, v.z, Math.min(v.w * 0.2, 12), 2.8, Math.min(v.d * 0.2, 14)]);
    // A restrained entrance canopy on the longest exterior wall.
    if (h > 12 && h < 120) {
      const r = b.rings[0]; let longest = 0, a, c;
      for (let i = 1; i < r.length; i++) { const d = Math.hypot(r[i][0]-r[i-1][0],r[i][1]-r[i-1][1]); if (d > longest) { longest = d; a = r[i-1]; c = r[i]; } }
      if (longest > 12) detail.entry.push([(a[0]+c[0])/2, 4.3, (a[1]+c[1])/2, 2.4, 0.28, Math.min(8, longest*0.4), Math.atan2(c[0]-a[0],c[1]-a[1])]);
    }
    boxes.push([v.x, 0, v.z, v.w, h, v.d, FAMILIES[family].color, family > 2 ? 1 : 0]);
    buildings.push({ ...v, h, id: b.id, rings: b.rings });
  }
  for (const [key, parts] of chunks) {
    const geometry = mergeGeometries(parts, false); parts.forEach((g) => g.dispose());
    const family = Number(key.split(':')[1]);
    const m = new THREE.Mesh(geometry, materials[family]); m.name = 'footprints-' + key;
    m.receiveShadow = true; geometry.computeBoundingSphere(); group.add(m);
    const cell=key.split(':')[0];if(!chunkViews.has(cell))chunkViews.set(cell,{near:[],far:null});chunkViews.get(cell).near.push(m);
  }
  const distantMaterial=facadeMaterial({color:0xffffff,glass:0x30434d,instanced:true,cell:[2.5,3.9]});
  for(const [cell,items]of distant){
    const m=boxBatch(items,0xffffff,'distant-'+cell,distantMaterial);
    m.geometry.setAttribute('aStyle',new THREE.InstancedBufferAttribute(new Float32Array(items.map(v=>v[8])),1));
    group.add(m);chunkViews.get(cell).far=m;
  }
  const detailGroups = [];
  for (const [cell, data] of details) {
    const g = new THREE.Group(); g.name = 'detail-' + cell;
    g.add(boxBatch(data.roof, 0x747975, 'roof-plant'), boxBatch(data.trim, 0xb0aa9a, 'cornices'), boxBatch(data.entry, 0x303c42, 'entrances'));
    group.add(g); detailGroups.push({ group: g, ...data });
  }
  ctx.cityDetailUpdate = (camera, level) => {
    for (const [cell,d] of details) {
      const distance=Math.hypot(camera.position.x-d.x,camera.position.z-d.z),v=chunkViews.get(cell),far=distance>(level>=3?2300:3300);
      v.near.forEach(m=>m.visible=!far);v.far.visible=far;
    }
    for (const d of detailGroups) d.group.visible = Math.hypot(camera.position.x-d.x,camera.position.z-d.z) < (level >= 3 ? 1000 : 1600) && camera.position.y < 1700;
  };
  ctx.measuredBuildings = buildings;
  ctx.buildingCount += buildings.length;
  ctx.collisionBuildings = [...buildings, ...LANDMARKS.filter((l) => l.roof > 100 || l.collision).map((l) => ({id:l.id, x0: l.x-l.r, x1:l.x+l.r,z0:l.z-l.r,z1:l.z+l.r,...l.collision,h:l.h+.6 }))];
  scene.add(group);
}
