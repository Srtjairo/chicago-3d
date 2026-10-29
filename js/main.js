import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { LANDMARKS, toAddress, configureShore } from './geo.js';
import {loadWaterfront} from './waterfront-data.js';
import {buildWaterfront} from './waterfront.js';
import { loadCityData } from './city-data.js';
import { prepareWorld, buildStreets, buildWaterGeometry } from './city-world.js';
import { buildSignatureArchitecture } from './architecture.js';
import { buildOfficeArchitecture } from './offices.js';
import { buildCityLife } from './city-life.js';
import { setupExplorer } from './explorer.js';
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
  ? { pixelRatio: Math.min(devicePixelRatio, 1.25), shadow: 1024, water: 256, samples: 2 }
  : { pixelRatio: Math.min(devicePixelRatio, 1.5), shadow: 2048, water: 512, samples: 2 };

async function init() {
  const canvas = $('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.info.autoReset = false;
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

  status('Loading Chicago’s real building footprints');
  ctx.data = await loadCityData();
  ctx.waterfront=await loadWaterfront();
  configureShore(ctx.data);
  prepareWorld(ctx);

  status('Laying out the street grid');
  await nextFrame();
  buildTerrain(scene, ctx);
  buildWaterGeometry(scene, ctx);

  status('Raising the skyline');
  await nextFrame();
  buildLandmarks(scene, ctx);
  buildSignatureArchitecture(scene, ctx);
  buildOfficeArchitecture(scene, ctx);
  buildCity(scene, ctx);
  buildStreets(scene, ctx);
  // the city adds extra rooftop beacons; rebuild the beacon mesh to include them
  rebuildBeacons(scene, ctx);

  status('Planting Grant Park');
  await nextFrame();
  buildParks(scene, ctx);
  buildWaterfront(scene, ctx);
  buildNavyPier(scene, ctx);
  buildCityLife(scene, ctx, camera);

  // Keep antialiasing and color output; avoid the multi-pass bloom effect.
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: quality.samples });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(quality.pixelRatio);
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new OutputPass());

  status('Setting the sun');
  await nextFrame();
  const lighting = new Lighting(scene, renderer, ctx);

  // Labels
  const labelRenderer = new CSS2DRenderer({ element: $('labels') });
  labelRenderer.setSize(innerWidth, innerHeight);
  const flyer = new Flyer(camera, controls, ctx);
  const labelObjs = [];
  for (const L of LANDMARKS) {
    const el = document.createElement('button');
    el.className = 'tag';
    el.type = 'button';
    el.innerHTML = `<span class="tag-dot"></span><span class="tag-name">${L.aka && L.id === 'hancock' ? 'Hancock Center' : L.name}${L.labelSubtitle?`<small>${L.labelSubtitle}</small>`:''}</span>`;
    el.addEventListener('click', () => select(L.id));
    const obj = new CSS2DObject(el);
    const top = L.id === 'grantpark' || L.id === 'navypier' ? 30 : L.h + (L.labelOffset??18);
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
  const explorer = setupExplorer({ ctx, camera, controls, flyer, ui });

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
    labelRenderer.setSize(w, h);
  };
  addEventListener('resize', onResize);
  new ResizeObserver(onResize).observe(canvas);
  onResize();

  const perf = adaptiveQuality({ renderer, composer, water: ctx.water, sun: lighting.sun, onResize: () => { lastSize = ''; onResize(); } });
  // no GPU in use means a few fps whatever the tier; tell the visitor how to turn acceleration on
  if (perf.software) $('gpu-note').hidden = false;
  $('gpu-note-close').addEventListener('click', () => { $('gpu-note').hidden = true; });
  const debug = new URLSearchParams(location.search).has('debug') ? setupDebug({ renderer, scene, perf, ui }) : null;

  // --- render loop -------------------------------------------------------------
  const clock = new THREE.Clock();
  let time = 0;
  let addrTimer = 0;
  const updateLabels = labelLayout(camera, labelObjs, ui);
  function frame() {
    renderer.info.reset();
    const raw = clock.getDelta();
    debug?.begin();
    perf.tick(raw);
    // cap a single long hitch, but keep motion real-time down to 10 fps instead of slowing to a crawl
    const dt = Math.min(raw, 0.1);
    time += dt;
    flyer.update(dt);
    // OrbitControls damps once per frame; rescale so the camera glides the same at any frame rate
    controls.dampingFactor = 1 - Math.pow(1 - 0.06, dt * 60);
    controls.update();
    ctx.cityDetailUpdate?.(camera, perf.level);
    ctx.officeDetailUpdate?.(camera);
    ctx.waterfrontDetailUpdate?.(camera);
    ctx.life.update(dt);
    explorer.update(dt);
    // keep the camera above the ground and the target inside the city
    if (camera.position.y < 12) camera.position.y = 12;
    controls.target.x = THREE.MathUtils.clamp(controls.target.x, -5000, 4500);
    controls.target.z = THREE.MathUtils.clamp(controls.target.z, -5000, 5000);
    controls.target.y = THREE.MathUtils.clamp(controls.target.y, 0, 600);

    lighting.update(dt, controls.target);
    const night = lighting.state.night;
    for (const fn of ctx.updaters) fn(ctx.life.time, night);
    if (ctx.water) ctx.water.material.uniforms.time.value += dt * 0.35;
    if (ctx.riverNormals) ctx.riverNormals.offset.set(time * 0.004, time * 0.002);
    // beacons: dim and steady by day, slow red pulse at night
    ctx.beaconMat.color.setRGB(0.45 + 0.65 * night, 0.035, 0.025);

    addrTimer -= dt;
    if (addrTimer <= 0) {
      $('hud-addr').textContent = toAddress(controls.target.x, controls.target.z);
      addrTimer = 0.2;
    }

    composer.render();
    ctx.renderStats = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    if (ui.labelsOn) { updateLabels(dt); labelRenderer.render(scene, camera); }
    debug?.end(raw);
    requestAnimationFrame(frame);
  }

  lighting.set(PRESETS.golden);
  ui.setTime(PRESETS.golden);
  frame();
  await nextFrame();
  $('loader').classList.add('done');
  setTimeout(() => $('loader').remove(), 900);
  window.__chicago = { scene, camera, controls, lighting, flyer, renderer, composer, ctx, perf };
}

