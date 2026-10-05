import { Adventure } from "../game/adventure.ts";
import type { AdventureState } from "../game/types.ts";
import { validateAdventure } from "../game/validation.ts";
import {
  AdventurePhysics,
  type AdventurePhysicsSnapshot,
  ambientBodyId,
  enemyBodyId,
  playerBodyId,
  validateAdventurePhysics,
  validateSemanticTerrain,
} from "../physics/adventure.ts";
import { rapier } from "../physics/bootstrap.ts";
import { PhysicsWorld, validatePhysicsSnapshot } from "../physics/runtime.ts";
import type { PhysicsSnapshot } from "../physics/types.ts";
import { MAX_NPCS } from "./limits.ts";
import { checksum, clamp, distance, hash, random } from "./math.ts";
import { type Body, collideCircles, moveBody, SpatialHash } from "./physics.ts";
import {
  Decor,
  LANDMARKS,
  Terrain,
  type TerrainPatch,
  TILE,
  validatePatches,
  WORLD_LIMIT,
  World,
} from "./world.ts";

export const ENGINE_VERSION = "2.0.0";
export const STEP = 1 / 60;
export { MAX_NPCS } from "./limits.ts";
export const MAX_PLAYERS = 8;
export type Input = {
  x: number;
  y: number;
  dash: boolean;
  pulse: boolean;
  interact: boolean;
  attack?: boolean;
  lance?: boolean;
  nova?: boolean;
  potion?: boolean;
  aimX?: number;
  aimY?: number;
};
export const idleInput = (): Input => ({ x: 0, y: 0, dash: false, pulse: false, interact: false });
export interface Player extends Body {
  id: string;
  name: string;
  color: number;
  px: number;
  py: number;
  facing: number;
  energy: number;
  pulseCooldown: number;
  dashCooldown: number;
  input: Input;
  lastInteract: boolean;
  steps: number;
}
export interface GameEvent {
  tick: number;
  type: "pulse" | "dash" | "shard" | "beacon" | "rest";
  x: number;
  y: number;
  player: string;
  message: string;
}
export interface SaveState {
  version: 1 | 2;
  seed: number;
  tick: number;
  count: number;
  shards: number;
  beacons: string[];
  collected: string[];
  patches: TerrainPatch[];
  players: Player[];
  events?: GameEvent[];
  adventure?: AdventureState;
  playground?: PhysicsSnapshot;
  actorPhysics?: AdventurePhysicsSnapshot;
  movementBackend?: "legacy" | "replica";
  npcs: {
    x: number[];
    y: number[];
    vx: number[];
    vy: number[];
    kind: number[];
    attuned: number[];
    generation: number[];
  };
}
export class Simulation {
  playground: PhysicsWorld | null = null;
  physical: AdventurePhysics | null = null;
  replicaPhysics: AdventurePhysicsSnapshot | null = null;
  private previousProps = new Map<string, { x: number; y: number; angle: number }>();
  private replicaAmbient = new Set<number>();
  movementBackend: "rapier" | "legacy" | "replica" = "rapier";
  private disposed = false;
  world: World;
  adventure: Adventure;
  tick = 0;
  count = 0;
  shards = 0;
  readonly beacons = new Set<string>();
  readonly collected = new Set<string>();
  readonly players = new Map<string, Player>();
  readonly events: GameEvent[] = [];
  readonly x = new Float64Array(MAX_NPCS);
  readonly y = new Float64Array(MAX_NPCS);
  readonly px = new Float64Array(MAX_NPCS);
  readonly py = new Float64Array(MAX_NPCS);
  readonly vx = new Float32Array(MAX_NPCS);
  readonly vy = new Float32Array(MAX_NPCS);
  readonly kind = new Uint8Array(MAX_NPCS);
  readonly attuned = new Uint8Array(MAX_NPCS);
  readonly generation = new Uint32Array(MAX_NPCS);
  private readonly near = new Uint8Array(MAX_NPCS);
  readonly grid = new SpatialHash(MAX_NPCS);
  metrics = { contacts: 0, near: 0, far: 0, stepMs: 0 };
  private readonly a: Body = { x: 0, y: 0, vx: 0, vy: 0, radius: 3 };
  private readonly b: Body = { x: 0, y: 0, vx: 0, vy: 0, radius: 3 };

