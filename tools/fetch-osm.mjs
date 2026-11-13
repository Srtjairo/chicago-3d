// Downloads OpenStreetMap (ODbL) extras for every neighborhood inside the circle: alleys, parking
// lots and named buildings. Overpass is often busy, so requests are paced, retried and cached;
// run it as often as needed (it skips what's already cached). Pinned in tools/osm-sources.lock.json.
// tools/import-city-tiles.mjs reads only the cache, so a busy Overpass never blocks a build.
//
//   node tools/fetch-osm.mjs [neighborhood-id ...]      (default: all inside the circle)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unproject } from '../js/coverage.js';
import { root, createLock, cachedJson } from './geo-source.mjs';

const lock = createLock(join(root, 'tools', 'osm-sources.lock.json'));
const registry = JSON.parse(readFileSync(join(root, 'assets', 'neighborhoods.json'), 'utf8'));
const only = process.argv.slice(2);
const hoods = registry.neighborhoods.filter((n) => n.status !== 'outside' && n.bbox && (!only.length || only.includes(n.id)));
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
export const osmKeys = (id) => ({ alleys: `osm/alleys-${id}`, parking: `osm/parking-${id}`, named: `osm/named-${id}` });

let fetched = 0, failed = 0;
for (const n of hoods) {
  const [x0, x1, z0, z1] = n.bbox, [w, s] = unproject([x0 - 100, z1 + 100]), [e, nn] = unproject([x1 + 100, z0 - 100]);
  const bbox = `${s.toFixed(5)},${w.toFixed(5)},${nn.toFixed(5)},${e.toFixed(5)}`, keys = osmKeys(n.id);
  const queries = {
    alleys: `[out:json][timeout:120];way["highway"="service"]["service"="alley"](${bbox});out geom;`,
    parking: `[out:json][timeout:120];way["amenity"="parking"]["parking"!~"underground|multi-storey|rooftop"](${bbox});out geom;`,
    named: `[out:json][timeout:120];(way["building"]["name"](${bbox});relation["building"]["name"](${bbox}););out center tags;`,
  };
  for (const [what, q] of Object.entries(queries)) {
    if (existsSync(join(root, '.cache', keys[what] + '.json.gz'))) continue;
    let ok = false;
    for (const url of MIRRORS) {
      try { await cachedJson(lock, keys[what], url, { body: { data: q }, tries: 2 }); ok = true; break; } catch (err) { console.log(`  ${n.display} ${what}: ${err.message}`); }
    }
    if (ok) { fetched++; console.log(`${n.display}: ${what} cached`); } else failed++;
    lock.save();
    await pause(ok ? 12000 : 45000); // be gentle: Overpass rate-limits bursts
  }
}
lock.save();
console.log(`Done: ${fetched} fetched, ${failed} failed (run again later to retry those).`);
