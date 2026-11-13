// Builds the streamed-city tiles (milestone M2) from .cache/city/ (see import-city-tiles.mjs).
//
//   node tools/build-tiles.mjs
//
// Output (tiles/, generated, gitignored; build-site copies it into docs/):
//   index.json             tile list with sizes/hashes, tall-building table, park and area registries
//   b/{tx}_{tz}.{hash}.bin  1 km detail tiles: real footprints, streets, water, parks (gzip, CHT1 kind 0)
//   s/{sx}_{sz}.{hash}.bin  4 km skyline tiles: oriented boxes for taller buildings (gzip, CHT1 kind 1)
//   g/{sx}_{sz}.{hash}.bin  4 km ground tiles: streets, water and parks (CHT1 kind 0 with no buildings,
//                           tx/tz = sx*4/sz*4); always loaded for the whole circle
//   minimap.{hash}.png      bird's-eye map of the circle for the page's corner map (tools/minimap.mjs)
//   backdrop.{hash}.bin     the rest of Chicago beyond DETAIL_RADIUS: boxes for buildings 12 m and up
//
// Only the explorable circle (CITY_RADIUS, plus a margin out to DETAIL_RADIUS) gets detail and
// skyline tiles. Everything farther out is the static backdrop, loaded once.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import clip from './vendor/polygon-clipping.cjs';
import { COVERAGE_RECTS, ORIGIN, CITY_RADIUS, DETAIL_RADIUS, inCoverage } from '../js/coverage.js';
import { TILE, SKY, VERSION, FLAG_ESTIMATED, FLAG_SPIKE, FLAG_OVERRIDE, ROOF_FLAT, ROOF_GABLE, ROOF_CORNICE, ROOF_CHURCH, ROOF_OPEN, ROOF_GREENHOUSE, FRONTS, FINISHED, RAIL_BRIDGE, RAIL_RAISED, SURF_YARD, SURF_PAVED, SURF_INDUSTRIAL, SURF_PARKING, PATH_ALLEY, encodeDetail, encodeSkyline, tileKey, orientedBox, familyFor, styleOf } from '../js/tile-format.js';
import { renderMinimap } from './minimap.mjs';
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