  constructor(seed = 142, population = 2400, backend: "rapier" | "legacy" | "replica" = "rapier") {
    rapier();
    this.world = new World(seed);
    this.adventure = new Adventure(seed);
    this.adventure.configureWorld(this);
    this.setPopulation(population);
    this.movementBackend = backend;
    if (backend === "rapier") this.physical = new AdventurePhysics(this);
  }
  useLegacyPhysics(replica = false): void {
    this.physical?.dispose();
    this.physical = null;
    this.movementBackend = replica ? "replica" : "legacy";
  }
  resumeSoloPhysics(): void {
    if (this.physical) return;
    this.movementBackend = "rapier";
    this.physical = new AdventurePhysics(this);
  }
  physicalProps(alpha = 1) {
    if (this.physical) return this.physical.props();
    return (this.replicaPhysics?.world.bodies ?? [])
      .filter((entry) => entry.state?.role === "prop")
      .map((entry) => {
        const p = entry.state!,
          old = this.previousProps.get(p.id) ?? p;
        const angleDelta = Math.atan2(Math.sin(p.angle - old.angle), Math.cos(p.angle - old.angle));
        return {
          ...p,
          x: old.x + (p.x - old.x) * alpha,
          y: old.y + (p.y - old.y) * alpha,
          angle: old.angle + angleDelta * alpha,
        };
      });
  }
  ownsPhysicalAmbient(slot: number): boolean {
    return this.physical?.ownsAmbient(slot) ?? this.replicaAmbient.has(slot);
  }
  /** Validate a complete received scene before publishing any field. No Rapier allocation/solve. */
  applyReplica(state: SaveState): void {
    validateSave(state);
    if (!state.actorPhysics || state.actorPhysics.world.continuation !== "rebuild")
      throw new Error("Missing portable physical baseline");
    const continuous =
      this.replicaPhysics?.landId === state.actorPhysics.landId &&
      this.adventure.state.run === state.adventure?.run &&
      this.adventure.state.transition === state.adventure?.transition;
    const props = this.physicalProps();
    const players = new Map(this.players);
    const enemies = new Map(this.adventure.state.enemies.map((e) => [e.id, e]));
    const projectiles = new Map(this.adventure.state.projectiles.map((p) => [p.id, p]));
    this.useLegacyPhysics(true);
    this.world = this.world.seed === state.seed ? this.world : new World(state.seed);
    this.adventure.restore(state.adventure!);
    this.adventure.configureWorld(this);
    if (JSON.stringify([...this.world.patches.values()]) !== JSON.stringify(state.patches))
      this.world.setPatches(state.patches);
    this.tick = state.tick;
    this.count = state.count;
    this.shards = state.shards;
    this.events.length = 0;
    this.events.push(...structuredClone(state.events ?? []));
    this.beacons.clear();
    for (const b of state.beacons) this.beacons.add(b);
    this.collected.clear();
    for (const c of state.collected) this.collected.add(c);
    this.players.clear();
    for (const p of state.players)
      this.players.set(p.id, {
        ...p,
        input: idleInput(),
        px: continuous ? (players.get(p.id)?.x ?? p.x) : p.x,
        py: continuous ? (players.get(p.id)?.y ?? p.y) : p.y,
      });
    for (const e of this.adventure.state.enemies) {
      e.px = continuous ? (enemies.get(e.id)?.x ?? e.x) : e.x;
      e.py = continuous ? (enemies.get(e.id)?.y ?? e.y) : e.y;
    }
    for (const p of this.adventure.state.projectiles) {
      p.px = continuous ? (projectiles.get(p.id)?.x ?? p.x) : p.x;
      p.py = continuous ? (projectiles.get(p.id)?.y ?? p.y) : p.y;
    }
    for (const key of ["x", "y", "vx", "vy", "kind", "attuned", "generation"] as const)
      this[key].set(state.npcs[key]);
    for (let i = 0; i < this.count; i++) {
      this.px[i] = continuous ? this.x[i] - this.vx[i] * 0.1 : this.x[i];
      this.py[i] = continuous ? this.y[i] - this.vy[i] * 0.1 : this.y[i];
    }
    this.replicaPhysics = state.actorPhysics;
    this.replicaAmbient = new Set(
      state.actorPhysics.ambient.filter((s) => s.owner === "rapier").map((s) => s.slot),
    );
    this.previousProps = new Map((continuous ? props : []).map((p) => [p.id, p]));
  }
  /** Host loss/leave/load retains the received scene and only the selected traveler's build. */
  continueSolo(id: string): Simulation {
    if (id === "local" && this.players.size === 1 && this.movementBackend === "rapier")
      return Simulation.restore(this.save());
    const state = this.save(true),
      player = state.players.find((p) => p.id === id) ?? state.players[0];
    if (!player) throw new Error("Missing local traveler");
    const oldId = player.id;
    state.players = [{ ...player, id: "local", input: idleInput() }];
    const game = new Adventure(state.seed);
    game.restore(state.adventure!);
    game.retainPlayer(oldId, "local");
    state.adventure = game.save();
    const snapshot = state.actorPhysics;
    if (snapshot) {
      const rekey = (bodyId: string) =>
        bodyId === playerBodyId(oldId) ? playerBodyId("local") : bodyId;
      snapshot.world.bodies = snapshot.world.bodies.filter(
        (entry) =>
          !entry.recipe.id.startsWith("player-") || entry.recipe.id === playerBodyId(oldId),
      );
      const retainedIds = new Set(snapshot.world.bodies.map((entry) => entry.recipe.id));
      snapshot.world.events = snapshot.world.events.filter(
        (e) => retainedIds.has(e.a) && retainedIds.has(e.b),
      );
      for (const entry of snapshot.world.bodies) {
        entry.recipe.id = rekey(entry.recipe.id);
        if (entry.state) entry.state.id = rekey(entry.state.id);
      }
      const ids = new Set(snapshot.world.bodies.map((entry) => entry.recipe.id));
      snapshot.world.events = snapshot.world.events
        .map((e) => ({ ...e, a: rekey(e.a), b: rekey(e.b) }))
        .filter((e) => e.a !== e.b && ids.has(e.a) && ids.has(e.b));
    }
    delete state.movementBackend;
    return Simulation.restore(state);
  }
  actorImpulse(id: string, x: number, y: number): void {
    if (this.physical?.world.has(id)) this.physical.world.velocityChange(id, x, y);
    else if (id.startsWith("player-")) {
      const p = this.players.get(id.slice(7));
      if (p) {
        p.vx += x;
        p.vy += y;
      }
    } else {
      const e = this.adventure.state.enemies.find((e) => enemyBodyId(e.id) === id);
      if (e) {
        e.vx += x;
        e.vy += y;
      }
    }
  }
  addPlayer(id: string, name = "Wayfarer"): Player {
    const existing = this.players.get(id);
    if (existing) return existing;
    if (this.playground && this.players.size)
      throw new Error("The standalone physics playground is solo-only");
    if (this.players.size >= MAX_PLAYERS) throw new Error("This expedition is full (8 players).");
    if (!/^[\w-]{1,80}$/.test(id)) throw new Error("Invalid player id");
    const color = [...Array(MAX_PLAYERS).keys()].find(
      (i) => ![...this.players.values()].some((p) => p.color === i),
    )!;
    const x = color * 15 - 20,
      y = 34;
    const p: Player = {
      id,
      name: name.slice(0, 24),
      color,
      x,
      y,
      px: x,
      py: y,
      vx: 0,
      vy: 0,
      radius: 6,
      facing: Math.PI / 2,
      energy: 100,
      pulseCooldown: 0,
      dashCooldown: 0,
      input: idleInput(),
      lastInteract: false,
      steps: 0,
    };
    this.players.set(id, p);
    this.adventure.onJoin(this, p);
    return p;
  }
  removePlayer(id: string): void {
    this.physical?.removeActor(playerBodyId(id));
    this.players.delete(id);
    this.adventure.removePlayer(id);
  }
  setInput(id: string, input: Partial<Input>): void {
    const p = this.players.get(id);
    if (!p) throw new Error("Unknown player");
    p.input = {
      x: typeof input.x === "number" && Number.isFinite(input.x) ? clamp(input.x, -1, 1) : 0,
      y: typeof input.y === "number" && Number.isFinite(input.y) ? clamp(input.y, -1, 1) : 0,
      dash: input.dash === true,
      pulse: input.pulse === true,
      interact: input.interact === true,
      attack: input.attack === true,
      lance: input.lance === true,
      nova: input.nova === true,
      potion: input.potion === true,
      aimX:
        typeof input.aimX === "number" && Number.isFinite(input.aimX)
          ? clamp(input.aimX, -1, 1)
          : 0,
      aimY:
        typeof input.aimY === "number" && Number.isFinite(input.aimY)
          ? clamp(input.aimY, -1, 1)
          : 0,
    };
  }
  setPopulation(count: number): void {
    if (!Number.isInteger(count) || count < 0 || count > MAX_NPCS)
      throw new Error(`Population must be an integer from 0 to ${MAX_NPCS}`);
    const players = [...this.players.values()],
      radius = this.populationRadius(count);
    for (let i = this.count; i < count; i++) {
      const anchor = players[i % Math.max(1, players.length)];
      this.spawn(i, anchor?.x ?? 0, anchor?.y ?? 0, radius);
    }
    this.count = count;
    this.physical?.trimPopulation(count);
  }
  private populationRadius(count = this.count): number {
    const regions: Player[] = [];
    for (const player of this.players.values()) {
      if (!regions.some((p) => (p.x - player.x) ** 2 + (p.y - player.y) ** 2 < 2200 ** 2))
        regions.push(player);
    }
    return 1100 * Math.max(1, Math.sqrt(count / (8192 * Math.max(1, regions.length))));
  }
  private spawn(i: number, x: number, y: number, radius = this.populationRadius()): void {
    const point = this.world.spawnPoint(hash(i, this.generation[i], this.world.seed), x, y, radius);
    this.x[i] = this.px[i] = point.x;
    this.y[i] = this.py[i] = point.y;
    this.vx[i] = this.vy[i] = 0;
    this.kind[i] = hash(i, this.generation[i], 32) % 3;
    this.attuned[i] = 0;
    this.near[i] = 0;
  }
  teleport(id: string, x: number, y: number): void {
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      Math.abs(x) > WORLD_LIMIT - 32 ||
      Math.abs(y) > WORLD_LIMIT - 32
    )
      throw new Error("Position is outside the world bounds");
    const p = this.players.get(id);
    if (!p) throw new Error("Unknown player");
    if (!this.world.walkable(x, y))
      throw new Error("Destination is blocked; choose walkable terrain");
    p.x = p.px = x;
    p.y = p.py = y;
    p.vx = p.vy = 0;
    this.physical?.teleport(playerBodyId(id), x, y);
    if (this.physical?.world.has(playerBodyId(id))) {
      const pose = this.physical.world.pose(playerBodyId(id));
      p.x = p.px = pose.x;
      p.y = p.py = pose.y;
    }
  }
  private emit(type: GameEvent["type"], p: Player, message: string): void {
    this.events.push({ tick: this.tick, type, x: p.x, y: p.y, player: p.id, message });
    if (this.events.length > 128) this.events.shift();
  }
  private interact(p: Player): void {
    for (const l of LANDMARKS) {
      if (distance(p.x, p.y, l.x, l.y) > 58) continue;
      if (l.kind === "camp") {
        p.energy = 100;
        this.emit("rest", p, "A moment of rest. Energy restored.");
        return;
      }
      if (this.beacons.has(l.id)) {
        this.emit("rest", p, "This beacon is already shining.");
        return;
      }
      if (this.shards < 3) {
        this.emit("rest", p, "Gather 3 light shards to kindle this beacon.");
        return;
      }
      this.shards -= 3;
      this.beacons.add(l.id);
      this.emit(
        "beacon",
        p,
        this.beacons.size === 3
          ? "Every beacon is alight. The forest remembers you."
          : `${l.name} is alight.`,
      );
      return;
    }
    const tx = Math.floor(p.x / TILE),
      ty = Math.floor(p.y / TILE);
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const key = `${tx + dx},${ty + dy}`;
        if (this.world.tile(tx + dx, ty + dy).decor === Decor.Crystal && !this.collected.has(key)) {
          this.collected.add(key);
          this.shards++;
          this.emit("shard", p, "A light shard, tucked into your satchel.");
          return;
        }
      }
    this.emit("rest", p, "No beacon or crystal nearby. Pulse near wisps to gather light.");
  }
  private pulse(p: Player): void {
    if (p.pulseCooldown > 0) return;
    p.pulseCooldown = 1.2;
    let found = 0;
    for (let i = 0; i < this.count; i++) {
      const dx = this.x[i] - p.x,
        dy = this.y[i] - p.y,
        d = Math.hypot(dx, dy);
      if (d > 100) continue;
      const force = (1 - d / 110) * 200;
      if (this.physical?.ownsAmbient(i))
        this.physical.world.velocityChange(
          ambientBodyId(i, this.generation[i]),
          (dx / Math.max(d, 1)) * force,
          (dy / Math.max(d, 1)) * force,
        );
      else {
        this.vx[i] += (dx / Math.max(d, 1)) * force;
        this.vy[i] += (dy / Math.max(d, 1)) * force;
      }
      if (this.kind[i] === 0 && !this.attuned[i]) {
        this.attuned[i] = 1;
        found++;
      }
    }
    this.shards += found;
    this.emit(
      "pulse",
      p,
      found
        ? `The wisps share ${found} light shard${found === 1 ? "" : "s"}.`
        : "A ripple of light through the trees.",
    );
  }
  step(steps = 1): void {
    if (this.movementBackend === "replica")
      throw new Error("Guest replicas do not advance authoritative physics");
    if (this.disposed) throw new Error("Simulation is disposed");
    if (!Number.isInteger(steps) || steps < 0 || steps > 36000)
      throw new Error("Step count must be 0–36000");
    const start = performance.now();
    for (let n = 0; n < steps; n++) this.fixedStep();
    this.metrics.stepMs = steps ? (performance.now() - start) / steps : 0;
  }
  private fixedStep(): void {
    this.tick++;
    this.metrics.contacts = 0;
    this.metrics.near = 0;
    this.metrics.far = 0;
    this.physical?.begin(this);
    const players = [...this.players.values()];
    for (const p of players) {
      const hero = this.adventure.hero(p.id),
        heroStats = this.adventure.stats(p.id, this.tick);
      p.px = p.x;
      p.py = p.y;
      p.pulseCooldown = Math.max(0, p.pulseCooldown - STEP);
      p.dashCooldown = Math.max(0, p.dashCooldown - STEP);
      p.energy = Math.min(100, p.energy + STEP * 17);
      let ix = hero.dead ? 0 : p.input.x,
        iy = hero.dead ? 0 : p.input.y;
      const length = Math.hypot(ix, iy);
      if (length > 1) {
        ix /= length;
        iy /= length;
      }
      if (length > 0) p.facing = Math.atan2(iy, ix);
      const wading = this.world.at(p.x, p.y).terrain === Terrain.Water;
      const speed = (wading ? 58 : 115) * heroStats.speed;
      let intentX = ix * speed,
        intentY = iy * speed;
      if (!this.physical) {
        p.vx += (intentX - p.vx) * 0.18;
        p.vy += (intentY - p.vy) * 0.18;
      }
      if (!hero.dead && p.input.dash && p.dashCooldown === 0 && p.energy >= 28) {
        if (!this.physical) {
          p.vx = Math.cos(p.facing) * 520;
          p.vy = Math.sin(p.facing) * 520;
        }
        p.energy -= 28;
        p.dashCooldown = 0.55;
        this.emit("dash", p, "");
        this.adventure.dash(this, p);
      }
      if (hero.dashUntil > this.tick && !hero.dead) {
        intentX = Math.cos(hero.dashAngle) * 490 * Math.max(1, heroStats.speed / 1.4);
        intentY = Math.sin(hero.dashAngle) * 490 * Math.max(1, heroStats.speed / 1.4);
        if (!this.physical) {
          p.vx = intentX;
          p.vy = intentY;
        }
      }
      if (this.physical)
        this.physical.world.motor(
          playerBodyId(p.id),
          intentX,
          intentY,
          hero.dashUntil > this.tick ? 1 : 0.18,
          this.physical.world.tick + Math.max(0, hero.hurtUntil - this.tick),
          hero.dead || hero.dashUntil > this.tick,
        );
      if (p.input.pulse && !hero.dead) this.pulse(p);
      if (p.input.interact && !p.lastInteract && !hero.dead && !this.adventure.interact(this, p))
        this.interact(p);
      p.lastInteract = p.input.interact;
      if (!this.physical) {
        this.metrics.contacts += moveBody(this.world, p, STEP);
        p.steps += distance(p.px, p.py, p.x, p.y);
      }
    }
    const spawnRadius = this.populationRadius();
    const recycleDistance2 = Math.max(2200, spawnRadius * 1.7) ** 2;
    const contactStride = this.count > 8192 ? 8 : 4;
    for (let i = 0; i < this.count; i++) {
      this.px[i] = this.x[i];
      this.py[i] = this.y[i];
      let nearest = Infinity;
      let focus: Player | undefined;
      for (const p of players) {
        const d = (p.x - this.x[i]) ** 2 + (p.y - this.y[i]) ** 2;
        if (d < nearest) {
          nearest = d;
          focus = p;
        }
      }
      // Each slot has a stable party anchor, so a distant guest receives wildlife even if
      // another player stays behind. Rebalancing is staggered over one second.
      if (players.length && this.tick % 60 === i % 60) {
        const anchor = players[i % players.length];
        if ((anchor.x - this.x[i]) ** 2 + (anchor.y - this.y[i]) ** 2 > recycleDistance2) {
          const oldGeneration = this.generation[i]++;
          this.spawn(i, anchor.x, anchor.y, spawnRadius);
          this.physical?.recycleAmbient(this, i, oldGeneration);
          continue;
        }
      }
      const near = nearest < 420 ** 2;
      this.near[i] = +near;
      if (near) this.metrics.near++;
      else this.metrics.far++;
      // Expensive steering and static contacts use 15 Hz outside player interest. Bodies still integrate at 60 Hz.
      const physicalOwner = this.physical?.ownsAmbient(i) ?? false;
      if (physicalOwner || near || (this.tick + i) % 4 === 0) {
        const interval = near ? 1 : 4;
        const angle =
          random(i, this.generation[i], this.world.seed) * 6.283 +
          Math.sin(this.tick / 210 + i * 0.72) * 1.8;
        const speed = this.kind[i] === 1 ? 13 : 8;
        let targetX = Math.cos(angle) * speed,
          targetY = Math.sin(angle) * speed;
        if (focus && nearest < 40 ** 2 && this.kind[i] === 1) {
          const inv = 50 / Math.max(Math.sqrt(nearest), 1);
          targetX += (this.x[i] - focus.x) * inv;
          targetY += (this.y[i] - focus.y) * inv;
        }
        if (physicalOwner) this.physical!.ambientIntent(this, i, targetX, targetY);
        else {
          this.vx[i] += (targetX - this.vx[i]) * 0.035 * interval;
          this.vy[i] += (targetY - this.vy[i]) * 0.035 * interval;
        }
      }
      if (physicalOwner) continue;
      this.a.x = this.x[i];
      this.a.y = this.y[i];
      this.a.vx = this.vx[i];
      this.a.vy = this.vy[i];
      this.a.radius = this.kind[i] === 1 ? 4 : 2.5;
      if (near || (this.tick + i) % contactStride === 0)
        this.metrics.contacts += moveBody(this.world, this.a, STEP);
      else {
        this.a.x += this.a.vx * STEP;
        this.a.y += this.a.vy * STEP;
      }
      this.x[i] = this.a.x;
      this.y[i] = this.a.y;
      this.vx[i] = this.a.vx;
      this.vy[i] = this.a.vy;
    }
    this.grid.build(this.x, this.y, this.count);
    // Impulse collisions are applied in stable id order, preserving deterministic replays.
    for (let i = 0; i < this.count; i++) {
      if (this.physical?.ownsAmbient(i)) continue;
      if (this.count > 8192 && !this.near[i] && (this.tick + i) % contactStride !== 0) continue;
      this.grid.query(this.x[i], this.y[i], 9, (j) => {
        if (this.physical?.ownsAmbient(j)) return;
        if (j === i) return;
        if (
          j < i &&
          !(
            this.count > 8192 &&
            this.near[i] &&
            !this.near[j] &&
            (this.tick + j) % contactStride !== 0
          )
        )
          return;
        if (Math.abs(this.x[i] - this.x[j]) > 9 || Math.abs(this.y[i] - this.y[j]) > 9) return;
        this.a.x = this.x[i];
        this.a.y = this.y[i];
        this.a.vx = this.vx[i];
        this.a.vy = this.vy[i];
        this.a.radius = this.kind[i] === 1 ? 4 : 2.5;
        this.b.x = this.x[j];
        this.b.y = this.y[j];
        this.b.vx = this.vx[j];
        this.b.vy = this.vy[j];
        this.b.radius = this.kind[j] === 1 ? 4 : 2.5;
        if (collideCircles(this.a, this.b)) {
          this.x[i] = this.a.x;
          this.y[i] = this.a.y;
          this.vx[i] = this.a.vx;
          this.vy[i] = this.a.vy;
          this.x[j] = this.b.x;
          this.y[j] = this.b.y;
          this.vx[j] = this.b.vx;
          this.vy[j] = this.b.vy;
          this.metrics.contacts++;
        }
      });
    }
    if (!this.physical)
      for (let a = 0; a < players.length; a++) {
        for (let b = a + 1; b < players.length; b++)
          if (collideCircles(players[a], players[b], 3, 3)) this.metrics.contacts++;
      }
    this.adventure.step(this);
    this.physical?.solve(this);
    this.playground?.step();
  }
  stateHash(): string {
    let h = checksum([this.world.seed, this.tick, this.count, this.shards]);
    for (const array of [
      this.x,
      this.y,
      this.vx,
      this.vy,
      this.kind,
      this.attuned,
      this.generation,
    ])
      h = checksum(array.subarray(0, this.count), h);
    for (const p of this.players.values()) {
      h = checksum(
        [
          p.x,
          p.y,
          p.vx,
          p.vy,
          p.energy,
          p.facing,
          p.pulseCooldown,
          p.dashCooldown,
          p.lastInteract ? 1 : 0,
          p.input.x,
          p.input.y,
          +p.input.dash,
          +p.input.pulse,
          +p.input.interact,
          +(p.input.attack ?? false),
          +(p.input.lance ?? false),
          +(p.input.nova ?? false),
          +(p.input.potion ?? false),
          p.input.aimX ?? 0,
          p.input.aimY ?? 0,
          p.steps,
          p.color,
        ],
        h,
      );
      h = checksum(
        Array.from(p.id + p.name, (c) => c.charCodeAt(0)),
        h,
      );
    }
    h = checksum(
      Array.from([...this.beacons].sort().join("|") + [...this.collected].sort().join("|"), (c) =>
        c.charCodeAt(0),
      ),
      h,
    );
    for (const patch of [...this.world.patches.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]))
      h = checksum(patch, h);
    const adventure = JSON.stringify(this.adventure.state);
    for (let i = 0; i < adventure.length; i++)
      h = Math.imul(h ^ adventure.charCodeAt(i), 16777619) >>> 0;
    if (this.playground) {
      const physics = JSON.stringify(this.playground.save());
      for (let i = 0; i < physics.length; i++)
        h = Math.imul(h ^ physics.charCodeAt(i), 16777619) >>> 0;
    }
    if (this.physical) {
      const physics = JSON.stringify(this.physical.save());
      for (let i = 0; i < physics.length; i++)
        h = Math.imul(h ^ physics.charCodeAt(i), 16777619) >>> 0;
    }
    h = checksum(
      Array.from(this.movementBackend, (c) => c.charCodeAt(0)),
      h,
    );
    return h.toString(16).padStart(8, "0");
  }
  observe() {
    return {
      version: ENGINE_VERSION,
      seed: this.world.seed,
      tick: this.tick,
      hash: this.stateHash(),
      population: this.count,
      players: [...this.players.values()].map(({ id, name, x, y, vx, vy, energy }) => ({
        id,
        name,
        x,
        y,
        vx,
        vy,
        energy,
        biome: this.world.biome(x, y),
      })),
      quest: {
        shards: this.shards,
        lit: [...this.beacons],
        total: 3,
        complete: this.beacons.size === 3,
      },
      streaming: {
        resident: this.world.chunks.size,
        limit: this.world.maxChunks,
        generated: this.world.generated,
        evicted: this.world.evicted,
        editedTiles: this.world.patches.size,
      },
      physics: { ...this.metrics },
      playground: this.playground?.inspect() ?? null,
      actorPhysics:
        this.physical?.inspect() ??
        (this.replicaPhysics
          ? {
              active: true,
              replica: true,
              backend: this.replicaPhysics.backend,
              landId: this.replicaPhysics.landId,
              bodyCount: this.replicaPhysics.world.bodies.length,
              props: this.physicalProps(),
              policies: this.replicaPhysics.world.policies,
            }
          : { active: false, backend: this.movementBackend }),
      events: this.events.slice(-8),
      adventure: this.adventure.observe(this.players.keys().next().value, this.tick),
    };
  }
  save(portable = false): SaveState {
    return {
      version: 2,
      seed: this.world.seed,
      tick: this.tick,
      count: this.count,
      shards: this.shards,
      beacons: [...this.beacons],
      collected: [...this.collected],
      patches: [...this.world.patches.values()].map((p) => [...p]),
      players: structuredClone([...this.players.values()]),
      events: structuredClone(this.events),
      adventure: this.adventure.save(),
      ...(this.playground ? { playground: this.playground.save() } : {}),
      ...(this.physical
        ? { actorPhysics: this.physical.save(portable) }
        : this.replicaPhysics
          ? { actorPhysics: structuredClone(this.replicaPhysics) }
          : { movementBackend: this.movementBackend as "legacy" | "replica" }),
      npcs: {
        x: Array.from(this.x.subarray(0, this.count)),
        y: Array.from(this.y.subarray(0, this.count)),
        vx: Array.from(this.vx.subarray(0, this.count)),
        vy: Array.from(this.vy.subarray(0, this.count)),
        kind: Array.from(this.kind.subarray(0, this.count)),
        attuned: Array.from(this.attuned.subarray(0, this.count)),
        generation: Array.from(this.generation.subarray(0, this.count)),
      },
    };
  }
  static restore(state: SaveState): Simulation {
    validateSave(state);
    const backend = state.version === 1 ? "rapier" : (state.movementBackend ?? "rapier");
    const sim = new Simulation(
      state.seed,
      0,
      state.actorPhysics || backend === "rapier" ? "replica" : backend,
    );
    if (state.patches?.length) sim.world.setPatches(state.patches);
    sim.tick = state.tick;
    sim.count = state.count;
    sim.shards = state.shards;
    sim.events.push(...structuredClone(state.events ?? []));
    for (const id of state.beacons) sim.beacons.add(id);
    for (const key of state.collected) sim.collected.add(key);
    for (const p of state.players) sim.players.set(p.id, structuredClone(p));
    if (state.adventure) sim.adventure.restore(state.adventure);
    for (const id of sim.players.keys()) sim.adventure.hero(id);
    sim.adventure.configureWorld(sim);
    for (const key of ["x", "y", "vx", "vy", "kind", "attuned", "generation"] as const)
      sim[key].set(state.npcs[key]);
    sim.px.set(sim.x);
    sim.py.set(sim.y);
    if (state.actorPhysics) {
      try {
        const next = AdventurePhysics.restore(sim, state.actorPhysics);
        sim.physical?.dispose();
        sim.physical = next;
        sim.movementBackend = "rapier";
      } catch (error) {
        sim.dispose();
        throw error;
      }
    } else if (backend === "rapier") {
      sim.physical = new AdventurePhysics(sim);
      sim.movementBackend = "rapier";
    }
    if (state.playground) {
      try {
        sim.playground = PhysicsWorld.restore(state.playground);
      } catch (error) {
        sim.dispose();
        throw error;
      }
    }
    return sim;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.playground?.dispose();
    this.playground = null;
    this.physical?.dispose();
    this.physical = null;
    this.replicaPhysics = null;
  }
}

