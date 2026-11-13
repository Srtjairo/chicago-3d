// Citywide source snapshot for the streamed city (milestone M2).
// Downloads every building footprint inside the Chicago city limits plus streets, waterways,
// community areas, neighborhoods and parks; pins every response in tools/city-sources.lock.json; and writes
// projected, simplified intermediates to .cache/city/ for tools/build-tiles.mjs.
//
//   node tools/import-city-tiles.mjs            (resumable; cached pages are reused)
//
// Downtown keeps owning everything whose bounding-box centre is inside COVERAGE_RECTS
// (exactly the rule buildMeasuredCity uses), so those buildings are left out here.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { project, unproject, inCoverage, DETAIL_RADIUS } from '../js/coverage.js';
import { root, createLock, cachedJson, soda, simplify, ringArea, ringBounds, polygonTester, polygonsOf } from './geo-source.mjs';

const out = join(root, '.cache', 'city');
mkdirSync(out, { recursive: true });
const lock = createLock(join(root, 'tools', 'city-sources.lock.json'));
const write = (name, value) => { writeFileSync(join(out, name), JSON.stringify(value)); return value; };
const projectRings = (rings, tol) => rings.map((r) => simplify(r.map(project), tol)).filter((r) => r.length >= 4);
const t0 = Date.now(), log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

// 1. City limits.
const boundaryRows = await cachedJson(lock, 'city/src-boundary', soda('qqq8-j68g', { $select: 'the_geom' }));
const boundary = boundaryRows.flatMap((r) => polygonsOf(r.the_geom)).map((rings) => rings.map((r) => r.map(project)));
const inCity = polygonTester(boundary);
const all = boundary.flat(2);
const bbox = { x0: Math.min(...all.map((p) => p[0])), x1: Math.max(...all.map((p) => p[0])), z0: Math.min(...all.map((p) => p[1])), z1: Math.max(...all.map((p) => p[1])) };
write('boundary.json', { bbox, polygons: boundary });
log('City limits', JSON.stringify(bbox), boundary.length, 'polygons');

// 2. Building footprints, queried in 2 km cells that touch the city.
const CELL = 2000;
const cells = [];
for (let cx = Math.floor(bbox.x0 / CELL); cx <= Math.floor(bbox.x1 / CELL); cx++) for (let cz = Math.floor(bbox.z0 / CELL); cz <= Math.floor(bbox.z1 / CELL); cz++) {
  const r = { minX: cx * CELL, maxX: (cx + 1) * CELL, minZ: cz * CELL, maxZ: (cz + 1) * CELL };
  let touches = all.some(([x, z]) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ);
  for (let i = 0; i <= 20 && !touches; i++) for (let j = 0; j <= 20 && !touches; j++) touches = inCity(r.minX + i * CELL / 20, r.minZ + j * CELL / 20);
  if (touches) cells.push({ cx, cz, r });
}
log(cells.length, 'query cells');

const endpoint = 'https://gis.cookcountyil.gov/traditional/rest/services/buildingFootprint_2022/MapServer/0/query';
const features = new Map();
let pages = 0;
async function fetchCell({ cx, cz, r }) {
  const [w, s] = unproject([r.minX, r.maxZ]), [e, n] = unproject([r.maxX, r.minZ]);
  for (let offset = 0; ; offset += 2000) {
    const q = new URLSearchParams({ where: '1=1', geometry: [w, s, e, n].map((v) => v.toFixed(6)).join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'OBJECTID,Height', outSR: '4326', geometryPrecision: '6', f: 'geojson', orderByFields: 'OBJECTID', resultOffset: String(offset), resultRecordCount: '2000' });
    const page = await cachedJson(lock, `city/b/${cx}_${cz}_${offset}`, endpoint + '?' + q);
    for (const f of page.features) features.set(f.properties.OBJECTID, f);
    pages++;
    if (!page.exceededTransferLimit && !page.properties?.exceededTransferLimit && page.features.length < 2000) break;
  }
}
for (let i = 0; i < cells.length; i += 4) {
  await Promise.all(cells.slice(i, i + 4).map(fetchCell));
  if ((i / 4) % 10 === 0) { lock.save(); log(`cells ${Math.min(i + 4, cells.length)}/${cells.length}, pages ${pages}, footprints ${features.size}`); }
}
lock.save();
log('Footprints downloaded:', features.size);

