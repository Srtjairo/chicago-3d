// Background thread for the streamed city: downloads a tile, inflates it, decodes it and turns
// it into typed arrays the main thread can upload to the GPU without further work.
// It imports nothing from three.js (module workers don't see the page's import map).
import { decode, orientedBox } from './tile-format.js';

// Box instances, stride 7: x, z, width, depth, height, angle (atan2 dz,dx), seed.
export const BOX_STRIDE = 7;

async function load(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  const stream = r.body.pipeThrough(new DecompressionStream('gzip'));
  return decode(new Uint8Array(await new Response(stream).arrayBuffer()));
}

// Block proxies are seen from 1.5 km and more, where garages and sheds are sub-pixel: skip
// footprints under this many square metres (the real shapes come with the near ring).
const MIN_PROXY_AREA = 80;

function boxes(tile) {
  const list = tile.kind === 1 ? tile.boxes : tile.buildings.map((b) => ({ b, o: orientedBox(b.rings[0]) })).filter(({ o }) => o.w * o.d >= MIN_PROXY_AREA);
  const out = new Float32Array(list.length * BOX_STRIDE);
  list.forEach((item, i) => {
    const b = tile.kind === 1 ? item : item.b, o = tile.kind === 1 ? item : item.o;
    // Skyline tiles carry no ids; a position hash keeps each box's window pattern stable.
    const seed = tile.kind === 1 ? Math.abs(Math.round(b.x * 7 + b.z * 13)) % 10007 : b.objectId % 10007;
    out.set([o.x, o.z, Math.max(o.w, 1), Math.max(o.d, 1), b.h, o.angle, seed], i * BOX_STRIDE);
  });
  return out;
}

self.onmessage = async ({ data: { id, url } }) => {
  try {
    const tile = await load(url);
    const data = boxes(tile);
    self.postMessage({ id, kind: tile.kind, count: data.length / BOX_STRIDE, data }, [data.buffer]);
  } catch (e) {
    self.postMessage({ id, error: String(e?.message || e) });
  }
};
