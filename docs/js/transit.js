import * as THREE from 'three';
import {boxBatch} from './city-data.js?v=4065cefedcbb3b84';
import {inCoverage} from './coverage.js?v=4065cefedcbb3b84';
import {makeRoute,atDistance} from './movement.js?v=4065cefedcbb3b84';
import {railHeight,distance,trackOffset,nearest,simplifyRail} from './transit-math.js?v=4065cefedcbb3b84';
import {createTransitSimulation,CAR_LENGTH,CAR_SPACING} from './transit-simulation.js?v=4065cefedcbb3b84';

export function buildTransit(scene,ctx,camera){
  const data=ctx.transitData,root=new THREE.Group();root.name='cta-transit';scene.add(root);
  const bed=[],rails=[],ties=[],steel=[],platforms=[],roofs=[],glass=[],trim=[],stairs=[],dark=[],signs=[],details=[];
  const mat=(color,more={})=>new THREE.MeshStandardMaterial({color,roughness:.75,...more});
  const beam=(list,a,b,width=.25,height=width)=>{const d=new THREE.Vector3(...b).sub(new THREE.Vector3(...a));if(d.length()<.01)return;list.push({a,b,width,height});};
  const box=(list,x,y,z,w,h,d,a=0)=>list.push([x,y,z,w,h,d,a]);
  for(const seg of data.segments){const points=simplifyRail(seg.points);
    for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[2]-a[2],n=Math.hypot(dx,dz)||1;
      const wa=trackOffset(a[0],a[2]),wb=trackOffset(b[0],b[2]);
      beam(bed,[a[0],a[1]-.75,a[2]],[b[0],b[1]-.75,b[2]],wa+wb+3.8,.55);
      for(const side of [-1,1])for(const gauge of [-.72,.72]){const oa=side*wa+gauge,ob=side*wb+gauge;beam(rails,[a[0]-dz/n*oa,a[1],a[2]+dx/n*oa],[b[0]-dz/n*ob,b[1],b[2]+dx/n*ob],.13,.15);}
      for(const side of [-1,1])beam(steel,[a[0]-dz/n*(wa+1.7)*side,a[1]-.8,a[2]+dx/n*(wa+1.7)*side],[b[0]-dz/n*(wb+1.7)*side,b[1]-.8,b[2]+dx/n*(wb+1.7)*side],.25,.9);
    }
    if(seg.kind==='junction')continue;
    const r=makeRoute(points);
    for(let d=3;d<r.length;d+=5.5){const p=atDistance(r,d);box(ties,p.x,p.y-.18,p.z,trackOffset(p.x,p.z)*2+2.7,.22,.22,p.angle);}
    for(let d=12;d<r.length;d+=24){const p=atDistance(r,d);if(ctx.isRiver(p.x,p.z)||data.junctions.some(j=>distance(j.position,[p.x,p.z])<35))continue;
      const nx=Math.cos(p.angle),nz=-Math.sin(p.angle);let off=trackOffset(p.x,p.z)+3;
      for(const road of ctx.roads){if(road.bridge)continue;const n=nearest(road.points,[p.x,p.z]);if(n.error<4&&Math.abs(Math.cos(n.angle-p.angle))>.95)off=Math.max(off,road.width/2+.6);}
      for(const side of [-1,1]){const x=p.x+nx*off*side,z=p.z+nz*off*side;if(!ctx.measuredBuildings.some(b=>x>b.x0&&x<b.x1&&z>b.z0&&z<b.z1))box(steel,x,(p.y-1)/2,z,.55,p.y-1,.55);}
      box(steel,p.x,p.y-1,p.z,off*2+.6,.55,.65,p.angle);
    }
  }
  // Both bascule bridges share the road location and have a higher rail deck.
  for(const bridge of [{id:'wells',a:[-505,-651],b:[-504,-553]},{id:'lake',a:[-900,-409],b:[-727,-409]}]){
    const [a,b]=[bridge.a,bridge.b],dx=b[0]-a[0],dz=b[1]-a[1],n=Math.hypot(dx,dz),nx=-dz/n,nz=dx/n;
    for(const side of [-1,1]){const path=[];for(let t=0;t<=1.001;t+=.125)path.push([a[0]+dx*t+nx*5*side,railHeight(a[0]+dx*t,a[1]+dz*t),a[1]+dz*t+nz*5*side]);
      for(let i=1;i<path.length;i++){const p=path[i-1],q=path[i];beam(steel,[p[0],p[1]-1,p[2]],[q[0],q[1]-1,q[2]],.45,.7);beam(steel,[p[0],p[1]+3,p[2]],[q[0],q[1]+3,q[2]],.4,.4);beam(steel,[p[0],p[1]-1,p[2]],[q[0],q[1]+3,q[2]],.27);beam(steel,[p[0],p[1]+3,p[2]],[q[0],q[1]-1,q[2]],.27);}}
  }
  const nameplates=[];
  for(const s of data.stations.filter(s=>s.inScene)){
    if(s.status==='closed'){box(trim,s.position[0],12.4,s.position[1],38,.8,1.5,Math.PI/2);nameplates.push({s,p:[s.position[0],13.5,s.position[1]],angle:Math.PI/2,text:'STATE / LAKE · CLOSED'});continue;}
    const elevated=s.platforms.filter(p=>p.kind==='elevated');
    for(const p of elevated.filter((p,i)=>p.layout!=='island'||i===0)){
      const a=p.angle,nx=-Math.cos(a),nz=Math.sin(a),ux=Math.sin(a),uz=Math.cos(a),x=p.layout==='island'?p.center[0]:p.trackPosition[0]+nx*(1.45+p.width/2),z=p.layout==='island'?p.center[1]:p.trackPosition[1]+nz*(1.45+p.width/2),y=p.railY+.95;
      box(platforms,x,y,z,p.width,.45,p.length,a);box(trim,x-nx*(p.width/2-.22),y+.25,z,.3,.03,p.length,a);
      if(p.layout==='island')box(trim,x+nx*(p.width/2-.22),y+.25,z,.3,.03,p.length,a);else box(steel,x+nx*p.width/2,y+1.15,z,.08,1.1,p.length,a);
      if(p.style==='wave'){
        for(let t=-p.length/2+2;t<p.length/2;t+=4){const wave=Math.sin(t/22)*1.4;
          box(roofs,x+ux*t,y+4.4+wave,z+uz*t,p.width+.8,.16,4.1,a);
          for(const side of [-1,1])box(steel,x+ux*t+nx*p.width*.38*side,y+2.1+wave*.5,z+uz*t+nz*p.width*.38*side,.13,4.2+wave,.13);
        }
      }else{
        box(roofs,x,y+4,z,p.width+.6,.3,p.length*.76,a);
        for(let t=-p.length*.35;t<=p.length*.35;t+=12)box(steel,x+ux*t+nx*p.width*.35,y+2,z+uz*t+nz*p.width*.35,.17,4,.17);
        if(p.style==='glass'||p.style==='transfer')box(glass,x+nx*p.width*.48,y+1.8,z+nz*p.width*.48,.07,3.1,p.length*.45,a);
        if(p.style==='historic'){box(roofs,x,y+2,z,p.width,3.5,15,a);box(trim,x,y+4.1,z,p.width+.5,.4,18,a);for(const t of [-5,0,5])box(glass,x-nx*p.width*.51+ux*t,y+2.2,z-nz*p.width*.51+uz*t,.08,1.4,2,a);}
      }
      nameplates.push({s,p:[x,y+2.7,z],angle:a,text:s.name.replace('-State/Van Buren','')});
      details.push({x,z,kind:'platform',stationId:s.id,length:p.length,width:p.width,angle:a,y});
    }
    for(const e of s.entrances){const [x,z]=e.position,a=e.angle;
      if(e.kind==='subway'){
        box(dark,x,.64,z,2.15,.14,5.5,a);for(const side of [-1,1]){const nx=Math.cos(a)*side*1.15,nz=-Math.sin(a)*side*1.15;box(steel,x+nx,1.2,z+nz,.12,1.25,5.7,a);}
        for(let i=0;i<6;i++)box(stairs,x+Math.sin(a)*(i*.7-1.8),.7+i*.025,z+Math.cos(a)*(i*.7-1.8),1.9,.08,.15,a);
        box(signs,x,2.9,z,2.5,.62,.18,a);box(steel,x-1.1*Math.cos(a),1.8,z+1.1*Math.sin(a),.12,2.5,.12);
      }else{
        const p=s.platforms.filter(p=>p.kind==='elevated').sort((p,q)=>distance(p.trackPosition,[x,z])-distance(q.trackPosition,[x,z]))[0];if(!p)continue;
        // Exterior stair flight at the observed entrance. Upper landing attaches
        // to the closest edge of its platform, not the station centroid.
        const h=p.railY+.9,run=14,ux=Math.sin(p.angle),uz=Math.cos(p.angle),nx=-Math.cos(p.angle),nz=Math.sin(p.angle);
        const px=p.layout==='island'?p.center[0]:p.trackPosition[0]+nx*(1.45+p.width/2),pz=p.layout==='island'?p.center[1]:p.trackPosition[1]+nz*(1.45+p.width/2);
        const along=Math.max(-p.length/2+5,Math.min(p.length/2-5,(x-px)*ux+(z-pz)*uz));const direction=along>0?-1:1;
        // Historical records can denote a doorway within an existing building.
        // Show that entrance sign without adding a staircase through the building.
        const lateral=(x-p.trackPosition[0])*nx+(z-p.trackPosition[1])*nz;
        const enclosed=p.layout==='island'||s.id==='40380'||lateral<1.6||ctx.measuredBuildings.some(b=>x>b.x0&&x<b.x1&&z>b.z0&&z<b.z1);
        if(!enclosed){for(let i=0;i<26;i++)box(stairs,x+ux*direction*run*i/26,.6+(h-.6)*(i+.5)/26,z+uz*direction*run*i/26,1.8,.18,run/26,p.angle);
          const top=[x+ux*direction*run,h,z+uz*direction*run],landing=[px+ux*(along+direction*run),h,pz+uz*(along+direction*run)];
          beam(platforms,top,landing,1.8,.25);for(const side of [-1,1])beam(steel,[x+nx*side,.9,z+nz*side],[top[0]+nx*side,h+1,top[2]+nz*side],.08,.08);
        }
        box(signs,x,3.05,z,2.4,.65,.2,p.angle);
      }
    }
  }
  // Morgan's enclosed crossover and access towers distinguish it from Loop stops.
  box(glass,-1985,17,-396,5,3,18);box(roofs,-1985,18.7,-396,5.5,.3,19);
  for(const z of [-405,-387]){box(glass,-1985,8,z,4,15,4);box(steel,-1985,16,z,4.4,.4,4.4);}
  // Roosevelt has an enclosed concourse below its central island.
  box(glass,101,4.5,1595,10,7.5,15);box(roofs,101,8.4,1595,11,.3,16);
  // The narrow LaSalle/Van Buren source connector is above the tracks.
  box(platforms,-391,16,568,3,.3,28);for(const z of [554,582])box(steel,-391,12,z,.25,8,.25);
  box(steel,-496.5,8.4,-342,3,.25,69);
  // Closed lower Lake bridge: barriers and no cars or pedestrians on that span.
  for(const x of [-925,-708])for(let i=-3;i<=3;i++)box(trim,x,1.2,-409+i*2,.7,1,1.4,0);
  function add(name,items,color,material){if(!items.length)return;const boxes=items.filter(Array.isArray),beams=items.filter(i=>!Array.isArray(i));
    if(boxes.length)root.add(boxBatch(boxes,color,name,material));
    if(beams.length){const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),material||mat(color),beams.length),m=new THREE.Matrix4(),v=new THREE.Vector3(),q=new THREE.Quaternion(),sc=new THREE.Vector3(),z=new THREE.Vector3(0,0,1);
      beams.forEach((b,i)=>{const a=new THREE.Vector3(...b.a),d=new THREE.Vector3(...b.b).sub(a),len=d.length();m.compose(v.copy(a).addScaledVector(d,.5),q.setFromUnitVectors(z,d.normalize()),sc.set(b.width,b.height,len+.03));mesh.setMatrixAt(i,m);});mesh.name=name+'-beams';mesh.computeBoundingSphere();root.add(mesh);}
  }
  add('cta-decks',bed,0x64665e);add('cta-rails',rails,0x9caaa8,mat(0x9caaa8,{metalness:.55,roughness:.4}));add('cta-ties',ties,0x615a50);add('cta-steel',steel,0x55635d);add('cta-platforms',platforms,0xb7b5a7);add('cta-canopies',roofs,0xb5b8ad);add('cta-glass',glass,0x365463);add('cta-edges',trim,0xd7bc62);add('cta-stairs',stairs,0x919992);add('cta-entrance-openings',dark,0x182325);add('cta-entrance-signs',signs,0x23476b);
  // One atlas and one instanced draw for station names; no per-station textures.
  const atlas=document.createElement('canvas');atlas.width=1024;atlas.height=2048;const c=atlas.getContext('2d');c.fillStyle='#173344';c.fillRect(0,0,1024,2048);c.font='bold 28px Arial';c.textBaseline='middle';c.fillStyle='#f4f4e9';
  nameplates.forEach((n,i)=>{c.fillText(n.text,18,i*64+32,980);const line=data.lines.find(l=>l.id===n.s.lines[0]);c.fillStyle=line?.color||'#ddd';c.fillRect(0,i*64,8,64);c.fillStyle='#f4f4e9';});
  const tex=new THREE.CanvasTexture(atlas);tex.colorSpace=THREE.SRGBColorSpace;const plateMat=new THREE.MeshBasicMaterial({map:tex,side:THREE.DoubleSide});
  const geo=new THREE.PlaneGeometry(10, .7);const uv=geo.attributes.uv;for(let i=0;i<uv.count;i++)uv.setY(i,uv.getY(i)/32);const offsets=new Float32Array(nameplates.length);geo.setAttribute('aRow',new THREE.InstancedBufferAttribute(offsets,1));
  plateMat.onBeforeCompile=s=>{s.vertexShader='attribute float aRow;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\n vMapUv.y += aRow;');};
  const plateMesh=new THREE.InstancedMesh(geo,plateMat,nameplates.length),matrix=new THREE.Matrix4(),quat=new THREE.Quaternion();
  nameplates.forEach((n,i)=>{offsets[i]=1-(i+1)/32;matrix.compose(new THREE.Vector3(...n.p),quat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP,n.angle+Math.PI/2),new THREE.Vector3(1,1,1));plateMesh.setMatrixAt(i,matrix);});plateMesh.name='cta-station-names';plateMesh.computeBoundingSphere();root.add(plateMesh);

  const sim=createTransitSimulation(data),capacity=sim.trains.reduce((n,t)=>n+t.route.cars,0);
  function pool(name,geometry,material){const mesh=new THREE.InstancedMesh(geometry,material,capacity);mesh.name=name;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;root.add(mesh);return mesh;}
  const body=pool('cta-train-cars',new THREE.BoxGeometry(2.65,2.5,CAR_LENGTH),mat(0xc2cbc8,{metalness:.45,roughness:.48}));
  const windows=pool('cta-train-windows',new THREE.BoxGeometry(2.69,.7,CAR_LENGTH-1.2),mat(0x244659,{emissive:0x7198a5,emissiveIntensity:0}));ctx.glows.push({mat:windows.material,day:0,night:.45});
  const stripe=pool('cta-train-route-colors',new THREE.BoxGeometry(2.72,.18,CAR_LENGTH-1),mat(0xffffff));
  const bogies=pool('cta-train-undercarriage',new THREE.BoxGeometry(2.1,.45,CAR_LENGTH-3),mat(0x283133));
  const pickable=[];const markerGeometry=new THREE.SphereGeometry(4,8,6),markerMaterial=new THREE.MeshBasicMaterial({color:0xc4e8ef});
  for(const s of data.stations.filter(s=>s.inScene)){const m=new THREE.Mesh(markerGeometry,markerMaterial);m.position.set(s.position[0],s.kind.includes('elevated')?18:4,s.position[1]);m.userData.stationId=s.id;m.visible=false;root.add(m);pickable.push(m);}
  const routeHighlights=new Map();for(const r of data.routes){if(routeHighlights.has(r.line))continue;const group=new THREE.Group();for(const part of data.routes.filter(p=>p.line===r.line)){const g=new THREE.BufferGeometry().setFromPoints(part.points.filter(p=>inCoverage(p[0],p[2])).map(p=>new THREE.Vector3(p[0],p[1]+.15,p[2])));group.add(new THREE.Line(g,new THREE.LineBasicMaterial({color:data.lines.find(l=>l.id===r.line).color})));}group.visible=false;root.add(group);routeHighlights.set(r.line,group);}
  const color=new THREE.Color(),pos=new THREE.Vector3(),scale=new THREE.Vector3(1,1,1),sample={};let activeLine=null,exploring=false;
  const api={data,sim,root,details,pickable,selected:null,following:null,onExit:null,highlight(line){activeLine=line;for(const [id,g]of routeHighlights)g.visible=id===line;for(const m of pickable)m.visible=exploring&&(!line||data.stations.find(s=>s.id===m.userData.stationId).lines.includes(line));},setExploring(value){exploring=value;api.highlight(activeLine);},select(id){api.selected=id;},follow(id){const t=sim.trains.find(t=>t.id===id);api.following=t?{id,cycle:t.cycle}:null;},stopFollow(){api.following=null;},stats:{trains:sim.trains.length,cars:0,stations:25},update(dt){sim.update(dt,ctx.life?.paused??false);let n=0;
      for(const t of sim.trains){if(t.wait>0)continue;const d=t.previous+(t.d-t.previous)*sim.alpha;for(let j=0;j<t.route.cars;j++){const at=d-j*CAR_SPACING;if(at<0||at>t.route.length)continue;atDistance(t.route,at,sample);if(!inCoverage(sample.x,sample.z))continue;
          const place=(mesh,dy)=>{matrix.compose(pos.set(sample.x,sample.y+dy,sample.z),quat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP,sample.angle),scale);mesh.setMatrixAt(n,matrix);};place(body,1.6);place(windows,2.05);place(stripe,.65);place(bogies,.3);stripe.setColorAt(n,color.set(data.lines.find(l=>l.id===t.line).color));n++;}}
      for(const mesh of [body,windows,stripe,bogies]){mesh.count=n;mesh.instanceMatrix.needsUpdate=true;}if(stripe.instanceColor)stripe.instanceColor.needsUpdate=true;api.stats.cars=n;
      plateMesh.visible=camera.position.y<800;const tieMesh=root.getObjectByName('cta-ties');if(tieMesh)tieMesh.visible=camera.position.y<900;
      if(api.following){const t=sim.trains.find(t=>t.id===api.following.id),p=atDistance(t.route,t.d);if(t.cycle!==api.following.cycle||!inCoverage(p.x,p.z)){api.stopFollow();api.onExit?.();}}
    }};
  ctx.transit=api;api.update(0);return api;
}