const buildings = [];
let dropped = { small: 0, outside: 0, downtown: 0 };
for (const f of features.values()) {
  for (const [i, polygon] of polygonsOf(f.geometry).entries()) {
    const rings = projectRings(polygon, 0.7);
    if (!rings.length) continue;
    if (ringArea(rings[0]) < 35) { dropped.small++; continue; }
    const v = ringBounds(rings[0]);
    if (v.x1 - v.x0 < 2 || v.z1 - v.z0 < 2) { dropped.small++; continue; }
    if (!inCity(v.x, v.z)) { dropped.outside++; continue; }
    if (inCoverage(v.x, v.z)) { dropped.downtown++; continue; }
    const h = Number(f.properties.Height) * 0.3048;
    buildings.push([`${f.properties.OBJECTID}-${i}`, Number.isFinite(h) ? Math.round(h * 10) / 10 : null, rings]);
  }
}
buildings.sort((a, b) => (a[0] < b[0] ? -1 : 1));
write('buildings.json', buildings);
log('Buildings kept:', buildings.length, JSON.stringify(dropped));

// 3. Streets (all classes; build-tiles decides what to draw), waterways, community areas, parks.
const streetRows = [];
for (let offset = 0; ; offset += 50000) {
  const page = await cachedJson(lock, `city/src-streets-${offset}`, soda('pr57-gg9e', { $select: 'the_geom,objectid,street_nam,street_typ,pre_dir,dir_travel,fnode_id,tnode_id,f_zlev,t_zlev,class', $order: 'objectid', $limit: '50000', $offset: String(offset) }));
  streetRows.push(...page);
  if (page.length < 50000) break;
}
const streets = streetRows.flatMap((s) => (s.the_geom?.coordinates || []).map((p, i) => ({
  id: `${s.objectid}-${i}`, name: `${s.pre_dir || ''} ${s.street_nam || ''} ${s.street_typ || ''}`.trim(), road: s.street_nam || '',
  from: s.fnode_id, to: s.tnode_id, dir: s.dir_travel, level: [Number(s.f_zlev || 0), Number(s.t_zlev || 0)], class: Number(s.class || 0),
  points: simplify(p.map(project), 0.3),
}))).filter((s) => s.points.length >= 2 && s.points.some(([x, z]) => inCity(x, z)));
write('streets.json', streets);
log('Streets:', streets.length);

const waterRows = await cachedJson(lock, 'city/src-water', soda('knfe-65pw', { $select: 'the_geom,name', $limit: '50000' }));
const water = waterRows.flatMap((w) => polygonsOf(w.the_geom).map((poly) => ({ name: w.name || '', rings: projectRings(poly, 1.2) }))).filter((w) => w.rings.length);
write('water.json', water);
log('Water polygons:', water.length);

const areaRows = await cachedJson(lock, 'city/src-community-areas', soda('igwz-8jzy', { $limit: '1000' }));
const areas = areaRows.map((a) => ({ id: Number(a.area_numbe ?? a.area_num_1), name: String(a.community || '').replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()), polygons: polygonsOf(a.the_geom).map((p) => projectRings(p, 5)) }))
  .sort((a, b) => a.id - b.id);
write('areas.json', areas);
log('Community areas:', areas.length);

// Familiar neighborhood names (the City's 2012 "Neighborhoods" boundaries, 98 of them).
const hoodRows = await cachedJson(lock, 'city/src-neighborhoods', soda('y6yq-dbs2', { $select: 'the_geom,pri_neigh,sec_neigh', $limit: '1000' }));
const hoods = hoodRows.map((h) => ({ name: String(h.pri_neigh || '').trim(), sec: String(h.sec_neigh || '').trim(), polygons: polygonsOf(h.the_geom).map((p) => projectRings(p, 5)).filter((r) => r.length) }))
  .filter((h) => h.name && h.polygons.length).sort((a, b) => a.name.localeCompare(b.name));
write('neighborhoods.json', hoods);
log('Neighborhoods:', hoods.length);

