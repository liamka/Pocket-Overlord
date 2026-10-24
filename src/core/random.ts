/** Mulberry32: every simulation random decision belongs to the saved world. */
export class Random {
  constructor(public state: number) { this.state >>>= 0; }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min: number, max: number): number { return min + this.next() * (max - min); }
}

/** Stateless texture noise must never advance the simulation RNG. */
export function noise(x: number, y: number, seed = 0): number {
  let n = Math.imul(x + 374761393, 668265263) ^ Math.imul(y + seed, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
