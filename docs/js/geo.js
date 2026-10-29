import {waterfrontAt,waterfrontLand} from './waterfront-data.js?v=196332b19f6f2af2';
// World layout for downtown Chicago.
// Units are meters. The origin is State & Madison, the zero point of Chicago's address grid.
// +X runs east (toward the lake), +Z runs south, +Y is up.

export const BLOCK = 125;   // street pitch
export const STREET = 22;   // street width
export const METERS_PER_MILE = 1609.34;

// City extent used for procedural buildings
export const EXTENT = { minX: -3500, maxX: 1600, minZ: -5000, maxZ: 4500 };

// Lake Michigan shoreline: [z, x] pairs (north to south). Land lies west of this line.
const SHORE = [
  [-9000, -900], [-6000, -300], [-4800, 0], [-3200, 280], [-2600, 380], [-2110, 520],
  [-1750, 820], [-1500, 1150], [-1250, 1300], [-1000, 1400], [-850, 1400], [-760, 1300],
  [-700, 1050], [-500, 960], [1600, 960], [1850, 1150], [2150, 1500], [2700, 1550],
  [3000, 1150], [3500, 950], [6000, 1100], [9000, 1100],
];

export function shoreX(z) {
  if (z <= SHORE[0][0]) return SHORE[0][1];
  for (let i = 1; i < SHORE.length; i++) {
    const [z1, x1] = SHORE[i];
    if (z <= z1) {
      const [z0, x0] = SHORE[i - 1];
      return x0 + (x1 - x0) * (z - z0) / (z1 - z0);
    }
  }
  return SHORE[SHORE.length - 1][1];
}

export const SHORE_POINTS = SHORE;

// Chicago River: main stem from the lake to Wolf Point, then the north and south branches. [x, z]
export const RIVER = {
  main: [[1450, -760], [800, -760], [274, -740], [130, -715], [0, -580], [-300, -565], [-560, -550], [-805, -530]],
  north: [[-805, -530], [-888, -790], [-1000, -1100], [-1220, -1620], [-1400, -2300], [-1500, -3200], [-1600, -4500], [-1700, -6000]],
  south: [[-805, -530], [-830, 0], [-855, 600], [-860, 1200], [-830, 1700], [-700, 2300], [-650, 3000], [-900, 4500], [-1000, 6000]],
  width: { main: 62, north: 48, south: 52 },
};

// Rendering, bridges and building setbacks all use the same sampled centerline.
export function samplePath(points, steps = 8) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[Math.max(0, i - 1)], b = points[i];
    const c = points[i + 1], d = points[Math.min(points.length - 1, i + 2)];
    for (let j = 0; j < steps; j++) {
      const t = j / steps;
      out.push([0, 1].map((k) => 0.5 * ((2 * b[k]) + (-a[k] + c[k]) * t
        + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t * t
        + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * t * t * t)));
    }
  }
  out.push([...points[points.length - 1]]);
  return out;
}
export const RIVER_PATHS = Object.fromEntries(['main', 'north', 'south'].map((key) => [key, samplePath(RIVER[key])]));

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  const qx = ax + dx * t - px, qz = az + dz * t - pz;
  return Math.hypot(qx, qz);
}

export function distToRiver(x, z) {
  let d = Infinity;
  for (const key of ['main', 'north', 'south']) {
    const pts = RIVER_PATHS[key];
    for (let i = 1; i < pts.length; i++) {
      d = Math.min(d, segDist(x, z, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) - RIVER.width[key] / 2);
    }
  }
  return d;
}

// River centerline z at a given x on the main stem (used for bridges)
export function polylineAt(pts, coord, value) {
  // coord 0 = x, 1 = z. Returns the other coordinate where the polyline crosses `value`.
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1][coord], b = pts[i][coord];
    if ((value - a) * (value - b) <= 0 && a !== b) {
      const t = (value - a) / (b - a);
      const o = 1 - coord;
      return pts[i - 1][o] + (pts[i][o] - pts[i - 1][o]) * t;
    }
  }
  return null;
}

// Grant Park: Michigan Ave to Lake Shore Drive, Randolph to Roosevelt
export const GRANT_PARK = { minX: 250, maxX: 875, minZ: -250, maxZ: 1625 };
export const COLUMBUS_X = 600;
export const PARK_CROSS_STREETS = [125, 375, 1000]; // Monroe, Jackson, Balbo (grid-aligned)

export const PLAZAS = {
  bean: { x: 374, z: -78, r: 42 },
  pritzker: { x: 530, z: -165 },
  lawn: { minX: 475, maxX: 590, minZ: -135, maxZ: 25 },
  fountain: { x: 739, z: 688, r: 95 },
};

