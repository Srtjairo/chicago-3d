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
import { TILE, SKY, VERSION, FLAG_ESTIMATED, FLAG_SPIKE, FLAG_OVERRIDE, ROOF_FLAT, ROOF_GABLE, ROOF_CORNICE, ROOF_CHURCH, ROOF_OPEN, ROOF_GREENHOUSE, FRONTS, FINISHED, RAIL_BRIDGE, RAIL_RAISED, SURF_YARD, SURF_PAVED, SURF_INDUSTRIAL, SURF_PARKING, SURF_PLAZA, PATH_ALLEY, SURF_LAWN, SURF_SAND, SURF_PRAIRIE, SURF_INFIELD, SURF_TENNIS, SURF_HARDCOURT, SURF_PLAY, SURF_POOL, SURF_VACANT, SURF_BALLAST, PATH_TRAIL, PATH_WALK, PATH_LINE, PATH_DOCK, PATH_RAMP, PATH_TREES, PATH_CLEAR, encodeDetail, encodeSkyline, tileKey, orientedBox, familyFor, styleOf } from '../js/tile-format.js';
import { renderMinimap } from './minimap.mjs';
import { LAKEFRONT } from './lakefront.mjs';
import { pickFamily, ruleFor } from '../js/neighborhood-style.js';
import { root, sha256, ringArea, ringBounds, polygonTester, simplify } from './geo-source.mjs';