// ---------- Styles ----------
// Buildings in finished (or pilot) neighborhoods take facade family and roof from their profile
// (tools/neighborhood-profiles.json); named buildings can override both. Everywhere else keeps
// the default familyFor() with a flat roof, exactly as before.
const registry = JSON.parse(readFileSync(join(root, 'assets', 'neighborhoods.json'), 'utf8'));
const profiles = JSON.parse(readFileSync(join(root, 'tools', 'neighborhood-profiles.json'), 'utf8')).profiles;
const ROOFS = { flat: ROOF_FLAT, gable: ROOF_GABLE, cornice: ROOF_CORNICE, church: ROOF_CHURCH, open: ROOF_OPEN, greenhouse: ROOF_GREENHOUSE };
const KIND_ROOF = { church: 'church', stadium: 'open', greenhouse: 'greenhouse' };
const finished = registry.neighborhoods.filter((n) => (n.status === 'pilot' || n.status === 'done') && n.profile).map((n) => {
  if (!profiles[n.profile]) throw new Error(`${n.name}: unknown profile ${n.profile}`);
  return { ...n, inside: polygonTester(n.polygons), rules: profiles[n.profile].rules };
});
// A church without a stated front faces its nearest street: whichever end of its long axis is
// closer to a street centreline is the front, as for nearly all city churches.
const frontGrid = new Map(), FG = 100;
for (const st of streetsIn) if (st.class >= 1 && st.class <= 4) for (let i = 1; i < st.points.length; i++) {
  const a = st.points[i - 1], b = st.points[i];
  for (let gx = Math.floor(Math.min(a[0], b[0]) / FG); gx <= Math.floor(Math.max(a[0], b[0]) / FG); gx++) for (let gz = Math.floor(Math.min(a[1], b[1]) / FG); gz <= Math.floor(Math.max(a[1], b[1]) / FG); gz++) { const k = gx + ',' + gz; if (!frontGrid.has(k)) frontGrid.set(k, []); frontGrid.get(k).push([a, b]); }
}
const streetDist = (x, z) => { let best = Infinity; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const [a, b] of frontGrid.get((Math.floor(x / FG) + i) + ',' + (Math.floor(z / FG) + j)) || []) { const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1))); best = Math.min(best, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t)); } return best; };
const itemById = new Map(items.map((b) => [b.id, b]));
function autoFront(id) {
  const b = itemById.get(id); if (!b) return 'N';
  const o = orientedBox(b.rings[0]), c = Math.cos(o.angle), sn = Math.sin(o.angle), [lx, lz, hl] = o.w >= o.d ? [c, sn, o.w / 2] : [-sn, c, o.d / 2];
  const end = streetDist(o.x + lx * hl, o.z + lz * hl) <= streetDist(o.x - lx * hl, o.z - lz * hl) ? 1 : -1, dx = lx * end, dz = lz * end;
  return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'E' : 'W') : (dz > 0 ? 'S' : 'N');
}
const namedStyle = new Map(finished.flatMap((n) => n.named.map((b) => [b.id, styleOf(b.family, ROOFS[b.roof || KIND_ROOF[b.kind] || 'flat'], FRONTS[b.front || (b.kind === 'church' ? autoFront(b.id) : 'N')], !!b.twin)])));
const pick = (weights, seed) => { const e = Object.entries(weights), total = e.reduce((s, [, w]) => s + w, 0); let r = ((seed * 2654435761) >>> 0) % total; for (const [f, w] of e) { if ((r -= w) < 0) return Number(f); } return Number(e[0][0]); };
const styleStats = {};
const inFinished = (x, z) => finished.some((n) => x >= n.bbox[0] && x <= n.bbox[1] && z >= n.bbox[2] && z <= n.bbox[3] && n.inside(x, z));
function styleFor(b, seed) {
  if (namedStyle.has(b.id)) return namedStyle.get(b.id);
  const hood = finished.find((n) => b.x >= n.bbox[0] && b.x <= n.bbox[1] && b.z >= n.bbox[2] && b.z <= n.bbox[3] && n.inside(b.x, b.z));
  if (!hood) return styleOf(familyFor(b.h, seed));
  const rule = hood.rules.find((r) => (r.minArea == null || b.area >= r.minArea) && (r.maxArea == null || b.area <= r.maxArea) && (r.maxH == null || b.h <= r.maxH));
  styleStats[hood.id] = (styleStats[hood.id] || 0) + 1;
  return styleOf(pick(rule.families, seed), ROOFS[rule.roof || 'flat']);
}

