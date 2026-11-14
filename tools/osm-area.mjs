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
  // Single trees (natural=tree) and street lamps (highway=street_lamp) as points.
  for (const e of elements) if (e.type === 'node' && (e.tags?.natural === 'tree' || e.tags?.highway === 'street_lamp')) out.push({ id: 'n' + e.id, tags: e.tags, point: nodes.get(e.id) });
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
// Lake Michigan's mapped shoreline inside an area: the lake relation's outline pieces joined into
// open chains (local metres), in the relation's direction.
export function loadLakeShore(name) {
  const file = join(dir, `area-${name}.json.gz`);
  if (!existsSync(file)) return [];
  const { elements } = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'));
  const lake = elements.find((e) => e.type === 'relation' && e.tags?.name === 'Lake Michigan');
  if (!lake) return [];
  const nodes = new Map(), ways = new Map();
  for (const e of elements) if (e.type === 'node') nodes.set(e.id, e); else if (e.type === 'way') ways.set(e.id, e);
  const pieces = lake.members.filter((m) => m.type === 'way' && ways.has(m.ref)).map((m) => [...ways.get(m.ref).nodes]);
  const chains = [];
  while (pieces.length) {
    let c = pieces.shift(), grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < pieces.length; i++) {
        const p = pieces[i];
        if (p[0] === c.at(-1)) c = c.concat(p.slice(1)); else if (p.at(-1) === c[0]) c = p.concat(c.slice(1));
        else if (p.at(-1) === c.at(-1)) c = c.concat([...p].reverse().slice(1)); else if (p[0] === c[0]) c = [...p].reverse().concat(c.slice(1));
        else continue;
        pieces.splice(i, 1); grew = true; break;
      }
    }
    const pts = c.map((id) => nodes.get(id)).filter(Boolean).map((n) => project([n.lon, n.lat]).map((v) => Math.round(v * 10) / 10));
    if (pts.length > 1) chains.push(pts);
  }
  return chains;
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
