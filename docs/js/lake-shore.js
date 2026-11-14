import * as THREE from 'three';
import {highwayOffset,highwayFade} from './lake-shore-data.js?v=3564eb1790f1e487';

// All pavement and paint are joined static ribbons, batched by material.
export function buildLakeShore(scene,ctx){
  const batches={median:[],shoulders:[],pavement:[],white:[],yellow:[],barriers:[],structure:[]};
  const addQuad=(name,points,fades)=>{const list=batches[name];for(const i of [0,1,2,2,1,3])list.push(...points[i],fades[i]);};
  const ribbon=(name,route,left,right,lift,from=0,to=route.path.length-1)=>{
    for(let i=from+1;i<=to;i++){
      const offset=(value,index)=>typeof value==='function'?value(index):value;
      const a=highwayOffset(route.path,i-1,offset(left,i-1)),b=highwayOffset(route.path,i-1,offset(right,i-1)),c=highwayOffset(route.path,i,offset(left,i)),d=highwayOffset(route.path,i,offset(right,i));
      for(const p of [a,b,c,d])p[1]+=lift;
      addQuad(name,[a,b,c,d],[highwayFade(route,i-1),highwayFade(route,i-1),highwayFade(route,i),highwayFade(route,i)]);
    }
  };
  for(const route of ctx.lakeShore.chains){
    ribbon('shoulders',route,i=>-route.halfWidths[i],i=>route.halfWidths[i],.13);
    ribbon('pavement',route,i=>-route.paintHalfWidths[i],i=>route.paintHalfWidths[i],.135);
    // Three suggested lanes, fitted to the source corridor through the bend.
    // Dash distances span source boundaries, so density does not reset per record.
    const sample=(distance)=>{
      let lo=0,hi=route.distances.length-1;while(lo+1<hi){const m=(lo+hi)>>1;if(route.distances[m]<distance)lo=m;else hi=m;}
      const t=(distance-route.distances[lo])/(route.distances[hi]-route.distances[lo]||1),a=route.path[lo],b=route.path[hi];
      return {point:a.map((v,k)=>v+(b[k]-v)*t),width:route.paintHalfWidths[lo]+(route.paintHalfWidths[hi]-route.paintHalfWidths[lo])*t,fade:highwayFade(route,lo)};
    };
    for(let distance=0;distance<route.length-5;distance+=14){
      const a=sample(distance),b=sample(distance+4.5),dx=b.point[0]-a.point[0],dz=b.point[2]-a.point[2],length=Math.hypot(dx,dz)||1;
      for(const side of [-1,1]){
        const corners=[];for(const end of [a,b])for(const edge of [-.09,.09]){const offset=side*end.width/3+edge;corners.push([end.point[0]-dz/length*offset,end.point[1]+.15,end.point[2]+dx/length*offset]);}
        addQuad('white',corners,[a.fade,a.fade,b.fade,b.fade]);
      }
    }
    const inside=route.id==='west'?-1:1;
    ribbon('yellow',route,i=>inside*route.paintHalfWidths[i]-.1,i=>inside*route.paintHalfWidths[i]+.1,.15);
    ribbon('white',route,i=>-inside*route.paintHalfWidths[i]-.1,i=>-inside*route.paintHalfWidths[i]+.1,.15);
    for(let i=1;i<route.path.length;i++){
      const a=route.path[i-1],b=route.path[i];
      // Sparse highway barriers, with open daylight at ordinary ground-level
      // city intersections. Boundary details disappear before the pavement.
      if(highwayFade(route,i)<1||!(a[2]<-2100||a[2]>1650||Math.max(a[1],b[1])>1))continue;
      for(const side of [-1,1]){
        const p=highwayOffset(route.path,i-1,side*(route.halfWidths[i-1]-.1)),q=highwayOffset(route.path,i,side*(route.halfWidths[i]-.1));
        addQuad('barriers',[[p[0],p[1]+.18,p[2]],[p[0],p[1]+.85,p[2]],[q[0],q[1]+.18,q[2]],[q[0],q[1]+.85,q[2]]],[1,1,1,1]);
        if(Math.max(a[1],b[1])>1)addQuad('structure',[[p[0],p[1]-.35,p[2]],[p[0],p[1]+.13,p[2]],[q[0],q[1]-.35,q[2]],[q[0],q[1]+.13,q[2]]],[1,1,1,1]);
      }
    }
  }
  // A planted median where the two carriageways run 20 to 60 m apart (each side fills to the
  // middle line), and light poles along both outer edges every 45 m, lit at night.
  const [west,east]=ctx.lakeShore.chains,G=20,grids=new Map(),posts=[];
  for(const route of [west,east]){const g=new Map();route.path.forEach((p,i)=>{const k=Math.floor(p[0]/G)+','+Math.floor(p[2]/G);if(!g.has(k))g.set(k,[]);g.get(k).push(i);});grids.set(route,g);}
  const gapTo=(p,other)=>{const g=grids.get(other),cx=Math.floor(p[0]/G),cz=Math.floor(p[2]/G);let best=Infinity;for(let i=-3;i<=3;i++)for(let j=-3;j<=3;j++)for(const k of g.get((cx+i)+','+(cz+j))||[]){const q=other.path[k];best=Math.min(best,Math.hypot(q[0]-p[0],q[2]-p[2]));}return best;};
  for(const route of [west,east]){
    const other=route===west?east:west,inside=route.id==='west'?-1:1,gap=route.path.map(p=>gapTo(p,other));
    const wide=(i)=>gap[i]>20&&gap[i]<60&&route.path[i][1]<1;
    for(let i=1;i<route.path.length;i++)if(wide(i-1)&&wide(i))ribbon('median',route,k=>inside*(route.halfWidths[k]+.05),k=>inside*gap[k]/2,.125,i-1,i);
    for(let d=25;d<route.length-25;d+=45){
      let i=0;while(i<route.distances.length-1&&route.distances[i]<d)i++;
      if(highwayFade(route,i)<1)continue;
      const p=highwayOffset(route.path,i,-inside*(route.halfWidths[i]+.7)),c=route.path[i],ux=c[0]-p[0],uz=c[2]-p[2];
      posts.push([p[0],p[1],p[2],Math.atan2(-uz,ux)]);
    }
  }
  if(posts.length){
    const post=new THREE.BoxGeometry(.22,10,.22).translate(0,5,0),arm=new THREE.BoxGeometry(2.4,.22,.55).translate(1.1,10,0);
    const steel=new THREE.MeshStandardMaterial({color:0x5b6163,roughness:.6,metalness:.3}),lamp=new THREE.MeshStandardMaterial({color:0xd8d2c0,emissive:0xffc77a,emissiveIntensity:0,roughness:.6});
    ctx.glows?.push({mat:lamp,day:0,night:.85});
    const m=new THREE.Matrix4(),q=new THREE.Quaternion(),up=new THREE.Vector3(0,1,0),v=new THREE.Vector3(),one=new THREE.Vector3(1,1,1);
    for(const [geo,mat,name] of [[post,steel,'lake-shore-light-poles'],[arm,lamp,'lake-shore-lights']]){
      const im=new THREE.InstancedMesh(geo,mat,posts.length);im.name=name;
      posts.forEach(([x,y,z,a],i)=>{q.setFromAxisAngle(up,a);m.compose(v.set(x,y,z),q,one);im.setMatrixAt(i,m);});
      im.computeBoundingSphere();scene.add(im);
    }
  }
  const group=new THREE.Group();group.name='lake-shore-drive';let order=1;
  for(const [name,color]of [['median',0x6d8a4e],['shoulders',0x42484a],['pavement',0x343a3d],['white',0xddd9c7],['yellow',0xd1b35d],['barriers',0x898d86],['structure',0x5d6262]]){
    const values=batches[name],positions=[],fade=[];
    for(let i=0;i<values.length;i+=4){positions.push(values[i],values[i+1],values[i+2]);fade.push(values[i+3]);}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('highwayFade',new THREE.Float32BufferAttribute(fade,1));geometry.computeVertexNormals();
    const material=new THREE.MeshStandardMaterial({color,roughness:.92,side:THREE.DoubleSide,transparent:true,depthWrite:false});
    material.onBeforeCompile=shader=>{
      shader.vertexShader='attribute float highwayFade; varying float vHighwayFade;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvHighwayFade=highwayFade;');
      shader.fragmentShader='varying float vHighwayFade;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.a *= smoothstep(0.0, 1.0, vHighwayFade);');
    };
    material.customProgramCacheKey=()=> 'lake-shore-boundary-v1';
    const mesh=new THREE.Mesh(geometry,material);mesh.name='lake-shore-'+name;mesh.receiveShadow=true;mesh.renderOrder=order++;group.add(mesh);
  }
  scene.add(group);ctx.lakeShore.group=group;
}
