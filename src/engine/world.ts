import { fbm, hash, random } from "./math.ts";

export const TILE = 16;
export const CHUNK_TILES = 16;
export const CHUNK_SIZE = TILE * CHUNK_TILES;
export const WORLD_LIMIT = 16_000_000;
export const Terrain = {
  Forest: 0,
  Meadow: 1,
  Sand: 2,
  Water: 3,
  DeepWater: 4,
  Path: 5,
  Stone: 6,
} as const;
export const Decor = {
  None: 0,
  Pine: 1,
  Oak: 2,
  Rock: 3,
  Flower: 4,
  Reeds: 5,
  Mushroom: 6,
  Crystal: 7,
} as const;
export type Landmark = { id: string; name: string; x: number; y: number; kind: "camp" | "beacon" };
export const LANDMARKS: readonly Landmark[] = [
  { id: "camp", name: "Mosslight Hollow", x: 0, y: 0, kind: "camp" },
  { id: "north", name: "The Elder Grove", x: 960, y: -720, kind: "beacon" },
  { id: "west", name: "Whispering Stones", x: -1120, y: -480, kind: "beacon" },
  { id: "south", name: "Stillwater Reach", x: 640, y: 1280, kind: "beacon" },
];
export interface TileData {
  terrain: number;
  decor: number;
  variant: number;
}
export interface Chunk {
  cx: number;
  cy: number;
  tiles: Uint8Array;
  decor: Uint8Array;
  variants: Uint8Array;
}
export interface WorldRegion {
  kind: "town" | "area";
  x: number;
  y: number;
  radius: number;
  layout: string;
  name: string;
}
export type TerrainPatch = [tx: number, ty: number, terrain: number, decor: number];
export const MAX_PATCHES = 2048;
export function validatePatches(patches: TerrainPatch[]): void {
  if (
    !Array.isArray(patches) ||
    patches.length > MAX_PATCHES ||
    patches.some(
      (p) =>
        !Array.isArray(p) ||
        p.length !== 4 ||
        p.some((v) => !Number.isInteger(v)) ||
        Math.abs(p[0]) >= WORLD_LIMIT / TILE ||
        Math.abs(p[1]) >= WORLD_LIMIT / TILE ||
        p[2] < 0 ||
        p[2] > 6 ||
        p[3] < 0 ||
        p[3] > 7,
    )
  )
    throw new Error("Invalid terrain patches (maximum 2048 tiles)");
}
export class World {
  readonly seed: number;
  readonly maxChunks: number;
  readonly chunks = new Map<string, Chunk>();
  readonly patches = new Map<string, TerrainPatch>();
  region: WorldRegion | null = null;
  regions: WorldRegion[] = [];
  revision = 0;
  generated = 0;
  evicted = 0;
  constructor(seed = 142, maxChunks = 1024) {
    this.seed = seed >>> 0;
    this.maxChunks = maxChunks;
  }

