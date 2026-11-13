// Builds the streamed-city tiles (milestone M2) from .cache/city/ (see import-city-tiles.mjs).
//
//   node tools/build-tiles.mjs
//
// Output (tiles/, generated, gitignored; build-site copies it into docs/):
//   index.json             tile list with sizes/hashes, tall-building table, park and area registries
//   b/{tx}_{tz}.{hash}.bin  1 km detail tiles: real footprints, streets, water, parks (gzip, CHT1 kind 0)
//   s/{sx}_{sz}.{hash}.bin  4 km skyline tiles: oriented boxes for taller buildings (gzip, CHT1 kind 1)
//   backdrop.{hash}.bin     the rest of Chicago beyond DETAIL_RADIUS: boxes for buildings 12 m and up
//
// Only the explorable circle (CITY_RADIUS, plus a margin out to DETAIL_RADIUS) gets detail and
// skyline tiles. Everything farther out is the static backdrop, loaded once.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import clip from './vendor/polygon-clipping.cjs';
import { COVERAGE_RECTS, ORIGIN, CITY_RADIUS, DETAIL_RADIUS } from '../js/coverage.js';
import { TILE, SKY, VERSION, FLAG_ESTIMATED, FLAG_SPIKE, FLAG_OVERRIDE, encodeDetail, encodeSkyline, tileKey, orientedBox } from '../js/tile-format.js';
import { root, sha256, ringArea, ringBounds, polygonTester, simplify } from './geo-source.mjs';

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

