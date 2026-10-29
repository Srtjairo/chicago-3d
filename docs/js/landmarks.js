import * as THREE from 'three';
import { LANDMARKS } from './geo.js';
import { facadeMaterial } from './textures.js';
import { SLAB_TOP } from './terrain.js';

const byId = Object.fromEntries(LANDMARKS.map((l) => [l.id, l]));

// --- geometry helpers -------------------------------------------------------

function box(w, h, d, segY = 1) {
  const g = new THREE.BoxGeometry(w, h, d, 1, segY, 1);
  g.translate(0, h / 2, 0);
  return g;
}

// Box whose footprint shrinks linearly from (wb x db) at the base to (wt x dt) at the top
function frustum(wb, db, wt, dt, h) {
  const g = new THREE.BoxGeometry(1, h, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const top = p.getY(i) > 0;
    p.setX(i, p.getX(i) * (top ? wt : wb));
    p.setZ(i, p.getZ(i) * (top ? dt : db));
  }
  g.translate(0, h / 2, 0);
  g.computeVertexNormals();
  return g;
}

function roundedRect(w, d, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

// Extrude a plan shape straight up from y0 to y0 + h
function extrudeUp(shape, h, y0 = 0, segments = 6) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: segments });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function antenna(height, r0, r1, mat) {
  const g = new THREE.CylinderGeometry(r1, r0, height, 8);
  g.translate(0, height / 2, 0);
  return new THREE.Mesh(g, mat);
}

const tmpQ = new THREE.Quaternion();
const zAxis = new THREE.Vector3(0, 0, 1);
function beamMatrix(a, b, t) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  tmpQ.setFromUnitVectors(zAxis, dir.normalize());
  return new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), tmpQ.clone(), new THREE.Vector3(t, t, len));
}

// --- landmarks --------------------------------------------------------------

function willis(ctx) {
  const L = byId.willis;
  const g = new THREE.Group();
  const t = 22.86;               // each of the nine tubes is 75 ft square
  const fl = L.roof / 108;       // floor-to-floor height
  const floors = {
    '-1,-1': 50, '0,-1': 90, '1,-1': 66,
    '-1,0': 108, '0,0': 108, '1,0': 90,
    '-1,1': 66, '0,1': 90, '1,1': 50,
  };
  const mat = facadeMaterial({
    color: 0x1a1b1e, glass: 0x2a241e, cell: [1.52, fl], winA: [0.7, 0.74], winB: [0.7, 0.74],
    lit: 0.36, roughness: 0.45, metalness: 0.6, glassRough: 0.08, seed: 11,
  });
  const band = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.7, metalness: 0.4 });
  const mech = [29.5, 65.5, 88.5, 104.5];
  for (const [key, n] of Object.entries(floors)) {
    const [i, j] = key.split(',').map(Number);
    const h = n * fl;
    g.add(mesh(box(t, h, t), mat, i * t, 0, j * t));
    for (const f of mech) {
      if (f < n - 1) g.add(mesh(box(t + 0.5, fl * 1.6, t + 0.5), band, i * t, f * fl - fl * 0.8, j * t));
    }
    g.add(mesh(box(t + 0.4, 2.2, t + 0.4), band, i * t, h - 1.2, j * t)); // parapet
  }
  // Rooftop mechanical and the two white antennas
  g.add(mesh(box(t * 1.6, 8, t * 0.8), band, -t * 0.5, L.roof, 0));
  const white = new THREE.MeshStandardMaterial({ color: 0xe9e9e6, roughness: 0.5, metalness: 0.3 });
  for (const ax of [-t * 1.05, t * 0.05]) {
    const a = antenna(L.h - L.roof, 1.9, 0.45, white);
    a.position.set(ax, L.roof + 8, 0);
    a.castShadow = true;
    g.add(a);
    ctx.beacons.push(new THREE.Vector3(L.x + ax, SLAB_TOP + L.h + 8, L.z));
  }
  g.position.set(L.x, SLAB_TOP, L.z);
  return g;
}

