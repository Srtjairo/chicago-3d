// Chicago's expressways inside the circle, for js/expressways.js: every carriageway of the Kennedy,
// Eisenhower, Dan Ryan and Stevenson (local and express lanes, each direction its own centreline)
// and their ramps, from the City's street centrelines (pr57-gg9e) with their grade levels
// (-1 below grade in a trench, 0 at grade, 1 and 2 elevated). Lake Shore Drive has its own model
// (js/lake-shore.js) and its ramps are kept here.
//   node tools/build-expressways.mjs      -> assets/expressways.json
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './geo-source.mjs';
import { DETAIL_RADIUS } from '../js/coverage.js';

const streets = JSON.parse(readFileSync(join(root, '.cache', 'city', 'streets.json'), 'utf8'));
const MAIN = /\b(EXPY|EXPRESS RL|KENNEDY SR)\b/, RAMP = /\b[EX]R$/;
const inside = (pts) => pts.some(([x, z]) => Math.hypot(x, z) < DETAIL_RADIUS + 300);
const out = [];
for (const s of streets) {
  if (!inside(s.points) || /LAKE SHORE DR$|LAKE SHORE DR RAMP/.test(s.name)) continue;
  // Mainlines are class 1; ramps are class 7 or 9 (class 4 ramps are ordinary streets, drawn as such).
  const kind = s.class === 1 && MAIN.test(s.name) ? 'main' : (s.class === 7 || s.class === 9) && (RAMP.test(s.name) || / RAMP$/.test(s.name)) ? 'ramp' : null;
  if (!kind) continue;
  out.push({ id: s.id, name: s.name, kind, dir: s.dir, level: s.level.map((v) => Math.max(-2, Math.min(3, v | 0))), points: s.points.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]) });
}
const data = { version: 1, source: 'City of Chicago street centerlines (pr57-gg9e), with grade levels', segments: out };
writeFileSync(join(root, 'assets', 'expressways.json'), JSON.stringify(data));
console.log(`Expressways: ${out.filter((s) => s.kind === 'main').length} mainline and ${out.filter((s) => s.kind === 'ramp').length} ramp segments`);
