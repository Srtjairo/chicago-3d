import {inPoly} from './waterfront-data.js?v=4065cefedcbb3b84';
export async function loadSites(){
 const url=new URL('../assets/sites.json',import.meta.url);url.search=new URL(import.meta.url).search;
 const r=await fetch(url);if(!r.ok)throw Error('Chicago site details could not load. Please reload.');
 const data=await r.json();if(data.version!==1||!data.sites?.length)throw Error('Incomplete site detail data');return data;
}
export const siteAt=(ctx,x,z)=>ctx.sites?.sites.some(s=>inPoly(x,z,s.rings))??false;
export const siteVolumes=data=>data.sites.flatMap(s=>s.parts.map((p,i)=>({id:s.id+'-'+i,x0:p.x-p.w/2,x1:p.x+p.w/2,z0:p.z-p.d/2,z1:p.z+p.d/2,h:p.y+p.h,y0:p.y})));
