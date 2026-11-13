// Lists candidate named buildings for a neighborhood, matched to real footprints, to choose from
// when filling `named` in tools/neighborhood-profiles.json.
//   node tools/find-named.mjs <neighborhood id or name> [--json]
// Sources: Chicago Landmarks (City of Chicago) and OpenStreetMap named buildings (ODbL, from the
// tools/fetch-osm.mjs cache). Footprints: the streamed tiles, plus assets/downtown.json downtown.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { decode } from '../js/tile-format.js';
import { project } from '../js/coverage.js';
import { root, ringArea, ringBounds } from './geo-source.mjs';

const arg = process.argv[2], asJson = process.argv.includes('--json');
if (!arg) { console.log('usage: node tools/find-named.mjs <neighborhood id or name> [--json]'); process.exit(1); }
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const reg = read('assets/neighborhoods.json');
const hood = reg.neighborhoods.find((n) => n.id === arg || n.name.toLowerCase() === arg.toLowerCase() || n.display.toLowerCase() === arg.toLowerCase());
if (!hood?.polygons) { console.log('unknown neighborhood (or outside the circle): ' + arg); process.exit(1); }
const inRing = (x, z, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const inHood = (x, z) => hood.polygons.some((p) => inRing(x, z, p[0]) && !p.slice(1).some((h) => inRing(x, z, h)));
const [hx0, hx1, hz0, hz1] = hood.bbox;

// Footprints near the neighborhood.
const footprints = [];
const index = read('tiles/index.json');
for (const [tx, tz, hash] of index.tiles) {
  if ((tx + 1) * 1000 < hx0 - 200 || tx * 1000 > hx1 + 200 || (tz + 1) * 1000 < hz0 - 200 || tz * 1000 > hz1 + 200) continue;
  for (const b of decode(gunzipSync(readFileSync(join(root, 'tiles', 'b', `${tx}_${tz}.${hash}.bin`)))).buildings) footprints.push({ id: `${b.objectId}-${b.part}`, h: b.h, rings: b.rings, src: 'tiles' });
}
for (const b of read('assets/downtown.json').buildings) footprints.push({ id: b.id, h: b.h, rings: b.rings, src: 'downtown' });
for (const f of footprints) { const v = ringBounds(f.rings[0]); f.x = v.x; f.z = v.z; f.area = ringArea(f.rings[0]); f.v = v; }
const near = footprints.filter((f) => f.x > hx0 - 100 && f.x < hx1 + 100 && f.z > hz0 - 100 && f.z < hz1 + 100);
const containing = (x, z) => near.filter((f) => x >= f.v.x0 && x <= f.v.x1 && z >= f.v.z0 && z <= f.v.z1 && inRing(x, z, f.rings[0]));
const nearest = (x, z, max) => near.map((f) => [f, Math.hypot(f.x - x, f.z - z)]).filter(([, d]) => d < max).sort((a, b) => a[1] - b[1])[0]?.[0];

const KINDS = [
  ['church', /church|cathedral|parish|chapel|temple|synagogue|mosque|basilica|iglesia|st\.|saint /i],
  ['stadium', /stadium|field$|ballpark|wrigley|soldier field/i], ['greenhouse', /conservatory|greenhouse/i],
  ['museum', /museum|gallery|art institute/i], ['library', /library/i],
  ['venue', /theat|\bhall\b|auditorium|arena|ballroom/i], ['school', /school|academy|college|university|institute/i],
  ['park', /field ?house|park district|boathouse|pavilion/i],
];
const FAMILY = { church: 10, stadium: 6, greenhouse: 26, museum: 9, library: 8, school: 8, venue: 6, park: 6, landmark: 9 };
const kindOf = (name, tags = {}) => (tags.amenity === 'place_of_worship' || tags.building === 'church' || tags.building === 'cathedral') ? 'church'
  : tags.leisure === 'stadium' || tags.building === 'stadium' ? 'stadium' : tags.tourism === 'museum' ? 'museum' : tags.amenity === 'library' ? 'library'
  : ['school', 'college', 'university'].includes(tags.amenity) || ['school', 'university', 'college'].includes(tags.building) ? 'school'
  : (KINDS.find(([, re]) => re.test(name)) || ['landmark'])[0];

const out = new Map();
const add = (f, c) => { if (!f || out.has(f.id)) return; out.set(f.id, { ...c, id: f.id, h: Math.round(f.h), area: Math.round(f.area), src: f.src, family: FAMILY[c.kind] }); };
// 1. Chicago Landmarks: the largest footprint whose centre is in the landmark's parcel.
for (const l of existsSync(join(root, '.cache/city/landmarks.json')) ? read('.cache/city/landmarks.json') : []) {
  const parcel = l.polygons[0][0], v = ringBounds(parcel);
  if (!inHood(v.x, v.z)) continue;
  const inside = near.filter((f) => f.x >= v.x0 && f.x <= v.x1 && f.z >= v.z0 && f.z <= v.z1 && inRing(f.x, f.z, parcel)).sort((a, b) => b.area - a.area);
  add(inside[0] || containing(v.x, v.z)[0] || nearest(v.x, v.z, 30), { name: l.name, kind: kindOf(l.name), source: `City landmark ${l.id}`, note: [l.architect, l.built].filter(Boolean).join(', ') });
}
// 2. OpenStreetMap named buildings.
const osmFile = join(root, '.cache', `osm/named-${hood.id}.json.gz`);
const osm = existsSync(osmFile) ? JSON.parse(gunzipSync(readFileSync(osmFile)).toString('utf8')).elements : [];
const WANT = (t) => t.amenity === 'place_of_worship' || ['school', 'college', 'university', 'library', 'theatre', 'arts_centre', 'hospital', 'community_centre'].includes(t.amenity) || t.tourism === 'museum' || t.leisure === 'stadium' || t.historic || ['church', 'cathedral', 'stadium', 'school', 'university', 'public', 'civic', 'train_station'].includes(t.building);
for (const e of osm) {
  if (!e.center || !WANT(e.tags)) continue;
  const [x, z] = project([e.center.lon, e.center.lat]);
  if (!inHood(x, z)) continue;
  add(containing(x, z).sort((a, b) => b.area - a.area)[0] || nearest(x, z, 25), { name: e.tags.name, kind: kindOf(e.tags.name, e.tags), source: `OSM ${e.type}/${e.id}`, note: [e.tags.amenity, e.tags.building].filter(Boolean).join(' ') });
}
const list = [...out.values()].sort((a, b) => (a.source.startsWith('City') ? 0 : 1) - (b.source.startsWith('City') ? 0 : 1) || b.h - a.h);
if (asJson) console.log(JSON.stringify(list, null, 1));
else {
  console.log(`${hood.display} (${hood.id}): ${list.length} candidates; OSM named cache ${osm.length ? 'present' : 'MISSING (run tools/fetch-osm.mjs)'}`);
  for (const c of list) console.log(`${c.kind.padEnd(10)} ${String(c.h).padStart(4)} m ${String(c.area).padStart(6)} m2  ${c.id.padEnd(12)} ${c.name}  [${c.source}${c.note ? '; ' + c.note : ''}]`);
}
