// Downloads one small area of OpenStreetMap (ODbL) from the main OSM API (api.openstreetmap.org,
// not the often-busy Overpass servers) and caches it, pinned in tools/osm-sources.lock.json.
// Used to trace the lakefront (tools/lakefront.mjs) against real outlines: stadium, lots,
// paths, gardens, beaches. One request per area; keep areas small (the API caps a request).
//
//   node tools/fetch-osm-area.mjs <name> x0 z0 x1 z1      (local metres)
//   then: node tools/osm-area.mjs <name>  (lists what's there in local coordinates)
import { join } from 'node:path';
import { unproject } from '../js/coverage.js';
import { root, createLock, cachedJson } from './geo-source.mjs';

const [name, ...box] = process.argv.slice(2);
const [x0, z0, x1, z1] = box.map(Number);
if (!name || box.length !== 4 || box.some((v) => !Number.isFinite(Number(v)))) { console.log('usage: node tools/fetch-osm-area.mjs <name> x0 z0 x1 z1'); process.exit(1); }
const [w, s] = unproject([x0, z1]), [e, n] = unproject([x1, z0]);
const lock = createLock(join(root, 'tools', 'osm-sources.lock.json'));
const url = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${w.toFixed(6)},${s.toFixed(6)},${e.toFixed(6)},${n.toFixed(6)}`;
const data = await cachedJson(lock, `osm/area-${name}`, url);
lock.save();
console.log(`osm/area-${name}: ${data.elements.length} elements`);
