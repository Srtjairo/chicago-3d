// Background thread for the streamed city: downloads a tile, inflates it, decodes it and turns
// it into typed arrays the main thread can upload to the GPU without further work.
// Module workers don't see the page's import map, so three's Earcut comes from its pinned URL.
import { decode, orientedBox, familyFor, familyOfStyle, roofOfStyle, frontOfStyle, twinOfStyle, ROOF_GABLE, ROOF_CORNICE, ROOF_CHURCH, ROOF_OPEN, ROOF_GREENHOUSE, ROOF_CUSTOM, FINISHED, RAIL_BRIDGE, RAIL_RAISED, SURF_YARD, SURF_PAVED, SURF_INDUSTRIAL, SURF_PARKING, SURF_PLAZA, PATH_ALLEY, TILE, SURF_LAWN, SURF_SAND, SURF_PRAIRIE, SURF_INFIELD, SURF_TENNIS, SURF_HARDCOURT, SURF_PLAY, SURF_POOL, SURF_VACANT, SURF_BALLAST, PATH_TRAIL, PATH_WALK, PATH_LINE, PATH_DOCK, PATH_RAMP, PATH_TREES, PATH_CLEAR, SURF_GARDEN, SURF_LAKE, PATH_SERVICE, PATH_TREE_POINTS, PATH_LAMP_POINTS, PARK_MAPPED_TREES } from './tile-format.js';
import { Earcut } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/src/extras/Earcut.js';

