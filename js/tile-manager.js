// Streams the city outside downtown (milestone M3: block proxies).
//
// The city is split into 4 km "sky" cells. Every cell is always drawn exactly one way:
//  - far cells: its skyline tile (one instanced draw of every building 12 m and up), and
//  - near cells (within NEAR m of the view focus): all of its 1 km detail tiles, each one
//    instanced draw with a box for every building, once every one of them has arrived.
// A near cell keeps its skyline until all its detail tiles are ready, so there are never holes
// or doubled buildings. Downtown (COVERAGE_RECTS) is not in the tiles; it builds itself.
import * as THREE from 'three';
import { facadeMaterial } from './textures.js';
import { FAMILIES, polygonGeometry } from './city-data.js';
import { tileKey } from './tile-format.js';

const STRIDE = 7; // must match BOX_STRIDE in tile-worker.js
const version = new URL(import.meta.url).search;
const tilesUrl = (path) => { const u = new URL('../tiles/' + path, import.meta.url); if (!/\.bin$/.test(path)) u.search = version; return u.href; };

export async function loadTileIndex() {
  try {
    const r = await fetch(tilesUrl('index.json'));
    if (!r.ok) return null;
    const index = await r.json();
    return index.version === 1 ? index : null;
  } catch { return null; }
}

// Façade family for a neighbourhood building: brick for low-rises, the downtown mix for
// mid-rises and the glass families for towers. Deterministic per building.
export function familyFor(h, seed) {
  if (h > 130) return seed % 3 === 0 ? 4 : 3;
  if (h > 40) return [0, 2, 5, 3][seed % 4];
  return [1, 1, 0, 5, 1, 2][seed % 6];
}

export class TileManager {
  constructor(scene, ctx, index) {
    this.ctx = ctx; this.index = index;
    this.group = new THREE.Group(); this.group.name = 'streamed-city'; scene.add(this.group);
    this.material = facadeMaterial({ color: 0xffffff, instanced: true, features: true, profiles: true });
    this.detail = new Map(index.tiles.map(([tx, tz, hash, bytes, count]) => [tileKey(tx, tz), { tx, tz, path: `b/${tx}_${tz}.${hash}.bin`, bytes, count, mesh: null, state: 'idle', lastWanted: 0 }]));
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
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x8c8e87, roughness: 0.95 }));
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
        w.postMessage({ id, url: tilesUrl(entry.path) });
        this.stats.requested++;
      }
    }
  }

  received({ id, error, count, data }) {
    const entry = this.jobs.get(id); this.jobs.delete(id);
    if (!entry) return;
    entry.worker.busy--;
    if (error) { entry.state = 'idle'; entry.retryAt = this.clock + 5; this.stats.failed++; console.warn('Tile failed', entry.path, error); return; }
    this.uploads.push({ entry, count, data });
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
      const o = i * STRIDE, x = data[o], z = data[o + 1], w = data[o + 2], d = data[o + 3], h = data[o + 4], a = data[o + 5], s = data[o + 6];
      // T · Ry(-a) · S: the box's local x runs along the footprint's longest edge.
      const cos = Math.cos(a), sin = Math.sin(a), m = i * 16;
      matrices[m] = cos * w; matrices[m + 1] = 0; matrices[m + 2] = sin * w; matrices[m + 3] = 0;
      matrices[m + 4] = 0; matrices[m + 5] = h; matrices[m + 6] = 0; matrices[m + 7] = 0;
      matrices[m + 8] = -sin * d; matrices[m + 9] = 0; matrices[m + 10] = cos * d; matrices[m + 11] = 0;
      matrices[m + 12] = x; matrices[m + 13] = h / 2 + 0.6; matrices[m + 14] = z; matrices[m + 15] = 1;
      const f = familyFor(h, s), fam = FAMILIES[f];
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

  upload(budgetMs = 3) {
    const t0 = performance.now();
    while (this.uploads.length && performance.now() - t0 < budgetMs) {
      const { entry, count, data } = this.uploads.shift();
      if (entry.state !== 'loading') continue; // evicted meanwhile
      entry.mesh = count ? this.makeMesh(count, data, 'tile-' + entry.path) : null;
      if (entry.mesh) this.group.add(entry.mesh);
      entry.state = 'ready'; this.stats.loaded++; this.stats.bytes += entry.bytes || 0;
      this.dirty = true;
    }
  }

  dispose(entry) {
    if (entry.mesh) { this.group.remove(entry.mesh); entry.mesh.geometry.dispose(); entry.mesh.dispose(); entry.mesh = null; }
    if (entry.state === 'queued') this.queue = this.queue.filter((e) => e !== entry);
    entry.state = 'idle'; this.stats.evicted++;
  }

  // Decide what each sky cell should show; called a few times a second.
  plan(focus, level) {
    const near = level >= 3 ? 2000 : 3000, size = this.index.sky;
    for (const cell of this.sky.values()) {
      const x0 = cell.sx * size, z0 = cell.sz * size;
      const dx = Math.max(x0 - focus.x, 0, focus.x - (x0 + size)), dz = Math.max(z0 - focus.z, 0, focus.z - (z0 + size));
      const dist = Math.hypot(dx, dz);
      cell.near = dist < near;
      this.request(cell, 100 + dist / 1000);
      if (cell.near) for (const d of cell.children) { d.lastWanted = this.clock; if (d.state === 'idle' && !(d.retryAt > this.clock)) this.request(d, Math.hypot(d.tx * 1000 + 500 - focus.x, d.tz * 1000 + 500 - focus.z) / 1000); }
    }
    // Forget detail tiles that have not been wanted for 10 s.
    for (const d of this.detail.values()) if (d.state !== 'idle' && this.clock - d.lastWanted > 10) this.dispose(d);
    this.dirty = true;
  }

  show() {
    for (const cell of this.sky.values()) {
      const ready = cell.near && cell.children.every((d) => d.state === 'ready');
      if (cell.mesh) cell.mesh.visible = !ready;
      for (const d of cell.children) if (d.mesh) d.mesh.visible = ready;
    }
    this.dirty = false;
  }

  update(dt, focus, level = 0) {
    this.clock += dt; this.timer -= dt;
    if (this.timer <= 0) { this.plan(focus, level); this.timer = 0.25; }
    this.pump(); this.upload();
    if (this.dirty) this.show();
  }

  get drawCalls() { let n = 0; this.group.traverse((o) => { if (o.isMesh && o.visible) n++; }); return n; }
}
