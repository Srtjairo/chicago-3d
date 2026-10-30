import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import {
  BLOCK, STREET, EXTENT, RIVER,
  polylineAt, inGrantPark, RIVER_PATHS,
} from './geo.js?v=ffca706352a4902e';
import { waterNormals, grassTexture } from './textures.js?v=ffca706352a4902e';
import { inCoverage, polygonGeometry } from './city-data.js?v=ffca706352a4902e';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const SLAB_TOP = 0.6;

export function buildTerrain(scene, ctx) {
  const parts=ctx.waterfront.terrain.map(rings=>polygonGeometry(rings).toNonIndexed());
  const ground=new THREE.Mesh(mergeGeometries(parts),new THREE.MeshStandardMaterial({color:0x8c8e87,roughness:.95}));
  parts.forEach(g=>g.dispose());ground.name='geographic-land';ground.receiveShadow=true;scene.add(ground);

  // Lake Michigan with real reflections
  const water = new Water(new THREE.PlaneGeometry(40000, 40000), {
    textureWidth: ctx.quality.water, textureHeight: ctx.quality.water,
    waterNormals: waterNormals(),
    sunDirection: new THREE.Vector3(0.3, 0.8, 0.5).normalize(),
    sunColor: 0xffffff, waterColor: 0x0d3a4d, distortionScale: 1.4, fog: true,
  });
  water.material.uniforms.size.value = 2.2;
  // the stock shader adds a flat grey to reflections, which reads as fog on the lake at night
  water.material.fragmentShader = water.material.fragmentShader.replace('( vec3( 0.1 ) + reflectionSample', '( waterColor * 0.6 + reflectionSample');
  water.material.fragmentShader=water.material.fragmentShader.replace('vec3 outgoingLight = albedo;', 'vec3 outgoingLight = mix(albedo, waterColor * (0.65 + diffuseLight * 0.25), 0.26);');
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.6;
  scene.add(water);
  ctx.water = water;

  buildRiver(scene, ctx);

}

function strip(points, width, y, clipCore = false) {
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
    if (i > 0 && !(clipCore && inCoverage((points[i-1][0]+p[0])/2, (points[i-1][1]+p[1])/2, 30))) {
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

function buildRiver(scene, ctx) {
  // The famous green Chicago River
  const normals = waterNormals(128);
  normals.repeat.set(0.02, 0.02);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x285957, roughness: 0.27, metalness: 0.15, envMapIntensity: 0.7, normalMap: normals, normalScale: new THREE.Vector2(0.14, 0.14),
    side: THREE.DoubleSide,
  });
  ctx.riverNormals = normals;
  const group = new THREE.Group();
  const bankMat = new THREE.MeshStandardMaterial({ color: 0xa69f90, roughness: 0.9, side: THREE.DoubleSide });
  for (const key of ['main', 'north', 'south']) {
    const bank = new THREE.Mesh(strip(RIVER_PATHS[key], RIVER.width[key] + 14, 0.12, Boolean(ctx.data)), bankMat);
    bank.receiveShadow = true;
    group.add(bank);
    const g = strip(RIVER_PATHS[key], RIVER.width[key], 0.18, Boolean(ctx.data));
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
  const main = RIVER_PATHS.main;
  for (let x = -625; x <= 1000; x += BLOCK) {
    const z = polylineAt(main, 0, x);
    if (z !== null && !inCoverage(x,z,30)) mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 1.4, z), new THREE.Quaternion(), new THREE.Vector3(STREET + 2, 1.6, RIVER.width.main + 30)));
  }
  const south = RIVER_PATHS.south;
  for (let z = -375; z <= 2250; z += BLOCK) {
    const x = polylineAt(south, 1, z);
    if (x !== null && !inCoverage(x,z,30)) mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 1.4, z), new THREE.Quaternion(), new THREE.Vector3(RIVER.width.south + 30, 1.6, STREET + 2)));
  }
  const north = RIVER_PATHS.north;
  for (let z = -4500; z <= -750; z += BLOCK * 2) {
    const x = polylineAt(north, 1, z);
    if (x !== null && !inCoverage(x,z,30)) mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 1.4, z), new THREE.Quaternion(), new THREE.Vector3(RIVER.width.north + 30, 1.6, STREET + 2)));
  }
  const bridges = new THREE.InstancedMesh(bridgeGeo, bridgeMat, mats.length);
  mats.forEach((m, i) => bridges.setMatrixAt(i, m));
  bridges.castShadow = bridges.receiveShadow = true;
  scene.add(bridges);
  ctx.bridges = mats;
}

export function addTrees(scene, trees, rand) {
  const canopyGeo = new THREE.SphereGeometry(1, 10, 7);
  const cp = canopyGeo.attributes.position;
  for (let i = 0; i < cp.count; i++) {
    const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i);
    const swell = 1 + 0.13 * Math.sin(x * 8 + y * 4) * Math.sin(z * 7 - y * 3);
    cp.setXYZ(i, x * swell, y * swell, z * swell);
  }
  canopyGeo.computeVertexNormals();
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 1, 5);
  trunkGeo.translate(0, 0.5, 0);
  const canopy = new THREE.InstancedMesh(canopyGeo, new THREE.MeshStandardMaterial({ color:0xa4c784, roughness: 1 }), trees.length);
  const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 1 }), trees.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  trees.forEach(([x, z, s, groundY = SLAB_TOP], i) => {
    const r = 4.2 * s;
    q.setFromEuler(new THREE.Euler(0, rand() * 6.28, 0));
    m.compose(new THREE.Vector3(x, groundY + 3.2 * s + r * 0.75, z), q, new THREE.Vector3(r * (0.85 + rand() * 0.3), r * (0.85 + rand() * 0.4), r));
    canopy.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(x, groundY, z), q, new THREE.Vector3(1, 3.6 * s, 1));
    trunk.setMatrixAt(i, m);
    c.setHSL(0.22 + rand() * 0.08, 0.25 + rand() * 0.15, 0.17 + rand() * 0.08);
    canopy.setColorAt(i, c);
  });
  canopy.castShadow = false;
  canopy.receiveShadow = false;
  scene.add(canopy, trunk);
  return [canopy,trunk];
}

export { SLAB_TOP, inGrantPark, EXTENT };
