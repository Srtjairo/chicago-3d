// Visual tracing of the built summer landscape, checked 2026-10-29.
// Pixel anchors refer to a 1600px Esri World Imagery export in EPSG:3857.
// The imagery itself is a private review reference, never shipped with the site.
export function addSouthGrant({surface,route,lawn,treeRow,anchors,poly,circle,rect}){
 // Continuous planted park ground under the separately traced built surfaces.
 surface('south-park-ground','grass',rect(319,994,860,1588),.71,true);
 const P=(x,y)=>{
  const mx=-9754485.695624815+x/1600*1121.185654775;
  const my=5142168.751578281-y/1600*1121.185654776;
  return [(mx/6378137*180/Math.PI+87.62786)*82950,(41.88202-(2*Math.atan(Math.exp(my/6378137))-Math.PI/2)*180/Math.PI)*110574];
 };
 const polygon=points=>poly(points.map(p=>P(...p)));
 const area=(id,kind,points,y=.76)=>surface('south-'+id,kind,polygon(points),y,false);
 const path=(id,points,width=3.5,kind='path')=>route('south-'+id,points.map(p=>P(...p)),width,'walk',kind==='bridge'?1.15:1.03,kind);
 const row=(points,spacing=13,size=1)=>treeRow(points.map(p=>P(...p)),spacing,size);
 const anchor=(id,kind,x,y,extra={})=>{const [px,pz]=P(x,y);anchors.push({id:'south-'+id,kind,x:px,z:pz,...extra});};
 area('upper-hutchinson','grass',[[601,265],[823,265],[823,598],[611,598],[593,485],[608,410]]);
 area('lower-hutchinson','grass',[[983,350],[1282,350],[1282,950],[1185,950],[1136,923],[1100,949],[984,949]]);
 area('arvey-lawn','grass',[[956,1015],[1100,1020],[1144,997],[1186,1020],[1320,1012],[1290,1070],[1245,1114],[1175,1143],[1100,1140],[1020,1105],[968,1070]]);
 area('west-groves','grass',[[337,270],[459,270],[459,1005],[337,1005]]);
 area('agora-groves','grass',[[337,1080],[463,1080],[464,1282],[504,1320],[535,1395],[337,1395]]);
 area('south-east-groves','grass',[[930,1233],[1040,1205],[1190,1190],[1207,1250],[1120,1404],[945,1404]]);
 // True infield fan orientation, base paths and backstop; preserve open outfields.
 function diamond(id,px,py,angle,r=15){
  const [x,z]=P(px,py),home=[x,z],ring=[home];
  for(let i=0;i<=20;i++){const a=angle-Math.PI/4+i*Math.PI/2/20;ring.push([x+Math.cos(a)*r,z+Math.sin(a)*r]);}
  surface('south-diamond-'+id,'clay',poly(ring),.82,false);
  anchors.push({id:'south-baseball-'+id,kind:'diamond',x,z,angle,size:r*.55});
 }
 // Four Upper Hutchinson diamonds and twelve Lower Hutchinson diamonds.
 diamond('u1',645,289,Math.PI/4,29);diamond('u2',790,289,Math.PI*3/4,29);
 diamond('u3',645,562,-Math.PI/4,29);diamond('u4',790,562,-Math.PI*3/4,29);
 for(const [i,y]of [353,536,560,719,740,899].entries())for(const [j,x]of [1031,1240].entries())diamond('l'+i+'-'+j,x,y,(i%2===0?1:-1)*(j===0?Math.PI/4:Math.PI*3/4),29);
 path('lower-field-perimeter',[[952,342],[978,342],[978,302],[1288,302],[1288,342],[1312,342],[1312,970],[1190,970],[1163,1008],[1102,1008],[1075,970],[952,970],[952,342]],4.5);
 for(const y of [508,779])path('field-cross-'+y,[[904,y],[1004,y]],4);
 path('field-east-link',[[1282,779],[1352,779]],4);
 path('upper-walk',[[620,279],[620,587],[822,587]],3);
 // Existing court enclosure: seven paired pickleball courts and six tennis courts.
 area('pickleball-apron','paving',[[638,599],[810,599],[810,671],[638,671]],.83);
 area('tennis-apron','paving',[[638,681],[810,681],[810,743],[638,743]],.83);
 for(let i=0;i<7;i++)for(let j=0;j<2;j++)anchor('pickleball-'+i+'-'+j,'court',650+i*24,615+j*33,{w:9.6,d:15.8,sport:'pickleball'});
 for(let i=0;i<6;i++)anchor('tennis-'+i,'court',660+i*27,710,{w:12.8,d:29.5,sport:'tennis'});
 area('dog-enclosure','dog',[[645,762],[808,762],[808,800],[700,800],[672,786],[645,786]],.86);
 anchor('dog-fence','fence',728,781,{w:84,d:19});
 area('service-yard','service',[[730,815],[809,815],[809,902],[749,902],[729,878]],.79);
 // Curved exposed rail right-of-way. Track centerlines follow the same footprint.
 area('rail-cut','ballast',[[483,250],[592,250],[594,423],[582,477],[583,640],[620,807],[687,1000],[813,1385],[723,1385],[600,1040],[516,798],[488,618]],.78);
 for(let i=0;i<7;i++){
  const q=[[494+i*12,265],[500+i*12,615],[533+i*12,800],[601+i*12,1000],[730+i*12,1385]].map(p=>P(...p));
  route('south-rail-'+i,q,1.5,'none',.92,'rail');
 }
 path('11th-street-bridge',[[335,1054],[470,1054],[719,1054],[790,1054]],7,'bridge');
 path('west-rail-walk',[[465,273],[465,1004],[476,1054],[477,1137],[474,1163],[479,1184],[479,1264],[494,1291]],4);
 path('roosevelt-garden',[[351,1392],[421,1392],[454,1360],[475,1310],[494,1291],[535,1303]],4);
 path('arvey-curve',[[920,1108],[965,1140],[1051,1177],[1137,1183],[1225,1158],[1300,1095]],4);
 // Spirit of Music's outdoor garden setting; the figure sits at the north end.
 area('spirit-garden','paving',[[373,283],[434,283],[443,333],[427,382],[389,382],[370,333]],.85);
 area('spirit-planting','flowers',[[385,300],[423,300],[427,330],[416,366],[392,365],[381,332]],.87);
 anchor('spirit-of-music','statue',401,291,{h:4.7});
 path('spirit-walk',[[348,280],[348,485],[450,485]],3);
 // 8th Street circular fountain, Logan's raised equestrian monument at 9th,
 // and Rosenberg's small classical fountain pavilion near 11th Street.
 const [fx,fz]=P(425,515);surface('south-eighth-plaza','paving',circle(fx,fz,12),.84,false);
 surface('south-eighth-water','pool',circle(fx,fz,5),.91,false);anchor('eighth-fountain','fountain',425,515,{r:4,h:2.2});
 area('logan-mound','grass',[[357,675],[393,658],[438,677],[447,756],[408,789],[365,759]],.79);
 anchor('logan-mound','hill',402,720,{rx:24,rz:33,h:5});
 anchor('logan-monument','equestrian',402,712,{h:8,base:5});
 path('logan-east-walk',[[454,550],[454,800],[465,817]],3);
 anchor('rosenberg','temple',410,1028,{w:6,d:6,h:5.8});
 const [rx,rz]=P(410,1028);surface('south-rosenberg-plaza','paving',circle(rx,rz,8),.87,false);
 // Long skate plaza lies east of Agora, between the rail edge and Michigan lawns.
 area('skate-concrete','skate',[[501,1092],[529,1100],[550,1140],[568,1193],[569,1256],[546,1291],[503,1282],[491,1250],[493,1190],[498,1140]],.91);
 anchor('skatepark','skatepark',531,1192,{w:36,d:99});
 anchor('agora','agora',424,1229,{w:33,d:42,count:106});
 path('agora-east',[[482,1100],[482,1220],[488,1275]],3);
 // Plant only borders/groves, leaving sports playing areas and paths clear.
 for(const pts of [[[621,282],[621,573]],[[819,281],[819,580]],[[917,280],[917,997]],[[1331,282],[1331,953]],[[995,325],[1269,325]],[[978,992],[1060,992]],[[1221,992],[1306,992]],[[343,284],[343,991]],[[451,283],[451,990]],[[352,1095],[352,1370]],[[461,1090],[461,1240]],[[949,1280],[968,1382]],[[1070,1250],[1115,1340]]])row(pts,13,1.05);
}
