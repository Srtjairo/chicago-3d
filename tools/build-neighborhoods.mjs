// Builds the neighborhood registry: Chicago's 77 official community areas, each with the familiar
// neighborhood names inside it, and how much of each lies inside the explorable circle.
//
//   node tools/build-neighborhoods.mjs        (after tools/import-city-tiles.mjs)
//
// Writes assets/neighborhoods.json (used by the build and the page) and NEIGHBORHOODS.md (the
// readable list). Hand-edited fields (status, profile, named buildings, aka) live in
// tools/neighborhood-profiles.json and are merged in here, so this file can be rebuilt any time.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import clip from './vendor/polygon-clipping.cjs';
import { CITY_RADIUS } from '../js/coverage.js';
import { root, ringArea, ringBounds, simplify } from './geo-source.mjs';

const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const areas = read('.cache/city/areas.json'), hoods = read('.cache/city/neighborhoods.json');
const config = read('tools/neighborhood-profiles.json');

const closed = (r) => { const a = r[0], b = r.at(-1); return a[0] === b[0] && a[1] === b[1] ? r : [...r, a]; };
const multi = (polygons) => polygons.map((p) => p.map(closed));
const areaOf = (mp) => mp.reduce((s, p) => s + ringArea(p[0]) - p.slice(1).reduce((h, r) => h + ringArea(r), 0), 0);
const circle = [[Array.from({ length: 129 }, (_, i) => { const a = (i % 128) / 128 * Math.PI * 2; return [Math.cos(a) * CITY_RADIUS, Math.sin(a) * CITY_RADIUS]; })]];
const slug = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const round = (mp, tol = 6) => mp.map((p) => p.map((r) => simplify(r, tol).map(([x, z]) => [Math.round(x), Math.round(z)])).filter((r) => r.length >= 4)).filter((p) => p.length);

// Label point: the interior grid point nearest the bounding-box centre (works for U shapes).
function labelPoint(mp) {
  const largest = mp.reduce((a, p) => (ringArea(p[0]) > ringArea(a[0]) ? p : a));
  const v = ringBounds(largest[0]);
  const inRing = (x, z, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  let best = null, bd = Infinity;
  for (let i = 1; i < 30; i++) for (let j = 1; j < 30; j++) {
    const x = v.x0 + (v.x1 - v.x0) * i / 30, z = v.z0 + (v.z1 - v.z0) * j / 30;
    if (!inRing(x, z, largest[0]) || largest.slice(1).some((h) => inRing(x, z, h))) continue;
    const d = (x - v.x) ** 2 + (z - v.z) ** 2; if (d < bd) { bd = d; best = [Math.round(x), Math.round(z)]; }
  }
  return best || [Math.round(v.x), Math.round(v.z)];
}

const areaPolys = areas.map((a) => ({ ...a, mp: multi(a.polygons) }));
const out = { version: 1, built: new Date().toISOString().slice(0, 10), radius: CITY_RADIUS,
  sources: ['City of Chicago, Boundaries – Community Areas (igwz-8jzy)', 'City of Chicago, Neighborhoods 2012 (y6yq-dbs2)'],
  statuses: { downtown: 'Hand-built downtown (finished)', pilot: 'Being finished now', done: 'Finished', todo: 'Inside the circle, not finished yet', outside: 'Outside the explorable circle' },
  areas: [], neighborhoods: [] };

for (const a of areaPolys) {
  const total = areaOf(a.mp), inside = areaOf(clip.intersection(a.mp, circle));
  out.areas.push({ id: a.id, name: a.name, km2: +(total / 1e6).toFixed(2), share: +(inside / total).toFixed(3), neighborhoods: [] });
}
for (const h of hoods) {
  const mp = multi(h.polygons), total = areaOf(mp);
  // Community area: the one it overlaps most; others it spills into (over 10%) are listed too.
  const overlaps = areaPolys.map((a) => ({ id: a.id, share: areaOf(clip.intersection(mp, a.mp)) / total })).filter((o) => o.share > 0.01).sort((a, b) => b.share - a.share);
  const insideMp = clip.intersection(mp, circle), share = areaOf(insideMp) / total;
  const cfg = config.neighborhoods[h.name] || {};
  const id = slug(h.name);
  const status = cfg.status || (share < 0.005 ? 'outside' : 'todo');
  const entry = {
    id, name: h.name, display: cfg.display || h.name, aka: cfg.aka || [], area: overlaps[0]?.id, alsoIn: overlaps.slice(1).filter((o) => o.share > 0.1).map((o) => o.id),
    km2: +(total / 1e6).toFixed(2), share: +share.toFixed(3), status, profile: cfg.profile || null, named: cfg.named || [], raisedRails: cfg.raisedRails || [],
  };
  if (share >= 0.005) { entry.label = cfg.label || labelPoint(insideMp); entry.polygons = round(insideMp); const all = insideMp.flatMap((p) => p[0]); const v = ringBounds(all); entry.bbox = [Math.round(v.x0), Math.round(v.x1), Math.round(v.z0), Math.round(v.z1)]; }
  out.neighborhoods.push(entry);
  out.areas.find((a) => a.id === entry.area).neighborhoods.push(id);
}
for (const name of Object.keys(config.neighborhoods)) if (!hoods.some((h) => h.name === name)) throw new Error('tools/neighborhood-profiles.json names an unknown neighborhood: ' + name);

writeFileSync(join(root, 'assets', 'neighborhoods.json'), JSON.stringify(out));

// ---------- The readable list ----------
const byId = Object.fromEntries(out.neighborhoods.map((n) => [n.id, n]));
const pct = (s) => (s >= 0.995 ? 'all' : s < 0.005 ? '—' : Math.round(s * 100) + '%');
const icon = { downtown: '✅ downtown', done: '✅ finished', pilot: '🔨 pilot', todo: '⬜ to do', outside: '· outside' };
const lines = ['# Chicago neighborhoods', '',
  `Generated by \`tools/build-neighborhoods.mjs\` on ${out.built}. The model is an explorable circle ${CITY_RADIUS / 1000} km around State & Madison.`,
  `${out.areas.length} official community areas; ${out.neighborhoods.length} familiar neighborhood names (City of Chicago boundaries).`,
  `Inside the circle: ${out.areas.filter((a) => a.share > 0.005).length} community areas and ${out.neighborhoods.filter((n) => n.status !== 'outside').length} neighborhoods.`, '',
  '| # | Community area | In circle | Neighborhoods (share in circle · status) |', '|---|---|---|---|'];
for (const a of [...out.areas].sort((x, y) => y.share - x.share || x.id - y.id)) {
  const list = a.neighborhoods.map((id) => byId[id]).sort((x, y) => y.share - x.share).map((n) => `${n.display}${n.display !== n.name ? ` (${n.name})` : ''} · ${pct(n.share)} · ${icon[n.status]}`).join('<br>');
  lines.push(`| ${a.id} | ${a.name} | ${pct(a.share)} | ${list || '—'} |`);
}
writeFileSync(join(root, 'NEIGHBORHOODS.md'), lines.join('\n') + '\n');
const inside = out.neighborhoods.filter((n) => n.status !== 'outside');
console.log(`Registry: ${out.areas.length} community areas, ${out.neighborhoods.length} neighborhoods, ${inside.length} inside the circle: ${inside.map((n) => n.display + ' ' + pct(n.share)).join(', ')}`);
