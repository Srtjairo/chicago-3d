import {readFileSync,writeFileSync} from 'node:fs';
import {ORIGIN} from '../js/coverage.js';
const city=JSON.parse(readFileSync('assets/downtown.json'));
const rect=(x0,z0,x1,z1)=>[[[x0,z0],[x1,z0],[x1,z1],[x0,z1],[x0,z0]]];
const sites=[],surfaces=[],routes=[],parking=[],furniture=[];
const part=(x,z,w,d,h,y=.6,style='masonry')=>({x,z,w,d,h,y,style});
function measured(id,name,sourceId,style,h){
 const b=city.buildings.find(b=>b.id===sourceId);if(!b)throw Error(sourceId);
 const xs=b.rings[0].map(p=>p[0]),zs=b.rings[0].map(p=>p[1]);
 const x=(Math.min(...xs)+Math.max(...xs))/2,z=(Math.min(...zs)+Math.max(...zs))/2,w=Math.max(...xs)-Math.min(...xs)-1.8,d=Math.max(...zs)-Math.min(...zs)-1.8;
 const site={id,name,sourceIds:[sourceId],rings:b.rings,accuracy:'County 2022 footprint; facade subdivisions and setbacks visually estimated',style,seed:Number(sourceId.split('-')[0])%10007,parts:[part(x,z,w,d,h??b.h,.6,style)]};sites.push(site);return site;
}
// Facing Willis/Catalog parcels retain their measured footprint and height.
measured('franklin-frontage-north','Measured Franklin frontage north','889565-0','concrete');
measured('franklin-frontage-south','Measured Franklin frontage south','891540-0','limestone');
const rookery=measured('rookery','The Rookery','889481-0','rookery',55);
const fed=measured('federal-reserve','Federal Reserve Bank of Chicago','891409-0','federal');
const f=fed.parts[0];fed.parts=[part(f.x,f.z,f.w,f.d,24,.6,'federal'),part(f.x-15,f.z,Math.max(20,f.w-30),f.d,65.7,24.6,'limestone')];
measured('kinzie-1044','1044–48 W Kinzie','860467-0','warehouse',14.4);
measured('aberdeen-415','415 N Aberdeen','860519-0','warehouse',19.4);
const k=measured('one-k-fulton','1K Fulton','864627-0','concrete');
const kp=k.parts[0];k.parts=[part(kp.x+20,kp.z,kp.w/2,kp.d,44,.6,'concrete'),part(kp.x-20,kp.z,kp.w/2,kp.d,29,.6,'glass')];
const m=measured('morgan-345','345 N Morgan','863053-0','arches',50.2);
const lab=measured('aberdeen-400','400 N Aberdeen / Fulton Labs','860020-0','labs',58.6);
const eight=measured('fulton-800','800 Fulton Market','865280-0','braced',86.3);
const e=eight.parts[0];eight.parts=[part(e.x,e.z,e.w,e.d,22,.6,'brick-glass'),part(e.x+4,e.z-3,e.w-8,e.d-6,23,22.6,'brick-glass'),part(e.x+10,e.z-6,e.w-20,e.d-12,22,45.6,'brick-glass'),part(e.x+17,e.z-8,e.w-34,e.d-16,19.3,67.6,'glass')];
// New footprints occupy vacant parcels in the 2022 snapshot, not a guessed
// address-geocoder replacement. 919 is EAST of Sangamon, on the half-block lot.
sites.push({id:'green-360',name:'360 N Green',sourceIds:[],seed:360,style:'dual-glass',rings:rect(-1814,-762,-1738,-708),accuracy:'2024 completed form; plan traced from aerial/architect imagery, height 121.6 m published project specification',parts:[part(-1776,-735,76,54,18,.6,'screen'),part(-1796,-735,32,50,85,18.6,'glass'),part(-1756,-735,32,50,103,18.6,'glass'),part(-1776,-735,8,43,95,18.6,'dark')]});
sites.push({id:'fulton-919',name:'The Fulton · 919 W Fulton',sourceIds:[],seed:919,style:'terraced',rings:rect(-1908,-510,-1875,-410),accuracy:'Completed April 2026, Skender; formerly vacant half-block east of Sangamon. Height/setbacks visual estimates from 11-story exterior, not a survey.',parts:[part(-1891.5,-460,33,100,24,.6,'charcoal-brick'),part(-1889,-462,28,88,22,24.6,'dark-glass'),part(-1887,-462,23,76,4.5,46.6,'dark-glass')]});
const historic=measured('schwinn-factory','Historic Schwinn factory at 910 W Lake','868056-0','warehouse',30.4);
// Explicit separate podium collision volumes; the tower keeps its own tube bounds.
sites.push({id:'willis-catalog',name:'Willis Tower Catalog',sourceIds:[],seed:233,style:'catalog',rings:rect(-716,303,-625,422),accuracy:'County parcel + Gensler completed-project photographs. Podium subdivisions/garden/skylight visual estimates.',parts:[part(-671,399,88,42,15,.6,'catalog'),part(-712,340,8,74,10,.6,'catalog'),part(-630,340,8,74,15,.6,'catalog'),part(-672,307,72,9,10,.6,'catalog')]});
function ground(id,kind,x0,z0,x1,z1,y=.64){surfaces.push({id,kind,rings:rect(x0,z0,x1,z1),y});}
ground('carpenter-parking','parking',-2162,-854,-2129,-816);
ground('aberdeen-facing-parking','parking',-2300,-734,-2226,-719);
ground('morgan-vacant-lot','gravel',-2103,-698,-2031,-650);
ground('green-park','grass',-1814,-778,-1738,-765);
ground('catalog-jackson-frontage','paving',-716,423,-625,429);
ground('lasalle-east-frontage','paving',-357,365,-354,419);
ground('lasalle-west-frontage','paving',-375,366,-372,419);
ground('ondean-carpenter-frontage','paving',-2128,-815,-2123,-778);
ground('ondean-kinzie-frontage','paving',-2204,-774,-2129,-771);
ground('fulton-919-entry','paving',-1913,-510,-1909,-410);
// Identified parking rows, kept separate from traffic lanes and sidewalks.
for(const x of [-2157,-2134])for(let i=0;i<9;i++)parking.push({x,z:-849+i*3.4,angle:Math.PI/2,lot:'carpenter-parking'});

