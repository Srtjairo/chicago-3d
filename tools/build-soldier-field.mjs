// Soldier Field's building parts (OpenStreetMap, ODbL: the stadium relation's parts and the
// seating bowl, each with its mapped height) and its pitch, for js/soldier-field.js.
//   node tools/fetch-osm-area.mjs soldier-field 600 1550 1950 3500   (once)
//   node tools/build-soldier-field.mjs          -> assets/soldier-field.json
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './geo-source.mjs';
import { loadOsmArea } from './osm-area.mjs';

const feats = loadOsmArea('soldier-field');
if (!feats) throw new Error('no OpenStreetMap cache for soldier-field: run tools/fetch-osm-area.mjs first');
// The stadium's footprint (Cook County id 937968-0) spans x 814..1033, z 1984..2339.
const inside = (r) => r.every(([x, z]) => x > 800 && x < 1045 && z > 1975 && z < 2350);
const round = (r) => r.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
const parts = feats.filter((f) => f.poly && (f.tags.building === 'yes' || f.tags.building === 'stadium' || f.tags['building:part']) && !f.tags.name && inside(f.poly[0]))
  .filter((f) => f.tags.building !== 'stadium') // the stadium relation's outlines repeat its parts
  .map((f) => ({ id: f.id, h: Number(f.tags.height) || 20, rings: f.poly.map(round) }));
const pitch = feats.find((f) => f.poly && f.tags.leisure === 'pitch' && inside(f.poly[0]));
if (!pitch || parts.length < 8) throw new Error(`Soldier Field parts missing (${parts.length} parts, pitch ${!!pitch})`);
const out = { source: '© OpenStreetMap contributors (ODbL): Soldier Field building parts and heights', footprintId: '937968-0', pitch: round(pitch.poly[0]), parts };
writeFileSync(join(root, 'assets', 'soldier-field.json'), JSON.stringify(out));
console.log(`Soldier Field: ${parts.length} parts (${[...new Set(parts.map((p) => p.h))].sort((a, b) => a - b).join(', ')} m), pitch`);
