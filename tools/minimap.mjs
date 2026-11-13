// Renders the bird's-eye map of the explorable circle (shown in the top-right corner of the page)
// from the same data as the 3D city: every building footprint, streets, parks, rivers, the city
// limits and the lake. Output is a palette PNG, transparent outside the circle.
//   used by tools/build-tiles.mjs
import { deflateSync } from 'node:zlib';

const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
// Base colours; every entry also gets a darker "in shadow" twin.
const BASE = {
  lake: 0x2d5a6b, land: 0x74776f, yard: 0x56713f, paved: 0x8a877f, industrial: 0x6f6b62, parking: 0x4a4e51, park: 0x62844e, river: 0x2f6676, street: 0x43484c, expressway: 0x34393d,
  b0: 0x9a7b66, b1: 0xa98a70, b2: 0xb7a089, b3: 0xc3b29b, b4: 0xcfc5b4, b5: 0xd9d3c6, b6: 0xe7e3da, b7: 0xb9c3c9,
};
const NAMES = Object.keys(BASE);
const SHADOW = 0.62;
// Palette: 0 transparent, then the base colours, then their shadowed twins.
const palette = [[0, 0, 0], ...NAMES.map((n) => hex(BASE[n])), ...NAMES.map((n) => hex(BASE[n]).map((c) => Math.round(c * SHADOW)))];
const IDX = Object.fromEntries(NAMES.map((n, i) => [n, i + 1]));
const dark = (i) => (i >= 1 && i <= NAMES.length ? i + NAMES.length : i);

export function renderMinimap({ radius, size = 1024, boundary, buildings, streets, water, parks, cover = null }) {
  const px = new Uint8Array(size * size), k = size / (2 * radius);
  const X = (x) => (x + radius) * k, Z = (z) => (z + radius) * k;

  // Even-odd scanline fill of a polygon (rings in metres). `op(i)` gives the new index for a pixel.
  function fill(rings, op) {
    const edges = [];
    let y0 = Infinity, y1 = -Infinity;
    for (const r of rings) for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length], ay = Z(a[1]), by = Z(b[1]);
      if (ay === by) continue;
      edges.push([X(a[0]), ay, X(b[0]), by]); y0 = Math.min(y0, ay, by); y1 = Math.max(y1, ay, by);
    }
    const r0 = Math.max(0, Math.ceil(y0 - 0.5)), r1 = Math.min(size - 1, Math.floor(y1 - 0.5));
    const xs = [];
    for (let row = r0; row <= r1; row++) {
      const yc = row + 0.5; xs.length = 0;
      for (const [ax, ay, bx, by] of edges) if ((ay <= yc) !== (by <= yc)) xs.push(ax + (yc - ay) * (bx - ax) / (by - ay));
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const c0 = Math.max(0, Math.ceil(xs[i] - 0.5)), c1 = Math.min(size - 1, Math.floor(xs[i + 1] - 0.5));
        for (let c = c0, o = row * size + c0; c <= c1; c++, o++) px[o] = op(px[o]);
      }
    }
  }
  const paint = (i) => () => i;
  // A street as a quad per segment, stretched by half its width so corners join.
  function ribbon(points, width, op) {
    const hw = Math.max(width, 1.2 / k) / 2;
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1], [bx, bz] = points[i], len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05) continue;
      const dx = (bx - ax) / len * hw, dz = (bz - az) / len * hw;
      fill([[[ax - dx - dz, az - dz + dx], [ax - dx + dz, az - dz - dx], [bx + dx + dz, bz + dz - dx], [bx + dx - dz, bz + dz + dx]]], op);
    }
  }
  const inside = (x, z, m = 0) => Math.hypot(x, z) < radius + m;

  px.fill(IDX.lake);
  for (const rings of boundary.polygons) fill(rings, paint(IDX.land));
  // Finished neighborhoods: yards, then paved and industrial land and parking lots (as in 3D).
  if (cover) for (const key of ['yard', 'paved', 'industrial', 'parking']) for (const rings of cover[key]) fill(rings, paint(IDX[key]));
  for (const p of parks) for (const rings of p.polygons) if (rings[0].some(([x, z]) => inside(x, z, 500))) fill(rings, paint(IDX.park));
  for (const w of water) if (!/LAKE MICHIGAN/i.test(w.name) && w.rings[0].some(([x, z]) => inside(x, z, 500))) fill(w.rings, paint(IDX.river));
  const WIDTH = { 1: 24, 2: 14, 3: 11, 4: 9 };
  for (const s of streets) if (s.class >= 1 && s.class <= 4 && s.points.some(([x, z]) => inside(x, z, 200))) ribbon(s.points, WIDTH[s.class], paint(s.class === 1 ? IDX.expressway : IDX.street));
  // Buildings: a drop shadow toward the south-east that grows with height, then the roof,
  // coloured from warm brick (low) to pale stone and glass (tall). Lowest first, so towers win.
  const list = buildings.filter((b) => inside(b.x, b.z, 50)).sort((a, b) => a.h - b.h);
  const roof = (b) => { const t = b.h < 8 ? 0 : b.h < 12 ? 1 : b.h < 18 ? 2 : b.h < 30 ? 3 : b.h < 60 ? 4 : b.h < 120 ? 5 : 6; return IDX['b' + (b.h >= 120 && b.seed % 2 ? 7 : t)]; };
  for (const b of list) { const o = Math.min(b.h * 0.35, 140); fill(b.rings.map((r) => r.map(([x, z]) => [x + o, z + o * 0.8])), dark); }
  for (const b of list) fill(b.rings, paint(roof(b)));

  // Outside the circle: transparent.
  const c = size / 2;
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) if (Math.hypot(col + 0.5 - c, row + 0.5 - c) > c) px[row * size + col] = 0;
  return png(px, size);
}

// ---------- Minimal palette PNG encoder ----------
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'latin1'); Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png(px, size) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 3;
  const raw = Buffer.alloc(size * (size + 1));
  for (let row = 0; row < size; row++) { raw[row * (size + 1)] = 0; Buffer.from(px.buffer, row * size, size).copy(raw, row * (size + 1) + 1); }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('PLTE', Buffer.from(palette.flat())), chunk('tRNS', Buffer.from([0])),
    chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
