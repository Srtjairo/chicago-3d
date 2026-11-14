// Spatial index for axis-aligned boxes ({x0,x1,z0,z1}, scene metres).
//
// Several systems used to answer "which buildings are near this point/segment?" by
// scanning every building. That is fine for downtown's ~3.7k footprints and freezes at
// city scale, so they ask a uniform grid instead. Results are the same candidates the
// full scan would have accepted: callers still run their exact test on each candidate.
//
// Arrays in this codebase only ever grow with push() (Navy Pier and sites append to
// ctx.collisionBuildings after the city is built), so an index is cached per array and
// catches up on items appended since its last query. If an array shrinks it is rebuilt.

const WIDE_CELLS = 400; // items spanning more cells than this live in an always-checked list

export class BoxIndex {
  constructor(size = 100) {
    this.size = size;
    this.cells = new Map();
    this.wide = [];
    this.items = [];
    this.mark = new Uint32Array(0);
    this.stamp = 0;
  }
  add(item) {
    const s = this.size, i = this.items.length;
    this.items.push(item);
    const a = Math.floor(item.x0 / s), b = Math.floor(item.x1 / s), c = Math.floor(item.z0 / s), d = Math.floor(item.z1 / s);
    if (!(b >= a && d >= c) || (b - a + 1) * (d - c + 1) > WIDE_CELLS) { this.wide.push(i); return; }
    for (let x = a; x <= b; x++) for (let z = c; z <= d; z++) {
      const key = x * 1048576 + z; // exact for |cell| < 2^19, i.e. ±52 000 km at 100 m cells
      const list = this.cells.get(key);
      if (list) list.push(i); else this.cells.set(key, [i]);
    }
  }
  // Every item whose box may touch [x0,x1]×[z0,z1], each once, in insertion order.
  query(x0, z0, x1, z1) {
    const s = this.size, out = [];
    if (this.mark.length < this.items.length) this.mark = new Uint32Array(Math.max(this.items.length, this.mark.length * 2));
    const stamp = ++this.stamp;
    if (stamp === 0xffffffff) { this.mark.fill(0); this.stamp = 1; }
    const take = (i) => { if (this.mark[i] !== this.stamp) { this.mark[i] = this.stamp; out.push(i); } };
    for (const i of this.wide) take(i);
    const a = Math.floor(Math.min(x0, x1) / s), b = Math.floor(Math.max(x0, x1) / s), c = Math.floor(Math.min(z0, z1) / s), d = Math.floor(Math.max(z0, z1) / s);
    if ((b - a + 1) * (d - c + 1) > this.cells.size) {
      // A query wider than the populated grid: walk the populated cells instead.
      for (const [key, list] of this.cells) {
        const cx = Math.round(key / 1048576), cz = key - cx * 1048576;
        if (cx >= a && cx <= b && cz >= c && cz <= d) for (const i of list) take(i);
      }
    } else {
      for (let x = a; x <= b; x++) for (let z = c; z <= d; z++) { const list = this.cells.get(x * 1048576 + z); if (list) for (const i of list) take(i); }
    }
    out.sort((p, q) => p - q);
    return out.map((i) => this.items[i]);
  }
  at(x, z, margin = 0) { return this.query(x - margin, z - margin, x + margin, z + margin); }
}

const cache = new WeakMap();

// The (cached, kept in sync) index of an array of boxes.
export function boxIndex(array, size = 100) {
  let entry = cache.get(array);
  if (!entry || entry.size !== size || entry.index.items.length > array.length) {
    entry = { size, index: new BoxIndex(size) };
    cache.set(array, entry);
  }
  const index = entry.index;
  for (let i = index.items.length; i < array.length; i++) index.add(array[i]);
  return index;
}

// Candidates near a point / inside a rectangle, from an array of boxes.
export const boxesAt = (array, x, z, margin = 0) => boxIndex(array).at(x, z, margin);
export const boxesIn = (array, x0, z0, x1, z1) => boxIndex(array).query(x0, z0, x1, z1);
