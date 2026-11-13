// Shared helpers for the offline importers: cached downloads pinned by hash, line
// simplification, ring area and a fast point-in-polygon test for large polygons.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

// A lock file pins the bytes of every download. A cached response is reused as is; a fresh
// download must match the pinned hash, so an upstream change fails loudly instead of
// silently changing the model. Run with UPDATE_LOCK=1 to accept new upstream data.
export function createLock(path) {
  const pins = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  let dirty = false;
  return {
    pins,
    check(key, text) {
      const hash = sha256(text);
      if (pins[key] && pins[key] !== hash && !process.env.UPDATE_LOCK) throw new Error(`Source changed upstream: ${key}\n  pinned ${pins[key]}\n  got    ${hash}\nRe-run with UPDATE_LOCK=1 to accept it.`);
      if (pins[key] !== hash) { pins[key] = hash; dirty = true; }
    },
    save() { if (dirty) writeFileSync(path, JSON.stringify(Object.fromEntries(Object.entries(pins).sort(([a], [b]) => a.localeCompare(b))), null, 1) + '\n'); dirty = false; },
  };
}

// Fetch JSON once and keep the raw response gzipped under .cache/. `key` names the
// cache file and the lock entry; `body` switches to a form-encoded POST (long queries).
export async function cachedJson(lock, key, url, { body, tries = 4 } = {}) {
  const path = join(root, '.cache', key + '.json.gz');
  let text;
  if (existsSync(path)) text = gunzipSync(readFileSync(path)).toString('utf8');
  else {
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(180000), ...(body ? { method: 'POST', body: new URLSearchParams(body) } : {}) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        text = await r.text();
        const value = JSON.parse(text);
        if (value.error) throw new Error(JSON.stringify(value.error));
        break;
      } catch (e) {
        if (attempt >= tries) throw new Error(`${key}: ${e.message}`);
        await new Promise((ok) => setTimeout(ok, 2000 * attempt));
      }
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, gzipSync(text, { level: 9 }));
  }
  lock.check(key, text);
  return JSON.parse(text);
}

// Socrata (data.cityofchicago.org) query URL.
export const soda = (id, params) => `https://data.cityofchicago.org/resource/${id}.json?` + new URLSearchParams(params);

// Douglas-Peucker on [x,z] points (metres).
export function simplify(points, tolerance = 0.7) {
  if (points.length <= 4) return points;
  const sq = tolerance * tolerance;
  const distance = (p, a, b) => {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    return (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dz) ** 2;
  };
  const keep = new Set([0, points.length - 1]);
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = sq, at = -1;
    for (let i = a + 1; i < b; i++) { const d = distance(points[i], points[a], points[b]); if (d > best) { best = d; at = i; } }
    if (at >= 0) { keep.add(at); stack.push([a, at], [at, b]); }
  }
  return [...keep].sort((a, b) => a - b).map((i) => points[i]);
}

export const ringArea = (ring) => Math.abs(ring.reduce((s, p, j, a) => s + p[0] * a[(j + 1) % a.length][1] - p[1] * a[(j + 1) % a.length][0], 0) / 2);

export function ringBounds(ring) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  return { x0, x1, z0, z1, x: (x0 + x1) / 2, z: (z0 + z1) / 2 };
}

// Even-odd point-in-polygon for big polygons (the city boundary has thousands of
// vertices): edges are bucketed by horizontal band so each test only sees a few.
export function polygonTester(polygons, band = 50) {
  const edges = new Map();
  for (const rings of polygons) for (const ring of rings) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const z0 = Math.min(a[1], b[1]), z1 = Math.max(a[1], b[1]);
    for (let k = Math.floor(z0 / band); k <= Math.floor(z1 / band); k++) { if (!edges.has(k)) edges.set(k, []); edges.get(k).push([a[0], a[1], b[0], b[1]]); }
  }
  return (x, z) => {
    let inside = false;
    for (const [ax, az, bx, bz] of edges.get(Math.floor(z / band)) || []) {
      if ((az > z) !== (bz > z) && x < ax + (z - az) * (bx - ax) / (bz - az)) inside = !inside;
    }
    return inside;
  };
}

// GeoJSON Polygon/MultiPolygon → list of polygons (each a list of rings).
export const polygonsOf = (g) => !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
