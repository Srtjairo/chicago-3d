import {landscapeAt} from './waterfront-data.js?v=4065cefedcbb3b84';
import * as THREE from 'three';
import {
  BLOCK, STREET, EXTENT, distToRiver, heightAt, isLake, inGrantPark, landmarkInRect, rng, NAVY_PIER,
} from './geo.js?v=4065cefedcbb3b84';
import { facadeMaterial, glowSprite } from './textures.js?v=4065cefedcbb3b84';
import { SLAB_TOP, addTrees } from './terrain.js?v=4065cefedcbb3b84';
import { inCoverage, buildMeasuredCity } from './city-data.js?v=4065cefedcbb3b84';

// Building palettes: [color, glass, style]  style 0 = masonry, 1 = curtain wall
const PALETTE = [
  [0xb9ab97, 0x1f2730, 0], // limestone
  [0xa8664a, 0x1d2228, 0], // Chicago brick
  [0x8c5a44, 0x1b1f24, 0], // dark brick
  [0xd8d3c8, 0x26303a, 0], // terra cotta white
  [0x7f8a96, 0x3a4c5c, 1], // blue-grey glass
  [0x5b6670, 0x2b3946, 1], // dark glass
  [0x9fb2bf, 0x4f6a7d, 1], // light glass
  [0x2a2c30, 0x1c1e22, 1], // black steel (Mies)
  [0xc9c4ba, 0x34404b, 1], // white frame
];