// Box instances, stride 8: x, z, width, depth, height, angle (atan2 dz,dx), seed, facade family.
export const BOX_STRIDE = 8;
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
  const list = tile.kind === 1 ? tile.boxes : tile.buildings.filter((b) => roofOfStyle(b.style) !== ROOF_CUSTOM).map((b) => ({ b, o: orientedBox(b.rings[0]) })).filter(({ o }) => o.w * o.d >= MIN_PROXY_AREA);
  const out = new Float32Array(list.length * BOX_STRIDE);
  list.forEach((item, i) => {
    const b = tile.kind === 1 ? item : item.b, o = tile.kind === 1 ? item : item.o;
    // Skyline tiles carry no ids; a position hash keeps each box's window pattern stable.
    const seed = tile.kind === 1 ? Math.abs(Math.round(b.x * 7 + b.z * 13)) % 10007 : b.objectId % 10007;
    const family = tile.kind === 1 ? familyFor(b.h, seed) : familyOfStyle(b.style);
    out.set([o.x, o.z, Math.max(o.w, 1), Math.max(o.d, 1), b.h, o.angle, seed, family], i * BOX_STRIDE);
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

// Walls of one ring from y0 to y1. Outer ring: (dz, -dx) points out when the signed area is
// positive; holes face inward. `each` sees every edge with its outward normal (for trims).
function walls(s, r, outer, y0, y1, seed, each) {
  const sign = (signedArea(r) > 0 ? 1 : -1) * (outer ? 1 : -1);
  for (let i = 0; i < r.length; i++) {
    const [ax, az] = r[i], [bx, bz] = r[(i + 1) % r.length], len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) continue;
    const nx = (bz - az) / len * sign, nz = -(bx - ax) / len * sign;
    s.tri([ax, y0, az], [bx, y0, bz], [bx, y1, bz], nx, 0, nz, seed); s.tri([ax, y0, az], [bx, y1, bz], [ax, y1, az], nx, 0, nz, seed);
    each?.(ax, az, bx, bz, nx, nz);
  }
}

// A cottage: the footprint's rectangle with walls to the eaves, two sloped roof planes and
// gable-end triangles; the ridge (at the measured height) runs along the long side. Returns
// false for footprints that aren't close to a rectangle, which then get a flat roof.
function gable(walls_, roofSoup, ring, h, seed, riseFrac = 0) {
  const o = orientedBox(ring);
  if (Math.abs(signedArea(ring)) < 0.85 * o.w * o.d || o.w < 3 || o.d < 3) return false;
  const c = Math.cos(o.angle), s = Math.sin(o.angle);
  // Long axis (ridge direction) L and across axis A, with half-lengths.
  let [Lx, Lz, hl, Ax, Az, ha] = o.w >= o.d ? [c, s, o.w / 2, -s, c, o.d / 2] : [-s, c, o.d / 2, c, s, o.w / 2];
  const top = BASE + h, rise = riseFrac ? h * riseFrac : Math.min(Math.max(ha * 0.75, 1.2), h * 0.45), eave = top - rise;
  const P = (l, a, y) => [o.x + Lx * l + Ax * a, y, o.z + Lz * l + Az * a];
  const box = [[-hl, -ha], [hl, -ha], [hl, ha], [-hl, ha]].map(([l, a]) => { const p = P(l, a, 0); return [p[0], p[2]]; });
  walls(walls_, box, true, BASE, eave, seed);
  // Gable ends (facade material) at both ends of the ridge.
  for (const l of [-hl, hl]) walls_.tri(P(l, -ha, eave), P(l, ha, eave), P(l, 0, top), Lx * Math.sign(l), 0, Lz * Math.sign(l), seed);
  // Roof planes, sloping down to each long side.
  const n = Math.hypot(rise, ha);
  for (const side of [-1, 1]) {
    const nx = Ax * side * rise / n, ny = ha / n, nz = Az * side * rise / n;
    const r0 = P(-hl, 0, top), r1 = P(hl, 0, top), e0 = P(-hl, side * ha, eave), e1 = P(hl, side * ha, eave);
    roofSoup.tri(r0, r1, e1, nx, ny, nz); roofSoup.tri(r0, e1, e0, nx, ny, nz);
  }
  return true;
}

// A church: the lidar height is the top of its tower(s), so the footprint rises only to the nave
// (about 40% of that), with a pitched roof along its long axis, and the tower(s) stand at the
// front end (`front`: 0 north, 1 east, 2 south, 3 west), reaching the measured height with a spire.
function church(s, roofSoup, rings, h, seed, front, twin) {
  const o = orientedBox(rings[0]), c = Math.cos(o.angle), sn = Math.sin(o.angle);
  const nave = Math.min(Math.max(h * 0.4, 12), 24), top = BASE + h, eave = BASE + nave * 0.78;
  rings.forEach((r, k) => walls(s, r, k === 0, BASE, eave, seed));
  s.flat(rings, eave, seed);
  let [Lx, Lz, hl, Ax, Az, ha] = o.w >= o.d ? [c, sn, o.w / 2, -sn, c, o.d / 2] : [-sn, c, o.d / 2, c, sn, o.w / 2];
  const P = (l, a, y) => [o.x + Lx * l + Ax * a, y, o.z + Lz * l + Az * a];
  // Pitched roof over the nave, a little inside the walls.
  const rl = hl * 0.96, ra = ha * 0.92, ridge = BASE + nave + Math.min(ha * 0.5, 8), n = Math.hypot(ridge - eave, ra);
  for (const side of [-1, 1]) roofSoup.tri(P(-rl, 0, ridge), P(rl, 0, ridge), P(rl, side * ra, eave), Ax * side * (ridge - eave) / n, ra / n, Az * side * (ridge - eave) / n), roofSoup.tri(P(-rl, 0, ridge), P(rl, side * ra, eave), P(-rl, side * ra, eave), Ax * side * (ridge - eave) / n, ra / n, Az * side * (ridge - eave) / n);
  for (const l of [-rl, rl]) s.tri(P(l, -ra, eave), P(l, ra, eave), P(l, 0, ridge), Lx * Math.sign(l), 0, Lz * Math.sign(l), seed);
  // Front end: the end of the long axis that best faces the given direction.
  const want = [[0, -1], [1, 0], [0, 1], [-1, 0]][front], end = Lx * want[0] + Lz * want[1] >= 0 ? 1 : -1;
  const side = Math.min(Math.max(ha * (twin ? 0.42 : 0.55), 5), 10), body = BASE + Math.max(nave + 4, h * 0.7);
  for (const a of twin ? [-(ha - side / 2), ha - side / 2] : [0]) {
    const cl = end * (hl - side / 2), sq = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => { const p = P(cl + u * side / 2, a + v * side / 2, 0); return [p[0], p[2]]; });
    walls(s, sq, true, BASE, body, seed);
    // Spire: a four-sided pyramid to the measured height.
    const apex = P(cl, a, top);
    for (let i = 0; i < 4; i++) {
      const p = sq[i], q = sq[(i + 1) % 4], mx = (p[0] + q[0]) / 2 - apex[0], mz = (p[1] + q[1]) / 2 - apex[2], ml = Math.hypot(mx, mz) || 1, rise = top - body, nn = Math.hypot(rise, ml);
      roofSoup.tri([p[0], body, p[1]], [q[0], body, q[1]], apex, mx / ml * rise / nn, ml / nn, mz / ml * rise / nn);
    }
  }
}

