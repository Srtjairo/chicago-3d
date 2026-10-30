import {nearest,distance} from './transit-math.js?v=4065cefedcbb3b84';
export async function loadTransit(){
  const url=new URL('../assets/transit.json',import.meta.url);url.search=new URL(import.meta.url).search;
  const r=await fetch(url);if(!r.ok)throw Error('CTA map data could not load. Please reload.');const data=await r.json();
  if(data.version!==1||data.lines?.length!==8||!data.routes?.length)throw Error('Incomplete CTA network data');return data;
}
// Keep street furniture away from the actual stair/entrance footprints.
export function transitAt(ctx,x,z){return ctx.transitData?.stations.some(s=>s.inScene&&(s.entrances.some(e=>distance(e.position,[x,z])<4)||s.platforms.some(p=>{if(p.kind!=='elevated')return false;const a=p.angle,nx=-Math.cos(a),nz=Math.sin(a),cx=p.layout==='island'?p.center[0]:p.trackPosition[0]+nx*(1.45+p.width/2),cz=p.layout==='island'?p.center[1]:p.trackPosition[1]+nz*(1.45+p.width/2),dx=x-cx,dz=z-cz;return Math.abs(dx*Math.sin(a)+dz*Math.cos(a))<p.length/2+4&&Math.abs(dx*nx+dz*nz)<p.width/2+3.5;})))||false;}
export function closedTransitRoad(road){return road.road==='LAKE'&&road.points.some(([x,z])=>x>-990&&x<-660&&z>-440&&z<-380);}
export function closestRail(data,p){return data.segments.map(s=>({segment:s,...nearest(s.points.map(q=>[q[0],q[2]]),p)})).sort((a,b)=>a.error-b.error)[0];}
