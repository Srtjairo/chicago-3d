// The lakefront outside downtown's hand-built waterfront: features the City's park outlines don't
// show. The Park District's "BURNHAM (DANIEL)" outline, for example, is one 658-acre polygon that
// also covers Soldier Field's parking lots and plazas, so on its own it draws everything as lawn.
//
// Traced against the City's street centrelines, building footprints, park outlines and the
// Lake Michigan shoreline (tools/build-tiles.mjs draws them; see the maps in the review notes),
// in local metres (x east, z south of State & Madison). Polygons only need to be roughly right
// at their street edges: streets, sidewalks and buildings draw on top, and every polygon is
// clipped to the land, so nothing spills into the lake or a harbor.
//
// kinds: parking | paved | plaza | lawn (mown, no random trees) | prairie | sand | vacant | water
//        trail (Lakefront Trail, line) | walk (park walk, line) | trees (a row, line, `step` m apart)

export const LAKEFRONT = [
  // ---------- Soldier Field (pilot) ----------
  // The stadium sits on a paved plaza: colonnades on the east and west, the Doughboy statue to
  // the south, the bus and service apron to the north.
  { id: 'soldier-field-plaza', kind: 'plaza', poly: [[800, 1998], [1078, 1998], [1088, 2395], [818, 2395]] },
  // The North Lawn: the park on the roof of the underground North Garage, between the Field
  // Museum and the stadium, edged by rows of trees.
  { id: 'north-lawn', kind: 'lawn', poly: [[795, 1852], [1092, 1852], [1084, 1996], [802, 1996]] },
  { id: 'north-lawn-trees-n', kind: 'trees', line: [[805, 1858], [1080, 1858]], step: 11 },
  { id: 'north-lawn-trees-s', kind: 'trees', line: [[808, 1990], [1078, 1990]], step: 11 },
  { id: 'north-lawn-walk', kind: 'walk', line: [[940, 1852], [940, 1996]], width: 8 },
  // South of the stadium: the Waldron Parking Deck (the round 7 m footprint) and its apron.
  { id: 'waldron-apron', kind: 'paved', poly: [[905, 2402], [1142, 2402], [1152, 2632], [960, 2638]] },
  // The South Lot: Soldier Field's surface lot between Lake Shore Drive and Burnham Harbor Drive,
  // from 18th Street to McCormick Place (tailgating on game days).
  { id: 'south-lot', kind: 'parking', poly: [[1040, 2650], [1196, 2646], [1206, 2952], [1100, 2962], [1066, 2862], [1046, 2762]] },
  // Burnham Harbor's west shore: a lawn strip with the Lakefront Trail between the drive and the slips.
  { id: 'harbor-west-lawn', kind: 'lawn', poly: [[1150, 1880], [1260, 1880], [1290, 2960], [1205, 2960], [1160, 2500], [1140, 2100]] },
  { id: 'harbor-west-trees', kind: 'trees', line: [[1168, 2440], [1192, 2700], [1212, 2950]], step: 14 },
  // ---------- Museum Campus ----------
  { id: 'museum-walk', kind: 'walk', line: [[1031, 1735], [1096, 1720], [1180, 1700]], width: 12 },
  // ---------- Northerly Island ----------
  // North end: the old Meigs Field terminal and the event lawn; the Huntington Bank Pavilion's lawn
  // bowl on the west side; the 40-acre restored prairie and savanna south of it.
  { id: 'northerly-north-lawn', kind: 'lawn', poly: [[1520, 1800], [1900, 1800], [1900, 2240], [1590, 2240], [1520, 2000]] },
  { id: 'pavilion-bowl', kind: 'lawn', poly: [[1588, 2245], [1730, 2245], [1730, 2425], [1588, 2425]] },
  { id: 'northerly-prairie', kind: 'prairie', poly: [[1480, 2425], [1920, 2425], [1920, 3200], [1480, 3200]] },
  // The pond in the restored south end (the Park District's "LAGOON" point), with the trail around it.
  { id: 'northerly-pond', kind: 'water', poly: [[1697.9,2903.4],[1687.9,2934.4],[1675.1,2960.6],[1661.1,2978.9],[1647.6,2987.1],[1636.1,2984.2],[1628.2,2970.5],[1624.7,2947.7],[1626.0,2918.6],[1632.1,2886.6],[1642.1,2855.6],[1654.9,2829.4],[1668.9,2811.1],[1682.4,2802.9],[1693.9,2805.8],[1701.8,2819.5],[1705.3,2842.3],[1704.0,2871.4]] },
  { id: 'northerly-trail', kind: 'walk', line: [[1560, 2425], [1600, 2600], [1700, 2780], [1760, 2980], [1700, 3120]], width: 5 },
  // ---------- Lakefront Trail ----------
  { id: 'trail-museum-mccormick', kind: 'trail', line: [[1062, 1612], [1110, 1760], [1172, 1885], [1190, 2100], [1182, 2300], [1214, 2500], [1234, 2700], [1244, 2950], [1460, 2982], [1482, 3200], [1484, 3480]] },
];
