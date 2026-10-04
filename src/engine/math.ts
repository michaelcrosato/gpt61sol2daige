/** Stateless integer hashing: content never depends on chunk request order. */
export function hash(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
export const random = (x: number, y: number, seed = 0) => hash(x, y, seed) / 4294967296;
export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const distance = (ax: number, ay: number, bx: number, by: number) =>
  Math.hypot(ax - bx, ay - by);
const smooth = (t: number) => t * t * (3 - 2 * t);
export function noise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = smooth(x - ix),
    fy = smooth(y - iy);
  return lerp(
    lerp(random(ix, iy, seed), random(ix + 1, iy, seed), fx),
    lerp(random(ix, iy + 1, seed), random(ix + 1, iy + 1, seed), fx),
    fy,
  );
}
export function fbm(x: number, y: number, seed: number): number {
  return (
    noise(x, y, seed) * 0.6 +
    noise(x * 2, y * 2, seed + 71) * 0.28 +
    noise(x * 4, y * 4, seed + 193) * 0.12
  );
}
export function checksum(values: ArrayLike<number>, start = 2166136261): number {
  let h = start;
  for (let i = 0; i < values.length; i++) h = Math.imul(h ^ Math.round(values[i] * 1000), 16777619);
  return h >>> 0;
}
