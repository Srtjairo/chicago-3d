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

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  const qx = ax + dx * t - px, qz = az + dz * t - pz;
  return Math.hypot(qx, qz);
}

export function distToRiver(x, z) {
  let d = Infinity;
  for (const key of ['main', 'north', 'south']) {
    const pts = RIVER[key];
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
  pritzker: { x: 480, z: -67 },
  lawn: { minX: 500, maxX: 589, minZ: -135, maxZ: -5 },
  fountain: { x: 739, z: 688, r: 95 },
};

export const NAVY_PIER = { x0: 1395, x1: 2410, z: -1077, w: 100 };
export const WHEEL = { x: 1640, z: -1077 };

// Landmarks with real-world facts. x/z are approximate positions from latitude/longitude.
export const LANDMARKS = [
  {
    id: 'willis', name: 'Willis Tower', aka: 'Sears Tower until 2009', x: -672, z: 344, r: 50, h: 527, roof: 442,
    ft: 1451, year: 1973, addr: '233 S Wacker Dr',
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
    view: { az: 1.3, dist: 280, el: 0.28 },
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
    view: { az: 1.95, dist: 1700, el: 0.42 },
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
    view: { az: 2.6, dist: 900, el: 0.3 },
  },
  {
    // 5.8 km north of the Loop, past the filler city; the ground plane already reaches this far
    id: 'wrigleyfield', name: 'Wrigley Field', aka: 'Weeghman Park when it opened', x: -2298, z: -7314, r: 120, h: 50, roof: 27,
    ft: 400, seats: 41649, year: 1914, addr: '1060 W Addison St',
    desc: 'Built in 1914 for a Federal League team, it has been home to the Cubs since 1916. The outfield ivy and the hand-turned center-field scoreboard both date from 1937, and lights for night games only arrived in 1988.',
    view: { az: -0.62, dist: 360, el: 0.5 },
  },
];

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
  return x > shoreX(z) - margin;
}

export function inGrantPark(x, z) {
  const g = GRANT_PARK;
  return x > g.minX && x < g.maxX && z > g.minZ && z < g.maxZ;
}

export function landmarkInRect(x0, z0, x1, z1) {
  return LANDMARKS.find((l) => l.r > 0 && l.x + l.r > x0 && l.x - l.r < x1 && l.z + l.r > z0 && l.z - l.r < z1);
}
