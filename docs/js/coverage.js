// Shared by the offline importer, runtime geometry and orientation map.
export const ORIGIN = [-87.62786, 41.88202];
export const COVERAGE_RECTS = [
  { id: 'downtown', minX: -1800, maxX: 2400, minZ: -2300, maxZ: 1800 },
  { id: 'fulton-market', minX: -2550, maxX: -1750, minZ: -1250, maxZ: -150 },
];
export const COVERAGE = {
  minX: Math.min(...COVERAGE_RECTS.map(r => r.minX)), maxX: Math.max(...COVERAGE_RECTS.map(r => r.maxX)),
  minZ: Math.min(...COVERAGE_RECTS.map(r => r.minZ)), maxZ: Math.max(...COVERAGE_RECTS.map(r => r.maxZ)),
};
export const inCoverage = (x,z,margin=0) => COVERAGE_RECTS.some(r => x > r.minX-margin && x < r.maxX+margin && z > r.minZ-margin && z < r.maxZ+margin);
export const project = ([lon,lat]) => [Math.round((lon-ORIGIN[0])*82950*10)/10,Math.round((ORIGIN[1]-lat)*110574*10)/10];
export const unproject = ([x,z]) => [ORIGIN[0]+x/82950,ORIGIN[1]-z/110574];
export const geographicBounds = r => [...unproject([r.minX,r.maxZ]),...unproject([r.maxX,r.minZ])];
// The explorable city: a circle around State & Madison (the street grid's zero point). The camera
// can't leave it (main.js), real buildings stop a little past it (DETAIL_RADIUS) and beyond that a
// static backdrop of taller buildings stands in for the rest of Chicago (tools/build-tiles.mjs).
export const CITY_RADIUS = 8000;
export const DETAIL_RADIUS = CITY_RADIUS + 1000;
export const inCity = (x,z,margin=0) => Math.hypot(x,z) < CITY_RADIUS+margin;