export function buildCity(scene, ctx) {
  const rand = rng(1871); // the year of the Great Chicago Fire
  const blocks = [];      // [x, z, w, d, color]
  const boxes = [];       // [x, y0, z, w, h, d, color, style]
  const roofs = [];
  const trees = [];
  const half = (BLOCK - STREET) / 2;

  for (let x = Math.floor(EXTENT.minX / BLOCK) * BLOCK; x < EXTENT.maxX; x += BLOCK) {
    for (let z = Math.floor(EXTENT.minZ / BLOCK) * BLOCK; z < EXTENT.maxZ; z += BLOCK) {
      const cx = x + BLOCK / 2, cz = z + BLOCK / 2;
      if (ctx.data && inCoverage(cx, cz, 65)) continue;
      if (isLake(cx, cz, 70) || landscapeAt(cx,cz)) continue;
      if (inGrantPark(cx, cz)) continue;
      if (cx > NAVY_PIER.x0 - 80 && Math.abs(cz - NAVY_PIER.z) < 120) continue;
      const rd = distToRiver(cx, cz);
      if (rd < 18) continue;
      // Blocks touching the river get trimmed on the river side (Riverwalk / Wacker Drive)
      let x0 = cx - half, x1 = cx + half, z0 = cz - half, z1 = cz + half;
      if (rd < half + 10) {
        const shrink = half + 14 - rd;
        const pts = [[x0, cz], [x1, cz], [cx, z0], [cx, z1]].map(([px, pz]) => distToRiver(px, pz));
        const minI = pts.indexOf(Math.min(...pts));
        if (minI === 0) x0 += shrink; else if (minI === 1) x1 -= shrink; else if (minI === 2) z0 += shrink; else z1 -= shrink;
        if (x1 - x0 < 30 || z1 - z0 < 30) continue;
      }
      const shoreEdge = isLake(x1, cz, 60) || isLake(x1, z0, 60) || isLake(x1, z1, 60);
      if (shoreEdge) continue;

      blocks.push([(x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0]);
      if (landmarkInRect(x0, z0, x1, z1)) continue;

      const dist = Math.hypot(cx + 100, cz + 300);
      const hMax = heightAt(cx, cz) * (0.85 + rand() * 0.3);
      const far = dist > 2600;
      // Occasional pocket park
      if (rand() < (far ? 0.03 : 0.045)) {
        for (let i = 0; i < 10; i++) trees.push([x0 + 8 + rand() * (x1 - x0 - 16), z0 + 8 + rand() * (z1 - z0 - 16), 0.7 + rand() * 0.4]);
        continue;
      }
      fillBlock(boxes, roofs, rand, x0 + 3, z0 + 3, x1 - 3, z1 - 3, hMax, far);
      // street trees on outer lots
      if (far && rand() < 0.3) {
        for (let tx = x0 + 8; tx < x1 - 8; tx += 32) trees.push([tx, z0 + 4, 0.7]);
      }
    }
  }

  // Sidewalk slabs (streets are the gaps between them)
  const slabMat = new THREE.MeshStandardMaterial({ color: 0xa6a399, roughness: 0.92 });
  const slabs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), slabMat, blocks.length);
  const m = new THREE.Matrix4();
  blocks.forEach(([x, z, w, d], i) => {
    m.compose(new THREE.Vector3(x, (SLAB_TOP - 1) / 2, z), new THREE.Quaternion(), new THREE.Vector3(w, SLAB_TOP + 1, d));
    slabs.setMatrixAt(i, m);
  });
  slabs.receiveShadow = true;
  scene.add(slabs);

  // All filler buildings in one draw call
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const style = new Float32Array(boxes.length);
  const mat = facadeMaterial({ instanced: true, color: 0xffffff, lit: 0.3, glass: 0x435765 });
  const city = new THREE.InstancedMesh(geo, mat, boxes.length);
  const c = new THREE.Color();
  boxes.forEach(([x, y0, z, w, h, d, col, st], i) => {
    m.compose(new THREE.Vector3(x, SLAB_TOP + y0, z), new THREE.Quaternion(), new THREE.Vector3(w, h, d));
    city.setMatrixAt(i, m);
    c.setHex(col);
    city.setColorAt(i, c);
    style[i] = st;
  });
  geo.setAttribute('aStyle', new THREE.InstancedBufferAttribute(style, 1));
  city.castShadow = false;
  city.receiveShadow = true;
  city.name = 'city';
  scene.add(city);
  ctx.buildingCount = boxes.length;
  ctx.cityBoxes = boxes;

  // Rooftop plant rooms give the skyline scale without another expensive shader.
  const roofMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x777b7a, roughness: 0.88 }), roofs.length);
  roofs.forEach(([x, y, z, w, h, d], i) => {
    m.compose(new THREE.Vector3(x, SLAB_TOP + y + h / 2, z), new THREE.Quaternion(), new THREE.Vector3(w, h, d));
    roofMesh.setMatrixAt(i, m);
  });
  roofMesh.name = 'rooftops';
  scene.add(roofMesh);

  // Rooftop beacons on the tallest filler towers
  boxes.filter((b) => b[1] + b[4] > 260).forEach((b) => ctx.beacons.push(new THREE.Vector3(b[0], SLAB_TOP + b[1] + b[4] + 1, b[2])));

  addTrees(scene, trees, rand);
  buildStreetLights(scene, ctx, blocks);
  if (ctx.data) buildMeasuredCity(scene, ctx);
}

function pick(rand, glassy) {
  const options = PALETTE.filter((p) => p[2] === (glassy ? 1 : 0));
  return options[Math.floor(rand() * options.length)];
}

