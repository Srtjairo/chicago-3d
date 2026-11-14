import { FEATURED_LANDMARKS } from './featured.js?v=3564eb1790f1e487';
export const DISTRICTS={
  southpark:{name:'South Grant Park',pos:[1050,660,1850],target:[595,5,1305]},
  fulton:{name:'Fulton Market',pos:[-2450,290,-390],target:[-2040,28,-670]},
  willisbase:{name:'Willis Tower base',pos:[-744,99,453],target:[-670,18,389]},
  river:{name:'River & bridges',pos:[420,245,-420],target:[-100,65,-640]},
  loop:{name:'The Loop',pos:[-1000,420,1050],target:[-230,65,170]},
  avenue:{name:'Michigan Avenue',pos:[580,210,-560],target:[285,75,-1180]},
  park:{name:'Millennium Park',pos:[850,230,340],target:[430,20,-70]},
  harbors:{name:'Harbors & beaches',pos:[2440,1350,-260],target:[1110,5,-990]},
  lake:{name:'Lakefront skyline',pos:[2400,520,1300],target:[150,140,-450]},
};
export function setupExplorer({ctx,camera,controls,flyer,ui}){
  const host=document.createElement('section');host.className='explore glass';host.setAttribute('aria-label','Explore Chicago');
  host.innerHTML='<label for="hood-select">Neighborhoods</label><select id="hood-select"><option value="">Fly to a neighborhood…</option></select><div class="explore-actions"><button id="life-toggle" type="button" aria-pressed="false">Pause city life</button><button id="map-toggle" type="button" aria-expanded="true" aria-controls="minimap">Map</button></div><button id="sources-open" type="button">About this model</button>';
  document.body.append(host);
  // Neighborhood menu: every neighborhood inside the circle, grouped by community area.
  const pickHood=host.querySelector('#hood-select'),hoods=ctx.hoods;
  if(!hoods?.inside.length)pickHood.hidden=host.querySelector('label[for="hood-select"]').hidden=true;
  else{
    const groups=new Map();for(const n of hoods.inside){const a=hoods.areaName[n.area]||'Chicago';if(!groups.has(a))groups.set(a,[]);groups.get(a).push(n);}
    for(const [area,list] of [...groups].sort((a,b)=>a[0].localeCompare(b[0]))){const og=document.createElement('optgroup');og.label=area;
      for(const n of list.sort((a,b)=>a.display.localeCompare(b.display))){const o=document.createElement('option');o.value=n.id;o.textContent=(hoods.finished.includes(n)?'★ ':'')+n.display+(n.share<0.99?' (part)':'');og.append(o);}
      pickHood.append(og);}
    pickHood.onchange=()=>{const n=hoods.inside.find(h=>h.id===pickHood.value);if(n)hoods.flyTo(n);pickHood.value='';};
  }
  const life=host.querySelector('#life-toggle');
  const syncLife=()=>{life.setAttribute('aria-pressed',String(ctx.life.paused));life.textContent=ctx.life.paused?'Resume city life':'Pause city life';};
  syncLife();life.onclick=()=>{ctx.life.paused=!ctx.life.paused;syncLife();};
  // Shows or hides the bird's-eye map in the top-right corner (minimap.js).
  host.querySelector('#map-toggle').onclick=(e)=>{const shown=ui.minimap?.toggle();e.currentTarget.setAttribute('aria-expanded',String(!!shown));};
  const dialog=document.createElement('dialog');dialog.id='model-about';dialog.innerHTML='<form method="dialog"><button class="about-close" aria-label="Close about this model">×</button></form><h2>A living model of Chicago</h2><p>Explore downtown and the neighborhoods within 8 km of the Loop, from Wrigleyville to Bronzeville. Traffic, walkers, cyclists, boats, and trains are illustrative animations.</p><p>Building footprints and measured heights: <a href="https://gis.cookcountyil.gov/traditional/rest/services/buildingFootprint_2022/MapServer/0" target="_blank" rel="noopener">Cook County GIS, 2022 lidar and imagery</a>. Streets and water: <a href="https://data.cityofchicago.org/d/pr57-gg9e" target="_blank" rel="noopener">City of Chicago</a>. Geographic data is simplified; measured heights may include rooftop equipment. Landmark forms and heights are curated separately.</p><p>Land use: City of Chicago <a href="https://data.cityofchicago.org/d/dj47-wfun" target="_blank" rel="noopener">zoning districts</a> (yards, plazas, industrial land; alleys are estimated from block shapes). Named buildings: City of Chicago <a href="https://data.cityofchicago.org/d/uct4-hrvh" target="_blank" rel="noopener">Chicago Landmarks</a> and <a href="https://www.wikidata.org" target="_blank" rel="noopener">Wikidata</a> (CC0).</p><p>Neighborhoods: <a href="https://data.cityofchicago.org/d/y6yq-dbs2" target="_blank" rel="noopener">City of Chicago neighborhood</a> and community area boundaries. Named buildings and railway lines in finished neighborhoods, and on the lakefront the shoreline, harbors and docks, park paths, lots, beaches, trees and lamps, and Soldier Field&rsquo;s form: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> (ODbL). Park fields and courts: <a href="https://data.cityofchicago.org/d/eix4-gf83" target="_blank" rel="noopener">Chicago Park District facilities</a>. Outside downtown, facade styles, roofs, church towers, trees and street life are illustrative, based on each neighborhood&rsquo;s character.</p><p>This site provides applications using data that has been modified for use from its original source, www.cityofchicago.org, the official website of the City of Chicago.</p><p>Architectural references: <a href="https://www.architecture.org/online-resources/buildings-of-chicago" target="_blank" rel="noopener">Chicago Architecture Center</a>, <a href="https://www.skyscrapercenter.com" target="_blank" rel="noopener">The Skyscraper Center</a>, and <a href="https://www.themart.com/about/" target="_blank" rel="noopener">THE MART</a>.</p><p>Waterfront landscape details follow the <a href="https://navypier.org/plan-your-visit/navy-pier-map/" target="_blank" rel="noopener">Navy Pier map</a> and <a href="https://www.chicagoparkdistrict.com/lakefront-trail" target="_blank" rel="noopener">Park District trail maps</a>. Gardens, trees and boats illustrate a typical summer day; landscape dimensions are visual estimates.</p><p>Southern Grant Park includes the existing courts, skate plaza and 106 Agora figures. Fulton Market adds completed office buildings through October 2026. Facade details and new-building setbacks are visual estimates from architects and owners; parked cars are illustrative occupancy of identified lots.</p><p>The CTA layer is fixed to October 29, 2026. Official route shapes, stops and GIS corridors support all eight lines; train movement is illustrative. Entrance locations are historical observations; heights, platform dimensions and station architecture are estimates. Trains and stations form part of the background city scenery.</p><p>City data is packaged with this site. No live location or transit tracking.</p>';
  document.body.append(dialog);host.querySelector('#sources-open').onclick=()=>dialog.showModal();
  return {update(){}};
}