// Labels stay out of the panels and out of each other's way. Ten layout checks per
// second are plenty; the CSS2D renderer still tracks the camera each frame.
function labelLayout(camera, objects, ui) {
  let timer = 0;
  const projected = new THREE.Vector3();
  const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  return (dt) => {
    timer -= dt;
    if (timer > 0) return;
    timer = 0.1;
    const w = innerWidth, h = innerHeight;
    const occupied = [...document.querySelectorAll('.brand, #panel, #info, .dock, .explore')]
      .filter((e) => !e.hidden && getComputedStyle(e).opacity !== '0')
      .map((e) => { const r = e.getBoundingClientRect(); return { x: r.x - 10, y: r.y - 10, w: r.width + 20, h: r.height + 20 }; });
    const sorted = [...objects].sort((a, b) =>
      (b.userData.L.id === ui.selectedId ? 10000 : b.userData.L.h) - (a.userData.L.id === ui.selectedId ? 10000 : a.userData.L.h));
    let shown = 0;
    for (const o of sorted) {
      const L = o.userData.L, d = o.position.distanceTo(camera.position);
      projected.copy(o.position).project(camera);
      const width = o.element.offsetWidth || o.userData.width || (L.name.length * 6.4 + 26);
      o.userData.width = width;
      const height=o.element.offsetHeight||27;
      const rect = { x: (projected.x + 1) * w / 2 - width / 2, y: (1 - projected.y) * h / 2 - height/2, w: width, h: height };
      const visible = shown < (w < 720 ? 3 : 6) && d < (L.h < 80 ? 1100 : 6000)
        && projected.z > -1 && projected.z < 1 && rect.x > 8 && rect.x + rect.w < w - 8 && rect.y > 8 && rect.y + rect.h < h - 8
        && !occupied.some((r) => overlaps(rect, r));
      o.visible = visible;
      if (visible) { occupied.push({ ...rect, x: rect.x - 5, w: rect.w + 10 }); shown++; }
    }
  };
}