// ---------- Assign to tiles ----------
const inDetail = (x, z) => Math.hypot(x, z) < DETAIL_RADIUS;
// A tile square that reaches inside the detail circle.
const tileInDetail = (tx, tz) => Math.hypot(Math.max(tx * TILE, 0, -(tx + 1) * TILE), Math.max(tz * TILE, 0, -(tz + 1) * TILE)) < DETAIL_RADIUS;
const tiles = new Map();
const tileFor = (tx, tz) => { const k = tileKey(tx, tz); if (!tiles.has(k)) tiles.set(k, { tx, tz, buildings: [], streets: [], water: [], parks: [] }); return tiles.get(k); };
for (const b of items) {
  if (!inDetail(b.x, b.z)) continue;
  const [objectId, part] = b.id.split('-').map(Number);
  tileFor(Math.floor(b.x / TILE), Math.floor(b.z / TILE)).buildings.push({ objectId, part, h: b.h, flags: b.flags, rings: b.rings, id: b.id });
}
// Streets: centrelines of classes 1-4 (expressway, arterial, collector, local), by midpoint.
let streetCount = 0;
for (const s of streetsIn) {
  if (!(s.class >= 1 && s.class <= 4)) continue;
  const m = s.points[Math.floor(s.points.length / 2)];
  if (!inDetail(m[0], m[1])) continue;
  tileFor(Math.floor(m[0] / TILE), Math.floor(m[1] / TILE)).streets.push(s); streetCount++;
}
// Water and parks are clipped to tile squares, leaving out downtown, which draws its own.
const downtownHoles = COVERAGE_RECTS.map((r) => [[[r.minX, r.minZ], [r.maxX, r.minZ], [r.maxX, r.maxZ], [r.minX, r.maxZ], [r.minX, r.minZ]]]);
const closed = (ring) => { const r = ring.map(([x, z]) => [x, z]); const a = r[0], b = r.at(-1); if (a[0] !== b[0] || a[1] !== b[1]) r.push([a[0], a[1]]); return r; };
function clipToTiles(polygons, add) {
  for (const rings of polygons) {
    const v = ringBounds(rings[0]);
    for (let tx = Math.floor(v.x0 / TILE); tx <= Math.floor(v.x1 / TILE); tx++) for (let tz = Math.floor(v.z0 / TILE); tz <= Math.floor(v.z1 / TILE); tz++) {
      if (!tileInDetail(tx, tz)) continue;
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
const index = { version: VERSION, tile: TILE, sky: SKY, origin: ORIGIN, radius: CITY_RADIUS, detailRadius: DETAIL_RADIUS, built: new Date().toISOString().slice(0, 10), bbox: boundary.bbox, tiles: [], skyline: [], tall: [], parks: [], areas: [], heights: stats };
let total = 0, largest = 0;
for (const t of [...tiles.values()].sort((a, b) => a.tx - b.tx || a.tz - b.tz)) {
  t.buildings.sort((a, b) => a.objectId - b.objectId || a.part - b.part);
  const { bytes, hash } = write('b', tileKey(t.tx, t.tz), encodeDetail(t));
  const maxH = t.buildings.reduce((m, b) => Math.max(m, b.h), 0);
  index.tiles.push([t.tx, t.tz, hash, bytes, t.buildings.length, Math.round(maxH)]);
  total += bytes; largest = Math.max(largest, bytes);
}
// Skyline: one 4 km tile of oriented boxes for every building of 12 m and up inside the detail
// circle; the same boxes outside it make up the backdrop.
const sky = new Map(), backdrop = { sx: 0, sz: 0, boxes: [] };
for (const b of items) {
  if (b.h < 12) continue;
  const box = { ...orientedBox(b.rings[0]), h: b.h };
  if (!inDetail(b.x, b.z)) { backdrop.boxes.push(box); continue; }
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
{
  const gz = gzipSync(encodeSkyline(backdrop), { level: 9 }), hash = sha256(gz).slice(0, 10);
  writeFileSync(join(out, `backdrop.${hash}.bin`), gz);
  index.backdrop = [hash, gz.length, backdrop.boxes.length]; skyTotal += gz.length;
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
// Land outside downtown's surveyed terrain. The lake edge follows the city's east boundary
// (the shoreline) south to the Indiana line, then turns east; north of the city it runs
// straight. The client builds the ground as strips west of this line (tile-manager buildLand).
{
  const edges = boundary.polygons.flat();
  const crossings = (z) => { const xs = []; for (const ring of edges) for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; if ((a[1] > z) !== (b[1] > z)) xs.push(a[0] + (z - a[1]) * (b[0] - a[0]) / (b[1] - a[1])); } return xs; };
  const shore = [];
  for (let z = Math.ceil(boundary.bbox.z0 / 100) * 100 + 50; z < boundary.bbox.z1; z += 100) {
    const xs = crossings(z); if (!xs.length) continue;
    const x = Math.max(...xs); shore.push([x, z]);
    if (x > 8400) break; // the Illinois-Indiana line: no lake south of here
  }
  const line = simplify(shore, 15).map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
  const wf = JSON.parse(readFileSync(join(root, 'assets', 'waterfront.json'), 'utf8')).terrain.flat(2);
  const t = { x0: Math.min(...wf.map((p) => p[0])), x1: Math.max(...wf.map((p) => p[0])), z0: Math.min(...wf.map((p) => p[1])), z1: Math.max(...wf.map((p) => p[1])) };
  // Inside the surveyed box, the parts west of the shore that waterfront.json's terrain
  // does not cover (its north and south edges are slanted), as small simple polygons.
  const shoreAt = (z) => { for (let i = 1; i < line.length; i++) if (line[i][1] >= z) { const [ax, az] = line[i - 1], [bx, bz] = line[i]; return ax + (bx - ax) * (z - az) / (bz - az || 1); } return line.at(-1)[0]; };
  const west = [[t.x0, t.z0], [shoreAt(t.z0), t.z0], ...line.filter((p) => p[1] > t.z0 && p[1] < t.z1), [shoreAt(t.z1), t.z1], [t.x0, t.z1], [t.x0, t.z0]];
  const terrainOuter = JSON.parse(readFileSync(join(root, 'assets', 'waterfront.json'), 'utf8')).terrain.map((p) => [p[0].concat([p[0][0]])]);
  const gaps = clip.difference([west], ...terrainOuter).map((p) => p.map((r) => r.slice(0, -1).map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10])))
    .filter((p) => ringArea(p[0]) > 100 && p[0].some(([, z]) => Math.abs(z - t.z0) < 1 || Math.abs(z - t.z1) < 1)); // edge wedges only; slivers along the shore are harbours
  index.land = { shore: line, surveyed: t, extent: 70000, gaps };
  log('Land gaps inside the surveyed box:', gaps.length, gaps.map((p) => Math.round(ringArea(p[0]) / 1e4) / 100 + ' km2').join(', '));
  log('Land: shoreline of', line.length, 'points; surveyed terrain box', JSON.stringify(t));
}
writeFileSync(join(out, 'index.json'), JSON.stringify(index));
const buildingCount = index.tiles.reduce((n, t) => n + t[4], 0);
log(`Wrote ${index.tiles.length} detail tiles (${(total / 1e6).toFixed(1)} MB, largest ${(largest / 1e3).toFixed(0)} KB), ${index.skyline.length} skyline tiles + backdrop of ${backdrop.boxes.length} (${(skyTotal / 1e6).toFixed(1)} MB), ${buildingCount} buildings, ${index.tall.length} tall, index ${(JSON.stringify(index).length / 1e3).toFixed(0)} KB`);
// A list of every spike that was capped, for review.
writeFileSync(join(src, 'height-review.json'), JSON.stringify(items.filter((b) => b.review).map((b) => ({ id: b.id, x: Math.round(b.x), z: Math.round(b.z), h: b.h, area: Math.round(b.area) })), null, 1));
