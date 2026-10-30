import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LANDMARKS } from './geo.js?v=ffca706352a4902e';
import { facadeMaterial } from './textures.js?v=ffca706352a4902e';
import { boxBatch } from './city-data.js?v=ffca706352a4902e';

const material=(color,extra={})=>new THREE.MeshStandardMaterial({color,roughness:0.7,...extra});
const box=(w,h,d,x=0,y=0,z=0)=>new THREE.BoxGeometry(w,h,d).translate(x,y+h/2,z);
function merged(group,geos,mat,name,shadow=true){if(!geos.length)return;const g=mergeGeometries(geos.map(g=>g.index?g.toNonIndexed():g),false);geos.forEach(g=>g.dispose());const m=new THREE.Mesh(g,mat);m.name=name;m.castShadow=shadow;m.receiveShadow=true;group.add(m);return m;}
function tapered(w0,d0,w1,d1,h,y=0){const g=new THREE.BoxGeometry(1,h,1),p=g.attributes.position;for(let i=0;i<p.count;i++){const top=p.getY(i)>0;p.setXYZ(i,p.getX(i)*(top?w1:w0),p.getY(i)+h/2+y,p.getZ(i)*(top?d1:d0));}g.computeVertexNormals();return g;}
function facade(color,seed,options={}){return facadeMaterial({color,seed,glass:0x30444c,cell:[2.7,3.9],lit:0.32,...options});}
export function buildSignatureArchitecture(scene,ctx){
  for(const id of ['aqua','tribune','carbide','mart','board','riverside']){
    const L=LANDMARKS.find(l=>l.id===id),g=new THREE.Group();g.name=id;g.position.set(L.x,0.6,L.z);
    const stone=material(0xc6bca4),dark=material(0x424d51),gold=material(0xc9a654,{metalness:0.65,roughness:0.38,emissive:0xb98a36,emissiveIntensity:0});
    ctx.glows.push({mat:gold,day:0,night:0.45});
    if(id==='aqua'){
      merged(g,[box(100,13,106,10),box(42,248.8,48,0,13)],facade(0x679098,201,{style:1,cell:[2.2,3.05]}),'aqua-glass');
      const balconies=[];
      for(let f=5;f<82;f++){
        const shape=new THREE.Shape(),y=f*3.16;
        const pts=[];
        for(let k=0;k<64;k++){
          const a=k/64*Math.PI*2,c=Math.cos(a),s=Math.sin(a),r=1/Math.max(Math.abs(c),Math.abs(s));
          const wave=2.6+2.2*Math.sin(a*3+f*0.16)+1.1*Math.sin(a*7-f*0.09);
          pts.push(new THREE.Vector2(c*(21*r+wave),s*(24*r+wave)));
        }
        shape.setFromPoints(pts);const slab=new THREE.ExtrudeGeometry(shape,{depth:0.32,bevelEnabled:false,curveSegments:1});slab.rotateX(-Math.PI/2).translate(0,y,0);balconies.push(slab);
      }
      merged(g,balconies,material(0xd9d7cc),'aqua-balconies',false);
      merged(g,[box(31,2.5,38,0,259.3)],dark,'aqua-roof');
    }else if(id==='tribune'){
      merged(g,[box(44,88,55),box(34,22,39,0,88),box(21,21,24,0,110),box(48,26,35,43,0,-6)],facade(0xc7baa1,202,{cell:[2.4,3.8]}),'tribune-limestone');
      const piers=[],buttresses=[];
      for(const side of [-1,1])for(let x=-18;x<=18;x+=6){piers.push(box(0.7,104,1,x,0,side*27.8));}
      for(let k=0;k<8;k++){
        const a=k*Math.PI/4,x=Math.cos(a)*16,z=Math.sin(a)*16;
        piers.push(box(2,24,2,x,110,z));
        const pin=new THREE.ConeGeometry(1.6,7.7,4).translate(x,137.85,z);piers.push(pin);
        const from=new THREE.Vector3(x,111,z),to=new THREE.Vector3(x*.55,129,z*.55),beam=new THREE.BoxGeometry(1.5,from.distanceTo(to),1.5);
        beam.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),to.clone().sub(from).normalize())).translate(...from.clone().add(to).multiplyScalar(.5).toArray());buttresses.push(beam);
      }
      merged(g,[...piers,...buttresses],stone,'tribune-crown');
    }else if(id==='carbide'){
      merged(g,[box(39,16,42)],material(0x282f2e,{metalness:0.22}),'carbide-base');
      merged(g,[box(37,73,40,0,16),box(28,25,30,0,89),box(20,24,22,0,114)],facade(0x345748,203,{glass:0x1e2e2b,cell:[2.4,3.6]}),'carbide-green');
      merged(g,[tapered(21,23,11,13,10,138),box(10,5.3,12,0,148)],gold,'carbide-gold');
      const fins=[];for(let x=-16;x<=16;x+=5.3)for(const side of [-1,1])fins.push(box(.6,72,.5,x,16,side*20.3));merged(g,fins,material(0x78836b),'carbide-fins',false);
    }else if(id==='mart'){
      merged(g,[box(218,68,98),box(195,15,79,0,68,-4),box(42,20.6,37,0,83,22)],facade(0xb9ab91,204,{cell:[4,4],winA:[.65,.65]}),'mart-massing');
      const fins=[];for(let x=-102;x<=102;x+=8)for(const side of [-1,1])fins.push(box(1.2,67,1.1,x,4,side*49.5));
      for(const y of [12,66,81])fins.push(box(220-(y>70?22:0),1.5,100-(y>70?18:0),0,y));merged(g,fins,stone,'mart-piers',false);
      merged(g,[box(54,5,5,0,1,51)],dark,'mart-entry');
    }else if(id==='board'){
      merged(g,[box(61,83,110),box(45,35,63,0,83,-19),box(31,43,37,0,118,-23)],facade(0xc3beb1,205,{cell:[2.5,3.8],winA:[.54,.7]}),'board-stone');
      const roof=tapered(31,37,5,5,14.2,161);roof.translate(0,0,-23);merged(g,[roof],material(0x879b91),'board-pyramid');
      const statue=new THREE.ConeGeometry(1.35,7.5,8).translate(0,178.95,-23),head=new THREE.IcosahedronGeometry(.9,1).translate(0,183.4,-23);merged(g,[statue,head],material(0xd3d6ce,{metalness:.6}),'ceres');
      const ribs=[];for(let x=-27;x<=27;x+=5.4)ribs.push(box(.8,90,1,x,0,-55.4));merged(g,ribs,stone,'board-piers',false);
      const clock=new THREE.Mesh(new THREE.CircleGeometry(3.8,32),material(0xf1e7c9,{emissive:0xb8a979,emissiveIntensity:.3}));clock.rotation.y=Math.PI;clock.position.set(0,107,-50.8);g.add(clock);
      g.add(boxBatch([[0,107,-50.9,.4,5,.3],[1,108,-51,2.2,.35,.3]],0x25302c,'board-clock-hands'));
    }else if(id==='riverside'){
      merged(g,[tapered(12,69,45,72,38),box(45,182.7,72,0,38)],facade(0x7096aa,206,{style:1,cell:[1.6,4.3],glass:0x3b687e,roughness:.28}),'riverside-glass');
      const corners=[];
      for(const x of [-22,22])for(const z of [-35.5,35.5])corners.push(box(1.1,182.7,1.1,x,38,z));
      merged(g,[...corners,box(45,2,72,0,218.7)],material(0x9caeb3,{metalness:.4}),'riverside-frame',false);
    }
    scene.add(g);
  }
}