// An open-air stadium: outer walls to the measured height, a seating bowl sloping down and in,
// and a grass field in the middle (the bowl's inner edge is the footprint shrunk to 62%).
function stadium(s, seats, field, rings, h, seed) {
  const r = rings[0], cx = r.reduce((t, p) => t + p[0], 0) / r.length, cz = r.reduce((t, p) => t + p[1], 0) / r.length, top = BASE + h, low = BASE + 2.5;
  walls(s, r, true, BASE, top, seed);
  const inner = r.map(([x, z]) => [cx + (x - cx) * 0.62, cz + (z - cz) * 0.62]);
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], ai = inner[i], bi = inner[(i + 1) % r.length];
    const mx = (a[0] + b[0]) / 2 - cx, mz = (a[1] + b[1]) / 2 - cz, ml = Math.hypot(mx, mz) || 1;
    seats.tri([a[0], top, a[1]], [b[0], top, b[1]], [bi[0], low, bi[1]], -mx / ml * 0.6, 0.8, -mz / ml * 0.6);
    seats.tri([a[0], top, a[1]], [bi[0], low, bi[1]], [ai[0], low, ai[1]], -mx / ml * 0.6, 0.8, -mz / ml * 0.6);
  }
  field.flat([inner], low);
}

// A parapet cornice around a flat roof: an outward band and its top cap.
function cornice(trim, ax, az, bx, bz, nx, nz, top) {
  const o = 0.3, y0 = top - 0.8, y1 = top + 0.35, ox = nx * o, oz = nz * o;
  const a = [ax + ox, y0, az + oz], b = [bx + ox, y0, bz + oz], a1 = [ax + ox, y1, az + oz], b1 = [bx + ox, y1, bz + oz];
  trim.tri(a, b, b1, nx, 0, nz); trim.tri(a, b1, a1, nx, 0, nz);
  trim.tri([ax, y1, az], a1, b1, 0, 1, 0); trim.tri([ax, y1, az], b1, [bx, y1, bz], 0, 1, 0);
}

// Real footprints, extruded: walls plus a roof (flat, flat with a cornice, or a cottage gable),
// one soup per facade family, plus shared 'roof' (shingles) and 'trim' (cornices) soups.
function extrude(tile) {
  const soups = new Map(), get = (k) => { if (!soups.has(k)) soups.set(k, new Soup()); return soups.get(k); };
  for (const b of tile.buildings) {
    const rings = b.rings.map(open).filter((r) => r.length >= 3);
    if (!rings.length || Math.abs(signedArea(rings[0])) < 6) continue;
    const seed = b.objectId % 10007, roof = roofOfStyle(b.style), top = BASE + b.h, s = get(familyOfStyle(b.style));
    if (roof === ROOF_CUSTOM) continue; // drawn by its own model
    if (roof === ROOF_GABLE && rings.length === 1 && gable(s, get('roof'), rings[0], b.h, seed)) continue;
    if (roof === ROOF_CHURCH) { church(s, get('roof'), rings, b.h, seed, frontOfStyle(b.style), twinOfStyle(b.style)); continue; }
    if (roof === ROOF_OPEN) { stadium(s, get('seats'), get('field'), rings, b.h, seed); continue; }
    if (roof === ROOF_GREENHOUSE && rings.length === 1 && gable(s, get('glassroof'), rings[0], b.h, seed, 0.55)) continue;
    const trim = roof === ROOF_CORNICE ? get('trim') : null;
    rings.forEach((r, k) => walls(s, r, k === 0, BASE, top, seed, trim && k === 0 ? (ax, az, bx, bz, nx, nz) => cornice(trim, ax, az, bx, bz, nx, nz, top) : null));
    s.flat(rings, top, seed);
  }
  return [...soups].map(([family, s]) => ({ family, ...s.arrays() }));
}