function hancock(ctx) {
  const L = byId.hancock;
  const g = new THREE.Group();
  const [wb, db, wt, dt, h] = [50, 81, 30, 49, L.roof];
  const mat = facadeMaterial({
    color: 0x151515, glass: 0x24211e, cell: [3.0, 3.44], winA: [0.66, 0.68], winB: [0.66, 0.68],
    lit: 0.4, roughness: 0.5, metalness: 0.55, glassRough: 0.1, seed: 23,
  });
  g.add(mesh(frustum(wb, db, wt, dt, h), mat));

  // Exterior X-bracing, five tiers on every face, plus ties and corner columns
  const wAt = (y) => wb + (wt - wb) * y / h;
  const dAt = (y) => db + (dt - db) * y / h;
  const off = 0.9;
  const pt = (face, y, f) => {
    const w = wAt(y) / 2, d = dAt(y) / 2;
    if (face === 'e') return new THREE.Vector3(w + off, y, f * d);
    if (face === 'w') return new THREE.Vector3(-w - off, y, f * d);
    if (face === 's') return new THREE.Vector3(f * w, y, d + off);
    return new THREE.Vector3(f * w, y, -d - off);
  };
  const beams = [];
  const tiers = 5, y0 = 9;
  const step = (h - y0) / tiers;
  for (const face of ['e', 'w', 's', 'n']) {
    for (let k = 0; k < tiers; k++) {
      const a = y0 + k * step, b = a + step;
      beams.push(beamMatrix(pt(face, a, -1), pt(face, b, 1), 1.7));
      beams.push(beamMatrix(pt(face, a, 1), pt(face, b, -1), 1.7));
    }
    for (let k = 0; k <= tiers; k++) {
      const y = y0 + k * step;
      beams.push(beamMatrix(pt(face, y, -1), pt(face, y, 1), 1.4));
    }
  }
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    beams.push(beamMatrix(
      new THREE.Vector3(sx * (wb / 2 + off), 0, sz * (db / 2 + off)),
      new THREE.Vector3(sx * (wt / 2 + off), h, sz * (dt / 2 + off)), 1.9));
  }
  const steel = new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.55, metalness: 0.6 });
  const braces = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), steel, beams.length);
  beams.forEach((m, i) => braces.setMatrixAt(i, m));
  braces.castShadow = true;
  g.add(braces);

  // The white crown that lights up at night
  const crown = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.4, emissive: 0xf4f6ff, emissiveIntensity: 0 });
  ctx.glows.push({ mat: crown, day: 0, night: 2.2 });
  const yc = h - 11;
  g.add(mesh(box(wAt(yc) + 1.4, 7, dAt(yc) + 1.4), crown, 0, yc - 3.5, 0));
  g.add(mesh(box(wt, 6, dt), steel, 0, h, 0));

  const ant = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.5 });
  for (const az of [-12, 12]) {
    const a = antenna(L.h - L.roof, 1.4, 0.35, ant);
    a.position.set(0, h + 6, az);
    a.castShadow = true;
    g.add(a);
    ctx.beacons.push(new THREE.Vector3(L.x, SLAB_TOP + L.h + 6, L.z + az));
  }
  g.position.set(L.x, SLAB_TOP, L.z);
  return g;
}

function trump(ctx) {
  const L = byId.trump;
  const g = new THREE.Group();
  const mat = facadeMaterial({
    color: 0xa7b2bb, glass: 0x5c7383, cell: [1.6, 3.3], winA: [0.88, 0.86], winB: [0.88, 0.86], style: 1,
    lit: 0.4, roughness: 0.3, metalness: 0.75, glassRough: 0.06, seed: 31,
  });
  const tiers = [[64, 44, 0, 92], [56, 40, 92, 205], [48, 36, 205, 335], [40, 31, 335, 357]];
  for (const [w, d, y0, y1] of tiers) g.add(mesh(extrudeUp(roundedRect(w, d, 9), y1 - y0, y0), mat));
  const steel = new THREE.MeshStandardMaterial({ color: 0xc7ccd0, roughness: 0.35, metalness: 0.8, emissive: 0xffffff, emissiveIntensity: 0 });
  ctx.glows.push({ mat: steel, day: 0, night: 0.5 });
  const spire = antenna(L.h - L.roof, 2.4, 0.3, steel);
  spire.position.set(0, L.roof, 0);
  g.add(spire);
  ctx.beacons.push(new THREE.Vector3(L.x, SLAB_TOP + L.h, L.z));
  g.position.set(L.x, SLAB_TOP, L.z);
  return g;
}

