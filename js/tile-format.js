// Binary tile format for the streamed city ("CHT1"). Shared by tools/build-tiles.mjs (writer),
// js/tile-worker.js (reader) and the checks, so encoder and decoder can't drift apart.
//
// A tile file is gzip(stream). The stream is 4 magic bytes followed by unsigned LEB128 varints;
// signed values are zig-zag encoded. Coordinates are decimetres. Each polyline/ring stores its
// first point relative to the tile origin and every later point relative to the previous one.
//
//   magic 'CHT1', version, kind, tx, tz (zig-zag), counts...
//   kind 0 (detail, one per 1 km tile):
//     buildings: objectId, part, h_dm, flags, nRings, per ring: n, points
//     streets:   class, dir(0 two-way,1 F,2 T), levelFrom+8, levelTo+8, n, points
//     water:     nRings, rings          parks: parkIndex, nRings, rings
//   kind 1 (skyline, one per 4 km tile): boxes: cx, cz, w, d (dm), h_dm, angle (0..255 → 0..255/256·π)

export const MAGIC = [67, 72, 84, 49]; // 'CHT1'
export const VERSION = 1;
export const TILE = 1000, SKY = 4000; // metres
export const FLAG_ESTIMATED = 1, FLAG_SPIKE = 2, FLAG_OVERRIDE = 4;
const DIRS = { '': 0, B: 0, F: 1, T: 2 };

export class Writer {
  constructor() { this.buf = new Uint8Array(1 << 16); this.n = 0; }
  byte(b) { if (this.n === this.buf.length) { const g = new Uint8Array(this.buf.length * 2); g.set(this.buf); this.buf = g; } this.buf[this.n++] = b; }
  u(v) { if (!(v >= 0) || !Number.isFinite(v)) throw new Error('bad varint ' + v); v = Math.floor(v); while (v >= 128) { this.byte((v % 128) | 128); v = Math.floor(v / 128); } this.byte(v); }
  s(v) { v = Math.round(v); this.u(v < 0 ? -2 * v - 1 : 2 * v); }
  points(pts, ox, oz) { this.u(pts.length); let px = ox, pz = oz; for (const [x, z] of pts) { const qx = Math.round(x * 10), qz = Math.round(z * 10); this.s(qx - px); this.s(qz - pz); px = qx; pz = qz; } }
  bytes() { return this.buf.slice(0, this.n); }
}

export class Reader {
  constructor(bytes) { this.b = bytes; this.i = 0; }
  u() { let v = 0, m = 1, c; do { c = this.b[this.i++]; v += (c & 127) * m; m *= 128; } while (c & 128); return v; }
  s() { const v = this.u(); return v % 2 ? -(v + 1) / 2 : v / 2; }
  points(ox, oz) { const n = this.u(), out = new Array(n); let x = ox, z = oz; for (let k = 0; k < n; k++) { x += this.s(); z += this.s(); out[k] = [x / 10, z / 10]; } return out; }
  get done() { return this.i >= this.b.length; }
}

function header(w, kind, tx, tz) { for (const b of MAGIC) w.byte(b); w.u(VERSION); w.u(kind); w.s(tx); w.s(tz); }

// tile = { tx, tz, buildings:[{objectId,part,h,flags,rings}], streets:[{class,dir,level,points}], water:[{rings}], parks:[{park,rings}] }
export function encodeDetail(tile) {
  const w = new Writer(), ox = tile.tx * TILE * 10, oz = tile.tz * TILE * 10;
  header(w, 0, tile.tx, tile.tz);
  w.u(tile.buildings.length); w.u(tile.streets.length); w.u(tile.water.length); w.u(tile.parks.length);
  for (const b of tile.buildings) { w.u(b.objectId); w.u(b.part); w.u(Math.round(b.h * 10)); w.u(b.flags); w.u(b.rings.length); for (const r of b.rings) w.points(r, ox, oz); }
  for (const s of tile.streets) { w.u(s.class); w.u(DIRS[s.dir] ?? 0); w.u((s.level?.[0] ?? 0) + 8); w.u((s.level?.[1] ?? 0) + 8); w.points(s.points, ox, oz); }
  for (const p of tile.water) { w.u(p.rings.length); for (const r of p.rings) w.points(r, ox, oz); }
  for (const p of tile.parks) { w.u(p.park); w.u(p.rings.length); for (const r of p.rings) w.points(r, ox, oz); }
  return w.bytes();
}

