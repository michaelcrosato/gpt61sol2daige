import { hash } from "../engine/math.ts";
import {
  type AreaRecipe,
  MECHANICS,
  type MechanicId,
  RIGS,
  type RigKind,
  THEMES,
  type ThemeId,
  themeOf,
} from "./content.ts";
import { WARDENS, type WardenMove, type WardenWeakness } from "./wardens.ts";

/**
 * M11 physical encounter grammar for generated areas (index > 8). A plan is a pure function of
 * the area recipe: which modules (kits of M05–M10 scenery, assemblies, fields and surfaces)
 * stand in which slots of the clearing, which compatibility rule binds each cluster of them
 * into an intentional combination, the regional profile of each cluster, the combat pockets
 * monsters gather in, the essential and optional routes, and the warden's composed body,
 * signature moves, armor and arena. `src/physics/encounters.ts` realizes a plan into bodies
 * (with placement checks and fallbacks); the land's saved physical state then owns every
 * mutation, and nothing is ever regenerated over it.
 */
export type EncounterTag =
  | "conductor"
  | "water"
  | "ignition"
  | "fuel"
  | "fuse"
  | "timber"
  | "volatile"
  | "loose"
  | "gravity"
  | "wind"
  | "portal"
  | "cart"
  | "swing"
  | "launcher"
  | "brittle"
  | "spark"
  | "thorns"
  | "restraint"
  | "resonance"
  | "cache";