export const NAVY_PIER = { x0: 1395, x1: 2410, z: -1077, w: 100 };
export const WHEEL = { x: 1640, z: -1077 };

// Landmarks with real-world facts. x/z are approximate positions from latitude/longitude.
export const LANDMARKS = [
  {
    id: 'willis', name: 'Willis Tower', aka: 'Sears Tower until 2009', x: -672, z: 344, r: 50, h: 527, roof: 442,
    ft: 1451, year: 1973, addr: '233 S Wacker Dr',
    facts:[['Roof height','1,451 ft · 442 m'],['Antenna tip','1,729 ft · 527 m'],['Opened','1973'],['Address','233 S Wacker Dr']],
    collision:{x0:-706.5,x1:-637.5,z0:309.5,z1:378.5},
    desc: 'Nine square tubes bundled together, ending at floors 50, 66, 90 and 108. It was the tallest building in the world for 25 years.',
    view: { az: -0.35, dist: 900, el: 0.32 },
  },
  {
    id: 'hancock', name: '875 North Michigan', aka: 'John Hancock Center', x: 407, z: -1865, r: 50, h: 457, roof: 344,
    ft: 1128, year: 1969, addr: '875 N Michigan Ave',
    desc: 'The tapered black tower with exterior X-bracing that lets the frame carry wind loads with far less steel.',
    view: { az: 2.6, dist: 780, el: 0.3 },
  },
  {
    id: 'trump', name: 'Trump International Hotel & Tower', aka: '', x: 116, z: -777, r: 40, h: 423, roof: 357,
    ft: 1388, year: 2009, addr: '401 N Wabash Ave',
    desc: 'Setbacks line up with the heights of neighboring buildings along the river: the Wrigley Building, River Plaza and 330 N Wabash.',
    view: { az: 0.5, dist: 720, el: 0.28 },
  },
  {
    id: 'wrigley', name: 'Wrigley Building', aka: '', x: 210, z: -815, r: 48, h: 133.5, roof: 129.5,
    ft: 438, year: 1921, addr: '400–410 N Michigan Ave',
    desc: 'Two towers in glazed white terra-cotta, about 250,000 pieces in six shades that brighten toward the top. The south tower’s clock tower is modeled on the Giralda in Seville, and the building has been floodlit at night since its completion.',
    view: { az: 0.5, dist: 330, el: 0.34 },
  },
  {
    id: 'stregis', name: 'St. Regis Chicago', aka: 'Vista Tower', x: 855, z: -544, r: 50, h: 363, roof: 363,
    ft: 1191, year: 2020, addr: '363 E Wacker Dr',
    desc: 'Three connected glass towers of different heights, inspired by the shape of a frustum. The tallest building designed by a woman, Jeanne Gang.',
    view: { az: 0.9, dist: 640, el: 0.25 },
  },
  {
    id: 'aon', name: 'Aon Center', aka: 'Standard Oil Building', x: 525, z: -366, r: 34, h: 346, roof: 346,
    ft: 1136, year: 1973, addr: '200 E Randolph St',
    desc: 'A plain square shaft with chevron-shaped steel columns. Originally clad in Italian marble, re-clad in granite in the 1990s.',
    view: { az: 1.4, dist: 620, el: 0.26 },
  },
  {
    id: 'prudential', name: 'Two Prudential Plaza', aka: '', x: 425, z: -333, r: 30, h: 303, roof: 303,
    ft: 995, year: 1990, addr: '180 N Stetson Ave',
    desc: 'Granite tower topped by a stepped, gabled crown and a spire.',
    view: { az: -0.6, dist: 560, el: 0.26 },
  },
  {
    id: 'marina', name: 'Marina City', aka: 'The corn cobs', x: -58, z: -654, r: 50, h: 179, roof: 179,
    ft: 587, year: 1964, addr: '300 N State St',
    desc: 'Twin 65-story round towers. The bottom 19 floors are an open spiral parking ramp with apartments above.',
    view: { az: 0.2, dist: 360, el: 0.22 },
  },
  {
    id: 'bean', name: 'Cloud Gate', aka: 'The Bean', x: 374, z: -78, r: 20, h: 10, roof: 10,
    ft: 33, year: 2006, addr: 'Millennium Park',
    desc: '168 stainless steel plates welded and polished until no seam shows. It reflects the skyline along Michigan Avenue.',
    view: { az: 2.3, dist: 95, el: 0.18 },
  },
  {
    id: 'pritzker', name: 'Jay Pritzker Pavilion', aka: '', x: 480, z: -67, r: 40, h: 37, roof: 37,
    ft: 120, year: 2004, addr: 'Millennium Park',
    desc: 'Frank Gehry’s bandshell of curling stainless steel ribbons, with a steel-pipe trellis carrying sound over the Great Lawn.',
    view: { az: 1.75, dist: 260, el: 0.28 },
  },
  {
    id: 'grantpark', name: 'Grant Park', aka: 'Chicago’s front yard', x: 560, z: 650, r: 0, h: 60, roof: 60,
    ft: 0, year: 1844, addr: 'Michigan Ave to Lake Shore Dr', acres: 319,
    desc: '319 acres of lawns and gardens between the Loop and Lake Michigan, protected by law from development since 1836.',
    view: { az: 1.35, dist: 1350, el: 0.68 },
  },
  {
    id: 'fountain', name: 'Buckingham Fountain', aka: '', x: 739, z: 688, r: 45, h: 46, roof: 10,
    ft: 150, year: 1927, addr: 'Grant Park at Congress Pkwy',
    desc: 'One of the largest fountains in the world. The center jet shoots about 150 feet into the air.',
    view: { az: 1.2, dist: 220, el: 0.3 },
  },
  {
    id: 'navypier', name: 'Navy Pier', aka: '', x: 1900, z: -1077, r: 0, h: 60, roof: 60,
    ft: 3300, year: 1916, addr: '600 E Grand Ave',
    desc: 'A 3,300-foot pier into Lake Michigan with the 196-foot Centennial Wheel near its base.',
    view: { az: 1.0, dist: 1100, el: 0.55 },
  },
];