  sample(tx: number, ty: number): TileData {
    const edited = this.patches.size ? this.patches.get(`${tx},${ty}`) : undefined;
    if (edited)
      return { terrain: edited[2], decor: edited[3], variant: hash(tx, ty, this.seed) & 255 };
    const x = tx * TILE + 8,
      y = ty * TILE + 8;
    const h = hash(tx, ty, this.seed);
    const variant = h & 255;
    const regionAt =
      this.regions.find(
        (r) =>
          Math.abs(x - r.x) < r.radius &&
          Math.abs(y - r.y) < r.radius &&
          (x - r.x) ** 2 + (y - r.y) ** 2 < r.radius ** 2,
      ) ?? this.region;
    if (regionAt) {
      const region = regionAt,
        dx = x - region.x,
        dy = y - region.y,
        d = Math.hypot(dx, dy);
      if (d < region.radius) {
        let terrain: number = Terrain.Meadow;
        if (region.kind === "town") {
          if (Math.abs(dx) < 135 && Math.abs(dy) < 95) terrain = Terrain.Stone;
          if (Math.abs(dy - 35) < 18 || Math.abs(dx) < 15) terrain = Terrain.Path;
          if (Math.hypot(dx + 184, dy - 90) < 32) terrain = Terrain.Water;
        } else {
          const lane = Math.abs(dy - Math.sin(dx / 70) * 36) < 18;
          if (lane || d < 45) terrain = Terrain.Path;
          if (region.layout === "rings" && Math.abs(d - 165) < 20) terrain = Terrain.Stone;
          if (region.layout === "crossroads" && (Math.abs(dx) < 22 || Math.abs(dy) < 22))
            terrain = Terrain.Stone;
          if (region.layout === "terraces" && Math.abs(((dy + 600) % 110) - 55) < 12)
            terrain = Terrain.Stone;
          if (region.layout === "causeway" && Math.abs(dy) > 190 && Math.abs(dx) < 200)
            terrain = Terrain.Water;
          if (region.layout === "orchard" && Math.abs(dx % 100) < 16) terrain = Terrain.Path;
        }
        const decor =
          terrain === Terrain.Meadow && d > (region.kind === "town" ? 180 : 65) && h % 17 === 0
            ? Decor.Flower
            : Decor.None;
        return { terrain, decor, variant };
      }
    }
    const origin = Math.hypot(x, y);
    let clearing = origin < 96;
    for (let i = 1; i < LANDMARKS.length; i++) {
      if (Math.hypot(x - LANDMARKS[i].x, y - LANDMARKS[i].y) < 62) clearing = true;
    }
    const river = 340 + Math.sin(y / 260) * 120 + Math.sin(y / 770) * 170;
    const riverDist = Math.abs(x - river);
    const pond = Math.hypot((x + 600) * 0.8, y + 380);
    const pathY = Math.sin(x / 190) * 28 + 80;
    const path = Math.abs(y - pathY) < 15 || Math.abs(x - Math.sin(y / 330) * 60) < 12;
    const moisture = fbm(tx / 42, ty / 42, this.seed);
    let terrain: number = moisture > 0.53 ? Terrain.Meadow : Terrain.Forest;
    if (moisture < 0.24) terrain = Terrain.Sand;
    if (riverDist < 64 || pond < 138 || moisture < 0.16) terrain = Terrain.Sand;
    if (riverDist < 48 || pond < 117 || moisture < 0.13) terrain = Terrain.Water;
    if (riverDist < 25 || pond < 82 || moisture < 0.1) terrain = Terrain.DeepWater;
    if (path && (terrain < 3 || terrain > 4 || Math.abs(y - pathY) < 15)) terrain = Terrain.Path;
    if (clearing) terrain = origin < 52 ? Terrain.Stone : Terrain.Meadow;
    let decor: number = Decor.None;
    const r = (h >>> 8) / 16777216;
    if (terrain === Terrain.Forest || terrain === Terrain.Meadow) {
      if (r < (terrain === Terrain.Forest ? 0.085 : 0.03)) decor = h & 512 ? Decor.Pine : Decor.Oak;
      else if (r < 0.12) decor = Decor.Flower;
      else if (r < 0.137) decor = Decor.Mushroom;
      else if (r < 0.15) decor = Decor.Rock;
      else if (r > 0.995) decor = Decor.Crystal;
    }
    if (terrain === Terrain.Sand && r < 0.1) decor = Decor.Reeds;
    if (terrain === Terrain.Sand && r > 0.965) decor = Decor.Rock;
    if (clearing || path) decor = Decor.None;
    return { terrain, decor, variant };
  }

