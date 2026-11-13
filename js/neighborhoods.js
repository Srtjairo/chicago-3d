// Neighborhoods: the registry (assets/neighborhoods.json, from tools/build-neighborhoods.mjs),
// big 3D names for finished neighborhoods when seen from above, small labels for their named
// buildings up close, and flying to a neighborhood from the menu or the map.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

export async function loadNeighborhoods() {
  try {
    const url = new URL('../assets/neighborhoods.json', import.meta.url); url.search = new URL(import.meta.url).search;
    const r = await fetch(url); if (!r.ok) return null;
    const data = await r.json(); return data.version === 1 ? data : null;
  } catch { return null; }
}

const FINISHED = new Set(['pilot', 'done']);
const ICON = { church: '✝', museum: '◆', school: '■', library: '▤', park: '♣', venue: '♪', landmark: '●' };

const inRing = (x, z, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const inPolys = (x, z, polys) => polys.some((p) => inRing(x, z, p[0]) && !p.slice(1).some((h) => inRing(x, z, h)));

// Where Mini Fellow may walk in finished neighborhoods: their area minus water, with the real
// footprints of nearby tiles (sent by the tile worker as they load) as obstacles.
export function neighborhoodWalk(registry) {
  const areas = (registry?.neighborhoods || []).filter((n) => FINISHED.has(n.status) && n.polygons);
  const tiles = new Map(), CELL = 50;
  const inArea = (x, z) => areas.find((n) => x >= n.bbox[0] && x <= n.bbox[1] && z >= n.bbox[2] && z <= n.bbox[3] && inPolys(x, z, n.polygons));
  return {
    within: (x, z) => !!inArea(x, z),
    wet: (x, z) => { const n = inArea(x, z); return !!n?.water && inPolys(x, z, n.water); },
    obstaclesAt(x, z) { const t = tiles.get(Math.floor(x / 1000) + '_' + Math.floor(z / 1000)); return t?.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL)) || []; },
    add(key, { solids, heights }) {
      const grid = new Map(); let o = 0;
      solids.counts.forEach((n, i) => {
        const ring = []; let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (let k = 0; k < n; k++) { const x = solids.pts[(o + k) * 2], z = solids.pts[(o + k) * 2 + 1]; ring.push([x, z]); x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
        o += n;
        const b = { rings: [ring], x0: x0 - 0.45, x1: x1 + 0.45, z0: z0 - 0.45, z1: z1 + 0.45, h: heights[i], y0: 0 };
        for (let i2 = Math.floor(b.x0 / CELL); i2 <= Math.floor(b.x1 / CELL); i2++) for (let j = Math.floor(b.z0 / CELL); j <= Math.floor(b.z1 / CELL); j++) { const k = i2 + ',' + j; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(b); }
      });
      // Buildings belong to the tile of their centre, but may reach into neighbours: index by every
      // 1 km tile a cell falls in.
      for (const [k, list] of grid) { const [i2, j] = k.split(',').map(Number), key2 = Math.floor(i2 * CELL / 1000) + '_' + Math.floor(j * CELL / 1000); if (!tiles.has(key2)) tiles.set(key2, new Map()); const m = tiles.get(key2), prev = m.get(k) || []; m.set(k, prev.concat(list.map((b) => Object.assign(b, { from: key })))); }
    },
    remove(key) { for (const m of tiles.values()) for (const [k, list] of m) { const keep = list.filter((b) => b.from !== key); if (keep.length) m.set(k, keep); else m.delete(k); } },
  };
}

export function setupNeighborhoods({ scene, camera, flyer, registry, named = [] }) {
  if (!registry) return { inside: [], finished: [], flyTo() {}, update() {} };
  const inside = registry.neighborhoods.filter((n) => n.status !== 'outside' && n.label);
  const finished = inside.filter((n) => FINISHED.has(n.status));
  const areaName = Object.fromEntries(registry.areas.map((a) => [a.id, a.name]));

  function flyTo(n) {
    const [x, z] = n.label, target = new THREE.Vector3(x, 0, z);
    const size = n.bbox ? Math.max(n.bbox[1] - n.bbox[0], n.bbox[3] - n.bbox[2]) : 1500;
    const d = THREE.MathUtils.clamp(size * 0.55, 500, 1400);
    flyer.flyTo(new THREE.Vector3(x + d * 0.45, d * 0.62, z + d * 0.75), target, 2.6);
  }

  // Neighborhood names: large, letter-spaced, seen from 400 m up and within about 7 km.
  const hoodLabels = finished.map((n) => {
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'hood-tag';
    el.innerHTML = `<span>${n.display}</span><small>${areaName[n.area] && areaName[n.area] !== n.display ? areaName[n.area] : 'Chicago'}</small>`;
    el.addEventListener('click', () => flyTo(n));
    const o = new CSS2DObject(el); o.position.set(n.label[0], 70, n.label[1]); o.visible = false; scene.add(o);
    return o;
  });
  // Named buildings: small labels above the roof, within about 900 m and below 700 m altitude.
  const buildingLabels = named.map((b) => {
    const el = document.createElement('span');
    el.className = 'bldg-tag'; el.innerHTML = `<i>${ICON[b.kind] || ICON.landmark}</i>${b.name}`;
    const o = new CSS2DObject(el); o.position.set(b.x, b.h + 0.6 + 8, b.z); o.visible = false; o.userData.b = b; scene.add(o);
    return o;
  });

  let timer = 0;
  function update(dt) {
    timer -= dt; if (timer > 0) return; timer = 0.15;
    const c = camera.position, high = c.y > 400;
    for (const o of hoodLabels) o.visible = high && Math.hypot(o.position.x - c.x, o.position.z - c.z) < 7000;
    // Nearest few named buildings, only when low.
    const near = c.y < 700 ? buildingLabels.map((o) => [o, o.position.distanceTo(c)]).filter(([, d]) => d < 900).sort((a, b) => a[1] - b[1]).slice(0, innerWidth < 720 ? 3 : 7) : [];
    const show = new Set(near.map(([o]) => o));
    for (const o of buildingLabels) o.visible = show.has(o);
  }

  return { inside, finished, areaName, flyTo, update };
}