// tile = { sx, sz, boxes:[{x,z,w,d,h,angle}] }
export function encodeSkyline(tile) {
  const w = new Writer(), ox = tile.sx * SKY * 10, oz = tile.sz * SKY * 10;
  header(w, 1, tile.sx, tile.sz);
  w.u(tile.boxes.length);
  for (const b of tile.boxes) { w.s(Math.round(b.x * 10) - ox); w.s(Math.round(b.z * 10) - oz); w.u(Math.round(b.w * 10)); w.u(Math.round(b.d * 10)); w.u(Math.round(b.h * 10)); w.u(Math.round(((b.angle % Math.PI) + Math.PI) % Math.PI / Math.PI * 256) % 256); }
  return w.bytes();
}

export function decode(bytes) {
  for (let k = 0; k < 4; k++) if (bytes[k] !== MAGIC[k]) throw new Error('Not a CHT1 tile');
  const r = new Reader(bytes); r.i = 4;
  const version = r.u(); if (version !== VERSION) throw new Error('Unsupported tile version ' + version);
  const kind = r.u(), tx = r.s(), tz = r.s();
  if (kind === 1) {
    const ox = tx * SKY * 10, oz = tz * SKY * 10, n = r.u(), boxes = new Array(n);
    for (let k = 0; k < n; k++) boxes[k] = { x: (r.s() + ox) / 10, z: (r.s() + oz) / 10, w: r.u() / 10, d: r.u() / 10, h: r.u() / 10, angle: r.u() / 256 * Math.PI };
    return { kind, sx: tx, sz: tz, boxes };
  }
  const ox = tx * TILE * 10, oz = tz * TILE * 10;
  const nb = r.u(), ns = r.u(), nw = r.u(), np = r.u();
  const buildings = new Array(nb), streets = new Array(ns), water = new Array(nw), parks = new Array(np);
  const rings = () => { const n = r.u(), out = new Array(n); for (let k = 0; k < n; k++) out[k] = r.points(ox, oz); return out; };
  for (let k = 0; k < nb; k++) buildings[k] = { objectId: r.u(), part: r.u(), h: r.u() / 10, flags: r.u(), rings: rings() };
  for (let k = 0; k < ns; k++) streets[k] = { class: r.u(), dir: ['', 'F', 'T'][r.u()], level: [r.u() - 8, r.u() - 8], points: r.points(ox, oz) };
  for (let k = 0; k < nw; k++) water[k] = { rings: rings() };
  for (let k = 0; k < np; k++) parks[k] = { park: r.u(), rings: rings() };
  if (!r.done) throw new Error('Trailing bytes in tile');
  return { kind, tx, tz, buildings, streets, water, parks };
}

// Oriented bounding box of a footprint ring, aligned with its longest edge.
// Returns centre, width (along that edge), depth and the edge angle atan2(dz, dx).
export function orientedBox(ring) {
  let best = 0, angle = 0;
  for (let i = 0; i < ring.length - 1; i++) { const dx = ring[i + 1][0] - ring[i][0], dz = ring[i + 1][1] - ring[i][1], l = dx * dx + dz * dz; if (l > best) { best = l; angle = Math.atan2(dz, dx); } }
  const c = Math.cos(angle), s = Math.sin(angle);
  let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
  for (const [x, z] of ring) { const u = x * c + z * s, w = -x * s + z * c; if (u < u0) u0 = u; if (u > u1) u1 = u; if (w < w0) w0 = w; if (w > w1) w1 = w; }
  const uc = (u0 + u1) / 2, wc = (w0 + w1) / 2;
  return { x: uc * c - wc * s, z: uc * s + wc * c, w: u1 - u0, d: w1 - w0, angle };
}

export const tileOf = (x, z, size = TILE) => [Math.floor(x / size), Math.floor(z / size)];
export const tileKey = (tx, tz) => tx + '_' + tz;
