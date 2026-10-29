import * as THREE from 'three';
import { rng } from './geo.js?v=0cd67ffee42a15b0';
import { makeRoute,atDistance,offsetPath,signalGreen,canCross,trimRoute } from './movement.js?v=0cd67ffee42a15b0';

const palette=[0xe8e4da,0x364655,0x8b3f36,0x293138,0xafa997,0xd5ad44,0x587475,0x6e7384];
function pool(scene,name,geometry,material,count){const m=new THREE.InstancedMesh(geometry,material,count);m.name=name;m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);m.frustumCulled=false;scene.add(m);return m;}
const mat=(color,extra={})=>new THREE.MeshStandardMaterial({color,roughness:0.65,...extra});

export function buildCityLife(scene,ctx,camera) {
  const rand=rng(1837),group=new THREE.Group();group.name='city-life';scene.add(group);
  const edges=[],byNode=new Map();
  for(const road of ctx.roads) {
    for(const reverse of (road.dir==='B'?[false,true]:[road.dir==='T'])) {
      const raw=reverse?[...road.path].reverse():road.path;
      const path=offsetPath(raw,road.width/4),route=makeRoute(path);
      if(route.length<6)continue;
      const start=reverse?road.to:road.from,end=reverse?road.from:road.to;
      const p=raw.at(-1),q=raw.at(-2);
      const edge={...route,id:edges.length,start,end,road,axis:Math.abs(p[0]-q[0])>Math.abs(p[2]-q[2])?0:1};
      edges.push(edge);if(!byNode.has(start))byNode.set(start,[]);byNode.get(start).push(edge);
    }
  }
  const carCount=480,pedCount=800,walkerCount=720,cyclistCount=80;
  const eligible=edges.filter(e=>e.length>45&&!e.road.bridge);
  const cars=Array.from({length:carCount},(_,i)=>{const edge=eligible[Math.floor(rand()*eligible.length)];return {id:i,edge,d:rand()*edge.length,previous:0,speed:5+rand()*4,bus:i%19===0,paint:palette[i%palette.length]};});
  // Avoid initial overlap on lanes before the first simulation step.
  const initial=new Map();for(const c of cars){if(!initial.has(c.edge.id))initial.set(c.edge.id,[]);initial.get(c.edge.id).push(c);}
  for(const list of initial.values()){list.sort((a,b)=>b.d-a.d);for(let i=0;i<list.length;i++){list[i].d=list[i].edge.length*(list.length-i)/(list.length+1);list[i].previous=list[i].d;}}
  const carBody=pool(group,'vehicles',new THREE.BoxGeometry(1,1,1),mat(0xffffff),carCount);
  const carGlass=pool(group,'vehicle-windows',new THREE.BoxGeometry(1,1,1),mat(0x243a43,{metalness:0.28,roughness:0.25}),carCount);
  const wheels=pool(group,'vehicle-wheels',new THREE.BoxGeometry(1,1,1),mat(0x202326),carCount*2);
  const carLights=pool(group,'headlights',new THREE.BoxGeometry(1,1,1),mat(0xffedc9,{emissive:0xffdd9b,emissiveIntensity:0.1}),carCount*2);
  const tailLights=pool(group,'tail-lights',new THREE.BoxGeometry(1,1,1),mat(0x762d20,{emissive:0xff3020,emissiveIntensity:0.15}),carCount*2);
  ctx.glows.push({mat:carLights.material,day:0.1,night:1.2},{mat:tailLights.material,day:0.15,night:0.8});

  const walks=[];
  for(const road of ctx.roads.filter(r=>!r.bridge&&r.class>1&&r.class<5&&!/LAKE SHORE/.test(r.road))) {
    const middle=trimRoute(road.path,15,15);if(!middle)continue;
    const left=offsetPath(middle,road.width/2+1.8),right=offsetPath([...middle].reverse(),road.width/2+1.8);
    const r=makeRoute([...left,...right,left[0]]);
    const along=makeRoute(left).length,across=road.width+3.6;
    const p=road.path[0],q=road.path.at(-1),axis=Math.abs(q[0]-p[0])>Math.abs(q[2]-p[2])?0:1;
    // Buildings determine usable sidewalks; don't route people through a podium.
    if(r.points.some(p=>ctx.measuredBuildings.some(b=>p[0]>b.x0&&p[0]<b.x1&&p[2]>b.z0&&p[2]<b.z1)))continue;
    walks.push({...r,crossings:[{d:along,length:across,id:Number(road.to),axis},{d:along*2+across,length:across,id:Number(road.from),axis}]});
  }
  const promenade=ctx.riverwalkPath;
  walks.push({...makeRoute([...promenade,...offsetPath([...promenade].reverse(),2),promenade[0]]),crossings:[]});
  const destinations=[walks.at(-1)];
  const cycleRoutes=[];
  for(const entry of ctx.routes?.values()||[]){const path=entry.points,closed=Math.hypot(path[0][0]-path.at(-1)[0],path[0][2]-path.at(-1)[2])<1;
    const route={...makeRoute(closed?path:[...path,...offsetPath([...path].reverse(),.7),path[0]]),crossings:[],id:entry.id};
    if(entry.mode==='walk'||entry.mode==='shared'){walks.push(route);destinations.push(route);}
    if(entry.mode==='cycle'||entry.mode==='shared')cycleRoutes.push(route);
  }
  const people=Array.from({length:pedCount},(_,i)=>{const cyclist=i>=walkerCount;const route=cyclist?cycleRoutes[(i-walkerCount)%cycleRoutes.length]:i%4!==0?destinations[i%destinations.length]:walks[Math.floor(rand()*walks.length)];const d=rand()*route.length;return {cyclist,route,d,previous:d,speed:cyclist?3.5+rand()*1.6:.9+rand()*.65,phase:rand()*6.28,color:palette[(i+3)%palette.length]};});
  for(const person of people)for(const cross of person.route.crossings)if(person.d>=cross.d&&person.d<cross.d+cross.length)person.d=person.previous=cross.d-.1;
  const torsos=pool(group,'pedestrians',new THREE.BoxGeometry(0.45,0.65,0.27),mat(0xffffff),pedCount);
  const heads=pool(group,'pedestrian-heads',new THREE.IcosahedronGeometry(0.17,0),mat(0xbd997a),pedCount);
  const legs=pool(group,'pedestrian-legs',new THREE.BoxGeometry(0.14,0.7,0.16),mat(0x303640),pedCount*2);
  const bikeWheels=pool(group,'bicycle-wheels',new THREE.TorusGeometry(.34,.045,4,12).rotateY(Math.PI/2),mat(0x343d3a),cyclistCount*2);
  const bikeFrames=pool(group,'bicycle-frames',new THREE.BoxGeometry(.12,.12,1.1),mat(0x86aaa9),cyclistCount);
  const bikeBars=pool(group,'bicycle-bars',new THREE.BoxGeometry(.52,.08,.08),mat(0x536664),cyclistCount);
  const contact=pool(group,'contact-shading',new THREE.CircleGeometry(1,12),new THREE.MeshBasicMaterial({color:0x17201f,transparent:true,opacity:0.18,depthWrite:false}),carCount+pedCount);
  const trainRoute=makeRoute(ctx.railPath),trains=[];
  const trainBody=pool(group,'trains',new THREE.BoxGeometry(2.7,2.8,13.5),mat(0xc3c9c5,{metalness:0.35}),24);
  const trainGlass=pool(group,'train-windows',new THREE.BoxGeometry(2.74,0.85,12),mat(0x324b54,{emissive:0x557783,emissiveIntensity:0}),24);
  ctx.glows.push({mat:trainGlass.material,day:0,night:0.35});
  for(let i=0;i<4;i++){
    const route=makeRoute(offsetPath(i%2?[...ctx.railPath].reverse():ctx.railPath,1.5));
    const stops=ctx.railStations.map(([x,z])=>{let best=Infinity,at=0;route.points.forEach((p,k)=>{const d=Math.hypot(p[0]-x,p[2]-z);if(d<best){best=d;at=k;}});return (route.lengths[at]+36)%route.length;}).sort((a,b)=>a-b);
    const d=route.length*Math.floor(i/2)/2;let stop=stops.findIndex(s=>s>d);if(stop<0)stop=0;
    trains.push({route,stops,stop,d,hold:0,nextStop:stops[stop]>d?stops[stop]:stops[stop]+route.length});
  }
  // Low riverboats clear the fixed bridges. No wake particles or dynamic shadows.
  const boatRoute=makeRoute([[1080,0.24,-710],[650,0.24,-727],[310,0.24,-756],[175,0.24,-748],[92,0.24,-656],[0,0.24,-604],[-280,0.24,-601],[-550,0.24,-603],[-670,0.24,-591],[-773,0.24,-512]]);
  const boatHull=pool(group,'riverboats',new THREE.BoxGeometry(5.8,0.9,20),mat(0xe2ddd0),8);
  const boatCabin=pool(group,'boat-cabins',new THREE.BoxGeometry(4.6,1.5,11),mat(0xa3b4af,{metalness:0.2}),8);
  const signalMesh=pool(group,'traffic-signals',new THREE.BoxGeometry(0.45,0.7,0.45),new THREE.MeshBasicMaterial({color:0xffffff,toneMapped:false}),ctx.signals.length);
  const m=new THREE.Matrix4(),p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3(),sample={};
  const place=(mesh,index,x,y,z,angle=0,sx=1,sy=1,sz=1)=>{m.compose(p.set(x,y,z),q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP,angle),s.set(sx,sy,sz));mesh.setMatrixAt(index,m);};
  const color=new THREE.Color(),up=new THREE.Vector3(1,0,0);
  let time=0,accumulator=0,lastSignal=-1,paused=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stats={vehicles:0,pedestrians:0,cyclists:0,walkerBudget:walkerCount,cyclistBudget:cyclistCount,trains:4,boats:8,steps:0};
  function step(dt){
    time+=dt;stats.steps++;
    const occupancy=new Map();for(const c of cars){if(!occupancy.has(c.edge.id))occupancy.set(c.edge.id,[]);occupancy.get(c.edge.id).push(c);}
    const crossings=new Set();for(const p of people)for(const c of p.route.crossings)if(p.d>=c.d&&p.d<c.d+c.length)crossings.add(`${c.id}:${c.axis}`);
    for(const list of occupancy.values())list.sort((a,b)=>b.d-a.d);
    const reserved=new Set();
    const laneFree=edge=>!reserved.has(edge.id)&&!(occupancy.get(edge.id)||[]).some(v=>v.d<16);
    for(const list of occupancy.values())for(let i=0;i<list.length;i++){
      const c=list[i],edge=c.edge;let limit=edge.length;
      c.previous=c.d;
      if(i>0)limit=Math.min(limit,list[i-1].d-(list[i-1].bus?14:8));
      if(!edge.next&&c.d<edge.length-18&&ctx.junctions.get(edge.end)?.roads.length>=3&&!signalGreen(time,edge.axis,Number(edge.end)))limit=Math.min(limit,edge.length-21);
      if(!edge.next&&c.d<8&&crossings.has(`${edge.start}:${edge.axis}`))limit=Math.min(limit,6);
      const advance=Math.min(c.speed*dt,Math.max(0,limit-c.d));c.d+=advance;
      if(c.d>=edge.length-0.01){
        if(edge.next){if(laneFree(edge.next)){c.edge=edge.next;c.d=c.previous=0;reserved.add(c.edge.id);}continue;}
        const options=(byNode.get(edge.end)||[]).filter(e=>e.end!==edge.start);
        const next=options.length?options[Math.floor(rand()*options.length)]:(byNode.get(edge.end)||[])[0];
        if(next){if(laneFree(next)){
          // Join the two lane offsets through the intersection instead of teleporting.
          const end=edge.points.at(-1),start=next.points[0];
          c.edge={...makeRoute([end,[(end[0]+start[0])/2,(end[1]+start[1])/2,(end[2]+start[2])/2],start]),id:-1-c.id,end:next.start,road:next.road,axis:next.axis,next};c.d=c.previous=0;
          reserved.add(next.id);
        }}else if(Math.hypot(edge.points.at(-1)[0]-camera.position.x,edge.points.at(-1)[2]-camera.position.z)>1100){
          const restart=eligible[Math.floor(rand()*eligible.length)];if(laneFree(restart)){c.edge=restart;c.d=c.previous=0;}
        }
      }
    }
    for(const person of people){const crossing=person.route.crossings.some(c=>person.d>=c.d&&person.d<c.d+c.length);let move=(crossing?1.7:person.speed)*dt;person.previous=person.d;
      for(const c of person.route.crossings)if(person.d<c.d&&person.d+move>=c.d&&!canCross(time,c.axis,c.id,c.length/1.7))move=Math.max(0,c.d-person.d-0.1);
      person.d=(person.d+move)%person.route.length;
      if(person.d<person.previous)person.previous=person.d;
    }
    for(const train of trains){if(train.hold>0){train.hold-=dt;continue;}const gap=train.nextStop-train.d;train.d+=Math.min(gap,Math.max(1.5,Math.min(10,gap*.3))*dt);
      if(train.d>=train.nextStop-.05){train.d=train.nextStop;train.hold=6;train.stop=(train.stop+1)%train.stops.length;const base=Math.floor(train.d/train.route.length)*train.route.length;train.nextStop=base+train.stops[train.stop];if(train.nextStop<=train.d)train.nextStop+=train.route.length;}}
  }
  function update(dt){
    if(!paused){accumulator+=Math.min(dt,0.1);while(accumulator>=0.05){step(0.05);accumulator-=0.05;}}
    let n=0,sh=0;
    const alpha=paused?1:accumulator/.05;
    for(const car of cars){atDistance(car.edge,car.previous+(car.d-car.previous)*alpha,sample);if(Math.hypot(sample.x-camera.position.x,sample.z-camera.position.z)>3300)continue;
      const {x,y,z,angle}=sample,len=car.bus?10:4.6,h=car.bus?2.5:1.25,w=car.bus?2.55:1.9,dx=Math.sin(angle),dz=Math.cos(angle);
      place(carBody,n,x,y+h/2+0.35,z,angle,w,h,len);carBody.setColorAt(n,color.setHex(car.bus?0xd8ded9:car.paint));
      place(carGlass,n,x,y+h+0.48,z,angle,w*0.85,car.bus?0.65:0.6,len*0.62);
      for(const side of [-1,1]){const wi=n*2+(side===1?1:0);place(wheels,wi,x+dx*len*0.31*side,y+0.42,z+dz*len*0.31*side,angle,w+0.1,0.6,0.6);
        const nx=Math.cos(angle)*w*0.35*side,nz=-Math.sin(angle)*w*0.35*side;
        place(carLights,wi,x+dx*len/2+nx,y+0.85,z+dz*len/2+nz,angle,0.4,0.22,0.08);
        place(tailLights,wi,x-dx*len/2+nx,y+0.85,z-dz*len/2+nz,angle,0.4,0.22,0.08);
      }
      q.setFromEuler(new THREE.Euler(-Math.PI/2,0,-angle));m.compose(p.set(x,y+0.15,z),q,s.set(w*0.7,len*0.52,1));contact.setMatrixAt(sh++,m);n++;
    }
    stats.vehicles=n;carBody.count=carGlass.count=n;wheels.count=carLights.count=tailLights.count=n*2;
    let pn=0,bn=0;
    for(const person of people){atDistance(person.route,person.previous+(person.d-person.previous)*alpha,sample);const{x,y,z,angle}=sample;
      if(Math.hypot(x-camera.position.x,z-camera.position.z)>1500||camera.position.y>1000)continue;
      const gait=Math.sin(time*7+person.phase)*(person.cyclist?.05:.13),bob=person.cyclist?-.17:Math.abs(gait)*.2;
      if(person.cyclist){const dx=Math.sin(angle),dz=Math.cos(angle);for(const side of [-1,1])place(bikeWheels,bn*2+(side===1?1:0),x+dx*.55*side,y+.35,z+dz*.55*side,angle);place(bikeFrames,bn,x,y+.68,z,angle);place(bikeBars,bn,x+dx*.55,y+1.1,z+dz*.55,angle);bn++;}
      place(torsos,pn,x,y+1.2+bob,z,angle);torsos.setColorAt(pn,color.setHex(person.color));
      place(heads,pn,x,y+1.7+bob,z);
      for(const side of [-1,1])place(legs,pn*2+(side===1?1:0),x+Math.cos(angle)*0.12*side+Math.sin(angle)*gait*side,y+0.53,z-Math.sin(angle)*0.12*side+Math.cos(angle)*gait*side,angle);
      m.compose(p.set(x,y+0.15,z),q.setFromAxisAngle(up,-Math.PI/2),s.set(0.42,0.42,1));contact.setMatrixAt(sh++,m);pn++;
    }
    stats.pedestrians=pn-bn;stats.cyclists=bn;bikeWheels.count=bn*2;bikeFrames.count=bikeBars.count=bn;torsos.count=heads.count=pn;legs.count=pn*2;contact.count=sh;
    for(let i=0;i<trains.length;i++)for(let j=0;j<6;j++){
      const r=trains[i].route;atDistance(r,((trains[i].d-j*15)%r.length+r.length)%r.length,sample);
      place(trainBody,i*6+j,sample.x,10.65,sample.z,sample.angle);place(trainGlass,i*6+j,sample.x,11.2,sample.z,sample.angle);
    }
    for(let i=0;i<8;i++){
      const cycle=(time*3+i*boatRoute.length/4)%(boatRoute.length*2),reverse=cycle>boatRoute.length;
      atDistance(boatRoute,reverse?boatRoute.length*2-cycle:cycle,sample);
      const off=reverse?-7:7,angle=sample.angle+(reverse?Math.PI:0),x=sample.x+Math.cos(sample.angle)*off,z=sample.z-Math.sin(sample.angle)*off;
      place(boatHull,i,x,0.55,z,angle);place(boatCabin,i,x,1.7,z,angle);
    }
    if(Math.floor(time*2)!==lastSignal){lastSignal=Math.floor(time*2);ctx.signals.forEach((v,i)=>{place(signalMesh,i,v.x,4.8,v.z);signalMesh.setColorAt(i,color.setHex(signalGreen(time,v.axis,v.id)?0x76c798:0xc95141));});signalMesh.instanceColor.needsUpdate=true;}
    group.traverse(o=>{if(o.instanceMatrix)o.instanceMatrix.needsUpdate=true;if(o.instanceColor)o.instanceColor.needsUpdate=true;});
  }
  ctx.life={update,stats,cars,people,edges,walks,boatRoute,trainRoute,audit(seconds=60){for(let i=0;i<seconds*20;i++)step(.05);update(0);},get paused(){return paused;},set paused(v){paused=Boolean(v);accumulator=0;},get time(){return time;}};
  update(0);
}
