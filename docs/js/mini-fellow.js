import * as THREE from 'three';
import {createMiniWorld,EYE_HEIGHT} from './mini-fellow-world.js?v=636eff9cbfa6f76b';
import {closedTransitRoad} from './transit-data.js?v=636eff9cbfa6f76b';
import {toAddress} from './geo.js?v=636eff9cbfa6f76b';

export function setupMiniFellow({scene,ctx,camera,controls,flyer,ui,canvas}){
  const aerialLabel=canvas.getAttribute('aria-label');
  const world=createMiniWorld({buildings:ctx.collisionBuildings,roads:ctx.roads.map(r=>({...r,closed:closedTransitRoad(r)})),terrain:ctx.waterfront.terrain,land:ctx.waterfront.land,surfaces:ctx.waterfront.features,walkways:[{path:ctx.riverwalkPath,width:6,walkway:true}]});
  const launch=document.createElement('button');launch.id='mini-fellow-open';launch.type='button';launch.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="4" r="2.5"/><path d="M8 8h8l1 7h-3v7h-4v-7H7z"/></svg><span>Mini Fellow</span><small>Drop in & explore</small>';document.querySelector('.explore').append(launch);
  const panel=document.createElement('section');panel.id='mini-fellow-panel';panel.className='glass';panel.hidden=true;panel.setAttribute('aria-label','Mini Fellow');
  panel.innerHTML='<header><div><strong>Mini Fellow</strong><span data-location>Choose your starting point</span></div><button type="button" data-exit>Exit</button></header><div data-picker><p>Click a street, sidewalk or open space to drop in.</p><div class="fellow-actions"><button type="button" data-enter>Enter here</button><button type="button" data-cancel>Cancel</button></div></div><div data-roaming hidden><div class="fellow-actions"><label>Explore<select aria-label="Mini Fellow travel mode"><option value="walk">Walk</option><option value="fly">Fly freely</option></select></label><button type="button" data-place>New spot</button><button type="button" data-lock>Mouse look</button><button type="button" data-fast aria-pressed="false">Faster</button></div><p class="fellow-help">WASD to move · drag to look · arrows to look · Shift for speed · Esc to exit<span data-flight-help hidden> · E / Q to rise / descend</span></p></div><p data-status role="status">Use Enter here to start near your current view.</p>';
  document.body.append(panel);
  const pad=document.createElement('nav');pad.id='mini-fellow-move';pad.hidden=true;pad.setAttribute('aria-label','Mini Fellow movement');pad.innerHTML='<button type="button" data-move="forward" aria-label="Move forward">↑</button><button type="button" data-move="left" aria-label="Move left">←</button><button type="button" data-move="back" aria-label="Move backward">↓</button><button type="button" data-move="right" aria-label="Move right">→</button><div class="fellow-altitude" hidden><button type="button" data-move="up" aria-label="Fly up">Rise</button><button type="button" data-move="down" aria-label="Fly down">Lower</button></div>';document.body.append(pad);
  const crosshair=document.createElement('div');crosshair.id='mini-fellow-crosshair';crosshair.hidden=true;crosshair.setAttribute('aria-hidden','true');document.body.append(crosshair);
  const status=panel.querySelector('[data-status]'),picker=panel.querySelector('[data-picker]'),roaming=panel.querySelector('[data-roaming]'),modeSelect=panel.querySelector('select'),enter=panel.querySelector('[data-enter]'),lock=panel.querySelector('[data-lock]');
  const person=new THREE.Group();person.name='mini-fellow-drop-marker';person.visible=false;scene.add(person);
  const markerMaterial=new THREE.MeshBasicMaterial({color:0xf3ce6c,depthTest:false});
  const part=(geometry,x,y,z)=>{const m=new THREE.Mesh(geometry,markerMaterial);m.position.set(x,y,z);m.renderOrder=20;person.add(m);return m;};
  part(new THREE.SphereGeometry(.24,10,8),0,1.55,0);part(new THREE.CylinderGeometry(.2,.26,.65,8),0,1,0);for(const x of [-.14,.14])part(new THREE.BoxGeometry(.17,.62,.2),x,.36,0);
  const ring=part(new THREE.TorusGeometry(.65,.045,4,24),0,.04,0);ring.rotation.x=Math.PI/2;
  const plane=new THREE.Plane(new THREE.Vector3(0,1,0),-.6),ray=new THREE.Raycaster(),mouse=new THREE.Vector2(),hit=new THREE.Vector3(),direction=new THREE.Vector3();
  const keys=new Set(),held=new Map();let state='off',saved=null,candidate=null,mode='walk',yaw=0,pitch=0,drag=null,pending=null,fast=false,locked=false,timer=0;
  const message=text=>{if(status.textContent!==text)status.textContent=text;};
  const clearInput=()=>{keys.clear();held.clear();drag=null;pad.querySelectorAll('button').forEach(b=>b.classList.remove('held'));};
  function stopOtherCameras(){flyer.cancel();ui.setTouring(false);ui.hideInfo();ctx.transit.stopFollow();const stop=document.querySelector('.transit-selection [data-stop]');if(stop)stop.hidden=true;controls.autoRotate=false;}
  function begin(){
    if(state!=='off')return;stopOtherCameras();saved={position:camera.position.clone(),target:controls.target.clone(),near:camera.near,far:camera.far,fov:camera.fov};
    state='pick';pending=null;controls.enabled=false;document.body.classList.add('mini-fellow-busy');panel.hidden=false;picker.hidden=false;roaming.hidden=true;person.visible=true;canvas.tabIndex=0;panel.querySelector('[data-location]').textContent='Choose your starting point';
    candidate=world.findSpawn({x:controls.target.x,z:controls.target.z});updateMarker(candidate);enter.disabled=!candidate;message(candidate?'Click the city or choose Enter here.':'Aim at the modeled city, then choose a clear starting spot.');enter.focus();
  }
  function updateMarker(p){if(!p){person.visible=false;return;}person.visible=true;person.position.set(p.x,p.y-EYE_HEIGHT+.06,p.z);person.scale.setScalar(THREE.MathUtils.clamp(camera.position.distanceTo(person.position)*.006,1,28));}
  function enterCity(p){
    if(!p||!world.valid(p))return;clearInput();camera.getWorldDirection(direction);yaw=Math.atan2(-direction.x,-direction.z);pitch=0;mode='walk';modeSelect.value=mode;fast=false;panel.querySelector('[data-fast]').setAttribute('aria-pressed','false');
    state='active';camera.position.set(p.x,p.y,p.z);camera.near=.15;camera.fov=72;camera.updateProjectionMatrix();person.visible=false;picker.hidden=true;roaming.hidden=false;pad.hidden=false;crosshair.hidden=false;panel.querySelector('[data-flight-help]').hidden=true;pad.querySelector('.fellow-altitude').hidden=true;
    document.body.classList.add('mini-fellow-active');canvas.setAttribute('aria-label','Mini Fellow city view. WASD to move, drag or arrow keys to look, Shift for speed, Escape to return to the aerial view.');message('Drag anywhere on the city to look around.');canvas.focus();orient();
  }
  function exit(){
    if(state==='off')return;state='off';clearInput();locked=false;if(document.pointerLockElement===canvas)document.exitPointerLock?.();person.visible=false;panel.hidden=pad.hidden=crosshair.hidden=true;document.body.classList.remove('mini-fellow-busy','mini-fellow-active');
    if(saved){camera.position.copy(saved.position);controls.target.copy(saved.target);camera.near=saved.near;camera.far=saved.far;camera.fov=innerWidth<innerHeight?62:45;camera.updateProjectionMatrix();}
    controls.enabled=true;controls.enableDamping=false;controls.update();controls.enableDamping=true;saved=null;if(aerialLabel)canvas.setAttribute('aria-label',aerialLabel);launch.focus();
  }
  function orient(){camera.rotation.set(pitch,yaw,0,'YXZ');camera.getWorldDirection(direction);controls.target.copy(camera.position).addScaledVector(direction,12);}
  function look(dx,dy){yaw-=dx*.0025;pitch=THREE.MathUtils.clamp(pitch-dy*.0025,-1.35,1.35);orient();}
  function setMode(){
    clearInput();const desired=modeSelect.value;if(desired==='walk'){const p=world.findSpawn(camera.position,240);if(!p){modeSelect.value='fly';message('Move above land before switching to Walk.');return;}camera.position.set(p.x,p.y,p.z);pitch=0;}
    mode=desired;panel.querySelector('[data-flight-help]').hidden=mode!=='fly';pad.querySelector('.fellow-altitude').hidden=mode!=='fly';message(mode==='fly'?'E / Q or Rise / Lower change your height.':'Walking at eye level. Drag to look.');orient();canvas.focus();
  }
  launch.setAttribute('aria-label','Mini Fellow');launch.onclick=begin;enter.onclick=()=>enterCity(candidate);panel.querySelector('[data-cancel]').onclick=exit;panel.querySelector('[data-exit]').onclick=exit;modeSelect.onchange=setMode;
  panel.querySelector('[data-place]').onclick=()=>{const p=camera.position.clone();exit();controls.target.set(p.x,.6,p.z);camera.position.set(p.x+120,200,p.z+120);controls.update();begin();};
  panel.querySelector('[data-fast]').onclick=e=>{fast=!fast;e.currentTarget.setAttribute('aria-pressed',String(fast));};
  lock.hidden=typeof canvas.requestPointerLock!=='function';lock.onclick=()=>{try{const request=canvas.requestPointerLock();request?.catch(()=>message('Mouse lock is unavailable here. Drag the city to look instead.'));}catch{message('Drag the city to look; WASD still moves.');}};
  document.addEventListener('pointerlockerror',()=>{if(state==='active')message('Mouse lock is unavailable here. Drag the city to look instead.');});
  document.addEventListener('pointerlockchange',()=>{const was=locked;locked=document.pointerLockElement===canvas;if(locked)message('Mouse look enabled. Esc returns to the aerial view.');else if(was&&state==='active')exit();});
  document.addEventListener('mousemove',e=>{if(state==='active'&&locked)look(e.movementX,e.movementY);});
  canvas.addEventListener('pointerdown',e=>{if(state==='off')return;e.stopImmediatePropagation();e.preventDefault();canvas.focus();if(state==='pick'){pending={x:e.clientX,y:e.clientY,drop:true};return;}if(!locked){drag={id:e.pointerId,x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);}},true);
  canvas.addEventListener('pointermove',e=>{if(state==='off')return;e.stopImmediatePropagation();if(state==='pick'){pending={x:e.clientX,y:e.clientY,drop:pending?.drop||false};return;}if(drag?.id===e.pointerId&&!locked){look(e.clientX-drag.x,e.clientY-drag.y);drag.x=e.clientX;drag.y=e.clientY;}},true);
  for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,e=>{if(state==='off')return;e.stopImmediatePropagation();drag=null;},true);
  for(const b of pad.querySelectorAll('[data-move]')){
    b.addEventListener('pointerdown',e=>{e.preventDefault();if(state!=='active')return;b.setPointerCapture(e.pointerId);held.set(e.pointerId,b.dataset.move);b.classList.add('held');});
    for(const type of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(type,e=>{held.delete(e.pointerId);b.classList.remove('held');});
  }
  const movementKeys=new Set(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','KeyC','Space','ShiftLeft','ShiftRight','ArrowLeft','ArrowRight','ArrowUp','ArrowDown']);
  addEventListener('keydown',e=>{if(state==='off')return;if(e.code==='Escape'){e.preventDefault();exit();return;}if(state!=='active'||e.target.closest('input,select,textarea,[contenteditable]')||e.code==='Space'&&e.target.closest('button'))return;if(movementKeys.has(e.code)){e.preventDefault();keys.add(e.code);}});
  addEventListener('keyup',e=>keys.delete(e.code));addEventListener('blur',clearInput);document.addEventListener('visibilitychange',()=>{if(document.hidden)clearInput();});
  const pressed=(key,action)=>keys.has(key)||[...held.values()].includes(action);
  const api={get active(){return state==='active';},get busy(){return state!=='off';},get state(){return state;},get mode(){return mode;},world,begin,exit,stats:{moves:0,blocked:0},update(dt){
    if(state==='off')return;
    if(state==='pick'&&pending){const event=pending;pending=null;const r=canvas.getBoundingClientRect();mouse.set((event.x-r.left)/r.width*2-1,1-(event.y-r.top)/r.height*2);ray.setFromCamera(mouse,camera);if(ray.ray.intersectPlane(plane,hit)){candidate=world.findSpawn(hit,16);updateMarker(candidate);enter.disabled=!candidate;if(event.drop&&candidate)enterCity(candidate);else if(!candidate)message('Choose open land or a street inside the modeled city.');else message('Click to drop Mini Fellow here.');}return;}
    if(state!=='active'||document.hidden)return;
    const step=Math.min(.05,dt);yaw+=((keys.has('ArrowLeft')?1:0)-(keys.has('ArrowRight')?1:0))*step*1.4;pitch=THREE.MathUtils.clamp(pitch+((keys.has('ArrowUp')?1:0)-(keys.has('ArrowDown')?1:0))*step*1.2,-1.35,1.35);
    const forward=Number(pressed('KeyW','forward'))-Number(pressed('KeyS','back')),right=Number(pressed('KeyD','right'))-Number(pressed('KeyA','left')),vertical=mode==='fly'?Number(pressed('KeyE','up')||keys.has('Space'))-Number(pressed('KeyQ','down')||keys.has('KeyC')):0;
    const cp=mode==='fly'?Math.cos(pitch):1,dx=-Math.sin(yaw)*forward*cp+Math.cos(yaw)*right,dz=-Math.cos(yaw)*forward*cp-Math.sin(yaw)*right,dy=vertical+(mode==='fly'?Math.sin(pitch)*forward:0),length=Math.hypot(dx,dy,dz);
    if(length){const speed=mode==='fly'?(fast||keys.has('ShiftLeft')||keys.has('ShiftRight')?42:14):(fast||keys.has('ShiftLeft')||keys.has('ShiftRight')?6:2.8),k=speed*step/Math.max(1,length),p=world.move(camera.position,{x:dx*k,y:dy*k,z:dz*k},mode);camera.position.set(p.x,p.y,p.z);api.stats.moves++;if(p.blocked){api.stats.blocked++;message(mode==='walk'?'Building, water or city edge. Choose another direction, or Fly freely.':'A building is in the way. Rise or move around it.');}}
    orient();timer-=dt;if(timer<=0){timer=.2;panel.querySelector('[data-location]').textContent=(mode==='fly'?'Free flight · ':'Street level · ')+toAddress(camera.position.x,camera.position.z);}
  }};
  ctx.miniFellow=api;return api;
}
