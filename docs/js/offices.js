import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LANDMARKS } from './geo.js?v=636eff9cbfa6f76b';
import { facadeMaterial } from './textures.js?v=636eff9cbfa6f76b';

const box=(w,h,d,x=0,y=0,z=0)=>new THREE.BoxGeometry(w,h,d).translate(x,y+h/2,z);
const mat=(color,extra={})=>new THREE.MeshStandardMaterial({color,roughness:.75,...extra});
function batch(parent,parts,material,name){
  const flat=parts.map(g=>g.index?g.toNonIndexed():g),geometry=mergeGeometries(flat,false);
  for(const g of new Set([...parts,...flat]))g.dispose();
  const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
function brickMaterial(){
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=128;
  const c=canvas.getContext('2d');c.fillStyle='#836b5b';c.fillRect(0,0,256,128);
  for(let row=0;row<4;row++)for(let col=-1;col<9;col++){
    const n=((row*71+col*19+29)%17+17)%17;
    c.fillStyle=`rgb(${119+n*2},${55+n},${38+n})`;c.fillRect(col*32+(row%2)*16+1,row*32+1,30,30);
  }
  const map=new THREE.CanvasTexture(canvas);map.wrapS=map.wrapT=THREE.RepeatWrapping;map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=4;
  return mat(0xffffff,{map});
}
function planarBrickUV(mesh){
  const {position:p,normal:n,uv}=mesh.geometry.attributes;
  for(let i=0;i<p.count;i++)uv.setXY(i,(Math.abs(n.getX(i))>.5?p.getZ(i):p.getX(i))/1.92,p.getY(i)/.32);
  uv.needsUpdate=true;
}

export function buildOfficeArchitecture(scene,ctx){
  const details=[];
  for(const id of ['relativity','ondean']){
    const L=LANDMARKS.find(l=>l.id===id),g=new THREE.Group(),detail=new THREE.Group();
    g.name=id;g.position.set(L.x,.6,L.z);g.rotation.y=id==='relativity'?.0184:.022;
    // Keep coping inside the shared, slightly angled warehouse party wall.
    if(id==='ondean')g.scale.set(.98,1,.995);
    detail.name=id+'-details';g.add(detail);details.push({L,group:detail});
    if(id==='relativity'){
      const stone=mat(0xc7c0ad),trim=mat(0xb8b09c),glass=mat(0x30444d,{roughness:.28,metalness:.25});
      // The full-block stone mass, with the LaSalle facade facing west (-X).
      batch(g,[box(95,19,54.2,.5)],stone,'relativity-banking-base');
      batch(g,[box(95,67,54.2,.5,19),box(92.6,6.1,52,.5,86)],facadeMaterial({color:0xc9c3b3,glass:0x34464b,cell:[3.4,3.85],winA:[.46,.56],seed:231,lit:.38}),'relativity-office-floors');
      batch(g,[box(92.6,.15,52,.5,91.95),box(95,.1,54.2,.5,85.9)],stone,'relativity-roof-caps');
      const bands=[];
      for(const [y,h,w,d]of [[.5,.6,95.4,54.6],[14.4,.7,95.4,54.6],[18.5,.65,96.2,55.2],[21.6,.45,95.8,54.8],[84.9,.65,96,55],[89.5,.65,93.5,52.8],[91.5,.6,93.5,52.8]])bands.push(box(w,h,d,.5,y));
      // Deep, tall banking-hall windows on the lower perimeter.
      const windows=[],frames=[];
      for(const z of [-22,-17,-12,12,17,22]){
        windows.push(box(.12,8.7,2.5,-47.06,4.6,z));
        for(const dz of [-1.35,1.35])frames.push(box(.38,9.2,.22,-47.18,4.3,z+dz));
        frames.push(box(.38,.3,3,-47.18,4.25,z),box(.38,.3,3,-47.18,13.4,z));
      }
      for(const side of [-1,1])for(let x=-41;x<=43;x+=5.5){windows.push(box(2.6,8.7,.12,x,4.6,side*27.16));frames.push(box(3,.3,.35,x,4.25,side*27.2),box(3,.3,.35,x,13.4,side*27.2));}
      batch(detail,windows,glass,'relativity-banking-windows');
      // Eight columns, capitals and triangular pediment inside the surveyed lot.
      const columns=[];
      for(let i=0;i<8;i++){
        const z=-9.8+i*2.8;
        columns.push(new THREE.CylinderGeometry(.52,.64,12.6,12).translate(-48.6,7.2,z),box(1.45,.55,1.45,-48.6,.65,z),box(1.4,.7,1.4,-48.6,13.3,z));
      }
      columns.push(box(2.5,1,23,-48.6,14),box(2.8,.25,24,-48.6,.35));
      const triangle=new THREE.Shape([new THREE.Vector2(-12,15),new THREE.Vector2(12,15),new THREE.Vector2(0,18.3)]);
      const pediment=new THREE.ExtrudeGeometry(triangle,{depth:1.5,bevelEnabled:false});pediment.rotateY(-Math.PI/2).translate(-47.8,0,0);columns.push(pediment);
      windows.length=0;for(const z of [-7,0,7])windows.push(box(.12,4.4,3,-47.06,.6,z));
      batch(detail,windows,glass,'relativity-doors');
      // Shallow stone joints, upper bay jambs and window sills catch daylight.
      for(let y=1.6;y<18;y+=1.4)for(const side of [-1,1])frames.push(box(95,.035,.05,.5,y,side*27.22));
      for(let z=-24;z<26;z+=3.4){frames.push(box(.32,62,.25,-47.12,22,z));for(let y=24;y<84;y+=3.85)frames.push(box(.4,.13,1.7,-47.2,y,z+1.5));}
      for(const side of [-1,1])for(let x=-44;x<47;x+=3.4)frames.push(box(.25,62,.3,x,22,side*27.17));
      batch(detail,[...bands,...frames,...columns],trim,'relativity-stone-details');
      batch(detail,[box(13,1,7,12,91.1,-12),box(5,.65,4,25,91.45,8)],mat(0x767b78),'relativity-roof');
    }else{
      // 2025 frontage and aerial photos identify the low warehouse immediately
      // west of Carpenter, north of Kinzie (County footprint 860470).
      const brick=brickMaterial(),frame=mat(0x2e3839,{metalness:.25}),glass=mat(0x263e48,{metalness:.32,roughness:.24,emissive:0x73847d,emissiveIntensity:0});
      ctx.glows.push({mat:glass,day:0,night:.12});
      const walls=batch(g,[box(32.5,8.65,35.3)],brick,'ondean-brick');planarBrickUV(walls);
      batch(g,[box(32.7,.3,35.5,0,8.65),box(31.6,.16,34.4,0,8.94)],mat(0x656a64),'ondean-flat-roof');
      const windows=[box(.08,3.05,22,16.3,5.15,2),box(23,3.05,.08,0,5.15,17.7),box(24,3.05,.08,0,5.15,-17.7)];
      batch(g,windows,glass,'ondean-upper-windows');
      const mullions=[];
      for(const y of [5.1,6.65,8.22]){
        mullions.push(box(.16,.1,22.2,16.36,y,2));
        for(const side of [-1,1])mullions.push(box(side===1?23.2:24.2,.1,.16,0,y,side*17.73));
      }
      for(let z=-9;z<=13.01;z+=2.75)mullions.push(box(.16,3.2,.09,16.36,5.1,z));
      for(const side of [-1,1])for(let x=-11.5;x<=11.6;x+=2.875)mullions.push(box(.09,3.2,.16,x,5.1,side*17.73));
      // Carpenter entrance and loading door; a second loading bay faces Kinzie.
      const doors=[box(.14,3,1.6,16.34,0,8),box(.14,4.6,6.2,16.34,0,-13),box(4,5.3,.14,-13,0,17.73)];
      batch(g,doors,frame,'ondean-entrances');
      for(let y=.6;y<4.6;y+=.45)mullions.push(box(.18,.035,6,16.43,y,-13));
      for(let y=.7;y<5.2;y+=.4)mullions.push(box(3.8,.035,.18,-13,y,17.82));
      for(const side of [-1,1])mullions.push(box(.3,4.8,.3,16.4,0,-13+side*3.3));
      batch(detail,mullions,frame,'ondean-window-frames');
      const coping=[];for(const side of [-1,1])coping.push(box(.15,.45,35.5,side*16.35,8.65),box(32.8,.45,.15,0,8.65,side*17.72));
      batch(detail,coping,mat(0x84918b,{metalness:.4}),'ondean-parapet');
      batch(detail,[box(2,.9,1.7,-8,9,-6),box(1.8,.7,1.5,7,9,5),box(.35,.9,.35,0,9,-11)],mat(0x9c9e93),'ondean-roof-plant');
      const sign=document.createElement('canvas');sign.width=512;sign.height=80;const c=sign.getContext('2d');c.fillStyle='#b9ac8c';c.fillRect(0,0,512,80);c.fillStyle='#3b3931';c.font='36px Georgia';c.textAlign='center';c.fillText('410 N. CARPENTER ST.',256,53);
      const map=new THREE.CanvasTexture(sign);map.colorSpace=THREE.SRGBColorSpace;
      const plaque=new THREE.Mesh(new THREE.PlaneGeometry(6.2,.96),mat(0xffffff,{map}));plaque.rotation.y=Math.PI/2;plaque.position.set(16.44,6.3,-13);plaque.name='ondean-address';detail.add(plaque);
    }
    scene.add(g);
  }
  // Decorative geometry is omitted at skyline distance; the recognizable mass,
  // window bands and entrances remain. Neither office casts dynamic shadows.
  ctx.officeDetailUpdate=camera=>{for(const {L,group}of details)group.visible=Math.hypot(camera.position.x-L.x,camera.position.y-L.h/2,camera.position.z-L.z)<1200;};
}
