// Bird's-eye map of the explorable circle, top-right corner. The image is rendered at build time
// from the same data as the 3D city (tools/minimap.mjs); this draws where you are and where you're
// looking on top of it. Click (or tap) the map to fly there; the corner button enlarges it.
import * as THREE from 'three';

// Neighborhood names stay off the map (they live in the 3D view and the Neighborhoods menu).
export function setupMinimap({ index, camera, controls, flyer }) {
  if (!index?.minimap) return { update() {}, toggle() {} };
  const R = index.radius, [hash] = index.minimap;
  const host = document.createElement('section');
  host.id = 'minimap'; host.className = 'minimap glass'; host.setAttribute('aria-label', 'Map of the explorable city');
  host.innerHTML = `<div class="minimap-disc">
      <img alt="Bird's-eye map of the modeled area: a circle 16 km across around downtown Chicago" src="${new URL(`../tiles/minimap.${hash}.png`, import.meta.url).href}">
      <canvas aria-hidden="true"></canvas>
      <span class="minimap-n" aria-hidden="true">N</span>
    </div>
    <div class="minimap-cap"><span>Explorable area · ${(2 * R / 1000).toFixed(0)} km (${(2 * R / 1609.34).toFixed(0)} mi) across</span>
      <button type="button" class="minimap-size" aria-pressed="false" aria-label="Enlarge map">⤢</button></div>`;
  document.body.append(host);
  const disc = host.querySelector('.minimap-disc'), canvas = host.querySelector('canvas'), g = canvas.getContext('2d');
  const sizeBtn = host.querySelector('.minimap-size');
  sizeBtn.onclick = () => { const big = host.classList.toggle('big'); sizeBtn.setAttribute('aria-pressed', String(big)); sizeBtn.setAttribute('aria-label', big ? 'Shrink map' : 'Enlarge map'); timer = 0; };

  // Click to fly: keep the current viewing angle and distance (up to 1.2 km) over the new spot.
  disc.addEventListener('click', (e) => {
    const r = disc.getBoundingClientRect(), u = (e.clientX - r.left) / r.width * 2 - 1, v = (e.clientY - r.top) / r.height * 2 - 1;
    if (u * u + v * v > 1) return;
    const target = new THREE.Vector3(u * R * 0.97, 0, v * R * 0.97);
    const offset = camera.position.clone().sub(controls.target);
    offset.setLength(THREE.MathUtils.clamp(offset.length(), 300, 1200)); offset.y = Math.max(offset.y, 180);
    flyer.flyTo(target.clone().add(offset), target, 2.4);
  });

  let timer = 0;
  function draw() {
    const w = disc.clientWidth, dpr = Math.min(devicePixelRatio || 1, 2), s = Math.round(w * dpr);
    if (canvas.width !== s) { canvas.width = s; canvas.height = s; }
    g.clearRect(0, 0, s, s);
    const k = s / (2 * R), P = (x, z) => [(x + R) * k, (z + R) * k];
    const t = controls.target, c = camera.position;
    const [tx, tz] = P(t.x, t.z);
    // View wedge: from the target, opening toward where the camera looks.
    const dir = Math.atan2(t.z - c.z, t.x - c.x), fov = THREE.MathUtils.degToRad(camera.fov) * camera.aspect * 0.5;
    const reach = Math.max(18 * dpr, Math.min(Math.hypot(t.x - c.x, t.z - c.z) + c.y, 6000) * k);
    const grad = g.createRadialGradient(tx, tz, 0, tx, tz, reach);
    grad.addColorStop(0, 'rgba(255,121,106,0.55)'); grad.addColorStop(1, 'rgba(255,121,106,0)');
    g.fillStyle = grad; g.beginPath(); g.moveTo(tx, tz); g.arc(tx, tz, reach, dir - fov, dir + fov); g.closePath(); g.fill();
    g.fillStyle = '#ff796a'; g.strokeStyle = '#fff'; g.lineWidth = 1.5 * dpr;
    g.beginPath(); g.arc(tx, tz, 4 * dpr, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  return {
    update(dt) { timer -= dt; if (timer > 0 || host.hidden) return; timer = 0.1; draw(); },
    toggle(show = host.hidden) { host.hidden = !show; return show; },
  };
}