export const MODULE_IDS = [
  "storm-coil",
  "glass-garden",
  "flood-basin",
  "brazier-camp",
  "oil-cellar",
  "brush-fuse",
  "timber-stockade",
  "thorn-hedge",
  "powder-store",
  "rubble-field",
  "maelstrom",
  "gale-lane",
  "fan-tower",
  "chain-gallows",
  "launcher-nest",
  "cargo-train",
  "vine-tether",
  "gate-pen",
] as const;
export type ModuleId = (typeof MODULE_IDS)[number];
export interface ModuleInfo {
  name: string;
  summary: string;
  tags: readonly EncounterTag[];
  /** What it is built from, for the catalog and documentation. */
  parts: string;
  /** Policy switches its optional physical behavior follows. */
  controls: readonly string[];
}
export const MODULES: Record<ModuleId, ModuleInfo> = {
  "storm-coil": {
    name: "Storm coil",
    summary: "A copper coil and a line of conductor rods: a struck coil discharges down the rods.",
    tags: ["conductor"],
    parts: "coil, 2 rods",
    controls: ["materialReactions", "chainReactions"],
  },
  "glass-garden": {
    name: "Glass garden",
    summary: "Two brittle glass pylons holding charge: break one and it releases a discharge.",
    tags: ["brittle", "spark"],
    parts: "2 pylons",
    controls: ["destruction", "materialReactions"],
  },
  "flood-basin": {
    name: "Flood basin",
    summary: "A standing pool and two water casks: what wades it is wet and conducts.",
    tags: ["water"],
    parts: "permanent water surface, 2 casks",
    controls: ["materialReactions"],
  },
  "brazier-camp": {
    name: "Brazier camp",
    summary: "A lit brazier with two oil jars: shove a jar into the coals for a burning slick.",
    tags: ["ignition", "fuel"],
    parts: "brazier, 2 oil jars",
    controls: ["materialReactions", "chainReactions"],
  },
  "oil-cellar": {
    name: "Oil cellar",
    summary: "Stacked oil jars and a lantern: a broken lantern spills its flame into the oil.",
    tags: ["fuel", "ignition"],
    parts: "3 oil jars, lantern",
    controls: ["materialReactions", "chainReactions"],
  },
  "brush-fuse": {
    name: "Brush fuse",
    summary: "A trail of tinder-dry brush: fire runs along it to whatever lies at its end.",
    tags: ["fuse"],
    parts: "5 dry brush",
    controls: ["materialReactions", "chainReactions"],
  },
  "timber-stockade": {
    name: "Timber stockade",
    summary: "A weakened four-board stockade around a cache: burn or batter it open.",
    tags: ["timber", "cache"],
    parts: "4 weakened barricades, chest",
    controls: ["destruction", "materialReactions"],
  },
  "thorn-hedge": {
    name: "Thorn hedge",
    summary: "A line of fragile thorn hedges sheltering a pot cache; they burn like tinder.",
    tags: ["thorns", "cache"],
    parts: "3 hedges, pot",
    controls: ["destruction", "materialReactions"],
  },
  "powder-store": {
    name: "Powder store",
    summary: "Two powder barrels and a crate: fire, shock, a blast or a hard knock sets them off.",
    tags: ["volatile"],
    parts: "2 volatile barrels, crate",
    controls: ["materialReactions", "chainReactions", "destruction"],
  },
  "rubble-field": {
    name: "Rubble field",
    summary: "Loose stones and a log: mass that fields, blows and launchers throw.",
    tags: ["loose"],
    parts: "3 stones, log",
    controls: ["dynamicProps", "impactDamage"],
  },
  maelstrom: {
    name: "Maelstrom",
    summary: "A permanent vortex that swirls monsters and loose mass around its eye.",
    tags: ["gravity"],
    parts: "permanent vortex field",
    controls: ["environmentalForces"],
  },
  "gale-lane": {
    name: "Gale lane",
    summary: "A permanent wind lane with a driven vane: it carries what lies in it.",
    tags: ["wind"],
    parts: "permanent wind lane, vane assembly",
    controls: ["environmentalForces", "mechanisms"],
  },
  "fan-tower": {
    name: "Fan tower",
    summary: "A mill fan: strike it and it blows a gale along its facing.",
    tags: ["wind"],
    parts: "fan, 2 baskets",
    controls: ["environmentalForces"],
  },
  "chain-gallows": {
    name: "Chain gallows",
    summary: "An iron ball on a hinged chain: swing it into what stands in its arc.",
    tags: ["swing"],
    parts: "chain assembly (post, 4 links, ball)",
    controls: ["mechanisms", "jointBreakage", "impactDamage"],
  },
  "launcher-nest": {
    name: "Launcher nest",
    summary: "A sprung launcher with a stone on its sled path: cock it and let go.",
    tags: ["launcher", "loose"],
    parts: "launcher assembly, stone",
    controls: ["mechanisms", "impactDamage"],
  },
  "cargo-train": {
    name: "Cargo train",
    summary:
      "An unanchored wagon towing a crate and a barrel on ropes: it travels as one assembly.",
    tags: ["cart", "loose"],
    parts: "cart assembly (wagon, crate, barrel, 2 ropes)",
    controls: ["mechanisms", "dynamicProps"],
  },
  "vine-tether": {
    name: "Vine tether",
    summary: "A seed pod on a vine of rope segments: tug it, swing it or cut it free.",
    tags: ["restraint", "swing"],
    parts: "vine assembly (root, 6 segments, pod)",
    controls: ["mechanisms", "jointBreakage"],
  },
  "gate-pen": {
    name: "Gate pen",
    summary: "A reward chest penned behind a sprung gate that latches open.",
    tags: ["cache"],
    parts: "gate assembly, latch post, 3 fences, chest",
    controls: ["mechanisms", "jointBreakage"],
  },
};
/** Tags an area mechanic contributes (its M10 set pieces and activation). */
export const MECHANIC_TAGS: Record<MechanicId, readonly EncounterTag[]> = {
  bramble: ["thorns"],
  wind: ["wind"],
  glass: ["conductor", "water", "spark"],
  echo: ["resonance"],
  cinder: ["ignition", "fuse", "timber"],
  blood: ["restraint"],
  gravity: ["gravity"],
  rift: ["portal"],
};
export const COMBINATION_IDS = [
  "storm-pool",
  "spark-pool",
  "fire-stockade",
  "oil-flare",
  "powder-fuse",
  "thorn-fire",
  "quench-fuse",
  "maelstrom-rubble",
  "vortex-powder",
  "gale-debris",
  "launch-powder",
  "ram-stockade",
  "swing-glass",
  "rift-cart",
] as const;
export type CombinationId = (typeof COMBINATION_IDS)[number];
export type RegionProfileId = "charged" | "tinder" | "gale" | "heavy" | "freight";
/** M11 regional profiles: each cluster's region exaggerates the reaction its combination uses. */
export const PROFILES: Record<RegionProfileId, { name: string; values: Record<string, number> }> = {
  charged: { name: "Charged ground", values: { reactionStrength: 1.6 } },
  tinder: { name: "Tinder-dry", values: { reactionStrength: 1.5, materialDurability: 0.8 } },
  gale: { name: "Gale-swept", values: { fieldStrength: 1.6 } },
  heavy: { name: "Heavy blows", values: { impulseStrength: 1.4, impactStrength: 1.5 } },
  freight: { name: "Rift-worn", values: { impulseStrength: 1.2 } },
};
export interface CombinationInfo {
  name: string;
  /** The intentional interaction this rule produces. */
  summary: string;
  /** Modules in cluster order (along the chain); each must carry its role's tag. */
  roles: readonly { tag: EncounterTag; modules: readonly ModuleId[] }[];
  /** An area mechanic the cluster stands beside instead of a ring slot (rift freight). */
  anchor?: MechanicId;
  /** Area mechanics that favor this combination. */
  affinity: readonly MechanicId[];
  profile: RegionProfileId;
  /**
   * M08 reaction rules a chain records (or M07/M10 hooks), in causal order. Timer damage
   * (`burn`) is not a chain record: a stockade burning through is its visible outcome.
   */
  chain: readonly string[];
  /** How a traveler sets it off. */
  start: string;
}
export const COMBINATIONS: Record<CombinationId, CombinationInfo> = {
  "storm-pool": {
    name: "Stormcatch pool",
    summary:
      "Conductor rods lead a struck coil's discharge into a standing pool: everything wading it is shocked.",
    roles: [
      { tag: "conductor", modules: ["storm-coil"] },
      { tag: "water", modules: ["flood-basin"] },
    ],
    affinity: ["glass", "wind"],
    profile: "charged",
    chain: ["conduct"],
    start: "strike the coil while monsters wade the pool",
  },
  "spark-pool": {
    name: "Shattered spark",
    summary:
      "Glass pylons stand in the pool's edge: break one and its charge runs through the water.",
    roles: [
      { tag: "spark", modules: ["glass-garden"] },
      { tag: "water", modules: ["flood-basin"] },
    ],
    affinity: ["glass", "echo"],
    profile: "charged",
    chain: ["release", "conduct"],
    start: "break a pylon",
  },
  "fire-stockade": {
    name: "Burning palisade",
    summary:
      "A brush fuse runs from the brazier camp to a weakened stockade: fire burns it open to its cache.",
    roles: [
      { tag: "ignition", modules: ["brazier-camp", "oil-cellar"] },
      { tag: "fuse", modules: ["brush-fuse"] },
      { tag: "timber", modules: ["timber-stockade"] },
    ],
    affinity: ["cinder", "bramble"],
    profile: "tinder",
    chain: ["ignite", "spread"],
    start: "light the fuse (a burning slick, a burning strike or a vent)",
  },
  "oil-flare": {
    name: "Oil flare",
    summary:
      "An oil cellar beside the brazier: a jar knocked into the coals bursts into a slick that flares through the stores.",
    roles: [
      { tag: "ignition", modules: ["brazier-camp"] },
      { tag: "fuel", modules: ["oil-cellar"] },
    ],
    affinity: ["cinder", "blood"],
    profile: "tinder",
    chain: ["ignite", "flare"],
    start: "shove or throw an oil jar into the brazier",
  },
  "powder-fuse": {
    name: "Powder trail",
    summary: "A brush fuse ends at a powder store: light it and clear the pocket before it blows.",
    roles: [
      { tag: "fuse", modules: ["brush-fuse"] },
      { tag: "volatile", modules: ["powder-store"] },
    ],
    affinity: ["cinder", "gravity"],
    profile: "tinder",
    chain: ["ignite", "spread", "detonate"],
    start: "light the fuse",
  },
  "thorn-fire": {
    name: "Briar blaze",
    summary:
      "A fuse feeds a line of thorn hedges: they burn into a wall of fire across the pocket.",
    roles: [
      { tag: "fuse", modules: ["brush-fuse"] },
      { tag: "thorns", modules: ["thorn-hedge"] },
    ],
    affinity: ["bramble", "cinder"],
    profile: "tinder",
    chain: ["ignite", "spread"],
    start: "light the fuse",
  },
  "quench-fuse": {
    name: "Quench trough",
    summary:
      "Water casks stand over a brush fuse: break one to douse a running fire before it reaches the stores.",
    roles: [
      { tag: "fuse", modules: ["brush-fuse"] },
      { tag: "water", modules: ["flood-basin"] },
    ],
    affinity: ["glass", "wind"],
    profile: "tinder",
    chain: ["ignite", "spill", "extinguish"],
    start: "light the fuse, then break a cask",
  },
  "maelstrom-rubble": {
    name: "Rubble maelstrom",
    summary:
      "Loose rubble sits on a vortex's rim: what wanders in is battered by the swirling mass.",
    roles: [
      { tag: "gravity", modules: ["maelstrom"] },
      { tag: "loose", modules: ["rubble-field"] },
    ],
    affinity: ["gravity", "wind"],
    profile: "gale",
    chain: ["vortex"],
    start: "lure monsters into the vortex",
  },
  "vortex-powder": {
    name: "Powder vortex",
    summary:
      "Powder barrels circle a vortex's eye with the pack it drags in: one spark sets them all off.",
    roles: [
      { tag: "gravity", modules: ["maelstrom"] },
      { tag: "volatile", modules: ["powder-store"] },
    ],
    affinity: ["gravity", "glass"],
    profile: "gale",
    chain: ["vortex", "detonate"],
    start: "lure monsters in, then fire, shock or blast a barrel",
  },
  "gale-debris": {
    name: "Debris gale",
    summary:
      "A wind lane starts in a rubble field: the gale rolls stones and logs into the pocket.",
    roles: [
      { tag: "wind", modules: ["gale-lane"] },
      { tag: "loose", modules: ["rubble-field"] },
    ],
    affinity: ["wind", "gravity"],
    profile: "gale",
    chain: ["lane"],
    start: "lure the pack down the lane's far end",
  },
  "launch-powder": {
    name: "Powder battery",
    summary:
      "A powder barrel waits on a sprung launcher's path: fire it into the pack and it bursts.",
    roles: [
      { tag: "launcher", modules: ["launcher-nest"] },
      { tag: "volatile", modules: ["powder-store"] },
    ],
    affinity: ["echo", "blood"],
    profile: "heavy",
    chain: ["launcher:fired", "detonate"],
    start: "cock the launcher (pull its sled back) and let go",
  },
  "ram-stockade": {
    name: "Battering launcher",
    summary: "A launcher aims its stone at a weakened stockade: fire it to batter the cache open.",
    roles: [
      { tag: "launcher", modules: ["launcher-nest"] },
      { tag: "timber", modules: ["timber-stockade"] },
    ],
    affinity: ["echo", "rift"],
    profile: "heavy",
    chain: ["launcher:fired", "impact"],
    start: "cock the launcher and let go",
  },
  "swing-glass": {
    name: "Wrecking ball",
    summary:
      "A chained ball hangs beside glass pylons: swing it through them and their charge arcs out.",
    roles: [
      { tag: "swing", modules: ["chain-gallows"] },
      { tag: "brittle", modules: ["glass-garden"] },
    ],
    affinity: ["glass", "blood"],
    profile: "heavy",
    chain: ["impact", "release", "conduct"],
    start: "swing the ball (strike, Whorl or a yank) into a pylon",
  },
  "rift-cart": {
    name: "Rift freight train",
    summary:
      "A cargo train stands on a Riftstep arch's pad: it rides through with the traveler, joints intact.",
    roles: [{ tag: "cart", modules: ["cargo-train"] }],
    anchor: "rift",
    affinity: ["rift"],
    profile: "freight",
    chain: ["freight:carried"],
    start: "use the arch",
  },
};
/** Standalone modules that give every generated area a jointed mechanism. */
const FILLERS: readonly ModuleId[] = ["chain-gallows", "vine-tether", "gate-pen", "fan-tower"];