const parkRows = await cachedJson(lock, 'city/src-parks', soda('ejsh-fztr', { $select: 'the_geom,park_no,park,label,acres,park_class', $limit: '5000' }));
const parks = parkRows.map((p) => ({ id: String(p.park_no ?? p.objectid ?? ''), name: String(p.park || p.label || ''), acres: Number(p.acres || 0), polygons: polygonsOf(p.the_geom).map((poly) => projectRings(poly, 1.5)).filter((r) => r.length) }))
  .filter((p) => p.polygons.length);
write('parks.json', parks);
log('Parks:', parks.length, 'over 25 acres:', parks.filter((p) => p.acres > 25).length);
// Main-line railways from OpenStreetMap (ODbL), for embankments and viaducts in finished
// neighborhoods. OSM tags the viaducts (bridge=yes) but rarely the embankments between them, so a
// main-line stretch shorter than 450 m whose both ends meet viaducts of the same line counts as
// raised (Pilsen's 16th Street embankment, for example).
{
  const [w, s0] = unproject([-DETAIL_RADIUS, DETAIL_RADIUS]), [e, n] = unproject([DETAIL_RADIUS, -DETAIL_RADIUS]);
  const q = `[out:json][timeout:180];way["railway"="rail"]["usage"~"^(main|branch)$"](${s0.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${e.toFixed(4)});out tags geom;`;
  const rows = await cachedJson(lock, 'city/src-osm-rail', 'https://overpass.kumi.systems/api/interpreter', { body: { data: q } });
  const ways = rows.elements.filter((x) => x.geometry?.length >= 2).map((x) => ({ id: x.id, name: x.tags.name || x.tags.operator || '', bridge: !!x.tags.bridge && x.tags.bridge !== 'no', tunnel: !!x.tags.tunnel && x.tags.tunnel !== 'no', points: x.geometry.map((g) => project([g.lon, g.lat])) }));
  const length = (pts) => pts.slice(1).reduce((t, p, i) => t + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
  const ends = ways.filter((r) => r.bridge).flatMap((r) => [r.points[0], r.points.at(-1)].map((p) => ({ p, name: r.name })));
  const meets = (p, name) => ends.some((b) => b.name === name && Math.hypot(b.p[0] - p[0], b.p[1] - p[1]) < 15);
  for (const r of ways) r.raised = r.bridge || (!r.tunnel && length(r.points) < 450 && meets(r.points[0], r.name) && meets(r.points.at(-1), r.name));
  write('rail.json', ways);
  log('Rail (OSM main lines):', ways.length, 'ways,', ways.filter((r) => r.bridge).length, 'viaducts,', ways.filter((r) => r.raised && !r.bridge).length, 'embankments');
}
// What fills the land between buildings, for finished neighborhoods:
//  - zoning districts (City of Chicago): residential and neighborhood-business land reads as yards
//    (storefront strips have rear yards), commercial (C) as paved lots, manufacturing and transportation as industrial yards;
//  - alleys and parking lots (OpenStreetMap, ODbL).
{
  const zoneRows = await cachedJson(lock, 'city/src-zoning', soda('dj47-wfun', { $select: 'the_geom,zone_class', $limit: '50000' }));
  const kindOf = (z) => /^R[STM]/.test(z) ? 'residential' : /^B\d/.test(z) ? 'business' : /^C\d/.test(z) ? 'commercial' : /^(M|PMD)/.test(z) ? 'industrial' : z === 'T' ? 'transport' : /^D/.test(z) ? 'downtown' : /^POS/.test(z) ? 'open' : 'planned';
  const zoning = zoneRows.flatMap((r) => polygonsOf(r.the_geom).map((p) => ({ zone: r.zone_class, kind: kindOf(r.zone_class || ''), rings: projectRings(p, 1.5) })))
    .filter((z) => z.rings.length && z.rings[0].some(([x, zz]) => Math.hypot(x, zz) < DETAIL_RADIUS));
  write('zoning.json', zoning);
  log('Zoning districts in the circle:', zoning.length);

  // Alleys and parking lots come from the OpenStreetMap cache written by tools/fetch-osm.mjs (run
  // separately; Overpass is often busy), for finished neighborhoods only.
  const registry = JSON.parse(readFileSync(join(root, 'assets', 'neighborhoods.json'), 'utf8'));
  const cached = (key) => { const f = join(root, '.cache', key + '.json.gz'); return existsSync(f) ? JSON.parse(gunzipSync(readFileSync(f)).toString('utf8')) : null; };
  const alleys = [], parking = [], missing = [];
  for (const h of registry.neighborhoods.filter((x) => (x.status === 'pilot' || x.status === 'done') && x.bbox)) {
    const ar = cached(`osm/alleys-${h.id}`), pr = cached(`osm/parking-${h.id}`);
    if (!ar || !pr) missing.push(h.display);
    if (ar) alleys.push(...ar.elements.filter((x) => x.geometry?.length >= 2).map((x) => ({ hood: h.id, points: x.geometry.map((g) => project([g.lon, g.lat])) })));
    if (pr) parking.push(...pr.elements.filter((x) => x.geometry?.length >= 4).map((x) => [simplify(x.geometry.map((g) => project([g.lon, g.lat])), 0.5)]));
  }
  write('alleys.json', alleys);
  write('parking.json', parking);
  if (missing.length) log('No OpenStreetMap cache yet (run tools/fetch-osm.mjs) for:', missing.join(', '), '- alleys will be derived there');
  if (alleys.length || parking.length) log('OSM alleys:', alleys.length, 'parking lots:', parking.length);
}
// Chicago Landmarks (City of Chicago, uct4-hrvh): designated buildings with their parcels, used by
// tools/find-named.mjs to pick each neighborhood's named buildings.
{
  const rows = await cachedJson(lock, 'city/src-landmarks', soda('uct4-hrvh', { $select: 'the_geom,id,name,address,architect,date_built', $limit: '5000' }));
  const landmarks = rows.map((r) => ({ id: r.id, name: String(r.name || '').trim(), address: r.address || '', architect: r.architect || '', built: r.date_built || '', polygons: polygonsOf(r.the_geom).map((p) => p.map((ring) => ring.map(project))) }))
    .filter((l) => l.name && l.polygons.length && l.polygons[0][0].some(([x, z]) => Math.hypot(x, z) < DETAIL_RADIUS));
  write('landmarks.json', landmarks);
  log('City landmarks in the circle:', landmarks.length);
}
// Wikidata (CC0): named places with coordinates in the circle and what they are (church building,
// stadium, theatre, museum...). A dependable source of named buildings when Overpass is busy;
// demolished ones are marked so tools/find-named.mjs can skip them.
{
  const [w, s0] = unproject([-DETAIL_RADIUS, DETAIL_RADIUS]), [e, n] = unproject([DETAIL_RADIUS, -DETAIL_RADIUS]);
  const q = `SELECT ?item ?itemLabel ?coord ?typeLabel WHERE { SERVICE wikibase:box { ?item wdt:P625 ?coord . bd:serviceParam wikibase:cornerSouthWest "Point(${w.toFixed(4)} ${s0.toFixed(4)})"^^geo:wktLiteral . bd:serviceParam wikibase:cornerNorthEast "Point(${e.toFixed(4)} ${n.toFixed(4)})"^^geo:wktLiteral . } ?item wdt:P31 ?type . SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;
  const rows = await cachedJson(lock, 'city/src-wikidata', 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q), { headers: { Accept: 'application/sparql-results+json' } });
  const byItem = new Map();
  for (const r of rows.results.bindings) {
    const id = r.item.value.split('/').pop(), m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(r.coord.value); if (!m) continue;
    if (!byItem.has(id)) { const [x, z] = project([Number(m[1]), Number(m[2])]); byItem.set(id, { id, name: r.itemLabel.value, types: [], x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 }); }
    const t = byItem.get(id); if (!t.types.includes(r.typeLabel.value)) t.types.push(r.typeLabel.value);
  }
  const places = [...byItem.values()].filter((p) => Math.hypot(p.x, p.z) < DETAIL_RADIUS && !/^Q\d+$/.test(p.name));
  write('wikidata.json', places);
  log('Wikidata places in the circle:', places.length);
}
lock.save();
log('Done.');