const src = join(root, '.cache', 'city'), out = join(root, 'tiles');
const read = (name) => JSON.parse(readFileSync(join(src, name), 'utf8'));
const t0 = Date.now(), log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const boundary = read('boundary.json');
const raw = read('buildings.json');
const streetsIn = read('streets.json'), waterIn = read('water.json'), parksIn = read('parks.json'), areasIn = read('areas.json');
const overrides = existsSync(join(root, 'tools', 'height-overrides.json')) ? JSON.parse(readFileSync(join(root, 'tools', 'height-overrides.json'), 'utf8')) : {};
log('Loaded', raw.length, 'buildings');
// The lake edge: the city's east boundary (the shoreline), sampled every 100 m, south to the
// Indiana line. Land is drawn west of it (tile-manager buildLand); harbors and slips that lie
// west of it are added back as water below.
const SHORE_LINE = (() => {
  const edges = boundary.polygons.flat();
  const crossings = (z) => { const xs = []; for (const ring of edges) for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; if ((a[1] > z) !== (b[1] > z)) xs.push(a[0] + (z - a[1]) * (b[0] - a[0]) / (b[1] - a[1])); } return xs; };
  const shore = [];
  for (let z = Math.ceil(boundary.bbox.z0 / 100) * 100 + 50; z < boundary.bbox.z1; z += 100) {
    const xs = crossings(z); if (!xs.length) continue;
    const x = Math.max(...xs); shore.push([x, z]);
    if (x > 8400) break; // the Illinois-Indiana line: no lake south of here
  }
  return simplify(shore, 15).map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
})();
const shoreAt = (z) => { const line = SHORE_LINE; for (let i = 1; i < line.length; i++) if (line[i][1] >= z) { const [ax, az] = line[i - 1], [bx, bz] = line[i]; return ax + (bx - ax) * (z - az) / (bz - az || 1); } return line.at(-1)[0]; };

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
const pick = pickFamily;
const styleStats = {};
const inFinished = (x, z) => finished.some((n) => x >= n.bbox[0] && x <= n.bbox[1] && z >= n.bbox[2] && z <= n.bbox[3] && n.inside(x, z));
function styleFor(b, seed) {
  if (namedStyle.has(b.id)) return namedStyle.get(b.id);
  const hood = finished.find((n) => b.x >= n.bbox[0] && b.x <= n.bbox[1] && b.z >= n.bbox[2] && b.z <= n.bbox[3] && n.inside(b.x, b.z));
  if (!hood) return styleOf(familyFor(b.h, seed));
  const rule = ruleFor(hood.rules, b.h, b.area);
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
// Lake Shore Drive is drawn by js/lake-shore.js along its traced chains (assets/lake-shore.json),
// so the tiles leave out the City centreline copy wherever that road is drawn in full (it fades
// out over its last 650 m). Its entrance and exit ramps (class 9 in the City data) are added.
const lsdCells = new Set(), LSD_CELL = 25;
for (const ch of JSON.parse(readFileSync(join(root, 'assets', 'lake-shore.json'), 'utf8')).chains) {
  const pts = ch.segments.flatMap((s) => s.points), d = [0];
  for (let i = 1; i < pts.length; i++) d.push(d[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  for (let i = 1; i < pts.length; i++) {
    const n = Math.ceil((d[i] - d[i - 1]) / 8);
    for (let k = 0; k <= n; k++) {
      const dd = d[i - 1] + (d[i] - d[i - 1]) * k / n; if (dd < 700 || d.at(-1) - dd < 700) continue;
      const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k / n, z = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k / n;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) lsdCells.add((Math.floor(x / LSD_CELL) + a) + ',' + (Math.floor(z / LSD_CELL) + b));
    }
  }
}
const drawnLsd = (s) => /LAKE SHORE/.test(s.name) && s.class <= 2 && [s.points[0], s.points[Math.floor(s.points.length / 2)], s.points.at(-1)].every(([x, z]) => lsdCells.has(Math.floor(x / LSD_CELL) + ',' + Math.floor(z / LSD_CELL)));
const isLsdRamp = (s) => s.class >= 7 && /(^| )LSD .*\b[EX]R$|LSD .*STEVENSON|STEVENSON .*LSD|LAKE SHORE DR RAMP/.test(s.name);
let streetCount = 0, lsdSkipped = 0, lsdRamps = 0;
for (const s of streetsIn) {
  if (isLsdRamp(s)) {
    const m = s.points[Math.floor(s.points.length / 2)];
    if (inDetail(m[0], m[1]) && !inCoverage(m[0], m[1])) { tileFor(Math.floor(m[0] / TILE), Math.floor(m[1] / TILE)).paths.push({ kind: PATH_RAMP, points: s.points }); lsdRamps++; }
    continue;
  }
  if (!(s.class >= 1 && s.class <= 4)) continue;
  if (drawnLsd(s)) { lsdSkipped++; continue; }
  const m = s.points[Math.floor(s.points.length / 2)];
  if (!inDetail(m[0], m[1]) || inCoverage(m[0], m[1])) continue; // downtown draws its own streets
  tileFor(Math.floor(m[0] / TILE), Math.floor(m[1] / TILE)).streets.push({ ...s, flags: inFinished(m[0], m[1]) ? FINISHED : 0 }); streetCount++;
}
log('Lake Shore Drive: left', lsdSkipped, 'centreline pieces to js/lake-shore.js; ramps', lsdRamps);
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
// Water, parks and ground cover are clipped to tile squares, leaving out downtown, which draws its
// own. One exception: east of Museum Park, between the south edge of the waterfront's surveyed
// terrain (assets/waterfront.json, just south of Roosevelt Road) and the end of downtown, nothing
// downtown draws the ground (Museum Campus around the Field Museum, Shedd and Adler), so the tiles do.
const rect = (x0, z0, x1, z1) => [[[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]]];
const WF_SOUTH = JSON.parse(readFileSync(join(root, 'assets', 'waterfront.json'), 'utf8')).bounds.maxZ;
const BAND = { x0: 640, x1: COVERAGE_RECTS[0].maxX, z0: WF_SOUTH, z1: COVERAGE_RECTS[0].maxZ };
const downtownHoles = COVERAGE_RECTS.flatMap((r) => r.id === 'downtown'
  ? [rect(r.minX, r.minZ, r.maxX, BAND.z0), rect(r.minX, BAND.z0, BAND.x0, r.maxZ)]
  : [rect(r.minX, r.minZ, r.maxX, r.maxZ)]);
const inBand = (x, z) => x >= BAND.x0 && x <= BAND.x1 && z >= BAND.z0 && z <= BAND.z1;
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
// Harbors and slips: Lake Michigan west of the shoreline line (Burnham, Belmont and Diversey
// harbors, the slips along Lincoln Park), which the land would otherwise cover.
const circleRing = Array.from({ length: 97 }, (_, i) => [Math.cos(i / 48 * Math.PI) * (DETAIL_RADIUS + 300), Math.sin(i / 48 * Math.PI) * (DETAIL_RADIUS + 300)]);
const landPoly = [[[-DETAIL_RADIUS - 600, -DETAIL_RADIUS - 600], ...SHORE_LINE.filter(([, z]) => z > -DETAIL_RADIUS - 500 && z < DETAIL_RADIUS + 500), [-DETAIL_RADIUS - 600, DETAIL_RADIUS + 600], [-DETAIL_RADIUS - 600, -DETAIL_RADIUS - 600]]];
landPoly[0].splice(1, 0, [shoreAt(-DETAIL_RADIUS - 500), -DETAIL_RADIUS - 600]); landPoly[0].splice(landPoly[0].length - 2, 0, [shoreAt(DETAIL_RADIUS + 500), DETAIL_RADIUS + 600]);
const inlets = clip.intersection(landPoly, waterIn.filter(isLakeMichigan).map((w) => w.rings.map(closed)), [circleRing]).filter((p) => ringArea(p[0]) > 600);
rivers.push(...inlets.map((p) => ({ name: 'LAKE MICHIGAN (harbor)', rings: p.map((r) => r.slice(0, -1)) })));
// Ponds traced in tools/lakefront.mjs.
rivers.push(...LAKEFRONT.filter((f) => f.kind === 'water').map((f) => ({ name: f.id, rings: [f.poly] })));
// The same harbors and ponds for Mini Fellow's water (tools/build-neighborhoods.mjs reads them).
writeFileSync(join(src, 'harbors.json'), JSON.stringify(rivers.filter((w) => !waterIn.includes(w)).map((w) => ({ name: w.name, rings: w.rings }))));
log('Harbors and slips west of the shoreline:', inlets.length, inlets.map((p) => Math.round(ringArea(p[0]) / 1000) + 'k').join(' '));
// Dry land near the lake: west of the shoreline, minus the harbors (lakefront features are clipped to it).
const onLand = (polys) => { try { return clip.difference(clip.intersection(polys, landPoly), ...inlets); } catch { return []; } };
clipToTiles(rivers.map((w) => w.rings), (t, rings) => t.water.push({ rings }));
const parkList = parksIn.map((p, i) => ({ ...p, index: i }));
// Park lawns stop at the water's edge (some City park outlines run over lagoons and harbors).
const wetAll = rivers.map((w) => ({ v: ringBounds(w.rings[0]), rings: w.rings.map(closed) }));
const parkDry = (polys) => polys.flatMap((poly) => { const v = ringBounds(poly[0]); const wet = wetAll.filter((w) => w.v.x1 > v.x0 && w.v.x0 < v.x1 && w.v.z1 > v.z0 && w.v.z0 < v.z1).map((w) => w.rings); if (!wet.length) return [poly]; try { return clip.difference([poly.map(closed)], ...wet); } catch { return [poly]; } });
for (const p of parkList) clipToTiles(parkDry(p.polygons), (t, rings) => { const v = ringBounds(rings[0]); t.parks.push({ park: p.index, flags: inFinished(v.x, v.z) ? FINISHED : 0, rings }); });
log('Styled by neighborhood profile:', JSON.stringify(styleStats));
// The same ground cover, unclipped, for the bird's-eye map.
const mapCover = { yard: [], paved: [], industrial: [], parking: [] };
// Ground cover in finished neighborhoods. The whole neighborhood is yard (grass) by default;
// zoning then marks business/commercial land as paved and manufacturing/transport land as
// industrial yards; OpenStreetMap adds parking lots and alleys on top.
{
  const optional = (name) => existsSync(join(src, name)) ? read(name) : [];
  const zoningIn = optional('zoning.json'), alleysIn = optional('alleys.json').map((a) => a.points ?? a), parkingIn = optional('parking.json');
  // Ground by zoning. Defaults, which a profile's "ground" can override per zoning kind:
  // commercial land is paved, manufacturing and transport land industrial yards, downtown (D)
  // districts plaza paving, and planned developments (PD) decided by what is built on them
  // ("auto"): towers and big halls stand on plazas, low-rise homes keep their yards, empty ones
  // of 2 ha and more are vacant lots (smaller ones are often newer than the footprints). Everything else (residential, business) stays yard.
  const SURF_BY_NAME = { paved: SURF_PAVED, industrial: SURF_INDUSTRIAL, plaza: SURF_PLAZA, vacant: SURF_VACANT, yard: null };
  const DEFAULT_GROUND = { commercial: 'paved', industrial: 'industrial', transport: 'industrial', downtown: 'plaza', planned: 'auto' };
  // Buildings by centroid (50 m cells), parks by bounding box, for the "auto" rule.
  const bgrid = new Map(), BG = 50;
  for (const b of items) { if (Math.hypot(b.x, b.z) > DETAIL_RADIUS + 500) continue; const k = Math.floor(b.x / BG) + ',' + Math.floor(b.z / BG); if (!bgrid.has(k)) bgrid.set(k, []); bgrid.get(k).push(b); }
  const parkShapes = parksIn.flatMap((p) => p.polygons.map((poly) => ({ v: ringBounds(poly[0]), test: polygonTester([poly]), rings: poly.map(closed) })));
  const parkAt = (x, z) => parkShapes.some((p) => x >= p.v.x0 && x <= p.v.x1 && z >= p.v.z0 && z <= p.v.z1 && p.test(x, z));
  const autoCache = new Map(), autoStats = {};
  function autoSurface(z) {
    if (autoCache.has(z)) return autoCache.get(z);
    const v = ringBounds(z.rings[0]), test = polygonTester([z.rings]), area = ringArea(z.rings[0]);
    let n = 0, inPark = 0; const step = Math.max(12, Math.sqrt(area) / 18);
    for (let x = v.x0 + step / 2; x < v.x1; x += step) for (let q = v.z0 + step / 2; q < v.z1; q += step) if (test(x, q)) { n++; if (parkAt(x, q)) inPark++; }
    let count = 0, foot = 0, footH = 0;
    for (let i = Math.floor(v.x0 / BG); i <= Math.floor(v.x1 / BG); i++) for (let j = Math.floor(v.z0 / BG); j <= Math.floor(v.z1 / BG); j++) for (const b of bgrid.get(i + ',' + j) || []) if (test(b.x, b.z)) { count++; foot += b.area; footH += b.area * b.h; }
    const cover = foot / area, meanH = foot ? footH / foot : 0;
    const s = n && inPark / n > 0.5 ? null : !count || cover < 0.03 ? (area > 20000 ? SURF_VACANT : null) : meanH >= 18 || cover >= 0.35 ? SURF_PLAZA : meanH < 13 && cover < 0.3 ? null : SURF_PAVED;
    autoStats[s ?? 'yard'] = (autoStats[s ?? 'yard'] || 0) + 1; autoCache.set(z, s); return s;
  }
  const groundFor = (n) => ({ ...DEFAULT_GROUND, ...(profiles[n.profile].ground || {}) });
  const surfaceOf = (z, rule) => { const g = rule[z.kind]; return g === 'auto' ? autoSurface(z) : g ? SURF_BY_NAME[g] : null; };
  const nearParks = (v) => parkShapes.filter((p) => p.v.x1 > v.x0 && p.v.x0 < v.x1 && p.v.z1 > v.z0 && p.v.z0 < v.z1).map((p) => p.rings);
  // Ground cover never runs under rivers, lagoons and harbors (far away, flat layers this close
  // together can't be told apart by depth, so the water would flicker or vanish).
  const wetShapes = rivers.map((w) => ({ v: ringBounds(w.rings[0]), rings: w.rings.map(closed) }));
  const dry = (parts, v) => { const wet = wetShapes.filter((w) => w.v.x1 > v.x0 && w.v.x0 < v.x1 && w.v.z1 > v.z0 && w.v.z0 < v.z1).map((w) => w.rings); if (!wet.length || !parts.length) return parts; try { return clip.difference(parts, ...wet); } catch { return parts; } };
  const counts = { yard: 0, zoned: 0, parking: 0, alleys: 0, derivedAlleys: 0 };
  // Without OpenStreetMap alleys for a neighborhood, derive them: Chicago's residential blocks
  // almost all have a 16 ft alley down the middle, along the long side. Blocks are the
  // neighborhood minus its streets; rectangular residential ones get a midline alley.
  const residential = zoningIn.filter((z) => z.kind === 'residential' || z.kind === 'business').map((z) => ({ v: ringBounds(z.rings[0]), test: polygonTester([z.rings]) }));
  const isResidential = (x, z) => residential.some((r) => x >= r.v.x0 && x <= r.v.x1 && z >= r.v.z0 && z <= r.v.z1 && r.test(x, z));
  function deriveAlleys(n, hood, downtown = false) {
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
      if (long < 90 || short < 40 || short > 140 || area < 0.8 * o.w * o.d || !(downtown || isResidential(o.x, o.z))) continue;
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
    clipToTiles(dry(n.polygons.map((p) => p.map(closed)), { x0: hx0, x1: hx1, z0: hz0, z1: hz1 }), (t, rings) => { t.surfaces.push({ kind: SURF_YARD, rings }); counts.yard++; });
    const rule = groundFor(n);
    for (const z of zoningIn) {
      if (!overlaps(z.rings) || !rule[z.kind]) continue;
      const kind = surfaceOf(z, rule); if (!kind) continue;
      // Never over a park: parks keep their lawns (they draw below paving).
      let parts; try { parts = clip.intersection([z.rings.map(closed)], hood); const pk = nearParks(ringBounds(z.rings[0])); if (pk.length) parts = clip.difference(parts, ...pk); parts = dry(parts, ringBounds(z.rings[0])); } catch { continue; }
      (kind === SURF_INDUSTRIAL || kind === SURF_VACANT ? mapCover.industrial : mapCover.paved).push(...parts);
      clipToTiles(parts, (t, rings) => { t.surfaces.push({ kind, rings }); counts.zoned++; });
    }
    // Rail corridors at grade: ballast and gravel, never lawn. Each track gets a 15 m strip, so
    // parallel tracks merge into the wide corridors and yards they really are.
    {
      const groups = new Map();
      for (const r of railIn) {
        if (r.bridge || r.tunnel || raisedLines.get(n.id).has(r.name)) continue;
        for (let i = 1; i < r.points.length; i++) {
          const [ax, az] = r.points[i - 1], [bx, bz] = r.points[i], l = Math.hypot(bx - ax, bz - az), mx = (ax + bx) / 2, mz = (az + bz) / 2;
          if (l < 0.5 || mx < hx0 - 20 || mx > hx1 + 20 || mz < hz0 - 20 || mz > hz1 + 20 || !n.inside(mx, mz)) continue;
          const hw = 7.5, dx = (bx - ax) / l * hw, dz = (bz - az) / l * hw, k = Math.floor(mx / TILE) + ',' + Math.floor(mz / TILE);
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k).push([[[ax - dx - dz, az - dz + dx], [ax - dx + dz, az - dz - dx], [bx + dx + dz, bz + dz - dx], [bx + dx - dz, bz + dz + dx], [ax - dx - dz, az - dz + dx]]]);
        }
      }
      for (const quads of groups.values()) {
        let parts; try { parts = clip.intersection(clip.union(...quads), hood); parts = dry(parts, ringBounds(quads.flatMap((q) => q[0]))); } catch { continue; }
        mapCover.industrial.push(...parts);
        clipToTiles(parts, (t, rings) => { t.surfaces.push({ kind: SURF_BALLAST, rings }); counts.ballast = (counts.ballast || 0) + 1; });
      }
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
  // Downtown (COVERAGE_RECTS), which the tiles otherwise leave to its hand-built city: in finished
  // downtown districts, plaza paving on downtown/business/commercial land, yards on residential land,
  // industrial yards, and alleys down the middle of the blocks.
  const coverRects = COVERAGE_RECTS.map((r) => [[[r.minX, r.minZ], [r.maxX, r.minZ], [r.maxX, r.maxZ], [r.minX, r.maxZ], [r.minX, r.minZ]]]);
  const DT = { downtown: SURF_PLAZA, business: SURF_PLAZA, commercial: SURF_PLAZA, residential: SURF_YARD, industrial: SURF_INDUSTRIAL, transport: SURF_INDUSTRIAL };
  const toTiles = (parts, kind) => { for (const p of parts) { const v = ringBounds(p[0]); if (ringArea(p[0]) < 20) continue; tileFor(Math.floor(v.x / TILE), Math.floor(v.z / TILE)).surfaces.push({ kind, rings: p.map((r) => r.slice(0, -1)) }); counts.downtown = (counts.downtown || 0) + 1; } };
  for (const n of finished) {
    const [hx0, hx1, hz0, hz1] = n.bbox;
    if (!COVERAGE_RECTS.some((r) => hx1 > r.minX && hx0 < r.maxX && hz1 > r.minZ && hz0 < r.maxZ)) continue;
    let core; try { core = clip.intersection(n.polygons.map((p) => p.map(closed)), clip.union(...coverRects)); } catch { continue; }
    if (!core.length) continue;
    for (const z of zoningIn) {
      if (!DT[z.kind]) continue;
      const v = ringBounds(z.rings[0]); if (v.x1 < hx0 || v.x0 > hx1 || v.z1 < hz0 || v.z0 > hz1) continue;
      let parts; try { parts = clip.intersection([z.rings.map(closed)], core); } catch { continue; }
      // Split large pieces along the 1 km tile grid so each lands in its own ground tile.
      for (const p of parts) { const b = ringBounds(p[0]); for (let tx = Math.floor(b.x0 / TILE); tx <= Math.floor(b.x1 / TILE); tx++) for (let tz = Math.floor(b.z0 / TILE); tz <= Math.floor(b.z1 / TILE); tz++) { const sq = [[[tx * TILE, tz * TILE], [(tx + 1) * TILE, tz * TILE], [(tx + 1) * TILE, (tz + 1) * TILE], [tx * TILE, (tz + 1) * TILE], [tx * TILE, tz * TILE]]]; let q; try { q = clip.intersection([p], sq); } catch { continue; } toTiles(q, DT[z.kind]); } }
    }
    for (const points of deriveAlleys(n, core, true)) { const m = [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2]; tileFor(Math.floor(m[0] / TILE), Math.floor(m[1] / TILE)).paths.push({ kind: PATH_ALLEY, points }); counts.downtownAlleys = (counts.downtownAlleys || 0) + 1; }
  }
  log('Ground cover in finished neighborhoods:', JSON.stringify(counts), 'planned developments:', JSON.stringify(autoStats));
  addLakefront();
}

// ---------- Parks and the lakefront ----------
// Real park features: the hand-traced lakefront (tools/lakefront.mjs), the Chicago Park District's
// facilities (ball diamonds, soccer fields, courts, playgrounds, pools and beaches at their real
// positions), docks in the harbors, and, in the strip downtown leaves to the tiles, the footprints
// and streets of downtown's own buildings so no tree grows through them.
function addLakefront() {
  const counts = {};
  const surface = (polys, kind, tag) => clipToTiles(polys.filter((p) => p.length && ringArea(p[0]) > 4), (t, rings) => { t.surfaces.push({ kind, rings }); counts[tag] = (counts[tag] || 0) + 1; });
  const path = (points, kind, tag) => { const m = points[Math.floor(points.length / 2)]; if (!inDetail(m[0], m[1]) || (inCoverage(m[0], m[1]) && !inBand(m[0], m[1]))) return; tileFor(Math.floor(m[0] / TILE), Math.floor(m[1] / TILE)).paths.push({ kind, points }); counts[tag] = (counts[tag] || 0) + 1; };
  // Trails and walks stay on dry land: lines are cut wherever they would cross the lake, a harbor or a pond.
  const landTest = polygonTester([landPoly]), wetTests = wetAll.map((w) => ({ v: w.v, test: polygonTester([w.rings]) }));
  const isDry = (x, z) => landTest(x, z) && !wetTests.some((w) => x >= w.v.x0 && x <= w.v.x1 && z >= w.v.z0 && z <= w.v.z1 && w.test(x, z));
  const dryPieces = (line) => { const out = []; let cur = []; for (let i = 1; i < line.length; i++) { const [ax, az] = line[i - 1], [bx, bz] = line[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 4)); for (let k = i === 1 ? 0 : 1; k <= n; k++) { const p = [ax + (bx - ax) * k / n, az + (bz - az) * k / n]; if (isDry(...p)) cur.push(p); else { if (cur.length > 1) out.push(cur); cur = []; } } } if (cur.length > 1) out.push(cur); return out.map((l) => l.filter((p, j) => j === 0 || j === l.length - 1 || j % 5 === 0)); };
  const LF = { parking: SURF_PARKING, paved: SURF_PAVED, plaza: SURF_PLAZA, lawn: SURF_LAWN, prairie: SURF_PRAIRIE, sand: SURF_SAND, vacant: SURF_VACANT };
  for (const f of LAKEFRONT) {
    if (f.kind === 'water') continue;
    if (f.poly) surface(parkDry(onLand([[closed(f.poly)]])), LF[f.kind], 'lakefront-' + f.kind);
    else if (f.kind === 'trail') for (const l of dryPieces(f.line)) path(l, PATH_TRAIL, 'lakefront-trail');
    else if (f.kind === 'walk') for (const l of dryPieces(f.line)) path(l, PATH_WALK, 'lakefront-walk');
    else if (f.kind === 'trees') path(f.line, PATH_TREES, 'tree-rows');
  }
  // Park District facilities in finished neighborhoods' parks (downtown's parks are hand-built).
  const facilities = existsSync(join(src, 'park-facilities.json')) ? read('park-facilities.json') : [];
  const shapes = parksIn.flatMap((p) => p.polygons.map((poly) => ({ name: p.name, v: ringBounds(poly[0]), test: polygonTester([poly]), rings: poly.map(closed) })));
  const rot = (cx, cz, a, pts) => { const c = Math.cos(a), s = Math.sin(a); return pts.map(([x, z]) => [cx + x * c - z * s, cz + x * s + z * c]); };
  const box = (cx, cz, a, w, d) => rot(cx, cz, a, [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [-w / 2, -d / 2]]);
  const disc = (cx, cz, r, n = 20) => Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos(i / n * 2 * Math.PI), cz + r * Math.sin(i / n * 2 * Math.PI)]);
  const fan = (hx, hz, a, r, n = 10) => [[hx, hz], ...Array.from({ length: n + 1 }, (_, i) => { const t = a - Math.PI / 4 + i / n * Math.PI / 2; return [hx + r * Math.cos(t), hz + r * Math.sin(t)]; }), [hx, hz]];
  const inPark = (poly, park) => { try { return clip.intersection([poly], park.rings); } catch { return []; } };
  const outline = (pts) => path(pts, PATH_LINE, 'field-lines');
  for (const f of facilities) {
    const [x, z] = f.at;
    if (!inFinished(x, z) || inCoverage(x, z) && !inBand(x, z)) continue;
    const park = shapes.find((p) => x >= p.v.x0 && x <= p.v.x1 && z >= p.v.z0 && z <= p.v.z1 && p.test(x, z)); if (!park) continue;
    // Fields line up with the park (its longest side); diamonds face the park's middle.
    const o = orientedBox(park.rings[0].slice(0, -1)), a = o.angle, toMid = Math.atan2(park.v.z - z, park.v.x - x);
    const k = f.kind;
    if (/^BASEBALL (SR|JR)/.test(k)) {
      const s = /SR/.test(k) ? 1 : 0.68, dir = Math.round((toMid - Math.PI / 4) / (Math.PI / 2)) * Math.PI / 2 + Math.PI / 4 + (a % (Math.PI / 2));
      const hx = x - Math.cos(dir) * 45 * s, hz = z - Math.sin(dir) * 45 * s;
      surface(inPark(fan(hx, hz, dir, 100 * s), park), SURF_LAWN, 'diamonds');
      surface(inPark(fan(hx, hz, dir, 37 * s), park), SURF_INFIELD, 'diamonds');
      for (const t of [-1, 1]) outline([[hx, hz], [hx + Math.cos(dir + t * Math.PI / 4) * 95 * s, hz + Math.sin(dir + t * Math.PI / 4) * 95 * s]]);
    } else if (/SOCCER|TURF REG|ART TURF/.test(k)) {
      surface(inPark(box(x, z, a, 100, 64), park), SURF_LAWN, 'pitches');
      outline(box(x, z, a, 96, 60)); outline(rot(x, z, a, [[0, -30], [0, 30]])); outline(disc(x, z, 9.15, 24));
    } else if (/TURF JR|MINI-PITCH/.test(k)) {
      surface(inPark(box(x, z, a, 56, 36), park), SURF_LAWN, 'pitches');
      outline(box(x, z, a, 52, 32)); outline(rot(x, z, a, [[0, -16], [0, 16]]));
    } else if (k === 'TENNIS COURT') {
      surface(inPark(box(x, z, a, 36, 18), park), SURF_TENNIS, 'courts');
      outline(box(x, z, a, 23.8, 11)); outline(rot(x, z, a, [[0, -5.5], [0, 5.5]]));
    } else if (/BASKETBALL COURT|PICKLEBALL|SPORT ROLLER|HANDBALL/.test(k)) {
      surface(inPark(box(x, z, a, 30, 17), park), SURF_HARDCOURT, 'courts');
      outline(box(x, z, a, 28, 15));
    } else if (k === 'VOLLEYBALL (SAND)') surface(inPark(box(x, z, a, 18, 10), park), SURF_SAND, 'volleyball');
    else if (/^PLAYGROUND|WATER PLAYGROUND|NATURAL PLAY|NATURE PLAY/.test(k)) surface(inPark(disc(x, z, 13), park), SURF_PLAY, 'playgrounds');
    else if (k === 'POOL (OUTDOOR)') { surface(inPark(box(x, z, a, 50, 30), park), SURF_PLAZA, 'pools'); surface(inPark(box(x, z, a, 28, 15), park), SURF_POOL, 'pools'); }
    else if (k === 'DOG FRIENDLY AREA') surface(inPark(box(x, z, a, 44, 30), park), SURF_VACANT, 'dog-areas');
    else if (k === 'BEACH' && Math.abs(shoreAt(z) - x) < 400) {
      // Sand from the shore up to 75 m inland, about 230 m either side of the beach's point.
      const zs = []; for (let q = z - 240; q <= z + 240; q += 20) zs.push(q);
      const band = [...zs.map((q) => [shoreAt(q) + 5, q]), ...zs.reverse().map((q) => [shoreAt(q) - 75, q])];
      surface(onLand(inPark(closed(band), park).map((p) => p)), SURF_SAND, 'beaches');
    }
  }
  // Docks in the big harbors: a spine down the middle with finger piers either side.
  for (const p of inlets) {
    if (ringArea(p[0]) < 40000) continue;
    const test = polygonTester([p.map((r) => r.slice(0, -1))]), ob = orientedBox(p[0].slice(0, -1));
    const [lx, lz, len] = ob.w >= ob.d ? [Math.cos(ob.angle), Math.sin(ob.angle), ob.w] : [-Math.sin(ob.angle), Math.cos(ob.angle), ob.d];
    const wet = (x, z, m) => test(x, z) && test(x + m, z) && test(x - m, z) && test(x, z + m) && test(x, z - m);
    for (const off of [-0.22, 0.22]) {
      // Two spines, a fifth of the harbor's width either side of its centre line.
      const wide = ob.w >= ob.d ? ob.d : ob.w, sx = -lz * off * wide, sz = lx * off * wide;
      for (let d = -len / 2 + 30; d < len / 2 - 30; d += 70) {
        const ax = ob.x + sx + lx * d, az = ob.z + sz + lz * d, bx = ax + lx * 60, bz = az + lz * 60;
        if (!wet(ax, az, 12) || !wet(bx, bz, 12)) continue;
        path([[ax, az], [bx, bz]], PATH_DOCK, 'docks');
        for (let f = 6; f < 60; f += 10) for (const side of [-1, 1]) {
          const fx = ax + lx * f, fz = az + lz * f, ex = fx - lz * side * 14, ez = fz + lx * side * 14;
          if (wet(ex, ez, 6)) path([[fx, fz], [ex, ez]], PATH_DOCK, 'docks');
        }
      }
    }
  }
  // The strip downtown leaves to the tiles: its own buildings stand on plaza footprints (no lawn or
  // trees under them) and its streets keep trees off the road.
  const dt = JSON.parse(readFileSync(join(root, 'assets', 'downtown.json'), 'utf8'));
  for (const b of dt.buildings) { const v = ringBounds(b.rings[0]); if (inBand(v.x, v.z)) surface([b.rings.map(closed)], SURF_PLAZA, 'band-footprints'); }
  for (const s of dt.streets) { const m = s.points[Math.floor(s.points.length / 2)]; if (inBand(m[0], m[1])) path(s.points, PATH_CLEAR, 'band-streets'); }
  log('Parks and lakefront:', JSON.stringify(counts));
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
  // Downtown-owned buildings (assets/downtown.json) keep their label here; their styling is downtown's.
  const downtownById = new Map(downtownForMap().map((b) => [b.id, b]));
  index.named = finished.flatMap((n) => n.named.map((d) => { const b = byId.get(d.id) || downtownById.get(d.id); if (!b) throw new Error(`${n.name}: named building ${d.id} (${d.name}) not found`); return { id: d.id, name: d.name, kind: d.kind || 'landmark', hood: n.id, x: Math.round(b.x), z: Math.round(b.z), h: Math.round(b.h) }; }));
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
  const line = SHORE_LINE;
  const wf = JSON.parse(readFileSync(join(root, 'assets', 'waterfront.json'), 'utf8')).terrain.flat(2);
  const t = { x0: Math.min(...wf.map((p) => p[0])), x1: Math.max(...wf.map((p) => p[0])), z0: Math.min(...wf.map((p) => p[1])), z1: Math.max(...wf.map((p) => p[1])) };
  // Inside the surveyed box, the parts west of the shore that waterfront.json's terrain
  // does not cover (its north and south edges are slanted), as small simple polygons.
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
