import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import {
  BLOCK, STREET, EXTENT, SHORE_POINTS, RIVER, GRANT_PARK, COLUMBUS_X, PARK_CROSS_STREETS,
  PLAZAS, polylineAt, rng, inGrantPark,
} from './geo.js';
import { waterNormals, grassTexture } from './textures.js';

const SLAB_TOP = 0.6;

export function buildTerrain(scene, ctx) {
  // Land: one big polygon bounded on the east by the shoreline
  // ShapeGeometry lives in the XY plane; rotated flat, shape +Y becomes world -Z
  const pts = SHORE_POINTS.map(([z, x]) => new THREE.Vector2(x, -z));
  const land = new THREE.Shape([new THREE.Vector2(-12000, 9000), ...pts, new THREE.Vector2(-12000, -9000)]);
  const ground = new THREE.Mesh(
    new THREE.ShapeGeometry(land),
    new THREE.MeshStandardMaterial({ color: 0x3b3d42, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Lake Michigan with real reflections
  const water = new Water(new THREE.PlaneGeometry(40000, 40000), {
    textureWidth: ctx.quality.water, textureHeight: ctx.quality.water,
    waterNormals: waterNormals(),
    sunDirection: new THREE.Vector3(0.3, 0.8, 0.5).normalize(),
    sunColor: 0xffffff, waterColor: 0x0d3a4d, distortionScale: 2.4, fog: true,
  });
  water.material.uniforms.size.value = 2.2;
  // the stock shader adds a flat grey to reflections, which reads as fog on the lake at night
  water.material.fragmentShader = water.material.fragmentShader.replace('( vec3( 0.1 ) + reflectionSample', '( waterColor * 0.6 + reflectionSample');
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.6;
  scene.add(water);
  ctx.water = water;

  buildRiver(scene, ctx);
  buildParks(scene, ctx);
}

function strip(points, width, y) {
  const pos = [];
  const idx = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    dx /= len; dz /= len;
    const nx = -dz * width / 2, nz = dx * width / 2;
    pos.push(p[0] + nx, y, p[1] + nz, p[0] - nx, y, p[1] - nz);
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // force normals up regardless of winding
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

function smooth(pts, steps = 8) {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  return curve.getPoints(pts.length * steps).map((v) => [v.x, v.z]);
}

function buildRiver(scene, ctx) {
  // The famous green Chicago River
  const normals = waterNormals(128);
  normals.repeat.set(0.02, 0.02);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1f4a3a, roughness: 0.16, metalness: 0.0, envMapIntensity: 0.45, normalMap: normals, normalScale: new THREE.Vector2(0.3, 0.3),
    side: THREE.DoubleSide,
  });
  ctx.riverNormals = normals;
  const group = new THREE.Group();
  for (const key of ['main', 'north', 'south']) {
    const g = strip(smooth(RIVER[key]), RIVER.width[key], 0.18);
    // planar UVs so the normal map tiles in world space
    const p = g.attributes.position;
    const uv = [];
    for (let i = 0; i < p.count; i++) uv.push(p.getX(i), p.getZ(i));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    group.add(m);
  }
  scene.add(group);

  // Bridges where the street grid crosses the river
  const bridgeMat = new THREE.MeshStandardMaterial({ color: 0x5a5d61, roughness: 0.7, metalness: 0.3 });
  const bridgeGeo = new THREE.BoxGeometry(1, 1, 1);
  const mats = [];
  const main = smooth(RIVER.main);
  for (let x = -625; x <= 1000; x += BLOCK) {
    const z = polylineAt(main, 0, x);
    if (z !== null) mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 1.4, z), new THREE.Quaternion(), new THREE.Vector3(STREET + 2, 1.6, RIVER.width.main + 30)));
  }
  const south = smooth(RIVER.south);
  for (let z = -375; z <= 2250; z += BLOCK) {
    const x = polylineAt(south, 1, z);
    if (x !== null) mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 1.4, z), new THREE.Quaternion(), new THREE.Vector3(RIVER.width.south + 30, 1.6, STREET + 2)));
  }
  const north = smooth(RIVER.north);
  for (let z = -4500; z <= -750; z += BLOCK * 2) {
    const x = polylineAt(north, 1, z);
    if (x !== null) mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 1.4, z), new THREE.Quaternion(), new THREE.Vector3(RIVER.width.north + 30, 1.6, STREET + 2)));
  }
  const bridges = new THREE.InstancedMesh(bridgeGeo, bridgeMat, mats.length);
  mats.forEach((m, i) => bridges.setMatrixAt(i, m));
  bridges.castShadow = bridges.receiveShadow = true;
  scene.add(bridges);
}