// Footprint-aligned positions; surveyed geometry remains separate from architectural heights.
Object.assign(LANDMARKS.find(l=>l.id==='wrigley'), {x:255,z:-844,r:38});
Object.assign(LANDMARKS.find(l=>l.id==='prudential'), {x:428,z:-375,r:27});
Object.assign(LANDMARKS.find(l=>l.id==='marina'), {x:-77,z:-670,r:57});
Object.assign(LANDMARKS.find(l=>l.id==='stregis'), {x:877,z:-567,r:58});
Object.assign(LANDMARKS.find(l=>l.id==='pritzker'), {x:530,z:-165});
LANDMARKS.push(
  {id:'aqua',name:'Aqua Tower',aka:'Studio Gang',x:652,z:-466,r:55,h:261.8,roof:261.8,ft:859,year:2009,addr:'225 N Columbus Dr',desc:'Undulating concrete balconies turn a glass tower into a rippling vertical landscape. Each floor has its own balcony outline.',view:{az:1.5,dist:470,el:0.28}},
  {id:'tribune',name:'Tribune Tower',aka:'Gothic Revival on Michigan Avenue',x:353,z:-943,r:49,h:141.7,roof:141.7,ft:465,year:1925,addr:'435 N Michigan Ave',desc:'Howells & Hood won an international design competition with a limestone tower crowned by Gothic buttresses and pinnacles.',view:{az:-1.2,dist:290,el:0.27}},
  {id:'carbide',name:'Carbide & Carbon Building',aka:'Pendry Chicago',x:238,z:-499,r:25,h:153.3,roof:153.3,ft:503,year:1929,addr:'230 N Michigan Ave',desc:'Dark green terra cotta rises above a black granite base to a gold-leaf crown. Designed by the Burnham Brothers.',view:{az:1.3,dist:280,el:0.3}},
  {id:'mart',name:'Merchandise Mart',aka:'THE MART',x:-631,z:-720,r:115,h:103.6,roof:103.6,ft:340,year:1930,addr:'222 W Merchandise Mart Plaza',desc:'A monumental Art Deco wholesale marketplace spanning two city blocks. Its long limestone facade and central tower anchor the north bank.',view:{az:1.1,dist:480,el:0.32}},
  {id:'board',name:'Chicago Board of Trade',aka:'The head of LaSalle Street',x:-365,z:489,r:63,h:184.4,roof:175.2,ft:605,year:1930,addr:'141 W Jackson Blvd',desc:'Holabird & Root’s limestone setbacks terminate LaSalle Street. A pyramidal roof carries John Storrs’s aluminum statue of Ceres.',view:{az:3.14,dist:380,el:0.25}},
  {id:'riverside',name:'150 North Riverside',aka:'A tower on a narrow base',x:-876,z:-361,r:44,h:220.7,roof:220.7,ft:724,year:2017,addr:'150 N Riverside Plaza',desc:'Goettsch Partners narrowed the tower at its base to fit between railway tracks and the river, opening much of the site as public landscape.',view:{az:1.4,dist:430,el:0.23}},
  {id:'relativity',name:'Relativity',aka:'Central Standard Building',x:-302.4,z:391,r:58,h:92.1,roof:92.1,ft:302,year:1924,
    addr:'231 S LaSalle St, Chicago, IL 60604',listMeta:'20th floor',footprintIds:['891214-0'],
    labelSubtitle:'Central Standard Building',collision:{x0:-353.1,x1:-252.9,z0:362.1,z1:419.9},
    facts:[['Building height','302 ft · 92.1 m'],['Opened','1924'],['Office','20th floor'],['Address','231 S LaSalle St, Chicago, IL 60604']],
    desc:'Relativity’s Chicago office occupies the 20th floor of the Central Standard Building. Graham, Anderson, Probst & White designed this limestone banking and office building, with its columned LaSalle Street entrance.',view:{az:-.62,dist:45,el:.5,focus:[-49,-32,0],width:0,clearance:1}},
  {id:'ondean',name:'OnDean Family Office',aka:'410 North Carpenter',x:-2145.5,z:-794.05,r:25,h:10,roof:9.1,
    addr:'410 N Carpenter St, Chicago, IL 60642',listMeta:'Fulton Market',labelOffset:5,footprintIds:['860470-0'],
    collision:{x0:-2162.3,x1:-2128.7,z0:-812.2,z1:-775.9},
    facts:[['Neighborhood','Fulton Market'],['Address','410 N Carpenter St, Chicago, IL 60642']],
    desc:'OnDean’s office at Carpenter and Kinzie occupies a converted industrial building. Red brick, broad upper windows and a low, flat roof preserve the character of the surrounding Fulton Market blocks.',view:{az:.85,dist:110,el:.3}},
);

