// Builds the streamed-city tiles (milestone M2) from .cache/city/ (see import-city-tiles.mjs).
//
//   node tools/build-tiles.mjs
//
// Output (tiles/, generated, gitignored; build-site copies it into docs/):
//   index.json             tile list with sizes/hashes, tall-building table, park and area registries
//   b/{tx}_{tz}.{hash}.bin  1 km detail tiles: real footprints, streets, water, parks (gzip, CHT1 kind 0)
//   s/{sx}_{sz}.{hash}.bin  4 km skyline tiles: oriented boxes for taller buildings (gzip, CHT1 kind 1)
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import clip from './vendor/polygon-clipping.cjs';
import { COVERAGE_RECTS, ORIGIN } from '../js/coverage.js';
import { TILE, SKY, VERSION, FLAG_ESTIMATED, FLAG_SPIKE, FLAG_OVERRIDE, encodeDetail, encodeSkyline, tileKey } from '../js/tile-format.js';
import { root, sha256, ringArea, ringBounds, polygonTester } from './geo-source.mjs';

const src = join(root, '.cache', 'city'), out = join(root, 'tiles');
const read = (name) => JSON.parse(readFileSync(join(src, name), 'utf8'));
const t0 = Date.now(), log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const boundary = read('boundary.json');
const raw = read('buildings.json');
const streetsIn = read('streets.json'), waterIn = read('water.json'), parksIn = read('parks.json'), areasIn = read('areas.json');
const overrides = existsSync(join(root, 'tools', 'height-overrides.json')) ? JSON.parse(readFileSync(join(root, 'tools', 'height-overrides.json'), 'utf8')) : {};
log('Loaded', raw.length, 'buildings');

// ---------- Heights ----------
// Source height = highest lidar point above ground. Missing/implausible values take the
// neighbourhood median. Heights are otherwise kept as measured: an automatic "far taller than
// its neighbours" cap was tried and mostly flattened real towers (Gold Coast, Lakeview,
// Edgewater) and real smokestacks. Suspicious ones (thin and tall) are listed in
// .cache/city/height-review.json; confirmed fixes go in tools/height-overrides.json.
const N = 150, buckets = new Map();
const items = raw.map(([id, h, rings]) => { const v = ringBounds(rings[0]); return { id, h, rings, x: v.x, z: v.z, area: ringArea(rings[0]), v }; });
for (const b of items) if (b.h > 2 && b.h < 600) { const k = Math.floor(b.x / N) + ',' + Math.floor(b.z / N); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(b.h); }
const quantile = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const statsCache = new Map();
function neighbourhood(x, z) {
  const cx = Math.floor(x / N), cz = Math.floor(z / N), key = cx + ',' + cz;
  if (statsCache.has(key)) return statsCache.get(key);
  let hs = [];
  for (let r = 1; r <= 3 && hs.length < 12; r++) { hs = []; for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) hs.push(...(buckets.get((cx + i) + ',' + (cz + j)) || [])); }
  const s = hs.length ? { median: quantile(hs, 0.5), p95: quantile(hs, 0.95), n: hs.length } : { median: 9, p95: 12, n: 0 };
  statsCache.set(key, s); return s;
}
const stats = { estimated: 0, spike: 0, override: 0 }; // spike = listed for review, not changed
for (const b of items) {
  b.flags = 0;
  if (overrides[b.id] != null) { b.h = overrides[b.id]; b.flags |= FLAG_OVERRIDE; stats.override++; continue; }
  const nb = neighbourhood(b.x, b.z);
  if (!(b.h > 2 && b.h < 600)) { b.h = Math.round(nb.median * 10) / 10; b.flags |= FLAG_ESTIMATED; stats.estimated++; continue; }
  if (b.h > 40 && b.h / Math.sqrt(b.area) > 4 && b.h > 3 * nb.median) { b.review = true; stats.spike++; }
}
log('Heights:', JSON.stringify(stats));