export function validateSave(state: SaveState): void {
  if (
    !state ||
    ![1, 2].includes(state.version) ||
    !Number.isInteger(state.seed) ||
    state.seed < 0 ||
    state.seed > 0xffffffff ||
    !Number.isInteger(state.tick) ||
    state.tick < 0 ||
    !Number.isInteger(state.count) ||
    state.count < 0 ||
    state.count > MAX_NPCS ||
    !Number.isSafeInteger(state.shards) ||
    state.shards < 0 ||
    !Array.isArray(state.players) ||
    state.players.length > MAX_PLAYERS ||
    !Array.isArray(state.beacons) ||
    state.beacons.some((b) => !["north", "west", "south"].includes(b)) ||
    !Array.isArray(state.collected) ||
    state.collected.length > 100000 ||
    state.collected.some((s) => typeof s !== "string" || !/^-?\d+,-?\d+$/.test(s)) ||
    !state.npcs
  )
    throw new Error("Invalid save header");
  validatePatches(state.patches ?? []);
  if (
    state.events !== undefined &&
    (!Array.isArray(state.events) ||
      state.events.length > 128 ||
      state.events.some(
        (e) =>
          !e ||
          !Number.isSafeInteger(e.tick) ||
          e.tick < 0 ||
          e.tick > state.tick ||
          !["pulse", "dash", "shard", "beacon", "rest"].includes(e.type) ||
          ![e.x, e.y].every((n) => Number.isFinite(n) && Math.abs(n) <= WORLD_LIMIT) ||
          typeof e.player !== "string" ||
          !/^[\w-]{1,80}$/.test(e.player) ||
          typeof e.message !== "string" ||
          e.message.length > 256,
      ))
  )
    throw new Error("Invalid saved observation events");
  if (state.movementBackend !== undefined && !["legacy", "replica"].includes(state.movementBackend))
    throw new Error("Invalid movement backend");
  if (state.actorPhysics) {
    if (state.movementBackend) throw new Error("Invalid saved movement backend");
    validateAdventurePhysics(state.actorPhysics);
  }
  if (state.playground) {
    if (state.players.length > 1) throw new Error("Saved physics playground must be solo-only");
    validatePhysicsSnapshot(state.playground);
  }
  if (state.adventure) validateAdventure(state.adventure);
  const ids = new Set<string>();
  for (const p of state.players) {
    if (
      !p ||
      !/^[\w-]{1,80}$/.test(p.id) ||
      ids.has(p.id) ||
      typeof p.name !== "string" ||
      p.name.length > 24 ||
      [
        p.x,
        p.y,
        p.px,
        p.py,
        p.vx,
        p.vy,
        p.radius,
        p.facing,
        p.energy,
        p.pulseCooldown,
        p.dashCooldown,
        p.steps,
        p.color,
      ].some((n) => !Number.isFinite(n)) ||
      Math.abs(p.x) > WORLD_LIMIT ||
      Math.abs(p.y) > WORLD_LIMIT ||
      p.radius !== 6 ||
      Math.abs(p.vx) > 8000 ||
      Math.abs(p.vy) > 8000 ||
      p.energy < 0 ||
      p.energy > 100 ||
      !Number.isInteger(p.color) ||
      p.color < 0 ||
      p.color >= MAX_PLAYERS ||
      !p.input ||
      [p.input.x, p.input.y].some((n) => !Number.isFinite(n) || Math.abs(n) > 1) ||
      [p.input.dash, p.input.pulse, p.input.interact, p.lastInteract].some(
        (b) => typeof b !== "boolean",
      ) ||
      [p.input.attack, p.input.lance, p.input.nova, p.input.potion].some(
        (v) => v !== undefined && typeof v !== "boolean",
      ) ||
      [p.input.aimX, p.input.aimY].some(
        (v) => v !== undefined && (!Number.isFinite(v) || Math.abs(v) > 1),
      )
    )
      throw new Error("Invalid saved player");
    ids.add(p.id);
  }
  for (const key of ["x", "y", "vx", "vy", "kind", "attuned", "generation"] as const) {
    const values = state.npcs[key];
    if (
      !Array.isArray(values) ||
      values.length !== state.count ||
      values.some((v) => !Number.isFinite(v))
    )
      throw new Error(`Invalid NPC ${key}`);
    if ((key === "vx" || key === "vy") && values.some((v) => Math.abs(v) > 2047))
      throw new Error("NPC velocity out of bounds");
    if ((key === "x" || key === "y") && values.some((v) => Math.abs(v) > WORLD_LIMIT + 4096))
      throw new Error("NPC outside world bounds");
    if (
      (key === "kind" || key === "attuned" || key === "generation") &&
      values.some(
        (v) =>
          !Number.isInteger(v) ||
          v < 0 ||
          v > (key === "kind" ? 2 : key === "attuned" ? 1 : 0xffffffff),
      )
    )
      throw new Error("Invalid NPC attributes");
  }
  if (state.actorPhysics) {
    const snapshot = state.actorPhysics;
    if (
      !state.adventure ||
      snapshot.seed !== state.seed ||
      snapshot.run !== state.adventure.run ||
      snapshot.landId !== `land-${state.adventure.run}-${state.adventure.townLand}`
    )
      throw new Error("Physical land identity mismatch");
    if (snapshot.world.version === 4) {
      const game = new Adventure(state.adventure.seed);
      game.restore(state.adventure);
      const terrain = game.configureTerrain(new World(state.seed));
      if (terrain.seed !== state.seed) throw new Error("Game/physical world seed mismatch");
      terrain.setPatches(state.patches);
      validateSemanticTerrain(snapshot, terrain, state.adventure);
    }
    for (const sample of snapshot.ambient)
      if (sample.slot >= state.count || sample.generation !== state.npcs.generation[sample.slot])
        throw new Error("Ambient identity mismatch");
    if (snapshot.world.version === 4 && snapshot.appliedTransition === state.adventure.transition) {
      const expected = new Map<string, { x: number; y: number; radius: number; boss?: boolean }>();
      for (const p of state.players) expected.set(playerBodyId(p.id), p);
      for (const e of state.adventure.enemies) if (e.hp > 0) expected.set(enemyBodyId(e.id), e);
      for (const entry of snapshot.world.bodies) {
        if (!["player", "monster", "boss"].includes(entry.recipe.actorKind ?? "")) continue;
        const entity = expected.get(entry.recipe.id),
          p = entry.state!;
        if (
          !entity ||
          p.shape.kind !== "circle" ||
          p.shape.radius !== entity.radius ||
          p.actorKind !==
            (entry.recipe.id.startsWith("player-") ? "player" : entity.boss ? "boss" : "monster") ||
          Math.hypot(p.x - entity.x, p.y - entity.y) > 0.001
        )
          throw new Error("Physical/game actor pose mismatch or invalid blueprint");
        expected.delete(entry.recipe.id);
      }
      if (expected.size) throw new Error("Missing physical actor");
    }
  }
}