// Preserve antialiasing before reducing resolution. Recover on ordinary 60 Hz
// screens only after eight stable windows, avoiding rapid tier oscillation.
function adaptiveQuality({ renderer, composer, water, sun, onResize }) {
  const top = quality.pixelRatio, full = quality.shadow;
  const tiers = [
    { pr: top, every: 2, msaa: true, shadow: full },
    { pr: Math.min(top, 1.25), every: 3, msaa: true, shadow: full },
    { pr: 1, every: 3, msaa: true, shadow: full / 2 },
    { pr: 0.85, every: 4, msaa: false, shadow: full / 2, lite: true },
    { pr: 0.7, every: 4, msaa: false, shadow: full / 2, lite: true },
  ];
  const max = tiers.length - 1;
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '';
  // software rendering (hardware acceleration off) starts at the bottom
  const software = /swiftshader|llvmpipe|basic render|software/i.test(gpu);
  let level = software ? max : 0;
  let auto = true;
  let frameNo = 0, sum = 0, count = 0, slow = 0, fast = 0, settle = 2, resumed = false;
  // features the ?debug panel has switched off, on top of whatever the tier allows
  const off = { msaa: false, reflection: false, blur: false };
  // time spent in a background tab says nothing about rendering speed
  document.addEventListener('visibilitychange', () => { sum = count = 0; resumed = true; });

  if (water) {
    const reflect = water.onBeforeRender;
    let firstReflection = true;
    water.onBeforeRender = function (...args) {
      if (!off.reflection && (firstReflection || frameNo % tiers[level].every === 0)) {
        reflect.apply(this, args);
        firstReflection = false;
      }
    };
  }

  function apply() {
    const t = tiers[level];
    renderer.setPixelRatio(t.pr);
    composer.setPixelRatio(t.pr);
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    // a changed sample count only takes effect once the render targets are rebuilt
    const samples = t.msaa && !off.msaa ? quality.samples : 0;
    for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
      if (rt.samples !== samples) { rt.samples = samples; rt.dispose(); }
    }
    if (sun.shadow.mapSize.x !== t.shadow) {
      sun.shadow.mapSize.set(t.shadow, t.shadow);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    document.body.classList.toggle('lite', Boolean(t.lite || off.blur));
    onResize();
  }
  apply();

  return {
    gpu, software, off, apply, tiers,
    get level() { return level; },
    // setting a tier by hand pins it; set auto back to true to let the controller take over
    set level(l) { level = THREE.MathUtils.clamp(l, 0, max); auto = false; apply(); },
    get auto() { return auto; },
    set auto(a) { auto = a; sum = count = slow = fast = 0; settle = 1; },
    tick(dt) {
      frameNo++;
      if (document.hidden || !document.hasFocus() || !auto) { sum = count = slow = fast = 0; return; }
      if (resumed) { resumed = false; return; }
      sum += Math.min(dt, 0.5); count++; // cap so one long hitch can't dominate a window
      if (sum < 1) return; // judge in ~1 s windows
      const fps = count / sum;
      sum = count = 0;
      if (settle > 0) { settle--; return; } // skip the windows right after a change
      slow = fps < (mobile ? 27 : 45) ? slow + 1 : 0;
      fast = fps > (mobile ? 40 : 57) ? fast + 1 : 0;
      // far too slow: drop two tiers at once without waiting for a second window
      if (level < max && (fps < 25 || slow >= 2)) { level = Math.min(max, level + (fps < 25 ? 2 : 1)); slow = fast = 0; settle = 2; apply(); }
      else if (fast >= 8 && level > 0 && !software) { level--; fast = 0; settle = 4; apply(); }
    },
  };
}