// ---------- Oriented boxes (for skyline tiles and the tall-building table) ----------
function orientedBox(ring) {
  let best = 0, angle = 0;
  for (let i = 0; i < ring.length - 1; i++) { const dx = ring[i + 1][0] - ring[i][0], dz = ring[i + 1][1] - ring[i][1], l = dx * dx + dz * dz; if (l > best) { best = l; angle = Math.atan2(dz, dx); } }
  const c = Math.cos(angle), s = Math.sin(angle);
  let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
  for (const [x, z] of ring) { const u = x * c + z * s, w = -x * s + z * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); w0 = Math.min(w0, w); w1 = Math.max(w1, w); }
  const uc = (u0 + u1) / 2, wc = (w0 + w1) / 2;
  return { x: uc * c - wc * s, z: uc * s + wc * c, w: u1 - u0, d: w1 - w0, angle };
}

// ---------- Assign to tiles ----------
const tiles = new Map();
const tileFor = (tx, tz) => { const k = tileKey(tx, tz); if (!tiles.has(k)) tiles.set(k, { tx, tz, buildings: [], streets: [], water: [], parks: [] }); return tiles.get(k); };
for (const b of items) {
  const [objectId, part] = b.id.split('-').map(Number);
  tileFor(Math.floor(b.x / TILE), Math.floor(b.z / TILE)).buildings.push({ objectId, part, h: b.h, flags: b.flags, rings: b.rings, id: b.id });
}
// Streets: centrelines of classes 1-4 (expressway, arterial, collector, local), by midpoint.
let streetCount = 0;
for (const s of streetsIn) {
  if (!(s.class >= 1 && s.class <= 4)) continue;
  const m = s.points[Math.floor(s.points.length / 2)];
  tileFor(Math.floor(m[0] / TILE), Math.floor(m[1] / TILE)).streets.push(s); streetCount++;
}
// Water and parks are clipped to tile squares, leaving out downtown, which draws its own.
const downtownHoles = COVERAGE_RECTS.map((r) => [[[r.minX, r.minZ], [r.maxX, r.minZ], [r.maxX, r.maxZ], [r.minX, r.maxZ], [r.minX, r.minZ]]]);
const closed = (ring) => { const r = ring.map(([x, z]) => [x, z]); const a = r[0], b = r.at(-1); if (a[0] !== b[0] || a[1] !== b[1]) r.push([a[0], a[1]]); return r; };
function clipToTiles(polygons, add) {
  for (const rings of polygons) {
    const v = ringBounds(rings[0]);
    for (let tx = Math.floor(v.x0 / TILE); tx <= Math.floor(v.x1 / TILE); tx++) for (let tz = Math.floor(v.z0 / TILE); tz <= Math.floor(v.z1 / TILE); tz++) {
      const sq = [[[tx * TILE, tz * TILE], [(tx + 1) * TILE, tz * TILE], [(tx + 1) * TILE, (tz + 1) * TILE], [tx * TILE, (tz + 1) * TILE], [tx * TILE, tz * TILE]]];
      let parts;
      try { parts = clip.difference(clip.intersection(rings.map(closed), sq), ...downtownHoles); } catch { continue; }
      for (const p of parts) if (p.length && ringArea(p[0]) > 20) add(tileFor(tx, tz), p.map((r) => r.slice(0, -1)));
    }
  }
}
const isLakeMichigan = (w) => /LAKE MICHIGAN/i.test(w.name);
const rivers = waterIn.filter((w) => !isLakeMichigan(w));
clipToTiles(rivers.map((w) => w.rings), (t, rings) => t.water.push({ rings }));
const parkList = parksIn.map((p, i) => ({ ...p, index: i }));
for (const p of parkList) clipToTiles(p.polygons, (t, rings) => t.parks.push({ park: p.index, rings }));
log('Tiles:', tiles.size, 'streets', streetCount, 'water polygons', rivers.length, 'parks', parkList.length);

