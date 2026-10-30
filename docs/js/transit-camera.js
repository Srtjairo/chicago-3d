import {Flyer} from './tour.js?v=bc893891e5c0c0d3';
export function stationView(station,camera,controls,ctx){
  const p=station.platforms.find(p=>p.kind==='elevated'),point=p?.center||p?.trackPosition||station.position,[x,z]=point;
  // Station views are at street height, so low neighboring buildings matter too.
  const buildings=[...ctx.collisionBuildings,...ctx.measuredBuildings.filter(b=>Math.hypot(b.x-x,b.z-z)<700)];
  const navigator=new Flyer(camera,controls,{...ctx,collisionBuildings:buildings});
  return {navigator,...navigator.viewFor({x,z,h:16,roof:16,r:12,view:{az:p?.angle||0,dist:180,el:.45,width:35,clearance:2,focus:[0,3,0]}})};
}