// ---------- Assign to tiles ----------
const inDetail = (x, z) => Math.hypot(x, z) < DETAIL_RADIUS;
// A tile square that reaches inside the detail circle.
const tileInDetail = (tx, tz) => Math.hypot(Math.max(tx * TILE, 0, -(tx + 1) * TILE), Math.max(tz * TILE, 0, -(tz + 1) * TILE)) < DETAIL_RADIUS;
const tiles = new Map();
const tileFor = (tx, tz) => { const k = tileKey(tx, tz); if (!tiles.has(k)) tiles.set(k, { tx, tz, buildings: [], streets: [], water: [], parks: [], rails: [], surfaces: [], paths: [] }); return tiles.get(k); };
for (const b of items) {
  if (!inDetail(b.x, b.z)) continue;
  const [objectId, part] = b.id.split('-').map(Number);
  tileFor(Math.floor(b.x / TILE), Math.floor(b.z / TILE)).buildings.push({ objectId, part, h: b.h, flags: b.flags, style: styleFor(b, objectId % 10007), rings: b.rings, id: b.id });
}
// Streets: centrelines of classes 1-4 (expressway, arterial, collector, local), by midpoint.
let streetCount = 0;
for (const s of streetsIn) {
  if (!(s.class >= 1 && s.class <= 4)) continue;
  const m = s.points[Math.floor(s.points.length / 2)];
  if (!inDetail(m[0], m[1]) || inCoverage(m[0], m[1])) continue; // downtown draws its own streets
  tileFor(Math.floor(m[0] / TILE), Math.floor(m[1] / TILE)).streets.push({ ...s, flags: inFinished(m[0], m[1]) ? FINISHED : 0 }); streetCount++;
}
// Main-line railways (OpenStreetMap), by midpoint, outside downtown.
// OSM rarely marks embankments, so finished neighborhoods name their raised lines (raisedRails in
// tools/neighborhood-profiles.json): those run on an embankment, opening into a viaduct wherever a
// street crosses underneath.
const railIn = existsSync(join(src, 'rail.json')) ? read('rail.json') : [];
const streetSegs = new Map(), SEG = 100;
for (const s of streetsIn) if (s.class >= 1 && s.class <= 4) for (let i = 1; i < s.points.length; i++) {
  const a = s.points[i - 1], b = s.points[i], w = { 1: 22, 2: 13, 3: 11, 4: 8.5 }[s.class];
  for (let gx = Math.floor(Math.min(a[0], b[0]) / SEG); gx <= Math.floor(Math.max(a[0], b[0]) / SEG); gx++) for (let gz = Math.floor(Math.min(a[1], b[1]) / SEG); gz <= Math.floor(Math.max(a[1], b[1]) / SEG); gz++) {
    const k = gx + ',' + gz; if (!streetSegs.has(k)) streetSegs.set(k, []); streetSegs.get(k).push([a, b, w]);
  }
}
// Distances along a polyline where streets cross it, with the street's width.
function crossings(points) {
  const out = []; let d = 0;
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1], q = points[i], len = Math.hypot(q[0] - p[0], q[1] - p[1]), seen = new Set();
    for (let gx = Math.floor(Math.min(p[0], q[0]) / SEG); gx <= Math.floor(Math.max(p[0], q[0]) / SEG); gx++) for (let gz = Math.floor(Math.min(p[1], q[1]) / SEG); gz <= Math.floor(Math.max(p[1], q[1]) / SEG); gz++) for (const seg of streetSegs.get(gx + ',' + gz) || []) {
      if (seen.has(seg)) continue; seen.add(seg);
      const [a, b, w] = seg, rx = q[0] - p[0], rz = q[1] - p[1], sx = b[0] - a[0], sz = b[1] - a[1], den = rx * sz - rz * sx;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((a[0] - p[0]) * sz - (a[1] - p[1]) * sx) / den, u = ((a[0] - p[0]) * rz - (a[1] - p[1]) * rx) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) out.push([d + t * len, w]);
    }
    d += len;
  }
  return out;
}
// Cuts a polyline into pieces between distances [d0, d1].
function cut(points, d0, d1) {
  const out = []; let d = 0;
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1], q = points[i], len = Math.hypot(q[0] - p[0], q[1] - p[1]), at = (t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    if (d + len >= d0 && d <= d1) { if (!out.length) out.push(at(Math.max(0, (d0 - d) / (len || 1)))); out.push(at(Math.min(1, (d1 - d) / (len || 1)))); }
    d += len;
  }
  return out;
}
const raisedLines = new Map(finished.map((n) => [n.id, new Set(n.raisedRails || [])]));
let railPieces = 0;
for (const r of railIn) {
  const m = r.points[Math.floor(r.points.length / 2)];
  if (!inDetail(m[0], m[1]) || inCoverage(m[0], m[1])) continue;
  // Railways often are the boundary between neighborhoods: within 60 m of a finished one counts.
  const hood = finished.find((n) => [[0, 0], [60, 0], [-60, 0], [0, 60], [0, -60]].some(([dx, dz]) => { const x = m[0] + dx, z = m[1] + dz; return x >= n.bbox[0] && x <= n.bbox[1] && z >= n.bbox[2] && z <= n.bbox[3] && n.inside(x, z); }));
  const push = (points, flags) => { const c = points[Math.floor(points.length / 2)]; tileFor(Math.floor(c[0] / TILE), Math.floor(c[1] / TILE)).rails.push({ points, flags }); railPieces++; };
  if (hood && raisedLines.get(hood.id).has(r.name) && !r.tunnel) {
    // Embankment pieces between viaducts at every street crossing.
    const total = r.points.slice(1).reduce((t, p, i) => t + Math.hypot(p[0] - r.points[i][0], p[1] - r.points[i][1]), 0);
    const spans = crossings(r.points).map(([d, w]) => [d - w / 2 - 6, d + w / 2 + 6]).sort((a, b) => a[0] - b[0]);
    let at = 0;
    for (const [a, b] of [...spans, [total, total]]) {
      if (a > at + 1) push(cut(r.points, at, a), FINISHED | RAIL_RAISED);
      if (b > a && a < total) push(cut(r.points, Math.max(a, 0), Math.min(b, total)), FINISHED | RAIL_RAISED | RAIL_BRIDGE);
      at = Math.max(at, b);
    }
  } else push(r.points, (hood ? FINISHED : 0) | (r.bridge ? RAIL_BRIDGE | RAIL_RAISED : 0) | (r.raised ? RAIL_RAISED : 0));
}
log('Rail pieces:', railPieces);
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
for (const p of parkList) clipToTiles(p.polygons, (t, rings) => { const v = ringBounds(rings[0]); t.parks.push({ park: p.index, flags: inFinished(v.x, v.z) ? FINISHED : 0, rings }); });
log('Styled by neighborhood profile:', JSON.stringify(styleStats));
// The same ground cover, unclipped, for the bird's-eye map.
const mapCover = { yard: [], paved: [], industrial: [], parking: [] };
// Ground cover in finished neighborhoods. The whole neighborhood is yard (grass) by default;
// zoning then marks business/commercial land as paved and manufacturing/transport land as
// industrial yards; OpenStreetMap adds parking lots and alleys on top.
{
  const optional = (name) => existsSync(join(src, name)) ? read(name) : [];
  const zoningIn = optional('zoning.json'), alleysIn = optional('alleys.json').map((a) => a.points ?? a), parkingIn = optional('parking.json');
  const ZONE = { commercial: SURF_PAVED, industrial: SURF_INDUSTRIAL, transport: SURF_INDUSTRIAL };
  const counts = { yard: 0, zoned: 0, parking: 0, alleys: 0, derivedAlleys: 0 };
  // Without OpenStreetMap alleys for a neighborhood, derive them: Chicago's residential blocks
  // almost all have a 16 ft alley down the middle, along the long side. Blocks are the
  // neighborhood minus its streets; rectangular residential ones get a midline alley.
  const residential = zoningIn.filter((z) => z.kind === 'residential' || z.kind === 'business').map((z) => ({ v: ringBounds(z.rings[0]), test: polygonTester([z.rings]) }));
  const isResidential = (x, z) => residential.some((r) => x >= r.v.x0 && x <= r.v.x1 && z >= r.v.z0 && z <= r.v.z1 && r.test(x, z));
  function deriveAlleys(n, hood) {
    const [hx0, hx1, hz0, hz1] = n.bbox, quads = [];
    for (const s of streetsIn) {
      if (!(s.class >= 1 && s.class <= 4) || !s.points.some(([x, z]) => x > hx0 - 50 && x < hx1 + 50 && z > hz0 - 50 && z < hz1 + 50)) continue;
      const hw = ({ 1: 22, 2: 13, 3: 11, 4: 8.5 }[s.class] + 6) / 2;
      for (let i = 1; i < s.points.length; i++) {
        const [ax, az] = s.points[i - 1], [bx, bz] = s.points[i], len = Math.hypot(bx - ax, bz - az); if (len < 0.5) continue;
        const dx = (bx - ax) / len * hw, dz = (bz - az) / len * hw;
        quads.push([[[ax - dx - dz, az - dz + dx], [ax - dx + dz, az - dz - dx], [bx + dx + dz, bz + dz - dx], [bx + dx - dz, bz + dz + dx], [ax - dx - dz, az - dz + dx]]]);
      }
    }
    let blocks; try { blocks = clip.difference(hood, ...quads); } catch { return []; }
    const out = [];
    for (const b of blocks) {
      const ring = b[0].slice(0, -1), o = orientedBox(b[0]), area = ringArea(b[0]);
      const long = Math.max(o.w, o.d), short = Math.min(o.w, o.d);
      if (long < 90 || short < 40 || short > 140 || area < 0.8 * o.w * o.d || !isResidential(o.x, o.z)) continue;
      // Midline along the long axis, stopping at the block edges.
      const c = Math.cos(o.angle), s = Math.sin(o.angle), [lx, lz] = o.w >= o.d ? [c, s] : [-s, c], half = long / 2 + 1;
      out.push([[o.x - lx * half, o.z - lz * half], [o.x + lx * half, o.z + lz * half]]);
    }
    return out;
  }
  for (const n of finished) {
    const hood = n.polygons.map((p) => p.map(closed)), [hx0, hx1, hz0, hz1] = n.bbox;
    mapCover.yard.push(...n.polygons);
    const overlaps = (rings) => { const v = ringBounds(rings[0]); return v.x1 > hx0 && v.x0 < hx1 && v.z1 > hz0 && v.z0 < hz1; };
    clipToTiles(n.polygons, (t, rings) => { t.surfaces.push({ kind: SURF_YARD, rings }); counts.yard++; });
    for (const z of zoningIn) {
      if (!ZONE[z.kind] || !overlaps(z.rings)) continue;
      let parts; try { parts = clip.intersection([z.rings.map(closed)], hood); } catch { continue; }
      (ZONE[z.kind] === SURF_PAVED ? mapCover.paved : mapCover.industrial).push(...parts);
      clipToTiles(parts, (t, rings) => { t.surfaces.push({ kind: ZONE[z.kind], rings }); counts.zoned++; });
    }
    for (const rings of parkingIn) {
      const v = ringBounds(rings[0]);
      if (!overlaps(rings) || !n.inside(v.x, v.z)) continue;
      mapCover.parking.push(rings);
      clipToTiles([rings], (t, r) => { t.surfaces.push({ kind: SURF_PARKING, rings: r }); counts.parking++; });
    }
    const osmHere = alleysIn.filter((points) => { const m = points[Math.floor(points.length / 2)]; return m[0] >= hx0 && m[0] <= hx1 && m[1] >= hz0 && m[1] <= hz1 && n.inside(m[0], m[1]); });
    if (!osmHere.length) for (const points of deriveAlleys(n, hood)) { const m = [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2]; tileFor(Math.floor(m[0] / TILE), Math.floor(m[1] / TILE)).paths.push({ kind: PATH_ALLEY, points }); counts.derivedAlleys++; }
    for (const points of osmHere) {
      const m = points[Math.floor(points.length / 2)];
      if (m[0] < hx0 || m[0] > hx1 || m[1] < hz0 || m[1] > hz1 || !n.inside(m[0], m[1])) continue;
      tileFor(Math.floor(m[0] / TILE), Math.floor(m[1] / TILE)).paths.push({ kind: PATH_ALLEY, points }); counts.alleys++;
    }
  }
  log('Ground cover in finished neighborhoods:', JSON.stringify(counts));
}
log('Tiles:', tiles.size, 'streets', streetCount, 'water polygons', rivers.length, 'parks', parkList.length);

