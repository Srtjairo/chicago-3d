import * as THREE from 'three';
import { LANDMARKS } from './geo.js';
import { SLAB_TOP } from './terrain.js';

const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

export const OVERVIEW = {
  pos: new THREE.Vector3(2350, 720, 1650),
  target: new THREE.Vector3(-150, 140, -450),
};

// Pull back on portrait screens so the whole skyline fits
export function overviewPos(aspect) {
  return OVERVIEW.target.clone().lerp(OVERVIEW.pos, aspect < 1 ? 1.55 : 1);
}

// Stops on the guided tour, in geographic order: lakefront, Loop, river, Mag Mile, pier, park
const TOUR = ['grantpark', 'fountain', 'willis', 'marina', 'wrigley', 'trump', 'hancock', 'navypier', 'stregis', 'aon', 'pritzker', 'bean'];

export class Flyer {
  constructor(camera, controls) {
    this.camera = camera;
    this.controls = controls;
    this.anim = null;
    this.tour = null;
    this.onStop = null;
    this.onCaption = null;
  }

  viewFor(L) {
    const v = L.view;
    const target = new THREE.Vector3(L.x, SLAB_TOP + Math.min(L.h, L.roof * 1.05) * 0.5, L.z);
    const pos = new THREE.Vector3(
      L.x + Math.sin(v.az) * v.dist * Math.cos(v.el),
      target.y + Math.sin(v.el) * v.dist,
      L.z + Math.cos(v.az) * v.dist * Math.cos(v.el),
    );
    return { pos, target };
  }

  flyTo(pos, target, dur = 2.8) {
    const p0 = this.camera.position.clone();
    const dist = p0.distanceTo(pos);
    this.anim = {
      p0, p1: pos.clone(), l0: this.controls.target.clone(), l1: target.clone(), t: 0,
      dur: THREE.MathUtils.clamp(dur * (0.6 + dist / 3500), 1.6, 5.5),
      lift: Math.min(dist * 0.18, 500),
    };
    this.controls.autoRotate = false;
  }

  flyToLandmark(id, dur) {
    const L = LANDMARKS.find((l) => l.id === id);
    const { pos, target } = this.viewFor(L);
    this.flyTo(pos, target, dur);
    return L;
  }

  startTour() {
    this.tour = { i: -1, hold: 0 };
    this.next();
  }

  stopTour() {
    if (!this.tour) return;
    this.tour = null;
    this.controls.autoRotate = false;
    this.onStop?.();
  }

  cancel() {
    this.anim = null;
    this.stopTour();
  }

  next() {
    const t = this.tour;
    t.i++;
    if (t.i >= TOUR.length) {
      this.flyTo(overviewPos(this.camera.aspect), OVERVIEW.target, 3.5);
      this.onCaption?.(null);
      this.tour = null;
      this.onStop?.();
      return;
    }
    const L = this.flyToLandmark(TOUR[t.i], 3.2);
    this.onCaption?.(L);
    t.hold = 5.5;
  }

  update(dt) {
    const a = this.anim;
    if (a) {
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      const e = ease(k);
      this.camera.position.lerpVectors(a.p0, a.p1, e);
      this.camera.position.y += Math.sin(Math.PI * e) * a.lift;
      this.controls.target.lerpVectors(a.l0, a.l1, ease(Math.min(1, k * 1.25)));
      if (k >= 1) {
        this.anim = null;
        if (this.tour) {
          this.controls.autoRotate = true;
          this.controls.autoRotateSpeed = 0.9;
        }
      }
    } else if (this.tour) {
      this.tour.hold -= dt;
      if (this.tour.hold <= 0) this.next();
    }
  }
}

export { TOUR };
