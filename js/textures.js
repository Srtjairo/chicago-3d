import * as THREE from 'three';

// Shared uniform: 0 = full daylight, 1 = full night. Every facade reads it.
export const uNight = { value: 0 };
export const LIGHTING_PROFILES={mixed:{lit:.28,lightGain:.65},office:{lit:.43,lightGain:.65},warehouse:{lit:.23,lightGain:.56}};

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
    instanced: false, ...LIGHTING_PROFILES[opts.lightingProfile||'mixed'], ...opts,
  };
  const mat = new THREE.MeshStandardMaterial({ color: o.color, roughness: o.roughness, metalness: o.metalness });
  mat.defines = { ...(o.instanced ? { FACADE_ATTR: '' } : {}), ...(o.features ? { FEATURE_ATTR: '' } : {}), ...(o.profiles ? { PROFILE_ATTR: '' } : {}) };
  const uniforms = {
    uNight,
    uGlass: { value: new THREE.Color(o.glass) },
    uCell: { value: new THREE.Vector2(...o.cell) },
    uWinA: { value: new THREE.Vector2(...o.winA) },
    uWinB: { value: new THREE.Vector2(...o.winB) },
    uLit: { value: o.lit },
    uLightGain: { value: o.lightGain },
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
        #ifdef PROFILE_ATTR
          attribute vec2 aCell; attribute vec2 aWin; attribute float aLit; attribute vec3 aGlass;
          varying vec2 vFCell; varying vec2 vFWin; varying float vFLit; varying vec3 vFGlass;
        #endif
        #ifdef FACADE_ATTR
          attribute float aStyle;
        #endif
        #ifdef FEATURE_ATTR
          attribute float aSeed;
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
        #endif
        #ifdef FEATURE_ATTR
          vFSeed = aSeed;
        #endif
        #ifdef PROFILE_ATTR
          vFCell=aCell;vFWin=aWin;vFLit=aLit;vFGlass=aGlass;
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFPos; varying vec3 vFN; varying float vFStyle; varying float vFSeed;
        uniform float uNight; uniform vec3 uGlass; uniform vec2 uCell; uniform vec2 uWinA; uniform vec2 uWinB;
        #ifdef PROFILE_ATTR
          varying vec2 vFCell; varying vec2 vFWin; varying float vFLit; varying vec3 vFGlass;
        #endif
        uniform float uLit; uniform float uLightGain; uniform float uGlassRough; uniform float uRoofDark;
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
        vec2 fBaseCell=uCell,fBaseWin=uWinA;float fBaseLit=uLit;vec3 fBaseGlass=uGlass;
        #ifdef PROFILE_ATTR
          fBaseCell=vFCell;fBaseWin=vFWin;fBaseLit=vFLit;fBaseGlass=vFGlass;
        #endif
        vec2 fCell = fBaseCell * mix(0.9, 1.15, fBuild);
        vec2 fG = vec2(fU, vFPos.y - 0.6) / fCell;
        vec2 fF = fract(fG);
        vec2 fId = floor(fG);
        vec2 fW2 = fwidth(fG);
        vec2 fWin = mix(fBaseWin, uWinB, vFStyle);
        float fAA = max(fW2.x, fW2.y);
        float fMask = fBand(fF.x, fWin.x, fW2.x) * fBand(fF.y, fWin.y, fW2.y);
        float fFar = smoothstep(0.55, 1.3, fAA);
        float fAvg = fWin.x * fWin.y;
        fMask = mix(fMask, fAvg, fFar);
        fMask *= fWall * step(1.0, fId.y);
        // lights cluster by floor and office bay, with some single windows
        float fR = fHash(vec2(floor(fId.x / 4.0), fId.y) + vec2(fSeed * 3.3 + fSide, 1.7));
        vec3 fGlass = mix(fBaseGlass, diffuseColor.rgb * 0.48, vFStyle * 0.32);
        fGlass *= mix(0.94 + 0.12 * fHash(fId.yx + fSeed), 1.0, fFar);
        // A little contact shading grounds the city without thousands of shadow casters.
        diffuseColor.rgb *= mix(0.72, 1.0, smoothstep(0.0, 18.0, vFPos.y));
        diffuseColor.rgb = mix(diffuseColor.rgb * mix(1.0, uRoofDark, 1.0 - fWall), fGlass, fMask);
        // Uniform branch skips occupancy filtering entirely in daylight.
        vec3 fLitCol=vec3(0.0);
        if(uNight>0.001){
        // lit windows at night
        float fOccupancy = clamp(fBaseLit * mix(0.9, 1.1, fBuild), 0.0, 0.55);
        float fOn = step(fR, fOccupancy);
        float fTone = fHash(vec2(fId.y, fSeed));
        vec3 fLamp = mix(vec3(1.0, 0.68, 0.36), vec3(0.8, 0.88, 1.0), step(0.78, fTone)) * (0.6 + 0.3 * fTone);
        // Filter the SAME four-bay/floor occupancy cells across pixel boundaries.
        // Keep the vertical floor rhythm if only horizontal bays are subpixel.
        // As whole offices become unresolved, converge to their energy average.
        vec2 fOffice=fG/vec2(4.0,1.0), fOW=fW2/vec2(4.0,1.0);
        vec2 fOI=floor(fOffice), fOF=fract(fOffice);
        vec2 fStep=mix(vec2(-1.0),vec2(1.0),step(vec2(0.5),fOF));
        vec2 fMix=clamp((fOW*0.5-min(fOF,1.0-fOF))/max(fOW,vec2(0.0001)),0.0,0.5);
        vec2 fOffset=vec2(fSeed*3.3+fSide,1.7);
        float f00=step(fHash(fOI+fOffset),fOccupancy);
        float f10=step(fHash(fOI+vec2(fStep.x,0.0)+fOffset),fOccupancy);
        float f01=step(fHash(fOI+vec2(0.0,fStep.y)+fOffset),fOccupancy);
        float f11=step(fHash(fOI+fStep+fOffset),fOccupancy);
        float fFiltered=mix(mix(f00,f10,fMix.x),mix(f01,f11,fMix.x),fMix.y);
        float fOfficeFar=smoothstep(0.65,1.8,max(fOW.x,fOW.y));
        fFiltered=mix(fFiltered,fOccupancy,fOfficeFar);
        vec2 fAxisFade=smoothstep(vec2(0.4),vec2(1.15),fW2);
        float fLightMask=mix(fBand(fF.x,fWin.x,fW2.x),fWin.x,fAxisFade.x)*mix(fBand(fF.y,fWin.y,fW2.y),fWin.y,fAxisFade.y)*fWall*step(1.0,fId.y);
        vec3 fAverageLamp=vec3(0.54,0.43,0.29);
        fLitCol=mix(fLamp*fOn,fAverageLamp*fFiltered,fFar)*fLightMask;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, uGlassRough, fMask);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.32, fMask);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += fLitCol * uNight * uLightGain;`);
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