for(let i=0;i<14;i++)parking.push({x:-2294+i*4.6,z:-727,angle:Math.PI,lot:'aberdeen-facing-parking'});
// Bike racks outside 1K Fulton are documented by the City's 2014 ordinance.
for(let i=0;i<7;i++)furniture.push({kind:'rack',x:-2101+i*10,z:-529});
for(const x of [-703,-694,-685,-659,-650,-641])furniture.push({kind:'bollard',x,z:426});
for(const [x,z]of [[-2130,-781],[-2130,-808],[-355,373],[-355,412],[-373,373],[-373,412]])furniture.push({kind:'bollard',x,z});
for(const x of [-1805,-1791,-1777,-1763,-1749])furniture.push({kind:'tree',x,z:-772});
// Each route uses a safe public frontage with a gap to the modeled entrances.
routes.push({id:'site-catalog-jackson',points:[[-710,1.02,427],[-635,1.02,427]]},{id:'site-carpenter',points:[[-2125,1.02,-809],[-2125,1.02,-786]]},{id:'site-lasalle',points:[[-355,1.02,374],[-355,1.02,410]]},{id:'site-sangamon',points:[[-1911,1.02,-500],[-1911,1.02,-422]]});
const sources=[
 ['County building footprints','https://gis.cookcountyil.gov/traditional/rest/services/buildingFootprint_2022/MapServer/0','2022 measured footprint/height snapshot; exceptions are annotated per site'],
 ['Willis Catalog','https://www.gensler.com/projects/willis-tower-repositioning','Completed building exterior and garden'],
 ['Central Standard Building','https://www.beaconcapital.com/property/231-s-lasalle','Stone facade, entrance and roof references'],
 ['Federal Reserve','https://www.chicagofed.org/utilities/about-us/visit-us','1921 base and later additions'],
 ['The Rookery','https://www.skyscrapercenter.com/chicago/the-rookery/9584','55 m architectural height'],
 ['Carpenter/Kinzie portfolio','https://images1.showcase.com/d2/HpUM9D1N0Wk-TzwYOeTIvQGhUAfbQCioWBi73nFsJjo/document.pdf','2025 frontage/aerial: 410 Carpenter,1044–48 Kinzie,415 Aberdeen and parking'],
 ['1K Fulton','https://mchughconcrete.com/projects/1k-fulton/','Existing industrial building and lower glass addition'],
 ['800 Fulton','https://www.som.com/projects/800-fulton/','Stepped terraces, brick and external diagonal bracing; retain county height because published heights conflict'],
 ['345 Morgan','https://esadesign.com/portfolio/345-north-morgan/','Built arched upper/ground windows, grey brick'],
 ['360 Green','https://www.gensler.com/projects/360-north-green','Completed dual glass volumes; occupied 2024'],
 ['400 Aberdeen','https://www.trammellcrow.com/newsroom/tcc-signs-two-expansions-one-hq-lease-at-fulton-labs-in-chicago','Completed lab building, occupied 2025'],
 ['The Fulton completion','https://www.skender.com/news-media/skender-wraps-construction-on-the-fulton-535000-sf-mixed-use-office-building/','April 21 2026 completion, 11 stories and retained historic factory'],
 ['Fulton aerial alignment','https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer','Parcel/street alignment, imagery acquisition date unavailable; photographs not redistributed']
 ].map(([name,url,use])=>({name,url,use,checked:'2026-10-29'}));
const data={version:1,origin:ORIGIN,sources,sites,surfaces,routes,parking,furniture,replacementIds:sites.flatMap(s=>s.sourceIds)};
writeFileSync('assets/sites.json',JSON.stringify(data,(_,v)=>typeof v==='number'?Math.round(v*100)/100:v));
console.log({sites:sites.length,parked:parking.length,replacements:data.replacementIds.length});
