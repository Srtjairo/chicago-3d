// Background thread for the streamed city: downloads a tile, inflates it, decodes it and turns
// it into typed arrays the main thread can upload to the GPU without further work.
// Module workers don't see the page's import map, so three's Earcut comes from its pinned URL.
import { decode, orientedBox, familyFor } from './tile-format.js';
import { Earcut } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/src/extras/Earcut.js';

// Box instances, stride 7: x, z, width, depth, height, angle (atan2 dz,dx), seed.
export const BOX_STRIDE = 7;
const BASE = 0.6; // buildings stand on the same 0.6 m slab top as downtown's

async function load(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  const stream = r.body.pipeThrough(new DecompressionStream('gzip'));
  return decode(new Uint8Array(await new Response(stream).arrayBuffer()));
}

// Block proxies are seen from 1.5 km and more, where garages and sheds are sub-pixel: skip
// footprints under this many square metres (the real shapes come with the near ring).
const MIN_PROXY_AREA = 80;

function boxes(tile) {
  const list = tile.kind === 1 ? tile.boxes : tile.buildings.map((b) => ({ b, o: orientedBox(b.rings[0]) })).filter(({ o }) => o.w * o.d >= MIN_PROXY_AREA);
  const out = new Float32Array(list.length * BOX_STRIDE);
  list.forEach((item, i) => {
    const b = tile.kind === 1 ? item : item.b, o = tile.kind === 1 ? item : item.o;
    // Skyline tiles carry no ids; a position hash keeps each box's window pattern stable.
    const seed = tile.kind === 1 ? Math.abs(Math.round(b.x * 7 + b.z * 13)) % 10007 : b.objectId % 10007;
    out.set([o.x, o.z, Math.max(o.w, 1), Math.max(o.d, 1), b.h, o.angle, seed], i * BOX_STRIDE);
  });
  return { count: list.length, data: out };
}

// ---------- Triangle soup helpers ----------
class Soup {
  constructor() { this.p = []; this.n = []; this.s = []; }
  // Adds a triangle facing along (nx, ny, nz), flipping its winding if needed.
  tri(a, b, c, nx, ny, nz, seed = 0) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const d = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz;
    if (d < 0) [b, c] = [c, b];
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.n.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    this.s.push(seed, seed, seed);
  }
  // A flat polygon (with holes) at height y, facing up.
  flat(rings, y, seed = 0) {
    const flatXZ = [], holes = [];
    for (const r of rings) { if (flatXZ.length) holes.push(flatXZ.length / 2); for (const [x, z] of r) flatXZ.push(x, z); }
    const idx = Earcut.triangulate(flatXZ, holes, 2);
    const v = (i) => [flatXZ[i * 2], y, flatXZ[i * 2 + 1]];
    for (let i = 0; i < idx.length; i += 3) this.tri(v(idx[i]), v(idx[i + 1]), v(idx[i + 2]), 0, 1, 0, seed);
  }
  // A ribbon along a polyline, each segment stretched by half its width so corners overlap.
  ribbon(points, width, y) {
    const hw = width / 2;
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1], [bx, bz] = points[i], len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05) continue;
      const dx = (bx - ax) / len, dz = (bz - az) / len, ex = dx * hw, ez = dz * hw, nx = -dz * hw, nz = dx * hw;
      const p0 = [ax - ex + nx, y, az - ez + nz], p1 = [ax - ex - nx, y, az - ez - nz], p2 = [bx + ex - nx, y, bz + ez - nz], p3 = [bx + ex + nx, y, bz + ez + nz];
      this.tri(p0, p1, p2, 0, 1, 0); this.tri(p0, p2, p3, 0, 1, 0);
    }
  }
  arrays() { return { position: new Float32Array(this.p), normal: new Float32Array(this.n), seed: new Float32Array(this.s) }; }
}

const open = (ring) => { const a = ring[0], b = ring.at(-1); return a[0] === b[0] && a[1] === b[1] ? ring.slice(0, -1) : ring; };
const signedArea = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };

// Real footprints, extruded: walls with outward normals plus a roof, one soup per façade family.
function extrude(tile) {
  const soups = new Map();
  for (const b of tile.buildings) {
    const rings = b.rings.map(open).filter((r) => r.length >= 3);
    if (!rings.length || Math.abs(signedArea(rings[0])) < 6) continue;
    const seed = b.objectId % 10007, f = familyFor(b.h, seed), top = BASE + b.h;
    if (!soups.has(f)) soups.set(f, new Soup());
    const s = soups.get(f);
    rings.forEach((r, k) => {
      // Outer ring: (dz, -dx) points out when the signed area is positive; holes face inward.
      const sign = (signedArea(r) > 0 ? 1 : -1) * (k === 0 ? 1 : -1);
      for (let i = 0; i < r.length; i++) {
        const [ax, az] = r[i], [bx, bz] = r[(i + 1) % r.length], len = Math.hypot(bx - ax, bz - az);
        if (len < 0.01) continue;
        const nx = (bz - az) / len * sign, nz = -(bx - ax) / len * sign;
        const a0 = [ax, BASE, az], b0 = [bx, BASE, bz], a1 = [ax, top, az], b1 = [bx, top, bz];
        s.tri(a0, b0, b1, nx, 0, nz, seed); s.tri(a0, b1, a1, nx, 0, nz, seed);
      }
    });
    s.flat(rings, top, seed);
  }
  return [...soups].map(([family, s]) => ({ family, ...s.arrays() }));
}

// Streets (sidewalk band under a carriageway), parks and water for a ground tile.
const ROAD_WIDTH = { 1: 22, 2: 13, 3: 11, 4: 8.5 };
function ground(tile) {
  const roads = new Soup(), walks = new Soup(), parks = new Soup(), water = new Soup();
  for (const s of tile.streets) { const w = ROAD_WIDTH[s.class] || 8.5; roads.ribbon(s.points, w, 0.16); if (s.class > 1) walks.ribbon(s.points, w + 6, 0.1); }
  for (const p of tile.parks) parks.flat(p.rings.map(open), 0.07);
  for (const p of tile.water) water.flat(p.rings.map(open), 0.04);
  const pick = ({ position, normal }) => ({ position, normal });
  return { roads: pick(roads.arrays()), walks: pick(walks.arrays()), parks: pick(parks.arrays()), water: pick(water.arrays()) };
}

const buffers = (o) => { const out = []; const walk = (v) => { if (ArrayBuffer.isView(v)) out.push(v.buffer); else if (v && typeof v === 'object') Object.values(v).forEach(walk); }; walk(o); return out; };

self.onmessage = async ({ data: { id, url, mode = 'boxes' } }) => {
  try {
    const tile = await load(url);
    const result = mode === 'real' ? { meshes: extrude(tile) } : mode === 'ground' ? { ground: ground(tile) } : boxes(tile);
    self.postMessage({ id, mode, kind: tile.kind, ...result }, buffers(result));
  } catch (e) {
    self.postMessage({ id, error: String(e?.message || e) });
  }
};