// ?debug in the URL: live frame stats plus switches that turn off one cost at a time,
// to find out what makes a particular machine slow
function setupDebug({ renderer, scene, perf, ui }) {
  $('debug').hidden = false;
  renderer.info.autoReset = false; // the composer renders several passes; count the whole frame
  const stats = $('dbg-stats');

  const plain = new Map();
  const facades = [];
  scene.traverse((o) => {
    const m = o.material;
    if (!o.isMesh || !m?.userData?.facade) return;
    if (!plain.has(m)) plain.set(m, new THREE.MeshStandardMaterial({ color: m.color, roughness: m.roughness, metalness: m.metalness }));
    facades.push([o, m]);
  });
  const recompileAll = () => scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });

  const switches = [
    ['MSAA', (on) => { perf.off.msaa = !on; perf.apply(); }],
    ['Shadows', (on) => { renderer.shadowMap.enabled = on; renderer.shadowMap.needsUpdate = true; recompileAll(); }],
    ['Lake reflection', (on) => { perf.off.reflection = !on; }],
    ['UI blur', (on) => { perf.off.blur = !on; perf.apply(); }],
    ['Labels', (on) => { ui.labelsOn = on; $('labels').hidden = !on; $('labels-btn').setAttribute('aria-pressed', String(on)); }],
    ['Filler city', (on) => { scene.getObjectByName('city').visible = on; scene.getObjectByName('rooftops').visible = on; }],
    ['Window shader', (on) => facades.forEach(([o, m]) => { o.material = on ? m : plain.get(m); })],
  ];
  const box = $('dbg-switches');
  for (const [name, fn] of switches) {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" checked> ${name}`;
    label.querySelector('input').addEventListener('change', (e) => fn(e.target.checked));
    box.appendChild(label);
  }

  const tier = $('dbg-tier');
  perf.tiers.forEach((t, i) => tier.add(new Option(`${i} · px ${t.pr}${t.msaa ? '' : ' · no MSAA'}`, String(i))));
  tier.addEventListener('change', () => {
    if (tier.value === 'auto') perf.auto = true;
    else perf.level = Number(tier.value);
  });

  let frames = 0, acc = 0, js = 0, t0 = 0;
  return {
    begin() { renderer.info.reset(); t0 = performance.now(); },
    end(dt) {
      js += performance.now() - t0; frames++; acc += dt;
      if (acc < 0.5) return;
      const r = renderer.info.render, c = renderer.domElement;
      stats.textContent = [
        `${Math.round(frames / acc)} fps · ${(1000 * acc / frames).toFixed(1)} ms/frame`,
        `JS ${(js / frames).toFixed(1)} ms/frame`,
        `tier ${perf.level}${perf.auto ? ' (auto)' : ' (pinned)'} · ${c.width}×${c.height}`,
        `${r.calls} draws · ${(r.triangles / 1e6).toFixed(2)}M tris`,
        perf.gpu || 'GPU unknown',
      ].join('\n');
      frames = acc = js = 0;
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
  const ui = { labelsOn: true, selectedId: null };
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
    const metric = L.listMeta ?? (L.id === 'grantpark' ? `${L.acres} acres` : L.id === 'navypier' ? `${L.ft.toLocaleString()} ft long` : `${L.ft.toLocaleString()} ft`);
    li.innerHTML = `<button type="button" data-id="${L.id}"><span class="lm-name">${L.name}</span><span class="lm-meta">${metric}</span></button>`;
    li.querySelector('button').addEventListener('click', () => { ui.select(L.id); if (innerWidth <= 720) $('panel').classList.remove('open'); });
    list.appendChild(li);
  }
  $('panel-toggle').addEventListener('click', () => $('panel').classList.toggle('open'));

  // Info card
  const card = $('info');
  ui.showInfo = (L, touring = false) => {
    ui.selectedId = L.id;
    $('info-name').textContent = L.name;
    $('info-aka').textContent = L.aka || '';
    $('info-aka').hidden = !L.aka;
    const facts = L.facts ? [...L.facts] : [];
    if (!L.facts) {
    if (L.id === 'grantpark') facts.push(['Area', `${L.acres} acres`]);
    else if (L.id === 'fountain') facts.push(['Center jet', `${L.ft} ft · ${Math.round(L.h)} m`]);
    else if (L.id === 'navypier') facts.push(['Length', `${L.ft.toLocaleString()} ft`]);
    else facts.push(['Height', `${L.ft.toLocaleString()} ft · ${Math.round(L.h)} m`]);
    facts.push([L.id === 'grantpark' ? 'Established' : 'Opened', String(L.year)]);
    facts.push(['Address', L.addr]);
    }
    $('info-facts').innerHTML = facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    $('info-desc').textContent = L.desc;
    $('info-step').hidden = !touring;
    card.hidden = false;
    document.querySelectorAll('#landmark-list button').forEach((b) => b.classList.toggle('active', b.dataset.id === L.id));
  };
  ui.hideInfo = () => { card.hidden = true; ui.selectedId = null; document.querySelectorAll('#landmark-list button.active').forEach((b) => b.classList.remove('active')); };
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
  status(err.code==='CITY_DATA'?err.message:'Could not start 3D. Try reloading in a recent browser with graphics acceleration enabled.');
  $('loader').classList.add('error');
  const retry=document.createElement('button');retry.textContent='Reload Chicago';retry.onclick=()=>location.reload();$('loader').append(retry);
});
