import { MAX_NPCS } from "../engine/limits.ts";
import type { Simulation } from "../engine/simulation.ts";
import {
  Terrain,
  type TerrainPatch,
  validatePatches,
  WORLD_LIMIT,
  World,
} from "../engine/world.ts";
import {
  type AreaRecipe,
  areaRecipe,
  mechanicLayout,
  npcPosition,
  TOWN_NPCS,
} from "../game/content.ts";
import { ARMOR, ARMOR_RULES, type BossPlan } from "../game/encounters.ts";
import type { AttackTeam } from "../game/interactions.ts";
import { enemyPose, rigOf } from "../game/rigs.ts";
import type { AdventureState, Enemy } from "../game/types.ts";
import {
  clearingProps,
  damageStage,
  FAMILIES,
  fracture,
  legacyBlueprint,
  PALETTES,
  PROP_FAMILIES,
  type PropFamily,
  propRecipe,
  shapeReach,
} from "./blueprints.ts";
import {
  CombatPhysics,
  type CombatPhysicsState,
  GRAB_MAX_MASS,
  isPropId,
  lootBodyId,
} from "./combat.ts";
import {
  armorPieces,
  type GeneratedArea,
  generatedArea,
  type RealizedEncounter,
  validateRealized,
  waterTerrain,
} from "./encounters.ts";
import { isMaterial, MATERIALS, type MaterialId, materialDamage } from "./materials.ts";
import {
  areaMechanisms,
  MechanismPhysics,
  type MechanismState,
  onDeck,
  validateMechanisms,
} from "./mechanisms.ts";
import {
  type PolicyCheckpoint,
  PolicyController,
  type PolicyLayout,
  type PolicyTransaction,
  presetValues,
  type RegionProfile,
  reauthorLayout,
} from "./policies.ts";
import {
  areaReactions,
  type ReactionArchive,
  type ReactionHost,
  ReactionPhysics,
  type ReactionState,
  type Stimulus,
  validateReactions,
} from "./reactions.ts";
import {
  FOLIAGE_FAMILIES,
  RigPhysics,
  type RigState,
  remainsRecipes,
  validateRigState,
} from "./rigs.ts";
import {
  isRemains,
  jointAnchors,
  PhysicsWorld,
  passesActors,
  upgradePolicySamples,
  validateAssembly,
  validateBody,
  validateJointEntry,
  validatePhysicsSnapshot,
} from "./runtime.ts";
import {
  areaShowcase,
  BLOOM_SNARE,
  FREIGHT_PAD,
  LASH,
  type Restraint,
  ShowcasePhysics,
  type ShowcaseState,
  THORNBURST,
  TOWN_MARKET,
  townScene,
  validateShowcase,
} from "./showcase.ts";
import {
  type ChunkCoordinate,
  occupiedChunks,
  solidTerrain,
  TerrainRegistry,
  terrainRecipe,
} from "./terrain.ts";
import {
  type AssemblyRecipe,
  type BodyPose,
  type BodyRecipe,
  type JointEntry,
  type PhysicsSnapshot,
  RAPIER_VERSION,
} from "./types.ts";

export const playerBodyId = (id: string) => `player-${id}`;
export const enemyBodyId = (id: number) => `enemy-${id}`;
export const ambientBodyId = (slot: number, generation: number) => `ambient-${slot}-${generation}`;
/** M09 townsfolk bodies (town mode only). */
export const npcBodyId = (id: string) => `npc-${id}`;
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
  /** M05: destroyed parents never respawn when the land is restored. */
  destroyed: DestroyedRecord[];
  /** M07 (envelope 5): assemblies, every joint's state and mechanism state of the land. */
  assemblies?: AssemblyRecipe[];
  joints?: JointEntry[];
  mechanisms?: MechanismState;
  /** M08: statuses, surfaces, fields and pending reactions, with relative timers. */
  reactions?: ReactionArchive;
  /** M10 (envelope 8): showcase state; its presence means the land's M10 scene is authored. */
  showcase?: ShowcaseState;
  /** M11 (envelope 9): whether the land was built with the encounter grammar, and its manifests. */
  encounters?: EncounterState;
}
/**
 * M11: a land built with the encounter grammar carries generated modules in its generated
 * areas (index > 8); a land saved before M11 keeps its earlier content (`grammar` false) and
 * nothing is ever generated over it.
 */
export interface EncounterState {
  grammar: boolean;
  /** Realized manifests of the land's generated areas, as built. */
  areas: RealizedEncounter[];
}
/** Persistent destruction fact. The parent body is gone; its pieces are ordinary props. */
export interface DestroyedRecord {
  id: string;
  family: PropFamily;
  palette: number;
  material: MaterialId;
  x: number;
  y: number;
  angle: number;
  tick: number;
  owner: string;
  cause: string;
  /** Party gold granted exactly once, when the object broke. */
  reward: number;
  pieces: string[];
}
/** One attack's effect on one prop, for gameplay rewards and presentation feedback. */
export interface PropHit {
  id: string;
  family: PropFamily;
  material: MaterialId;
  x: number;
  y: number;
  /** Durability percentage removed by this hit. */
  damage: number;
  /** Material resistance absorbed the whole hit. */
  resisted: boolean;
  /** The target's resolved destruction policy is off: feedback only, no durability change. */
  protectedByPolicy: boolean;
  durability: number;
  stage: number;
  broken: DestroyedRecord | null;
}
export interface PropAttack {
  owner: string;
  cause: string;
  x: number;
  y: number;
  radius: number;
  damage: number;
  angle?: number;
  arc?: number;
  /** Agent/QA strikes aim at one prop through the same material damage path. */
  only?: string;
  /** M06 interaction spec: outward speed for loose props, spin, material multiplier, team. */
  impulse?: number;
  torque?: number;
  material?: number;
  team?: AttackTeam;
  /** M08: an elemental strike (a Cinderwake-burning hero's fire) also stimulates what it hits. */
  element?: Stimulus;
  /** M08: the reaction chain responsible (fire, shock and blast damage). */
  chain?: string;
  /** M08: a prop this area attack leaves alone (an explosion's own barrel). */
  except?: string;
  /** M10: props this area attack leaves alone (rift freight it just delivered). */
  spare?: readonly string[];
  /** Strike each prop at most once per key (a charge, a sweep) within the repeat window. */
  once?: string;
}
interface NavigationState {
  id: number;
  x: number;
  y: number;
  stuckTicks: number;
  turn: number;
}
export interface AdventurePhysicsSnapshot {
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  backend: string;
  landId: string;
  run: number;
  seed: number;
  world: PhysicsSnapshot;
  terrainChunks: ChunkCoordinate[];
  ambient: AmbientSample[];
  archives: LandArchive[];
  navigation: NavigationState[];
  appliedTransition: number;
  pendingTerrain: boolean;
  /** Version 3 (M05). */
  destroyed?: DestroyedRecord[];
  /** Version 4 (M06): instigators, pending impacts, hit suppression, holds, settled loot. */
  combat?: CombatPhysicsState;
  /** Version 5 (M07): gate latches, cocked launchers, causeway spans and pending events. */
  mechanisms?: MechanismState;
  /** Envelope 6 (M08): material statuses, surfaces, fields, delayed reactions and chains. */
  reactions?: ReactionState;
  /** Envelope 7 (M09): ragdoll remains records, foliage bend and pending rig events. */
  rigs?: RigState;
  /** Envelope 8 (M10): living-vine restraints, the showcase sequence and pending events. */
  showcase?: ShowcaseState;
  /** Envelope 9 (M11): the land's encounter grammar flag and realized manifests. */
  encounters?: EncounterState;
}
const round = (value: number) => Math.round(value * 1000) / 1000;
/** M11 armor mounts never wither while their warden lives (a safe-integer tick). */
const MOUNT_UNTIL = 2 ** 40;
/** M10: the authored town is a Sanctuary; before M10 it only dropped actor blocking. */
export const TOWN_VALUES = presetValues("Sanctuary");
export const LEGACY_TOWN_VALUES = { crowdContacts: false, propBlocking: false };
const M10_REPLACED = [{ scope: "area" as const, id: "town", from: LEGACY_TOWN_VALUES }];
/**
 * M10 calm regions use the Quiet preset's feature switches; the world-reactions master stays
 * with the area, so ambient creature selection there is unchanged.
 */
export const CALM_VALUES = (() => {
  const { worldReactions: _master, ...values } = presetValues("Quiet");
  return values;
})();
/** M10 regions of one area: its signature's second mechanic is Wild, its third is calm. */
export function showcaseRegions(r: AreaRecipe): RegionProfile[] {
  const spots = mechanicLayout(r).filter((m) => m.k === 0);
  return [
    {
      id: `wild-${r.index}`,
      areaId: `area-${r.index}`,
      priority: 20,
      shape: { kind: "circle", x: round(spots[1].x), y: round(spots[1].y), radius: 64 },
      values: presetValues("Wild"),
    },
    {
      id: `calm-${r.index}`,
      areaId: `area-${r.index}`,
      priority: 20,
      shape: { kind: "circle", x: round(spots[2].x), y: round(spots[2].y), radius: 64 },
      values: structuredClone(CALM_VALUES),
    },
  ];
}
/** The town's market square: loose goods there block and get pushed around. */
export const MARKET_REGION: RegionProfile = {
  id: "market",
  areaId: "town",
  priority: 10,
  shape: { kind: "rectangle", ...TOWN_MARKET },
  values: { propBlocking: true },
};
/**
 * M11: the generated areas of the simulation's current land, realized on its terrain (cached
 * per world, terrain revision and palette: layout and spawning share one realization).
 */
