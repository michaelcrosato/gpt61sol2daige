import {
  type GameEvent,
  idleInput,
  MAX_NPCS,
  MAX_PLAYERS,
  type Player,
  Simulation,
} from "../engine/simulation.ts";
import { EntityVisibility, type ViewRegion } from "../engine/visibility.ts";
import { type TerrainPatch, validatePatches, WORLD_LIMIT } from "../engine/world.ts";
import type { AdventureState } from "../game/types.ts";
import { validateAdventure } from "../game/validation.ts";

export const PROTOCOL_VERSION = 5;
export const MAX_HEADER = 512_000;
export const MAX_PACKET = MAX_NPCS * 16 + MAX_HEADER + 8;
export interface SnapshotView extends ViewRegion {
  entityLimit: number;
}
const visible = new EntityVisibility(MAX_NPCS);
const encoder = new TextEncoder(),
  decoder = new TextDecoder();

/** PeerJS returns Uint8Array for reassembled messages and ArrayBuffer for small ones. */
export function snapshotBuffer(value: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (value.byteLength > MAX_PACKET) throw new Error("Invalid snapshot size");
  if (value instanceof ArrayBuffer) return value;
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice().buffer;
}
interface Header {
  version: 5;
  seed: number;
  tick: number;
  population: number;
  shards: number;
  beacons: string[];
  collected: string[];
  patches: TerrainPatch[];
  players: Player[];
  adventure: AdventureState;
  events: GameEvent[];
  originX: number;
  originY: number;
}

