// Guard for the downtown touch-up: every hand-built landmark and every measured downtown building
// keeps exactly its footprint, height and position. The touch-up may add materials, lighting and
// details, never change these. Fingerprints are recorded in tools/downtown-metrics.json.
//   node tools/check-downtown-metrics.mjs            check against the recorded fingerprints
//   node tools/check-downtown-metrics.mjs --record   record them (only before the touch-up)
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { LANDMARKS } from '../js/geo.js';
import { root } from './geo-source.mjs';

const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);
const r1 = (n) => (typeof n === 'number' ? Math.round(n * 10) / 10 : n);

const metrics = {};
// Featured landmarks: position, size, height and shape parameters (everything numeric).
for (const L of LANDMARKS) metrics['landmark:' + L.id] = hash(Object.fromEntries(Object.entries(L).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, r1(v)])));
// Measured downtown footprints and heights.
for (const b of read('assets/downtown.json').buildings) metrics['building:' + b.id] = hash([r1(b.h), b.rings]);
// Hand-built sites (Rookery, Federal Reserve, Fulton Market offices...): rings and every part.
for (const s of read('assets/sites.json').sites) metrics['site:' + s.id] = hash([s.rings, s.parts.map((p) => [p.x, p.z, p.w, p.d, p.h, p.y].map(r1))]);
// Waterfront structures and landforms.
const wf = read('assets/waterfront.json');
metrics['waterfront:terrain'] = hash(wf.terrain); metrics['waterfront:land'] = hash(wf.land); metrics['waterfront:river'] = hash(wf.riverSurfaces);

const file = join(root, 'tools', 'downtown-metrics.json');
if (process.argv.includes('--record')) {
  writeFileSync(file, JSON.stringify({ recorded: new Date().toISOString().slice(0, 10), count: Object.keys(metrics).length, metrics }, null, 0) + '\n');
  console.log(`Recorded ${Object.keys(metrics).length} downtown fingerprints.`);
} else {
  assert(existsSync(file), 'no recorded fingerprints: run with --record first');
  const saved = read('tools/downtown-metrics.json').metrics;
  const changed = Object.keys(saved).filter((k) => saved[k] !== metrics[k]);
  const added = Object.keys(metrics).filter((k) => !(k in saved));
  assert.deepEqual(changed, [], 'downtown geometry changed: ' + changed.slice(0, 10).join(', '));
  assert.deepEqual(added, [], 'new downtown items without a recorded fingerprint: ' + added.slice(0, 10).join(', '));
  console.log(`PASS: ${Object.keys(saved).length} downtown landmarks, buildings, sites and landforms keep their exact measurements`);
}
