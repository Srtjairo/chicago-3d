// How a neighborhood profile (tools/neighborhood-profiles.json, copied into
// assets/neighborhoods.json) styles a building. Shared by the tile build (tools/build-tiles.mjs)
// and downtown's measured buildings (js/city-data.js), so both pick exactly the same way.

// The first rule whose limits fit the building (area in m², height in m).
export const ruleFor = (rules, h, area) => rules.find((r) => (r.minArea == null || area >= r.minArea) && (r.maxArea == null || area <= r.maxArea) && (r.maxH == null || h <= r.maxH));

// A deterministic weighted choice of facade family from a rule's `families` map.
export function pickFamily(weights, seed) {
  const e = Object.entries(weights), total = e.reduce((s, [, w]) => s + w, 0);
  let r = ((seed * 2654435761) >>> 0) % total;
  for (const [f, w] of e) { if ((r -= w) < 0) return Number(f); }
  return Number(e[0][0]);
}

const inRing = (x, z, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };

// The finished neighborhood (with a profile) containing a point, from the registry.
export function finishedNeighborhoods(registry) {
  const list = (registry?.neighborhoods || []).filter((n) => (n.status === 'done' || n.status === 'pilot') && n.profile && n.polygons && registry.profiles?.[n.profile]);
  return (x, z) => list.find((n) => x >= n.bbox[0] && x <= n.bbox[1] && z >= n.bbox[2] && z <= n.bbox[3] && n.polygons.some((p) => inRing(x, z, p[0]) && !p.slice(1).some((h) => inRing(x, z, h))));
}