  setPatches(patches: TerrainPatch[]): void {
    validatePatches(patches);
    this.patches.clear();
    for (const patch of patches) this.patches.set(`${patch[0]},${patch[1]}`, [...patch]);
    this.chunks.clear();
    this.revision++;
  }
  setRegion(region: WorldRegion | null): void {
    if (JSON.stringify(this.region) === JSON.stringify(region)) return;
    this.region = region ? { ...region } : null;
    this.chunks.clear();
    this.revision++;
  }
  setRegions(regions: WorldRegion[], current: WorldRegion): void {
    if (JSON.stringify(this.regions) !== JSON.stringify(regions)) {
      this.regions = structuredClone(regions);
      this.chunks.clear();
      this.revision++;
    }
    this.region = { ...current };
  }
  paint(tx: number, ty: number, width: number, height: number, terrain: number, decor = 0): void {
    if (
      ![tx, ty, width, height, terrain, decor].every(Number.isInteger) ||
      width < 1 ||
      height < 1 ||
      width * height > MAX_PATCHES
    )
      throw new Error("Brush must contain 1–2048 whole tiles");
    const patches = new Map(this.patches);
    for (let y = ty; y < ty + height; y++)
      for (let x = tx; x < tx + width; x++) patches.set(`${x},${y}`, [x, y, terrain, decor]);
    this.setPatches([...patches.values()]);
  }

  getChunk(cx: number, cy: number): Chunk {
    const key = `${cx},${cy}`;
    const existing = this.chunks.get(key);
    if (existing) {
      // LRU, including physics accesses; deterministic content is independent of cache eviction.
      this.chunks.delete(key);
      this.chunks.set(key, existing);
      return existing;
    }
    const chunk: Chunk = {
      cx,
      cy,
      tiles: new Uint8Array(256),
      decor: new Uint8Array(256),
      variants: new Uint8Array(256),
    };
    for (let y = 0; y < CHUNK_TILES; y++)
      for (let x = 0; x < CHUNK_TILES; x++) {
        const t = this.sample(cx * CHUNK_TILES + x, cy * CHUNK_TILES + y),
          i = y * CHUNK_TILES + x;
        chunk.tiles[i] = t.terrain;
        chunk.decor[i] = t.decor;
        chunk.variants[i] = t.variant;
      }
    this.chunks.set(key, chunk);
    this.generated++;
    if (this.chunks.size > this.maxChunks) {
      this.chunks.delete(this.chunks.keys().next().value!);
      this.evicted++;
    }
    return chunk;
  }

  tile(tx: number, ty: number): TileData {
    const cx = Math.floor(tx / CHUNK_TILES),
      cy = Math.floor(ty / CHUNK_TILES);
    const chunk = this.getChunk(cx, cy),
      i = (ty - cy * CHUNK_TILES) * CHUNK_TILES + tx - cx * CHUNK_TILES;
    return { terrain: chunk.tiles[i], decor: chunk.decor[i], variant: chunk.variants[i] };
  }
  at(x: number, y: number): TileData {
    return this.tile(Math.floor(x / TILE), Math.floor(y / TILE));
  }
  walkable(x: number, y: number): boolean {
    const t = this.at(x, y);
    return (
      t.terrain !== Terrain.DeepWater &&
      t.decor !== Decor.Pine &&
      t.decor !== Decor.Oak &&
      t.decor !== Decor.Rock
    );
  }
  spawnPoint(index: number, centerX = 0, centerY = 0, radius = 1100): { x: number; y: number } {
    for (let attempt = 0; attempt < 24; attempt++) {
      const angle = random(index, attempt * 2, this.seed + 94) * Math.PI * 2;
      const r = Math.sqrt(random(index, attempt * 2 + 1, this.seed + 64)) * radius + 70;
      const x = centerX + Math.cos(angle) * r,
        y = centerY + Math.sin(angle) * r;
      if (this.walkable(x, y)) return { x, y };
    }
    return { x: centerX, y: centerY };
  }
  biome(x: number, y: number): string {
    if (this.region && Math.hypot(x - this.region.x, y - this.region.y) < this.region.radius + 80)
      return this.region.name;
    const other = this.regions.find((r) => Math.hypot(x - r.x, y - r.y) < r.radius);
    if (other) return other.name;
    for (const l of LANDMARKS) if (Math.hypot(x - l.x, y - l.y) < 190) return l.name;
    const t = this.at(x, y).terrain;
    return t === Terrain.Water || t === Terrain.DeepWater || t === Terrain.Sand
      ? "The Silverwater"
      : t === Terrain.Meadow
        ? "Sunfern Meadows"
        : "The Wandering Wood";
  }
}