// ---- Bosses ------------------------------------------------------------------------------

export const ARMOR_IDS = ["bark", "glass", "stone", "censer"] as const;
export type ArmorId = (typeof ARMOR_IDS)[number];
export interface ArmorInfo {
  name: string;
  /** Prop family of each mounted piece (M11 `plate`/`shard`, or a stone or a lantern). */
  family: "plate" | "shard" | "stone" | "lantern";
  summary: string;
  /** Mount tether: rest length, pull (1/s²) and the strain that snaps it. */
  rest: number;
  stiffness: number;
  breakLoad: number;
  /** How a traveler strips it. */
  counter: string;
}
export const ARMOR: Record<ArmorId, ArmorInfo> = {
  bark: {
    name: "Barkbound",
    family: "plate",
    summary: "Bark plates on short tethers: fire burns them away and blades chip them.",
    rest: 30,
    stiffness: 26,
    breakLoad: 190,
    counter: "fire (braziers, oil, a burning strike) or steady blows",
  },
  glass: {
    name: "Glassmantled",
    family: "shard",
    summary: "Glass shards orbiting on tethers: brittle to any heavy blow, shock or blast.",
    rest: 32,
    stiffness: 24,
    breakLoad: 260,
    counter: "shock, a blast, a swung ball or a launched prop",
  },
  stone: {
    name: "Stonehide",
    family: "stone",
    summary:
      "Two boulders chained close: only heavy impacts and blasts break them or tear them free.",
    rest: 30,
    stiffness: 30,
    breakLoad: 900,
    counter: "launched props, swinging weights and blasts",
  },
  censer: {
    name: "Censer-bearer",
    family: "lantern",
    summary:
      "Iron censers on long chains swing with it: they conduct shock and spill fire when broken.",
    rest: 40,
    stiffness: 18,
    breakLoad: 420,
    counter: "shock while it stands in water, or knock the censers loose",
  },
};
/**
 * Armor while mounted: each intact piece within reach removes this share of damage taken.
 * Mount break loads sit above a charging warden's drag on its pieces and below a hard yank
 * (a Whorl launch or a thrown prop): load = piece mass × (speed away + 4 × stretch).
 */