const generatedCache = new WeakMap<World, Map<string, GeneratedArea>>();
export function landGenerated(sim: Simulation): (GeneratedArea | null)[] {
  const s = sim.adventure.state,
    palette = s.townLand % PALETTES,
    world = sim.world;
  let cache = generatedCache.get(world);
  if (!cache) {
    cache = new Map();
    generatedCache.set(world, cache);
  }
  const blocked = solidTerrain(world),
    water = waterTerrain(world);
  return Array.from({ length: 4 }, (_, i) => {
    const r = areaRecipe(s.seed, s.townLand * 4 + i + 1);
    if (!r.procedural) return null;
    const key = `${r.seed}:${r.index}:${palette}:${world.seed}:${world.revision}`;
    let g = cache!.get(key);
    if (!g) {
      if (cache!.size > 32) cache!.clear();
      g = generatedArea(r, palette, blocked, undefined, water);
      cache!.set(key, g);
    }
    return g;
  });
}
function layout(sim: Simulation, grammar: boolean): PolicyLayout {
  const s = sim.adventure.state,
    landId = `land-${s.run}-${s.townLand}`;
  const areas = Array.from({ length: 4 }, (_, i) => areaRecipe(s.seed, s.townLand * 4 + i + 1));
  const generated = grammar ? landGenerated(sim) : [];
  return {
    lands: [{ id: landId, values: {} }],
    areas: [
      { id: "town", landId, values: structuredClone(TOWN_VALUES) },
      { id: "wilderness", landId, values: {} },
      ...areas.map((r) => ({ id: `area-${r.index}`, landId, values: {} })),
    ],
    regions: [
      structuredClone(MARKET_REGION),
      ...areas.flatMap((r) => [
        {
          id: `quiet-${r.index}`,
          areaId: `area-${r.index}`,
          priority: 10,
          shape: {
            kind: "rectangle" as const,
            x: r.x - 170,
            y: r.y - 150,
            width: 110,
            height: 90,
          },
          values: { crowdContacts: false, ambientPhysics: false },
        },
        {
          id: `reactive-${r.index}`,
          areaId: `area-${r.index}`,
          priority: 10,
          shape: { kind: "circle" as const, x: r.x + 75, y: r.y - 110, radius: 70 },
          values: { crowdContacts: true, ambientPhysics: true },
        },
        ...showcaseRegions(r),
        // M11: each generated cluster's regional profile.
        ...(generated[r.index - s.townLand * 4 - 1]?.regions.map((g) => structuredClone(g)) ?? []),
      ]),
    ],
  };
}
function freshPolicies(
  sim: Simulation,
  grammar: boolean,
  previous?: PolicyCheckpoint,
): PolicyCheckpoint {
  const profiles = layout(sim, grammar);
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
type AreaCircle = { index: number; x: number; y: number; radius: number };
const landCircles = new Map<string, AreaCircle[]>();
/** A land's four area footprints are pure functions of seed and land; building their full
 * recipes for every creature on every tick dominated high-population ticks. */
let lastCircles: { seed: number; townLand: number; circles: AreaCircle[] } | undefined;
function areaCircles(seed: number, townLand: number): AreaCircle[] {
  if (lastCircles?.seed === seed && lastCircles.townLand === townLand) return lastCircles.circles;
  const key = `${seed}:${townLand}`;
  let circles = landCircles.get(key);
  if (!circles) {
    if (landCircles.size >= 16) landCircles.clear();
    circles = Array.from({ length: 4 }, (_, i) => {
      const r = areaRecipe(seed, townLand * 4 + i + 1);
      return { index: r.index, x: r.x, y: r.y, radius: r.radius };
    });
    landCircles.set(key, circles);
  }
  lastCircles = { seed, townLand, circles };
  return circles;
}
export function adventureAreaAt(s: AdventureState, x: number, y: number): string {
  if (Math.hypot(x, y) < 265) return "town";
  const circles = areaCircles(s.seed, s.townLand);
  for (let i = 0; i < 4; i++) {
    const r: AreaCircle =
      s.mode === "area" && s.recipe.index === s.townLand * 4 + i + 1 ? s.recipe : circles[i];
    if (Math.hypot(x - r.x, y - r.y) < r.radius + 35) return `area-${r.index}`;
  }
  return "wilderness";
}
export function validateSemanticTerrain(
  snapshot: AdventurePhysicsSnapshot,
  world: World,
  state: AdventureState,
): void {
  if (snapshot.world.version < 4) return;
  const chunks = new Set(snapshot.terrainChunks.map((c) => c.join(",")));
  for (const entry of snapshot.world.bodies) {
    if (entry.recipe.role !== "terrain") continue;
    const pose = entry.state!;
    if (!chunks.has(`${Math.floor(pose.x / 256)},${Math.floor(pose.y / 256)}`))
      throw new Error("Terrain body outside occupied chunks");
    if (snapshot.pendingTerrain) continue; // Old valid colliders survive the explicit next-tick patch boundary.
    const expected = terrainRecipe(
      world,
      snapshot.landId,
      adventureAreaAt(state, Math.floor(pose.x / 16) * 16 + 8, Math.floor(pose.y / 16) * 16 + 8),
      Math.floor(pose.x / 16),
      Math.floor(pose.y / 16),
    );
    if (
      !expected ||
      JSON.stringify(expected) !== JSON.stringify(entry.recipe) ||
      pose.x !== expected.x ||
      pose.y !== expected.y ||
      pose.angle !== 0
    )
      throw new Error("Semantic terrain recipe mismatch");
  }
}
/** One land world. Gameplay produces intents; solved poses are copied out exactly once. */
export class AdventurePhysics {
  world: PhysicsWorld;
  landId: string;
  private run: number;
  private seed: number;
  private terrain = new TerrainRegistry();
  private ambient = new Map<number, AmbientSample>();
  /** `ambientBodyId` per slot, rebuilt only when that slot's generation changes. */
  private readonly ambientIds: string[] = [];
  private readonly ambientIdGenerations: number[] = [];
  private archives = new Map<string, LandArchive>();
  /** Destroyed parents in this land, by id. */
  private destroyed = new Map<string, DestroyedRecord>();
  /** M06 ownership, impacts, holds and loot settling. */
  readonly combat = new CombatPhysics();
  /** M07 authored mechanism behavior on top of the joints. */
  readonly mechanisms = new MechanismPhysics();
  /** M08 material reactions, surfaces, fields and causal chains. */
  readonly reactions = new ReactionPhysics();
  /** M09 ragdoll remains, landing events and foliage bend. */
  readonly rigs = new RigPhysics();
  /** M10 living-vine restraints and showcase events (M11: warden armor mounts too). */
  readonly showcase = new ShowcasePhysics();
  /** M11: this land was built with the encounter grammar (false for lands saved before it). */
  grammar = true;
  /** M11: realized manifests of this land's generated areas. */
  encounters: RealizedEncounter[] = [];
  /** Foliage props of this land (trees and brush), rebuilt when scenery changes. */
  private plants: string[] | null = null;
  /** Debris with an explicit lifetime: id -> cleanup tick. Derived from recipes on restore. */
  private expiring = new Map<string, number>();
  private actors = new Set<string>();
  private navigation = new Map<number, NavigationState>();
  private sourceWorld: World;
  private appliedTransition = -1;
  constructor(sim: Simulation) {
    this.sourceWorld = sim.world;
    this.run = sim.adventure.state.run;
    this.seed = sim.world.seed;
    this.landId = `land-${this.run}-${sim.adventure.state.townLand}`;
    this.world = new PhysicsWorld(undefined, {
      scene: "adventure",
      policies: freshPolicies(sim, this.grammar),
    });
    this.spawnProps(sim);
  }
  /** Whether an area of this land is built from the M11 encounter grammar. */
  private generates(recipe: AreaRecipe): boolean {
    return this.grammar && recipe.procedural;
  }
  areaAt(sim: Simulation, x: number, y: number): string {
    return adventureAreaAt(sim.adventure.state, x, y);
  }
  private spawnProps(sim: Simulation, archive?: LandArchive): void {
    this.expiring.clear();
    if (archive) {
      for (const pose of archive.props) {
        this.world.spawn(pose);
        if (!pose.frozen) this.world.motion(pose.id, pose.vx, pose.vy, pose.angularVelocity);
        this.track(pose);
      }
      // Archived assemblies keep their broken links, cut damage and motors.
      for (const assembly of archive.assemblies ?? []) {
        const joints = (archive.joints ?? []).filter((j) => j.recipe.assembly === assembly.id);
        this.world.addAssembly(
          assembly,
          joints.map((j) => j.recipe),
          joints,
        );
        this.mechanisms.track(assembly);
      }
      this.ensureMechanisms(sim);
      this.ensureReactions(sim, archive.reactions === undefined);
      this.ensureShowcase(sim, archive.showcase === undefined);
      this.ensureEncounters(sim, false);
      this.world.settle();
      return;
    }
    const palette = sim.adventure.state.townLand % PALETTES,
      blocked = solidTerrain(sim.world);
    for (let i = 0; i < 4; i++) {
      const r = areaRecipe(sim.adventure.state.seed, sim.adventure.state.townLand * 4 + i + 1);
      // M11 generated areas build their own content from the encounter grammar.
      if (this.generates(r)) continue;
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
          ...legacyBlueprint(`crate-${r.index}-${n}`, palette),
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
        ...legacyBlueprint(`wheel-${r.index}`, palette),
      });
      for (const recipe of clearingProps(r, palette, blocked)) this.world.spawn(recipe);
    }
    this.ensureMechanisms(sim);
    this.ensureReactions(sim, true);
    this.ensureShowcase(sim, true);
    this.ensureEncounters(sim, true);
    this.world.settle();
  }
  /**
   * M07 mechanisms and their companion scenery for every area of this land. Only content that
   * never existed is added (a fresh land, or a checkpoint/archive from before M07): an existing
   * assembly is never rebuilt, and destroyed companions (a looted chest) never return.
   */
  private ensureMechanisms(sim: Simulation): void {
    const s = sim.adventure.state,
      palette = s.townLand % PALETTES,
      present = new Set(this.world.assemblyList().map((a) => a.id));
    for (let i = 0; i < 4; i++) {
      const recipe = areaRecipe(s.seed, s.townLand * 4 + i + 1);
      if (this.generates(recipe)) continue;
      const { mechanisms, extras } = areaMechanisms(recipe, palette);
      for (const m of mechanisms) {
        if (present.has(m.recipe.id)) continue;
        for (const body of m.bodies) this.world.spawn(body);
        this.world.addAssembly(m.recipe, m.joints);
        this.mechanisms.track(m.recipe);
      }
      for (const body of extras)
        if (!this.world.has(body.id) && !this.destroyed.has(body.id)) this.world.spawn(body);
    }
  }
  /**
   * M08 reaction yards (braziers, coils, rods, casks, oil jars, fuse brush, a powder keg and a
   * fan) and each area's authored wind lane. Like mechanisms, only content that never existed is
   * added: destroyed yard props never return, and fields are authored only into a land that has
   * no reaction state yet.
   */
  private ensureReactions(sim: Simulation, fields: boolean): void {
    const s = sim.adventure.state,
      palette = s.townLand % PALETTES,
      blocked = solidTerrain(sim.world);
    for (let i = 0; i < 4; i++) {
      const recipe = areaRecipe(s.seed, s.townLand * 4 + i + 1);
      if (this.generates(recipe)) continue;
      const yard = areaReactions(recipe, palette, blocked);
      for (const body of yard.props)
        if (!this.world.has(body.id) && !this.destroyed.has(body.id)) this.world.spawn(body);
      if (fields)
        for (const field of yard.fields)
          if (!this.reactions.hasField(field.id)) this.reactions.addField(field);
    }
  }
  /**
   * M10 town scene and area set pieces. Like mechanisms and reaction yards, bodies and
   * assemblies are added only where they never existed (destroyed pieces never return);
   * authored fields and pools are added once, when the land first gets its M10 scene.
   */
  private ensureShowcase(sim: Simulation, authored: boolean): void {
    const s = sim.adventure.state,
      palette = s.townLand % PALETTES,
      blocked = solidTerrain(sim.world),
      present = new Set(this.world.assemblyList().map((a) => a.id)),
      scenes = [
        townScene(palette),
        ...Array.from({ length: 4 }, (_, i) => areaRecipe(s.seed, s.townLand * 4 + i + 1))
          // Generated areas' set pieces come with their encounter content (M11).
          .filter((r) => !this.generates(r))
          .map((r) => areaShowcase(r, palette, blocked)),
      ];
    for (const scene of scenes) {
      for (const m of scene.mechanisms) {
        if (present.has(m.recipe.id)) continue;
        for (const body of m.bodies) if (!this.world.has(body.id)) this.world.spawn(body);
        this.world.addAssembly(m.recipe, m.joints);
        this.mechanisms.track(m.recipe);
      }
      for (const body of scene.bodies)
        if (body.assembly === undefined && !this.world.has(body.id) && !this.destroyed.has(body.id))
          this.world.spawn(body);
      if (!authored) continue;
      for (const field of scene.fields)
        if (!this.reactions.hasField(field.id)) this.reactions.addField(field);
      for (const surface of scene.surfaces)
        if (!this.reactions.hasSurface(surface.id)) this.reactions.addSurface(surface);
    }
    this.plants = null;
  }
  /**
   * M11 generated areas: their trees, M10 set pieces, encounter clusters, standalone mechanism
   * and warden arena. Like the other layers, only content that never existed is added
   * (destroyed pieces never return); fields and pools are authored once, with the land.
   */
  private ensureEncounters(sim: Simulation, authored: boolean): void {
    if (!this.grammar) return;
    const present = new Set(this.world.assemblyList().map((a) => a.id)),
      generated = landGenerated(sim).filter((g): g is GeneratedArea => g !== null);
    for (const { content } of generated) {
      for (const m of content.mechanisms) {
        if (present.has(m.recipe.id)) continue;
        for (const body of m.bodies) if (!this.world.has(body.id)) this.world.spawn(body);
        this.world.addAssembly(m.recipe, m.joints);
        this.mechanisms.track(m.recipe);
      }
      for (const body of content.bodies)
        if (body.assembly === undefined && !this.world.has(body.id) && !this.destroyed.has(body.id))
          this.world.spawn(body);
      if (!authored) continue;
      for (const field of content.fields)
        if (!this.reactions.hasField(field.id)) this.reactions.addField(field);
      for (const surface of content.surfaces)
        if (!this.reactions.hasSurface(surface.id)) this.reactions.addSurface(surface);
    }
    if (authored) this.encounters = generated.map((g) => structuredClone(g.manifest));
    this.plants = null;
  }
  /** The hooks reactions use: water terrain, areas and burnt-out ash. */
  reactionHost(sim: Simulation): ReactionHost {
    return {
      tick: sim.tick,
      world: this.world,
      combat: this.combat,
      waterAt: (x, y) => {
        const terrain = sim.world.at(x, y).terrain;
        return terrain === Terrain.Water || terrain === Terrain.DeepWater;
      },
      areaAt: (x, y) => this.areaAt(sim, x, y),
      ash: (id, owner, chain) => {
        const pose = this.world.pose(id);
        this.breakProp(sim, pose, 0, {
          owner,
          cause: "burnout",
          chain,
          x: pose.x,
          y: pose.y,
          radius: 0,
          damage: 0,
        });
      },
    };
  }
  /** Agent and mechanic stimuli: fire, water, oil, shock or a blast at a point or on a body. */
  stimulate(
    sim: Simulation,
    stimulus: Stimulus,
    options: {
      x: number;
      y: number;
      radius?: number;
      target?: string;
      owner?: string;
      team?: AttackTeam;
      cause?: string;
      strength?: number;
    },
  ): string {
    if (options.target !== undefined && !this.world.has(options.target))
      throw new Error("Unknown reaction target");
    return this.reactions.stimulate(this.reactionHost(sim), stimulus, {
      ...options,
      ...(stimulus === "shock" || stimulus === "blast" ? { source: options.target ?? "" } : {}),
    });
  }
  private track(recipe: BodyRecipe): void {
    if (recipe.blueprint?.expiresAt !== undefined)
      this.expiring.set(recipe.id, recipe.blueprint.expiresAt);
  }
  synchronizeLand(sim: Simulation): void {
    const id = `land-${sim.adventure.state.run}-${sim.adventure.state.townLand}`;
    if (id === this.landId && this.seed === sim.world.seed) return;
    this.world.boundary();
    const previous = this.world.policyState();
    // Remains are transient (M09): they never travel with an archived land.
    const props = this.props().filter((p) => !isRemains(p));
    if (sim.adventure.state.run === this.run) {
      const reactions = this.reactions.archive(sim.tick);
      reactions.statuses = reactions.statuses.filter((status) =>
        props.some((p) => p.id === status.id),
      );
      this.archives.set(this.landId, {
        id: this.landId,
        policies: { state: previous.state, pending: previous.pending },
        props,
        patches: [...this.sourceWorld.patches.values()].map((p) => [...p]),
        destroyed: [...this.destroyed.values()],
        assemblies: this.world.assemblyList().filter((a) => a.kind !== "remains"),
        joints: this.world.jointList().filter((j) => !j.recipe.assembly.startsWith("remains-")),
        mechanisms: this.mechanisms.save(),
        reactions,
        showcase: this.showcase.archive(),
        encounters: { grammar: this.grammar, areas: structuredClone(this.encounters) },
      });
    } else this.archives.clear();
    const archive = this.archives.get(id);
    this.archives.delete(id);
    if (archive) {
      archive.policies.state.masterWorldReactions = previous.state.masterWorldReactions;
      archive.policies.state.boundaryMargin = previous.state.boundaryMargin;
      // A land archived before M10 gains its Sanctuary town and calm/wild regions.
      if (archive.showcase === undefined)
        archive.policies.state = reauthorLayout(
          archive.policies.state,
          layout(sim, false),
          M10_REPLACED,
        );
    }
    // A fresh land is built with the M11 grammar; an archived one keeps how it was built.
    this.grammar = archive ? (archive.encounters?.grammar ?? false) : true;
    this.encounters = structuredClone(archive?.encounters?.areas ?? []);
    this.world.dispose();
    this.world = new PhysicsWorld(undefined, {
      scene: "adventure",
      policies: archive?.policies ?? freshPolicies(sim, this.grammar, previous),
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
    this.destroyed = new Map((archive?.destroyed ?? []).map((d) => [d.id, d]));
    this.combat.clear();
    this.mechanisms.restore(archive?.mechanisms);
    this.reactions.unarchive(archive?.reactions, sim.tick);
    this.rigs.clear();
    this.showcase.restore(archive?.showcase);
    this.plants = null;
    this.spawnProps(sim, archive);
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
  private ambientId(slot: number, generation: number): string {
    if (this.ambientIdGenerations[slot] !== generation || this.ambientIds[slot] === undefined) {
      this.ambientIds[slot] = ambientBodyId(slot, generation);
      this.ambientIdGenerations[slot] = generation;
    }
    return this.ambientIds[slot];
  }
  begin(sim: Simulation): void {
    this.synchronizeLand(sim);
    // Debris cleanup follows its explicit lifetime, recorded when it was created. Ragdoll
    // remains (M09) leave together with their joints.
    if (this.expiring.size) {
      for (const [id, tick] of [...this.expiring].sort((a, b) => (a[0] < b[0] ? -1 : 1)))
        if (tick <= sim.tick) {
          if (this.world.has(id)) {
            const assembly = this.world.recipeOf(id).assembly;
            if (assembly !== undefined) this.world.removeAssembly(assembly);
            else this.world.remove(id);
          }
          this.expiring.delete(id);
        }
      this.rigs.prune((id) => this.world.has(id));
    }
    // A monster that died since the last solve (an agent strike) becomes remains first.
    for (const e of sim.adventure.state.enemies) if (e.hp <= 0) this.retire(sim, e);
    this.townsfolk(sim);
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
        id = this.ambientId(i, sim.generation[i]);
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
      // Reuse the slot's sample: a fresh object per creature per tick dominated GC at high
      // populations. `recycleAmbient` still replaces a recycled slot's sample.
      if (previous) {
        previous.x = sim.x[i];
        previous.y = sim.y[i];
        previous.areaId = areaId;
        previous.regions = policy.regions;
        previous.owner = owner;
      } else
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
    // Fixed scenery never meets terrain; only movable props need their surroundings solid.
    // Solved positions are read directly: building complete poses here cloned every prop's
    // recipe and policy every tick (the largest avoidable cost once M08 added reaction yards).
    for (const id of this.world.ids())
      if (isPropId(id) && this.world.recipeOf(id).motion === "dynamic") {
        const m = this.world.motionOf(id);
        points.push({ x: m.x, y: m.y, radius: 40 });
      }
    for (const drop of sim.adventure.state.drops)
      if (this.world.has(lootBodyId(drop.id))) points.push({ x: drop.x, y: drop.y, radius: 24 });
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
  removeActor(id: string): void {
    this.world.remove(id);
    this.actors.delete(id);
    this.showcase.release(id);
  }
  /**
   * M09 death transfer. The dead monster's actor body leaves the solver and, in the same tick,
   * its drawn pose becomes a jointed ragdoll that keeps the body's momentum and the killing
   * blow (where ragdolls are on); armor, bark and lantern cores come loose as material props.
   * Burning, wet, oiled or charged monsters pass that status to their remains. Where ragdolls
   * are off, the game draws its authored death pose instead and no body remains.
   */
  private retire(sim: Simulation, e: Enemy): void {
    const id = enemyBodyId(e.id);
    if (!this.world.has(id)) return;
    const body = this.world.motionOf(id);
    this.removeActor(id);
    this.navigation.delete(e.id);
    const areaId = this.areaAt(sim, body.x, body.y),
      policy = this.world.policyAt(areaId, body.x, body.y);
    if (this.rigs.has(e.id) || !policy.effective.ragdolls) {
      this.reactions.transfer(id, []);
      return;
    }
    const spawn = remainsRecipes({
      enemy: e,
      pose: enemyPose(e, sim.tick),
      x: body.x,
      y: body.y,
      vx: body.vx,
      vy: body.vy,
      areaId,
      palette: sim.adventure.state.townLand % PALETTES,
      tick: sim.tick,
      flip: Math.cos(e.facing) < 0,
    });
    for (const b of spawn.bodies) this.world.spawn(b.recipe);
    if (spawn.assembly) this.world.addAssembly(spawn.assembly, spawn.joints);
    for (const b of spawn.bodies) {
      const m = this.world.motionOf(b.recipe.id);
      if (m.dynamic && !m.frozen) this.world.motion(b.recipe.id, b.vx, b.vy, b.spin);
      this.track(b.recipe);
    }
    this.reactions.transfer(id, spawn.assembly ? [spawn.assembly.root] : []);
    const bp = rigOf(e.rig);
    this.rigs.add({
      enemy: e.id,
      rig: e.rig,
      born: sim.tick,
      lands: sim.tick + bp.fallTicks,
      owner: "",
      boss: e.boss,
      fall: spawn.fall,
      bodies: spawn.bodies.map((b) => b.recipe.id),
    });
  }
  /** A heavy blow knocks a detachable part off a living monster as a loose material prop. */
  shed(sim: Simulation, e: Enemy, index: number): string | null {
    const id = enemyBodyId(e.id);
    if (!this.world.has(id)) return null;
    const part = rigOf(e.rig).parts.filter((p) => p.detach !== undefined)[index];
    if (!part) return null;
    const body = this.world.motionOf(id),
      spawn = remainsRecipes({
        enemy: e,
        pose: enemyPose(e, sim.tick),
        x: body.x,
        y: body.y,
        vx: body.vx,
        vy: body.vy,
        areaId: this.areaAt(sim, body.x, body.y),
        palette: sim.adventure.state.townLand % PALETTES,
        tick: sim.tick,
        flip: Math.cos(e.facing) < 0,
        pieces: [part.id],
      });
    for (const b of spawn.bodies) {
      if (this.world.has(b.recipe.id)) continue;
      this.world.spawn(b.recipe);
      const m = this.world.motionOf(b.recipe.id);
      if (m.dynamic && !m.frozen) this.world.motion(b.recipe.id, b.vx, b.vy, b.spin);
      this.track(b.recipe);
    }
    return part.material;
  }
  /**
   * M09 townsfolk: physical bodies in town that travelers shove (they never block anyone) and
   * that walk back to their posts. Their services follow them, so harmless motion never makes
   * an essential service unavailable.
   */
  private townsfolk(sim: Simulation): void {
    const town = sim.adventure.state.mode === "town";
    for (const npc of TOWN_NPCS) {
      const id = npcBodyId(npc.id);
      if (!town) {
        if (this.world.has(id)) this.world.remove(id);
        continue;
      }
      const home = npcPosition(npc, sim.tick);
      if (!this.world.has(id)) {
        this.world.spawn({
          id,
          motion: "dynamic",
          role: "actor",
          actorKind: "npc",
          shape: { kind: "circle", radius: 6 },
          x: home.x,
          y: home.y,
          // Light enough that a traveler's shove moves them without slowing the traveler much.
          mass: 0.8,
          areaId: this.areaAt(sim, home.x, home.y),
          friction: 0,
          restitution: 0,
          damping: 0,
        });
        this.world.motor(id, 0, 0, 0.08);
      }
      const at = this.world.motionOf(id),
        dx = home.x - at.x,
        dy = home.y - at.y,
        d = Math.hypot(dx, dy),
        speed = Math.min(45, d * 3);
      this.world.motor(id, d > 0.01 ? (dx / d) * speed : 0, d > 0.01 ? (dy / d) * speed : 0, 0.08);
    }
  }
  /** Where a townsperson stands now (their service is offered there). */
  npcPoint(id: string): { x: number; y: number } | null {
    const body = npcBodyId(id);
    return this.world.has(body) ? this.world.motionOf(body) : null;
  }
  private plantList(): string[] {
    this.plants ??= this.world.ids().filter((id) => {
      const family = isPropId(id) ? this.world.recipeOf(id).blueprint?.family : undefined;
      return family !== undefined && FOLIAGE_FAMILIES.has(family);
    });
    return this.plants;
  }
  /** After the solve: remains landing, travelers bumping townsfolk, and foliage bend. */
  private updateRigs(sim: Simulation): void {
    for (const contact of this.world.stepStarted) {
      const npc = contact.a.startsWith("npc-")
        ? contact.a
        : contact.b.startsWith("npc-")
          ? contact.b
          : "";
      const other = npc === contact.a ? contact.b : contact.a;
      if (!npc || !other.startsWith("player-")) continue;
      const at = this.world.motionOf(npc);
      this.rigs.emit({
        tick: sim.tick,
        text: `npc:bump:${npc.slice(4)}`,
        x: at.x,
        y: at.y,
        owner: other.slice(7),
        amount: 1,
      });
    }
    const plants: Parameters<RigPhysics["update"]>[1] = [];
    for (const id of this.plantList()) {
      if (!this.world.has(id)) continue;
      const recipe = this.world.recipeOf(id),
        m = this.world.motionOf(id),
        policy = this.world.policyOf(id).effective;
      plants.push({
        id,
        family: recipe.blueprint!.family as "tree" | "brush",
        x: m.x,
        y: m.y,
        foliage: policy.foliage,
        fields: policy.environmentalForces ? policy.fieldStrength : 0,
      });
    }
    const movers: Parameters<RigPhysics["update"]>[2] = [];
    for (const p of sim.players.values()) movers.push({ x: p.x, y: p.y, vx: p.vx, reach: 22 });
    for (const e of sim.adventure.state.enemies)
      if (e.hp > 0) movers.push({ x: e.x, y: e.y, vx: e.vx, reach: 16 + e.radius });
    for (const record of this.rigs.list())
      for (const id of record.bodies)
        if (this.world.has(id)) {
          const m = this.world.motionOf(id);
          if (Math.abs(m.vx) > 4) movers.push({ x: m.x, y: m.y, vx: m.vx, reach: 14 });
        }
    this.rigs.update(
      sim.tick,
      plants,
      movers,
      (x, y) => this.reactions.accelerationAt(x, y, sim.tick, MATERIALS.vegetation.knockback).x,
      (record) => {
        const root = record.bodies.find((id) => this.world.has(id));
        if (!root) return null;
        const m = this.world.motionOf(root);
        return { x: m.x, y: m.y, material: this.world.recipeOf(root).material ?? "wood" };
      },
    );
  }
  /** Whether solid scenery (not actors) lies within `reach` ahead of a monster (M10 crash). */
  blockedAhead(enemy: Enemy, reach: number): boolean {
    const id = enemyBodyId(enemy.id);
    if (!this.world.has(id)) return false;
    return (
      this.world.obstacleFraction(
        id,
        Math.cos(enemy.facing) * (enemy.radius + reach),
        Math.sin(enemy.facing) * (enemy.radius + reach),
        enemy.radius,
      ) < 1
    );
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
      this.world.tick +
        Math.max(
          0,
          Math.max(enemy.hurtUntil, enemy.reaction.staggerUntil, enemy.reaction.toppleUntil) -
            sim.tick,
        ),
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
    for (const e of sim.adventure.state.enemies) if (e.hp <= 0) this.retire(sim, e);
    this.synchronizeTerrain(sim);
    const solid = this.solidAt(sim);
    this.combat.syncLoot(sim, this.world, (x, y) => this.areaAt(sim, x, y), solid);
    this.combat.beforeStep(sim, this.world);
    // Field forces are velocity changes before the solve, so strain and projection see them.
    this.reactions.applyFields(this.reactionHost(sim));
    // M10 living vines pull the same way.
    this.showcase.update(sim.tick, {
      has: (id) => this.world.has(id),
      motionOf: (id) => this.world.motionOf(id),
      policy: (id) => this.world.policyOf(id).effective,
      // Actors take it as external motion; M11 armor pieces (props) as a velocity change.
      pull: (id, dvx, dvy) => void this.world.fieldPush(id, dvx, dvy),
    });
    const contacts = this.world.contacts;
    this.world.step(true);
    sim.metrics.contacts += this.world.contacts - contacts;
    this.combat.afterStep(sim, this.world);
    this.mechanisms.update(sim.tick, this.world, this.combat);
    this.reactions.update(this.reactionHost(sim));
    this.updateRigs(sim);
    this.combat.afterLoot(sim, this.world, solid);
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
  /** Read-only prop views for presentation (renderer, grab hints): no recipe/policy clones. */
  views(): BodyPose[] {
    const out: BodyPose[] = [];
    for (const id of this.world.ids()) if (isPropId(id)) out.push(this.world.view(id));
    return out;
  }
  /** Terrain solids plus fixed scenery: where loot cannot rest and travelers cannot reach. */
  private solidAt(sim: Simulation) {
    const terrain = solidTerrain(sim.world);
    let fixed: { x: number; y: number; reach: number }[] | null = null;
    return (x: number, y: number, reach: number) => {
      if (terrain(x, y, reach)) return true;
      fixed ??= this.world
        .ids()
        .filter(isPropId)
        .map((id) => this.world.pose(id))
        .filter((p) => p.motion === "fixed")
        .map((p) => ({ x: p.x, y: p.y, reach: shapeReach(p.shape) }));
      return fixed.some((f) => Math.hypot(f.x - x, f.y - y) < f.reach + reach);
    };
  }
  /** Effective policy at a point of the current land. */
  policyAt(sim: Simulation, x: number, y: number) {
    return this.world.policyAt(this.areaAt(sim, x, y), x, y);
  }
  /**
   * First prop or rooted terrain a moving circle meets (deep water is not cover). Returns the
   * contact point fraction, the scenery's outward normal and what it is made of.
   */
  sceneryHit(
    x: number,
    y: number,
    dx: number,
    dy: number,
    radius: number,
    skip: readonly string[] = [],
  ) {
    const hit = this.world.castScenery(
      x,
      y,
      dx,
      dy,
      radius,
      // Deck planks and raised vanes are not cover: shots pass over and under them.
      (id, role) =>
        !skip.includes(id) &&
        (role === "prop"
          ? isPropId(id) && !passesActors(this.world.recipeOf(id))
          : !id.endsWith("-water")),
    );
    if (!hit) return null;
    const pose = this.world.pose(hit.id);
    return {
      ...hit,
      role: pose.role === "terrain" ? ("terrain" as const) : ("prop" as const),
      material: pose.material ?? null,
      family: pose.blueprint?.family ?? null,
      fixed: pose.motion === "fixed",
    };
  }
  grab(sim: Simulation, player: string, id: string): void {
    this.combat.grab(sim, this.world, player, id);
  }
  release(sim: Simulation, player: string, throwIt: boolean): string | null {
    return this.combat.release(sim, this.world, player, throwIt);
  }
  /** Destroyed parent IDs are permanent; nothing may spawn under them again. */
  isDestroyed(id: string): boolean {
    return this.destroyed.has(id);
  }
  destroyedRecords(): DestroyedRecord[] {
    return [...this.destroyed.values()].map((d) => structuredClone(d));
  }
  /**
   * Basic attack hook: material damage, visible push and one-time breakage for props in an
   * attack's reach. Breaking replaces the parent with authored pieces at this command boundary
   * (outside the solver step); a destroyed parent can never be hit, broken or rewarded again.
   */
  damageProps(sim: Simulation, attack: PropAttack): PropHit[] {
    const arc = attack.arc ?? Math.PI,
      angle = attack.angle ?? 0,
      hits: PropHit[] = [];
    let host: ReactionHost | null = null,
      elementChain: string | undefined = attack.chain;
    for (const id of this.world.ids()) {
      if (!(id.startsWith("crate-") || id.startsWith("wheel-") || id.startsWith("prop-"))) continue;
      if (attack.only !== undefined && id !== attack.only) continue;
      if (attack.except !== undefined && id === attack.except) continue;
      if (attack.spare?.includes(id)) continue;
      // M11: a warden's own blows never strike the armor it wears.
      if (
        attack.owner.startsWith("enemy-") &&
        id.startsWith(`prop-armor-${attack.owner.slice(6)}-`)
      )
        continue;
      const pose = this.world.pose(id);
      if (!pose.blueprint || !pose.material) continue;
      const reach =
        pose.shape.kind === "circle"
          ? pose.shape.radius
          : Math.hypot(pose.shape.width, pose.shape.height) / 2;
      const dx = pose.x - attack.x,
        dy = pose.y - attack.y,
        distance = Math.hypot(dx, dy);
      if (distance > attack.radius + reach) continue;
      if (arc < Math.PI && distance > 1 && Math.cos(Math.atan2(dy, dx) - angle) < Math.cos(arc))
        continue;
      const family = FAMILIES[pose.blueprint.family],
        material = MATERIALS[pose.material],
        policy = pose.policy;
      const away = distance > 1 ? Math.atan2(dy, dx) : angle;
      if (attack.once && !this.combat.once(`${attack.once}|${id}`, sim.tick, 600)) continue;
      if (pose.motion === "dynamic" && !pose.frozen) {
        const speed = attack.impulse ?? Math.min(140, 25 + attack.damage * 3),
          push = (pose.mass ?? 1) * speed * material.knockback;
        if (push > 0) {
          this.world.impulse(id, Math.cos(away) * push, Math.sin(away) * push);
          if (attack.torque)
            this.world.spin(
              id,
              attack.torque * material.knockback * (Math.sin(away - angle) >= 0 ? 1 : -1),
            );
          this.combat.instigate(id, attack.owner, attack.team ?? "party", attack.cause, sim.tick);
        }
      }
      // Mechanism parts are not destroyed: a striking attack cuts the nearest joint instead.
      // Ragdoll remains (M09) only move: their joints cannot be cut.
      if (
        pose.assembly !== undefined &&
        !isRemains(pose) &&
        attack.damage > 0 &&
        attack.material !== 0
      )
        this.cutJoint(sim, pose, attack);
      // A blow shakes foliage away from the attacker (M09).
      if (FOLIAGE_FAMILIES.has(pose.blueprint.family) && attack.damage > 0)
        this.rigs.kick(id, Math.cos(away) * Math.min(6, 1 + attack.damage * 0.08));
      // M08 devices and elemental strikes. A reaction's own damage never re-triggers them.
      if (attack.damage > 0 && attack.material !== 0 && attack.chain === undefined) {
        host ??= this.reactionHost(sim);
        if (pose.blueprint.family === "coil")
          this.reactions.strikeCoil(host, id, attack.owner, attack.team ?? "party");
        else if (pose.blueprint.family === "fan")
          this.reactions.strikeFan(host, id, attack.owner, attack.team ?? "party");
        if (attack.element) {
          elementChain ??= this.reactions.begin(
            attack.cause,
            attack.owner,
            attack.team ?? "party",
            sim.tick,
          );
          this.reactions.stimulate(host, attack.element, {
            x: pose.x,
            y: pose.y,
            target: id,
            chain: elementChain,
            ...(attack.element === "shock" ? { source: id } : {}),
          });
        }
      }
      if (family.toughness <= 0) continue; // Pieces and stumps move; they do not break further.
      // Mechanism members never break, even breakable families such as a cargo train's crate
      // and barrel (M11): the strike already cut their nearest joint.
      if (pose.assembly !== undefined) continue;
      if (attack.damage <= 0 || attack.material === 0) continue; // A shove, not a strike.
      const durability = pose.consequences?.durability ?? 100;
      const base: Omit<PropHit, "damage" | "resisted" | "durability" | "stage" | "broken"> = {
        id,
        family: pose.blueprint.family,
        material: pose.material,
        x: pose.x,
        y: pose.y,
        protectedByPolicy: !policy.effective.destruction,
      };
      if (!policy.effective.destruction) {
        hits.push({
          ...base,
          damage: 0,
          resisted: false,
          durability,
          stage: damageStage(durability),
          broken: null,
        });
        continue;
      }
      const loss =
        (materialDamage(
          pose.material,
          attack.damage * (attack.material ?? 1),
          policy.values.materialDurability,
        ) /
          family.toughness) *
        100;
      if (loss <= 0) {
        hits.push({
          ...base,
          damage: 0,
          resisted: true,
          durability,
          stage: damageStage(durability),
          broken: null,
        });
        continue;
      }
      const remaining = Math.max(0, durability - loss);
      if (remaining > 0) {
        this.world.setConsequences(id, {
          destroyed: false,
          claimed: pose.consequences?.claimed ?? false,
          durability: remaining,
        });
        hits.push({
          ...base,
          damage: durability - remaining,
          resisted: false,
          durability: remaining,
          stage: damageStage(remaining),
          broken: null,
        });
        continue;
      }
      hits.push({
        ...base,
        damage: durability,
        resisted: false,
        durability: 0,
        stage: 3,
        // Pieces inherit the motion this attack just gave the parent.
        broken: this.breakProp(sim, { ...pose, ...velocityOf(this.world, id) }, away, attack),
      });
    }
    return hits;
  }
  /** Cut damage to the intact joint of this member nearest the attack's origin. */
  private cutJoint(sim: Simulation, pose: BodyPose, attack: PropAttack): void {
    let best: { id: string; distance: number } | null = null;
    for (const joint of this.world.jointList()) {
      if (joint.broken || (joint.recipe.a !== pose.id && joint.recipe.b !== pose.id)) continue;
      const a = this.world.pose(joint.recipe.a),
        b = this.world.pose(joint.recipe.b),
        anchors = jointAnchors(joint.recipe, a, b),
        distance = Math.hypot(anchors.ax - attack.x, anchors.ay - attack.y);
      if (!best || distance < best.distance) best = { id: joint.recipe.id, distance };
    }
    if (!best) return;
    const amount = materialDamage(
      pose.material!,
      attack.damage * (attack.material ?? 1),
      pose.policy.values.materialDurability,
    );
    if (amount <= 0) return;
    const result = this.world.damageJoint(best.id, amount, attack.cause);
    if (result.broken)
      for (const event of this.world.drainJointBreaks())
        this.mechanisms.recordBreak(
          this.world,
          this.combat,
          sim.tick,
          event.id,
          event.cause,
          attack.owner,
        );
  }
  /** QA/agent cut: authored cut damage (default: enough to sever) through the same policy. */
  cut(sim: Simulation, owner: string, id: string, damage?: number) {
    const joint = this.world.joint(id),
      policy = this.world.policyOf(joint.recipe.a);
    const amount =
      damage ?? Math.max(0, joint.recipe.toughness * policy.values.jointStrength - joint.damage);
    const result = this.world.damageJoint(id, amount, "cut");
    for (const event of this.world.drainJointBreaks())
      this.mechanisms.recordBreak(this.world, this.combat, sim.tick, event.id, event.cause, owner);
    return result;
  }
  /** Whether a traveler at this point stands on a causeway plank still tied to a bank post. */
  deckAt(x: number, y: number): boolean {
    const planks: BodyPose[] = [];
    for (const assembly of this.world.assemblyList())
      if (assembly.kind === "bridge")
        for (const id of assembly.members)
          if (id.includes("-plank") && this.world.partOf(id)?.anchored)
            planks.push(this.world.pose(id));
    return onDeck(planks, x, y);
  }
  /**
   * M10 Thornburst: a burst seedpod's shove (a short pressure field that spares the bursting
   * team) and a ring of thorn splinters, owned by whoever burst it, that hurt what they strike.
   * No splinters where dynamic props are off; the field is gated per body like any field.
   */
  thornburst(
    sim: Simulation,
    burst: { x: number; y: number; owner: string; team: AttackTeam; cause: string },
  ): string[] {
    const areaId = this.areaAt(sim, burst.x, burst.y),
      policy = this.world.policyAt(areaId, burst.x, burst.y).effective,
      seq = this.showcase.sequence++,
      palette = sim.adventure.state.townLand % PALETTES,
      ids: string[] = [];
    this.reactions.addField({
      id: `thornburst-${seq}`,
      kind: "pressure",
      areaId,
      shape: { kind: "circle", x: round(burst.x), y: round(burst.y), radius: THORNBURST.radius },
      strength: THORNBURST.pressure,
      ticks: THORNBURST.pressureTicks,
      gust: 0,
      actors: true,
      owner: burst.owner,
      team: burst.team,
      source: burst.cause,
      spare: burst.team === "enemy" ? "enemy" : "party",
    });
    if (!policy.dynamicProps) return ids;
    for (let k = 0; k < THORNBURST.splinters; k++) {
      const angle = (k / THORNBURST.splinters) * Math.PI * 2 + (seq % 8) * 0.39,
        id = `prop-thorn-${seq}-${k}`,
        recipe = propRecipe(
          id,
          "debris",
          palette,
          round(burst.x + Math.cos(angle) * 14),
          round(burst.y + Math.sin(angle) * 14),
          areaId,
          {
            angle: round(angle),
            material: "vegetation",
            shape: { kind: "box", width: 9, height: 3 },
          },
        );
      // Dense thorn bolts: heavy enough that a strike at speed hurts (M06 impact damage).
      recipe.mass = THORNBURST.mass;
      recipe.blueprint = {
        family: "debris",
        palette,
        piece: "thorn",
        parent: `thornburst-${seq}`,
        expiresAt: sim.tick + THORNBURST.lifetime,
      };
      this.world.spawn(recipe);
      // Its lifetime holds even when it lands frozen (in a region with dynamic props off):
      // restore derives expiry from the recipe, so the live land must track it too (M11 fix).
      this.track(recipe);
      if (this.world.motionOf(id).frozen) continue;
      const speed = THORNBURST.speed * policy.impulseStrength;
      this.world.motion(id, Math.cos(angle) * speed, Math.sin(angle) * speed, (k % 2 ? 1 : -1) * 9);
      this.combat.instigate(id, burst.owner, burst.team, burst.cause, sim.tick);
      ids.push(id);
    }
    return ids;
  }
  /**
   * M10 Rift freight: loose props on the departure arch's pad travel with the traveler. Each
   * unanchored part moves whole with its joints and motion; anchored, frozen, too heavy or
   * someone else's held props stay. The arrival field then bursts them outward.
   */
  freight(
    sim: Simulation,
    player: string,
    pad: { x: number; y: number },
    dx: number,
    dy: number,
  ): string[] {
    const moved = new Set<string>(),
      held = this.combat.holding(player);
    for (const id of this.world.ids()) {
      if (!isPropId(id) || moved.has(id) || id === held) continue;
      const recipe = this.world.recipeOf(id);
      if (recipe.motion !== "dynamic" || isRemains(recipe)) continue;
      const m = this.world.motionOf(id);
      if (m.frozen || m.mass > GRAB_MAX_MASS * 1.5) continue;
      if (Math.hypot(m.x - pad.x, m.y - pad.y) > FREIGHT_PAD) continue;
      const holder = this.combat.holderOf(id);
      if (holder !== null && holder !== player) continue;
      const part = this.world.partOf(id);
      if (part?.anchored) continue;
      const members = this.world.partMembers(id);
      if (members.some((member) => this.combat.holderOf(member) !== null)) continue;
      if (!this.world.policyOf(id).effective.dynamicProps) continue;
      this.world.transport(members, dx, dy);
      for (const member of members) {
        moved.add(member);
        this.combat.instigate(member, player, "party", "rift", sim.tick);
      }
    }
    const ids = [...moved].sort();
    if (ids.length)
      this.showcase.emit({
        tick: sim.tick,
        text: "freight:carried",
        owner: player,
        x: round(pad.x + dx),
        y: round(pad.y + dy),
        amount: ids.length,
      });
    return ids;
  }
  /**
   * M10 Bloom snare: living vines from a bloom to the nearest monsters. Each holds its monster
   * elastically toward the bloom (see `ShowcasePhysics.update`). Mechanisms off at the bloom:
   * no vines grow (the bloom's damage and experience bonus is gameplay and still applies).
   */
  snare(
    sim: Simulation,
    bloom: { x: number; y: number; owner: string },
    targets: Enemy[],
  ): Restraint[] {
    const policy = this.policyAt(sim, bloom.x, bloom.y).effective;
    if (!policy.mechanisms) return [];
    const out: Restraint[] = [];
    for (const e of targets) {
      const body = enemyBodyId(e.id);
      if (!this.world.has(body)) continue;
      const d = Math.hypot(e.x - bloom.x, e.y - bloom.y),
        r = this.showcase.add({
          kind: "bloom",
          body,
          x: round(bloom.x),
          y: round(bloom.y),
          anchor: "",
          rest: round(Math.max(BLOOM_SNARE.minimum, d * BLOOM_SNARE.share)),
          stiffness: BLOOM_SNARE.stiffness,
          breakLoad: BLOOM_SNARE.breakLoad,
          until: sim.tick + BLOOM_SNARE.ticks,
          born: sim.tick,
          owner: bloom.owner,
          team: "party",
        });
      if (r) out.push(r);
    }
    if (out.length)
      this.showcase.emit({
        tick: sim.tick,
        text: "snare:grown",
        owner: bloom.owner,
        x: round(bloom.x),
        y: round(bloom.y),
        amount: out.length,
      });
    return out;
  }
  /**
   * M11 modular warden armor: its pieces (bark plates, glass shards, boulders or censers) spawn
   * around it on mount tethers. With mechanisms or dynamic props off where it stands, the
   * warden fights unarmored (nothing is spawned).
   */
  armBoss(sim: Simulation, e: Enemy, boss: Pick<BossPlan, "armor" | "pieces">): string[] {
    const anchor = enemyBodyId(e.id);
    if (!this.world.has(anchor) || boss.pieces <= 0) return [];
    const policy = this.policyAt(sim, e.x, e.y).effective;
    if (!policy.mechanisms || !policy.dynamicProps) return [];
    const info = ARMOR[boss.armor],
      palette = sim.adventure.state.townLand % PALETTES,
      areaId = this.areaAt(sim, e.x, e.y),
      blocked = solidTerrain(sim.world),
      out: string[] = [];
    for (const p of armorPieces(boss.armor, boss.pieces)) {
      const id = `prop-armor-${e.id}-${p.k}`;
      if (this.world.has(id)) continue;
      let angle = p.angle,
        x = e.x,
        y = e.y;
      for (let t = 0; t < 12; t++) {
        x = round(e.x + Math.cos(angle) * (info.rest - 2));
        y = round(e.y + Math.sin(angle) * (info.rest - 2));
        if (!blocked(x, y, 7)) break;
        angle += Math.PI / 6;
      }
      const recipe = propRecipe(id, info.family, palette, x, y, areaId, {
        angle: round(angle),
        motion: "dynamic",
      });
      this.world.spawn(recipe);
      this.track(recipe);
      const r = this.showcase.add({
        kind: "mount",
        body: id,
        x: round(e.x),
        y: round(e.y),
        anchor,
        rest: info.rest,
        stiffness: info.stiffness,
        breakLoad: info.breakLoad,
        until: MOUNT_UNTIL,
        born: sim.tick,
        owner: anchor,
        team: "enemy",
      });
      if (r) out.push(id);
    }
    if (out.length)
      this.showcase.emit({
        tick: sim.tick,
        text: `mount:armed:${boss.armor}`,
        owner: anchor,
        x: round(e.x),
        y: round(e.y),
        amount: out.length,
      });
    this.plants = null;
    return out;
  }
  /** Mounted armor pieces still within reach of their warden. */
  armorPieces(e: Enemy): string[] {
    const anchor = enemyBodyId(e.id),
      out: string[] = [];
    for (const r of this.showcase.view()) {
      if (r.kind !== "mount" || r.anchor !== anchor || !this.world.has(r.body)) continue;
      const m = this.world.motionOf(r.body);
      if (Math.hypot(m.x - e.x, m.y - e.y) <= ARMOR_RULES.reach) out.push(r.body);
    }
    return out.sort();
  }
  /** A blinking warden takes its mounted armor along (the tethers would otherwise tear). */
  carryArmor(e: Enemy, dx: number, dy: number): void {
    const anchor = enemyBodyId(e.id);
    for (const r of this.showcase.list())
      if (r.kind === "mount" && r.anchor === anchor && this.world.has(r.body)) {
        const m = this.world.motionOf(r.body);
        this.world.place(r.body, round(m.x + dx), round(m.y + dy));
      }
  }
  /** Share of damage a warden still takes through its mounted armor (1 when bare). */
  armorFactor(e: Enemy): number {
    return 1 - ARMOR_RULES.reduction * Math.min(this.armorPieces(e).length, ARMOR_RULES.maxPieces);
  }
  /** M10 Bloom Tyrant's lash: an elastic vine from the warden to a caught traveler. */
  lash(sim: Simulation, warden: Enemy, player: string): Restraint | null {
    const body = playerBodyId(player),
      anchor = enemyBodyId(warden.id);
    if (!this.world.has(body) || !this.world.has(anchor)) return null;
    if (!this.world.policyOf(body).effective.mechanisms) return null;
    const r = this.showcase.add({
      kind: "lash",
      body,
      x: round(warden.x),
      y: round(warden.y),
      anchor,
      rest: LASH.rest,
      stiffness: LASH.stiffness,
      breakLoad: LASH.breakLoad,
      until: sim.tick + LASH.ticks,
      born: sim.tick,
      owner: anchor,
      team: "enemy",
    });
    if (r) {
      const at = this.world.motionOf(body);
      this.showcase.emit({
        tick: sim.tick,
        text: "lash:caught",
        owner: player,
        x: round(at.x),
        y: round(at.y),
        amount: 1,
      });
    }
    return r;
  }
  /** A dash tears free of every lash holding this traveler; returns the wardens it frees from. */
  breakLashes(sim: Simulation, player: string): string[] {
    const body = playerBodyId(player),
      wardens: string[] = [];
    for (const r of this.showcase.holding(body))
      if (r.kind === "lash") {
        wardens.push(r.anchor);
        this.showcase.remove(r.id, "lash:snapped", sim.tick, this.world.motionOf(body));
      }
    return wardens;
  }
  /**
   * A traveler moved by a rift carries the prop they hold. An unanchored jointed part travels
   * whole, with its joints and motion; an anchored one cannot follow, so the hold is released.
   */
  carry(sim: Simulation, player: string, dx: number, dy: number): void {
    const held = this.combat.holding(player);
    if (!held || !this.world.has(held)) return;
    const part = this.world.partOf(held);
    if (part?.anchored && part.size > 1) {
      this.combat.release(sim, this.world, player, false);
      return;
    }
    this.world.transport(this.world.partMembers(held), dx, dy);
  }
  private breakProp(
    sim: Simulation,
    pose: BodyPose,
    hitAngle: number,
    attack: PropAttack,
  ): DestroyedRecord {
    const lifetime = Math.round(pose.policy.values.debrisLifetime * 60),
      pieces = fracture(pose, hitAngle, sim.tick, lifetime),
      family = FAMILIES[pose.blueprint!.family];
    this.world.remove(pose.id);
    for (const piece of pieces) {
      this.world.spawn(piece.recipe);
      const spawned = this.world.pose(piece.recipe.id);
      if (piece.recipe.motion === "dynamic" && !spawned.frozen) {
        this.world.motion(piece.recipe.id, piece.vx, piece.vy, piece.angularVelocity);
        // Flying pieces belong to whoever broke the parent (M06 impact ownership).
        this.combat.instigate(
          piece.recipe.id,
          attack.owner,
          attack.team ?? "party",
          attack.cause,
          sim.tick,
        );
      }
      this.track(piece.recipe);
    }
    // Rewards scale with the prop's own clearing, like that area's enemies.
    const area = Number(/^area-(\d+)$/.exec(pose.areaId ?? "")?.[1] ?? sim.adventure.state.area);
    const record: DestroyedRecord = {
      id: pose.id,
      family: pose.blueprint!.family,
      palette: pose.blueprint!.palette,
      material: pose.material!,
      x: pose.x,
      y: pose.y,
      angle: pose.angle,
      tick: sim.tick,
      owner: attack.owner,
      cause: attack.cause,
      reward: family.reward > 0 ? Math.round(family.reward * (1 + Math.min(area, 500) * 0.13)) : 0,
      pieces: pieces.map((p) => p.recipe.id),
    };
    this.destroyed.set(record.id, record);
    this.plants = null;
    // Containers spill, sources release, volatiles detonate, fire carries into the pieces.
    this.reactions.broke(
      this.reactionHost(sim),
      {
        id: pose.id,
        x: pose.x,
        y: pose.y,
        areaId: pose.areaId ?? this.areaAt(sim, pose.x, pose.y),
        ...(pose.material ? { material: pose.material } : {}),
        family: pose.blueprint!.family,
      },
      record.pieces,
      {
        owner: attack.owner,
        team: attack.team ?? "party",
        cause: attack.cause,
        ...(attack.chain ? { chain: attack.chain } : {}),
      },
    );
    return structuredClone(record);
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
      destroyed: this.destroyedRecords(),
      combat: this.combat.save(),
      mechanisms: this.mechanisms.save(),
      reactions: this.reactions.save(),
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
  save(portable = false): AdventurePhysicsSnapshot {
    this.showcase.prune((id) => this.world.has(id));
    return {
      version: 9,
      backend: RAPIER_VERSION,
      landId: this.landId,
      run: this.run,
      seed: this.seed,
      world: this.world.save(portable),
      terrainChunks: this.terrain.save(),
      ambient: [...this.ambient.values()].map((sample) => ({
        ...sample,
        regions: [...sample.regions],
      })),
      archives: structuredClone([...this.archives.values()]),
      navigation: structuredClone([...this.navigation.values()]),
      appliedTransition: this.appliedTransition,
      pendingTerrain: this.terrain.pending(this.sourceWorld),
      destroyed: this.destroyedRecords(),
      combat: this.combat.save(),
      mechanisms: this.mechanisms.save(),
      reactions: this.reactions.save(),
      rigs: this.rigs.save(),
      showcase: this.showcase.save(),
      encounters: { grammar: this.grammar, areas: structuredClone(this.encounters) },
    };
  }
  static restore(sim: Simulation, snapshot: AdventurePhysicsSnapshot): AdventurePhysics {
    const migrated = ![3, 4, 5, 6, 7, 8, 9].includes(snapshot?.version);
    snapshot = upgradeAdventurePhysics(snapshot, sim);
    validateAdventurePhysics(snapshot, sim);
    const result = new AdventurePhysics(sim);
    result.world.dispose();
    try {
      result.world = PhysicsWorld.restore(snapshot.world);
      result.landId = snapshot.landId;
      result.run = snapshot.run;
      result.seed = snapshot.seed;
      result.terrain.restore(
        sim.world,
        result.world,
        snapshot.terrainChunks,
        snapshot.pendingTerrain,
      );
      result.ambient = new Map(snapshot.ambient.map((s) => [s.slot, structuredClone(s)]));
      result.archives = new Map(snapshot.archives.map((s) => [s.id, structuredClone(s)]));
      result.destroyed = new Map((snapshot.destroyed ?? []).map((d) => [d.id, structuredClone(d)]));
      result.combat.restore(snapshot.combat);
      result.mechanisms.restore(snapshot.mechanisms);
      result.reactions.restore(snapshot.reactions);
      result.rigs.restore(snapshot.rigs);
      result.showcase.restore(snapshot.showcase);
      // Lands saved before M11 keep their content: no generated encounter is added to them.
      result.grammar = snapshot.encounters?.grammar ?? false;
      result.encounters = structuredClone(snapshot.encounters?.areas ?? []);
      for (const assembly of result.world.assemblyList()) result.mechanisms.track(assembly);
      for (const id of result.world.ids()) {
        const pose = result.world.pose(id);
        if (pose.role === "prop") result.track(pose);
      }
      if (migrated) {
        // Content added by M05 did not exist in the saved land: give it fresh default state.
        const s = sim.adventure.state,
          palette = s.townLand % PALETTES,
          blocked = solidTerrain(sim.world);
        for (let i = 0; i < 4; i++)
          for (const recipe of clearingProps(
            areaRecipe(s.seed, s.townLand * 4 + i + 1),
            palette,
            blocked,
          ))
            if (!result.world.has(recipe.id)) result.world.spawn(recipe);
      }
      // M07 mechanisms did not exist in older checkpoints of this land: add them once.
      if (snapshot.version < 5) result.ensureMechanisms(sim);
      // M08 reaction yards and wind lanes did not exist in older checkpoints: add them once.
      if (snapshot.version < 6) result.ensureReactions(sim, true);
      // M10 town scene, set pieces and regions likewise.
      if (snapshot.version < 8) {
        result.world.reauthor(layout(sim, false), M10_REPLACED);
        result.ensureShowcase(sim, true);
        result.world.settle();
      }
      result.navigation = new Map(snapshot.navigation.map((s) => [s.id, structuredClone(s)]));
      result.appliedTransition = snapshot.appliedTransition;
      result.actors = new Set(
        result.world.ids().filter((id) => id.startsWith("player-") || id.startsWith("enemy-")),
      );
      for (const id of result.world.ids()) {
        const pose = result.world.pose(id);
        if (pose.role === "terrain" && !snapshot.pendingTerrain) {
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
        const expected = new Map<
          string,
          { x: number; y: number; radius: number; boss?: boolean }
        >();
        for (const p of sim.players.values()) expected.set(playerBodyId(p.id), p);
        for (const e of sim.adventure.state.enemies)
          if (e.hp > 0) expected.set(enemyBodyId(e.id), e);
        for (const id of result.actors)
          if (!expected.has(id)) throw new Error("Ghost physical actor");
        for (const [id, entity] of expected) {
          if (!result.world.has(id)) throw new Error("Missing physical actor");
          const pose = result.world.pose(id);
          const kind = id.startsWith("player-") ? "player" : entity.boss ? "boss" : "monster";
          if (
            pose.role !== "actor" ||
            pose.actorKind !== kind ||
            pose.shape.kind !== "circle" ||
            pose.shape.radius !== entity.radius
          )
            throw new Error("Physical/game actor blueprint mismatch");
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
function velocityOf(world: PhysicsWorld, id: string) {
  const m = world.motionOf(id);
  return { vx: m.vx, vy: m.vy, angularVelocity: m.angularVelocity };
}
const landPalette = (landId: string) => Number(landId.split("-")[2]) % PALETTES;
function annotateLegacy<T extends BodyRecipe>(recipe: T, palette: number): T {
  const legacy = legacyBlueprint(recipe.id, palette);
  return legacy && !recipe.blueprint ? { ...recipe, ...legacy } : recipe;
}
/** A saved pose lists its recipe keys first; keep that order so semantic/binary checks match. */
function annotateState(state: BodyPose, recipe: BodyRecipe): BodyPose {
  if (state.blueprint || !recipe.blueprint) return state;
  const out: Record<string, unknown> = {},
    source = state as unknown as Record<string, unknown>;
  for (const key of Object.keys(recipe))
    out[key] = key === "material" || key === "blueprint" ? recipe[key] : source[key];
  for (const [key, value] of Object.entries(source)) if (!(key in out)) out[key] = value;
  return out as unknown as BodyPose;
}
/**
 * M03/M04 envelopes predate materials and destruction. Annotate their crates/wheels, start
 * empty destroyed registries and add M05 clearing props to archived lands as fresh content.
 */
export function upgradeAdventurePhysics(
  snapshot: AdventurePhysicsSnapshot,
  sim?: Simulation,
): AdventurePhysicsSnapshot {
  if (!snapshot || snapshot.version >= 3 || ![1, 2].includes(snapshot.version)) return snapshot;
  const upgraded = structuredClone(snapshot);
  upgraded.world = upgradePolicySamples(upgraded.world);
  if (typeof upgraded.landId !== "string" || !Array.isArray(upgraded.world?.bodies))
    return upgraded;
  const palette = landPalette(upgraded.landId);
  for (const entry of upgraded.world.bodies) {
    if (!entry?.recipe) continue;
    entry.recipe = annotateLegacy(entry.recipe, palette);
    if (entry.state) entry.state = annotateState(entry.state, entry.recipe);
  }
  upgraded.destroyed = [];
  for (const archive of Array.isArray(upgraded.archives) ? upgraded.archives : []) {
    if (!archive || typeof archive.id !== "string" || !Array.isArray(archive.props)) continue;
    const archivePalette = landPalette(archive.id);
    archive.props = archive.props.map((p) => annotateLegacy(p, archivePalette));
    archive.destroyed = [];
    if (!sim) continue;
    const land = Number(archive.id.split("-")[2]),
      present = new Set(archive.props.map((p) => p.id)),
      terrain = new World(sim.world.seed);
    if (Array.isArray(archive.patches)) terrain.setPatches(archive.patches);
    const blocked = solidTerrain(terrain);
    for (let i = 0; i < 4; i++)
      for (const recipe of clearingProps(
        areaRecipe(sim.adventure.state.seed, land * 4 + i + 1),
        archivePalette,
        blocked,
      ))
        if (!present.has(recipe.id))
          archive.props.push({
            ...recipe,
            angle: recipe.angle ?? 0,
            vx: 0,
            vy: 0,
            angularVelocity: 0,
            sleeping: false,
            frozen: false,
            reactivationBlocked: false,
            ccdEnabled: recipe.ccd ?? true,
            policy: undefined as unknown as BodyPose["policy"],
          });
  }
  return upgraded;
}
function validateEncounterState(state: EncounterState | undefined): void {
  if (
    !state ||
    typeof state !== "object" ||
    Object.keys(state).some((k) => !["grammar", "areas"].includes(k)) ||
    typeof state.grammar !== "boolean" ||
    !Array.isArray(state.areas) ||
    state.areas.length > 4
  )
    throw new Error("Invalid encounter state");
  for (const m of state.areas) validateRealized(m);
}
function validateCombat(
  state: CombatPhysicsState | undefined,
  entries: Map<string, { recipe: BodyRecipe; held?: boolean }>,
  sim?: Simulation,
): void {
  const id = (value: unknown) => typeof value === "string" && /^[\w-]{1,160}$/.test(value);
  const tick = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= -1;
  const team = (value: unknown) => ["party", "enemy", "world"].includes(value as string);
  if (
    !state ||
    typeof state !== "object" ||
    !Array.isArray(state.instigators) ||
    state.instigators.length > 4096 ||
    state.instigators.some(
      (i) =>
        !i ||
        !id(i.id) ||
        typeof i.owner !== "string" ||
        i.owner.length > 80 ||
        !team(i.team) ||
        typeof i.cause !== "string" ||
        i.cause.length > 32 ||
        !tick(i.until),
    ) ||
    !Array.isArray(state.impacts) ||
    state.impacts.length > 4096 ||
    state.impacts.some(
      (i) =>
        !i ||
        typeof i.id !== "string" ||
        !id(i.prop) ||
        !id(i.target) ||
        typeof i.owner !== "string" ||
        !team(i.team) ||
        !tick(i.tick) ||
        ![i.damage, i.closing, i.x, i.y, i.angle].every(Number.isFinite) ||
        i.damage < 0,
    ) ||
    !Array.isArray(state.suppressed) ||
    state.suppressed.length > 100_000 ||
    state.suppressed.some(
      (s) => !Array.isArray(s) || s.length !== 2 || typeof s[0] !== "string" || !tick(s[1]),
    ) ||
    !Array.isArray(state.holds) ||
    state.holds.length > 8 ||
    state.holds.some(
      (h) =>
        !h ||
        typeof h.player !== "string" ||
        !id(h.id) ||
        !tick(h.since) ||
        !entries.has(h.id) ||
        (sim !== undefined && !sim.players.has(h.player)),
    ) ||
    new Set(state.holds.map((h) => h.player)).size !== state.holds.length ||
    new Set(state.holds.map((h) => h.id)).size !== state.holds.length ||
    !Array.isArray(state.settled) ||
    state.settled.some((n) => !Number.isSafeInteger(n))
  )
    throw new Error("Invalid physical combat state");
  const held = new Set(state.holds.map((h) => h.id));
  for (const [key, entry] of entries)
    if ((entry.held === true) !== held.has(key)) throw new Error("Held prop flag mismatch");
}
function validateDestroyed(records: unknown, label: string): DestroyedRecord[] {
  if (!Array.isArray(records) || records.length > 100_000) throw new Error(`Invalid ${label}`);
  const ids = new Set<string>();
  for (const d of records as DestroyedRecord[]) {
    if (
      !d ||
      typeof d !== "object" ||
      Object.keys(d).some(
        (key) =>
          ![
            "id",
            "family",
            "palette",
            "material",
            "x",
            "y",
            "angle",
            "tick",
            "owner",
            "cause",
            "reward",
            "pieces",
          ].includes(key),
      ) ||
      typeof d.id !== "string" ||
      !/^[\w-]{1,160}$/.test(d.id) ||
      ids.has(d.id) ||
      !(PROP_FAMILIES as readonly string[]).includes(d.family) ||
      FAMILIES[d.family].toughness <= 0 ||
      !Number.isInteger(d.palette) ||
      d.palette < 0 ||
      d.palette >= PALETTES ||
      !isMaterial(d.material) ||
      ![d.x, d.y].every((n) => Number.isFinite(n) && Math.abs(n) <= WORLD_LIMIT) ||
      !Number.isFinite(d.angle) ||
      !Number.isSafeInteger(d.tick) ||
      d.tick < 0 ||
      typeof d.owner !== "string" ||
      d.owner.length > 160 ||
      typeof d.cause !== "string" ||
      d.cause.length > 80 ||
      !Number.isSafeInteger(d.reward) ||
      d.reward < 0 ||
      !Array.isArray(d.pieces) ||
      d.pieces.length > 16 ||
      d.pieces.some((id) => typeof id !== "string" || !id.startsWith(`${d.id}-`))
    )
      throw new Error(`Invalid ${label}`);
    ids.add(d.id);
  }
  return records as DestroyedRecord[];
}
export function validateAdventurePhysics(
  snapshot: AdventurePhysicsSnapshot,
  sim?: Simulation,
): void {
  if (
    !snapshot ||
    ![1, 2, 3, 4, 5, 6, 7, 8, 9].includes(snapshot.version) ||
    (snapshot.version === 2 && snapshot.world?.version !== 4) ||
    (snapshot.version === 3 && snapshot.world?.version !== 5) ||
    (snapshot.version === 4 && snapshot.world?.version !== 6) ||
    (snapshot.version === 5 && snapshot.world?.version !== 7) ||
    (snapshot.version === 6 && snapshot.world?.version !== 8) ||
    (snapshot.version === 7 && snapshot.world?.version !== 9) ||
    (snapshot.version === 8 && snapshot.world?.version !== 9) ||
    (snapshot.version === 9 && snapshot.world?.version !== 9) ||
    snapshot.backend !== snapshot.world?.backend ||
    (snapshot.version === 1 && snapshot.backend !== RAPIER_VERSION) ||
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
  if (
    !Number.isInteger(snapshot.appliedTransition) ||
    snapshot.appliedTransition < -1 ||
    typeof snapshot.pendingTerrain !== "boolean"
  )
    throw new Error("Invalid physical transition sample");
  const entries = new Map(snapshot.world.bodies.map((entry) => [entry.recipe.id, entry]));
  if (snapshot.version >= 3)
    for (const d of validateDestroyed(snapshot.destroyed, "destroyed prop record"))
      if (entries.has(d.id)) throw new Error("Destroyed prop still present");
  if (snapshot.version >= 4) validateCombat(snapshot.combat, entries, sim);
  if (snapshot.version >= 5)
    validateMechanisms(snapshot.mechanisms, snapshot.world.assemblies ?? []);
  else if (snapshot.mechanisms !== undefined)
    throw new Error("Mechanism state requires envelope 5");
  if (snapshot.version >= 6) {
    if (!snapshot.reactions) throw new Error("Missing reaction state");
    validateReactions(snapshot.reactions);
    for (const status of snapshot.reactions.statuses)
      if (!entries.has(status.id)) throw new Error("Reaction status for a missing body");
  } else if (snapshot.reactions !== undefined)
    throw new Error("Reaction state requires envelope 6");
  if (snapshot.version >= 7) {
    if (!snapshot.rigs) throw new Error("Missing rig state");
    validateRigState(snapshot.rigs, (id) => entries.has(id));
  } else if (snapshot.rigs !== undefined) throw new Error("Rig state requires envelope 7");
  if (snapshot.version >= 8) {
    if (!snapshot.showcase) throw new Error("Missing showcase state");
    validateShowcase(snapshot.showcase, (id) => entries.has(id));
  } else if (snapshot.showcase !== undefined) throw new Error("Showcase state requires envelope 8");
  if (snapshot.version >= 9) validateEncounterState(snapshot.encounters);
  else if (snapshot.encounters !== undefined)
    throw new Error("Encounter state requires envelope 9");
  for (const archive of snapshot.archives)
    if (archive?.encounters !== undefined) validateEncounterState(archive.encounters);
  for (const entry of entries.values())
    if (
      entry.recipe.actorKind === "npc" &&
      !TOWN_NPCS.some((n) => npcBodyId(n.id) === entry.recipe.id)
    )
      throw new Error("Unknown townsfolk body");
  // A loot body may outlive its drop until the next solve (collected between ticks); drop ids
  // are never reused, so the solve removes it without ambiguity.
  for (const entry of entries.values())
    if (entry.recipe.actorKind === "loot" && !/^loot-\d+$/.test(entry.recipe.id))
      throw new Error("Invalid physical loot identity");
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
    const destroyed =
      snapshot.version >= 3 ? validateDestroyed(a.destroyed, "archived destroyed record") : [];
    const gone = new Set(destroyed.map((d) => d.id));
    for (const p of a.props) {
      if (gone.has(p?.id)) throw new Error("Archived destroyed prop still present");
      validateBody(p, true);
      if (
        !p ||
        p.role !== "prop" ||
        ![p.x, p.y, p.angle, p.vx, p.vy, p.angularVelocity].every(Number.isFinite)
      )
        throw new Error("Invalid archived prop");
    }
    if (a.showcase !== undefined) {
      if (snapshot.version < 8) throw new Error("Archived showcase requires envelope 8");
      validateShowcase(a.showcase, () => false);
    }
    // A land archived before M08 has no reaction state; its yard is added when it is entered.
    if (a.reactions !== undefined) {
      if (snapshot.version < 6) throw new Error("Archived reactions require envelope 6");
      validateReactions(a.reactions, true);
      const ids = new Set(a.props.map((p) => p.id));
      for (const status of a.reactions.statuses)
        if (!ids.has(status.id)) throw new Error("Archived reaction status for a missing prop");
    }
    // A land archived before M07 has no assemblies yet; they are added when it is entered.
    if (snapshot.version < 5 || a.assemblies === undefined) {
      if (a.assemblies !== undefined || a.joints !== undefined || a.mechanisms !== undefined)
        throw new Error("Archived assemblies require envelope 5");
      if (a.props.some((p) => p.assembly !== undefined))
        throw new Error("Archived member without assembly");
      continue;
    }
    if (!Array.isArray(a.assemblies) || !Array.isArray(a.joints))
      throw new Error("Invalid archived assemblies");
    const props = new Map(a.props.map((p) => [p.id, p]));
    const kinds = new Set<string>();
    for (const assembly of a.assemblies) {
      validateAssembly(assembly);
      if (kinds.has(assembly.id)) throw new Error("Duplicate archived assembly");
      kinds.add(assembly.id);
      for (const id of assembly.members)
        if (props.get(id)?.assembly !== assembly.id)
          throw new Error("Archived assembly member missing");
    }
    for (const p of a.props)
      if (
        p.assembly !== undefined &&
        !a.assemblies.some((x) => x.id === p.assembly && x.members.includes(p.id))
      )
        throw new Error("Archived member without assembly");
    const jointIds = new Set<string>();
    for (const joint of a.joints) {
      validateJointEntry(joint);
      const assembly = a.assemblies.find((x) => x.id === joint.recipe.assembly);
      if (
        !assembly ||
        !assembly.members.includes(joint.recipe.a) ||
        !assembly.members.includes(joint.recipe.b) ||
        jointIds.has(joint.recipe.id)
      )
        throw new Error("Invalid archived joint");
      jointIds.add(joint.recipe.id);
    }
    validateMechanisms(a.mechanisms, a.assemblies);
  }
}