function stRegis(ctx) {
  const L = byId.stregis;
  const g = new THREE.Group();
  const mat = facadeMaterial({
    color: 0x8fb9c9, glass: 0x3e6d80, cell: [1.5, 3.25], winA: [0.9, 0.84], winB: [0.9, 0.84], style: 1,
    lit: 0.42, roughness: 0.25, metalness: 0.6, glassRough: 0.05, seed: 41,
  });
  // Three stacked frustums of different heights; their depth swells and pinches with height
  const towers = [[-27, 210, 1], [0, L.h, -1], [27, 290, 1]];
  for (const [ox, h, phase] of towers) {
    const geo = new THREE.BoxGeometry(26, h, 44, 1, 24, 1);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / h + 0.5;
      const tri = 1 - Math.abs(((y * 2.2 + (phase > 0 ? 0 : 0.5)) % 1) * 2 - 1);
      p.setZ(i, p.getZ(i) * (0.84 + 0.22 * tri));
    }
    geo.translate(0, h / 2, 0);
    geo.computeVertexNormals();
    g.add(mesh(geo, mat, ox, 0, phase * 4));
    ctx.beacons.push(new THREE.Vector3(L.x + ox, SLAB_TOP + h + 1, L.z + phase * 4));
  }
  g.position.set(L.x, SLAB_TOP, L.z);
  return g;
}

function aon(ctx) {
  const L = byId.aon;
  const g = new THREE.Group();
  const mat = facadeMaterial({
    color: 0xe7e5df, glass: 0x262b31, cell: [1.55, 3.8], winA: [0.4, 0.93], winB: [0.4, 0.93],
    lit: 0.38, roughness: 0.55, metalness: 0.05, seed: 53,
  });
  g.add(mesh(box(58, L.h - 6, 58), mat));
  const top = new THREE.MeshStandardMaterial({ color: 0xd9d6cf, roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0 });
  ctx.glows.push({ mat: top, day: 0, night: 0.35 });
  g.add(mesh(box(50, 6, 50), top, 0, L.h - 6, 0));
  for (const [sx, sz] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) ctx.beacons.push(new THREE.Vector3(L.x + sx * 24, SLAB_TOP + L.h + 0.8, L.z + sz * 24));
  g.position.set(L.x, SLAB_TOP, L.z);
  return g;
}

function prudential(ctx) {
  const L = byId.prudential;
  const g = new THREE.Group();
  const mat = facadeMaterial({
    color: 0xb9aba2, glass: 0x2b3541, cell: [1.8, 3.9], winA: [0.55, 0.6], winB: [0.55, 0.6],
    lit: 0.4, roughness: 0.7, seed: 67,
  });
  // Square plan with notched corners
  const s = new THREE.Shape();
  const a = 24, n = 5;
  s.moveTo(-a + n, -a); s.lineTo(a - n, -a); s.lineTo(a - n, -a + n); s.lineTo(a, -a + n); s.lineTo(a, a - n);
  s.lineTo(a - n, a - n); s.lineTo(a - n, a); s.lineTo(-a + n, a); s.lineTo(-a + n, a - n); s.lineTo(-a, a - n);
  s.lineTo(-a, -a + n); s.lineTo(-a + n, -a + n); s.closePath();
  g.add(mesh(extrudeUp(s, 228), mat));
  g.add(mesh(box(40, 14, 40), mat, 0, 228, 0));
  g.add(mesh(box(32, 12, 32), mat, 0, 242, 0));
  const crownMat = new THREE.MeshStandardMaterial({ color: 0xa69a91, roughness: 0.6, emissive: 0xfff1d6, emissiveIntensity: 0 });
  ctx.glows.push({ mat: crownMat, day: 0, night: 0.6 });
  const pyr = new THREE.ConeGeometry(22, 34, 4);
  pyr.rotateY(Math.PI / 4);
  pyr.translate(0, 17, 0);
  g.add(mesh(pyr, crownMat, 0, 254, 0));
  const spire = antenna(L.h - 288, 1.2, 0.2, new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.7, roughness: 0.3 }));
  spire.position.set(0, 285, 0);
  g.add(spire);
  ctx.beacons.push(new THREE.Vector3(L.x, SLAB_TOP + L.h, L.z));
  g.position.set(L.x, SLAB_TOP, L.z);
  return g;
}