export function configureShore(data) {
  const lake=data.water.filter(w=>w.name==='LAKE MICHIGAN').sort((a,b)=>b.rings[0].length-a.rings[0].length)[0];
  if(!lake)return;
  const ring=lake.rings[0],points=[];
  for(let z=-7000;z<=7000;z+=25){
    const xs=[];
    for(let i=1;i<ring.length;i++){const a=ring[i-1],b=ring[i];if((a[1]>z)!==(b[1]>z))xs.push(a[0]+(b[0]-a[0])*(z-a[1])/(b[1]-a[1]));}
    const x=Math.min(...xs.filter(x=>x>-4000));if(Number.isFinite(x))points.push([z,x]);
  }
  if(points.length>100)SHORE.splice(0,SHORE.length,...points);
}

export function toAddress(x, z) {
  const round = (v) => Math.round(Math.abs(v) / 50) * 50;
  const ns = (-z / METERS_PER_MILE) * 800;
  const ew = (x / METERS_PER_MILE) * 800;
  const nsTxt = round(ns) === 0 ? '0 N/S' : `${round(ns)} ${ns > 0 ? 'N' : 'S'}`;
  const ewTxt = round(ew) === 0 ? '0 E/W' : `${round(ew)} ${ew > 0 ? 'E' : 'W'}`;
  return `${nsTxt} · ${ewTxt}`;
}

// Seeded random so the city looks the same on every load
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gauss = (x, z, cx, cz, s) => Math.exp(-(((x - cx) ** 2 + (z - cz) ** 2) / (s * s)));

// Typical building height (m) for a location, based on Chicago's real density
export function heightAt(x, z) {
  return 12
    + 200 * gauss(x, z, -200, 50, 950)      // the Loop
    + 150 * gauss(x, z, 850, -1350, 520)    // Streeterville
    + 70 * gauss(x, z, -350, -1150, 650)    // River North
    + 120 * gauss(x, z, 720, -560, 280)     // Lakeshore East
    + 40 * gauss(x, z, 300, 1500, 600);     // South Loop
}

export function isLake(x, z, margin = 0) {
  if(waterfrontAt(x,z))return !waterfrontLand(x,z)||margin>0&&(!waterfrontLand(x+margin,z)||!waterfrontLand(x-margin,z)||!waterfrontLand(x,z+margin)||!waterfrontLand(x,z-margin));
  return x > shoreX(z) - margin;
}

export function inGrantPark(x, z) {
  const g = GRANT_PARK;
  return x > g.minX && x < g.maxX && z > g.minZ && z < g.maxZ;
}

export function landmarkInRect(x0, z0, x1, z1) {
  return LANDMARKS.find((l) => l.r > 0 && l.x + l.r > x0 && l.x - l.r < x1 && l.z + l.r > z0 && l.z - l.r < z1);
}
