// Streams the explorable circle outside downtown.
//
// The circle is split into 4 km "sky" cells. Every cell is always drawn exactly one way:
//  - far cells: its skyline tile (one instanced draw of every building 12 m and up), and
//  - near cells (within NEAR m of the view focus): all of its 1 km detail tiles, once every one
//    of them has arrived. A detail tile is drawn as one instanced draw of oriented boxes, or, within
//    REAL m of the focus and once extruded, as its real footprints (one merged mesh per facade family).
// A near cell keeps its skyline until all its detail tiles are ready, so there are never holes
// or doubled buildings. Downtown (COVERAGE_RECTS) is not in the tiles; it builds itself.
// Ground tiles (streets, parks, rivers) are loaded once for the whole circle. Beyond the circle a
// static backdrop (one instanced draw of the taller buildings out to the city limits) is always shown.
import * as THREE from 'three';
import { facadeMaterial, grassTexture } from './textures.js';
import { FAMILIES, polygonGeometry } from './city-data.js';
import { tileKey, VERSION } from './tile-format.js';
import { fadeBeyondCity } from './terrain.js';

const STRIDE = 8; // must match BOX_STRIDE in tile-worker.js
const version = new URL(import.meta.url).search;
const tilesUrl = (path) => { const u = new URL('../tiles/' + path, import.meta.url); if (!/\.bin$/.test(path)) u.search = version; return u.href; };

export async function loadTileIndex() {
  try {
    const r = await fetch(tilesUrl('index.json'));
    if (!r.ok) return null;
    const index = await r.json();
    return index.version === VERSION ? index : null;
  } catch { return null; }
}

