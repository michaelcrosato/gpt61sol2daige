import { MAX_NPCS } from "../engine/limits.ts";
import type { Simulation } from "../engine/simulation.ts";
import { type TerrainPatch, validatePatches, WORLD_LIMIT, type World } from "../engine/world.ts";
import { areaRecipe } from "../game/content.ts";
import type { Enemy } from "../game/types.ts";
import {
  type PolicyCheckpoint,
  PolicyController,
  type PolicyLayout,
  type PolicyTransaction,
} from "./policies.ts";
import { PhysicsWorld, validateBody, validatePhysicsSnapshot } from "./runtime.ts";
import { type ChunkCoordinate, occupiedChunks, TerrainRegistry, terrainRecipe } from "./terrain.ts";
import { type BodyPose, type BodyRecipe, type PhysicsSnapshot, RAPIER_VERSION } from "./types.ts";

export const playerBodyId = (id: string) => `player-${id}`;
export const enemyBodyId = (id: number) => `enemy-${id}`;
export const ambientBodyId = (slot: number, generation: number) => `ambient-${slot}-${generation}`;
interface AmbientSample {
  slot: number;
  generation: number;
  x: number;
  y: number;
  areaId: string;
  regions: string[];
  owner: "ambient" | "rapier";
}
/** Semantic state for M04: stable identities and blueprints, never network Rapier handles. */
export interface PhysicalEntityState {
  id: string;
  landId: string;
  areaId: string;
  blueprintRevision: 1;
  blueprint: BodyRecipe;
  pose: { x: number; y: number; angle: number };
  velocity: { x: number; y: number; angular: number };
  status: { frozen: boolean; reactivationBlocked: boolean };
  consequences: { destroyed: boolean; claimed: boolean; durability?: number };
  regions: string[];
}
interface LandArchive {
  id: string;
  policies: PolicyCheckpoint;
  props: BodyPose[];
  patches: TerrainPatch[];
}
interface NavigationState {
  id: number;
  x: number;
  y: number;
  stuckTicks: number;
  turn: number;
}
export interface AdventurePhysicsSnapshot {
  version: 1;
  backend: typeof RAPIER_VERSION;
  landId: string;
  run: number;
  seed: number;
  world: PhysicsSnapshot;
  terrainChunks: ChunkCoordinate[];
  ambient: AmbientSample[];
  archives: LandArchive[];
  navigation: NavigationState[];
  appliedTransition: number;
}
function layout(sim: Simulation): PolicyLayout {
  const s = sim.adventure.state,
    landId = `land-${s.run}-${s.townLand}`;
  const areas = Array.from({ length: 4 }, (_, i) => areaRecipe(s.seed, s.townLand * 4 + i + 1));
  return {
    lands: [{ id: landId, values: {} }],
    areas: [
      { id: "town", landId, values: { crowdContacts: false, propBlocking: false } },
      { id: "wilderness", landId, values: {} },
      ...areas.map((r) => ({ id: `area-${r.index}`, landId, values: {} })),
    ],
    regions: areas.flatMap((r) => [
      {
        id: `quiet-${r.index}`,
        areaId: `area-${r.index}`,
        priority: 10,
        shape: { kind: "rectangle" as const, x: r.x - 170, y: r.y - 150, width: 110, height: 90 },
        values: { crowdContacts: false, ambientPhysics: false },
      },
      {
        id: `reactive-${r.index}`,
        areaId: `area-${r.index}`,
        priority: 10,
        shape: { kind: "circle" as const, x: r.x + 75, y: r.y - 110, radius: 70 },
        values: { crowdContacts: true, ambientPhysics: true },
      },
    ]),
  };
}
function freshPolicies(sim: Simulation, previous?: PolicyCheckpoint): PolicyCheckpoint {
  const profiles = layout(sim);
  return {
    state: {
      version: 1,
      revision: 0,
      masterWorldReactions: previous?.state.masterWorldReactions ?? true,
      boundaryMargin: previous?.state.boundaryMargin ?? 1,
      authored: structuredClone(profiles),
      profiles,
      overrides: [],
    },
    pending: [],
  };
}
/** One land world. Gameplay produces intents; solved poses are copied out exactly once. */
export class AdventurePhysics {
  world: PhysicsWorld;
  landId: string;
  private run: number;
  private seed: number;
  private terrain = new TerrainRegistry();
  private ambient = new Map<number, AmbientSample>();
  private archives = new Map<string, LandArchive>();
  private actors = new Set<string>();
  private navigation = new Map<number, NavigationState>();
  private sourceWorld: World;
  private appliedTransition = -1;
  constructor(sim: Simulation) {
    this.sourceWorld = sim.world;
    this.run = sim.adventure.state.run;
    this.seed = sim.world.seed;
    this.landId = `land-${this.run}-${sim.adventure.state.townLand}`;
    this.world = new PhysicsWorld(undefined, { scene: "adventure", policies: freshPolicies(sim) });
    this.spawnProps(sim);
  }
  areaAt(sim: Simulation, x: number, y: number): string {
    const s = sim.adventure.state;
    if (Math.hypot(x, y) < 265) return "town";
    for (let i = 0; i < 4; i++) {
      const r =
        s.mode === "area" && s.recipe.index === s.townLand * 4 + i + 1
          ? s.recipe
          : areaRecipe(s.seed, s.townLand * 4 + i + 1);
      if (Math.hypot(x - r.x, y - r.y) < r.radius + 35) return `area-${r.index}`;
    }
    return "wilderness";
  }
  private spawnProps(sim: Simulation, archived?: BodyPose[]): void {
    if (archived) {
      for (const pose of archived) {
        this.world.spawn(pose);
        if (!pose.frozen) this.world.motion(pose.id, pose.vx, pose.vy, pose.angularVelocity);
      }
      return;
    }
    for (let i = 0; i < 4; i++) {
      const r = areaRecipe(sim.adventure.state.seed, sim.adventure.state.townLand * 4 + i + 1);
      for (let n = 0; n < 4; n++)
        this.world.spawn({
          id: `crate-${r.index}-${n}`,
          motion: "dynamic",
          role: "prop",
          areaId: `area-${r.index}`,
          shape: { kind: "box", width: 22, height: 22 },
          x: r.x - 55 + (n % 2) * 25,
          y: r.y + 40 + Math.floor(n / 2) * 25,
          mass: 1.2,
          friction: 0.4,
          restitution: 0.05,
          damping: 2,
          consequences: { destroyed: false, claimed: false, durability: 100 },
        });
      this.world.spawn({
        id: `wheel-${r.index}`,
        motion: "dynamic",
        role: "prop",
        areaId: `area-${r.index}`,
        shape: { kind: "circle", radius: 10 },
        x: r.x - 85,
        y: r.y + 40,
        mass: 0.7,
        damping: 1,
        consequences: { destroyed: false, claimed: false, durability: 100 },
      });
    }
  }
  synchronizeLand(sim: Simulation): void {
    const id = `land-${sim.adventure.state.run}-${sim.adventure.state.townLand}`;
    if (id === this.landId && this.seed === sim.world.seed) return;
    this.world.boundary();
    const previous = this.world.policyState();
    const props = this.props();
    if (sim.adventure.state.run === this.run)
      this.archives.set(this.landId, {
        id: this.landId,
        policies: { state: previous.state, pending: previous.pending },
        props,
        patches: [...this.sourceWorld.patches.values()].map((p) => [...p]),
      });
    else this.archives.clear();
    const archive = this.archives.get(id);
    this.archives.delete(id);
    if (archive) {
      archive.policies.state.masterWorldReactions = previous.state.masterWorldReactions;
      archive.policies.state.boundaryMargin = previous.state.boundaryMargin;
    }
    this.world.dispose();
    this.world = new PhysicsWorld(undefined, {
      scene: "adventure",
      policies: archive?.policies ?? freshPolicies(sim, previous),
    });
    this.landId = id;
    this.run = sim.adventure.state.run;
    this.seed = sim.world.seed;
    this.sourceWorld = sim.world;
    if (archive) sim.world.setPatches(archive.patches);
    this.terrain = new TerrainRegistry();
    this.ambient.clear();
    this.actors.clear();
    this.navigation.clear();
    this.spawnProps(sim, archive?.props);
  }
  private actor(
    id: string,
    kind: NonNullable<BodyRecipe["actorKind"]>,
    x: number,
    y: number,
    radius: number,
    mass: number,
    areaId: string,
  ): void {
    if (!this.world.has(id)) {
      this.world.spawn({
        id,
        motion: "dynamic",
        role: "actor",
        actorKind: kind,
        shape: { kind: "circle", radius },
        x,
        y,
        mass,
        areaId,
        friction: 0,
        restitution: 0,
        damping: 0,
      });
      this.world.motor(id, 0, 0);
    }
    this.world.bindArea(id, areaId);
  }
  begin(sim: Simulation): void {
    this.synchronizeLand(sim);
    this.world.boundary();
    const wanted = new Set<string>();
    for (const p of sim.players.values()) {
      const id = playerBodyId(p.id);
      wanted.add(id);
      this.actor(id, "player", p.x, p.y, p.radius, 2.5, this.areaAt(sim, p.x, p.y));
    }
    for (const e of sim.adventure.state.enemies)
      if (e.hp > 0) {
        const id = enemyBodyId(e.id);
        wanted.add(id);
        this.actor(
          id,
          e.boss ? "boss" : "monster",
          e.x,
          e.y,
          e.radius,
          e.boss ? 8 : 1,
          this.areaAt(sim, e.x, e.y),
        );
      }
    for (const id of this.actors) if (!wanted.has(id)) this.world.remove(id);
    this.actors = wanted;
    this.appliedTransition = sim.adventure.state.transition;
    const alive = new Set(sim.adventure.state.enemies.filter((e) => e.hp > 0).map((e) => e.id));
    for (const id of this.navigation.keys()) if (!alive.has(id)) this.navigation.delete(id);
    for (const [slot, sample] of this.ambient)
      if (slot >= sim.count || sample.generation !== sim.generation[slot]) {
        this.world.remove(ambientBodyId(slot, sample.generation));
        this.ambient.delete(slot);
      }
    for (let i = 0; i < sim.count; i++) {
      const areaId = this.areaAt(sim, sim.x[i], sim.y[i]),
        previous = this.ambient.get(i);
      const policy = this.world.policyAt(
        areaId,
        sim.x[i],
        sim.y[i],
        previous?.areaId === areaId ? previous.regions : [],
      );
      const owner = policy.effective.ambientPhysics ? "rapier" : "ambient",
        id = ambientBodyId(i, sim.generation[i]);
      if (owner === "rapier") {
        this.actor(id, "ambient", sim.x[i], sim.y[i], sim.kind[i] === 1 ? 4 : 2.5, 0.3, areaId);
        if (previous?.owner !== "rapier") {
          this.world.motor(id, sim.vx[i], sim.vy[i], 0.035);
          this.world.motion(id, sim.vx[i], sim.vy[i]);
        }
      } else if (this.world.has(id)) {
        const pose = this.world.pose(id);
        sim.x[i] = pose.x;
        sim.y[i] = pose.y;
        sim.vx[i] = pose.vx;
        sim.vy[i] = pose.vy;
        this.world.remove(id);
      }
      this.ambient.set(i, {
        slot: i,
        generation: sim.generation[i],
        x: sim.x[i],
        y: sim.y[i],
        areaId,
        regions: policy.regions,
        owner,
      });
    }
    // Newly bound actors must resolve their actual area's policy before this tick's motor.
    this.world.boundary();
    this.synchronizeTerrain(sim);
  }
  synchronizeTerrain(sim: Simulation): void {
    const points = [...sim.players.values()].map((p) => ({ x: p.x, y: p.y, radius: 80 }));
    for (const e of sim.adventure.state.enemies)
      if (e.hp > 0) points.push({ x: e.x, y: e.y, radius: 80 });
    for (const p of this.props()) points.push({ x: p.x, y: p.y, radius: 40 });
    for (const sample of this.ambient.values())
      if (sample.owner === "rapier")
        points.push({ x: sim.x[sample.slot], y: sim.y[sample.slot], radius: 32 });
    this.terrain.synchronize(
      sim.world,
      this.world,
      this.landId,
      (x, y) => this.areaAt(sim, x, y),
      occupiedChunks(points),
    );
  }
  ownsAmbient(slot: number): boolean {
    return this.ambient.get(slot)?.owner === "rapier";
  }
  trimPopulation(count: number): void {
    for (const [slot, sample] of this.ambient)
      if (slot >= count) {
        this.world.remove(ambientBodyId(slot, sample.generation));
        this.ambient.delete(slot);
      }
  }
  ambientIntent(sim: Simulation, slot: number, x: number, y: number): void {
    this.world.motor(ambientBodyId(slot, sim.generation[slot]), x, y, 0.035);
  }
  enemyIntent(sim: Simulation, enemy: Enemy, x: number, y: number, steer = true): void {
    const id = enemyBodyId(enemy.id);
    this.actor(
      id,
      enemy.boss ? "boss" : "monster",
      enemy.x,
      enemy.y,
      enemy.radius,
      enemy.boss ? 8 : 1,
      this.areaAt(sim, enemy.x, enemy.y),
    );
    if (steer && Math.hypot(x, y) > 0) {
      const nav = this.navigation.get(enemy.id) ?? {
        id: enemy.id,
        x: enemy.x,
        y: enemy.y,
        stuckTicks: 0,
        turn: enemy.id % 2 ? 1 : -1,
      };
      if (Math.hypot(enemy.x - nav.x, enemy.y - nav.y) < 0.12) nav.stuckTicks++;
      else nav.stuckTicks = Math.max(0, nav.stuckTicks - 2);
      nav.x = enemy.x;
      nav.y = enemy.y;
      if (nav.stuckTicks >= 120) {
        nav.turn *= -1;
        nav.stuckTicks = 0;
      }
      const speed = Math.hypot(x, y),
        angle = Math.atan2(y, x),
        reach = Math.max(35, enemy.radius * 2 + 20);
      const straight = this.world.obstacleFraction(
        id,
        Math.cos(angle) * reach,
        Math.sin(angle) * reach,
        enemy.radius + 1,
      );
      if (straight < 1 || nav.stuckTicks > 20) {
        let best = -Infinity,
          direction = angle;
        for (const offset of [
          Math.PI / 6,
          Math.PI / 3,
          Math.PI / 2,
          Math.PI * 0.75,
          Math.PI,
          -Math.PI / 6,
          -Math.PI / 3,
          -Math.PI / 2,
          -Math.PI * 0.75,
        ]) {
          const candidate = angle + offset * nav.turn,
            fraction = this.world.obstacleFraction(
              id,
              Math.cos(candidate) * reach,
              Math.sin(candidate) * reach,
              enemy.radius + 1,
            );
          const score = fraction * 3 + Math.cos(offset) + (offset > 0 ? 0.05 : 0);
          if (score > best) {
            best = score;
            direction = candidate;
          }
        }
        x = Math.cos(direction) * speed;
        y = Math.sin(direction) * speed;
      }
      this.navigation.set(enemy.id, nav);
    }
    this.world.motor(
      id,
      x,
      y,
      enemy.phase === "charge" ? 1 : 0.1,
      this.world.tick + Math.max(0, enemy.hurtUntil - sim.tick),
    );
  }
  recycleAmbient(sim: Simulation, slot: number, oldGeneration: number): void {
    this.world.remove(ambientBodyId(slot, oldGeneration));
    this.ambient.delete(slot);
    const areaId = this.areaAt(sim, sim.x[slot], sim.y[slot]),
      policy = this.world.policyAt(areaId, sim.x[slot], sim.y[slot]);
    const owner = policy.effective.ambientPhysics ? "rapier" : "ambient";
    if (owner === "rapier")
      this.actor(
        ambientBodyId(slot, sim.generation[slot]),
        "ambient",
        sim.x[slot],
        sim.y[slot],
        sim.kind[slot] === 1 ? 4 : 2.5,
        0.3,
        areaId,
      );
    this.ambient.set(slot, {
      slot,
      generation: sim.generation[slot],
      x: sim.x[slot],
      y: sim.y[slot],
      areaId,
      regions: policy.regions,
      owner,
    });
  }
  solve(sim: Simulation): void {
    // Combat can spawn/remove/teleport after the initial boundary.
    this.synchronizeLand(sim);
    for (const e of sim.adventure.state.enemies)
      if (e.hp > 0 && !this.world.has(enemyBodyId(e.id))) {
        this.actor(
          enemyBodyId(e.id),
          e.boss ? "boss" : "monster",
          e.x,
          e.y,
          e.radius,
          e.boss ? 8 : 1,
          this.areaAt(sim, e.x, e.y),
        );
        this.actors.add(enemyBodyId(e.id));
      }
    for (const e of sim.adventure.state.enemies)
      if (e.hp <= 0) this.world.remove(enemyBodyId(e.id));
    this.synchronizeTerrain(sim);
    const contacts = this.world.contacts;
    this.world.step(true);
    sim.metrics.contacts += this.world.contacts - contacts;
    for (const p of sim.players.values())
      if (this.world.has(playerBodyId(p.id))) {
        const pose = this.world.pose(playerBodyId(p.id));
        p.x = pose.x;
        p.y = pose.y;
        p.vx = pose.vx;
        p.vy = pose.vy;
        p.steps += Math.hypot(p.x - p.px, p.y - p.py);
      }
    for (const e of sim.adventure.state.enemies)
      if (e.hp > 0 && this.world.has(enemyBodyId(e.id))) {
        const pose = this.world.pose(enemyBodyId(e.id));
        e.x = pose.x;
        e.y = pose.y;
        e.vx = pose.vx;
        e.vy = pose.vy;
      }
    for (const sample of this.ambient.values())
      if (sample.owner === "rapier") {
        const i = sample.slot,
          pose = this.world.pose(ambientBodyId(i, sim.generation[i]));
        sim.x[i] = pose.x;
        sim.y[i] = pose.y;
        sim.vx[i] = pose.vx;
        sim.vy[i] = pose.vy;
      }
  }
  teleport(id: string, x: number, y: number): void {
    if (this.world.has(id)) this.world.place(id, x, y);
  }
  configure(transaction: PolicyTransaction) {
    // Even currently unoccupied adventure profiles are required for subsequent entry/handover.
    const checkpoint = this.world.policyState();
    const preview = new PolicyController({ state: checkpoint.state, pending: checkpoint.pending });
    preview.configure(transaction);
    preview.apply();
    for (const profile of this.world.policyState().state.authored.areas)
      preview.resolve(profile.id, 0, 0);
    return this.world.configure(transaction);
  }
  props(): BodyPose[] {
    return this.world
      .ids()
      .filter((id) => id.startsWith("crate-") || id.startsWith("wheel-") || id.startsWith("prop-"))
      .map((id) => this.world.pose(id));
  }
  inspect() {
    const state = this.world.inspect();
    return {
      ...state,
      active: true,
      landId: this.landId,
      terrainChunks: this.terrain.save(),
      movementOwners: {
        actors: this.actors.size,
        rapierAmbient: [...this.ambient.values()].filter((s) => s.owner === "rapier").length,
        ambient: [...this.ambient.values()].filter((s) => s.owner === "ambient").length,
      },
      props: this.props(),
    };
  }
  entities(): PhysicalEntityState[] {
    return this.world.poses().map((p) => ({
      id: p.id,
      landId: this.landId,
      areaId: p.areaId!,
      blueprintRevision: 1,
      blueprint: { ...p },
      pose: { x: p.x, y: p.y, angle: p.angle },
      velocity: { x: p.vx, y: p.vy, angular: p.angularVelocity },
      status: { frozen: p.frozen, reactivationBlocked: p.reactivationBlocked },
      consequences: p.consequences ?? { destroyed: false, claimed: false },
      regions: p.policy.regions,
    }));
  }
  save(): AdventurePhysicsSnapshot {
    return {
      version: 1,
      backend: RAPIER_VERSION,
      landId: this.landId,
      run: this.run,
      seed: this.seed,
      world: this.world.save(),
      terrainChunks: this.terrain.save(),
      ambient: structuredClone([...this.ambient.values()]),
      archives: structuredClone([...this.archives.values()]),
      navigation: structuredClone([...this.navigation.values()]),
      appliedTransition: this.appliedTransition,
    };
  }
  static restore(sim: Simulation, snapshot: AdventurePhysicsSnapshot): AdventurePhysics {
    validateAdventurePhysics(snapshot, sim);
    const result = new AdventurePhysics(sim);
    result.world.dispose();
    try {
      result.world = PhysicsWorld.restore(snapshot.world);
      result.landId = snapshot.landId;
      result.run = snapshot.run;
      result.seed = snapshot.seed;
      result.terrain.restore(sim.world, result.world, snapshot.terrainChunks);
      result.ambient = new Map(snapshot.ambient.map((s) => [s.slot, structuredClone(s)]));
      result.archives = new Map(snapshot.archives.map((s) => [s.id, structuredClone(s)]));
      result.navigation = new Map(snapshot.navigation.map((s) => [s.id, structuredClone(s)]));
      result.appliedTransition = snapshot.appliedTransition;
      result.actors = new Set(
        result.world.ids().filter((id) => id.startsWith("player-") || id.startsWith("enemy-")),
      );
      for (const id of result.world.ids()) {
        const pose = result.world.pose(id);
        if (pose.role === "terrain") {
          const tx = Math.floor(pose.x / 16),
            ty = Math.floor(pose.y / 16),
            expected = terrainRecipe(
              sim.world,
              result.landId,
              result.areaAt(sim, pose.x, pose.y),
              tx,
              ty,
            );
          if (
            !expected ||
            expected.id !== id ||
            JSON.stringify(expected.shape) !== JSON.stringify(pose.shape) ||
            expected.x !== pose.x ||
            expected.y !== pose.y
          )
            throw new Error("Terrain recipe mismatch");
        }
      }
      if (snapshot.appliedTransition === sim.adventure.state.transition) {
        const expected = new Map<string, { x: number; y: number }>();
        for (const p of sim.players.values()) expected.set(playerBodyId(p.id), p);
        for (const e of sim.adventure.state.enemies)
          if (e.hp > 0) expected.set(enemyBodyId(e.id), e);
        for (const id of result.actors)
          if (!expected.has(id)) throw new Error("Ghost physical actor");
        for (const [id, entity] of expected) {
          if (!result.world.has(id)) throw new Error("Missing physical actor");
          const pose = result.world.pose(id);
          if (Math.hypot(pose.x - entity.x, pose.y - entity.y) > 0.001)
            throw new Error("Physical/game actor pose mismatch");
        }
      }
      return result;
    } catch (error) {
      result.world.dispose();
      throw error;
    }
  }
  dispose(): void {
    this.world.dispose();
  }
}
export function validateAdventurePhysics(
  snapshot: AdventurePhysicsSnapshot,
  sim?: Simulation,
): void {
  if (
    !snapshot ||
    snapshot.version !== 1 ||
    snapshot.backend !== RAPIER_VERSION ||
    !/^land-\d+-\d+$/.test(snapshot.landId) ||
    !Number.isSafeInteger(snapshot.run) ||
    snapshot.run < 1 ||
    !Number.isInteger(snapshot.seed) ||
    snapshot.seed < 0 ||
    snapshot.seed > 0xffffffff ||
    snapshot.world?.scene !== "adventure" ||
    !Array.isArray(snapshot.terrainChunks) ||
    !Array.isArray(snapshot.ambient) ||
    snapshot.ambient.length > MAX_NPCS ||
    !Array.isArray(snapshot.archives)
  )
    throw new Error("Invalid adventure physics envelope");
  validatePhysicsSnapshot(snapshot.world);
  if (!Number.isInteger(snapshot.appliedTransition) || snapshot.appliedTransition < -1)
    throw new Error("Invalid physical transition sample");
  const entries = new Map(snapshot.world.bodies.map((entry) => [entry.recipe.id, entry]));
  const controller = new PolicyController(snapshot.world.policies);
  if (
    !Array.isArray(snapshot.navigation) ||
    snapshot.navigation.some(
      (s) =>
        !s ||
        !Number.isSafeInteger(s.id) ||
        ![s.x, s.y].every(Number.isFinite) ||
        !Number.isInteger(s.stuckTicks) ||
        s.stuckTicks < 0 ||
        ![-1, 1].includes(s.turn),
    )
  )
    throw new Error("Invalid navigation state");
  const slots = new Set<number>();
  const ambientIds = new Set<string>();
  for (const s of snapshot.ambient) {
    if (
      !s ||
      !Number.isInteger(s.slot) ||
      s.slot < 0 ||
      s.slot >= MAX_NPCS ||
      slots.has(s.slot) ||
      !Number.isInteger(s.generation) ||
      s.generation < 0 ||
      s.generation > 0xffffffff ||
      ![s.x, s.y].every((n) => Number.isFinite(n) && Math.abs(n) <= WORLD_LIMIT) ||
      !["ambient", "rapier"].includes(s.owner) ||
      !Array.isArray(s.regions) ||
      typeof s.areaId !== "string"
    )
      throw new Error("Invalid ambient ownership sample");
    slots.add(s.slot);
    const id = ambientBodyId(s.slot, s.generation),
      exists = entries.has(id);
    ambientIds.add(id);
    if (exists !== (s.owner === "rapier")) throw new Error("Ambient movement owner mismatch");
    if (sim && (s.slot >= sim.count || s.generation !== sim.generation[s.slot]))
      throw new Error("Ambient identity mismatch");
    const resolved = controller.resolve(s.areaId, s.x, s.y, s.regions);
    if (
      JSON.stringify(resolved.regions) !== JSON.stringify(s.regions) ||
      resolved.effective.ambientPhysics !== (s.owner === "rapier")
    )
      throw new Error("Ambient policy/owner mismatch");
  }
  for (const entry of entries.values())
    if (entry.recipe.actorKind === "ambient" && !ambientIds.has(entry.recipe.id))
      throw new Error("Unowned physical ambient body");
  const chunks = new Set<string>();
  for (const c of snapshot.terrainChunks) {
    if (
      !Array.isArray(c) ||
      c.length !== 2 ||
      !c.every((n) => Number.isInteger(n) && Math.abs(n) <= WORLD_LIMIT / 256 + 1) ||
      chunks.has(c.join(","))
    )
      throw new Error("Invalid occupied chunks");
    chunks.add(c.join(","));
  }
  if (
    sim &&
    (snapshot.landId !== `land-${sim.adventure.state.run}-${sim.adventure.state.townLand}` ||
      snapshot.seed !== sim.world.seed ||
      snapshot.run !== sim.adventure.state.run)
  )
    throw new Error("Physical land identity mismatch");
  const archives = new Set<string>();
  for (const a of snapshot.archives) {
    if (
      !a ||
      !/^land-\d+-\d+$/.test(a.id) ||
      a.id === snapshot.landId ||
      archives.has(a.id) ||
      !Array.isArray(a.props)
    )
      throw new Error("Invalid land archive");
    archives.add(a.id);
    new PolicyController(a.policies);
    validatePatches(a.patches);
    for (const p of a.props) {
      validateBody(p, true);
      if (
        !p ||
        p.role !== "prop" ||
        ![p.x, p.y, p.angle, p.vx, p.vy, p.angularVelocity].every(Number.isFinite)
      )
        throw new Error("Invalid archived prop");
    }
  }
}
