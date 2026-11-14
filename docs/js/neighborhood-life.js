// Cars and people in finished neighborhoods, generated around the camera. The tile worker gives
// each nearby finished 1 km tile its driving lanes and sidewalks (tile-worker.js decorate());
// a fixed pool of cars and walkers lives on whatever lanes are loaded, hopping from one lane to a
// connecting one at intersections and moving elsewhere when their tile unloads. Illustrative
// motion, like downtown's; it pauses with "Pause city life".
import * as THREE from 'three';

const CARS = 220, WALKERS = 360;
const PAINT = [0xd9dcd8, 0x23272b, 0x8c9399, 0x6d1f1f, 0x1f3b5a, 0xb9b2a4, 0x3d4f3a, 0xe6e2d7, 0x55606a];
const SHIRTS = [0x8a3b2e, 0x2f4a6a, 0xd7c9a7, 0x3f6b4a, 0x5b4e7a, 0xc56b2d, 0x2b2b2e, 0xe0e0dc];

// Polylines from the worker: a flat [x, z, ...] array and point counts.
function unpack({ pts, counts }) {
  const out = []; let o = 0;
  for (const n of counts) {
    const p = [], cum = [0];
    for (let i = 0; i < n; i++) { p.push([pts[(o + i) * 2], pts[(o + i) * 2 + 1]]); if (i) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])); }
    o += n; if (cum.at(-1) > 8) out.push({ p, cum, length: cum.at(-1) });
  }
  return out;
}
function sampleAt(route, d, out) {
  const { p, cum } = route; let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const t = Math.min(1, Math.max(0, (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1)));
  out.x = p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t; out.z = p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t;
  out.a = Math.atan2(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return out;
}

export function setupNeighborhoodLife(scene, ctx, camera) {
  const group = new THREE.Group(); group.name = 'neighborhood-life'; scene.add(group);
  const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });
  const pool = (geo, material, n) => { const m = new THREE.InstancedMesh(geo, material, n); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.layers.set(1); m.count = 0; group.add(m); return m; };
  const body = pool(new THREE.BoxGeometry(1.9, 1.15, 4.5), mat(0xffffff), CARS);
  const cabin = pool(new THREE.BoxGeometry(1.7, 0.62, 2.4), mat(0x22343c, { metalness: 0.3, roughness: 0.25 }), CARS);
  const lights = pool(new THREE.BoxGeometry(1.5, 0.18, 0.08), mat(0xffedc9, { emissive: 0xffdd9b, emissiveIntensity: 0.1 }), CARS);
  ctx.glows?.push({ mat: lights.material, day: 0.1, night: 1.2 });
  const torso = pool(new THREE.BoxGeometry(0.45, 0.68, 0.27), mat(0xffffff), WALKERS);
  const head = pool(new THREE.IcosahedronGeometry(0.17, 0), mat(0xb58f6f), WALKERS);
  const legs = pool(new THREE.BoxGeometry(0.34, 0.78, 0.18), mat(0x2f343c), WALKERS);
  const c = new THREE.Color();
  for (let i = 0; i < CARS; i++) body.setColorAt(i, c.set(PAINT[i % PAINT.length]));
  for (let i = 0; i < WALKERS; i++) torso.setColorAt(i, c.set(SHIRTS[(i * 7) % SHIRTS.length]));

  const tiles = new Map(); // key -> { lanes, walks }
  let lanes = [], walks = [], starts = new Map();
  const rebuild = () => {
    lanes = [...tiles.values()].flatMap((t) => t.lanes); walks = [...tiles.values()].flatMap((t) => t.walks);
    starts = new Map();
    for (const l of lanes) { const k = Math.round(l.p[0][0] / 6) + ',' + Math.round(l.p[0][1] / 6); if (!starts.has(k)) starts.set(k, []); starts.get(k).push(l); }
  };
  let seed = 7; const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const cars = Array.from({ length: CARS }, (_, i) => ({ route: null, d: 0, speed: 7 + (i % 5) }));
  const people = Array.from({ length: WALKERS }, (_, i) => ({ route: null, d: 0, dir: i % 2 ? 1 : -1, speed: 1.1 + (i % 7) * 0.08, phase: i }));
  const live = (r) => r && r.tile && tiles.get(r.tile) === r.owner;
  // Everyone stays within about 700 m of the camera, so the streets in view are busy.
  const NEAR = 700, near = (r) => Math.hypot(r.p[0][0] - camera.position.x, r.p[0][1] - camera.position.z) < NEAR;
  const place = (a, list) => { const close = list.filter(near), pickFrom = close.length ? close : list; if (!pickFrom.length) { a.route = null; return; } a.route = pickFrom[Math.floor(rand() * pickFrom.length)]; a.d = rand() * a.route.length; };
  const far = (a) => Math.hypot(a.route.p[0][0] - camera.position.x, a.route.p[0][1] - camera.position.z) > NEAR * 1.4;
  // Next lane: one starting within a few metres of where this one ends, else anywhere loaded.
  const next = (route) => { const e = route.p.at(-1), out = []; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const l of starts.get((Math.round(e[0] / 6) + i) + ',' + (Math.round(e[1] / 6) + j)) || []) if (l !== route && Math.hypot(l.p[0][0] - e[0], l.p[0][1] - e[1]) < 6) out.push(l); return out.length ? out[Math.floor(rand() * out.length)] : null; };

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0), at = {};
  let time = 0;
  function update(dt) {
    const paused = ctx.life?.paused;
    if (!paused) time += dt;
    let n = 0;
    for (const car of cars) {
      if (!live(car.route) || far(car)) place(car, lanes);
      if (!car.route) continue;
      if (!paused) { car.d += car.speed * dt; if (car.d >= car.route.length) { const r = next(car.route); if (r) { car.route = r; car.d = 0; } else place(car, lanes); if (!car.route) continue; } }
      sampleAt(car.route, car.d, at); q.setFromAxisAngle(up, at.a);
      m.compose(v.set(at.x, 0.16 + 0.78, at.z), q, s); body.setMatrixAt(n, m);
      v.set(0, 0.86, -0.2).applyQuaternion(q); m.compose(v.set(at.x + v.x, 0.16 + 0.78 + v.y, at.z + v.z), q, s); cabin.setMatrixAt(n, m);
      v.set(0, -0.05, 2.27).applyQuaternion(q); m.compose(v.set(at.x + v.x, 0.16 + 0.78 + v.y, at.z + v.z), q, s); lights.setMatrixAt(n, m);
      n++;
    }
    body.count = cabin.count = lights.count = n;
    if (n) { body.instanceMatrix.needsUpdate = cabin.instanceMatrix.needsUpdate = lights.instanceMatrix.needsUpdate = true; }
    let k = 0;
    for (const p of people) {
      if (!live(p.route) || far(p)) place(p, walks);
      if (!p.route) continue;
      if (!paused) { p.d += p.speed * p.dir * dt; if (p.d > p.route.length || p.d < 0) { p.dir = -p.dir; p.d = Math.min(Math.max(p.d, 0), p.route.length); } }
      sampleAt(p.route, p.d, at); q.setFromAxisAngle(up, at.a + (p.dir < 0 ? Math.PI : 0));
      const bob = Math.abs(Math.sin(time * 6 * p.speed + p.phase)) * 0.04;
      m.compose(v.set(at.x, 0.1 + 0.39, at.z), q, s); legs.setMatrixAt(k, m);
      m.compose(v.set(at.x, 0.1 + 1.12 + bob, at.z), q, s); torso.setMatrixAt(k, m);
      m.compose(v.set(at.x, 0.1 + 1.63 + bob, at.z), q, s); head.setMatrixAt(k, m);
      k++;
    }
    torso.count = head.count = legs.count = k;
    if (k) { torso.instanceMatrix.needsUpdate = head.instanceMatrix.needsUpdate = legs.instanceMatrix.needsUpdate = true; }
  }

  return {
    add(key, { lanes: l, walks: w }) {
      const owner = { lanes: unpack(l), walks: unpack(w) };
      for (const r of [...owner.lanes, ...owner.walks]) { r.tile = key; r.owner = owner; }
      tiles.set(key, owner); rebuild();
    },
    remove(key) { if (tiles.delete(key)) rebuild(); },
    update,
    get stats() { return { tiles: tiles.size, lanes: lanes.length, walks: walks.length, cars: body.count, people: torso.count }; },
  };
}
