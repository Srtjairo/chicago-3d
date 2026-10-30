import {inPoly} from './waterfront-data.js?v=a77776db88b80bf5';
import {COVERAGE_RECTS} from './coverage.js?v=a77776db88b80bf5';

export const EYE_HEIGHT=1.7,PERSON_RADIUS=.45;
const boundsOf=rings=>{const p=rings[0];return {x0:Math.min(...p.map(p=>p[0])),x1:Math.max(...p.map(p=>p[0])),z0:Math.min(...p.map(p=>p[1])),z1:Math.max(...p.map(p=>p[1]))};};
const near=(p,a,b)=>{const dx=b[0]-a[0],dz=b[2]-a[2],t=Math.max(0,Math.min(1,((p.x-a[0])*dx+(p.z-a[2])*dz)/(dx*dx+dz*dz||1)));return {x:a[0]+dx*t,z:a[2]+dz*t,y:a[1]+(b[1]-a[1])*t,d:Math.hypot(p.x-a[0]-dx*t,p.z-a[2]-dz*t)};};
function index(items,size=80){
  const cells=new Map(),wide=[];
  for(const item of items){const a=Math.floor(item.x0/size),b=Math.floor(item.x1/size),c=Math.floor(item.z0/size),d=Math.floor(item.z1/size);if((b-a+1)*(d-c+1)>400){wide.push(item);continue;}
    for(let x=a;x<=b;x++)for(let z=c;z<=d;z++){const key=x+','+z;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(item);}}
  return {at(x,z){return [...(cells.get(Math.floor(x/size)+','+Math.floor(z/size))||[]),...wide];}};
}
const bounded=(s,x,z,margin=0)=>x>=s.x0-margin&&x<=s.x1+margin&&z>=s.z0-margin&&z<=s.z1+margin;
const shapes=polys=>polys.map(rings=>({rings,...boundsOf(rings)}));
function bodyTouches(b,x,z){
  if(!bounded(b,x,z))return false;
  if(!b.rings)return true;
  if(inPoly(x,z,b.rings))return true;
  for(const ring of b.rings)for(let i=0;i<ring.length;i++){const a=ring[i],c=ring[(i+1)%ring.length];if(near({x,z},[a[0],0,a[1]],[c[0],0,c[1]]).d<PERSON_RADIUS)return true;}
  return false;
}

// Geometry-only navigation: no physics dependency or per-frame scene raycasts.
export function createMiniWorld({buildings=[],roads=[],terrain=[],land=[],surfaces=[],walkways=[],bounds=COVERAGE_RECTS}={}){
  const obstacles=index(buildings.map(b=>{const box=b.rings?boundsOf(b.rings):b;return {...b,x0:box.x0-PERSON_RADIUS,x1:box.x1+PERSON_RADIUS,z0:box.z0-PERSON_RADIUS,z1:box.z1+PERSON_RADIUS};}));
  const ground=shapes(terrain),extension=shapes(land),surfaceShapes=surfaces.flatMap(s=>(s.polygons||[]).map(rings=>({rings,...boundsOf(rings),y:s.y??.6,wet:s.kind==='pool'})));
  const groundIndex=index(ground),landIndex=index(extension),surfacesIndex=index(surfaceShapes),segments=[];
  for(const r of [...roads,...walkways])for(let i=1;i<r.path.length;i++){const a=r.path[i-1],b=r.path[i],width=r.width/2+(r.bridge?2:3.5);segments.push({a,b,width,bridge:r.bridge,closed:r.closed,path:r.walkway,name:r.road||'Walkway',x0:Math.min(a[0],b[0])-width,x1:Math.max(a[0],b[0])+width,z0:Math.min(a[2],b[2])-width,z1:Math.max(a[2],b[2])+width});}
  const roadIndex=index(segments);
  const contains=(items,x,z)=>items.some(s=>bounded(s,x,z)&&inPoly(x,z,s.rings));
  const within=(x,z)=>bounds.some(r=>x>r.minX&&x<r.maxX&&z>r.minZ&&z<r.maxZ)||contains(landIndex.at(x,z),x,z);
  function surface(x,z){
    if(!within(x,z))return null;
    const close=roadIndex.at(x,z).filter(s=>bounded(s,x,z)).map(s=>({s,p:near({x,z},s.a,s.b)})).filter(v=>v.p.d<v.s.width);
    if(close.some(v=>v.s.closed&&v.s.bridge))return null;
    const elevated=close.filter(v=>v.s.bridge||v.s.path).sort((a,b)=>a.p.d-b.p.d||b.p.y-a.p.y)[0];
    if(elevated)return Math.max(.6,elevated.p.y+(elevated.s.path?0:.15));
    if(!contains(groundIndex.at(x,z),x,z))return null;
    let y=.6;for(const s of surfacesIndex.at(x,z)){if(!bounded(s,x,z)||!inPoly(x,z,s.rings))continue;if(s.wet)return null;y=Math.max(y,s.y+.04);}return y;
  }
  function blocked(p){return obstacles.at(p.x,p.z).some(b=>p.y+.2>(b.y0??0)&&p.y-EYE_HEIGHT<(b.h??Infinity)&&bodyTouches(b,p.x,p.z));}
  function valid(p,mode='walk'){
    if(![p.x,p.y,p.z].every(Number.isFinite)||p.y<.6+EYE_HEIGHT-.01||p.y>1800||Math.abs(p.x)>6500||Math.abs(p.z)>6500)return false;
    if(mode==='walk'&&surface(p.x,p.z)===null)return false;
    return !blocked(p);
  }
  function findSpawn(point,maxRadius=180){
    const test=(x,z)=>{const y=surface(x,z);if(y===null)return null;const p={x,y:y+EYE_HEIGHT,z};return valid(p)?p:null;};
    let p=test(point.x,point.z);if(p)return p;
    for(let radius=2;radius<=maxRadius;radius+=radius<20?2:8){const count=Math.min(64,Math.ceil(Math.PI*radius));for(let i=0;i<count;i++){const angle=i/count*Math.PI*2;p=test(point.x+Math.cos(angle)*radius,point.z+Math.sin(angle)*radius);if(p)return p;}}return null;
  }
  function move(start,delta,mode='walk'){
    let p={...start},hit=false;const n=Math.max(1,Math.ceil(Math.hypot(delta.x,delta.y||0,delta.z)/.35)),step={x:delta.x/n,y:(delta.y||0)/n,z:delta.z/n};
    const attempt=d=>{const next={x:p.x+d.x,y:p.y+(d.y||0),z:p.z+d.z};if(mode==='walk'){const y=surface(next.x,next.z);if(y===null||Math.abs(y+EYE_HEIGHT-p.y)>.65)return false;next.y=y+EYE_HEIGHT;}else next.y=Math.max(.6+EYE_HEIGHT,Math.min(1800,next.y));if(!valid(next,mode))return false;p=next;return true;};
    for(let i=0;i<n;i++){if(attempt(step))continue;hit=true;attempt({x:step.x,z:0});attempt({x:0,z:step.z});if(mode==='fly')attempt({x:0,y:step.y,z:0});}
    return {...p,blocked:hit};
  }
  return {surface,valid,blocked,findSpawn,move,stats:{buildings:buildings.length,segments:segments.length}};
}
