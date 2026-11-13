// Checks the streamed-city tiles written by tools/build-tiles.mjs.
//   node tools/check-tiles.mjs [dir]     (default: tiles/)
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { decode, encodeDetail, encodeSkyline, TILE, SKY, VERSION, FLAG_OVERRIDE } from '../js/tile-format.js';
import { inCoverage, project, unproject, CITY_RADIUS, DETAIL_RADIUS } from '../js/coverage.js';
import { polygonTester, ringBounds } from './geo-source.mjs';

const root = new URL('../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const dir = process.argv[2] || join(root, 'tiles');
assert(existsSync(join(dir, 'index.json')), 'no tiles: run node tools/build-tiles.mjs');
const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
assert.equal(index.version, VERSION); assert.equal(index.radius, CITY_RADIUS); assert.equal(index.detailRadius, DETAIL_RADIUS); assert.equal(index.tile, TILE); assert.equal(index.sky, SKY);

// Files on disk are exactly the files the index names, and their hashes match.
const named = new Set([...index.tiles.map(([x, z, h]) => `b/${x}_${z}.${h}.bin`), ...index.skyline.map(([x, z, h]) => `s/${x}_${z}.${h}.bin`), ...index.ground.map(([x, z, h]) => `g/${x}_${z}.${h}.bin`)]);
named.add(`backdrop.${index.backdrop[0]}.bin`);
const onDisk = new Set([...readdirSync(dir).filter((f) => f.startsWith('backdrop.')), ...readdirSync(join(dir, 'b')).map((f) => 'b/' + f), ...readdirSync(join(dir, 's')).map((f) => 's/' + f), ...readdirSync(join(dir, 'g')).map((f) => 'g/' + f)]);
assert.deepEqual([...onDisk].sort(), [...named].sort(), 'tile files and index disagree');

const boundary = existsSync(join(root, '.cache/city/boundary.json')) ? JSON.parse(readFileSync(join(root, '.cache/city/boundary.json'), 'utf8')) : null;
const inCity = boundary && polygonTester(boundary.polygons);
const downtownIds = new Set(JSON.parse(readFileSync(join(root, 'assets/downtown.json'), 'utf8')).buildings.map((b) => b.id));
const ids = new Set();
let buildings = 0, total = 0, largest = 0, streets = 0, over250 = [], seamShared = 0;
for (const [tx, tz, hash, bytes, count, maxH] of index.tiles) {
  const gz = readFileSync(join(dir, 'b', `${tx}_${tz}.${hash}.bin`));
  assert.equal(gz.length, bytes); assert.equal(createHash('sha256').update(gz).digest('hex').slice(0, 10), hash);
  total += bytes; largest = Math.max(largest, bytes);
  const raw = gunzipSync(gz), t = decode(raw);
  assert.equal(t.kind, 0); assert.equal(t.tx, tx); assert.equal(t.tz, tz); assert.equal(t.buildings.length, count);
  assert.deepEqual(Buffer.from(encodeDetail(t)), raw, `tile ${tx}_${tz} does not round-trip`);
  let m = 0;
  for (const b of t.buildings) {
    const id = `${b.objectId}-${b.part}`;
    assert(!ids.has(id), 'duplicate building ' + id); ids.add(id);
    assert(b.h >= 2 && b.h < 600, `height ${b.h} for ${id}`);
    if (b.h > 250 && !(b.flags & FLAG_OVERRIDE)) over250.push(id);
    const v = ringBounds(b.rings[0]);
    // Seam: downtown.json draws exactly the footprints whose centre is in COVERAGE_RECTS.
    assert(!inCoverage(v.x, v.z), 'building drawn by both downtown and tiles: ' + id);
    if (downtownIds.has(id)) seamShared++;
    assert.equal(Math.floor(v.x / TILE), tx, 'building in wrong tile ' + id); assert.equal(Math.floor(v.z / TILE), tz, 'building in wrong tile ' + id);
    if (inCity) assert(inCity(v.x, v.z), 'building outside city limits ' + id);
    assert(Math.hypot(v.x, v.z) < DETAIL_RADIUS, 'detail building outside the detail circle ' + id);
    for (const r of b.rings) assert(r.length >= 4 && r.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])), 'bad ring ' + id);
    m = Math.max(m, b.h);
  }
  assert.equal(Math.round(m), maxH);
  assert.equal(t.streets.length + t.water.length + t.parks.length, 0, 'ground features belong in ground tiles');
  buildings += t.buildings.length;
}
// Ground tiles: streets, water and parks only, none of them inside downtown.
for (const [sx, sz, hash, bytes, count] of index.ground) {
  const gz = readFileSync(join(dir, 'g', `${sx}_${sz}.${hash}.bin`)), raw = gunzipSync(gz), t = decode(raw);
  assert.equal(gz.length, bytes); assert.equal(t.kind, 0); assert.equal(t.tx, sx * SKY / TILE); assert.equal(t.tz, sz * SKY / TILE);
  assert.equal(t.buildings.length, 0); assert.equal(t.streets.length, count);
  assert.deepEqual(Buffer.from(encodeDetail(t)), raw, `ground ${sx}_${sz} does not round-trip`);
  for (const s of t.streets) { const m = s.points[Math.floor(s.points.length / 2)]; assert(!inCoverage(m[0], m[1]), 'street drawn by both downtown and tiles'); assert(s.class >= 1 && s.class <= 4); }
  streets += t.streets.length; total += bytes; largest = Math.max(largest, bytes);
}
let skyBoxes = 0;
for (const [sx, sz, hash, bytes, count] of index.skyline) {
  const gz = readFileSync(join(dir, 's', `${sx}_${sz}.${hash}.bin`)), raw = gunzipSync(gz), t = decode(raw);
  assert.equal(gz.length, bytes); assert.equal(t.kind, 1); assert.equal(t.boxes.length, count);
  assert.deepEqual(Buffer.from(encodeSkyline(t)), raw, `skyline ${sx}_${sz} does not round-trip`);
  skyBoxes += count; total += bytes; largest = Math.max(largest, bytes);
}
// The backdrop: boxes for the taller buildings beyond the detail circle, all inside the city.
{
  const [hash, bytes, count] = index.backdrop, gz = readFileSync(join(dir, `backdrop.${hash}.bin`)), raw = gunzipSync(gz), t = decode(raw);
  assert.equal(gz.length, bytes); assert.equal(t.kind, 1); assert.equal(t.boxes.length, count);
  assert.deepEqual(Buffer.from(encodeSkyline(t)), raw, 'backdrop does not round-trip');
  for (const b of t.boxes) { assert(Math.hypot(b.x, b.z) >= DETAIL_RADIUS - 50 && b.h >= 12, 'backdrop box inside the detail circle'); if (inCity) assert(inCity(b.x, b.z), 'backdrop box outside the city'); }
  assert(count > 10000, 'backdrop too sparse: ' + count); total += bytes;
  console.log(`backdrop: ${count} boxes, ${(bytes / 1e3).toFixed(0)} KB`);
}
assert(buildings > 100000 && buildings < 250000, 'unexpected building count ' + buildings);
assert(largest < 2e6, 'a tile is over 2 MB'); assert(total < 40e6, 'tiles total over 40 MB');
assert.deepEqual(over250, [], 'buildings over 250 m outside downtown need an override: ' + over250.slice(0, 10));
assert.equal(index.areas.length, 77, 'community areas');
// The flat projection stays accurate to well under a decimetre across the city (O'Hare, Hegewisch).
for (const p of [[-87.904, 41.978], [-87.54, 41.66], [-87.67, 42.01]]) { const back = unproject(project(p)); assert(Math.abs(back[0] - p[0]) * 82950 < 0.1 && Math.abs(back[1] - p[1]) * 110574 < 0.1); }
console.log(`PASS: ${buildings} buildings in ${index.tiles.length} tiles, ${streets} streets, ${skyBoxes} skyline boxes, ${index.tall.length} tall, ${index.areas.length} community areas, ${index.parks.length} parks; ${(total / 1e6).toFixed(1)} MB total, largest file ${(largest / 1e3).toFixed(0)} KB; heights ${JSON.stringify(index.heights)}`);