function buildParks(scene, ctx) {
  const grass = grassTexture();
  grass.repeat.set(1, 1);
  const lawnMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: grass, roughness: 0.95 });
  const pavingMat = new THREE.MeshStandardMaterial({ color: 0xb3ada2, roughness: 0.9 });

  const xs = [[GRANT_PARK.minX + STREET / 2, COLUMBUS_X - STREET / 2], [COLUMBUS_X + STREET / 2, GRANT_PARK.maxX - 5]];
  const zEdges = [GRANT_PARK.minZ, ...PARK_CROSS_STREETS, GRANT_PARK.maxZ];
  const rects = [];
  for (const [x0, x1] of xs) {
    for (let i = 0; i < zEdges.length - 1; i++) {
      rects.push([x0, zEdges[i] + STREET / 2, x1, zEdges[i + 1] - STREET / 2]);
    }
  }
  ctx.parkRects = rects;
  for (const [x0, z0, x1, z1] of rects) {
    const w = x1 - x0, d = z1 - z0;
    const paving = new THREE.Mesh(new THREE.BoxGeometry(w, SLAB_TOP + 1, d), pavingMat);
    paving.position.set((x0 + x1) / 2, (SLAB_TOP - 1) / 2, (z0 + z1) / 2);
    paving.receiveShadow = true;
    scene.add(paving);
    const lawnGeo = new THREE.BoxGeometry(w - 10, 0.3, d - 10);
    // world-scale UVs on the top face
    const uv = lawnGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w - 10) / 60, uv.getY(i) * (d - 10) / 60);
    const lawn = new THREE.Mesh(lawnGeo, lawnMat);
    lawn.position.set((x0 + x1) / 2, SLAB_TOP + 0.15, (z0 + z1) / 2);
    lawn.receiveShadow = true;
    scene.add(lawn);
  }

  // Plazas sit just above the lawn
  const plazaMat = new THREE.MeshStandardMaterial({ color: 0xcfc8bc, roughness: 0.85 });
  const addPlaza = (geo, x, z) => {
    const m = new THREE.Mesh(geo, plazaMat);
    m.position.set(x, SLAB_TOP + 0.35, z);
    m.receiveShadow = true;
    scene.add(m);
  };
  addPlaza(new THREE.CylinderGeometry(PLAZAS.bean.r, PLAZAS.bean.r, 0.2, 48), PLAZAS.bean.x, PLAZAS.bean.z);
  addPlaza(new THREE.CylinderGeometry(PLAZAS.fountain.r, PLAZAS.fountain.r, 0.2, 64), PLAZAS.fountain.x, PLAZAS.fountain.z);
  addPlaza(new THREE.BoxGeometry(40, 0.2, 260), PLAZAS.fountain.x - 120, PLAZAS.fountain.z);     // Congress Plaza walk
  addPlaza(new THREE.BoxGeometry(250, 0.2, 18), PLAZAS.fountain.x + 0, PLAZAS.fountain.z);       // east-west axis

  // Diagonal and edge paths through the lawns
  const pathMat = new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.9 });
  for (const [x0, z0, x1, z1] of rects) {
    if (z0 < 120) continue; // Millennium Park has its own layout
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const w = x1 - x0 - 14, d = z1 - z0 - 14;
    const len = Math.hypot(w, d);
    for (const s of [1, -1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, len), pathMat);
      p.position.set(cx, SLAB_TOP + 0.33, cz);
      p.rotation.y = s * Math.atan2(w, d);
      p.receiveShadow = true;
      scene.add(p);
    }
  }

  // Trees: Grant Park plus a lakefront line
  const rand = rng(42);
  const trees = [];
  const blocked = (x, z) => {
    const b = PLAZAS.bean, f = PLAZAS.fountain, l = PLAZAS.lawn;
    if (Math.hypot(x - b.x, z - b.z) < b.r + 4) return true;
    if (Math.hypot(x - f.x, z - f.z) < f.r + 6) return true;
    if (Math.abs(z - f.z) < 14) return true;
    if (x > l.minX - 30 && x < l.maxX + 5 && z > l.minZ - 5 && z < l.maxZ + 5) return true;
    if (z > 1050 && x > 630 && x < 840 && z < 1560) return rand() > 0.12; // Hutchinson Field: mostly open lawn
    if (z > 400 && z < 960 && x < 560 && x > 300) return rand() > 0.35;    // Butler Field
    return false;
  };
  for (const [x0, z0, x1, z1] of rects) {
    const area = (x1 - x0) * (z1 - z0);
    const n = Math.floor(area / 380);
    for (let i = 0; i < n; i++) {
      const x = x0 + 8 + rand() * (x1 - x0 - 16);
      const z = z0 + 8 + rand() * (z1 - z0 - 16);
      if (blocked(x, z)) continue;
      trees.push([x, z, 0.75 + rand() * 0.6]);
    }
    // street trees around each park block
    for (let x = x0 + 6; x < x1; x += 14) { trees.push([x, z0 + 5, 0.8]); trees.push([x, z1 - 5, 0.8]); }
    for (let z = z0 + 6; z < z1; z += 14) { trees.push([x0 + 5, z, 0.8]); trees.push([x1 - 5, z, 0.8]); }
  }
  addTrees(scene, trees, rand);
  ctx.treeCount = trees.length;
}

export function addTrees(scene, trees, rand) {
  const canopyGeo = new THREE.IcosahedronGeometry(1, 1);
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 1, 5);
  trunkGeo.translate(0, 0.5, 0);
  const canopy = new THREE.InstancedMesh(canopyGeo, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), trees.length);
  const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 1 }), trees.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  trees.forEach(([x, z, s], i) => {
    const r = 4.2 * s;
    q.setFromEuler(new THREE.Euler(0, rand() * 6.28, 0));
    m.compose(new THREE.Vector3(x, SLAB_TOP + 3.2 * s + r * 0.75, z), q, new THREE.Vector3(r, r * 0.85, r));
    canopy.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(x, SLAB_TOP, z), q, new THREE.Vector3(1, 3.6 * s, 1));
    trunk.setMatrixAt(i, m);
    c.setHSL(0.24 + rand() * 0.07, 0.38 + rand() * 0.2, 0.2 + rand() * 0.1);
    canopy.setColorAt(i, c);
  });
  canopy.castShadow = true;
  canopy.receiveShadow = true;
  scene.add(canopy, trunk);
}

export { SLAB_TOP, inGrantPark, EXTENT };
