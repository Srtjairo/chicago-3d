// Downtown touch-up, in the spirit of the finished neighborhoods. Adds life and night realism to the
// hand-built downtown without changing any building or landmark (their footprints, heights and
// positions are guarded by tools/check-downtown-metrics.mjs):
//  - cars parked along the curbs of downtown side streets (not on the big avenues or bridges);
//  - lit lobby glass along the street-level base of downtown's mid- and high-rises, which glows
//    at night like real lobbies and storefronts.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const NO_PARKING = /MICHIGAN|STATE|WACKER|LAKE SHORE|COLUMBUS|ROOSEVELT|CONGRESS|COLUMBUS|DU SABLE|UPPER|LOWER/;
const PAINT = [0xd9dcd8, 0x23272b, 0x8c9399, 0x6d1f1f, 0x1f3b5a, 0xb9b2a4, 0x3d4f3a, 0xe6e2d7, 0x55606a];

export function buildDowntownTouchup(scene, ctx) {
  const group = new THREE.Group(); group.name = 'downtown-touchup'; scene.add(group);
  let seed = 4242; const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

  // ---------- Parked cars ----------
  const cars = [];
  for (const road of ctx.roads || []) {
    if (road.class !== 4 || road.bridge || NO_PARKING.test(road.road || road.name || '')) continue;
    const pts = road.path.map((p) => [p[0], p[2], p[1]]), w = road.width;
    let total = 0; const segs = [];
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (l > 0.01) { segs.push([pts[i - 1], pts[i], l, total]); total += l; } }
    // About 55% of the spaces taken, both curbs, 12 m clear of each corner.
    for (const side of [-1, 1]) for (let d = 12 + rand() * 3; d < total - 12; d += 6.5) {
      if (rand() > 0.55) continue;
      const s = segs.find((g) => d <= g[3] + g[2]); if (!s) break;
      const t = (d - s[3]) / s[2], [a, b] = s, dx = (b[0] - a[0]) / s[2], dz = (b[1] - a[1]) / s[2];
      const x = a[0] + (b[0] - a[0]) * t - dz * side * (w / 2 - 1.05), z = a[1] + (b[1] - a[1]) * t + dx * side * (w / 2 - 1.05);
      const y = a[2] + (b[2] - a[2]) * t;
      cars.push([x, y, z, Math.atan2(dx, dz) + (side < 0 ? Math.PI : 0), Math.floor(rand() * PAINT.length)]);
    }
  }
  if (cars.length) {
    const body = new THREE.InstancedMesh(new THREE.BoxGeometry(1.9, 1.15, 4.5).translate(0, 0.94, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.2 }), cars.length);
    const cabin = new THREE.InstancedMesh(new THREE.BoxGeometry(1.7, 0.62, 2.4).translate(0, 1.8, -0.2), new THREE.MeshStandardMaterial({ color: 0x22343c, roughness: 0.25, metalness: 0.3 }), cars.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), c = new THREE.Color();
    cars.forEach(([x, y, z, a, p], i) => { q.setFromAxisAngle(up, a); m.compose(v.set(x, y - 0.1, z), q, one); body.setMatrixAt(i, m); cabin.setMatrixAt(i, m); body.setColorAt(i, c.set(PAINT[p])); });
    body.name = 'downtown-parked-cars'; cabin.name = 'downtown-parked-car-cabins';
    for (const im of [body, cabin]) { im.receiveShadow = true; im.computeBoundingSphere(); group.add(im); }
  }

  // ---------- Lit lobbies ----------
  // A 4 m band of lobby glass just outside the walls of buildings 45 m and taller, from the 0.6 m
  // slab: dark glass by day, warm light at night (driven by the time of day via ctx.glows).
  const parts = [];
  for (const b of ctx.measuredBuildings || []) {
    if (b.h < 45 || !b.rings?.[0]) continue;
    const r = b.rings[0].slice(0, -1).length >= 3 && b.rings[0][0][0] === b.rings[0].at(-1)[0] && b.rings[0][0][1] === b.rings[0].at(-1)[1] ? b.rings[0].slice(0, -1) : b.rings[0];
    let area = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q2 = r[(i + 1) % r.length]; area += p[0] * q2[1] - q2[0] * p[1]; }
    const sign = area > 0 ? 1 : -1, pos = [], nrm = [];
    for (let i = 0; i < r.length; i++) {
      const [ax, az] = r[i], [bx, bz] = r[(i + 1) % r.length], len = Math.hypot(bx - ax, bz - az);
      if (len < 2) continue;
      const nx = (bz - az) / len * sign, nz = -(bx - ax) / len * sign, o = 0.12;
      const A = [ax + nx * o, az + nz * o], B = [bx + nx * o, bz + nz * o], y0 = 0.6, y1 = 4.6;
      pos.push(A[0], y0, A[1], B[0], y0, B[1], B[0], y1, B[1], A[0], y0, A[1], B[0], y1, B[1], A[0], y1, A[1]);
      for (let k = 0; k < 6; k++) nrm.push(nx, 0, nz);
    }
    if (!pos.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    parts.push(g);
  }
  if (parts.length) {
    const lobby = new THREE.MeshStandardMaterial({ color: 0x2c3a42, roughness: 0.2, metalness: 0.35, emissive: 0xffd9a0, emissiveIntensity: 0 });
    ctx.glows?.push({ mat: lobby, day: 0.02, night: 0.55 });
    const mesh = new THREE.Mesh(mergeGeometries(parts, false), lobby); parts.forEach((g) => g.dispose());
    mesh.name = 'downtown-lobbies'; mesh.computeBoundingSphere?.(); group.add(mesh);
  }
  return { cars: cars.length, lobbies: parts.length };
}