// ---------- Street trees, lamps and park trees (finished neighborhoods only) ----------
// Made with a tile's real footprints (so they come and go with the near ring), from the streets
// and parks of the ground tile that contains it. Deterministic: the same tile always gets the
// same trees.
const groundCache = new Map();
function groundTile(url) {
  if (!groundCache.has(url)) { groundCache.set(url, load(url)); if (groundCache.size > 4) groundCache.delete(groundCache.keys().next().value); }
  return groundCache.get(url);
}
const rng = (seed) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const inRing = (x, z, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
// Footprints (and water) as a 25 m grid of bounding boxes, to keep trees out of buildings.
function blockers(polys) {
  const grid = new Map(), key = (i, j) => i * 100003 + j;
  for (const rings of polys) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of rings[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const item = { rings, x0: x0 - 1.5, x1: x1 + 1.5, z0: z0 - 1.5, z1: z1 + 1.5 };
    for (let i = Math.floor(item.x0 / 25); i <= Math.floor(item.x1 / 25); i++) for (let j = Math.floor(item.z0 / 25); j <= Math.floor(item.z1 / 25); j++) { const k = key(i, j); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(item); }
  }
  return (x, z) => (grid.get(key(Math.floor(x / 25), Math.floor(z / 25))) || []).some((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && inRing(x, z, b.rings[0]));
}
// Points every `step` metres along a polyline, `skip` metres clear of both ends (intersections).
function along(points, step, skip, jitter, rand, fn) {
  const segs = []; let total = 0;
  for (let i = 1; i < points.length; i++) { const [ax, az] = points[i - 1], [bx, bz] = points[i], l = Math.hypot(bx - ax, bz - az); if (l > 0.01) { segs.push([ax, az, bx, bz, l, total]); total += l; } }
  for (let d = skip + rand() * step * 0.5; d < total - skip; d += step * (1 - jitter + rand() * 2 * jitter)) {
    const s = segs.find((g) => d <= g[5] + g[4]); if (!s) break;
    const t = (d - s[5]) / s[4], dx = (s[2] - s[0]) / s[4], dz = (s[3] - s[1]) / s[4];
    fn(s[0] + (s[2] - s[0]) * t, s[1] + (s[3] - s[1]) * t, dx, dz);
  }
}
function decorate(tile, ground) {
  const x0 = tile.tx * TILE, z0 = tile.tz * TILE, inTile = (x, z) => x >= x0 && x < x0 + TILE && z >= z0 && z < z0 + TILE;
  const blocked = blockers([...tile.buildings.map((b) => b.rings.map(open)), ...ground.water.map((w) => w.rings.map(open)), ...ground.surfaces.filter((s) => s.kind === SURF_LAKE).map((s) => s.rings.map(open))]);
  const trees = [], lamps = [], parked = [], lanes = { pts: [], counts: [] }, walks = { pts: [], counts: [] };
  const line = (into, pts) => { into.counts.push(pts.length); for (const [x, z] of pts) into.pts.push(x, z); };
  // A polyline shifted sideways (positive = to the right of travel; x east, z south).
  const shift = (pts, off) => pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [p[0] - dz / l * off, p[1] + dx / l * off]; });
  for (const s of ground.streets) {
    const m = s.points[Math.floor(s.points.length / 2)];
    if (!(s.flags & FINISHED) || !inTile(m[0], m[1]) || s.class === 1) continue;
    const w = ROAD_WIDTH[s.class] || 8.5, rand = rng(Math.round(m[0] * 31 + m[1] * 17) >>> 0);
    // Driving lanes (right-hand traffic, respecting one-way streets) and both sidewalks.
    // Moving lanes stay clear of the parked cars along each curb.
    const lane = s.class === 4 ? 1.3 : s.class === 3 ? w / 4 - 0.4 : w / 4;
    if (s.dir !== 'T') line(lanes, shift(s.points, lane));
    if (s.dir !== 'F') line(lanes, shift([...s.points].reverse(), lane));
    // Parked cars along both curbs, about 60% of the spaces, clear of the corners.
    for (const side of [-1, 1]) along(s.points, 6.5, 12, 0.08, rand, (x, z, dx, dz) => {
      if (rand() > 0.6) return;
      parked.push(x - dz * side * (w / 2 - 1.05), z + dx * side * (w / 2 - 1.05), Math.atan2(dx, dz) + (side < 0 ? Math.PI : 0), Math.floor(rand() * 9));
    });
    const sw = s.class >= 3 ? w / 2 + 3.5 : w / 2 + 1.8; // beyond the parkway on residential streets
    line(walks, shift(s.points, sw)); line(walks, shift(s.points, -sw));
    // Parkway trees on both sides of collectors and local streets; arterials get fewer.
    for (const side of [-1, 1]) along(s.points, s.class === 2 ? 16 : 10, 12, 0.2, rand, (x, z, dx, dz) => {
      // Fewer on busy streets, where storefronts meet the sidewalk.
      if ((s.class === 2 && rand() < 0.65) || (s.class === 3 && rand() < 0.4)) return;
      const px = x - dz * side * (w / 2 + 1.3), pz = z + dx * side * (w / 2 + 1.3);
      if (!blocked(px, pz)) trees.push(px, pz, 0.7 + rand() * 0.55, Math.floor(rand() * 1000));
    });
    // Lamps: staggered on both sides of arterials and collectors, one side of local streets.
    for (const side of s.class === 4 ? [1] : [-1, 1]) along(s.points, s.class === 4 ? 42 : 34, side > 0 ? 6 : 23, 0.05, rand, (x, z, dx, dz) => {
      const px = x - dz * side * (w / 2 + 0.6), pz = z + dx * side * (w / 2 + 0.6);
      if (!blocked(px, pz)) lamps.push(px, pz, Math.atan2(dx * side, dz * side));
    });
  }
  // Streets, paths and ramps (with their sidewalks) keep trees off them.
  const roadGrid = new Map(), RG = 40, rkey = (i, j) => i * 100003 + j;
  const addSeg = (a, b, half) => { for (let i = Math.floor((Math.min(a[0], b[0]) - half) / RG); i <= Math.floor((Math.max(a[0], b[0]) + half) / RG); i++) for (let j = Math.floor((Math.min(a[1], b[1]) - half) / RG); j <= Math.floor((Math.max(a[1], b[1]) + half) / RG); j++) { const k = rkey(i, j); if (!roadGrid.has(k)) roadGrid.set(k, []); roadGrid.get(k).push([a, b, half]); } };
  for (const s of ground.streets) for (let i = 1; i < s.points.length; i++) addSeg(s.points[i - 1], s.points[i], (ROAD_WIDTH[s.class] || 8.5) / 2 + 5);
  const CLEAR = { [PATH_ALLEY]: 3.5, [PATH_TRAIL]: 5, [PATH_WALK]: 3, [PATH_RAMP]: 8, [PATH_CLEAR]: 13, [PATH_SERVICE]: 5 };
  // Yards don't grow trees inside parks (parks grow their own, or have them mapped).
  const parkLand = blockers(ground.parks.map((p) => p.rings.map(open)));
  for (const p of ground.paths) if (CLEAR[p.kind]) for (let i = 1; i < p.points.length; i++) addSeg(p.points[i - 1], p.points[i], CLEAR[p.kind]);
  const nearRoad = (x, z) => (roadGrid.get(rkey(Math.floor(x / RG), Math.floor(z / RG))) || []).some(([a, b, half]) => { const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) < half; });
  // Trees grow in yards and on park lawns: never on lots, paving, plazas, sports fields, courts,
  // beaches, prairie, rail ballast or vacant gravel.
  const NO_TREES = new Set([SURF_PARKING, SURF_PAVED, SURF_INDUSTRIAL, SURF_PLAZA, SURF_LAWN, SURF_SAND, SURF_PRAIRIE, SURF_INFIELD, SURF_TENNIS, SURF_HARDCOURT, SURF_PLAY, SURF_POOL, SURF_VACANT, SURF_BALLAST, SURF_GARDEN]);
  const lots = blockers(ground.surfaces.filter((s) => NO_TREES.has(s.kind)).map((s) => s.rings.map(open)));
  // Park trees grow in groves, with open lawns between them: a jittered 11 m grid thinned by a
  // smooth 90 m noise field (dense where it is high, a lone tree here and there where it is low).
  const hash2 = (i, j) => { let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const noise = (x, z) => { const S = 90, i = Math.floor(x / S), j = Math.floor(z / S), u = x / S - i, v = z / S - j, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    return (hash2(i, j) * (1 - su) + hash2(i + 1, j) * su) * (1 - sv) + (hash2(i, j + 1) * (1 - su) + hash2(i + 1, j + 1) * su) * sv; };
  for (const p of ground.parks) {
    if (!(p.flags & FINISHED) || p.flags & PARK_MAPPED_TREES) continue;
    const r = p.rings.map(open), o = r[0];
    let ax = Infinity, bx = -Infinity, az = Infinity, bz = -Infinity;
    for (const [x, z] of o) { ax = Math.min(ax, x); bx = Math.max(bx, x); az = Math.min(az, z); bz = Math.max(bz, z); }
    if (!inTile((ax + bx) / 2, (az + bz) / 2)) continue;
    const rand = rng(Math.round(ax * 13 + az * 7) >>> 0);
    for (let x = ax + 5; x < bx; x += 11) for (let z = az + 5; z < bz; z += 11) {
      const n = noise(x, z), keep = 0.06 + 0.85 * Math.min(1, Math.max(0, (n - 0.4) / 0.3));
      if (rand() > keep) continue;
      const px = x + (rand() - 0.5) * 9, pz = z + (rand() - 0.5) * 9;
      if (inRing(px, pz, o) && !r.slice(1).some((h) => inRing(px, pz, h)) && !blocked(px, pz) && !lots(px, pz) && !nearRoad(px, pz)) trees.push(px, pz, 0.8 + rand() * 0.7, Math.floor(rand() * 1000));
    }
  }
  // Savanna on the prairie: a few trees, mostly in loose clumps.
  for (const s of ground.surfaces) {
    if (s.kind !== SURF_PRAIRIE) continue;
    const r = s.rings.map(open), o = r[0];
    let ax = Infinity, bx = -Infinity, az = Infinity, bz = -Infinity;
    for (const [x, z] of o) { ax = Math.min(ax, x); bx = Math.max(bx, x); az = Math.min(az, z); bz = Math.max(bz, z); }
    if (!inTile((ax + bx) / 2, (az + bz) / 2)) continue;
    const rand = rng(Math.round(ax * 11 + az * 5) >>> 0);
    for (let x = ax + 7; x < bx; x += 14) for (let z = az + 7; z < bz; z += 14) {
      const keep = 0.03 + 0.62 * Math.min(1, Math.max(0, (noise(x * 1.7, z * 1.7) - 0.55) / 0.25));
      if (rand() > keep) continue;
      const px = x + (rand() - 0.5) * 10, pz = z + (rand() - 0.5) * 10;
      if (inRing(px, pz, o) && !r.slice(1).some((h) => inRing(px, pz, h)) && !blocked(px, pz) && !nearRoad(px, pz)) trees.push(px, pz, 0.7 + rand() * 0.6, Math.floor(rand() * 1000));
    }
  }
  // Rows of trees (allées along lawns and walks), and boats moored at the harbor docks.
  const boats = [];
  for (const p of ground.paths) {
    const m = p.points[Math.floor(p.points.length / 2)];
    if (!inTile(m[0], m[1])) continue;
    const rand = rng(Math.round(m[0] * 17 + m[1] * 29) >>> 0);
    if (p.kind === PATH_LAMP_POINTS) { for (const [x, z] of p.points) if (inTile(x, z) && !blocked(x, z)) lamps.push(x, z, Math.floor(rand() * 4) * Math.PI / 2); }
    else if (p.kind === PATH_TREE_POINTS) { for (const [x, z] of p.points) if (inTile(x, z) && !blocked(x, z)) trees.push(x, z, 0.75 + rand() * 0.6, Math.floor(rand() * 1000)); }
    else if (p.kind === PATH_TREES) along(p.points, 11, 2, 0.06, rand, (x, z) => { if (!blocked(x, z)) trees.push(x, z, 0.85 + rand() * 0.35, Math.floor(rand() * 1000)); });
    else if (p.kind === PATH_DOCK) for (let i = 1; i < p.points.length; i++) {
      // A boat moored along each finger pier (segments 6 to 22 m long), most slips taken.
      const [ax, az] = p.points[i - 1], [bx, bz] = p.points[i], len = Math.hypot(bx - ax, bz - az);
      if (len < 6 || len > 22 || rand() > 0.72) continue;
      const dx = (bx - ax) / len, dz = (bz - az) / len, k = 0.7 + rand() * 0.6;
      boats.push(ax + dx * len * 0.55 + dz * 3.4, az + dz * len * 0.55 - dx * 3.4, Math.atan2(dx, dz), k);
    }
  }
  // Backyard trees: a jittered 16 m grid over the yards, about 40% kept, clear of buildings,
  // water, parking lots, alleys and streets (with their sidewalks).
  for (const s of ground.surfaces) {
    if (s.kind !== SURF_YARD) continue;
    const r = s.rings.map(open), o = r[0];
    let ax = Infinity, bx = -Infinity, az = Infinity, bz = -Infinity;
    for (const [x, z] of o) { ax = Math.min(ax, x); bx = Math.max(bx, x); az = Math.min(az, z); bz = Math.max(bz, z); }
    if (!inTile((ax + bx) / 2, (az + bz) / 2)) continue;
    const rand = rng(Math.round(ax * 7 + az * 11) >>> 0);
    for (let x = ax + 8; x < bx; x += 16) for (let z = az + 8; z < bz; z += 16) {
      if (rand() < 0.6) continue;
      const px = x + (rand() - 0.5) * 12, pz = z + (rand() - 0.5) * 12;
      if (inRing(px, pz, o) && !r.slice(1).some((h) => inRing(px, pz, h)) && !blocked(px, pz) && !lots(px, pz) && !parkLand(px, pz) && !nearRoad(px, pz)) trees.push(px, pz, 0.6 + rand() * 0.6, Math.floor(rand() * 1000));
    }
  }
  // Footprints for Mini Fellow's collisions (outer ring and height), plus raised rail embankments.
  const solids = { pts: [], counts: [] }, heights = [];
  for (const b of tile.buildings) { const r = open(b.rings[0]); if (r.length >= 3) { line(solids, r); heights.push(b.h + 0.6); } }
  for (const rl of ground.rails) {
    if (!(rl.flags & FINISHED) || !(rl.flags & RAIL_RAISED) || rl.flags & RAIL_BRIDGE) continue;
    for (let i = 1; i < rl.points.length; i++) {
      const [ax, az] = rl.points[i - 1], [bx, bz] = rl.points[i], len = Math.hypot(bx - ax, bz - az);
      if (len < 0.5 || !inTile((ax + bx) / 2, (az + bz) / 2)) continue;
      const nx = -(bz - az) / len * 5, nz = (bx - ax) / len * 5;
      line(solids, [[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]]); heights.push(6.7);
    }
  }
  const pack = (l) => ({ pts: new Float32Array(l.pts), counts: new Uint16Array(l.counts) });
  return { trees: new Float32Array(trees), lamps: new Float32Array(lamps), parked: new Float32Array(parked), boats: new Float32Array(boats), lanes: pack(lanes), walks: pack(walks), solids: pack(solids), heights: new Float32Array(heights) };
}