export const ARMOR_RULES = { reduction: 0.12, reach: 64, maxPieces: 4 } as const;
export const ARENA_IDS = [
  "arena-pillars",
  "arena-braziers",
  "arena-conductors",
  "arena-flood",
  "arena-weights",
  "arena-launcher",
  "arena-powder",
] as const;
export type ArenaId = (typeof ARENA_IDS)[number];
export const ARENA: Record<ArenaId, { name: string; summary: string; serves: string[] }> = {
  "arena-pillars": {
    name: "Pillar ring",
    summary: "Stone pillars around the warden's ground: a charge that hits one crashes.",
    serves: ["crash", "stone"],
  },
  "arena-braziers": {
    name: "Brazier ring",
    summary: "Braziers with brush at their feet: fire for bark armor and breath to catch.",
    serves: ["bark", "censer"],
  },
  "arena-conductors": {
    name: "Conductor pool",
    summary: "A pool under the warden with rods and a coil: shock it while it wades.",
    serves: ["shock", "censer", "glass"],
  },
  "arena-flood": {
    name: "Flood pool",
    summary: "A wide pool and water casks: douse a burning warden or wet it for shock.",
    serves: ["water", "shock"],
  },
  "arena-weights": {
    name: "Hanging weights",
    summary: "Chained balls on posts beside the warden's ground: swing them into it.",
    serves: ["impact", "glass", "stone"],
  },
  "arena-launcher": {
    name: "Siege launcher",
    summary: "A sprung launcher aimed across the warden's ground with a stone on its sled.",
    serves: ["impact", "stone", "glass"],
  },
  "arena-powder": {
    name: "Powder kegs",
    summary: "Powder barrels at the arena's edge: blasts strip armor and stagger the warden.",
    serves: ["bark", "stone", "glass"],
  },
};
export interface BossPlan {
  title: string;
  rig: RigKind;
  /** Composed signature moves, in rotation order (from the area's mechanics). */
  moves: WardenMove[];
  /** The union of the moves' weaknesses: any of them exposes the warden. */
  weaknesses: WardenWeakness[];
  armor: ArmorId;
  pieces: number;
  arena: ArenaId[];
}
/** The warden's body kind for an area (unchanged from M10 for authored and generated areas). */
export const bossRig = (index: number): RigKind =>
  (["brute", "stalker", "totem", "wraith", "brute", "crawler", "warden", "warden"] as const)[
    (index - 1) % 8
  ];

