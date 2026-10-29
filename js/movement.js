// Pure route math shared by rendering and tests. Distances are metres, time is seconds.
export function makeRoute(points) {
  const lengths=[0];
  for(let i=1;i<points.length;i++) lengths.push(lengths.at(-1)+Math.hypot(...points[i].map((v,k)=>v-points[i-1][k])));
  return { points, lengths, length:lengths.at(-1) };
}
export function atDistance(route,d,out={}) {
  d=Math.max(0,Math.min(route.length,d));
  let lo=0,hi=route.lengths.length-1;
  while(lo+1<hi){const m=(lo+hi)>>1;if(route.lengths[m]<=d)lo=m;else hi=m;}
  const a=route.points[lo],b=route.points[Math.min(lo+1,route.points.length-1)],span=route.lengths[Math.min(lo+1,route.lengths.length-1)]-route.lengths[lo];
  const t=span>0?(d-route.lengths[lo])/span:0;
  out.x=a[0]+(b[0]-a[0])*t;out.y=a[1]+(b[1]-a[1])*t;out.z=a[2]+(b[2]-a[2])*t;
  out.angle=Math.atan2(b[0]-a[0],b[2]-a[2]);return out;
}
export function offsetPath(points,offset) {
  return points.map((p,i)=>{
    const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],dx=b[0]-a[0],dz=b[2]-a[2],n=Math.hypot(dx,dz)||1;
    return [p[0]-dz/n*offset,p[1],p[2]+dx/n*offset];
  });
}
export function signalGreen(time,axis,id=0) {
  const phase=((time+(id%7))%40+40)%40;
  return axis===0?phase<18:phase>=20&&phase<38;
}
export function canCross(time,roadAxis,id,duration) {
  const phase=((time+(id%7))%40+40)%40;
  const start=roadAxis===0?20:0,end=start+18;
  return phase>=start&&phase+duration+1<end;
}
export function trimRoute(points,start,end) {
  const r=makeRoute(points);if(r.length<start+end+1)return null;
  const a=atDistance(r,start),b=atDistance(r,r.length-end);
  return [[a.x,a.y,a.z],...points.filter((_,i)=>r.lengths[i]>start&&r.lengths[i]<r.length-end),[b.x,b.y,b.z]];
}
