import {makeRoute,atDistance} from './movement.js?v=ffca706352a4902e';
export const CAR_SPACING=14.9,CAR_LENGTH=14.6;
function aheadOnRoute(r,p,start){
  // Only search the forward braking horizon, never the returning leg of a Loop.
  let lo=0,hi=r.lengths.length-1;while(lo+1<hi){const mid=(lo+hi)>>1;if(r.lengths[mid]<start)lo=mid;else hi=mid;}
  let best={error:Infinity,d:0};for(let i=lo;i<r.points.length-1&&r.lengths[i]<start+350;i++){
    const a=r.points[i],b=r.points[i+1],dx=b[0]-a[0],dz=b[2]-a[2],n=dx*dx+dz*dz;if(n<.001)continue;
    const t=Math.max(0,Math.min(1,((p.x-a[0])*dx+(p.z-a[2])*dz)/n)),d=r.lengths[i]+t*(r.lengths[i+1]-r.lengths[i]),error=Math.hypot(p.x-a[0]-t*dx,p.z-a[2]-t*dz);if(d>start&&error<best.error)best={error,d};
  }return best;
}
export function createTransitSimulation(data,{warmup=420}={}){
  const routes=data.routes.map(r=>{const junctions=[];
    // The short block between Tower 12 and the Balbo curve cannot hold a whole
    // consist. Reserve both together to prevent opposing trains holding one each.
    for(const raw of [...r.junctions].sort((a,b)=>a.start-b.start)){const j={...raw,start:raw.start-20,end:raw.end+20},id=['tower12','balbo-clearance'].includes(j.id)?'south-junction':['chicago-clearance','mart-clearance'].includes(j.id)?'north-approach':j.id,previous=junctions.at(-1);if(previous?.id===id&&j.start-previous.end<250)previous.end=j.end;else junctions.push({...j,id});}
    return {...r,...makeRoute(r.points),junctions};});
  const trains=routes.map((route,i)=>({id:'train-'+i,line:route.line,route,d:0,previous:0,speed:0,hold:0,next:0,wait:i*43,cycle:0,length:route.cars*CAR_SPACING,visits:[],blocked:false}));
  const owners=new Map(),stats={steps:0,stops:0,cycles:0,reservations:0};let accumulator=0,time=0;
  const pose=t=>atDistance(t.route,t.d);
  function step(dt){
    time+=dt;stats.steps++;
    for(const [id,owner]of owners){const t=trains.find(t=>t.id===owner.train);if(t.d-t.length>owner.end+10)owners.delete(id);}
    const candidates=new Map();for(const t of trains){if(t.wait>0)continue;for(const j of t.route.junctions){if(owners.has(j.id)||t.d<j.start-100||t.d-t.length>j.end+10)continue;const gap=j.start-t.d,old=candidates.get(j.id);if(!old||gap<old.gap)candidates.set(j.id,{train:t.id,end:j.end,gap});}}
    // Grant to the leading approach first. Array-order grants can let a following
    // train reserve the junction in front of the train it must yield to.
    for(const [id,c]of candidates){owners.set(id,c);stats.reservations++;}
    const heads=trains.filter(t=>t.wait<=0).map(t=>({t,p:pose(t)}));
    for(const t of trains){t.previous=t.d;t.blocked=false;if(t.wait>0){t.wait-=dt;continue;}if(t.hold>0){t.hold=Math.max(0,t.hold-dt);continue;}
      let limit=Infinity;
      const stop=t.route.stops[t.next],stopD=stop?stop.d+(t.route.cars-1)*CAR_SPACING/2:Infinity;limit=Math.min(limit,stopD);
      for(const j of t.route.junctions){if(t.d-t.length>j.end+10||t.d<j.start-100)continue;const owner=owners.get(j.id);
        if(owner&&owner.train!==t.id){limit=Math.min(limit,j.start-18);t.blocked=true;}}
      const p=pose(t);
      for(const {t:other,p:q}of heads){if(other===t||Math.hypot(p.x-q.x,p.z-q.z)>350||Math.cos(p.angle-q.angle)<.55)continue;
        const ahead=aheadOnRoute(t.route,q,t.d+.1);
        if(ahead.error<2.8&&ahead.d>t.d&&ahead.d-t.d<350){limit=Math.min(limit,ahead.d-other.length-18);t.blocked=true;}}
      const a=atDistance(t.route,t.d+18),bend=Math.abs(Math.atan2(Math.sin(a.angle-p.angle),Math.cos(a.angle-p.angle)));
      const maxSpeed=bend>.13?4.5:11.5,gap=Math.max(0,limit-t.d),target=Math.min(maxSpeed,Math.sqrt(1.5*gap));
      t.speed=target<t.speed?Math.max(target,t.speed-1.1*dt):Math.min(target,t.speed+.65*dt);
      t.d+=Math.min(gap,t.speed*dt);
      if(stop&&Math.abs(t.d-stopD)<.04){t.d=stopD;t.speed=0;t.hold=12;t.next++;t.visits.push(stop.stationId);if(t.visits.length>40)t.visits.shift();stats.stops++;}
      if(t.d>t.route.length+t.length){for(const [id,o]of owners)if(o.train===t.id)owners.delete(id);t.d=t.previous=0;t.speed=0;t.next=0;t.wait=32;t.cycle++;stats.cycles++;}
    }
  }
  // Deterministic traffic already in progress when the city opens; no visible spawns.
  for(let i=0;i<warmup*20;i++)step(.05);for(const t of trains)t.previous=t.d;
  return {trains,routes,stats,owners,step,get time(){return time;},get alpha(){return accumulator/.05;},update(dt,paused){if(paused){accumulator=0;for(const t of trains)t.previous=t.d;return;}accumulator+=Math.min(.1,Math.max(0,dt));while(accumulator>=.05){step(.05);accumulator-=.05;}},audit(seconds){for(let i=0;i<seconds*20;i++)step(.05);for(const t of trains)t.previous=t.d;}};
}