// ---- Plans -------------------------------------------------------------------------------

/** Cluster slots on the clearing: angle (rad, 0 = east toward the exit) and ring radius. */
export const SLOTS = [
  { angle: -Math.PI / 3, radius: 252 },
  { angle: (-2 * Math.PI) / 3, radius: 252 },
  { angle: Math.PI / 3, radius: 252 },
  { angle: (2 * Math.PI) / 3, radius: 252 },
  { angle: -Math.PI / 2, radius: 280 },
  { angle: Math.PI / 2, radius: 280 },
] as const;
/** The essential route: arrival, the warden's ground and the exit portal (clearing-relative). */
export const ROUTE_POINTS = {
  entry: { dx: -230, dy: 0 },
  warden: { dx: 130, dy: 0 },
  exit: { dx: 275, dy: 0 },
} as const;
export interface ClusterPlan {
  slot: number;
  /** Ranked combinations for this slot: the realization uses the first that places. */
  combos: CombinationId[];
  /** Ranked module choices per role of each candidate combination. */
  profile: RegionProfileId;
}
export interface EncounterPlan {
  version: 1;
  index: number;
  seed: number;
  theme: ThemeId;
  /** Tags the area's mechanics contribute. */
  tags: EncounterTag[];
  clusters: ClusterPlan[];
  /** A standalone mechanism module and its ranked alternates. */
  fillers: { slot: number; modules: ModuleId[] }[];
  /** Where waves gather: near each cluster, inward of it. */
  pockets: { x: number; y: number; radius: number; slot: number }[];
  routes: {
    id: string;
    required: boolean;
    points: { x: number; y: number }[];
    note: string;
  }[];
  boss: BossPlan;
}
const pick = <T>(list: readonly T[], seed: number, salt: number): T =>
  list[hash(salt, list.length, seed) % list.length];
