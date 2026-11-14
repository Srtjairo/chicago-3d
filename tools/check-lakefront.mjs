// Checks the lakefront and the ground cover in the built tiles (run after tools/build-tiles.mjs):
// harbors and ponds are water, the traced lakefront features are where they belong, Lake Shore
// Drive is drawn once, and finished neighborhoods aren't lawn where they are really paved.
//   node tools/check-lakefront.mjs [tilesDir]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { root } from './geo-source.mjs';
import { decode, SURF_YARD, SURF_PAVED, SURF_INDUSTRIAL, SURF_PARKING, SURF_PLAZA, SURF_LAWN, SURF_SAND, SURF_PRAIRIE, SURF_INFIELD, SURF_TENNIS, SURF_HARDCOURT, SURF_PLAY, SURF_POOL, SURF_VACANT, SURF_BALLAST, PATH_RAMP, PATH_DOCK, PATH_TRAIL } from '../js/tile-format.js';
import { inCoverage } from '../js/coverage.js';

const dir = process.argv[2] || join(root, 'tiles');
const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
const ground = index.ground.map(([sx, sz, hash]) => ({ sx, sz, ...decode(new Uint8Array(gunzipSync(readFileSync(join(dir, 'g', `${sx}_${sz}.${hash}.bin`))))) }));
const inRing = (x, z, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const hit = (x, z, rings) => inRing(x, z, rings[0]) && !rings.slice(1).some((h) => inRing(x, z, h));
const tileAt = (x, z) => ground.find((g) => g.sx === Math.floor(x / index.sky) && g.sz === Math.floor(z / index.sky));
// What is drawn on top at a point (the same height order as js/tile-worker.js ground()).
const ORDER = [SURF_YARD, 'park', SURF_PAVED, SURF_INDUSTRIAL, SURF_VACANT, SURF_BALLAST, SURF_PLAZA, SURF_LAWN, SURF_PRAIRIE, SURF_SAND, SURF_INFIELD, SURF_TENNIS, SURF_HARDCOURT, SURF_PLAY, SURF_POOL, SURF_PARKING, 'water'];
function top(x, z) {
  const t = tileAt(x, z); if (!t) return null;
  if (t.water.some((w) => hit(x, z, w.rings))) return 'water';
  let best = null;
  for (const s of t.surfaces) if (hit(x, z, s.rings) && ORDER.indexOf(s.kind) > ORDER.indexOf(best)) best = s.kind;
  if (t.parks.some((p) => hit(x, z, p.rings)) && ORDER.indexOf('park') > ORDER.indexOf(best)) best = 'park';
  return best;
}
const NAME = { [SURF_YARD]: 'yard', [SURF_PAVED]: 'paved', [SURF_INDUSTRIAL]: 'industrial', [SURF_PARKING]: 'parking', [SURF_PLAZA]: 'plaza', [SURF_LAWN]: 'lawn', [SURF_SAND]: 'sand', [SURF_PRAIRIE]: 'prairie', [SURF_VACANT]: 'vacant', [SURF_BALLAST]: 'ballast' };
const expect = (label, x, z, want) => { const got = top(x, z); assert(want.includes(NAME[got] ?? got), `${label} (${x}, ${z}): expected ${want.join(' or ')}, got ${NAME[got] ?? got}`); };

// Harbors and ponds are water (the land used to cover them).
expect('Burnham Harbor', 1350, 2500, ['water']);
expect('Belmont Harbor', -820, -6820, ['water']);
expect('Northerly Island pond', 1665, 2895, ['water']);
// The traced lakefront.
expect('Soldier Field South Lot', 1120, 2800, ['parking']);
expect('Soldier Field plaza', 1060, 2200, ['plaza']);
expect('North Lawn (garage roof)', 940, 1920, ['lawn']);
expect('Northerly Island prairie', 1680, 2620, ['prairie']);
expect('The 78 (vacant)', -400, 2000, ['vacant']);
// Beaches, docks, the trail and Lake Shore Drive's ramps exist.
const all = (f) => ground.flatMap(f);
const count = (kind) => all((g) => g.surfaces.filter((s) => s.kind === kind)).length;
const paths = (kind) => all((g) => g.paths.filter((p) => p.kind === kind)).length;
assert(count(SURF_SAND) >= 4, 'beaches missing');
assert(paths(PATH_DOCK) > 100, 'harbor docks missing');
assert(paths(PATH_TRAIL) >= 1, 'Lakefront Trail missing');
assert(paths(PATH_RAMP) > 30, 'Lake Shore Drive ramps missing');
for (const k of [SURF_INFIELD, SURF_TENNIS, SURF_HARDCOURT, SURF_PLAY, SURF_POOL]) assert(count(k) > 10, `park facility surfaces missing (kind ${k})`);
// Lake Shore Drive is drawn by js/lake-shore.js; the tiles keep only its far ends.
const lsd = all((g) => g.streets.filter((s) => /LAKE SHORE/.test(s.name) && s.class === 1 && s.points.every(([, z]) => z > -5300 && z < 4700)));
assert.equal(lsd.length, 0, `Lake Shore Drive drawn twice: ${lsd.length} centreline pieces in the tiles`);
// Green share of the Near South Side (outside downtown): mostly paved, as it really is.
{
  const reg = JSON.parse(readFileSync(join(root, 'assets', 'neighborhoods.json'), 'utf8'));
  const n = reg.neighborhoods.find((h) => h.id === 'near-south-side'), [x0, x1, z0, z1] = n.bbox;
  let total = 0, green = 0;
  for (let x = x0; x < x1; x += 40) for (let z = z0; z < z1; z += 40) {
    if (inCoverage(x, z) || !n.polygons.some((p) => hit(x, z, p))) continue;
    const t = top(x, z); if (t == null || t === 'water') continue;
    total++; if (t === SURF_YARD || t === 'park' || t === SURF_LAWN) green++;
  }
  const share = green / total;
  assert(share < 0.45, `Near South Side is ${(share * 100).toFixed(0)}% green ground (expected under 45%)`);
  console.log(`Near South Side green ground: ${(share * 100).toFixed(0)}% of ${total} samples`);
}
console.log('PASS: harbors, ponds, lakefront features, beaches, docks, ramps and Lake Shore Drive are in place');
