// Soldier Field, built from its mapped building parts (assets/soldier-field.json, OpenStreetMap):
// the seating bowl around the field, the tall west grandstand and the cantilevered east deck
// (the "spaceship" set into the 1924 stadium), the historic Doric colonnades on the east and west,
// the limestone end walls, a marked football field and the two video boards.
// The streamed tiles leave the stadium's footprint to this model (roof style "custom").
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const BOWL_TOP = 23, FIELD_Y = 1.1;

export async function buildSoldierField(scene, ctx) {
  const url = new URL('../assets/soldier-field.json', import.meta.url); url.search = new URL(import.meta.url).search;
  const r = await fetch(url); if (!r.ok) return null;
  const data = await r.json();
  const group = new THREE.Group(); group.name = 'soldier-field';

  // Field frame: centre and axes from the pitch outline.
  const P = data.pitch, cx = P.reduce((s, p) => s + p[0], 0) / P.length, cz = P.reduce((s, p) => s + p[1], 0) / P.length;
  let best = 0, ux = 0, uz = 1;
  for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > best) { best = l; ux = (b[0] - a[0]) / l; uz = (b[1] - a[1]) / l; } }
  const vx = -uz, vz = ux; // across the field
  const proj = ([x, z]) => [(x - cx) * ux + (z - cz) * uz, (x - cx) * vx + (z - cz) * vz];
  const all = data.parts.flatMap((p) => p.rings[0]).map(proj), A = Math.max(...all.map((p) => Math.abs(p[0]))), B = Math.max(...all.map((p) => Math.abs(p[1])));
  const spread = (p) => { const [a, b] = proj(p); return Math.hypot(a / A, b / B); }; // 0 at the centre, about 1 at the outer wall

  // ---------- Materials ----------
  // Limestone with pilasters every 4.6 m, a base course and a cornice band (the 1924 walls).
  const stone = new THREE.MeshStandardMaterial({ color: 0xd6ccb4, roughness: 0.85 });
  stone.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying vec3 vSfS; varying vec3 vSfN;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvSfS = (modelMatrix * vec4(transformed, 1.0)).xyz; vSfN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = 'varying vec3 vSfS; varying vec3 vSfN;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nif (abs(vSfN.y) < 0.5) { float along = abs(vSfN.x) > abs(vSfN.z) ? vSfS.z : vSfS.x; float pil = step(0.82, fract(along / 4.6)); float band = step(0.93, fract(vSfS.y / 5.2)) + step(vSfS.y, 1.2); diffuseColor.rgb *= 1.0 - 0.13 * pil - 0.1 * min(band, 1.0); }');
  };
  stone.customProgramCacheKey = () => 'soldier-field-stone';
  const concrete = new THREE.MeshStandardMaterial({ color: 0xb9b6ad, roughness: 0.9 });
  const seats = new THREE.MeshStandardMaterial({ color: 0x44556a, roughness: 0.8 });
  seats.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying float vSeatY;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvSeatY = (modelMatrix * vec4(transformed, 1.0)).y;');
    sh.fragmentShader = 'varying float vSeatY;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 0.78 + 0.22 * step(0.45, fract(vSeatY / 0.9));');
  };
  seats.customProgramCacheKey = () => 'soldier-field-seats';
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fb3bd, roughness: 0.25, metalness: 0.45, emissive: 0xffe2b0, emissiveIntensity: 0 });
  glass.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying vec3 vSfW;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvSfW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'varying vec3 vSfW;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nfloat sfFrame = max(step(0.9, fract((vSfW.x + vSfW.z) / 3.2)), step(0.86, fract(vSfW.y / 4.6)));\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.45, 0.47), sfFrame);');
  };
  glass.customProgramCacheKey = () => 'soldier-field-glass';
  ctx.glows?.push({ mat: glass, day: 0, night: 0.18 });

  // ---------- Geometry helpers ----------
  const tris = { stone: [], concrete: [], seats: [], glass: [] };
  const push = (key, a, b, c) => tris[key].push(...a, ...b, ...c);
  const ringOf = (r) => { const out = r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1] ? r.slice(0, -1) : r; return out; };
  // A top surface whose vertices carry their own heights (seating rakes), with holes.
  function top(rings, key, heightAt) {
    const contour = ringOf(rings[0]).map(([x, z]) => new THREE.Vector2(x, z)), holes = rings.slice(1).map((h) => ringOf(h).map(([x, z]) => new THREE.Vector2(x, z)));
    const pts = [...contour, ...holes.flat()], f = THREE.ShapeUtils.triangulateShape(contour, holes);
    const v = pts.map((p, i) => [p.x, heightAt(p.x, p.y, i < contour.length ? 0 : 1), p.y]);
    for (const [a, b, c] of f) push(key, v[a], v[c], v[b]);
  }
  // Walls down to the ground along a ring whose top follows heightAt.
  function walls(ring, key, heightAt, bottom = 0) {
    const r = ringOf(ring);
    for (let i = 0; i < r.length; i++) {
      const [ax, az] = r[i], [bx, bz] = r[(i + 1) % r.length], ha = heightAt(ax, az), hb = heightAt(bx, bz);
      push(key, [ax, bottom, az], [bx, bottom, bz], [bx, hb, bz]); push(key, [ax, bottom, az], [bx, hb, bz], [ax, ha, az]);
    }
  }
  const box = (key, x, z, angle, w, d, y0, y1) => {
    const c = Math.cos(angle), s = Math.sin(angle), pt = (a, b, y) => [x + a * c - b * s, y, z + a * s + b * c];
    const q = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
    for (let i = 0; i < 4; i++) { const [a1, b1] = q[i], [a2, b2] = q[(i + 1) % 4]; push(key, pt(a1, b1, y0), pt(a2, b2, y0), pt(a2, b2, y1)); push(key, pt(a1, b1, y0), pt(a2, b2, y1), pt(a1, b1, y1)); }
    push(key, pt(...q[0], y1), pt(...q[1], y1), pt(...q[2], y1)); push(key, pt(...q[0], y1), pt(...q[2], y1), pt(...q[3], y1));
  };

  // ---------- Parts ----------
  const bowl = data.parts.find((p) => p.rings.length > 1);
  const decks = data.parts.filter((p) => p !== bowl && p.h >= 50);
  const columns = [];
  // Lower bowl: rakes from the front row by the field up to the concourse.
  if (bowl) {
    top(bowl.rings, 'seats', (x, z, hole) => (hole ? 2 : BOWL_TOP));
    walls(bowl.rings[0], 'concrete', () => BOWL_TOP);
    walls(bowl.rings[1], 'concrete', () => 2);
  }
  // Upper decks: rakes from the concourse up to the mapped height, glass and steel outside.
  for (const p of decks) {
    const r = ringOf(p.rings[0]), s = r.map(spread), s0 = Math.min(...s), s1 = Math.max(...s);
    const hAt = (x, z) => BOWL_TOP - 1 + (p.h - BOWL_TOP + 1) * Math.pow(Math.max(0, Math.min(1, (spread([x, z]) - s0) / (s1 - s0 || 1))), 0.85);
    top(p.rings, 'seats', hAt);
    walls(p.rings[0], 'glass', hAt);
  }
  // The rest: colonnades (long narrow parts on the east and west sides) and limestone walls.
  for (const p of data.parts) {
    if (p === bowl || decks.includes(p)) continue;
    const r = ringOf(p.rings[0]);
    // Oriented size from the part's own long edge.
    let L = 0, ax = 1, az = 0;
    for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > L) { L = l; ax = (b[0] - a[0]) / l; az = (b[1] - a[1]) / l; } }
    const mx = r.reduce((s, q) => s + q[0], 0) / r.length, mz = r.reduce((s, q) => s + q[1], 0) / r.length;
    const along = r.map(([x, z]) => (x - mx) * ax + (z - mz) * az), across = r.map(([x, z]) => (x - mx) * -az + (z - mz) * ax);
    const len = Math.max(...along) - Math.min(...along), wid = Math.max(...across) - Math.min(...across);
    const side = Math.abs(((mx - cx) * vx + (mz - cz) * vz)) > B * 0.75; // beside the field, not at an end
    if (p.h >= 30 && side && len > 60 && wid > 6) {
      // A Doric colonnade: stylobate, two rows of columns, entablature, and the wall behind.
      const ang = Math.atan2(az, ax), out = Math.sign((mx - cx) * -az + (mz - cz) * ax) || 1, colH = p.h * 0.78;
      const mid0 = (Math.max(...along) + Math.min(...along)) / 2, mid1 = (Math.max(...across) + Math.min(...across)) / 2;
      const ox = mx + ax * mid0 - az * mid1, oz = mz + az * mid0 + ax * mid1;
      box('stone', ox, oz, ang, len, wid, 0, 1.6);
      box('stone', ox, oz, ang, len, wid, colH, p.h);
      box('stone', ox - az * -out * (wid / 2 - 1.2), oz + ax * -out * (wid / 2 - 1.2), ang, len, 2.4, 0, colH); // back wall
      for (const row of [wid / 2 - 1.6, wid / 2 - 5.2]) for (let d = -len / 2 + 2.4; d <= len / 2 - 2.4; d += 4.6) columns.push([ox + ax * d - az * out * row, oz + az * d + ax * out * row, colH - 1.6]);
    } else {
      top(p.rings, 'stone', () => p.h);
      walls(p.rings[0], 'stone', () => p.h);
    }
  }
  const mats = { stone, concrete, seats, glass };
  for (const [key, list] of Object.entries(tris)) {
    if (!list.length) continue;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(list, 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mats[key]); m.name = 'soldier-field-' + key; m.castShadow = key !== 'seats'; m.receiveShadow = true; group.add(m);
  }
  if (columns.length) {
    const col = new THREE.CylinderGeometry(0.95, 1.1, 1, 12, 1); col.translate(0, 0.5, 0);
    const im = new THREE.InstancedMesh(col, stone, columns.length), m = new THREE.Matrix4();
    columns.forEach(([x, z, h], i) => im.setMatrixAt(i, m.compose(new THREE.Vector3(x, 1.6, z), new THREE.Quaternion(), new THREE.Vector3(1, h, 1))));
    im.name = 'soldier-field-columns'; im.castShadow = true; im.computeBoundingSphere(); group.add(im);
  }

  // ---------- The field ----------
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 1024; const g2 = cv.getContext('2d');
  const yd = 1024 / 120; // 120 yards long (with end zones)
  for (let i = 0; i < 24; i++) { g2.fillStyle = i % 2 ? '#4f8f3c' : '#5a9b45'; g2.fillRect(0, i * 5 * yd, 256, 5 * yd); }
  g2.fillStyle = '#1b2a44'; g2.fillRect(0, 0, 256, 10 * yd); g2.fillRect(0, 110 * yd, 256, 10 * yd);
  g2.fillStyle = '#e8eef2'; g2.font = 'bold 44px sans-serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle';
  for (const [y, rot] of [[5 * yd, Math.PI], [115 * yd, 0]]) { g2.save(); g2.translate(128, y); g2.rotate(rot); g2.fillText('BEARS', 0, 0); g2.restore(); }
  g2.fillStyle = '#f4f4ee';
  for (let y = 10; y <= 110; y += 5) g2.fillRect(8, y * yd - 1, 240, 2.4);
  for (let y = 11; y < 110; y++) { g2.fillRect(84, y * yd - 0.5, 8, 1.2); g2.fillRect(164, y * yd - 0.5, 8, 1.2); }
  g2.strokeStyle = '#f4f4ee'; g2.lineWidth = 3; g2.strokeRect(6, 1, 244, 1022);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const fieldGeo = new THREE.PlaneGeometry(48.8 + 8, 109.7 + 8); fieldGeo.rotateX(-Math.PI / 2);
  const turf = new THREE.Mesh(new THREE.PlaneGeometry(48.8 + 26, 109.7 + 30).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x4c8a3b, roughness: 1 }));
  const field = new THREE.Mesh(fieldGeo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  for (const [m, y] of [[turf, FIELD_Y - 0.05], [field, FIELD_Y]]) { m.position.set(cx, y, cz); m.rotation.y = Math.atan2(ux, uz); m.receiveShadow = true; group.add(m); }
  turf.name = 'soldier-field-turf'; field.name = 'soldier-field-field';
  // Video boards above both end zones, facing the field.
  const screen = new THREE.MeshStandardMaterial({ color: 0x15191d, emissive: 0x9fb8d6, emissiveIntensity: 0, roughness: 0.4 });
  ctx.glows?.push({ mat: screen, day: 0.25, night: 0.7 });
  for (const end of [-1, 1]) {
    const d = A * 0.86, bx = cx + ux * d * end, bz = cz + uz * d * end;
    const b = new THREE.Mesh(new THREE.BoxGeometry(34, 11, 1.6), [concrete, concrete, concrete, concrete, screen, screen]);
    b.position.set(bx, 33, bz); b.rotation.y = Math.atan2(vx, vz) + Math.PI / 2; b.castShadow = true; b.name = 'soldier-field-video-board'; group.add(b);
    const post = new THREE.Mesh(new THREE.BoxGeometry(2, 28, 2), concrete); post.position.set(bx, 14, bz); group.add(post);
  }
  scene.add(group);
  return { group, parts: data.parts.length, columns: columns.length };
}