/** Area-mechanic tags present in a recipe. */
export function recipeTags(recipe: Pick<AreaRecipe, "mechanics">): EncounterTag[] {
  return [...new Set(recipe.mechanics.flatMap((m) => MECHANIC_TAGS[m]))];
}
/** Whether a combination can stand in an area: an anchored one needs its mechanic. */
export function comboFits(id: CombinationId, recipe: Pick<AreaRecipe, "mechanics">): boolean {
  const anchor = COMBINATIONS[id].anchor;
  return !anchor || recipe.mechanics.includes(anchor);
}
/**
 * Rank combinations for an area: favored by its mechanics, varied by its seed. Anchored
 * combinations (rift freight) need their mechanic and come first when it is present.
 */
export function rankCombinations(recipe: Pick<AreaRecipe, "mechanics" | "seed">): CombinationId[] {
  const score = (id: CombinationId) => {
    const info = COMBINATIONS[id],
      favored = info.affinity.filter((m) => recipe.mechanics.includes(m)).length;
    return (
      (info.anchor ? 100 : 0) +
      favored * 6 +
      (hash(COMBINATION_IDS.indexOf(id), 71, recipe.seed) % 9)
    );
  };
  return COMBINATION_IDS.filter((id) => comboFits(id, recipe)).sort(
    (a, b) => score(b) - score(a) || COMBINATION_IDS.indexOf(a) - COMBINATION_IDS.indexOf(b),
  );
}
/** Clusters an area of this depth carries (more as the journey goes deeper). */
export const clusterCount = (index: number) => (index >= 21 ? 3 : 2);
/** The armor an area's warden wears: themed, varied by seed. */
function armorFor(recipe: AreaRecipe): ArmorId {
  const themed: Record<ThemeId, ArmorId[]> = {
    verdant: ["bark", "stone", "censer"],
    cinder: ["stone", "censer", "bark"],
    glass: ["glass", "censer", "stone"],
    dusk: ["censer", "bark", "glass"],
    frost: ["glass", "stone", "bark"],
  };
  return pick(themed[recipe.theme], recipe.seed, 41);
}
/** Arena kits: one that strips the armor and one that serves a weakness (or a second counter). */
function arenaFor(armor: ArmorId, weaknesses: WardenWeakness[], seed: number): ArenaId[] {
  const counters = ARENA_IDS.filter((id) => ARENA[id].serves.includes(armor));
  const first = pick(counters, seed, 43);
  const served = ARENA_IDS.filter(
    (id) => id !== first && weaknesses.some((w) => ARENA[id].serves.includes(w)),
  );
  const second = served.length
    ? pick(served, seed, 47)
    : pick(
        counters.filter((id) => id !== first),
        seed,
        53,
      );
  return [first, second];
}
export function bossPlan(recipe: AreaRecipe): BossPlan {
  const count = recipe.index >= 21 ? 3 : 2;
  const moves = [...new Set(recipe.mechanics.map((m) => WARDENS[m].move))].slice(0, count);
  const weaknesses = [
    ...new Set(
      recipe.mechanics
        .filter((m) => moves.includes(WARDENS[m].move))
        .map((m) => WARDENS[m].weakness),
    ),
  ];
  const armor = armorFor(recipe);
  return {
    title: `${recipe.boss}, ${ARMOR[armor].name}`,
    rig: bossRig(recipe.index),
    moves,
    weaknesses,
    armor,
    pieces:
      ARMOR[armor].family === "stone" || ARMOR[armor].family === "lantern"
        ? 2
        : recipe.index >= 21
          ? 4
          : 3,
    arena: arenaFor(armor, weaknesses, recipe.seed),
  };
}
const planCache = new Map<string, EncounterPlan | null>();
/**
 * The encounter plan of a generated area (null for the eight authored areas). Pure and cached
 * by recipe identity: the same seed and index always give the same plan.
 */