function marinaCity(ctx) {
  const L = byId.marina;
  const g = new THREE.Group();
  const floors = 65, fl = L.h / floors;
  const core = facadeMaterial({
    color: 0x8f8a82, glass: 0x24272c, cell: [2.2, fl], winA: [0.7, 0.75], winB: [0.7, 0.75],
    lit: 0.5, roughness: 0.8, seed: 79,
  });
  const parking = new THREE.MeshStandardMaterial({ color: 0x3a3936, roughness: 0.9 });
  // Scalloped floor plate: 16 rounded balconies around the core
  const petal = new THREE.Shape();
  const N = 192;
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * Math.PI * 2;
    const r = 13 + 4.6 * Math.pow(Math.abs(Math.sin(th * 8)), 0.55);
    const x = Math.cos(th) * r, y = Math.sin(th) * r;
    if (i === 0) petal.moveTo(x, y); else petal.lineTo(x, y);
  }
  const hole = new THREE.Path();
  hole.absarc(0, 0, 10.5, 0, Math.PI * 2, true);
  petal.holes.push(hole);
  const plateGeo = extrudeUp(petal, 0.45, 0, 4);
  const plateMat = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.75 });
  const plates = new THREE.InstancedMesh(plateGeo, plateMat, floors * 2);
  const m = new THREE.Matrix4();
  let k = 0;
  for (const ox of [-28, 28]) {
    g.add(mesh(new THREE.CylinderGeometry(11.5, 11.5, 19 * fl, 32).translate(0, 19 * fl / 2, 0), parking, ox, 0, 0));
    g.add(mesh(new THREE.CylinderGeometry(12.2, 12.2, (floors - 19) * fl, 48).translate(0, (floors - 19) * fl / 2, 0), core, ox, 19 * fl, 0));
    g.add(mesh(new THREE.CylinderGeometry(14, 14, 2.4, 48).translate(0, 1.2, 0), plateMat, ox, L.h, 0));
    for (let f = 1; f < floors; f++) {
      m.makeRotationY(f < 19 ? f * 0.2 : 0);
      m.setPosition(ox, f * fl, 0);
      plates.setMatrixAt(k++, m);
    }
    ctx.beacons.push(new THREE.Vector3(L.x + ox, SLAB_TOP + L.h + 3, L.z));
  }
  plates.count = k;
  plates.castShadow = plates.receiveShadow = true;
  g.add(plates);
  g.position.set(L.x, SLAB_TOP, L.z);
  return g;
}