// ---------- Write ----------
rmSync(out, { recursive: true, force: true });
for (const d of ['b', 's', 'g']) mkdirSync(join(out, d), { recursive: true });
const write = (dir, key, bytes) => { const gz = gzipSync(bytes, { level: 9 }); const hash = sha256(gz).slice(0, 10); writeFileSync(join(out, dir, `${key}.${hash}.bin`), gz); return { bytes: gz.length, hash }; };
const index = { version: VERSION, tile: TILE, sky: SKY, origin: ORIGIN, radius: CITY_RADIUS, detailRadius: DETAIL_RADIUS, built: new Date().toISOString().slice(0, 10), bbox: boundary.bbox, tiles: [], skyline: [], ground: [], tall: [], parks: [], areas: [], heights: stats };
let total = 0, largest = 0;
// Ground features move from their 1 km tiles into 4 km ground tiles, loaded for the whole circle.
const ground = new Map(), ratio = SKY / TILE;
for (const t of tiles.values()) {
  const sx = Math.floor(t.tx / ratio), sz = Math.floor(t.tz / ratio), k = tileKey(sx, sz);
  if (!ground.has(k)) ground.set(k, { tx: sx * ratio, tz: sz * ratio, sx, sz, buildings: [], streets: [], water: [], parks: [], rails: [], surfaces: [], paths: [] });
  const g = ground.get(k); g.streets.push(...t.streets); g.water.push(...t.water); g.parks.push(...t.parks); g.rails.push(...t.rails); g.surfaces.push(...t.surfaces); g.paths.push(...t.paths);
  t.streets = []; t.water = []; t.parks = []; t.rails = []; t.surfaces = []; t.paths = [];
}
let groundTotal = 0;
for (const g of [...ground.values()].sort((a, b) => a.sx - b.sx || a.sz - b.sz)) {
  if (!g.streets.length && !g.water.length && !g.parks.length && !g.rails.length && !g.surfaces.length && !g.paths.length) continue;
  const { bytes, hash } = write('g', tileKey(g.sx, g.sz), encodeDetail(g));
  index.ground.push([g.sx, g.sz, hash, bytes, g.streets.length]); groundTotal += bytes; largest = Math.max(largest, bytes);
}
log(`Ground: ${index.ground.length} tiles, ${(groundTotal / 1e6).toFixed(2)} MB`);
for (const t of [...tiles.values()].sort((a, b) => a.tx - b.tx || a.tz - b.tz)) {
  if (!t.buildings.length) continue;
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
// Downtown footprints live in assets/downtown.json (the citywide import leaves them out); the map shows them too.
function downtownForMap() {
  return JSON.parse(readFileSync(join(root, 'assets', 'downtown.json'), 'utf8')).buildings.map((b) => { const v = ringBounds(b.rings[0]); return { id: b.id, h: b.h, rings: b.rings, x: v.x, z: v.z }; });
}
{
  const img = renderMinimap({ radius: CITY_RADIUS, boundary, buildings: [...items, ...downtownForMap()].map((b) => ({ rings: b.rings, h: b.h, x: b.x, z: b.z, seed: parseInt(b.id, 10) })), streets: streetsIn, water: waterIn, parks: parksIn, cover: mapCover });
  const hash = sha256(img).slice(0, 10);
  writeFileSync(join(out, `minimap.${hash}.png`), img);
  index.minimap = [hash, img.length, 1024];
  log(`Minimap: ${(img.length / 1e3).toFixed(0)} KB`);
}
// Named buildings of finished neighborhoods, with positions and heights for their labels.
{
  const byId = new Map(items.map((b) => [b.id, b]));
  index.named = finished.flatMap((n) => n.named.map((d) => { const b = byId.get(d.id); if (!b) throw new Error(`${n.name}: named building ${d.id} (${d.name}) not found`); return { id: d.id, name: d.name, kind: d.kind || 'landmark', hood: n.id, x: Math.round(b.x), z: Math.round(b.z), h: Math.round(b.h) }; }));
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