// A main-line railway: at grade a ballast bed; raised, an earth embankment (sloped sides) or a
// steel viaduct deck that streets pass under; two tracks on top.
const RAIL_TOP = 6.2;
function railway(r, fill, steel, track, wall) {
  const raised = r.flags & RAIL_RAISED, bridge = r.flags & RAIL_BRIDGE, y = raised ? RAIL_TOP : 0.22;
  for (let i = 1; i < r.points.length; i++) {
    const [ax, az] = r.points[i - 1], [bx, bz] = r.points[i], len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    const dx = (bx - ax) / len, dz = (bz - az) / len, nx = -dz, nz = dx, ex = dx * 0.6, ez = dz * 0.6;
    const at = (x, z, off, h) => [x + nx * off, h, z + nz * off];
    const quad = (s, p0, p1, p2, p3, ux, uy, uz) => { s.tri(p0, p1, p2, ux, uy, uz); s.tri(p0, p2, p3, ux, uy, uz); };
    const A = [ax - ex, az - ez], B = [bx + ex, bz + ez];
    if (raised && !bridge) {
      // Embankment between concrete retaining walls (10 m wide), closed at both ends by abutments.
      quad(fill, at(...A, -5, y), at(...A, 5, y), at(...B, 5, y), at(...B, -5, y), 0, 1, 0);
      for (const s of [-1, 1]) quad(wall, at(...A, s * 5, 0), at(...A, s * 5, y + 0.5), at(...B, s * 5, y + 0.5), at(...B, s * 5, 0), nx * s, 0, nz * s);
      if (i === 1) quad(wall, at(...A, -5, 0), at(...A, 5, 0), at(...A, 5, y), at(...A, -5, y), -dx, 0, -dz);
      if (i === r.points.length - 1) quad(wall, at(...B, -5, 0), at(...B, 5, 0), at(...B, 5, y), at(...B, -5, y), dx, 0, dz);
    } else if (bridge) {
      // Viaduct deck: 1 m thick slab with plate-girder sides.
      quad(steel, at(...A, -4.5, y), at(...A, 4.5, y), at(...B, 4.5, y), at(...B, -4.5, y), 0, 1, 0);
      quad(steel, at(...A, -4.5, y - 1.6), at(...A, 4.5, y - 1.6), at(...B, 4.5, y - 1.6), at(...B, -4.5, y - 1.6), 0, -1, 0);
      for (const s of [-1, 1]) quad(steel, at(...A, s * 4.5, y - 1.6), at(...A, s * 4.5, y + 0.9), at(...B, s * 4.5, y + 0.9), at(...B, s * 4.5, y - 1.6), nx * s, 0, nz * s);
    } else quad(fill, at(...A, -4.5, y), at(...A, 4.5, y), at(...B, 4.5, y), at(...B, -4.5, y), 0, 1, 0);
    // Two tracks.
    for (const off of [-2, 2]) quad(track, at(...A, off - 0.8, y + 0.08), at(...A, off + 0.8, y + 0.08), at(...B, off + 0.8, y + 0.08), at(...B, off - 0.8, y + 0.08), 0, 1, 0);
  }
}