/** 16-byte entity records, relative float positions keep precision at distant coordinates. */
export function encodeSnapshot(
  sim: Simulation,
  playerId: string,
  interest: number | SnapshotView = 1500,
): ArrayBuffer {
  if (sim.playground)
    throw new Error("The standalone playground cannot be encoded as adventure observations");
  const p = sim.players.get(playerId),
    originX = p?.x ?? 0,
    originY = p?.y ?? 0;
  const region =
    typeof interest === "number"
      ? { x: originX, y: originY, radius: interest, entityLimit: MAX_NPCS }
      : interest;
  const { radius } = region;
  visible.select(sim.x, sim.y, sim.count, region, region.entityLimit);
  const header: Header = {
    version: PROTOCOL_VERSION,
    seed: sim.world.seed,
    tick: sim.tick,
    population: sim.count,
    shards: sim.shards,
    beacons: [...sim.beacons],
    patches: [...sim.world.patches.values()],
    collected: [...sim.collected]
      .filter((s) => {
        const [x, y] = s.split(",").map(Number);
        return Math.abs(x * 16 - region.x) < radius && Math.abs(y * 16 - region.y) < radius;
      })
      .slice(-1024),
    players: [...sim.players.values()],
    adventure: sim.adventure.networkState(playerId),
    events: sim.events.slice(-12),
    originX,
    originY,
  };
  const json = encoder.encode(JSON.stringify(header)),
    packet = new ArrayBuffer(8 + json.length + visible.count * 16),
    view = new DataView(packet);
  if (json.length > MAX_HEADER) throw new Error("World metadata exceeds snapshot budget");
  view.setUint32(0, json.length, true);
  view.setUint32(4, visible.count, true);
  new Uint8Array(packet, 8, json.length).set(json);
  let offset = 8 + json.length;
  for (let n = 0; n < visible.count; n++) {
    const i = visible.ids[n];
    view.setUint16(offset, i, true);
    view.setUint8(offset + 2, sim.kind[i]);
    view.setUint8(offset + 3, sim.attuned[i]);
    view.setFloat32(offset + 4, sim.x[i] - originX, true);
    view.setFloat32(offset + 8, sim.y[i] - originY, true);
    view.setInt16(offset + 12, Math.round(sim.vx[i] * 16), true);
    view.setInt16(offset + 14, Math.round(sim.vy[i] * 16), true);
    offset += 16;
  }
  return packet;
}
export function decodeSnapshot(
  packet: ArrayBuffer,
  previous?: Simulation,
): { sim: Simulation; population: number } {
  if (!(packet instanceof ArrayBuffer) || packet.byteLength < 8 || packet.byteLength > MAX_PACKET)
    throw new Error("Invalid snapshot size");
  const view = new DataView(packet),
    length = view.getUint32(0, true),
    count = view.getUint32(4, true);
  if (length > MAX_HEADER || count > MAX_NPCS || 8 + length + count * 16 !== packet.byteLength)
    throw new Error("Invalid snapshot framing");
  const h = JSON.parse(decoder.decode(new Uint8Array(packet, 8, length))) as Header;
  if (
    h.version !== PROTOCOL_VERSION ||
    !Number.isInteger(h.seed) ||
    !Number.isInteger(h.tick) ||
    h.tick < 0 ||
    !Number.isInteger(h.population) ||
    h.population < 0 ||
    h.population > MAX_NPCS ||
    !Number.isSafeInteger(h.shards) ||
    h.shards < 0 ||
    !Number.isFinite(h.originX) ||
    !Number.isFinite(h.originY) ||
    Math.abs(h.originX) > WORLD_LIMIT ||
    Math.abs(h.originY) > WORLD_LIMIT ||
    !Array.isArray(h.players) ||
    h.players.length > MAX_PLAYERS ||
    !Array.isArray(h.beacons) ||
    h.beacons.some((b) => !["north", "west", "south"].includes(b)) ||
    !Array.isArray(h.collected) ||
    h.collected.length > 1024 ||
    h.collected.some((s) => typeof s !== "string" || !/^-?\d+,-?\d+$/.test(s)) ||
    !Array.isArray(h.events) ||
    h.events.length > 12
  )
    throw new Error("Invalid snapshot header");
  validatePatches(h.patches ?? []);
  validateAdventure(h.adventure);
  // Validate completely before mutating the current simulation.
  const ids = new Set<string>();
  for (const p of h.players) {
    if (
      !p ||
      !/^[\w-]{1,80}$/.test(p.id) ||
      ids.has(p.id) ||
      typeof p.name !== "string" ||
      p.name.length > 24 ||
      [p.x, p.y, p.vx, p.vy, p.energy, p.facing, p.steps].some((v) => !Number.isFinite(v)) ||
      Math.abs(p.x) > WORLD_LIMIT ||
      Math.abs(p.y) > WORLD_LIMIT ||
      !Number.isInteger(p.color) ||
      p.color < 0 ||
      p.color >= MAX_PLAYERS
    )
      throw new Error("Invalid snapshot player");
    ids.add(p.id);
  }
  for (const e of h.events)
    if (
      !e ||
      !Number.isFinite(e.tick) ||
      !Number.isFinite(e.x) ||
      !Number.isFinite(e.y) ||
      typeof e.message !== "string" ||
      e.message.length > 256 ||
      !["pulse", "dash", "shard", "beacon", "rest"].includes(e.type)
    )
      throw new Error("Invalid snapshot event");
  let offset = 8 + length;
  for (let i = 0; i < count; i++, offset += 16)
    if (
      !Number.isFinite(view.getFloat32(offset + 4, true)) ||
      !Number.isFinite(view.getFloat32(offset + 8, true)) ||
      Math.abs(view.getFloat32(offset + 4, true)) > WORLD_LIMIT * 2 ||
      Math.abs(view.getFloat32(offset + 8, true)) > WORLD_LIMIT * 2 ||
      view.getUint8(offset + 2) > 2 ||
      view.getUint8(offset + 3) > 1
    )
      throw new Error("Invalid snapshot entity");
  const continuous =
    previous?.adventure.state.seed === h.adventure.seed &&
    previous.adventure.state.run === h.adventure.run &&
    previous.adventure.state.transition === h.adventure.transition;
  const oldEnemies = new Map(
    continuous ? previous.adventure.state.enemies.map((enemy) => [enemy.id, enemy]) : [],
  );
  const oldProjectiles = new Map(
    continuous ? previous.adventure.state.projectiles.map((p) => [p.id, p]) : [],
  );
  const sim = previous?.world.seed === h.seed ? previous : new Simulation(h.seed, 0, "replica");
  sim.useLegacyPhysics(true);
  sim.adventure.restore(h.adventure);
  sim.adventure.configureWorld(sim);
  for (const enemy of sim.adventure.state.enemies) {
    const old = oldEnemies.get(enemy.id);
    enemy.px = old?.x ?? enemy.x;
    enemy.py = old?.y ?? enemy.y;
  }
  for (const projectile of sim.adventure.state.projectiles) {
    const old = oldProjectiles.get(projectile.id);
    projectile.px = old?.x ?? projectile.x;
    projectile.py = old?.y ?? projectile.y;
  }
  if (JSON.stringify([...sim.world.patches.values()]) !== JSON.stringify(h.patches ?? []))
    sim.world.setPatches(h.patches ?? []);
  sim.tick = h.tick;
  sim.count = count;
  sim.shards = h.shards;
  sim.beacons.clear();
  for (const b of h.beacons) sim.beacons.add(b);
  for (const key of h.collected) sim.collected.add(key);
  const oldPlayers = new Map(sim.players);
  sim.players.clear();
  for (const p of h.players)
    sim.players.set(p.id, {
      ...p,
      radius: 6,
      px: continuous ? (oldPlayers.get(p.id)?.x ?? p.x) : p.x,
      py: continuous ? (oldPlayers.get(p.id)?.y ?? p.y) : p.y,
      input: idleInput(),
    });
  sim.events.length = 0;
  sim.events.push(...h.events);
  offset = 8 + length;
  for (let i = 0; i < count; i++, offset += 16) {
    sim.x[i] = h.originX + view.getFloat32(offset + 4, true);
    sim.y[i] = h.originY + view.getFloat32(offset + 8, true);
    sim.vx[i] = view.getInt16(offset + 12, true) / 16;
    sim.vy[i] = view.getInt16(offset + 14, true) / 16;
    sim.px[i] = sim.x[i] - sim.vx[i] * 0.1;
    sim.py[i] = sim.y[i] - sim.vy[i] * 0.1;
    sim.kind[i] = view.getUint8(offset + 2);
    sim.attuned[i] = view.getUint8(offset + 3);
  }
  return { sim, population: h.population };
}
