// Chicago's expressways inside the circle (assets/expressways.json, from the City's centrelines and
// their grade levels): the Kennedy, Eisenhower, Dan Ryan and Stevenson, local and express lanes,
// each direction its own carriageway, and their ramps and flyovers (the Circle Interchange, the
// Dan Ryan-Stevenson junction). Lake Shore Drive has its own model (js/lake-shore.js).
//  - level -1 / -2: below grade, in a trench under the cross streets (drawn just under street
//    level, between trench walls);
//  - level 0: at grade;  level 1 / 2: elevated decks on piers, about 7 m per level.
// Asphalt, lane dashes, edge lines and concrete barriers; elevated decks get a fascia, an underside
// and piers. All batched by material.
import * as THREE from 'three';

const WIDTH = { main: 15.6, ramp: 7.4 };            // one carriageway, shoulders included
const levelY = (l) => (l < 0 ? 0.12 : l === 0 ? 0.21 : 0.21 + l * 7.2);

export async function buildExpressways(scene, ctx) {
  const url = new URL('../assets/expressways.json', import.meta.url); url.search = new URL(import.meta.url).search;
  const r = await fetch(url); if (!r.ok) return null;
  const { segments } = await r.json();
  const B = { asphalt: [], white: [], yellow: [], concrete: [] }, piers = [];
  const quad = (key, a, b, c, d) => B[key].push(...a, ...b, ...c, ...a, ...c, ...d);
  // A strip between offsets o0 and o1 (metres to the right of travel) along a polyline with heights.
  const strip = (key, P, o0, o1, lift = 0) => {
    for (let i = 1; i < P.length; i++) {
      const [ax, ay, az] = P[i - 1], [bx, by, bz] = P[i], l = Math.hypot(bx - ax, bz - az); if (l < 0.05) continue;
      const dx = (bx - ax) / l, dz = (bz - az) / l, nx = -dz, nz = dx, ex = dx * 0.4, ez = dz * 0.4; // a little overlap hides joins
      const p = (x, y, z, o) => [x + nx * o, y + lift, z + nz * o];
      quad(key, p(ax - ex, ay, az - ez, o0), p(bx + ex, by, bz + ez, o0), p(bx + ex, by, bz + ez, o1), p(ax - ex, ay, az - ez, o1));
    }
  };
  // A vertical wall along offset o from height y0 to y1 above the deck (negative y0 reaches below it).
  const wall = (P, o, h0, h1, ground = false) => {
    for (let i = 1; i < P.length; i++) {
      const [ax, ay, az] = P[i - 1], [bx, by, bz] = P[i], l = Math.hypot(bx - ax, bz - az); if (l < 0.05) continue;
      const nx = -(bz - az) / l, nz = (bx - ax) / l;
      const A = [ax + nx * o, az + nz * o], Bp = [bx + nx * o, bz + nz * o];
      const ya0 = ground ? 0 : ay + h0, yb0 = ground ? 0 : by + h0;
      quad('concrete', [A[0], ya0, A[1]], [Bp[0], yb0, Bp[1]], [Bp[0], by + h1, Bp[1]], [A[0], ay + h1, A[1]]);
    }
  };
  for (const s of segments) {
    const pts = s.points; if (pts.length < 2) continue;
    // Heights along the segment, from its grade level at one end to the other's.
    const d = [0]; for (let i = 1; i < pts.length; i++) d.push(d[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const L = d.at(-1) || 1, [l0, l1] = s.level, y0 = levelY(l0), y1 = levelY(l1);
    // Ease the ramp between levels over the whole segment (grade-separated ramps climb gradually).
    const P = pts.map(([x, z], i) => { const t = d[i] / L, k = t * t * (3 - 2 * t); return [x, y0 + (y1 - y0) * k, z]; });
    const W = WIDTH[s.kind] * (s.dir === 'B' ? 2 : 1), h = W / 2, elevated = Math.max(y0, y1) > 1.5, trench = l0 < 0 && l1 < 0;
    strip('asphalt', P, -h, h);
    // Paint: edge lines; lane dashes on mainlines; a double yellow down two-way pieces.
    strip('white', P, h - 0.75, h - 0.55, 0.02);
    strip(s.dir === 'B' ? 'white' : 'yellow', P, -h + 0.55, -h + 0.75, 0.02);
    if (s.dir === 'B') strip('yellow', P, -0.2, 0.2, 0.02);
    if (s.kind === 'main') {
      const lanes = s.dir === 'B' ? [] : [-h + 0.75 + 3.55, -h + 0.75 + 7.1, -h + 0.75 + 10.65].filter((o) => o < h - 1.5);
      for (const o of lanes) for (let i = 1; i < P.length; i++) {
        const a = P[i - 1], b = P[i], l = d[i] - d[i - 1]; if (l < 0.05) continue;
        for (let t = (12 - (d[i - 1] % 12)) % 12; t < l - 3; t += 12) {
          const f0 = t / l, f1 = Math.min(1, (t + 3) / l), pa = a.map((v, k) => v + (b[k] - v) * f0), pb = a.map((v, k) => v + (b[k] - v) * f1);
          strip('white', [pa, pb], o - 0.08, o + 0.08, 0.02);
        }
      }
    }
    // Concrete barriers along mainlines, and along every elevated or trench piece.
    if (s.kind === 'main' || elevated || trench) for (const side of [-1, 1]) { wall(P, side * (h + 0.05), 0, 1.0); wall(P, side * (h + 0.45), 0, 1.0); strip('concrete', P, side > 0 ? h + 0.05 : -h - 0.45, side > 0 ? h + 0.45 : -h - 0.05, 1.0); }
    // Trench walls: concrete retaining walls a little above street level.
    if (trench) for (const side of [-1, 1]) wall(P, side * (h + 1.4), 0, 1.6);
    // Elevated decks: a 1.3 m fascia on both sides, the underside, and piers about every 32 m.
    if (elevated) {
      for (const side of [-1, 1]) wall(P, side * h, -1.3, 0);
      const under = P.map(([x, y, z]) => [x, Math.max(0.3, y - 1.3), z]); strip('concrete', under, h, -h);
      for (let i = 1; i < P.length; i++) {
        const a = P[i - 1], b = P[i], l = d[i] - d[i - 1];
        for (let t = (32 - (d[i - 1] % 32)) % 32; t < l; t += 32) { const f = t / l, y = a[1] + (b[1] - a[1]) * f; if (y > 3) piers.push([a[0] + (b[0] - a[0]) * f, a[2] + (b[2] - a[2]) * f, y - 1.3, Math.min(W * 0.55, 9)]); }
      }
    }
  }
  const group = new THREE.Group(); group.name = 'expressways';
  const mats = {
    asphalt: new THREE.MeshStandardMaterial({ color: 0x3b4044, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    white: new THREE.MeshStandardMaterial({ color: 0xdedbcf, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xd1b35d, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0xa7a49b, roughness: 0.9, side: THREE.DoubleSide }),
  };
  for (const [key, list] of Object.entries(B)) {
    if (!list.length) continue;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(list, 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mats[key]); m.name = 'expressways-' + key; m.receiveShadow = true; m.castShadow = key === 'concrete'; group.add(m);
  }
  if (piers.length) {
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), im = new THREE.InstancedMesh(geo, mats.concrete, piers.length), m = new THREE.Matrix4();
    piers.forEach(([x, z, y, w], i) => im.setMatrixAt(i, m.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion(), new THREE.Vector3(1.6, y, 1.6))));
    im.name = 'expressway-piers'; im.castShadow = true; im.computeBoundingSphere(); group.add(im);
  }
  scene.add(group);
  return { group, segments: segments.length, piers: piers.length };
}
