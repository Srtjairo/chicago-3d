// Offline, reproducible geographic snapshot. Network access is only needed here.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ORIGIN as origin, COVERAGE_RECTS, geographicBounds, project } from '../js/coverage.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const cache = join(root, '.cache');
mkdirSync(cache, { recursive: true });
mkdirSync(join(root, 'assets'), { recursive: true });
// Keep the original downtown source envelope stable; only query the small
// extension in addition. Padding retains roads and buildings crossing the edge.
const sourceBounds = [[-87.650,41.8654,-87.598,41.9035],...COVERAGE_RECTS.slice(1).map(r=>geographicBounds({minX:r.minX-80,maxX:r.maxX+80,minZ:r.minZ-80,maxZ:r.maxZ+80}))];
const bounds = [Math.min(...sourceBounds.map(b=>b[0])),Math.min(...sourceBounds.map(b=>b[1])),Math.max(...sourceBounds.map(b=>b[2])),Math.max(...sourceBounds.map(b=>b[3]))];
async function json(name, url) {
  const queryHash=createHash('sha256').update(url).digest('hex').slice(0,12);
  const path = join(cache, name + '-' + queryHash + '.json');
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
  const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  const value = await r.json();
  if (value.error) throw new Error(JSON.stringify(value.error));
  writeFileSync(path, JSON.stringify(value));
  return value;
}
function simplify(points, tolerance = 0.7) {
  if (points.length <= 4) return points;
  const sq = tolerance * tolerance;
  const distance = (p, a, b) => {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    return (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dz) ** 2;
  };
  const keep = new Set([0, points.length - 1]);
  const walk = (a, b) => {
    let best = sq, at = -1;
    for (let i = a + 1; i < b; i++) { const d = distance(points[i], points[a], points[b]); if (d > best) { best = d; at = i; } }
    if (at >= 0) { keep.add(at); walk(a, at); walk(at, b); }
  };
  walk(0, points.length - 1);
  return [...keep].sort((a, b) => a - b).map((i) => points[i]);
}
const endpoint = 'https://gis.cookcountyil.gov/traditional/rest/services/buildingFootprint_2022/MapServer/0/query';
const features = [];
for(const bounds of sourceBounds) {
for (let offset = 0; ; offset += 2000) {
  const q = new URLSearchParams({ where: '1=1', geometry: bounds.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'OBJECTID,Height', outSR: '4326', f: 'geojson', orderByFields: 'OBJECTID', resultOffset: String(offset), resultRecordCount: '2000' });
  const page = await json('buildings-' + offset, endpoint + '?' + q);
  features.push(...page.features);
  console.log(`Buildings: ${features.length}`);
  if (!page.exceededTransferLimit && !page.properties?.exceededTransferLimit) break;
}
}
const buildings = [];
for (const f of new Map(features.map(f=>[f.properties.OBJECTID,f])).values()) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const [i, polygon] of polys.entries()) {
    const rings = polygon.map((r) => simplify(r.map(project))).filter((r) => r.length >= 4);
    if (!rings.length) continue;
    const area = Math.abs(rings[0].reduce((s, p, j, a) => s + p[0] * a[(j + 1) % a.length][1] - p[1] * a[(j + 1) % a.length][0], 0) / 2);
    if (area < 35) continue;
    const h = Number(f.properties.Height) * 0.3048; // source elevations are US survey feet; sub-cm difference here
    buildings.push({ id: `${f.properties.OBJECTID}-${i}`, h: Math.round((h > 2 && h < 600 ? h : 12) * 10) / 10, estimated: !(h > 2 && h < 600), rings });
  }
}
const soda = (id, select, bounds) => {
  const polygon=`POLYGON((${bounds[0]} ${bounds[1]},${bounds[2]} ${bounds[1]},${bounds[2]} ${bounds[3]},${bounds[0]} ${bounds[3]},${bounds[0]} ${bounds[1]}))`;
  return 'https://data.cityofchicago.org/resource/'+id+'.json?'+new URLSearchParams({'$where':`intersects(the_geom,'${polygon}')`,'$limit':'50000','$select':select});
};
const streetPages=[];
for(const bounds of sourceBounds)streetPages.push(...await json('street-centerlines',soda('pr57-gg9e','the_geom,objectid,street_nam,street_typ,pre_dir,dir_travel,fnode_id,tnode_id,f_zlev,t_zlev,class,tiered',bounds)));
const rawStreets=[...new Map(streetPages.map(s=>[s.objectid,s])).values()];
const streets = rawStreets.flatMap((s) => (s.the_geom?.coordinates || []).map((p, i) => ({ id: `${s.objectid}-${i}`, name: `${s.pre_dir || ''} ${s.street_nam || ''} ${s.street_typ || ''}`.trim(), road: s.street_nam || '', from: s.fnode_id, to: s.tnode_id, dir: s.dir_travel, level: [Number(s.f_zlev || 0), Number(s.t_zlev || 0)], class: Number(s.class), points: simplify(p.map(project), 0.3) }))).filter((s) => s.points.length > 1);
const waterPages=[];
for(const bounds of sourceBounds)waterPages.push(...await json('waterways',soda('knfe-65pw','the_geom,name',bounds)));
const rawWater=[...new Map(waterPages.map(w=>[JSON.stringify(w.the_geom),w])).values()];
const water = rawWater.flatMap((w) => (w.the_geom.type === 'Polygon' ? [w.the_geom.coordinates] : w.the_geom.coordinates).map((poly) => ({ name: w.name || '', rings: poly.map((r) => simplify(r.map(project), 1.2)) })));
const data = { version: 1, captured: new Date().toISOString().slice(0, 10), origin, bounds, coverage: COVERAGE_RECTS, sources: [
  { name: 'Cook County GIS, Building Footprints 2022', url: endpoint.replace('/query', ''), vintage: '2022 imagery and lidar; published 2025', heightUnits: 'feet converted to metres; highest lidar point, not necessarily roof' },
  { name: 'City of Chicago, Street Center Lines', url: 'https://data.cityofchicago.org/d/pr57-gg9e', vintage: 'August 2016' },
  { name: 'City of Chicago, Waterways', url: 'https://data.cityofchicago.org/d/knfe-65pw', vintage: '2014 portal snapshot' },
], buildings, streets, water };
writeFileSync(join(root, 'assets', 'downtown.json'), JSON.stringify(data));
console.log(JSON.stringify({ buildings: buildings.length, streets: streets.length, water: water.map((w) => [w.name, w.rings.reduce((n, r) => n + r.length, 0)]), bytes: JSON.stringify(data).length }));
