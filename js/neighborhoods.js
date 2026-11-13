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