export function encounterPlan(recipe: AreaRecipe): EncounterPlan | null {
  if (!recipe.procedural) return null;
  const key = `${recipe.seed}:${recipe.index}:${recipe.mechanics.join(",")}:${recipe.x}:${recipe.y}`;
  const cached = planCache.get(key);
  if (cached !== undefined) return cached === null ? null : structuredClone(cached);
  const ranked = rankCombinations(recipe),
    count = clusterCount(recipe.index);
  // Slots in a seed-varied order; anchored clusters stand at their mechanic instead.
  const order = SLOTS.map((_, k) => k).sort(
    (a, b) => hash(a, 61, recipe.seed) - hash(b, 61, recipe.seed) || a - b,
  );
  const clusters: ClusterPlan[] = [];
  const used = new Set<CombinationId>();
  for (let c = 0; c < count; c++) {
    // Each cluster lists every remaining combination in rank order: the first is the intent,
    // the rest are its fallbacks if it cannot be placed.
    const combos = ranked.filter((id) => !used.has(id));
    if (!combos.length) break;
    used.add(combos[0]);
    clusters.push({ slot: order[c], combos, profile: COMBINATIONS[combos[0]].profile });
  }
  const fillers = [
    {
      slot: order[count],
      modules: [...FILLERS].sort(
        (a, b) =>
          hash(FILLERS.indexOf(a), 67, recipe.seed) - hash(FILLERS.indexOf(b), 67, recipe.seed) ||
          FILLERS.indexOf(a) - FILLERS.indexOf(b),
      ),
    },
  ];
  const at = (slot: number, inset: number) => {
    const s = SLOTS[slot];
    return {
      x: Math.round((recipe.x + Math.cos(s.angle) * (s.radius - inset)) * 1000) / 1000,
      y: Math.round((recipe.y + Math.sin(s.angle) * (s.radius - inset)) * 1000) / 1000,
    };
  };
  const pockets = clusters.map((c) => ({ ...at(c.slot, 85), radius: 55, slot: c.slot }));
  const point = (p: { dx: number; dy: number }) => ({ x: recipe.x + p.dx, y: recipe.y + p.dy });
  const plan: EncounterPlan = {
    version: 1,
    index: recipe.index,
    seed: recipe.seed,
    theme: recipe.theme,
    tags: recipeTags(recipe),
    clusters,
    fillers,
    pockets,
    routes: [
      {
        id: "essential",
        required: true,
        points: [point(ROUTE_POINTS.entry), point(ROUTE_POINTS.warden), point(ROUTE_POINTS.exit)],
        note: "arrival to the warden's ground to the exit portal; must stay walkable around every module",
      },
      ...clusters.map((c, k) => ({
        id: `advantage-${k}`,
        required: false,
        points: [point(ROUTE_POINTS.entry), at(c.slot, 0), pockets[k]],
        note: `through ${COMBINATIONS[c.combos[0]].name}: ${COMBINATIONS[c.combos[0]].start}`,
      })),
    ],
    boss: bossPlan(recipe),
  };
  if (planCache.size > 256) planCache.clear();
  planCache.set(key, plan);
  return structuredClone(plan);
}
/** Where an area's waves gather: generated areas use their plan's pockets. */
export function pocketPoint(
  plan: EncounterPlan,
  ordinal: number,
  roll: (salt: number) => number,
): { x: number; y: number } {
  const pocket = plan.pockets[ordinal % plan.pockets.length],
    angle = roll(1) * Math.PI * 2,
    r = Math.sqrt(roll(2)) * pocket.radius;
  return { x: pocket.x + Math.cos(angle) * r, y: pocket.y + Math.sin(angle) * r };
}

// ---- Validation and export ---------------------------------------------------------------

/**
 * Validate an encounter plan's references and shape (a hand-written or edited plan, or one
 * received from another agent). Throws with the first problem found.
 */
