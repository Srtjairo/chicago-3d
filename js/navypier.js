import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NAVY_PIER, WHEEL } from './geo.js';
import { facadeMaterial } from './textures.js';

const DECK = 3;

export function buildNavyPier(scene, ctx) {
  const { x0, x1, z, w } = NAVY_PIER;
  const concrete = new THREE.MeshStandardMaterial({ color: 0xa9a49a, roughness: 0.9 });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, DECK + 3, w), concrete);
  deck.position.set((x0 + x1) / 2, DECK / 2 - 1.5, z);
  deck.receiveShadow = true;
  scene.add(deck);

  // Long exhibition sheds, Festival Hall, and the domed Grand Ballroom at the end
  const shed = facadeMaterial({ color: 0xc9b9a0, glass: 0x2b3640, cell: [4, 4.5], winA: [0.6, 0.5], lit: 0.55, seed: 91 });
  const roof = new THREE.MeshStandardMaterial({ color: 0x5c6b5e, roughness: 0.7 });
  const add = (geo, mat, px, py, pz) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.castShadow = m.receiveShadow = true; scene.add(m); return m; };
  const sheds = [
    [1470, 1610, -30, 14, 30], [1700, 1990, 26, 12, 30], [1700, 1990, -26, 12, 30],
    [2010, 2260, 0, 22, 80], [1440, 1520, 28, 16, 30],
  ];
  for (const [a, b, oz, h, d] of sheds) {
    const geo = new THREE.BoxGeometry(b - a, h, d).translate(0, h / 2, 0);
    add(geo, shed, (a + b) / 2, DECK, z + oz);
    const r = new THREE.CylinderGeometry(d / 2, d / 2, b - a, 16, 1, false, 0, Math.PI);
    r.rotateZ(Math.PI / 2);
    r.scale(1, 0.3, 1);
    add(r, roof, (a + b) / 2, DECK + h, z + oz);
  }
  // Headhouse towers and ballroom dome
  add(new THREE.BoxGeometry(14, 30, 14).translate(0, 15, 0), shed, 2290, DECK, z - 30);
  add(new THREE.BoxGeometry(14, 30, 14).translate(0, 15, 0), shed, 2290, DECK, z + 30);
  add(new THREE.CylinderGeometry(42, 42, 14, 48).translate(0, 7, 0), shed, 2360, DECK, z);
  add(new THREE.SphereGeometry(42, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.45, 1), roof, 2360, DECK + 14, z);

  // Centennial Wheel: 196 ft tall, 42 gondolas
  const R = 29;
  const hub = new THREE.Vector3(WHEEL.x, DECK + 33, WHEEL.z + 18);
  const white = new THREE.MeshStandardMaterial({ color: 0xeef0f2, metalness: 0.6, roughness: 0.35 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xe8ecef, metalness: 0.5, roughness: 0.3, emissive: 0xffffff, emissiveIntensity: 0 });
  const wheel = new THREE.Group();
  wheel.position.copy(hub);
  const parts = [];
  for (const dz of [-1.6, 1.6]) parts.push(new THREE.TorusGeometry(R, 0.55, 8, 96).translate(0, 0, dz));
  for (let i = 0; i < 42; i++) {
    const a = i / 42 * Math.PI * 2;
    for (const dz of [-1.6, 1.6]) {
      const spoke = new THREE.CylinderGeometry(0.12, 0.12, R, 4);
      spoke.translate(0, R / 2, 0);
      spoke.rotateX(Math.sign(dz) * 0.05);
      spoke.rotateZ(a);
      spoke.translate(0, 0, dz * 0.2);
      parts.push(spoke);
    }
  }
  const rim = new THREE.Mesh(mergeGeometries(parts), rimMat);
  rim.castShadow = true;
  wheel.add(rim);
  wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 6, 16).rotateX(Math.PI / 2), white));
  scene.add(wheel);
  // A-frame legs
  const legs = [];
  for (const dz of [-6, 6]) {
    for (const dx of [-12, 12]) {
      const a = new THREE.Vector3(hub.x + dx, DECK, hub.z + dz);
      const len = a.distanceTo(hub);
      const leg = new THREE.CylinderGeometry(0.7, 1, len, 8);
      leg.translate(0, len / 2, 0);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), hub.clone().sub(a).normalize());
      leg.applyQuaternion(q);
      leg.translate(a.x, a.y, a.z);
      legs.push(leg);
    }
  }
  add(mergeGeometries(legs), white, 0, 0, 0);

  const gondolaMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.2 });
  const gondolas = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 2.7, 2.4), gondolaMat, 42);
  const gc = new THREE.Color();
  for (let i = 0; i < 42; i++) gondolas.setColorAt(i, gc.setHSL(0.55 + (i % 3) * 0.02, 0.15, 0.85));
  gondolas.castShadow = true;
  scene.add(gondolas);

  ctx.glows.push({ mat: rimMat, day: 0, night: 1.4 });
  const m = new THREE.Matrix4();
  ctx.updaters.push((time, night) => {
    const spin = time * 0.035;
    wheel.rotation.z = spin;
    for (let i = 0; i < 42; i++) {
      const a = spin + i / 42 * Math.PI * 2;
      m.makeTranslation(hub.x + Math.cos(a) * (R + 0.5), hub.y + Math.sin(a) * (R + 0.5) - 1.8, hub.z);
      gondolas.setMatrixAt(i, m);
    }
    gondolas.instanceMatrix.needsUpdate = true;
    // The rim cycles through colors after dark, like the real wheel's LED show
    if (night > 0.05) rimMat.emissive.setHSL((time * 0.03) % 1, 0.8, 0.55);
  });
}