function wrigley(ctx) {
  const L = byId.wrigley;
  const g = new THREE.Group();
  const fl = 4.1;
  // Terra-cotta runs from blue-white at the base to creamy white up top; the floodlights wash all of it
  const terra = (color, seed) => {
    const m = facadeMaterial({
      color, glass: 0x262a30, cell: [1.7, fl], winA: [0.42, 0.58], winB: [0.42, 0.58],
      lit: 0.4, roughness: 0.55, seed,
    });
    m.emissive.set(0xfff1dc);
    m.emissiveIntensity = 0;
    ctx.glows.push({ mat: m, day: 0, night: 0.22 });
    return m;
  };
  const base = terra(0xe4e8ec, 103);
  const upper = terra(0xf2ecdf, 107);
  const trim = new THREE.MeshStandardMaterial({ color: 0xf4eee2, roughness: 0.5, emissive: 0xfff1dc, emissiveIntensity: 0 });
  ctx.glows.push({ mat: trim, day: 0, night: 0.45 });

  // South tower's main block along Michigan Ave, and the lower north tower across North Water St
  const [sx, sz, sw, sd, sh] = [12, 18, 34, 50, 66];
  const [nx, nz, nw, nd, nh] = [6, -34, 36, 26, 89.6];
  g.add(mesh(box(sw, sh, sd), base, sx, 0, sz));
  g.add(mesh(box(sw + 1.2, 1.6, sd + 1.2), trim, sx, sh, sz));
  g.add(mesh(box(nw, nh - 1.6, nd), base, nx, 0, nz));
  g.add(mesh(box(nw + 1.2, 1.6, nd + 1.2), trim, nx, nh - 1.6, nz));

  // Skybridges at the 3rd floor and the 14th (1931)
  const gap0 = nz + nd / 2, gap1 = sz - sd / 2;
  for (const f of [3, 14]) g.add(mesh(box(10, fl, gap1 - gap0), base, 10, (f - 1) * fl, (gap0 + gap1) / 2));

  // Clock tower at the river end: shaft, clock stage, two stepped octagons, the cupola and a finial
  const tz = sz + sd / 2 - 11;
  g.add(mesh(box(19, 94 - sh, 19), upper, sx, sh, tz));
  g.add(mesh(box(17, 12, 17), trim, sx, 94, tz));
  g.add(mesh(box(18.4, 1.2, 18.4), trim, sx, 105, tz));
  const oct = (r0, r1, h) => new THREE.CylinderGeometry(r1, r0, h, 8).rotateY(Math.PI / 8).translate(0, h / 2, 0);
  g.add(mesh(oct(8.6, 8.2, 8), upper, sx, 106, tz));
  g.add(mesh(oct(6.4, 6, 7), trim, sx, 114, tz));
  const dome = new THREE.SphereGeometry(5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.45, 1);
  g.add(mesh(dome, trim, sx, 121, tz));
  const lantern = antenna(129.5 - 127.5, 1.6, 1.3, trim);
  lantern.position.set(sx, 127.5, tz);
  g.add(lantern);
  const finial = antenna(L.h - L.roof, 0.5, 0.08, trim);
  finial.position.set(sx, L.roof, tz);
  g.add(finial);

  // Four clock faces, 19 ft 7 in across, lit from behind at night
  const face = new THREE.MeshStandardMaterial({ color: 0xf7f3e8, roughness: 0.4, emissive: 0xfff4d8, emissiveIntensity: 0 });
  ctx.glows.push({ mat: face, day: 0, night: 0.8 });
  const clocks = new THREE.InstancedMesh(new THREE.CircleGeometry(2.98, 24), face, 4);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    m.makeRotationY(a).setPosition(sx + Math.sin(a) * 8.56, 100, tz + Math.cos(a) * 8.56);
    clocks.setMatrixAt(i, m);
  }
  g.add(clocks);
  g.position.set(L.x, SLAB_TOP, L.z);
  return g;
}

export function buildLandmarks(scene, ctx) {
  const builders = { willis, hancock, trump, stregis: stRegis, aon, prudential, marina: marinaCity, wrigley };
  for (const [id, fn] of Object.entries(builders)) {
    const group = fn(ctx);
    group.name = id;
    scene.add(group);
  }

  // Aviation beacons blink red after dark
  const beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.08, 0.05), toneMapped: false });
  const beacons = new THREE.InstancedMesh(new THREE.SphereGeometry(1.4, 10, 8), beaconMat, ctx.beacons.length);
  const m = new THREE.Matrix4();
  ctx.beacons.forEach((p, i) => beacons.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
  scene.add(beacons);
  ctx.beaconMat = beaconMat;
}