export class TileManager {
  constructor(scene, ctx, index) {
    this.ctx = ctx; this.index = index;
    this.group = new THREE.Group(); this.group.name = 'streamed-city'; scene.add(this.group);
    this.material = facadeMaterial({ color: 0xffffff, instanced: true, features: true, profiles: true });
    // Real footprints use downtown's own per-family facade materials.
    this.familyMaterials = FAMILIES.map((f, i) => facadeMaterial({ ...f, lightingProfile: i === 3 || i === 4 ? 'office' : 'mixed', features: true }));
    // Cottage roofs (shingles) and cornices.
    this.familyMaterials.roof = new THREE.MeshStandardMaterial({ color: 0x5d524c, roughness: 0.92 });
    this.familyMaterials.trim = new THREE.MeshStandardMaterial({ color: 0x9e958a, roughness: 0.85 });
    this.familyMaterials.seats = new THREE.MeshStandardMaterial({ color: 0x4b5763, roughness: 0.8, side: THREE.DoubleSide });
    this.familyMaterials.field = new THREE.MeshStandardMaterial({ color: 0x5f8f45, roughness: 1 });
    this.familyMaterials.glassroof = new THREE.MeshStandardMaterial({ color: 0xcfe2e3, roughness: 0.12, metalness: 0.25, emissive: 0x9fc4b0, emissiveIntensity: 0, side: THREE.DoubleSide });
    ctx.glows?.push({ mat: this.familyMaterials.glassroof, day: 0, night: 0.25 });
    this.detail = new Map(index.tiles.map(([tx, tz, hash, bytes, count]) => {
      const path = `b/${tx}_${tz}.${hash}.bin`;
      return [tileKey(tx, tz), { tx, tz, path, bytes, count, mesh: null, state: 'idle', lastWanted: 0, real: { path, mode: 'real', bytes: 0, mesh: null, state: 'idle', lastWanted: 0 } }];
    }));
    this.ground = (index.ground || []).map(([sx, sz, hash, bytes]) => ({ sx, sz, path: `g/${sx}_${sz}.${hash}.bin`, mode: 'ground', bytes, mesh: null, state: 'idle' }));
    const offset = (m, f) => { m.polygonOffset = true; m.polygonOffsetFactor = f; m.polygonOffsetUnits = f; return m; };
    this.groundMaterials = {
      roads: new THREE.MeshStandardMaterial({ color: 0x363c40, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      walks: new THREE.MeshStandardMaterial({ color: 0xa7a499, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      parks: new THREE.MeshStandardMaterial({ color: 0xbfd49c, map: grassTexture(), roughness: 1, polygonOffset: true, polygonOffsetFactor: -0.25, polygonOffsetUnits: -0.25 }),
      water: ctx.riverMaterial || new THREE.MeshStandardMaterial({ color: 0x285957, roughness: 0.3, metalness: 0.18 }),
      lines: new THREE.MeshStandardMaterial({ color: 0xd2b14c, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
      fill: new THREE.MeshStandardMaterial({ color: 0x77705f, roughness: 1, side: THREE.DoubleSide }),
      steel: new THREE.MeshStandardMaterial({ color: 0x4d4943, roughness: 0.7, metalness: 0.2, side: THREE.DoubleSide }),
      // Ground cover in finished neighborhoods (yards and parkways use a grass texture in world metres).
      yard: new THREE.MeshStandardMaterial({ color: 0xc9d4b4, map: grassTexture(), roughness: 1 }),
      parkway: new THREE.MeshStandardMaterial({ color: 0xdde6c6, map: grassTexture(), roughness: 1, polygonOffset: true, polygonOffsetFactor: -2.5, polygonOffsetUnits: -2.5 }),
      // Downtown plazas and forecourts: lighter granite and concrete paving.
      plaza: new THREE.MeshStandardMaterial({ color: 0x9c988f, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -0.5, polygonOffsetUnits: -0.5 }),
      paved: new THREE.MeshStandardMaterial({ color: 0x8e8b84, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -0.5, polygonOffsetUnits: -0.5 }),
      industrial: new THREE.MeshStandardMaterial({ color: 0x7b766c, roughness: 1, polygonOffset: true, polygonOffsetFactor: -0.5, polygonOffsetUnits: -0.5 }),
      parking: new THREE.MeshStandardMaterial({ color: 0x4b4f52, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1.5, polygonOffsetUnits: -1.5 }),
      alley: new THREE.MeshStandardMaterial({ color: 0x9b978c, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1.5, polygonOffsetUnits: -1.5 }),
      wall: new THREE.MeshStandardMaterial({ color: 0x8f897d, roughness: 0.95, side: THREE.DoubleSide }),
      track: new THREE.MeshStandardMaterial({ color: 0x3b3632, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      // Parks and the lakefront.
      lawn: offset(new THREE.MeshStandardMaterial({ color: 0xc6dc9c, map: grassTexture(), roughness: 1 }), -0.75),
      prairie: offset(new THREE.MeshStandardMaterial({ color: 0x9c9b5f, roughness: 1 }), -0.75),
      sand: offset(new THREE.MeshStandardMaterial({ color: 0xdccca0, roughness: 1 }), -0.75),
      infield: offset(new THREE.MeshStandardMaterial({ color: 0xa8714a, roughness: 1 }), -1),
      tennis: offset(new THREE.MeshStandardMaterial({ color: 0x4d7a63, roughness: 0.8 }), -1),
      hardcourt: offset(new THREE.MeshStandardMaterial({ color: 0x5e6468, roughness: 0.85 }), -1),
      play: offset(new THREE.MeshStandardMaterial({ color: 0xb98f63, roughness: 1 }), -1),
      pool: offset(new THREE.MeshStandardMaterial({ color: 0x58b8cf, roughness: 0.15, metalness: 0.1 }), -1),
      vacant: offset(new THREE.MeshStandardMaterial({ color: 0x9c9482, roughness: 1 }), -0.6),
      ballast: offset(new THREE.MeshStandardMaterial({ color: 0x6e675d, roughness: 1 }), -0.6),
      trail: offset(new THREE.MeshStandardMaterial({ color: 0x4f5458, roughness: 0.9 }), -1.75),
      parkwalk: offset(new THREE.MeshStandardMaterial({ color: 0xc4bdae, roughness: 0.95 }), -1.75),
      fieldlines: offset(new THREE.MeshStandardMaterial({ color: 0xf1f1ea, roughness: 0.9 }), -2),
      dock: new THREE.MeshStandardMaterial({ color: 0x8c7d69, roughness: 0.9, side: THREE.DoubleSide }),
      garden: offset(new THREE.MeshStandardMaterial({ color: 0x6f8a4a, roughness: 1 }), -0.8),
    };
    this.groundByCell = new Map(this.ground.map((g) => [tileKey(g.sx, g.sz), g]));
    this.buildDecor(ctx);
    this.sky = new Map(index.skyline.map(([sx, sz, hash, bytes, count]) => [tileKey(sx, sz), { sx, sz, path: `s/${sx}_${sz}.${hash}.bin`, bytes, count, mesh: null, state: 'idle', children: [] }]));
    const ratio = index.sky / index.tile;
    for (const d of this.detail.values()) {
      const k = tileKey(Math.floor(d.tx / ratio), Math.floor(d.tz / ratio));
      if (!this.sky.has(k)) this.sky.set(k, { sx: Math.floor(d.tx / ratio), sz: Math.floor(d.tz / ratio), path: null, count: 0, mesh: null, state: 'none', children: [] });
      this.sky.get(k).children.push(d);
    }
    // Two decoding threads on desktop, one on phones.
    const workerUrl = new URL('./tile-worker.js', import.meta.url); workerUrl.search = version;
    this.workers = Array.from({ length: ctx.quality?.mobile ? 1 : 2 }, () => {
      const w = new Worker(workerUrl, { type: 'module' });
      w.onmessage = (e) => this.received(e.data);
      w.busy = 0; return w;
    });
    this.jobs = new Map(); this.nextId = 1; this.queue = []; this.uploads = [];
    this.timer = 0; this.clock = 0;
    this.stats = { requested: 0, loaded: 0, bytes: 0, failed: 0, evicted: 0 };
    this.buildLand(scene);
    for (const g of this.ground) this.request(g, 50 + Math.hypot(g.sx * index.sky + index.sky / 2, g.sz * index.sky + index.sky / 2) / 1000);
    if (index.backdrop) { const [hash, bytes] = index.backdrop; this.backdrop = { path: `backdrop.${hash}.bin`, bytes, mesh: null, state: 'idle' }; this.request(this.backdrop, -1); }
  }

  // Ground for the city and suburbs beyond downtown's surveyed terrain (which stays authoritative).
  // Built as east-west strips between consecutive shoreline points: west edge far inland,
  // east edge on the shore. Strips skip the surveyed box, which has its own terrain.
  buildLand(scene) {
    const land = this.index.land;
    if (!land?.shore?.length) return;
    const E = land.extent, t = land.surveyed, pts = [...land.shore];
    const shoreAt = (z) => { for (let i = 1; i < pts.length; i++) if (pts[i][1] >= z) { const [ax, az] = pts[i - 1], [bx, bz] = pts[i]; return ax + (bx - ax) * (z - az) / (bz - az || 1); } return pts.at(-1)[0]; };
    const zN = pts[0][1], zS = pts.at(-1)[1];
    pts.push(...[t.z0, t.z1].filter((z) => z > zN && z < zS && !pts.some((p) => p[1] === z)).map((z) => [shoreAt(z), z]));
    pts.sort((a, b) => a[1] - b[1]);
    const rows = [[-E, pts[0][1], pts[0][0], pts[0][0]], ...pts.slice(1).map((p, i) => [pts[i][1], p[1], pts[i][0], p[0]])];
    const pos = [];
    const quad = (z0, z1, xa0, xa1, xb0, xb1) => { // west edge xa0→xa1, east edge xb0→xb1 (z0→z1)
      if (xb0 <= xa0 && xb1 <= xa1) return;
      xb0 = Math.max(xb0, xa0); xb1 = Math.max(xb1, xa1);
      pos.push(xa0, 0, z0, xa1, 0, z1, xb0, 0, z0, xb0, 0, z0, xa1, 0, z1, xb1, 0, z1);
    };
    for (const r of rows) {
      const [z0, z1, s0, s1] = r;
      if (z1 <= t.z0 || z0 >= t.z1) { quad(z0, z1, -E, -E, s0, s1); continue; }
      quad(z0, z1, -E, -E, t.x0, t.x0);
      quad(z0, z1, t.x1, t.x1, s0, s1);
    }
    const last = pts.at(-1); quad(last[1], E, -E, -E, E, E); // south of the Indiana line: all land
    // Slivers inside the surveyed box that its terrain leaves uncovered.
    for (const rings of land.gaps || []) {
      const s = polygonGeometry(rings), g = s.index ? s.toNonIndexed() : s, p = g.attributes.position.array;
      if (g !== s) s.dispose();
      for (let i = 0; i < p.length; i++) pos.push(i % 3 === 1 ? 0 : p[i]);
      g.dispose();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, fadeBeyondCity(new THREE.MeshStandardMaterial({ color: 0x8c8e87, roughness: 0.95 })));
    mesh.position.y = -0.05; mesh.receiveShadow = true; mesh.name = 'city-land';
    scene.add(mesh); this.land = mesh;
  }

  request(entry, priority) {
    if (entry.state !== 'idle' || !entry.path) return;
    entry.state = 'queued'; entry.priority = priority;
    this.queue.push(entry);
  }

  pump() {
    this.queue.sort((a, b) => a.priority - b.priority);
    for (const w of this.workers) {
      while (w.busy < 3 && this.queue.length) {
        const entry = this.queue.shift();
        if (entry.state !== 'queued') continue;
        const id = this.nextId++;
        this.jobs.set(id, entry); entry.state = 'loading'; w.busy++; entry.worker = w;
        w.postMessage({ id, url: tilesUrl(entry.path), mode: entry.mode || 'boxes', ground: entry.mode === 'real' ? this.groundUrlFor(entry) : undefined });
        this.stats.requested++;
      }
    }
  }

  received({ id, error, ...result }) {
    const entry = this.jobs.get(id); this.jobs.delete(id);
    if (!entry) return;
    entry.worker.busy--;
    if (error) { entry.state = 'idle'; entry.retryAt = this.clock + 5; this.stats.failed++; console.warn('Tile failed', entry.path, error); return; }
    this.uploads.push({ entry, result });
  }

  // Box proxies for one tile: a single instanced draw with the downtown far-proxy façade.
  makeMesh(count, data, name) {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.InstancedMesh(geometry, this.material, count);
    const matrices = mesh.instanceMatrix.array;
    const colors = new Float32Array(count * 3), style = new Float32Array(count), seed = new Float32Array(count),
      cell = new Float32Array(count * 2), win = new Float32Array(count * 2), lit = new Float32Array(count), glass = new Float32Array(count * 3);
    const c = new THREE.Color(), g = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const o = i * STRIDE, x = data[o], z = data[o + 1], w = data[o + 2], d = data[o + 3], h = data[o + 4], a = data[o + 5], s = data[o + 6], f = data[o + 7];
      // T · Ry(-a) · S: the box's local x runs along the footprint's longest edge.
      const cos = Math.cos(a), sin = Math.sin(a), m = i * 16;
      matrices[m] = cos * w; matrices[m + 1] = 0; matrices[m + 2] = sin * w; matrices[m + 3] = 0;
      matrices[m + 4] = 0; matrices[m + 5] = h; matrices[m + 6] = 0; matrices[m + 7] = 0;
      matrices[m + 8] = -sin * d; matrices[m + 9] = 0; matrices[m + 10] = cos * d; matrices[m + 11] = 0;
      matrices[m + 12] = x; matrices[m + 13] = h / 2 + 0.6; matrices[m + 14] = z; matrices[m + 15] = 1;
      const fam = FAMILIES[f];
      c.set(fam.color).toArray(colors, i * 3); g.set(fam.glass).toArray(glass, i * 3);
      style[i] = fam.style || 0; seed[i] = s;
      cell.set(fam.cell, i * 2); win.set(fam.winA || [0.48, 0.55], i * 2); lit[i] = f === 3 || f === 4 ? 0.43 : 0.28;
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    const attr = (n, v, size) => geometry.setAttribute(n, new THREE.InstancedBufferAttribute(v, size));
    attr('aStyle', style, 1); attr('aSeed', seed, 1); attr('aCell', cell, 2); attr('aWin', win, 2); attr('aLit', lit, 1); attr('aGlass', glass, 3);
    mesh.computeBoundingSphere(); mesh.name = name; mesh.visible = false;
    mesh.layers.set(1); // main camera only: not redrawn by the lake reflection

    return mesh;
  }

  // Shared geometry and materials for street trees and lamps (the downtown look: terrain.js trees,
  // city-world.js lamps, whose glow follows the time of day through ctx.glows).
  buildDecor(ctx) {
    // Light low-poly canopies (about 50 triangles): thousands of trees are drawn near the camera.
    const canopy = new THREE.SphereGeometry(1, 6, 5), cp = canopy.attributes.position;
    for (let i = 0; i < cp.count; i++) { const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i), k = 1 + 0.13 * Math.sin(x * 8 + y * 4) * Math.sin(z * 7 - y * 3); cp.setXYZ(i, x * k, y * k, z * k); }
    canopy.computeVertexNormals();
    const trunk = new THREE.CylinderGeometry(0.25, 0.35, 1, 4, 1, true); trunk.translate(0, 0.5, 0);
    const post = new THREE.BoxGeometry(0.16, 7, 0.16); post.translate(0, 3.5 + 0.6, 0);
    // Parked cars: body and cabin, the same proportions as the moving ones.
    const carBody = new THREE.BoxGeometry(1.9, 1.15, 4.5); carBody.translate(0, 0.16 + 0.78, 0);
    const carCabin = new THREE.BoxGeometry(1.7, 0.62, 2.4); carCabin.translate(0, 0.16 + 1.64, -0.2);
    // Moored boats: a pointed white hull (length 9 m at scale 1) and a small cabin.
    const hull = new THREE.CylinderGeometry(1.5, 1.1, 9, 6, 1); hull.rotateX(Math.PI / 2); hull.scale(1, 0.55, 1); hull.translate(0, 0.35, 0);
    const boatCabin = new THREE.BoxGeometry(1.8, 1.0, 3.2); boatCabin.translate(0, 1.4, -0.6);
    const head = new THREE.BoxGeometry(1.3, 0.18, 0.7); head.translate(0.55, 7.2 + 0.6, 0);
    for (const g of [canopy, trunk, post, head, carBody, carCabin, hull, boatCabin]) g.userData.shared = true;
    const glow = new THREE.MeshStandardMaterial({ color: 0xe3d7bd, emissive: 0xffc982, emissiveIntensity: 0, roughness: 0.65 });
    ctx.glows?.push({ mat: glow, day: 0, night: 0.8 });
    this.decor = {
      canopy, trunk, post, head, glow, carBody, carCabin, hull, boatCabin,
      hullPaint: new THREE.MeshStandardMaterial({ color: 0xf2f1ec, roughness: 0.5 }),
      boatGlass: new THREE.MeshStandardMaterial({ color: 0x3a4a52, roughness: 0.3, metalness: 0.2 }),
      paint: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.2 }),
      carGlass: new THREE.MeshStandardMaterial({ color: 0x22343c, roughness: 0.25, metalness: 0.3 }),
      leaf: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
      bark: new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 1 }),
      steel: new THREE.MeshStandardMaterial({ color: 0x424a4b, roughness: 0.7 }),
    };
  }

  groundUrlFor(entry) {
    const [tx, tz] = entry.path.slice(2).split('.')[0].split('_').map(Number), ratio = this.index.sky / this.index.tile;
    const g = this.groundByCell.get(tileKey(Math.floor(tx / ratio), Math.floor(tz / ratio)));
    return g ? tilesUrl(g.path) : undefined;
  }

  // Instanced street trees, park trees and lamps for one real tile.
  addDecor(group, { trees, lamps, parked = new Float32Array(0), boats = new Float32Array(0) }) {
    if (!group) return;
    const D = this.decor, m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
    const nt = trees.length / 4, nl = lamps.length / 3;
    const add = (geo, mat, n, fill) => { if (!n) return; const im = new THREE.InstancedMesh(geo, mat, n); im.userData.decor = true; for (let i = 0; i < n; i++) { fill(i); im.setMatrixAt(i, m); } im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.layers.set(1); im.receiveShadow = true; group.add(im); return im; };
    const leaves = add(D.canopy, D.leaf, nt, (i) => {
      const [x, z, k, seed] = trees.subarray(i * 4, i * 4 + 4), r = 3.4 * k;
      e.set(0, seed * 0.37, 0); q.setFromEuler(e);
      m.compose(v.set(x, 0.6 + 3 * k + r * 0.72, z), q, s.set(r * (0.9 + (seed % 7) * 0.03), r * (0.85 + (seed % 5) * 0.06), r));
    });
    if (leaves) { const col = new Float32Array(nt * 3); for (let i = 0; i < nt; i++) { const seed = trees[i * 4 + 3]; c.setHSL(0.25 + (seed % 9) * 0.009, 0.36 + (seed % 5) * 0.03, 0.2 + (seed % 7) * 0.014).toArray(col, i * 3); } leaves.instanceColor = new THREE.InstancedBufferAttribute(col, 3); }
    add(D.trunk, D.bark, nt, (i) => { const [x, z, k] = trees.subarray(i * 4, i * 4 + 3); m.compose(v.set(x, 0.6, z), q.identity(), s.set(k, 3.2 * k, k)); });
    add(D.post, D.steel, nl, (i) => { const [x, z] = lamps.subarray(i * 3, i * 3 + 2); m.compose(v.set(x, 0, z), q.identity(), s.set(1, 1, 1)); });
    const np = parked.length / 4, PAINT = [0xd9dcd8, 0x23272b, 0x8c9399, 0x6d1f1f, 0x1f3b5a, 0xb9b2a4, 0x3d4f3a, 0xe6e2d7, 0x55606a];
    const cars = add(D.carBody, D.paint, np, (i) => { const [x, z, a] = parked.subarray(i * 4, i * 4 + 3); e.set(0, a, 0); q.setFromEuler(e); m.compose(v.set(x, 0, z), q, s.set(1, 1, 1)); });
    if (cars) { const col = new Float32Array(np * 3); for (let i = 0; i < np; i++) c.set(PAINT[parked[i * 4 + 3] % PAINT.length]).toArray(col, i * 3); cars.instanceColor = new THREE.InstancedBufferAttribute(col, 3); }
    add(D.carCabin, D.carGlass, np, (i) => { const [x, z, a] = parked.subarray(i * 4, i * 4 + 3); e.set(0, a, 0); q.setFromEuler(e); m.compose(v.set(x, 0, z), q, s.set(1, 1, 1)); });
    add(D.head, D.glow, nl, (i) => { const [x, z, a] = lamps.subarray(i * 3, i * 3 + 3); e.set(0, a, 0); q.setFromEuler(e); m.compose(v.set(x, 0, z), q, s.set(1, 1, 1)); });
    const nb = boats.length / 4, boat = (i) => { const [x, z, a, k] = boats.subarray(i * 4, i * 4 + 4); e.set(0, a, 0); q.setFromEuler(e); m.compose(v.set(x, 0, z), q, s.set(k, k, k)); };
    add(D.hull, D.hullPaint, nb, boat); add(D.boatCabin, D.boatGlass, nb, boat);
  }

  // Real footprints for one tile: a merged mesh per facade family, like downtown's near chunks.
  makeReal(meshes, name) {
    if (!meshes.length) return null;
    const group = new THREE.Group(); group.name = name; group.visible = false;
    for (const { family, position, normal, seed } of meshes) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
      geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
      geometry.computeBoundingSphere();
      const m = new THREE.Mesh(geometry, this.familyMaterials[family]);
      m.receiveShadow = true; m.layers.set(1); m.name = name + ':' + family;
      group.add(m);
    }
    return group;
  }

  // Streets, parks and rivers for one ground tile.
  makeGround(parts, name) {
    const group = new THREE.Group(); group.name = name; group.visible = false;
    for (const key of ['yard', 'plaza', 'paved', 'industrial', 'vacant', 'ballast', 'lawn', 'prairie', 'sand', 'infield', 'tennis', 'hardcourt', 'play', 'pool', 'trail', 'parkwalk', 'fieldlines', 'dock', 'garden', 'parking', 'alley', 'water', 'parks', 'walks', 'parkway', 'roads', 'lines', 'fill', 'steel', 'track', 'wall']) {
      const { position, normal } = parts[key];
      if (!position.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
      // World-space UVs: metres for the river normals, 12 m per grass tile.
      const uvScale = key === 'water' ? 1 : key === 'yard' || key === 'parkway' ? 1 / 12 : 0;
      if (uvScale) { const uv = new Float32Array(position.length / 3 * 2); for (let i = 0, j = 0; i < position.length; i += 3, j += 2) { uv[j] = position[i] * uvScale; uv[j + 1] = position[i + 2] * uvScale; } geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); }
      geometry.computeBoundingSphere();
      const m = new THREE.Mesh(geometry, this.groundMaterials[key]);
      m.receiveShadow = true; m.layers.set(1); m.name = name + ':' + key;
      group.add(m);
    }
    return group;
  }

  upload(budgetMs = 3) {
    const t0 = performance.now();
    // Real footprints and ground meshes are large GPU uploads (made on their first draw): at most
    // one of them per frame, so several arriving together don't stall a single frame.
    let heavy = 0;
    while (this.uploads.length && performance.now() - t0 < budgetMs) {
      const next = this.uploads[0];
      if (next.entry.mode && heavy++) break;
      const { entry, result } = this.uploads.shift();
      if (entry.state !== 'loading') continue; // evicted meanwhile
      if (entry.mode === 'real') { entry.mesh = this.makeReal(result.meshes, 'real-' + entry.path); if (result.decor) { this.addDecor(entry.mesh, result.decor); this.onReal?.(entry, result.decor); } }
      else if (entry.mode === 'ground') entry.mesh = this.makeGround(result.ground, 'ground-' + entry.path);
      else entry.mesh = result.count ? this.makeMesh(result.count, result.data, 'tile-' + entry.path) : null;
      if (entry.mesh) this.group.add(entry.mesh);
      if ((entry === this.backdrop || entry.mode === 'ground') && entry.mesh) entry.mesh.visible = true;
      if (entry === this.backdrop && entry.mesh) entry.mesh.name = 'city-backdrop';
      entry.state = 'ready'; this.stats.loaded++; this.stats.bytes += entry.bytes || 0;
      this.dirty = true;
    }
  }

  dispose(entry) {
    if (entry.mode === 'real' && entry.state !== 'idle') this.onRealGone?.(entry);
    if (entry.mesh) {
      this.group.remove(entry.mesh);
      entry.mesh.traverse((o) => { if (o.isMesh) { if (!o.geometry.userData.shared) o.geometry.dispose(); o.dispose?.(); } });
      entry.mesh = null;
    }
    if (entry.state === 'queued') this.queue = this.queue.filter((e) => e !== entry);
    entry.state = 'idle'; this.stats.evicted++;
  }

  // Decide what each sky cell should show; called a few times a second.
  plan(focus, level) {
    const near = level >= 3 ? 2000 : 3000, real = level >= 3 ? 1000 : 1600, size = this.index.sky;
    for (const cell of this.sky.values()) {
      const x0 = cell.sx * size, z0 = cell.sz * size;
      const dx = Math.max(x0 - focus.x, 0, focus.x - (x0 + size)), dz = Math.max(z0 - focus.z, 0, focus.z - (z0 + size));
      const dist = Math.hypot(dx, dz);
      cell.near = dist < near;
      this.request(cell, 100 + dist / 1000);
      if (cell.near) for (const d of cell.children) {
        d.lastWanted = this.clock;
        const tile = this.index.tile, dist = Math.hypot(Math.max(d.tx * tile - focus.x, 0, focus.x - (d.tx + 1) * tile), Math.max(d.tz * tile - focus.z, 0, focus.z - (d.tz + 1) * tile));
        if (d.state === 'idle' && !(d.retryAt > this.clock)) this.request(d, dist / 1000);
        d.wantReal = dist < real;
        // Trees, lamps and parked cars only within about 1 km (600 m at low quality): they cost the most.
        d.decorNear = dist < (level >= 3 ? 600 : 1000);
        if (d.wantReal) { d.real.lastWanted = this.clock; if (d.real.state === 'idle' && !(d.real.retryAt > this.clock)) this.request(d.real, 0.5 + dist / 1000); }
      } else for (const d of cell.children) d.wantReal = false;
    }
    // Forget detail tiles (and real footprints) that have not been wanted for 10 s.
    for (const d of this.detail.values()) {
      if (d.state !== 'idle' && this.clock - d.lastWanted > 10) this.dispose(d);
      if (d.real.state !== 'idle' && this.clock - d.real.lastWanted > 10) this.dispose(d.real);
    }
    this.dirty = true;
  }

  show() {
    for (const cell of this.sky.values()) {
      const ready = cell.near && cell.children.every((d) => d.state === 'ready');
      if (cell.mesh) cell.mesh.visible = !ready;
      for (const d of cell.children) {
        const real = ready && d.wantReal && d.real.state === 'ready' && d.real.mesh;
        if (d.mesh) d.mesh.visible = ready && !real;
        if (d.real.mesh) { d.real.mesh.visible = !!real; for (const o of d.real.mesh.children) if (o.userData.decor) o.visible = !!d.decorNear; }
      }
    }
    this.dirty = false;
  }

  update(dt, focus, level = 0) {
    this.clock += dt; this.timer -= dt;
    if (this.timer <= 0) { this.plan(focus, level); this.timer = 0.25; }
    this.pump(); this.upload();
    if (this.dirty) this.show();
  }

  get drawCalls() { let n = 0; const walk = (o) => { if (!o.visible) return; if (o.isMesh) n++; o.children.forEach(walk); }; walk(this.group); return n; }
}
