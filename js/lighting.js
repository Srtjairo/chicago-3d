import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { uNight, glowSprite } from './textures.js';

// Time of day runs from 0 (midday) to 1 (night). Values between keyframes are interpolated.
const KEYS = [
  { t: 0.00, env: 1, el: 58, az: 20, sun: 3.2, sunC: '#fff4e6', hemi: 1.15, sky: '#bcd4ee', gnd: '#6a6150', exp: 0.95, fog: '#b7c9dc', fogD: 0.000105, night: 0, bloom: 0.12, turb: 2.5, ray: 1.0, gain: 0.55, water: '#0f4257' },
  { t: 0.42, env: 0.75, el: 9, az: -58, sun: 2.8, sunC: '#ffc07a', hemi: 0.7, sky: '#a9b2cf', gnd: '#5a4636', exp: 1.0, fog: '#d9b493', fogD: 0.00012, night: 0.04, bloom: 0.22, turb: 5.5, ray: 2.2, gain: 0.55, water: '#173f50' },
  { t: 0.60, env: 0.42, el: 1.2, az: -68, sun: 1.5, sunC: '#ff8a45', hemi: 0.45, sky: '#8a84ad', gnd: '#3a2c2a', exp: 1.05, fog: '#c58b72', fogD: 0.00013, night: 0.3, bloom: 0.45, turb: 8, ray: 3.0, gain: 0.6, water: '#1d3442' },
  { t: 0.76, env: 0.1, el: -5, az: -76, sun: 0.0, sunC: '#ff6a3d', hemi: 0.2, sky: '#3d4a7c', gnd: '#1b1a22', exp: 1.15, fog: '#33395a', fogD: 0.00014, night: 0.82, bloom: 0.55, turb: 4, ray: 2.0, gain: 0.9, water: '#0f1e2c' },
  { t: 1.00, env: 0.025, el: -22, az: -88, sun: 0.0, sunC: '#ff6a3d', hemi: 0.09, sky: '#1d2747', gnd: '#0b0b10', exp: 1.2, fog: '#0f1424', fogD: 0.00015, night: 1, bloom: 0.6, turb: 2, ray: 0.5, gain: 1.0, water: '#08121c' },
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
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.envDirty = true;
    this.envTimer = 0;

    this.hemi = new THREE.HemisphereLight(0xbcd4ee, 0x6a6150, 1);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    s.mapSize.set(ctx.quality.shadow, ctx.quality.shadow);
    s.camera.left = -2300; s.camera.right = 2300; s.camera.top = 2300; s.camera.bottom = -2300;
    s.camera.near = 10; s.camera.far = 14000;
    s.bias = -0.0004;
    s.normalBias = 1.2;
    scene.add(this.sun, this.sun.target);

    this.moon = new THREE.DirectionalLight(0x9fb4ff, 0);
    this.moon.position.set(3000, 5000, 4000);
    scene.add(this.moon);

    scene.fog = new THREE.FogExp2(0xb7c9dc, 0.0001);

    // Stars
    const starPos = [];
    for (let i = 0; i < 2200; i++) {
      const u = Math.random() * Math.PI * 2, v = Math.acos(Math.random() * 0.95);
      starPos.push(Math.sin(v) * Math.cos(u) * 9000, Math.cos(v) * 9000, Math.sin(v) * Math.sin(u) * 9000);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, map: glowSprite(), transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.frustumCulled = false;
    scene.add(this.stars);

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
    u.sunPosition.value.copy(dir);
    u.turbidity.value = s.turb;
    u.rayleigh.value = s.ray;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    u.uGain.value = s.gain;
    u.uHorizon.value.copy(new THREE.Color('#2c2a46')).multiplyScalar(0.35 * s.night).add(new THREE.Color('#3a2a3a').multiplyScalar(0.25 * s.night));
    u.uZenith.value.copy(new THREE.Color('#0b1430')).multiplyScalar(0.5 * s.night);

    this.sun.color.copy(s.sunC);
    this.sun.intensity = s.sun * THREE.MathUtils.smoothstep(s.el, -1.5, 3);
    this.sun.castShadow = this.sun.intensity > 0.01;
    this.hemi.intensity = s.hemi;
    this.hemi.color.copy(s.sky);
    this.hemi.groundColor.copy(s.gnd);
    this.moon.intensity = 0.16 * s.night;

    const eu = this.envDome.material.uniforms;
    eu.uTop.value.copy(s.sky).multiplyScalar(s.env * 1.1);
    eu.uHorizon.value.copy(s.fog).multiplyScalar(s.env * 1.25);
    eu.uBottom.value.copy(s.gnd).multiplyScalar(s.env * 0.6);
    eu.uSunDir.value.copy(dir);
    eu.uSun.value.copy(s.sunC).multiplyScalar(s.el > -1 ? 30 * s.env : 0);

    this.scene.fog.color.copy(s.fog);
    this.scene.fog.density = s.fogD;
    this.renderer.toneMappingExposure = s.exp;
    uNight.value = s.night;
    this.starMat.opacity = Math.max(0, (s.night - 0.6) / 0.4) * 0.85;

    const w = this.ctx.water;
    if (w) {
      w.material.uniforms.sunDirection.value.copy(s.el > -2 ? dir : this.moon.position.clone().normalize());
      w.material.uniforms.sunColor.value.copy(s.el > -2 ? s.sunC : new THREE.Color(0x8090b0)).multiplyScalar(s.el > -2 ? 1 : 0.3);
      w.material.uniforms.waterColor.value.copy(s.water);
    }
    for (const g of this.ctx.glows) g.mat.emissiveIntensity = g.day + (g.night - g.day) * s.night;
    if (this.ctx.streetLights) this.ctx.streetLights.opacity = THREE.MathUtils.smoothstep(s.night, 0.15, 0.7);
    if (this.ctx.bloom) this.ctx.bloom.strength = s.bloom;
    this.envDirty = true;
  }

  // Keep the shadow camera centered on what the viewer is looking at
  update(dt, focus) {
    const f = this.focus.lerp(new THREE.Vector3(focus.x, 0, focus.z).clampLength(0, 8000), 1);
    const snap = 40;
    const fx = Math.round(f.x / snap) * snap, fz = Math.round(f.z / snap) * snap;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx, 0, fz).addScaledVector(this.sunDir, 6000);
    this.sky.position.set(0, 0, 0);

    this.envTimer -= dt;
    if (this.envDirty && this.envTimer <= 0) {
      // free the map from two updates ago; the previous one may still be bound this frame
      if (this.envOld) this.envOld.dispose();
      this.envOld = this.envRT;
      this.envRT = this.pmrem.fromScene(this.envScene, 0, 1, 1000);
      this.scene.environment = this.envRT.texture;
      this.envDirty = false;
      this.envTimer = 0.25;
    }
  }
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
  const sky = new Sky();
  sky.scale.setScalar(50000);
  const u = sky.material.uniforms;
  u.uGain = { value: 0.5 };
  u.uHorizon = { value: new THREE.Color(0, 0, 0) };
  u.uZenith = { value: new THREE.Color(0, 0, 0) };
  sky.material.fragmentShader = sky.material.fragmentShader
    .replace('uniform float mieDirectionalG;', 'uniform float mieDirectionalG;\nuniform float uGain; uniform vec3 uHorizon; uniform vec3 uZenith;')
    .replace('gl_FragColor = vec4( retColor, 1.0 );',
      'gl_FragColor = vec4( retColor * uGain + mix( uHorizon, uZenith, smoothstep( -0.02, 0.45, direction.y ) ), 1.0 );');
  return sky;
}
