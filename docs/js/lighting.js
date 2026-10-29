import * as THREE from 'three';
import { uNight } from './textures.js?v=24f1a2e542d1b3b4';
import { LANDMARKS, PLAZAS } from './geo.js?v=24f1a2e542d1b3b4';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Time of day runs from 0 (midday) to 1 (night). Values between keyframes are interpolated.
const KEYS = [
  { t: 0.00, env: 0.85, el: 48, az: 20, sun: 2.4, sunC: '#fff1dc', hemi: 1.4, sky: '#bfd5e8', gnd: '#8a8072', exp: 0.95, fog: '#b7cad7', fogD: 0.00011, night: 0, turb: 2.5, ray: 1.0, gain: 0.48, water: '#24586b' },
  { t: 0.42, env: 0.65, el: 12, az: -58, sun: 2.25, sunC: '#ffd2a0', hemi: 1.1, sky: '#b8c5db', gnd: '#82736a', exp: 0.98, fog: '#c5b6a9', fogD: 0.000115, night: 0.01, turb: 3.2, ray: 1.8, gain: 0.48, water: '#254d60' },
  { t: 0.60, env: 0.4, el: 1.2, az: -68, sun: 1.4, sunC: '#ffb37d', hemi: 0.85, sky: '#9aa7c6', gnd: '#625966', exp: 1.0, fog: '#b5a0ab', fogD: 0.00013, night: 0.28, turb: 5, ray: 2.5, gain: 0.48, water: '#294858' },
  { t: 0.76, env: 0.25, el: -5, az: -76, sun: 0, sunC: '#ff986a', hemi: 0.7, sky: '#899cbb', gnd: '#424350', exp: 1.05, fog: '#414f6a', fogD: 0.00014, night: 0.8, turb: 3, ray: 1.4, gain: 0.45, water: '#1b3446' },
  { t: 1.00, env: 0.16, el: -22, az: -88, sun: 0, sunC: '#ff986a', hemi: 0.55, sky: '#7389ab', gnd: '#343943', exp: 1.08, fog: '#182538', fogD: 0.00016, night: 1, turb: 2, ray: 0.5, gain: 0.3, water: '#12293b' },
];

export const PRESETS = { midday: 0, golden: 0.42, dusk: 0.7, night: 1 };

function sample(t) {
  let i = 1;
  while (i < KEYS.length - 1 && KEYS[i].t < t) i++;
  const a = KEYS[i - 1], b = KEYS[i];
  const k = THREE.MathUtils.clamp((t - a.t) / (b.t - a.t), 0, 1);
  const out = {};
  for (const key of Object.keys(a)) {
    if (typeof a[key] === 'number') out[key] = a[key] + (b[key] - a[key]) * k;
    else out[key] = new THREE.Color(a[key]).lerp(new THREE.Color(b[key]), k);
  }
  return out;
}

export class Lighting {
  constructor(scene, renderer, ctx) {
    this.scene = scene;
    this.renderer = renderer;
    this.ctx = ctx;
    this.focus = new THREE.Vector3(0, 0, -500);

    this.sky = makeSky();
    scene.add(this.sky);

    this.envScene = new THREE.Scene();
    // Reflections come from a simple gradient dome driven by the same keyframes,
    // so glass and water darken properly after sunset
    this.envDome = makeEnvDome();
    this.envScene.add(this.envDome);
    // One low-detail skyline batch is baked into the environment on time changes.
    // Cloud Gate gets recognizable building silhouettes, with no live cube camera.
    this.envBuildings = reflectionSkyline(ctx.cityBoxes);
    this.envScene.add(this.envBuildings);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.envDirty = true;
    this.envTimer = 0;
    this.shadowTimer = 0;
    this.shadowDirty = true;

    this.hemi = new THREE.HemisphereLight(0xbcd4ee, 0x6a6150, 1);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    s.mapSize.set(ctx.quality.shadow, ctx.quality.shadow);
    s.camera.left = -1800; s.camera.right = 1800; s.camera.top = 1800; s.camera.bottom = -1800;
    s.camera.near = 10; s.camera.far = 14000;
    s.bias = -0.0004;
    s.normalBias = 1.2;
    scene.add(this.sun, this.sun.target);

    this.moon = new THREE.DirectionalLight(0x9fb4ff, 0);
    this.moon.position.set(3000, 5000, 4000);
    scene.add(this.moon);

    scene.fog = new THREE.FogExp2(0xb7c9dc, 0.0001);

    this.state = sample(0);
    this.set(0);
  }

