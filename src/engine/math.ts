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

/*
 * Engine-independent sine and cosine (fdlibm/musl kernels with Cody-Waite range reduction,
 * within about 1 ulp of the true value for |x| < 2^20 π/2). Built only from +, −, × and ÷,
 * which every JavaScript engine rounds identically, so browsers and Node agree bit for bit,
 * unlike `Math.sin`/`Math.cos` (see D69 and D82). Used where physics feeds trig into state every
 * tick (joint drives and projection, wind fields).
 */
const S1 = -0.16666666666666632,
  S2 = 0.00833333333332249,
  S3 = -0.0001984126982985795,
  S4 = 0.0000027557313707070068,
  S5 = -2.5050760253406863e-8,
  S6 = 1.58969099521155e-10,
  C1 = 0.0416666666666666,
  C2 = -0.001388888888887411,
  C3 = 0.00002480158728947673,
  C4 = -2.7557314351390663e-7,
  C5 = 2.087572321298175e-9,
  C6 = -1.1359647557788195e-11,
  INV_PIO2 = 0.6366197723675814,
  PIO2_1 = 1.5707963267341256,
  PIO2_2 = 6.077100506303966e-11,
  PIO2_2T = 2.0222662487959506e-21,
  PIO4 = 0.7853981633974483;
function kernelSin(x: number, y: number): number {
  const z = x * x,
    w = z * z,
    r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6),
    v = z * x;
  return x - (z * (0.5 * y - v * r) - y - v * S1);
}
function kernelCos(x: number, y: number): number {
  const z = x * x,
    w = z * z,
    r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6)),
    hz = 0.5 * z,
    v = 1 - hz;
  return v + (1 - v - hz + (z * r - x * y));
}
/** Quadrant and reduced argument (head + tail) of x modulo π/2. */
function reduce(x: number): [number, number, number] {
  // Two rounds of Cody-Waite: π/2 = PIO2_1 + PIO2_2 + PIO2_2T (musl's second round).
  const n = Math.round(x * INV_PIO2),
    t = x - n * PIO2_1,
    w1 = n * PIO2_2,
    r = t - w1,
    w = n * PIO2_2T - (t - r - w1),
    head = r - w;
  return [n, head, r - head - w];
}
function trig(x: number, cosine: boolean): number {
  if (!Number.isFinite(x)) return Number.NaN;
  if (Math.abs(x) <= PIO4) return cosine ? kernelCos(x, 0) : kernelSin(x, 0);
  const [n, head, tail] = reduce(x),
    q = (((n % 4) + 4) % 4) + (cosine ? 1 : 0);
  switch (q % 4) {
    case 0:
      return kernelSin(head, tail);
    case 1:
      return kernelCos(head, tail);
    case 2:
      return -kernelSin(head, tail);
    default:
      return -kernelCos(head, tail);
  }
}
export const dsin = (x: number): number => trig(x, false);
export const dcos = (x: number): number => trig(x, true);
