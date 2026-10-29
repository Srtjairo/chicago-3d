import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { RIVER, RIVER_PATHS, LANDMARKS, distToRiver, shoreX } from '../js/geo.js';

// River rendering and building exclusion must agree along the entire centerline.
for (const key of ['main', 'north', 'south']) {
  const path = RIVER_PATHS[key];
  assert.deepEqual(path[0], RIVER[key][0]);
  assert.deepEqual(path.at(-1), RIVER[key].at(-1));
  for (const [i, point] of path.entries()) {
    assert(point.every(Number.isFinite), `${key}: nonfinite point`);
    assert(distToRiver(...point) < 0, `${key}: water excluded from river mask`);
    if (i) assert(Math.hypot(point[0] - path[i-1][0], point[1] - path[i-1][1]) > 0, `${key}: zero length segment`);
  }
}
assert.equal(new Set(LANDMARKS.map((l) => l.id)).size, LANDMARKS.length);
for (const l of LANDMARKS) {
  assert([l.x, l.z, l.h, l.roof, l.view.dist, l.view.el, l.view.az].every(Number.isFinite), l.id);
  assert(l.view.dist > 0 && l.roof > 0, l.id);
}
for (let z = -10000; z <= 10000; z += 125) assert(Number.isFinite(shoreX(z)));

// Check the actual deployable output, including all versioned dependency edges.
const root = fileURLToPath(new URL('../docs/', import.meta.url));
const { revision } = JSON.parse(readFileSync(join(root, 'revision.json'), 'utf8'));
const html = readFileSync(join(root, 'index.html'), 'utf8');
assert(html.startsWith('<!doctype html>'));
assert(html.includes(`src="js/main.js?v=${revision}"`));
let imports = 0;
for (const file of readdirSync(join(root, 'js')).filter((f) => f.endsWith('.js'))) {
  const code = readFileSync(join(root, 'js', file), 'utf8');
  for (const [, path] of code.matchAll(/from ['"]([.][^'"]+)['"]/g)) {
    const url = new URL(path, 'https://example.test/js/' + file);
    assert.equal(url.searchParams.get('v'), revision, `${file}: stale dependency`);
    assert(existsSync(join(root, url.pathname)), `${file}: missing ${url.pathname}`);
    imports++;
  }
}
console.log(`PASS: river continuity/exclusion, ${LANDMARKS.length} landmark views, ${imports} deployed imports, release ${revision}`);