  set(t) {
    this.t = t;
    const s = sample(t);
    this.state = s;
    const el = THREE.MathUtils.degToRad(s.el), az = THREE.MathUtils.degToRad(s.az);
    const dir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    this.sunDir = dir;

    const u = this.sky.material.uniforms;
    u.uSunDir.value.copy(dir);
    u.uTop.value.copy(s.sky).multiplyScalar(THREE.MathUtils.lerp(0.8, 0.12, s.night));
    // Match the fog exactly at and below the horizon, hiding the finite city edge.
    u.uHorizon.value.copy(s.fog);
    u.uSun.value.copy(s.sunC).multiplyScalar(THREE.MathUtils.smoothstep(s.el, -2, 5));

    this.sun.color.copy(s.sunC);
    this.sun.intensity = s.sun * THREE.MathUtils.smoothstep(s.el, -1.5, 3);
    this.sun.castShadow = this.sun.intensity > 0.01;
    this.hemi.intensity = s.hemi;
    this.hemi.color.copy(s.sky);
    this.hemi.groundColor.copy(s.gnd);
    this.moon.intensity = 0.38 * s.night;

    const eu = this.envDome.material.uniforms;
    eu.uTop.value.copy(s.sky).multiplyScalar(s.env * 1.1);
    eu.uHorizon.value.copy(s.fog).multiplyScalar(s.env * 1.25);
    eu.uBottom.value.copy(s.gnd).multiplyScalar(s.env * 0.6);
    eu.uSunDir.value.copy(dir);
    eu.uSun.value.copy(s.sunC).multiplyScalar(s.el > -1 ? 30 * s.env : 0);
    this.envBuildings.material.color.setRGB(0.45, 0.43, 0.4).multiplyScalar(s.env);

    this.scene.fog.color.copy(s.fog);
    this.scene.fog.density = s.fogD;
    this.renderer.toneMappingExposure = s.exp;
    uNight.value = s.night;

    const w = this.ctx.water;
    if (w) {
      w.material.uniforms.sunDirection.value.copy(s.el > -2 ? dir : this.moon.position.clone().normalize());
      w.material.uniforms.sunColor.value.copy(s.el > -2 ? s.sunC : new THREE.Color(0x8090b0)).multiplyScalar(s.el > -2 ? 1 : 0.3);
      w.material.uniforms.waterColor.value.copy(s.water);
    }
    for (const g of this.ctx.glows) g.mat.emissiveIntensity = g.day + (g.night - g.day) * s.night;
    if (this.ctx.streetLights) this.ctx.streetLights.opacity = THREE.MathUtils.smoothstep(s.night, 0.15, 0.7) * 0.65;
    this.envDirty = true;
    this.shadowDirty = true;
  }

  // Keep the shadow camera centered on what the viewer is looking at
  update(dt, focus) {
    const f = this.focus.lerp(new THREE.Vector3(focus.x, 0, focus.z).clampLength(0, 8000), 1);
    const snap = 40;
    const fx = Math.round(f.x / snap) * snap, fz = Math.round(f.z / snap) * snap;
    if (this.sun.target.position.x !== fx || this.sun.target.position.z !== fz) this.shadowDirty = true;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx, 0, fz).addScaledVector(this.sunDir, 6000);
    this.sky.position.set(0, 0, 0);
    // Static buildings need a fresh shadow only when the light or focus changes.
    this.shadowTimer -= dt;
    if (this.shadowDirty && this.shadowTimer <= 0) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowDirty = false;
      this.shadowTimer = 0.12;
    }

    this.envTimer -= dt;
    if (this.envDirty && this.envTimer <= 0) {
      // free the map from two updates ago; the previous one may still be bound this frame
      if (this.envOld) this.envOld.dispose();
      this.envOld = this.envRT;
      this.envRT = this.pmrem.fromScene(this.envScene, 0, 1, 1000);
      this.scene.environment = this.envRT.texture;
      this.envDirty = false;
      this.envTimer = 0.5;
    }
  }
}

function reflectionSkyline(boxes) {
  const b = PLAZAS.bean, scale = 0.02;
  const nearby = boxes.filter(([x, , z, , h]) => h > 30 && Math.hypot(x - b.x, z - b.z) < 1500);
  const proxies = [...nearby, ...LANDMARKS.filter((l) => l.roof > 100).map((l) => [l.x, 0, l.z, l.r * 1.2, l.roof, l.r * 1.2])];
  const geos = proxies.map(([x, y, z, w, h, d]) => new THREE.BoxGeometry(w * scale, h * scale, d * scale)
    .translate((x - b.x) * scale, (y + h / 2 - 5) * scale, (z - b.z) * scale));
  const geometry = mergeGeometries(geos);
  geos.forEach((g) => g.dispose());
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x77736b }));
}

function makeEnvDome() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() },
      uSun: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    },
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom; uniform vec3 uSun; uniform vec3 uSunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = d.y > 0.0 ? mix(uHorizon, uTop, pow(smoothstep(0.0, 0.7, d.y), 0.6)) : mix(uHorizon, uBottom, smoothstep(0.0, 0.25, -d.y));
        c += uSun * pow(max(dot(d, uSunDir), 0.0), 600.0) + uSun * 0.02 * pow(max(dot(d, uSunDir), 0.0), 8.0);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), mat);
}

function makeSky() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3() }, uSun: { value: new THREE.Color() } },
    vertexShader: `varying vec3 vDirection;
      void main() { vec4 p = modelMatrix * vec4(position, 1.0); vDirection = p.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * p; }`,
    fragmentShader: `uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSun;
      varying vec3 vDirection;
      void main() {
        vec3 d = normalize(vDirection);
        vec3 c = mix(uHorizon, uTop, smoothstep(0.0, 0.32, max(0.0, d.y)));
        float sun = max(0.0, dot(d, uSunDir));
        c += uSun * (pow(sun, 512.0) * 0.12 + pow(sun, 16384.0) * 3.0);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(20000, 24, 12), material);
  sky.name = 'sky';
  return sky;
}
