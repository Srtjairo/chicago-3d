// Shared, dependency-free geographic predicates. Rendering, routes and the map
// consume the same bundled polygons; there is no GIS request at runtime.
let current;
export function inRing(x,z,ring){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}
export const inPoly=(x,z,rings)=>inRing(x,z,rings[0])&&!rings.slice(1).some(r=>inRing(x,z,r));
export function setWaterfront(data){current=data;}
export function waterfrontAt(x,z){const b=current?.bounds;return b&&x>=b.minX&&x<=b.maxX&&z>=b.minZ&&z<=b.maxZ?current:null;}
export function waterfrontLand(x,z){return current?.land.some(p=>inPoly(x,z,p))??false;}
export function landscapeAt(x,z){return current?.zones.some(p=>inPoly(x,z,p))??false;}
export function distanceToLine(x,z,points){let best=Infinity;for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));best=Math.min(best,Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz));}return best;}
export async function loadWaterfront(){const url=new URL('../assets/waterfront.json',import.meta.url);url.search=new URL(import.meta.url).search;const response=await fetch(url);if(!response.ok)throw new Error('Waterfront map could not load. Please reload.');const data=await response.json();if(data.version!==1||!data.land?.length)throw new Error('Incomplete waterfront map');setWaterfront(data);return data;}

// Idempotent, append-only registry shared by independent landscape builders.
export function registerRoute(ctx,id,points,mode='walk'){ctx.routes??=new Map();if(ctx.routes.has(id))throw new Error('Duplicate route '+id);ctx.routes.set(id,{id,points,mode});}