// Streets (sidewalk band under a carriageway), parks and water for a ground tile.
const ROAD_WIDTH = { 1: 22, 2: 13, 3: 11, 4: 8.5 };
function ground(tile) {
  const roads = new Soup(), walks = new Soup(), parks = new Soup(), water = new Soup(), lines = new Soup(), fill = new Soup(), steel = new Soup(), track = new Soup(), wall = new Soup();
  for (const r of tile.rails) if (r.flags & FINISHED) railway(r, fill, steel, track, wall);
  // Ground cover in finished neighborhoods: yards (grass), paved and industrial land, parking
  // lots and alleys, all below the sidewalks.
  const yard = new Soup(), paved = new Soup(), industrial = new Soup(), parking = new Soup(), alley = new Soup(), parkway = new Soup(), plaza = new Soup();
  const lawn = new Soup(), sand = new Soup(), prairie = new Soup(), infield = new Soup(), tennis = new Soup(), hardcourt = new Soup(), play = new Soup(), pool = new Soup(), vacant = new Soup(), ballast = new Soup();
  const trail = new Soup(), parkwalk = new Soup(), fieldlines = new Soup(), dock = new Soup(), garden = new Soup(), lake = new Soup();
  // Heights above the land: yards, then park lawns, then paving; explicit park features above those.
  const cover = { [SURF_YARD]: [yard, 0.03], [SURF_PAVED]: [paved, 0.04], [SURF_INDUSTRIAL]: [industrial, 0.045], [SURF_VACANT]: [vacant, 0.046], [SURF_BALLAST]: [ballast, 0.047],
    [SURF_PLAZA]: [plaza, 0.05], [SURF_LAWN]: [lawn, 0.055], [SURF_PRAIRIE]: [prairie, 0.056], [SURF_SAND]: [sand, 0.057], [SURF_GARDEN]: [garden, 0.06], [SURF_LAKE]: [lake, 0.12],
    [SURF_INFIELD]: [infield, 0.07], [SURF_TENNIS]: [tennis, 0.07], [SURF_HARDCOURT]: [hardcourt, 0.07], [SURF_PLAY]: [play, 0.07], [SURF_POOL]: [pool, 0.075], [SURF_PARKING]: [parking, 0.085] };
  for (const s of tile.surfaces) { const [soup, y] = cover[s.kind] || []; if (soup) soup.flat(s.rings.map(open), y); }
  for (const p of tile.paths) {
    if (p.kind === PATH_ALLEY) alley.ribbon(p.points, 4.6, 0.085);
    else if (p.kind === PATH_TRAIL) trail.ribbon(p.points, 5, 0.09);
    else if (p.kind === PATH_WALK) parkwalk.ribbon(p.points, 3.5, 0.09);
    else if (p.kind === PATH_LINE) fieldlines.ribbon(p.points, 0.22, 0.095);
    else if (p.kind === PATH_DOCK) dock.ribbon(p.points, p.points.length > 2 || Math.hypot(p.points[1][0] - p.points[0][0], p.points[1][1] - p.points[0][1]) > 20 ? 2.4 : 1.2, 0.55);
    else if (p.kind === PATH_RAMP) { walks.ribbon(p.points, 10, 0.1); roads.ribbon(p.points, 7.5, 0.155); }
    else if (p.kind === PATH_SERVICE) roads.ribbon(p.points, 5.5, 0.15);
  }
  for (const s of tile.streets) {
    const w = ROAD_WIDTH[s.class] || 8.5; roads.ribbon(s.points, w, 0.16);
    // Residential streets in finished neighborhoods: a grass parkway (with the street trees)
    // between the curb and a sidewalk, Chicago-style. Elsewhere a plain sidewalk band.
    if (s.flags & FINISHED && s.class >= 3) { walks.ribbon(s.points, w + 9, 0.1); parkway.ribbon(s.points, w + 5, 0.11); }
    else if (s.class > 1) walks.ribbon(s.points, w + 6, 0.1);
    // Yellow centre line on finished arterials and collectors.
    if (s.flags & FINISHED && (s.class === 2 || s.class === 3)) lines.ribbon(s.points, 0.35, 0.2);
  }
  // Water sits above park lawns, so lagoons and ponds inside parks show.
  for (const p of tile.parks) parks.flat(p.rings.map(open), 0.035);
  for (const p of tile.water) water.flat(p.rings.map(open), 0.12);
  const pick = ({ position, normal }) => ({ position, normal });
  return { roads: pick(roads.arrays()), walks: pick(walks.arrays()), parks: pick(parks.arrays()), water: pick(water.arrays()), lines: pick(lines.arrays()), fill: pick(fill.arrays()), steel: pick(steel.arrays()), track: pick(track.arrays()), wall: pick(wall.arrays()),
    yard: pick(yard.arrays()), paved: pick(paved.arrays()), industrial: pick(industrial.arrays()), parking: pick(parking.arrays()), alley: pick(alley.arrays()), parkway: pick(parkway.arrays()), plaza: pick(plaza.arrays()),
    lawn: pick(lawn.arrays()), sand: pick(sand.arrays()), prairie: pick(prairie.arrays()), infield: pick(infield.arrays()), tennis: pick(tennis.arrays()), hardcourt: pick(hardcourt.arrays()), play: pick(play.arrays()), pool: pick(pool.arrays()),
    vacant: pick(vacant.arrays()), ballast: pick(ballast.arrays()), trail: pick(trail.arrays()), parkwalk: pick(parkwalk.arrays()), fieldlines: pick(fieldlines.arrays()), dock: pick(dock.arrays()), garden: pick(garden.arrays()), lake: pick(lake.arrays()) };
}

const buffers = (o) => { const out = []; const walk = (v) => { if (ArrayBuffer.isView(v)) out.push(v.buffer); else if (v && typeof v === 'object') Object.values(v).forEach(walk); }; walk(o); return out; };

self.onmessage = async ({ data: { id, url, mode = 'boxes', ground: groundUrl } }) => {
  try {
    const tile = await load(url);
    const result = mode === 'real' ? { meshes: extrude(tile), decor: groundUrl ? decorate(tile, await groundTile(groundUrl)) : null } : mode === 'ground' ? { ground: ground(tile) } : boxes(tile);
    self.postMessage({ id, mode, kind: tile.kind, ...result }, buffers(result));
  } catch (e) {
    self.postMessage({ id, error: String(e?.message || e) });
  }
};
