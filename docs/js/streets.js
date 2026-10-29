import * as THREE from 'three';
import { BLOCK, STREET, SHORE_POINTS, isLake, inGrantPark, distToRiver } from './geo.js?v=89cbf690b5719dd4';

// Small, static batches: street markings and waterfront structure, no simulation.
export function buildStreets(scene, ctx) {
  const paint = [], promenade = [], edges = [], coastalRoad = [], rails = [];
  const box = (out, x, y, z, w, h, d, angle = 0) => out.push([x, y, z, w, h, d, angle]);
  const openStreet = (x, z) => !isLake(x, z, 80) && !inGrantPark(x, z) && distToRiver(x, z) > 18;
  for (let x = -2000; x <= 1125; x += BLOCK) {
    for (let z = -2375; z <= 1875; z += BLOCK) {
      // Dashed centerlines only on the actual gaps in the block grid.
      for (let t = 26; t < BLOCK - 20; t += 22) {
        if (openStreet(x, z + t)) box(paint, x, 0.025, z + t, 0.3, 0.015, 7);
        if (openStreet(x + t, z)) box(paint, x + t, 0.025, z, 7, 0.015, 0.3);
      }
      if (!openStreet(x, z) || Math.hypot(x, z) > 1500) continue;
      for (let t = -7; t <= 7; t += 2.8) {
        for (const s of [-1, 1]) {
          if (openStreet(x, z + s * 15)) box(paint, x + t, 0.03, z + s * 15, 1.5, 0.02, 4);
          if (openStreet(x + s * 15, z)) box(paint, x + s * 15, 0.03, z + t, 4, 0.02, 1.5);
        }
      }
    }
  }
  // The promenade follows the shoreline; all offsets stay on the land side.
  for (let i = 1; i < SHORE_POINTS.length; i++) {
    const [z0, x0] = SHORE_POINTS[i - 1], [z1, x1] = SHORE_POINTS[i];
    if (z0 < -2600 || z1 > 3000) continue;
    // Leave the river mouth and Navy Pier connection open.
    if (z0 < -700 && z1 > -850) continue;
    const len = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(x1 - x0, z1 - z0);
    const x = (x0 + x1) / 2, z = (z0 + z1) / 2;
    box(promenade, x - 9, 0.18, z, 13, 0.3, len + 1, a);
    box(edges, x - 1.8, 0.32, z, 1.8, 1.5, len + 1, a);
    box(coastalRoad, x - 39, 0.04, z, 28, 0.03, len + 1, a);
    box(paint, x - 39, 0.065, z, 0.32, 0.02, len, a);
  }
  // Bridge parapets and a warm steel edge; decks already exist in terrain.js.
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (const m of ctx.bridges) {
    m.decompose(p, q, s);
    const northSouth = s.z > s.x;
    for (const side of [-1, 1]) {
      box(rails, p.x + (northSouth ? side * (STREET / 2 + 1) : 0), 3.0,
        p.z + (northSouth ? 0 : side * (STREET / 2 + 1)),
        northSouth ? 0.65 : s.x, 1.3, northSouth ? s.z : 0.65);
    }
  }
  const unit = new THREE.BoxGeometry(1, 1, 1), m = new THREE.Matrix4();
  for (const [name, items, color] of [
    ['street-markings', paint, 0xc2bba4], ['lakefront-walk', promenade, 0xb2ab9d],
    ['seawall', edges, 0x9a9a91], ['lakefront-road', coastalRoad, 0x373e42], ['bridge-parapets', rails, 0x6b4c3d],
  ]) {
    const mesh = new THREE.InstancedMesh(unit, new THREE.MeshStandardMaterial({ color, roughness: 0.9 }), items.length);
    items.forEach(([x, y, z, w, h, d, a], i) => {
      m.compose(p.set(x, y, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, a), s.set(w, h, d));
      mesh.setMatrixAt(i, m);
    });
    mesh.name = name;
    mesh.receiveShadow = name !== 'street-markings';
    scene.add(mesh);
  }
}
