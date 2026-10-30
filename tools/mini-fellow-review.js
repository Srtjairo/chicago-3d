const frame=document.querySelector('iframe'),out=document.querySelector('#results');
const button=document.createElement('button');button.textContent='Check Mini Fellow';document.querySelector('header').append(button);
button.onclick=()=>{
  const a=frame.contentWindow.__chicago,f=a?.ctx.miniFellow;if(!f){out.textContent='Mini Fellow is not loaded in this build.';return;}
  const failed=[];for(const s of a.ctx.transitData.stations.filter(s=>s.inScene)){const p=f.world.findSpawn({x:s.position[0],z:s.position[1]});if(!p||!f.world.valid(p))failed.push(s.name);}
  const doc=frame.contentDocument,panel=doc.querySelector('#mini-fellow-panel'),r=panel.getBoundingClientRect();
  out.textContent=JSON.stringify({state:f.state,mode:f.mode,position:a.camera.position.toArray(),near:a.camera.near,controlsEnabled:a.controls.enabled,valid:f.active?f.world.valid(a.camera.position,f.mode):null,world:f.world.stats,motion:f.stats,stationSpawnFailures:failed,overflow:doc.documentElement.scrollWidth>Number(frame.width),panelFits:panel.hidden||r.left>=0&&r.right<=Number(frame.width),pointerLocked:doc.pointerLockElement===a.renderer.domElement},null,2);
};
