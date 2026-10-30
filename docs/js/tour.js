import * as THREE from 'three';
import { LANDMARKS } from './geo.js?v=bc893891e5c0c0d3';
import { SLAB_TOP } from './terrain.js?v=bc893891e5c0c0d3';

const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

export const OVERVIEW = {
  pos: new THREE.Vector3(1900, 1120, 1550),
  target: new THREE.Vector3(-100, 65, -400),
};

// Pull back on portrait screens so the whole skyline fits
export function overviewPos(aspect) {
  return OVERVIEW.target.clone().lerp(OVERVIEW.pos, aspect < 1 ? 1.55 : 1);
}

// Stops on the guided tour, in geographic order: lakefront, Loop, river, Mag Mile, pier, park
const TOUR = ['grantpark', 'fountain', 'board', 'willis', 'riverside', 'mart', 'marina', 'trump', 'wrigley', 'tribune', 'hancock', 'navypier', 'stregis', 'aqua', 'aon', 'carbide', 'pritzker', 'bean'];

export class Flyer {
  constructor(camera, controls, ctx = {}) {
    this.camera = camera;
    this.controls = controls;
    this.ctx = ctx;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.anim = null;
    this.tour = null;
    this.onStop = null;
    this.onCaption = null;
  }

  viewFor(L) {
    const v = L.view;
    const distance = v.dist * (this.camera.aspect < 1 ? 1.3 : 1);
    const target = new THREE.Vector3(L.x, SLAB_TOP + Math.min(L.h, L.roof * 1.05) * 0.5, L.z);
    if(v.focus)target.add(new THREE.Vector3(...v.focus));
    let best=null,bestScore=Infinity;
    for(const elevation of [v.el,Math.max(v.el,.42),.62,.82])for(const delta of [0,.45,-.45,.9,-.9,1.6,-1.6,Math.PI]){
      const az=v.az+delta,pos=new THREE.Vector3(target.x+Math.sin(az)*distance*Math.cos(elevation),target.y+Math.sin(elevation)*distance,target.z+Math.cos(az)*distance*Math.cos(elevation));
      let blocked=0;
      // Check the lower facade and both sides as well as the center. A clear
      // center ray alone can leave a wide landmark hidden behind a foreground roof.
      for(const [side,height]of [[0,.5],[0,.22],[0,.85],[-.65,.5],[.65,.5]]){
        const tx=target.x+Math.cos(az)*(v.width??L.r)*side,tz=target.z-Math.sin(az)*(v.width??L.r)*side,ty=SLAB_TOP+L.roof*height;
        for(const b of this.ctx.collisionBuildings||[]){if(b.id===L.id)continue;
          let hit=false;
          for(let t=.1;t<=1;t+=.05){const x=tx+(pos.x-tx)*t,y=ty+(pos.y-ty)*t,z=tz+(pos.z-tz)*t;
            const margin=v.clearance??5;
            if(x>b.x0-margin&&x<b.x1+margin&&z>b.z0-margin&&z<b.z1+margin&&y<b.h+8){hit=true;break;}
          }
          if(hit){blocked++;break;}
        }
      }
      const score=blocked*100+Math.abs(delta)+(elevation-v.el)*5;
      if(score<bestScore){bestScore=score;best={pos,target};}if(score===0)return best;
    }
    return best;
  }

  flyTo(pos, target, dur = 2.8) {
    const p0 = this.camera.position.clone();
    const dist = p0.distanceTo(pos);
    if (this.reducedMotion) { this.camera.position.copy(pos); this.controls.target.copy(target); this.anim=null; return; }
    let clearance=Math.max(p0.y,pos.y)+Math.min(dist*0.18,500);
    for(const b of this.ctx.collisionBuildings || []) {
      // Test the whole projected route against expanded building bounds.
      for(let t=0;t<=1;t+=0.04){const x=p0.x+(pos.x-p0.x)*t,z=p0.z+(pos.z-p0.z)*t;if(x>b.x0-25&&x<b.x1+25&&z>b.z0-25&&z<b.z1+25)clearance=Math.max(clearance,b.h+70);}
    }
    this.anim = {
      p0, p1: pos.clone(), l0: this.controls.target.clone(), l1: target.clone(), t: 0,
      dur: THREE.MathUtils.clamp(dur * (0.6 + dist / 3500), 1.6, 5.5),
      clearance,
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
      // Ascend, cross above the city, then descend: no straight flight through towers.
      const travel=ease(THREE.MathUtils.clamp((k-0.22)/0.56,0,1));
      this.camera.position.lerpVectors(a.p0,a.p1,travel);
      this.camera.position.y=k<0.22?THREE.MathUtils.lerp(a.p0.y,a.clearance,ease(k/0.22))
        :k>0.78?THREE.MathUtils.lerp(a.clearance,a.p1.y,ease((k-0.78)/0.22)):a.clearance;
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