// ---------- Write ----------
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'b'), { recursive: true }); mkdirSync(join(out, 's'), { recursive: true });
const write = (dir, key, bytes) => { const gz = gzipSync(bytes, { level: 9 }); const hash = sha256(gz).slice(0, 10); writeFileSync(join(out, dir, `${key}.${hash}.bin`), gz); return { bytes: gz.length, hash }; };
const index = { version: VERSION, tile: TILE, sky: SKY, origin: ORIGIN, built: new Date().toISOString().slice(0, 10), bbox: boundary.bbox, tiles: [], skyline: [], tall: [], parks: [], areas: [], heights: stats };
let total = 0, largest = 0;
for (const t of [...tiles.values()].sort((a, b) => a.tx - b.tx || a.tz - b.tz)) {
  t.buildings.sort((a, b) => a.objectId - b.objectId || a.part - b.part);
  const { bytes, hash } = write('b', tileKey(t.tx, t.tz), encodeDetail(t));
  const maxH = t.buildings.reduce((m, b) => Math.max(m, b.h), 0);
  index.tiles.push([t.tx, t.tz, hash, bytes, t.buildings.length, Math.round(maxH)]);
  total += bytes; largest = Math.max(largest, bytes);
}
// Skyline: one 4 km tile of oriented boxes for every building of 12 m and up.
const sky = new Map();
for (const b of items) {
  if (b.h < 12) continue;
  const box = { ...orientedBox(b.rings[0]), h: b.h };
  const k = tileKey(Math.floor(b.x / SKY), Math.floor(b.z / SKY));
  if (!sky.has(k)) sky.set(k, { sx: Math.floor(b.x / SKY), sz: Math.floor(b.z / SKY), boxes: [] });
  sky.get(k).boxes.push(box);
  if (b.h >= 60) index.tall.push([Math.round(b.v.x0), Math.round(b.v.x1), Math.round(b.v.z0), Math.round(b.v.z1), Math.round(b.h)]);
}
let skyTotal = 0;
for (const t of [...sky.values()].sort((a, b) => a.sx - b.sx || a.sz - b.sz)) {
  const { bytes, hash } = write('s', tileKey(t.sx, t.sz), encodeSkyline(t));
  index.skyline.push([t.sx, t.sz, hash, bytes, t.boxes.length]); skyTotal += bytes;
}
// Registries for labels and the neighbourhood menu. Label point = interior point nearest the
// polygon's bounding-box centre (sampled), so U-shaped areas still get a label inside them.
function labelPoint(polygons) {
  const largest = polygons.reduce((a, p) => (ringArea(p[0]) > ringArea(a[0]) ? p : a));
  const v = ringBounds(largest[0]), inside = polygonTester([largest], 25);
  let best = null, bd = Infinity;
  for (let i = 1; i < 24; i++) for (let j = 1; j < 24; j++) {
    const x = v.x0 + (v.x1 - v.x0) * i / 24, z = v.z0 + (v.z1 - v.z0) * j / 24;
    if (!inside(x, z)) continue;
    const d = (x - v.x) ** 2 + (z - v.z) ** 2; if (d < bd) { bd = d; best = [Math.round(x), Math.round(z)]; }
  }
  return best || [Math.round(v.x), Math.round(v.z)];
}
for (const p of parkList) {
  const all = p.polygons.flatMap((poly) => poly[0]), v = ringBounds(all);
  index.parks.push({ name: p.name, acres: p.acres, label: p.acres >= 25 ? labelPoint(p.polygons) : null, bbox: [Math.round(v.x0), Math.round(v.x1), Math.round(v.z0), Math.round(v.z1)] });
}
for (const a of areasIn) {
  const all = a.polygons.flatMap((poly) => poly[0]), v = ringBounds(all);
  index.areas.push({ id: a.id, name: a.name, label: labelPoint(a.polygons), bbox: [Math.round(v.x0), Math.round(v.x1), Math.round(v.z0), Math.round(v.z1)] });
}
writeFileSync(join(out, 'index.json'), JSON.stringify(index));
const buildingCount = index.tiles.reduce((n, t) => n + t[4], 0);
log(`Wrote ${index.tiles.length} detail tiles (${(total / 1e6).toFixed(1)} MB, largest ${(largest / 1e3).toFixed(0)} KB), ${index.skyline.length} skyline tiles (${(skyTotal / 1e6).toFixed(1)} MB), ${buildingCount} buildings, ${index.tall.length} tall, index ${(JSON.stringify(index).length / 1e3).toFixed(0)} KB`);
// A list of every spike that was capped, for review.
writeFileSync(join(src, 'height-review.json'), JSON.stringify(items.filter((b) => b.review).map((b) => ({ id: b.id, x: Math.round(b.x), z: Math.round(b.z), h: b.h, area: Math.round(b.area) })), null, 1));
