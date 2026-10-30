export async function loadLakeShore(){
  const url=new URL('../assets/lake-shore.json',import.meta.url);url.search=new URL(import.meta.url).search;
  const response=await fetch(url);if(!response.ok)throw new Error('Lake Shore Drive could not load. Please reload.');
  const data=await response.json();if(data.version!==1||data.chains?.length!==2)throw new Error('Incomplete Lake Shore Drive');return data;
}

// A continuous path avoids the square seams produced by independent road boxes.
export function prepareLakeShore(data,isRiver){
  const sourceIds=new Set(),chains=[],roads=[],cells=new Map();
  for(const chain of data.chains){
    const points=[],ranges=[];
    for(const s of chain.segments){
      sourceIds.add(s.id);const start=Math.max(0,points.length-1);
      for(let i=1;i<s.points.length;i++){
        const a=s.points[i-1],b=s.points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<.01)continue;
        if(!points.length)points.push(a);
        const count=Math.ceil(length/6);for(let j=1;j<=count;j++)points.push([a[0]+(b[0]-a[0])*j/count,a[1]+(b[1]-a[1])*j/count]);
      }
      ranges.push({s,start,end:points.length-1});
    }
    const distances=[0];for(let i=1;i<points.length;i++)distances.push(distances[i-1]+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));
    const wet=points.map(([x,z],i)=>isRiver(x,z)?i:-1).filter(i=>i>=0);
    // Topology levels are not metre heights. A common grade across source
    // boundaries retains the existing river clearance without disconnected ramps.
    const path=points.map(([x,z],i)=>[x,.26+4*Math.max(0,...wet.map(j=>1-Math.abs(distances[i]-distances[j])/48)),z]);
    const route={id:chain.id,path,points,distances,length:distances.at(-1)};chains.push(route);
    for(const {s,start,end}of ranges){
      const p=path.slice(start,end+1),reverse=chain.id==='east';
      roads.push({id:s.id,name:'Lake Shore Drive',road:'LAKE SHORE',class:1,width:16,highway:true,highwayChain:chain.id,start,end,level:s.level,dir:reverse?'T':'F',from:'lake-shore-'+chain.id+'-'+start,to:'lake-shore-'+chain.id+'-'+end,points:p.map(q=>[q[0],q[2]]),path:p,bridge:p.some(q=>q[1]>.27)});
    }
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],segment={a,b};
      for(let x=Math.floor((Math.min(a[0],b[0])-12)/125);x<=Math.floor((Math.max(a[0],b[0])+12)/125);x++)for(let z=Math.floor((Math.min(a[1],b[1])-12)/125);z<=Math.floor((Math.max(a[1],b[1])+12)/125);z++){
        const key=x+','+z;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(segment);
      }
    }
  }
  // The 2016 centerlines converge tightly at Oak Street. Fit each half-width
  // inside its side of the median instead of overlapping fixed-width road boxes.
  for(const chain of chains){
    const other=chains.find(c=>c!==chain).points;
    chain.halfWidths=chain.points.map(p=>{
      let nearest=Infinity;
      for(let j=1;j<other.length;j++){
        const a=other[j-1],b=other[j];if(p[1]<Math.min(a[1],b[1])-40||p[1]>Math.max(a[1],b[1])+40)continue;
        const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1)));
        nearest=Math.min(nearest,Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t));
      }
      return Math.min(8,(nearest-1.4)/2);
    });
    for(let i=1;i<chain.halfWidths.length;i++)chain.halfWidths[i]=Math.min(chain.halfWidths[i],chain.halfWidths[i-1]+(chain.distances[i]-chain.distances[i-1])*.08);
    for(let i=chain.halfWidths.length-2;i>=0;i--)chain.halfWidths[i]=Math.min(chain.halfWidths[i],chain.halfWidths[i+1]+(chain.distances[i+1]-chain.distances[i])*.08);
    chain.paintHalfWidths=chain.halfWidths.map(w=>Math.min(5.4,w-.6));
    for(const road of roads.filter(r=>r.highwayChain===chain.id))road.width=2*Math.min(...chain.halfWidths.slice(road.start,road.end+1));
  }
  return {sourceIds,chains,roads,cells};
}

export function lakeShoreIntersects(lakeShore,x0,z0,x1,z1,pad=11){
  if(!lakeShore)return false;
  for(let x=Math.floor(x0/125);x<=Math.floor(x1/125);x++)for(let z=Math.floor(z0/125);z<=Math.floor(z1/125);z++)for(const {a,b}of lakeShore.cells.get(x+','+z)||[]){
    // Segment/expanded-box clipping reserves the real road corridor only.
    let lo=0,hi=1;const dx=b[0]-a[0],dz=b[1]-a[1];
    for(const [p,q]of [[-dx,a[0]-x0+pad],[dx,x1+pad-a[0]],[-dz,a[1]-z0+pad],[dz,z1+pad-a[1]]]){
      if(Math.abs(p)<1e-9){if(q<0){lo=2;break;}}else if(p<0)lo=Math.max(lo,q/p);else hi=Math.min(hi,q/p);
    }
    if(lo<=hi)return true;
  }
  return false;
}

export function highwayOffset(path,i,offset){
  const p=path[i],a=path[Math.max(0,i-1)],b=path[Math.min(path.length-1,i+1)];
  const normal=(u,v)=>{const dx=v[0]-u[0],dz=v[2]-u[2],length=Math.hypot(dx,dz)||1;return [-dz/length,dx/length];};
  // Endpoint normals use the adjacent segment; interior normals use a bounded miter.
  const left=i?normal(a,p):normal(p,b),right=i<path.length-1?normal(p,b):left;
  const nx=left[0]+right[0],nz=left[1]+right[1],length=Math.hypot(nx,nz)||1,ux=nx/length,uz=nz/length;
  const scale=offset/Math.max(.7,ux*right[0]+uz*right[1]);return [p[0]+ux*scale,p[1],p[2]+uz*scale];
}

export const highwayFade=(route,index)=>Math.min(1,route.distances[index]/650,(route.length-route.distances[index])/650);