export function validateEncounterPlan(plan: EncounterPlan): void {
  const fail = (what: string) => {
    throw new Error(`Invalid encounter plan: ${what}`);
  };
  if (!plan || typeof plan !== "object" || plan.version !== 1) fail("version");
  if (!Number.isSafeInteger(plan.index) || plan.index <= 8) fail("index (generated areas are 9+)");
  if (!THEMES.some((t) => t.id === plan.theme)) fail(`theme ${String(plan.theme)}`);
  if (!Array.isArray(plan.clusters) || plan.clusters.length < 1 || plan.clusters.length > 4)
    fail("clusters");
  const slots = new Set<number>();
  for (const c of plan.clusters) {
    if (!Number.isInteger(c.slot) || c.slot < 0 || c.slot >= SLOTS.length || slots.has(c.slot))
      fail(`cluster slot ${String(c.slot)}`);
    slots.add(c.slot);
    if (!Array.isArray(c.combos) || !c.combos.length) fail("cluster combinations");
    for (const id of c.combos)
      if (!(COMBINATION_IDS as readonly string[]).includes(id)) fail(`unknown combination ${id}`);
    if (!Object.hasOwn(PROFILES, c.profile)) fail(`unknown profile ${String(c.profile)}`);
  }
  for (const f of plan.fillers ?? []) {
    if (!Number.isInteger(f.slot) || f.slot < 0 || f.slot >= SLOTS.length || slots.has(f.slot))
      fail(`filler slot ${String(f.slot)}`);
    slots.add(f.slot);
    for (const id of f.modules)
      if (!(MODULE_IDS as readonly string[]).includes(id)) fail(`unknown module ${id}`);
  }
  const b = plan.boss;
  if (!b || !RIGS.includes(b.rig)) fail("boss rig");
  if (!Array.isArray(b.moves) || !b.moves.length || b.moves.length > 3) fail("boss moves");
  const moves = Object.values(WARDENS).map((w) => w.move as string);
  for (const m of b.moves) if (!moves.includes(m)) fail(`unknown boss move ${m}`);
  const weak = Object.values(WARDENS).map((w) => w.weakness as string);
  for (const w of b.weaknesses) if (!weak.includes(w)) fail(`unknown weakness ${w}`);
  if (!(ARMOR_IDS as readonly string[]).includes(b.armor)) fail(`unknown armor ${b.armor}`);
  if (!Number.isInteger(b.pieces) || b.pieces < 0 || b.pieces > ARMOR_RULES.maxPieces)
    fail("armor pieces");
  for (const a of b.arena)
    if (!(ARENA_IDS as readonly string[]).includes(a)) fail(`unknown arena kit ${a}`);
  if (!Array.isArray(plan.pockets) || plan.pockets.length !== plan.clusters.length) fail("pockets");
}
/** Reproducible registry export for agents and documentation. */
export function encounterExport() {
  return {
    version: 1,
    modules: structuredClone(MODULES),
    mechanicTags: structuredClone(MECHANIC_TAGS),
    combinations: structuredClone(COMBINATIONS),
    profiles: structuredClone(PROFILES),
    armor: structuredClone(ARMOR),
    armorRules: { ...ARMOR_RULES },
    arena: structuredClone(ARENA),
    slots: SLOTS.map((s) => ({ angle: Math.round(s.angle * 1000) / 1000, radius: s.radius })),
    route: structuredClone(ROUTE_POINTS),
    rules: {
      selection:
        "combinations ranked by the area's mechanics (affinity ×6) plus a seed term (0–8); anchored ones need their mechanic. Areas 9–20 carry two clusters, 21+ three, plus one standalone mechanism module",
      placement:
        "each cluster is placed as one frame around its slot (turned and pulled in or out in fixed steps); critical chain pieces must not clash with terrain, other content, mechanics, lanes or gameplay spots; the essential route (arrival → warden → exit, plus each mechanic and pocket) must stay walkable with every module treated as solid",
      fallback:
        "a cluster that cannot be placed tries its next-ranked combination, then its role's alternate modules; a module that still cannot stand is omitted and recorded. Nothing ever requires a simulated outcome: every area clears by kills",
      boss: "moves from the area's mechanics (two, three from area 21), weaknesses are their union, armor by theme and seed, arena = one armor counter plus one weakness kit",
      persistence:
        "initial content is a pure function of the recipe and terrain at land creation; saved poses, breaks, joints and statuses own everything afterwards",
    },
  };
}
/** Short readable name of a theme for titles. */
export const themeWord = (theme: ThemeId) => themeOf(theme).name.replace("The ", "").split(" ")[0];
export const mechanicNames = (ids: readonly MechanicId[]) =>
  ids.map((id) => MECHANICS.find((m) => m.id === id)!.name);
