import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { LANDMARKS, toAddress } from './geo.js';
import { buildTerrain, SLAB_TOP } from './terrain.js';
import { buildLandmarks } from './landmarks.js';
import { buildCity } from './city.js';
import { buildParks } from './parks.js';
import { buildNavyPier } from './navypier.js';
import { Lighting, PRESETS } from './lighting.js';
import { Flyer, OVERVIEW, overviewPos } from './tour.js';

const $ = (id) => document.getElementById(id);
const status = (msg) => { $('load-msg').textContent = msg; };
const nextFrame = () => new Promise((r) => setTimeout(r, 16));

const mobile = matchMedia('(max-width: 720px), (pointer: coarse)').matches;
const quality = mobile
  ? { pixelRatio: Math.min(devicePixelRatio, 1.5), shadow: 2048, water: 512, samples: 2 }
  : { pixelRatio: Math.min(devicePixelRatio, 2), shadow: 4096, water: 1024, samples: 4 };

async function init() {
  const canvas = $('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(quality.pixelRatio);
  const size = () => [Math.max(1, canvas.clientWidth || innerWidth), Math.max(1, canvas.clientHeight || innerHeight)];
  renderer.setSize(...size(), false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 3, 40000);
  camera.position.copy(overviewPos(innerWidth / Math.max(1, innerHeight)));

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(OVERVIEW.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.maxPolarAngle = Math.PI * 0.485;
  controls.minDistance = 25;
  controls.maxDistance = 9000;
  controls.zoomSpeed = 1.2;
  controls.screenSpacePanning = false;

  const ctx = { quality, beacons: [], glows: [], updaters: [] };

  status('Laying out the street grid');
  await nextFrame();
  buildTerrain(scene, ctx);

  status('Raising the skyline');
  await nextFrame();
  buildLandmarks(scene, ctx);
  buildCity(scene, ctx);
  // the city adds extra rooftop beacons; rebuild the beacon mesh to include them
  rebuildBeacons(scene, ctx);

  status('Planting Grant Park');
  await nextFrame();
  buildParks(scene, ctx);
  buildNavyPier(scene, ctx);

  // Post-processing: bloom makes lit windows and beacons glow after dark
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: quality.samples });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(quality.pixelRatio);
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.2, 0.55, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  ctx.bloom = bloom;

  status('Setting the sun');
  await nextFrame();
  const lighting = new Lighting(scene, renderer, ctx);

  // Labels
  const labelRenderer = new CSS2DRenderer({ element: $('labels') });
  labelRenderer.setSize(innerWidth, innerHeight);
  const flyer = new Flyer(camera, controls);
  const labelObjs = [];
  for (const L of LANDMARKS) {
    const el = document.createElement('button');
    el.className = 'tag';
    el.type = 'button';
    el.innerHTML = `<span class="tag-dot"></span><span class="tag-name">${L.aka && L.id === 'hancock' ? 'Hancock Center' : L.name}</span>`;
    el.addEventListener('click', () => select(L.id));
    const obj = new CSS2DObject(el);
    const top = L.id === 'grantpark' || L.id === 'navypier' ? 30 : L.h + 18;
    obj.position.set(L.x, SLAB_TOP + top, L.z);
    obj.userData.L = L;
    scene.add(obj);
    labelObjs.push(obj);
  }

  // --- UI wiring ---------------------------------------------------------------
  const ui = setupUI({ flyer, lighting, controls, labelObjs });
  function select(id) {
    flyer.stopTour();
    const L = flyer.flyToLandmark(id);
    ui.showInfo(L);
  }
  ui.select = select;

  flyer.onCaption = (L) => (L ? ui.showInfo(L, true) : ui.hideInfo());
  flyer.onStop = () => { ui.setTouring(false); $('info-step').hidden = true; };

  canvas.addEventListener('pointerdown', () => {
    if (flyer.anim || flyer.tour) { flyer.cancel(); ui.setTouring(false); }
    controls.autoRotate = false;
  });

  let lastSize = '';
  const onResize = () => {
    const [w, h] = size();
    const key = w + 'x' + h;
    if (key === lastSize) return;
    lastSize = key;
    camera.aspect = w / h;
    camera.fov = w < h ? 62 : 45; // portrait screens need a wider view to fit the skyline
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.setSize(w / 2, h / 2);
    labelRenderer.setSize(w, h);
  };
  addEventListener('resize', onResize);
  new ResizeObserver(onResize).observe(canvas);
  onResize();

  const perf = adaptiveQuality({ renderer, composer, water: ctx.water, onResize: () => { lastSize = ''; onResize(); } });

  // --- render loop -------------------------------------------------------------
  const clock = new THREE.Clock();
  let time = 0;
  let addrTimer = 0;
  const tmp = new THREE.Vector3();
  function frame() {
    const raw = clock.getDelta();
    perf.tick(raw);
    const dt = Math.min(raw, 0.05);
    time += dt;
    flyer.update(dt);
    controls.update();
    // keep the camera above the ground and the target inside the city
    if (camera.position.y < 12) camera.position.y = 12;
    controls.target.x = THREE.MathUtils.clamp(controls.target.x, -5000, 4500);
    controls.target.z = THREE.MathUtils.clamp(controls.target.z, -7800, 5000); // north far enough for Wrigley Field
    controls.target.y = THREE.MathUtils.clamp(controls.target.y, 0, 600);

    lighting.update(dt, controls.target);
    const night = lighting.state.night;
    for (const fn of ctx.updaters) fn(time, night);
    if (ctx.water) ctx.water.material.uniforms.time.value += dt * 0.35;
    if (ctx.riverNormals) ctx.riverNormals.offset.set(time * 0.004, time * 0.002);
    // beacons: dim and steady by day, slow red pulse at night
    const pulse = Math.pow(Math.max(0, Math.sin(time * 2.2)), 6);
    ctx.beaconMat.color.setRGB(0.6 + (0.4 + 5 * pulse) * night, 0.03 + 0.2 * pulse * night, 0.02);

    // fade labels with distance so the screen doesn't fill with text
    for (const o of labelObjs) {
      const d = tmp.copy(o.position).distanceTo(camera.position);
      const L = o.userData.L;
      const limit = L.h < 80 ? 1400 : 9000;
      o.element.style.opacity = d > limit ? 0 : Math.min(1, (limit - d) / 300);
      o.element.style.pointerEvents = d > limit ? 'none' : 'auto';
    }

    addrTimer -= dt;
    if (addrTimer <= 0) {
      $('hud-addr').textContent = toAddress(controls.target.x, controls.target.z);
      addrTimer = 0.2;
    }

    composer.render();
    if (ui.labelsOn) labelRenderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  lighting.set(PRESETS.golden);
  ui.setTime(PRESETS.golden);
  frame();
  await nextFrame();
  $('loader').classList.add('done');
  setTimeout(() => $('loader').remove(), 900);
  window.__chicago = { scene, camera, controls, lighting, flyer, renderer, ctx, perf };
}

// Adaptive quality: when frames run slow, step down render resolution, then refresh
// the lake reflection and the shadow map only every Nth frame. Steps back up when
// there is clear headroom (high-refresh screens), so fast machines keep full quality.
function adaptiveQuality({ renderer, composer, water, onResize }) {
  const top = quality.pixelRatio;
  const tiers = [
    { pr: top, every: 1 },
    { pr: Math.min(top, 1.25), every: 1 },
    { pr: 1, every: 2 },
    { pr: 0.8, every: 2 },
    { pr: 0.65, every: 3 },
  ];
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '';
  // software rendering (hardware acceleration off) starts at the bottom
  let level = /swiftshader|llvmpipe|basic render|software/i.test(gpu) ? tiers.length - 1 : 0;
  let frameNo = 0, sum = 0, count = 0, slow = 0, settle = 2, resumed = false;
  // time spent in a background tab says nothing about rendering speed
  document.addEventListener('visibilitychange', () => { sum = count = 0; resumed = true; });

  if (water) {
    const reflect = water.onBeforeRender;
    water.onBeforeRender = function (...args) {
      if (frameNo % tiers[level].every === 0) reflect.apply(this, args);
    };
  }

  function apply() {
    const t = tiers[level];
    renderer.setPixelRatio(t.pr);
    composer.setPixelRatio(t.pr);
    renderer.shadowMap.autoUpdate = t.every === 1;
    onResize();
  }
  apply();

  return {
    gpu,
    get level() { return level; },
    set level(l) { level = THREE.MathUtils.clamp(l, 0, tiers.length - 1); apply(); },
    tick(dt) {
      frameNo++;
      if (!renderer.shadowMap.autoUpdate) renderer.shadowMap.needsUpdate = frameNo % tiers[level].every === 0;
      if (document.hidden) return;
      if (resumed) { resumed = false; return; }
      sum += Math.min(dt, 0.5); count++; // cap so one long hitch can't dominate a window
      if (sum < 1) return; // judge in ~1 s windows
      const avg = sum / count;
      sum = count = 0;
      if (settle > 0) { settle--; return; } // skip the windows right after a change
      if (avg > 1 / 45) slow++; else slow = 0;
      if (slow >= 2 && level < tiers.length - 1) { level++; slow = 0; settle = 1; apply(); }
      else if (avg < 1 / 90 && level > 0) { level--; settle = 2; apply(); }
    },
  };
}

function rebuildBeacons(scene, ctx) {
  const old = scene.children.find((c) => c.isInstancedMesh && c.material === ctx.beaconMat);
  if (!old) return;
  const mesh = new THREE.InstancedMesh(old.geometry, ctx.beaconMat, ctx.beacons.length);
  const m = new THREE.Matrix4();
  ctx.beacons.forEach((p, i) => mesh.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
  scene.remove(old);
  scene.add(mesh);
}

function setupUI({ flyer, lighting, controls, labelObjs }) {
  const ui = { labelsOn: true };
  const slider = $('time');
  const presetBtns = [...document.querySelectorAll('[data-preset]')];
  const timeLabel = $('time-label');
  const names = [[0.2, 'Midday'], [0.52, 'Golden hour'], [0.66, 'Sunset'], [0.86, 'Dusk'], [1.01, 'Night']];

  ui.setTime = (t) => {
    slider.value = String(Math.round(t * 1000));
    lighting.set(t);
    timeLabel.textContent = names.find(([lim]) => t < lim)[1];
    presetBtns.forEach((b) => b.setAttribute('aria-pressed', String(Math.abs(PRESETS[b.dataset.preset] - t) < 0.02)));
  };
  slider.addEventListener('input', () => ui.setTime(Number(slider.value) / 1000));
  presetBtns.forEach((b) => b.addEventListener('click', () => animateTime(PRESETS[b.dataset.preset])));

  let timeAnim = null;
  function animateTime(to) {
    const from = Number(slider.value) / 1000;
    const start = performance.now();
    cancelAnimationFrame(timeAnim);
    const step = (now) => {
      const k = Math.min(1, (now - start) / 1400);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      ui.setTime(from + (to - from) * e);
      if (k < 1) timeAnim = requestAnimationFrame(step);
    };
    timeAnim = requestAnimationFrame(step);
  }

  // Landmark list
  const list = $('landmark-list');
  for (const L of LANDMARKS) {
    const li = document.createElement('li');
    const metric = L.id === 'grantpark' ? `${L.acres} acres` : L.seats ? `${L.seats.toLocaleString()} seats` :L.id === 'navypier' ? `${L.ft.toLocaleString()} ft long` : `${L.ft.toLocaleString()} ft`;
    li.innerHTML = `<button type="button" data-id="${L.id}"><span class="lm-name">${L.name}</span><span class="lm-meta">${metric}</span></button>`;
    li.querySelector('button').addEventListener('click', () => { ui.select(L.id); if (mobile) $('panel').classList.remove('open'); });
    list.appendChild(li);
  }
  $('panel-toggle').addEventListener('click', () => $('panel').classList.toggle('open'));

  // Info card
  const card = $('info');
  ui.showInfo = (L, touring = false) => {
    $('info-name').textContent = L.name;
    $('info-aka').textContent = L.aka || '';
    $('info-aka').hidden = !L.aka;
    const facts = [];
    if (L.id === 'grantpark') facts.push(['Area', `${L.acres} acres`]);
    else if (L.id === 'fountain') facts.push(['Center jet', `${L.ft} ft · ${Math.round(L.h)} m`]);
    else if (L.id === 'navypier') facts.push(['Length', `${L.ft.toLocaleString()} ft`]);
    else if (L.seats) facts.push(['Capacity', L.seats.toLocaleString()], ['Center field', `${L.ft} ft · ${Math.round(L.ft * 0.3048)} m`]);
    else facts.push(['Height', `${L.ft.toLocaleString()} ft · ${Math.round(L.h)} m`]);
    facts.push([L.id === 'grantpark' ? 'Established' : 'Opened', String(L.year)]);
    facts.push(['Address', L.addr]);
    $('info-facts').innerHTML = facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    $('info-desc').textContent = L.desc;
    $('info-step').hidden = !touring;
    card.hidden = false;
    document.querySelectorAll('#landmark-list button').forEach((b) => b.classList.toggle('active', b.dataset.id === L.id));
  };
  ui.hideInfo = () => { card.hidden = true; };
  $('info-close').addEventListener('click', ui.hideInfo);

  // Tour
  const tourBtn = $('tour-btn');
  ui.setTouring = (on) => {
    tourBtn.setAttribute('aria-pressed', String(on));
    tourBtn.querySelector('span').textContent = on ? 'Stop tour' : 'Guided tour';
  };
  tourBtn.addEventListener('click', () => {
    if (flyer.tour) { flyer.cancel(); ui.setTouring(false); return; }
    flyer.startTour();
    ui.setTouring(true);
  });

  $('home-btn').addEventListener('click', () => {
    flyer.cancel();
    ui.setTouring(false);
    ui.hideInfo();
    flyer.flyTo(overviewPos(flyer.camera.aspect), OVERVIEW.target, 3);
  });

  $('labels-btn').addEventListener('click', (e) => {
    ui.labelsOn = !ui.labelsOn;
    e.currentTarget.setAttribute('aria-pressed', String(ui.labelsOn));
    $('labels').hidden = !ui.labelsOn;
  });

  $('fs-btn').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  });

  void controls; void labelObjs;
  return ui;
}

init().catch((err) => {
  console.error(err);
  status('Could not start 3D. This page needs WebGL 2 in a recent browser.');
  $('loader').classList.add('error');
});
