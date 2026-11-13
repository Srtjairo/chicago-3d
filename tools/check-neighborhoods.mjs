// Checks the neighborhood registry (assets/neighborhoods.json), the hand-edited settings
// (tools/neighborhood-profiles.json) and how finished neighborhoods reached the tiles.
//   node tools/check-neighborhoods.mjs
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CITY_RADIUS } from '../js/coverage.js';
import { root } from './geo-source.mjs';

const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const reg = read('assets/neighborhoods.json'), cfg = read('tools/neighborhood-profiles.json');
const inRing = (x, z, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const inPolys = (x, z, polys) => polys.some((p) => inRing(x, z, p[0]) && !p.slice(1).some((h) => inRing(x, z, h)));
const FINISHED = ['pilot', 'done'];

// Registry shape: 77 community areas, every neighborhood in exactly one of them.
assert.equal(reg.version, 1); assert.equal(reg.radius, CITY_RADIUS);
assert.equal(reg.areas.length, 77, 'community areas');
assert.deepEqual(reg.areas.map((a) => a.id).sort((a, b) => a - b), Array.from({ length: 77 }, (_, i) => i + 1));
assert(reg.neighborhoods.length >= 90, 'neighborhoods: ' + reg.neighborhoods.length);
const listed = reg.areas.flatMap((a) => a.neighborhoods);
assert.equal(new Set(listed).size, listed.length, 'a neighborhood listed in two areas');
assert.deepEqual([...listed].sort(), reg.neighborhoods.map((n) => n.id).sort(), 'every neighborhood belongs to an area');
for (const n of reg.neighborhoods) {
  assert(reg.areas.find((a) => a.id === n.area).neighborhoods.includes(n.id), n.name);
  assert(Object.keys(reg.statuses).includes(n.status), `${n.name}: status ${n.status}`);
  assert((n.status === 'outside') === (n.share < 0.005), `${n.name}: outside status must match its share in the circle`);
  if (n.status !== 'outside') { assert(n.label && n.polygons?.length && n.bbox, `${n.name}: label/polygons`); assert(Math.hypot(...n.label) < CITY_RADIUS + 50, `${n.name}: label outside the circle`); }
}
// Every hand-edited key is a real neighborhood (build-neighborhoods also refuses unknown names).
for (const name of Object.keys(cfg.neighborhoods)) assert(reg.neighborhoods.some((n) => n.name === name), 'unknown neighborhood in profiles: ' + name);

// Profiles: rule lists that always match something, with valid families and roofs.
for (const [key, p] of Object.entries(cfg.profiles)) {
  assert(p.rules?.length, key + ': rules');
  const last = p.rules.at(-1); assert(last.minArea == null && last.maxArea == null && last.maxH == null, key + ': the last rule must match every building');
  for (const r of p.rules) {
    assert(['flat', 'gable', 'cornice', 'open', 'greenhouse', undefined].includes(r.roof), key + ': roof ' + r.roof);
    const fams = Object.entries(r.families); assert(fams.length, key + ': families');
    for (const [f, w] of fams) assert(Number(f) >= 0 && Number(f) < 32 && w > 0, `${key}: family ${f} weight ${w}`);
  }
}

// Finished neighborhoods: profile, label inside, named buildings that reached the tiles nearby.
const tiles = existsSync(join(root, 'tiles', 'index.json')) ? read('tiles/index.json') : null;
const rails = existsSync(join(root, '.cache', 'city', 'rail.json')) ? read('.cache/city/rail.json') : null;
const done = reg.neighborhoods.filter((n) => FINISHED.includes(n.status));
assert(done.length >= 1, 'no finished or pilot neighborhood');
let named = 0;
for (const n of done) {
  assert(n.profile && cfg.profiles[n.profile], `${n.name}: profile`);
  assert(inPolys(n.label[0], n.label[1], n.polygons), `${n.name}: label point outside its own area`);
  // Neighborhoods mostly inside the circle need named buildings; small slivers may have none.
  assert(n.named.length >= (n.km2 * n.share >= 1 ? 3 : 0), `${n.name}: needs named buildings`);
  assert(Array.isArray(n.water), `${n.name}: water for Mini Fellow`);
  for (const b of n.named) {
    assert(/^\d+-\d+$/.test(b.id) && b.name && b.family >= 0 && b.family < 32, `${n.name}: named ${JSON.stringify(b)}`);
    if (b.front) assert('NESW'.includes(b.front), `${b.name}: front`);
    if (tiles) {
      const t = tiles.named.find((x) => x.id === b.id); assert(t, `${b.name} (${b.id}) is not in the tiles: rebuild with tools/build-tiles.mjs`);
      const near = [[0, 0], [80, 0], [-80, 0], [0, 80], [0, -80]].some(([dx, dz]) => inPolys(t.x + dx, t.z + dz, n.polygons));
      assert(near, `${b.name}: footprint is not in ${n.display}`);
      named++;
    }
  }
  if (rails) for (const name of n.raisedRails || []) assert(rails.some((r) => r.name === name), `${n.name}: raised rail line "${name}" not found in OSM data`);
}
if (tiles) assert.equal(tiles.named.length, named, 'tiles name buildings that the registry does not');
const md = readFileSync(join(root, 'NEIGHBORHOODS.md'), 'utf8');
for (const a of reg.areas) assert(md.includes(`| ${a.id} | ${a.name} |`), 'NEIGHBORHOODS.md is out of date: run tools/build-neighborhoods.mjs');
console.log(`PASS: ${reg.areas.length} community areas, ${reg.neighborhoods.length} neighborhoods (${reg.neighborhoods.filter((n) => n.status !== 'outside').length} inside the circle); finished: ${done.map((n) => `${n.display} (${n.named.length} named)`).join(', ')}`);
