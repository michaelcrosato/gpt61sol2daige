import { CHUNK_SIZE, CHUNK_TILES, Decor, Terrain, TILE, type World } from "../engine/world.ts";
import { compareIds } from "./policies.ts";
import type { PhysicsWorld } from "./runtime.ts";
import type { BodyRecipe } from "./types.ts";

export type ChunkCoordinate = [number, number];
export function occupiedChunks(
  points: { x: number; y: number; radius: number }[],
): ChunkCoordinate[] {
  const chunks = new Map<string, ChunkCoordinate>();
  for (const p of points) {
    for (
      let cy = Math.floor((p.y - p.radius) / CHUNK_SIZE);
      cy <= Math.floor((p.y + p.radius) / CHUNK_SIZE);
      cy++
    )
      for (
        let cx = Math.floor((p.x - p.radius) / CHUNK_SIZE);
        cx <= Math.floor((p.x + p.radius) / CHUNK_SIZE);
        cx++
      )
        chunks.set(`${cx},${cy}`, [cx, cy]);
  }
  return [...chunks.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}
export function terrainRecipe(
  world: World,
  landId: string,
  areaId: string,
  tx: number,
  ty: number,
): BodyRecipe | null {
  if (Math.abs(tx * TILE + 8) > 16_000_000 || Math.abs(ty * TILE + 8) > 16_000_000) return null;
  // Direct seed/patch sampling makes this independent of the render/LRU cache.
  const tile = world.sample(tx, ty);
  if (tile.terrain === Terrain.DeepWater)
    return {
      id: `terrain-${landId}-${tx}-${ty}-water`,
      role: "terrain",
      motion: "fixed",
      shape: { kind: "box", width: TILE, height: TILE },
      x: tx * TILE + 8,
      y: ty * TILE + 8,
      areaId,
      friction: 0,
      restitution: 0,
    };
  if ([Decor.Pine, Decor.Oak, Decor.Rock].includes(tile.decor as 1 | 2 | 3))
    return {
      id: `terrain-${landId}-${tx}-${ty}-decor`,
      role: "terrain",
      motion: "fixed",
      shape: { kind: "circle", radius: tile.decor === Decor.Rock ? 5 : 4 },
      x: tx * TILE + 8,
      y: ty * TILE + 10,
      areaId,
      friction: 0,
      restitution: 0,
    };
  return null;
}
/** Whether a circular footprint overlaps a tile that terrainRecipe turns into a solid. */
export function solidTerrain(world: World): (x: number, y: number, reach: number) => boolean {
  return (x, y, reach) => {
    for (let ty = Math.floor((y - reach) / TILE); ty <= Math.floor((y + reach) / TILE); ty++)
      for (let tx = Math.floor((x - reach) / TILE); tx <= Math.floor((x + reach) / TILE); tx++) {
        const tile = world.sample(tx, ty);
        if (
          tile.terrain === Terrain.DeepWater ||
          [Decor.Pine, Decor.Oak, Decor.Rock].includes(tile.decor as 1 | 2 | 3)
        )
          return true;
      }
    return false;
  };
}
/** Runtime terrain handles follow occupied chunks, never camera visibility or LRU eviction. */
export class TerrainRegistry {
  private chunks = new Map<string, string[]>();
  private revision = -1;
  pending(world: World): boolean {
    return this.revision !== world.revision;
  }
  synchronize(
    world: World,
    physical: PhysicsWorld,
    landId: string,
    areaAt: (x: number, y: number) => string,
    needed: ChunkCoordinate[],
  ): void {
    const requested = new Set(needed.map(([x, y]) => `${x},${y}`));
    for (const [key, ids] of [...this.chunks].sort((a, b) => compareIds(a[0], b[0])))
      if (!requested.has(key) || this.revision !== world.revision) {
        for (const id of [...ids].sort(compareIds)) physical.remove(id);
        this.chunks.delete(key);
      }
    for (const [cx, cy] of needed) {
      const key = `${cx},${cy}`;
      if (this.chunks.has(key)) continue;
      const ids: string[] = [];
      for (let y = 0; y < CHUNK_TILES; y++)
        for (let x = 0; x < CHUNK_TILES; x++) {
          const tx = cx * CHUNK_TILES + x,
            ty = cy * CHUNK_TILES + y;
          const recipe = terrainRecipe(world, landId, areaAt(tx * TILE + 8, ty * TILE + 8), tx, ty);
          if (recipe) {
            physical.spawn(recipe);
            ids.push(recipe.id);
          }
        }
      this.chunks.set(key, ids);
    }
    this.revision = world.revision;
  }
  save(): ChunkCoordinate[] {
    return [...this.chunks.keys()]
      .map((key) => key.split(",").map(Number) as ChunkCoordinate)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }
  restore(world: World, physical: PhysicsWorld, chunks: ChunkCoordinate[], pending = false): void {
    this.chunks.clear();
    for (const chunk of chunks) this.chunks.set(chunk.join(","), []);
    for (const id of physical.ids()) {
      const pose = physical.pose(id);
      if (pose.role !== "terrain") continue;
      const key = `${Math.floor(pose.x / CHUNK_SIZE)},${Math.floor(pose.y / CHUNK_SIZE)}`;
      const list = this.chunks.get(key);
      if (!list) throw new Error("Terrain body outside occupied chunks");
      list.push(id);
    }
    this.revision = pending ? -1 : world.revision;
  }
}
