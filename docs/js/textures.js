import * as THREE from 'three';

// Shared uniform: 0 = full daylight, 1 = full night. Every facade reads it.
export const uNight = { value: 0 };

/**
 * Building facade material. Windows are drawn procedurally from world position,
 * so any box, extrusion or instanced building gets correctly sized floors and windows
 * without UV maps. At night a random share of windows lights up.
 *
 * opts.instanced: per-instance window style comes from an `aStyle` attribute
 * opts.style: 0 = punched windows in masonry, 1 = full glass curtain wall
 */
export function facadeMaterial(opts = {}) {
  const o = {
    color: 0x8c8780, glass: 0x1d2630, cell: [3.2, 3.9], winA: [0.48, 0.55], winB: [0.9, 0.82],
    lit: 0.32, style: 0, seed: 1, roughness: 0.78, metalness: 0.05, glassRough: 0.24, roofDark: 0.68,
    instanced: false, ...opts,
  };
  const mat = new THREE.MeshStandardMaterial({ color: o.color, roughness: o.roughness, metalness: o.metalness });
  if (o.instanced) mat.defines = { FACADE_ATTR: '' };
  const uniforms = {
    uNight,
    uGlass: { value: new THREE.Color(o.glass) },
    uCell: { value: new THREE.Vector2(...o.cell) },
    uWinA: { value: new THREE.Vector2(...o.winA) },
    uWinB: { value: new THREE.Vector2(...o.winB) },
    uLit: { value: o.lit },
    uStyle: { value: o.style },
    uSeed: { value: o.seed },
    uGlassRough: { value: o.glassRough },
    uRoofDark: { value: o.roofDark },
  };
  mat.userData.facade = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFPos; varying vec3 vFN; varying float vFStyle; varying float vFSeed;
        uniform float uStyle; uniform float uSeed;
        #ifdef FACADE_ATTR
          attribute float aStyle;
        #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 fW = vec4(transformed, 1.0);
        vec3 fNrm = objectNormal;
        #ifdef USE_INSTANCING
          fW = instanceMatrix * fW;
          fNrm = mat3(instanceMatrix) * fNrm;
        #endif
        fW = modelMatrix * fW;
        vFPos = fW.xyz;
        vFN = mat3(modelMatrix) * fNrm;
        #ifdef FACADE_ATTR
          vFStyle = aStyle; vFSeed = float(gl_InstanceID) + 1.0;
        #else
          vFStyle = uStyle; vFSeed = uSeed;
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFPos; varying vec3 vFN; varying float vFStyle; varying float vFSeed;
        uniform float uNight; uniform vec3 uGlass; uniform vec2 uCell; uniform vec2 uWinA; uniform vec2 uWinB;
        uniform float uLit; uniform float uGlassRough; uniform float uRoofDark;
        float fHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float fBand(float x, float w, float aa) { float h = w * 0.5; return smoothstep(0.5 - h - aa, 0.5 - h + aa, x) * (1.0 - smoothstep(0.5 + h - aa, 0.5 + h + aa, x)); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 fN = normalize(vFN);
        float fWall = 1.0 - smoothstep(0.55, 0.75, abs(fN.y));
        float fU = abs(fN.x) > abs(fN.z) ? vFPos.z : vFPos.x;
        float fSide = abs(fN.x) > abs(fN.z) ? sign(fN.x) : 2.0 * sign(fN.z);
        // Interpolated seeds differ by tiny fractions across a triangle. Quantize
        // before hashing, otherwise the window grid changes from pixel to pixel.
        float fSeed = floor(vFSeed + 0.5);
        float fBuild = fHash(vec2(fSeed, 7.13));
        vec2 fCell = uCell * mix(0.9, 1.15, fBuild);
        vec2 fG = vec2(fU, vFPos.y - 0.6) / fCell;
        vec2 fF = fract(fG);
        vec2 fId = floor(fG);
        vec2 fW2 = fwidth(fG);
        vec2 fWin = mix(uWinA, uWinB, vFStyle);
        float fAA = max(fW2.x, fW2.y);
        float fMask = fBand(fF.x, fWin.x, fW2.x) * fBand(fF.y, fWin.y, fW2.y);
        float fFar = smoothstep(0.07, 0.32, fAA);
        float fAvg = fWin.x * fWin.y;
        fMask = mix(fMask, fAvg, fFar);
        fMask *= fWall * step(1.0, fId.y);
        // lights cluster by floor and office bay, with some single windows
        float fR = fHash(vec2(floor(fId.x / 3.0), fId.y) + vec2(fSeed * 3.3 + fSide, 1.7));
        vec3 fGlass = mix(uGlass, diffuseColor.rgb * 0.48, vFStyle * 0.32);
        fGlass *= mix(0.94 + 0.12 * fHash(fId.yx + fSeed), 1.0, fFar);
        // A little contact shading grounds the city without thousands of shadow casters.
        diffuseColor.rgb *= mix(0.72, 1.0, smoothstep(0.0, 18.0, vFPos.y));
        diffuseColor.rgb = mix(diffuseColor.rgb * mix(1.0, uRoofDark, 1.0 - fWall), fGlass, fMask);
        // lit windows at night
        float fOn = step(fR, uLit * mix(0.7, 1.25, fBuild));
        float fTone = fHash(vec2(fId.y, fSeed));
        vec3 fLamp = mix(vec3(1.0, 0.68, 0.36), vec3(0.8, 0.88, 1.0), step(0.78, fTone)) * (0.6 + 0.3 * fTone);
        // Subpixel windows converge to their average instead of bright, unstable dots.
        vec3 fFarLit = vec3(0.92, 0.72, 0.48) * uLit * 0.48;
        vec3 fLitCol = mix(fLamp * fOn, fFarLit, fFar) * fMask;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, uGlassRough, fMask);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.32, fMask);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += fLitCol * uNight * 1.25;`);
  };
  return mat;
}

// Tileable normal map for water, built from integer-frequency sine waves
export function waterNormals(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const waves = [];
  const r = mulberry(7);
  for (let i = 0; i < 48; i++) {
    const f = 2 + i * 0.6;
    const a = r() * 6.283;
    waves.push({ kx: Math.round(Math.cos(a) * f), ky: Math.round(Math.sin(a) * f), a: 0.5 / (1 + i * 0.12), p: r() * 6.283 });
  }
  // analytic derivatives of the wave sum: one pass, no neighbour lookups
  const n = new THREE.Vector3();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dx = 0, dy = 0;
      for (const w of waves) {
        const c0 = w.a * Math.cos(6.283 * (w.kx * x + w.ky * y) / size + w.p) * 6.283 / size * 2;
        dx += c0 * w.kx;
        dy += c0 * w.ky;
      }
      n.set(-dx * 0.35, -dy * 0.35, 1).normalize();
      const k = (y * size + x) * 4;
      img.data[k] = (n.x * 0.5 + 0.5) * 255;
      img.data[k + 1] = (n.y * 0.5 + 0.5) * 255;
      img.data[k + 2] = (n.z * 0.5 + 0.5) * 255;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Subtle mottled grass so lawns don't look flat
export function grassTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#697c50';
  ctx.fillRect(0, 0, size, size);
  const r = mulberry(3);
  for (let i = 0; i < 2600; i++) {
    const g = 105 + r() * 20;
    ctx.fillStyle = `rgba(${85 + r() * 20},${g},${65 + r() * 15},0.14)`;
    const s = 2 + r() * 7;
    ctx.fillRect(r() * size, r() * size, s, s);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Soft round dot used for street lights, stars and fountain spray
export function glowSprite(size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