function fillBlock(out, roofs, rand, x0, z0, x1, z1, hMax, far) {
  const w = x1 - x0, d = z1 - z0;
  const r = rand();
  const lots = [];
  if (far) {
    // Low-rise neighborhoods: rows of 2-6 story buildings
    const n = 2 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const a = x0 + (w / n) * i;
      const mid = (z0 + z1) / 2;
      lots.push([a + 1, z0, a + w / n - 1, mid - 5], [a + 1, mid + 5, a + w / n - 1, z1]);
    }
  } else if (r < 0.35 || w < 60 || d < 60) {
    lots.push([x0, z0, x1, z1]);
  } else if (r < 0.7) {
    if (rand() < 0.5) {
      const s = x0 + w * (0.35 + rand() * 0.3);
      lots.push([x0, z0, s - 2, z1], [s + 2, z0, x1, z1]);
    } else {
      const s = z0 + d * (0.35 + rand() * 0.3);
      lots.push([x0, z0, x1, s - 2], [x0, s + 2, x1, z1]);
    }
  } else {
    const sx = x0 + w / 2, sz = z0 + d / 2;
    lots.push([x0, z0, sx - 2, sz - 2], [sx + 2, z0, x1, sz - 2], [x0, sz + 2, sx - 2, z1], [sx + 2, sz + 2, x1, z1]);
  }

  for (const [a0, b0, a1, b1] of lots) {
    const lw = a1 - a0, ld = b1 - b0;
    const cx = (a0 + a1) / 2, cz = (b0 + b1) / 2;
    let h = Math.max(8, hMax * (0.22 + 0.78 * Math.pow(rand(), 1.6)));
    if (far) h = 7 + rand() * Math.min(hMax, 22);
    const glassy = h > 120 ? rand() < 0.65 : rand() < 0.22;
    const [col, , st] = pick(rand, glassy);
    if (!far && h > 70 && rand() < 0.55) {
      // Podium with a slimmer tower on top
      const podH = 12 + rand() * 18;
      const tw = lw * (0.5 + rand() * 0.3), td = ld * (0.5 + rand() * 0.3);
      const ox = (rand() - 0.5) * (lw - tw) * 0.8, oz = (rand() - 0.5) * (ld - td) * 0.8;
      out.push([cx, 0, cz, lw, podH, ld, pick(rand, false)[0], 0]);
      out.push([cx + ox, podH, cz + oz, tw, h - podH, td, col, st]);
      if (h > 160 && rand() < 0.6) {
        const ch = 10 + rand() * 25;
        out.push([cx + ox, h, cz + oz, tw * 0.62, ch, td * 0.62, col, st]);
      }
    } else {
      const inset = rand() < 0.3 ? 4 : 0;
      out.push([cx, 0, cz, lw - inset, h, ld - inset, col, st]);
      if (h > 60 && rand() < 0.35) {
        out.push([cx, h, cz, (lw - inset) * 0.7, 6 + rand() * 18, (ld - inset) * 0.7, col, st]);
      }
    }
    if (!far && h > 35) {
      const [rx, ry, rz, rw, rh, rd] = out[out.length - 1];
      roofs.push([rx + rw * 0.12, ry + rh + 0.12, rz - rd * 0.12, Math.min(12, rw * 0.3), 2.4 + rand() * 2.5, Math.min(14, rd * 0.3)]);
    }
  }
}

// Warm sodium/LED points along every street, visible after dusk
function buildStreetLights(scene, ctx, blocks) {
  const pos = [];
  // lamps along Grant Park's walks and Lake Shore Drive
  for (const [x0, z0, x1, z1] of ctx.parkRects || []) {
    for (let x = x0; x <= x1; x += 65) pos.push(x, 5, z0 - 2, x, 5, z1 + 2);
    for (let z = z0; z <= z1; z += 65) pos.push(x0 - 2, 5, z, x1 + 2, 5, z);
  }
  for (const [x, z, w, d] of blocks) {
    const near = Math.hypot(x + 100, z + 300) < 2200;
    if (!near) continue;
    const step = 85;
    for (let t = -w / 2; t <= w / 2; t += step) {
      pos.push(x + t, 7, z - d / 2 - 2);
      if (near) pos.push(x + t, 7, z + d / 2 + 2);
    }
    for (let t = -d / 2; t <= d / 2; t += step) {
      pos.push(x - w / 2 - 2, 7, z + t);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: new THREE.Color(1.2, 0.8, 0.45), size: 6, map: glowSprite(), sizeAttenuation: true, transparent: true,
    opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const pts = new THREE.Points(g, mat);
  pts.name = 'street-lights';
  pts.frustumCulled = false;
  scene.add(pts);
  ctx.streetLights = mat;
}
