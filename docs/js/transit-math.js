// Metres throughout. No Three.js dependency: shared by import, simulation and checks.
export const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
export function clean(points){return points.filter((p,i)=>!i||distance(p,points[i-1])>.02);}
export function route2(points){const lengths=[0];for(let i=1;i<points.length;i++)lengths.push(lengths.at(-1)+distance(points[i-1],points[i]));return {points,lengths,length:lengths.at(-1)};}
export function nearest(points,p,minD=0,firstPass=false){
  let best={error:Infinity,d:0,point:points[0],angle:0},along=0;
  for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(len<.01)continue;
    const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(len*len))),q=[a[0]+dx*t,a[1]+dz*t],d=along+t*len,error=distance(q,p);
    if(firstPass&&best.error<30&&error>30&&along>best.d)return best;
    if(d>=minD&&error<best.error)best={error,d,point:q,angle:Math.atan2(dx,dz),index:i-1};along+=len;
  }return best;
}
export function sample2(r,d){d=Math.max(0,Math.min(r.length,d));let a=0,b=r.lengths.length-1;while(a+1<b){const m=(a+b)>>1;if(r.lengths[m]<=d)a=m;else b=m;}const p=r.points[a],q=r.points[Math.min(a+1,r.points.length-1)],t=(d-r.lengths[a])/(r.lengths[a+1]-r.lengths[a]||1);return [p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t];}
export function resample(points,step=5){const r=route2(clean(points));if(r.points.length<2)return r.points;const out=[];for(let d=0;d<r.length;d+=step)out.push(sample2(r,d));out.push(r.points.at(-1));return out;}
export function clipPolyline(points,rects){
  const parts=[];let current=null;
  for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[1]-a[1],intervals=[];
    for(const r of rects){let lo=0,hi=1,ok=true;for(const [p,q]of [[-dx,a[0]-r.minX],[dx,r.maxX-a[0]],[-dz,a[1]-r.minZ],[dz,r.maxZ-a[1]]]){if(Math.abs(p)<1e-10){if(q<0)ok=false;}else if(p<0)lo=Math.max(lo,q/p);else hi=Math.min(hi,q/p);}if(ok&&hi>lo)intervals.push([lo,hi]);}
    intervals.sort((a,b)=>a[0]-b[0]);const union=[];for(const v of intervals){if(union.length&&v[0]<=union.at(-1)[1]+1e-8)union.at(-1)[1]=Math.max(v[1],union.at(-1)[1]);else union.push(v);}
    for(const [lo,hi]of union){const p=[a[0]+lo*dx,a[1]+lo*dz],q=[a[0]+hi*dx,a[1]+hi*dz];if(!current||distance(current.at(-1),p)>.1){current=[p];parts.push(current);}if(distance(current.at(-1),q)>.01)current.push(q);if(hi<1-1e-8)current=null;}
    if(!union.length)current=null;
  }return parts.filter(p=>p.length>1);
}
export function railHeight(x,z){
  // Visual estimates relative to the existing local ground. Bridge decks sit higher.
  const wells=Math.max(0,1-Math.abs(x+505)/15)*Math.max(0,1-Math.abs(z+601)/220);
  const lake=Math.max(0,1-Math.abs(z+409)/15)*Math.max(0,1-Math.abs(x+810)/220);
  return 8.9+2.5*Math.max(wells,lake);
}
export const round=n=>Math.round(n*100)/100;
// Rendering alone can merge collinear samples. Keep both the 3D alignment and
// the widening track profile within 3 cm; simulation/source points stay intact.
export function simplifyRail(points,tolerance=.03){
  if(points.length<3)return points;
  const profile=points.map(p=>[...p,trackOffset(p[0],p[2])]),keep=new Set([0,points.length-1]),pending=[[0,points.length-1]];
  while(pending.length){const [start,end]=pending.pop(),a=profile[start],b=profile[end],v=b.map((n,i)=>n-a[i]),len=v.reduce((n,x)=>n+x*x,0);let far=-1,error=tolerance*tolerance;
    for(let i=start+1;i<end;i++){const p=profile[i],t=len?Math.max(0,Math.min(1,p.reduce((n,x,k)=>n+(x-a[k])*v[k],0)/len)):0,d=p.reduce((n,x,k)=>n+(x-a[k]-t*v[k])**2,0);if(d>error){far=i;error=d;}}
    if(far>=0){keep.add(far);pending.push([start,far],[far,end]);}
  }
  return [...keep].sort((a,b)=>a-b).map(i=>points[i]);
}
// Roosevelt's island platform requires a wider pair of tracks than the Loop.
export function trackOffset(x,z){return x>50&&x<145&&z>1566?1.8+3*Math.min(1,(z-1566)/10,Math.max(0,(1703-z)/14)):1.8;}
