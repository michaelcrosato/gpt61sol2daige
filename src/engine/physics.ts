import { clamp, hash } from "./math.ts";
import { Decor, Terrain, TILE, WORLD_LIMIT, type World } from "./world.ts";

/** Reusable broad phase: fixed memory, no object allocation per entity per tick. */
export class SpatialHash {
  readonly heads: Int32Array;
  private readonly mask: number;
  readonly next: Int32Array;
  readonly cellX: Int32Array;
  readonly cellY: Int32Array;
  readonly size: number;
  constructor(capacity: number, size = 24) {
    this.heads = new Int32Array(Math.max(16384, 2 ** Math.ceil(Math.log2(capacity * 2))));
    this.mask = this.heads.length - 1;
    this.next = new Int32Array(capacity);
    this.cellX = new Int32Array(capacity);
    this.cellY = new Int32Array(capacity);
    this.size = size;
  }
  build(x: Float64Array, y: Float64Array, count: number): void {
    this.heads.fill(-1);
    for (let i = 0; i < count; i++) {
      const cx = Math.floor(x[i] / this.size),
        cy = Math.floor(y[i] / this.size),
        bucket = hash(cx, cy) & this.mask;
      this.cellX[i] = cx;
      this.cellY[i] = cy;
      this.next[i] = this.heads[bucket];
      this.heads[bucket] = i;
    }
  }
  query(x: number, y: number, radius: number, visitor: (i: number) => void): void {
    const minX = Math.floor((x - radius) / this.size),
      maxX = Math.floor((x + radius) / this.size);
    const minY = Math.floor((y - radius) / this.size),
      maxY = Math.floor((y + radius) / this.size);
    for (let cy = minY; cy <= maxY; cy++)
      for (let cx = minX; cx <= maxX; cx++) {
        let i = this.heads[hash(cx, cy) & this.mask];
        while (i !== -1) {
          if (this.cellX[i] === cx && this.cellY[i] === cy) visitor(i);
          i = this.next[i];
        }
      }
  }
}
export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

export function resolveWorld(world: World, body: Body): number {
  let contacts = 0;
  body.x = clamp(body.x, -WORLD_LIMIT + body.radius, WORLD_LIMIT - body.radius);
  body.y = clamp(body.y, -WORLD_LIMIT + body.radius, WORLD_LIMIT - body.radius);
  const tx = Math.floor(body.x / TILE),
    ty = Math.floor(body.y / TILE);
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const tile = world.tile(tx + dx, ty + dy);
      const x = (tx + dx) * TILE,
        y = (ty + dy) * TILE;
      if (tile.terrain === Terrain.DeepWater) {
        const nearestX = clamp(body.x, x, x + TILE),
          nearestY = clamp(body.y, y, y + TILE);
        let nx = body.x - nearestX,
          ny = body.y - nearestY,
          d = Math.hypot(nx, ny);
        if (d >= body.radius) continue;
        if (d < 0.00001) {
          // Choose the nearest tile edge for a body spawned inside a solid tile.
          const edges = [body.x - x, x + TILE - body.x, body.y - y, y + TILE - body.y];
          const edge = edges.indexOf(Math.min(...edges));
          nx = edge === 0 ? -1 : edge === 1 ? 1 : 0;
          ny = edge === 2 ? -1 : edge === 3 ? 1 : 0;
          d = -edges[edge];
        } else {
          nx /= d;
          ny /= d;
        }
        body.x += nx * (body.radius - d + 0.001);
        body.y += ny * (body.radius - d + 0.001);
        const vn = body.vx * nx + body.vy * ny;
        if (vn < 0) {
          body.vx -= nx * vn * 1.15;
          body.vy -= ny * vn * 1.15;
        }
        contacts++;
      } else if (
        tile.decor === Decor.Pine ||
        tile.decor === Decor.Oak ||
        tile.decor === Decor.Rock
      ) {
        const radius = body.radius + (tile.decor === Decor.Rock ? 5 : 4);
        const ox = body.x - (x + 8),
          oy = body.y - (y + 10),
          d = Math.hypot(ox, oy);
        if (d < radius) {
          const nx = d > 0.001 ? ox / d : 1,
            ny = d > 0.001 ? oy / d : 0;
          body.x += nx * (radius - d);
          body.y += ny * (radius - d);
          const vn = body.vx * nx + body.vy * ny;
          if (vn < 0) {
            body.vx -= nx * vn * 1.2;
            body.vy -= ny * vn * 1.2;
          }
          contacts++;
        }
      }
    }
  return contacts;
}

/** Conservative substeps prevent a dash tunnelling through a one-tile wall. */
export function moveBody(world: World, body: Body, dt: number): number {
  const steps = Math.max(
    1,
    Math.ceil((Math.hypot(body.vx, body.vy) * dt) / Math.max(2, body.radius * 0.8)),
  );
  let contacts = 0;
  for (let i = 0; i < steps; i++) {
    body.x += (body.vx * dt) / steps;
    body.y += (body.vy * dt) / steps;
    contacts += resolveWorld(world, body);
  }
  return contacts;
}

export function collideCircles(
  a: Body,
  b: Body,
  massA = 1,
  massB = 1,
  restitution = 0.25,
): boolean {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    r = a.radius + b.radius,
    d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return false;
  const d = Math.sqrt(d2),
    nx = d > 0.0001 ? dx / d : 1,
    ny = d > 0.0001 ? dy / d : 0;
  const ia = 1 / massA,
    ib = 1 / massB,
    total = ia + ib,
    penetration = r - d + 0.001;
  a.x -= (nx * penetration * ia) / total;
  a.y -= (ny * penetration * ia) / total;
  b.x += (nx * penetration * ib) / total;
  b.y += (ny * penetration * ib) / total;
  const closing = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (closing < 0) {
    const impulse = (-(1 + restitution) * closing) / total;
    a.vx -= impulse * nx * ia;
    a.vy -= impulse * ny * ia;
    b.vx += impulse * nx * ib;
    b.vy += impulse * ny * ib;
  }
  return true;
}
