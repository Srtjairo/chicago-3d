// Reads the OpenStreetMap areas cached by tools/fetch-osm-area.mjs and turns them into local
// features (metres, x east, z south): closed ways and multipolygon relations as polygons, open
// ways as lines, with their tags. Used by tools/build-tiles.mjs for the lakefront, and on its own
// to list what an area holds:   node tools/osm-area.mjs <name> [tag-filter]
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { project } from '../js/coverage.js';
import { root } from './geo-source.mjs';

const dir = join(root, '.cache', 'osm');

// Joins way pieces (lists of points) end to end into closed rings.
function joinRings(pieces) {
  const rings = [], open = pieces.map((p) => [...p]);
  while (open.length) {
    let ring = open.shift();
    for (let guard = 0; guard < 500 && ring.length > 1 && !(ring[0] === ring.at(-1)); guard++) {
      const i = open.findIndex((p) => p[0] === ring.at(-1) || p.at(-1) === ring.at(-1));
      if (i < 0) break;
      const p = open.splice(i, 1)[0];
      ring = ring.concat((p[0] === ring.at(-1) ? p : [...p].reverse()).slice(1));
    }
    if (ring.length >= 4 && ring[0] === ring.at(-1)) rings.push(ring);
  }
  return rings;
}

export function loadOsmArea(name) {
  const file = join(dir, `area-${name}.json.gz`);
  if (!existsSync(file)) return null;
  const { elements } = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'));
  const nodes = new Map(), ways = new Map(), out = [];
  for (const e of elements) if (e.type === 'node') nodes.set(e.id, project([e.lon, e.lat]).map((v) => Math.round(v * 10) / 10));
  for (const e of elements) if (e.type === 'way') ways.set(e.id, e);
  // Single trees (natural=tree nodes) as points.
  for (const e of elements) if (e.type === 'node' && e.tags?.natural === 'tree') out.push({ id: 'n' + e.id, tags: e.tags, point: nodes.get(e.id) });
  const pts = (ids) => ids.map((id) => nodes.get(id)).filter(Boolean);
  for (const w of ways.values()) {
    if (!w.tags) continue;
    const p = pts(w.nodes), closed = w.nodes.length > 3 && w.nodes[0] === w.nodes.at(-1);
    out.push(closed ? { id: 'w' + w.id, tags: w.tags, poly: [p.slice(0, -1)] } : { id: 'w' + w.id, tags: w.tags, line: p });
  }
  for (const r of elements) {
    if (r.type !== 'relation' || r.tags?.type !== 'multipolygon') continue;
    const pieces = (role) => r.members.filter((m) => m.type === 'way' && (m.role || 'outer') === role && ways.has(m.ref)).map((m) => ways.get(m.ref).nodes);
    const outer = joinRings(pieces('outer')), inner = joinRings(pieces('inner'));
    for (const o of outer) out.push({ id: 'r' + r.id, tags: r.tags, poly: [pts(o).slice(0, -1), ...inner.map((h) => pts(h).slice(0, -1))] });
  }
  return out;
}
export const osmAreas = () => (existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith('area-')).map((f) => f.slice(5, -8)) : []);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [name, filter] = process.argv.slice(2);
  const feats = loadOsmArea(name) || [];
  const key = (t) => ['building', 'amenity', 'leisure', 'landuse', 'natural', 'highway', 'man_made', 'waterway', 'tourism', 'historic', 'barrier', 'area:highway', 'surface'].filter((k) => t[k]).map((k) => `${k}=${t[k]}`).join(' ');
  const area = (r) => Math.abs(r.reduce((s, p, i) => s + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0) / 2);
  for (const f of feats) {
    const k = key(f.tags); if (!k || (filter && !k.includes(filter) && !(f.tags.name || '').includes(filter))) continue;
    const ring = f.poly ? f.poly[0] : f.line || [f.point], xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
    console.log(f.id, k, f.tags.name ? `"${f.tags.name}"` : '', f.poly ? `area ${Math.round(area(ring))}` : `line ${ring.length}`, `x ${Math.round(Math.min(...xs))}..${Math.round(Math.max(...xs))} z ${Math.round(Math.min(...zs))}..${Math.round(Math.max(...zs))}`);
  }
}
