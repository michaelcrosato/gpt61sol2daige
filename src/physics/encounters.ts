import { Terrain, World } from "../engine/world.ts";
import { type AreaRecipe, areaRecipe, mechanicLayout, townName } from "../game/content.ts";
import {
  ARENA,
  ARENA_IDS,
  ARMOR,
  type ArenaId,
  type ArmorId,
  COMBINATIONS,
  type CombinationId,
  type EncounterPlan,
  encounterPlan,
  MODULES,
  type ModuleId,
  PROFILES,
  type RegionProfileId,
  ROUTE_POINTS,
  SLOTS,
  validateEncounterPlan,
} from "../game/encounters.ts";
import {
  CLEARING_LAYOUT,
  FAMILIES,
  type PropFamily,
  propRecipe,
  shapeReach,
} from "./blueprints.ts";
import type { MaterialId } from "./materials.ts";
import type { MechanismBlueprint, MechanismKind } from "./mechanisms.ts";
import type { RegionProfile } from "./policies.ts";
import type { FieldRecipe, ReactionSurface } from "./reactions.ts";
import { areaShowcase, type ShowcaseContent } from "./showcase.ts";
import type { BodyRecipe, JointRecipe } from "./types.ts";

/**
 * M11 realization of an encounter plan: module kits become bodies, assemblies, fields and
 * surfaces in a clearing, placed as whole clusters so each combination's chain geometry holds.
 * Placement is a pure function of the recipe, the land palette and solid terrain, so a land
 * rebuilds the same content and the agent can preview it without a running game.
 *
 * Kit coordinates: x runs along the cluster's chain, +y points inward (toward the clearing's
 * centre), angles are relative to the chain direction.
 */
type Blocked = (x: number, y: number, reach: number) => boolean;
interface KitPiece {
  family: PropFamily;
  tag: string;
  x: number;
  y: number;
  angle?: number;
  material?: MaterialId;
  durability?: number;
  motion?: "fixed" | "dynamic";
  shape?: BodyRecipe["shape"];
  /** Chain pieces keep formation; a clash fails the frame. Loose ones may be left out. */
  loose?: boolean;
}
interface KitJoint extends Omit<JointRecipe, "assembly" | "id" | "a" | "b"> {
  name: string;
  a: string;
  b: string;
}
interface Kit {
  pieces: KitPiece[];
  /** One assembly of these piece tags (in order, root first). */
  assembly?: { kind: MechanismKind; members: string[]; joints: KitJoint[]; event?: string };
  surfaces?: { tag: string; x: number; y: number; radius: number }[];
  fields?: {
    tag: string;
    kind: FieldRecipe["kind"];
    shape:
      | { kind: "circle"; x: number; y: number; radius: number }
      | { kind: "lane"; x: number; y: number; length: number; width: number };
    strength: number;
    gust: number;
    actors: boolean;
  }[];
  /** Extent along the chain (x) from the kit origin. */
  start: number;
  end: number;
}
const hinge = (
  name: string,
  a: string,
  b: string,
  anchorA: { x: number; y: number },
  anchorB: { x: number; y: number },
  breakLoad: number,
  toughness: number,
): KitJoint => ({ name, kind: "hinge", a, b, anchorA, anchorB, breakLoad, toughness });
const rope = (
  name: string,
  a: string,
  b: string,
  anchorA: { x: number; y: number },
  anchorB: { x: number; y: number },
  length: number,
  breakLoad: number,
  toughness: number,
): KitJoint => ({ name, kind: "rope", a, b, anchorA, anchorB, length, breakLoad, toughness });
const HALF = Math.PI / 2;
/** The module kits (M05–M10 vocabulary). */
export const KITS: Record<ModuleId, Kit> = {
  "storm-coil": {
    pieces: [
      { family: "coil", tag: "0", x: 0, y: 0 },
      { family: "rod", tag: "0", x: 26, y: 0 },
      { family: "rod", tag: "1", x: 50, y: 0 },
    ],
    start: -7,
    end: 54,
  },
  "glass-garden": {
    pieces: [
      { family: "pylon", tag: "0", x: 0, y: 0 },
      { family: "pylon", tag: "1", x: 28, y: 10 },
    ],
    start: -7,
    end: 35,
  },
  "flood-basin": {
    pieces: [
      { family: "cask", tag: "0", x: 22, y: -48, loose: true },
      { family: "cask", tag: "1", x: 48, y: -48, loose: true },
    ],
    surfaces: [{ tag: "pool", x: 36, y: 0, radius: 36 }],
    start: 0,
    end: 72,
  },
  "brazier-camp": {
    pieces: [
      { family: "brazier", tag: "0", x: 0, y: 0 },
      // Beside the coals, toward the chain: a jar shoved in bursts into a slick over the fuse.
      { family: "jar", tag: "0", x: 4, y: -23, loose: true },
      { family: "jar", tag: "1", x: 4, y: 23, loose: true },
    ],
    start: -9,
    end: 11,
  },
  "oil-cellar": {
    pieces: [
      { family: "jar", tag: "0", x: 0, y: -9, loose: true },
      { family: "jar", tag: "1", x: 0, y: 9, loose: true },
      { family: "jar", tag: "2", x: 14, y: 0, loose: true },
      { family: "lantern", tag: "0", x: 32, y: 0 },
    ],
    start: -7,
    end: 37,
  },
  "brush-fuse": {
    pieces: [0, 1, 2, 3, 4].map((k) => ({
      family: "brush" as const,
      tag: String(k),
      x: 8 + 15 * k,
      y: 0,
    })),
    start: 0,
    end: 76,
  },
  "timber-stockade": {
    pieces: [
      { family: "barricade", tag: "front", x: 3, y: 0, angle: HALF, durability: 45 },
      { family: "barricade", tag: "left", x: 21, y: -17, durability: 45 },
      { family: "barricade", tag: "right", x: 21, y: 17, durability: 45 },
      { family: "barricade", tag: "back", x: 39, y: 0, angle: HALF, durability: 45 },
      { family: "chest", tag: "cache", x: 21, y: 0 },
    ],
    start: 0,
    end: 42,
  },
  "thorn-hedge": {
    pieces: [
      { family: "hedge", tag: "0", x: 10, y: 0 },
      { family: "hedge", tag: "1", x: 32, y: 0 },
      { family: "hedge", tag: "2", x: 54, y: 0 },
      { family: "pot", tag: "cache", x: 32, y: -18, loose: true },
    ],
    start: 0,
    end: 64,
  },
  "powder-store": {
    pieces: [
      { family: "barrel", tag: "0", x: 9, y: -11, material: "volatile" },
      { family: "barrel", tag: "1", x: 9, y: 11, material: "volatile" },
      { family: "crate", tag: "0", x: 34, y: 0, loose: true },
    ],
    start: 0,
    end: 45,
  },
  "rubble-field": {
    pieces: [
      { family: "stone", tag: "0", x: 9, y: -12 },
      { family: "stone", tag: "1", x: 9, y: 12 },
      { family: "stone", tag: "2", x: 28, y: 0 },
      { family: "log", tag: "0", x: 52, y: 0, angle: HALF },
    ],
    start: 0,
    end: 58,
  },
  maelstrom: {
    pieces: [],
    // A swirl with a steady pull toward the eye: what it catches orbits instead of flying out.
    fields: [
      {
        tag: "eye",
        kind: "vortex",
        shape: { kind: "circle", x: 62, y: 0, radius: 62 },
        strength: 520,
        gust: 0,
        actors: true,
      },
      {
        tag: "pull",
        kind: "attract",
        shape: { kind: "circle", x: 62, y: 0, radius: 62 },
        strength: 300,
        gust: 0,
        actors: true,
      },
    ],
    start: 0,
    end: 124,
  },
  "gale-lane": {
    pieces: [
      { family: "post", tag: "mast", x: 150, y: -40 },
      { family: "vane", tag: "rotor", x: 150, y: -40 },
    ],
    assembly: {
      kind: "vane",
      members: ["post-mast", "vane-rotor"],
      joints: [
        {
          name: "pivot",
          kind: "hinge",
          a: "post-mast",
          b: "vane-rotor",
          anchorA: { x: 0, y: 0 },
          anchorB: { x: 0, y: 0 },
          motor: { mode: "velocity", target: 0.6, stiffness: 0, damping: 0.6 },
          breakLoad: 0,
          toughness: 0,
        },
      ],
    },
    fields: [
      {
        tag: "lane",
        kind: "wind",
        shape: { kind: "lane", x: 0, y: 0, length: 170, width: 56 },
        strength: 200,
        gust: 0.5,
        actors: true,
      },
    ],
    start: 0,
    end: 170,
  },
  "fan-tower": {
    pieces: [
      { family: "fan", tag: "0", x: 0, y: 0 },
      { family: "basket", tag: "0", x: 26, y: -8, loose: true },
      { family: "basket", tag: "1", x: 42, y: 8, loose: true },
    ],
    start: -9,
    end: 48,
  },
  "chain-gallows": {
    pieces: [
      { family: "post", tag: "post", x: 0, y: 0 },
      ...[0, 1, 2, 3].map((k) => ({
        family: "link" as const,
        tag: `link${k}`,
        x: 10 + 11 * k,
        y: 0,
      })),
      { family: "ball", tag: "ball", x: 58.5, y: 0 },
    ],
    assembly: {
      kind: "chain",
      members: ["post-post", "link-link0", "link-link1", "link-link2", "link-link3", "ball-ball"],
      joints: [
        hinge("anchor", "post-post", "link-link0", { x: 4.5, y: 0 }, { x: -5.5, y: 0 }, 2600, 60),
        ...[1, 2, 3].map((k) =>
          hinge(
            `link${k}`,
            `link-link${k - 1}`,
            `link-link${k}`,
            { x: 5.5, y: 0 },
            { x: -5.5, y: 0 },
            3200,
            90,
          ),
        ),
        hinge("ball", "link-link3", "ball-ball", { x: 5.5, y: 0 }, { x: -10, y: 0 }, 3200, 90),
      ],
    },
    start: -5,
    end: 68,
  },
  "launcher-nest": {
    // The frame turned so its slider (local +y) fires along the chain (+x).
    pieces: [
      {
        family: "post",
        tag: "frame",
        x: 0,
        y: 0,
        angle: -HALF,
        shape: { kind: "box", width: 18, height: 8 },
      },
      {
        family: "sled",
        tag: "sled",
        x: 22,
        y: 0,
        angle: -HALF,
        shape: { kind: "box", width: 16, height: 8 },
      },
      { family: "stone", tag: "load", x: 36, y: 0 },
    ],
    assembly: {
      kind: "launcher",
      members: ["post-frame", "sled-sled"],
      event: "launch",
      joints: [
        {
          name: "slider",
          kind: "slider",
          a: "post-frame",
          b: "sled-sled",
          anchorA: { x: 0, y: 22 },
          anchorB: { x: 0, y: 0 },
          axis: { x: 0, y: 1 },
          limits: [-13, 8],
          breakLoad: 0,
          toughness: 0,
        },
        {
          name: "spring",
          kind: "spring",
          a: "post-frame",
          b: "sled-sled",
          anchorA: { x: 0, y: 0 },
          anchorB: { x: 0, y: 0 },
          length: 22,
          stiffness: 2000,
          damping: 4,
          breakLoad: 0,
          toughness: 40,
        },
      ],
    },
    start: -9,
    end: 45,
  },
  "cargo-train": {
    pieces: [
      { family: "wagon", tag: "bed", x: 0, y: 0 },
      { family: "crate", tag: "cargo", x: 44, y: 0 },
      { family: "barrel", tag: "cargo", x: 70, y: 0 },
    ],
    assembly: {
      kind: "cart",
      members: ["wagon-bed", "crate-cargo", "barrel-cargo"],
      joints: [
        rope("tow0", "wagon-bed", "crate-cargo", { x: 25, y: 0 }, { x: -11, y: 0 }, 9, 1200, 30),
        rope("tow1", "crate-cargo", "barrel-cargo", { x: 11, y: 0 }, { x: -9, y: 0 }, 7, 1000, 25),
      ],
    },
    start: -25,
    end: 79,
  },
  "vine-tether": {
    pieces: [
      { family: "post", tag: "root", x: 0, y: 0 },
      ...[0, 1, 2, 3, 4, 5].map((k) => ({
        family: "vine" as const,
        tag: `seg${k}`,
        x: 9.5 + 10 * k,
        y: 0,
      })),
      { family: "pod", tag: "pod", x: 70, y: 0 },
    ],
    assembly: {
      kind: "vine",
      members: ["post-root", ...[0, 1, 2, 3, 4, 5].map((k) => `vine-seg${k}`), "pod-pod"],
      joints: [
        rope("root", "post-root", "vine-seg0", { x: 0, y: 0 }, { x: -4.5, y: 0 }, 5, 260, 8),
        ...[1, 2, 3, 4, 5].map((k) =>
          rope(
            `seg${k}`,
            `vine-seg${k - 1}`,
            `vine-seg${k}`,
            { x: 4.5, y: 0 },
            { x: -4.5, y: 0 },
            1,
            260,
            8,
          ),
        ),
        rope("pod", "vine-seg5", "pod-pod", { x: 4.5, y: 0 }, { x: -5, y: 0 }, 1, 260, 8),
      ],
    },
    start: -4,
    end: 75,
  },
  "gate-pen": {
    pieces: [
      { family: "post", tag: "hinge", x: 0, y: 0 },
      {
        family: "gate",
        tag: "leaf",
        x: 19.5,
        y: 0,
        shape: { kind: "box", width: 30, height: 5 },
      },
      { family: "post", tag: "latch", x: 39, y: 0 },
      {
        family: "fence",
        tag: "pen0",
        x: -4,
        y: -26,
        angle: HALF,
        shape: { kind: "box", width: 52, height: 5 },
      },
      {
        family: "fence",
        tag: "pen1",
        x: 43,
        y: -26,
        angle: HALF,
        shape: { kind: "box", width: 52, height: 5 },
      },
      {
        family: "fence",
        tag: "pen2",
        x: 20.75,
        y: -52,
        shape: { kind: "box", width: 50, height: 5 },
      },
      { family: "chest", tag: "cache", x: 31, y: -38 },
    ],
    assembly: {
      kind: "gate",
      members: ["post-hinge", "gate-leaf"],
      event: "latch",
      joints: [
        {
          name: "hinge",
          kind: "hinge",
          a: "post-hinge",
          b: "gate-leaf",
          anchorA: { x: 0, y: 0 },
          anchorB: { x: -19.5, y: 0 },
          limits: [-1.9, 1.9],
          motor: { mode: "position", target: 0, stiffness: 6, damping: 4 },
          breakLoad: 1400,
          toughness: 45,
        },
      ],
    },
    start: -7,
    end: 46,
  },
};
/**
 * Arena kits, centred on the warden's ground (x toward the exit, +y south); none touches the
 * corridor from arrival to the exit.
 */
export const ARENA_KITS: Record<ArenaId, Kit> = {
  "arena-pillars": {
    pieces: [
      { family: "pillar", tag: "0", x: 42, y: 72 },
      { family: "pillar", tag: "1", x: -42, y: 72 },
      { family: "pillar", tag: "2", x: -42, y: -72 },
      { family: "pillar", tag: "3", x: 42, y: -72 },
    ],
    start: -50,
    end: 50,
  },
  "arena-braziers": {
    pieces: [
      { family: "brazier", tag: "0", x: -38, y: 74 },
      { family: "jar", tag: "0", x: -64, y: 84, loose: true },
      { family: "brazier", tag: "1", x: 38, y: -74 },
      { family: "jar", tag: "1", x: 64, y: -84, loose: true },
    ],
    start: -66,
    end: 66,
  },
  "arena-conductors": {
    pieces: [
      { family: "rod", tag: "0", x: 0, y: 58 },
      { family: "rod", tag: "1", x: 0, y: -58 },
      { family: "coil", tag: "0", x: -58, y: -66 },
    ],
    surfaces: [{ tag: "pool", x: 0, y: 0, radius: 42 }],
    start: -65,
    end: 42,
  },
  "arena-flood": {
    pieces: [
      { family: "cask", tag: "0", x: -26, y: 76, loose: true },
      { family: "cask", tag: "1", x: -26, y: -76, loose: true },
    ],
    surfaces: [{ tag: "pool", x: -26, y: 0, radius: 50 }],
    start: -76,
    end: 24,
  },
  "arena-weights": {
    pieces: [
      // Posts north and south; the chains hang toward the warden's ground.
      { family: "post", tag: "n-post", x: 0, y: -98, angle: HALF },
      ...[0, 1, 2, 3].map((k) => ({
        family: "link" as const,
        tag: `n-link${k}`,
        x: 0,
        y: -98 + 10 + 11 * k,
        angle: HALF,
      })),
      { family: "ball", tag: "n-ball", x: 0, y: -98 + 58.5, angle: HALF },
    ],
    start: -10,
    end: 10,
  },
  "arena-launcher": {
    // South-west of the ground, aimed north-east across it.
    pieces: [
      {
        family: "post",
        tag: "frame",
        x: -78,
        y: 78,
        angle: -Math.PI * 0.75,
        shape: { kind: "box", width: 18, height: 8 },
      },
      {
        family: "sled",
        tag: "sled",
        x: -78 + 22 * Math.SQRT1_2,
        y: 78 - 22 * Math.SQRT1_2,
        angle: -Math.PI * 0.75,
        shape: { kind: "box", width: 16, height: 8 },
      },
      { family: "stone", tag: "load", x: -78 + 36 * Math.SQRT1_2, y: 78 - 36 * Math.SQRT1_2 },
    ],
    assembly: {
      kind: "launcher",
      members: ["post-frame", "sled-sled"],
      event: "launch",
      joints: [
        {
          name: "slider",
          kind: "slider",
          a: "post-frame",
          b: "sled-sled",
          anchorA: { x: 0, y: 22 },
          anchorB: { x: 0, y: 0 },
          axis: { x: 0, y: 1 },
          limits: [-13, 8],
          breakLoad: 0,
          toughness: 0,
        },
        {
          name: "spring",
          kind: "spring",
          a: "post-frame",
          b: "sled-sled",
          anchorA: { x: 0, y: 0 },
          anchorB: { x: 0, y: 0 },
          length: 22,
          stiffness: 2000,
          damping: 4,
          breakLoad: 0,
          toughness: 40,
        },
      ],
    },
    start: -90,
    end: -40,
  },
  "arena-powder": {
    pieces: [
      { family: "barrel", tag: "0", x: -52, y: 74, material: "volatile" },
      { family: "barrel", tag: "1", x: 52, y: -74, material: "volatile" },
    ],
    start: -61,
    end: 61,
  },
};
// Each weight hangs as one chain assembly; the kit builder makes two (north and south).
const WEIGHT_CHAINS = ["n"] as const;

/** One cluster's chain links: which pieces must stay within which reach for the rule to work. */
interface Link {
  from: { module: number; tag: string };
  to: { module: number; tag: string };
  reach: number;
  rule: string;
}
interface ClusterLayout {
  /** Gap after each role module along the chain (before the next one). */
  gaps: number[];
  /** Offset across the chain per role module (outward is negative). */
  offsets?: number[];
  links: Link[];
}
const piece = (module: number, tag: string) => ({ module, tag });
/** Chain geometry of each combination (positions along the chain and the links that bind it). */
export const CLUSTERS: Record<CombinationId, ClusterLayout> = {
  // The last rod stands inside the pool, so the coil's discharge reaches every wet body.
  "storm-pool": {
    gaps: [-14],
    links: [{ from: piece(0, "rod-1"), to: piece(1, "pool"), reach: 0, rule: "conduct" }],
  },
  "spark-pool": {
    gaps: [-16],
    links: [{ from: piece(0, "pylon-1"), to: piece(1, "pool"), reach: 4, rule: "release" }],
  },
  "fire-stockade": {
    // The fuse starts beyond the brazier's heat reach: only a slick or a burning strike lights it.
    gaps: [14, 3],
    links: [
      { from: piece(0, "@ignition"), to: piece(1, "brush-0"), reach: 24, rule: "flare" },
      { from: piece(1, "brush-4"), to: piece(2, "barricade-front"), reach: 12, rule: "spread" },
    ],
  },
  // The cellar's jars stand just beyond the coals' heat: shove one in and its slick reaches the rest.
  "oil-flare": {
    gaps: [8],
    links: [{ from: piece(0, "brazier-0"), to: piece(1, "jar-0"), reach: 24, rule: "flare" }],
  },
  "powder-fuse": {
    gaps: [3],
    links: [{ from: piece(0, "brush-4"), to: piece(1, "barrel-0"), reach: 12, rule: "spread" }],
  },
  "thorn-fire": {
    gaps: [3],
    links: [{ from: piece(0, "brush-4"), to: piece(1, "hedge-0"), reach: 12, rule: "spread" }],
  },
  "quench-fuse": {
    gaps: [-68],
    offsets: [0, 70],
    links: [{ from: piece(1, "cask-0"), to: piece(0, "brush-2"), reach: 46, rule: "spill" }],
  },
  "maelstrom-rubble": {
    gaps: [-82],
    offsets: [0, 0],
    links: [{ from: piece(1, "stone-2"), to: piece(0, "eye"), reach: 0, rule: "field" }],
  },
  "vortex-powder": {
    gaps: [-86],
    offsets: [0, 0],
    links: [{ from: piece(1, "barrel-0"), to: piece(0, "eye"), reach: 0, rule: "field" }],
  },
  "gale-debris": {
    gaps: [-160],
    links: [{ from: piece(1, "stone-2"), to: piece(0, "lane"), reach: 0, rule: "field" }],
  },
  "launch-powder": {
    gaps: [44],
    links: [{ from: piece(0, "stone-load"), to: piece(1, "barrel-0"), reach: 120, rule: "launch" }],
  },
  "ram-stockade": {
    gaps: [52],
    links: [
      { from: piece(0, "stone-load"), to: piece(1, "barricade-front"), reach: 120, rule: "launch" },
    ],
  },
  // The first pylon stands inside the ball's sweep (58.5 + 9 from the post), clear of it at rest.
  "swing-glass": {
    gaps: [-14],
    offsets: [0, -20],
    links: [{ from: piece(0, "post-post"), to: piece(1, "pylon-0"), reach: 56, rule: "impact" }],
  },
  "rift-cart": { gaps: [], links: [] },
};

// ---- Placement ---------------------------------------------------------------------------

interface Circle {
  x: number;
  y: number;
  r: number;
  /** A walkable reservation (a gameplay spot): pools may cover it, bodies may not. */
  open?: true;
  /** A piece a fire chain needs dry: no pool may cover it. */
  dry?: true;
}
const round = (value: number) => Math.round(value * 1000) / 1000;
/** Families a fire chain needs dry (they never stand on water tiles). */
const DRY = new Set<string>(["brazier", "jar", "lantern", "brush", "barricade", "hedge", "chest"]);
/** Families travelers walk through or under: never route blockers. */
const PASSABLE = new Set<PropFamily>(
  (Object.keys(FAMILIES) as PropFamily[]).filter((f) => FAMILIES[f].actors === false),
);
interface Placed {
  bodies: BodyRecipe[];
  mechanisms: MechanismBlueprint[];
  fields: FieldRecipe[];
  surfaces: ReactionSurface[];
}
/** A kit transformed into world space at an origin and chain heading. */
function realize(
  kit: Kit,
  prefix: string,
  areaId: string,
  palette: number,
  origin: { x: number; y: number },
  heading: number,
  index: number,
  assemblyId: string,
): Placed & { spots: Map<string, { x: number; y: number; reach: number; loose: boolean }> } {
  const cos = Math.cos(heading),
    sin = Math.sin(heading),
    at = (x: number, y: number) => ({
      x: round(origin.x + cos * x - sin * y),
      y: round(origin.y + sin * x + cos * y),
    });
  const spots = new Map<string, { x: number; y: number; reach: number; loose: boolean }>();
  const bodies: BodyRecipe[] = [];
  const members = new Set(kit.assembly?.members ?? []);
  for (const p of kit.pieces) {
    const key = `${p.family}-${p.tag}`,
      w = at(p.x, p.y),
      id = `prop-${p.family}-${index}-${prefix}-${p.tag}`;
    const recipe = propRecipe(id, p.family, palette, w.x, w.y, areaId, {
      angle: round(heading + (p.angle ?? 0)),
      ...(p.material ? { material: p.material } : {}),
      ...(p.shape ? { shape: p.shape } : {}),
      ...(p.motion ? { motion: p.motion } : {}),
    });
    if (p.durability !== undefined && recipe.consequences)
      recipe.consequences.durability = p.durability;
    if (members.has(key)) recipe.assembly = assemblyId;
    bodies.push(recipe);
    spots.set(key, {
      x: w.x,
      y: w.y,
      reach: shapeReach(recipe.shape),
      loose: !!p.loose,
    });
  }
  const mechanisms: MechanismBlueprint[] = [];
  if (kit.assembly) {
    const idOf = (key: string) =>
      bodies[kit.pieces.findIndex((p) => `${p.family}-${p.tag}` === key)].id;
    mechanisms.push({
      recipe: {
        id: assemblyId,
        kind: kit.assembly.kind,
        areaId,
        root: idOf(kit.assembly.members[0]),
        members: kit.assembly.members.map(idOf),
        event: (kit.assembly.event ?? "none") as MechanismBlueprint["recipe"]["event"],
      },
      bodies: bodies.filter((b) => b.assembly === assemblyId),
      joints: kit.assembly.joints.map((j) => {
        const { name, ...rest } = j;
        return {
          ...rest,
          id: `${assemblyId}:${name}`,
          assembly: assemblyId,
          a: idOf(j.a),
          b: idOf(j.b),
        };
      }),
    });
  }
  const surfaces: ReactionSurface[] = (kit.surfaces ?? []).map((s) => {
    const w = at(s.x, s.y);
    spots.set(s.tag, { x: w.x, y: w.y, reach: s.radius, loose: false });
    return {
      id: `pool-${index}-${prefix}`,
      kind: "water",
      areaId,
      x: w.x,
      y: w.y,
      radius: s.radius,
      ticks: -1,
      burning: 0,
      chain: "",
      depth: 0,
      owner: "",
      team: "world",
    };
  });
  const fields: FieldRecipe[] = (kit.fields ?? []).map((f) => {
    const w = at(f.shape.x, f.shape.y);
    const shape: FieldRecipe["shape"] =
      f.shape.kind === "circle"
        ? { kind: "circle", x: w.x, y: w.y, radius: f.shape.radius }
        : {
            kind: "lane",
            x: w.x,
            y: w.y,
            angle: round(heading),
            length: f.shape.length,
            width: f.shape.width,
          };
    spots.set(f.tag, {
      x:
        shape.kind === "circle"
          ? w.x
          : round(w.x + cos * (f.shape as { length: number }).length * 0.5),
      y:
        shape.kind === "circle"
          ? w.y
          : round(w.y + sin * (f.shape as { length: number }).length * 0.5),
      reach: shape.kind === "circle" ? shape.radius : (f.shape as { length: number }).length * 0.5,
      loose: false,
    });
    return {
      id: `${f.kind === "wind" ? "gale" : "maelstrom"}-${index}-${prefix}-${f.tag}`,
      kind: f.kind,
      areaId,
      shape,
      strength: f.strength,
      ticks: -1,
      gust: f.gust,
      actors: f.actors,
      owner: "",
      team: "world",
      source: "authored",
    };
  });
  return { bodies, mechanisms, fields, surfaces, spots };
}
/** Bodies (and lanes) that placement must avoid, as circles. */
function footprint(placed: Placed): Circle[] {
  // A lit brazier ignites what presses against it: nothing else stands within its heat reach.
  const out: Circle[] = placed.bodies.map((b) => ({
    x: b.x,
    y: b.y,
    r: shapeReach(b.shape) + (b.blueprint?.family === "brazier" ? 12 : 0),
    ...(DRY.has(b.blueprint?.family ?? "") || b.material === "volatile"
      ? { dry: true as const }
      : {}),
  }));
  for (const f of placed.fields)
    if (f.shape.kind === "lane") {
      const s = f.shape;
      // The lane and its run-out: what it carries rolls on up to ~90 units past its end.
      for (let d = -24; d <= s.length + 96; d += 24)
        out.push({
          x: s.x + Math.cos(s.angle) * d,
          y: s.y + Math.sin(s.angle) * d,
          r: s.width / 2,
        });
    }
  return out;
}

/** Exact overlap of two body shapes (circles and rotated boxes), touching allowed. */
export function bodiesOverlap(
  a: Pick<BodyRecipe, "x" | "y" | "angle" | "shape">,
  b: Pick<BodyRecipe, "x" | "y" | "angle" | "shape">,
): boolean {
  if (a.shape.kind === "circle" && b.shape.kind === "circle")
    return Math.hypot(a.x - b.x, a.y - b.y) < a.shape.radius + b.shape.radius;
  if (a.shape.kind === "circle") return circleBox(a, b);
  if (b.shape.kind === "circle") return circleBox(b, a);
  const axes = [
    a.angle ?? 0,
    (a.angle ?? 0) + Math.PI / 2,
    b.angle ?? 0,
    (b.angle ?? 0) + Math.PI / 2,
  ];
  const project = (body: typeof a, ux: number, uy: number) => {
    const s = body.shape as { width: number; height: number },
      c = Math.cos(body.angle ?? 0),
      n = Math.sin(body.angle ?? 0),
      centre = body.x * ux + body.y * uy,
      extent =
        (Math.abs(c * ux + n * uy) * s.width) / 2 + (Math.abs(-n * ux + c * uy) * s.height) / 2;
    return [centre - extent, centre + extent];
  };
  for (const angle of axes) {
    const ux = Math.cos(angle),
      uy = Math.sin(angle),
      [a0, a1] = project(a, ux, uy),
      [b0, b1] = project(b, ux, uy);
    if (a1 <= b0 || b1 <= a0) return false;
  }
  return true;
}
function circleBox(
  c: Pick<BodyRecipe, "x" | "y" | "shape">,
  b: Pick<BodyRecipe, "x" | "y" | "angle" | "shape">,
): boolean {
  const r = (c.shape as { radius: number }).radius,
    s = b.shape as { width: number; height: number },
    cos = Math.cos(-(b.angle ?? 0)),
    sin = Math.sin(-(b.angle ?? 0)),
    dx = c.x - b.x,
    dy = c.y - b.y,
    lx = dx * cos - dy * sin,
    ly = dx * sin + dy * cos,
    qx = Math.max(-s.width / 2, Math.min(s.width / 2, lx)),
    qy = Math.max(-s.height / 2, Math.min(s.height / 2, ly));
  return Math.hypot(lx - qx, ly - qy) < r;
}
/**
 * Overlapping pairs in generated content: nothing may start interpenetrated except members of
 * one assembly (linked parts) and raised parts that meet nothing.
 */
export function overlapsIn(bodies: readonly BodyRecipe[]): string[] {
  const out: string[] = [];
  const solid = bodies.filter((b) => !(b.blueprint && FAMILIES[b.blueprint.family].raised));
  for (let i = 0; i < solid.length; i++)
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i],
        b = solid[j];
      if (a.motion === "fixed" && b.motion === "fixed") continue;
      if (a.assembly && a.assembly === b.assembly) continue;
      if (bodiesOverlap(a, b)) out.push(`${a.id}|${b.id}`);
    }
  return out;
}
/** Walkability grid of a clearing (12-unit cells) for the essential-route checks. */
class RouteGrid {
  static CELL = 12;
  static CLEARANCE = 9;
  readonly size: number;
  readonly x0: number;
  readonly y0: number;
  private solid: Uint8Array;
  constructor(recipe: Pick<AreaRecipe, "x" | "y" | "radius">, blocked: Blocked) {
    const span = recipe.radius + 60;
    this.size = Math.ceil((span * 2) / RouteGrid.CELL);
    this.x0 = recipe.x - span;
    this.y0 = recipe.y - span;
    this.solid = new Uint8Array(this.size * this.size);
    for (let j = 0; j < this.size; j++)
      for (let i = 0; i < this.size; i++) {
        const { x, y } = this.center(i, j);
        if (
          Math.hypot(x - recipe.x, y - recipe.y) > span ||
          blocked(x, y, RouteGrid.CLEARANCE * 0.5)
        )
          this.solid[j * this.size + i] = 1;
      }
  }
  center(i: number, j: number) {
    return { x: this.x0 + (i + 0.5) * RouteGrid.CELL, y: this.y0 + (j + 0.5) * RouteGrid.CELL };
  }
  copy(): RouteGrid {
    const out = Object.create(RouteGrid.prototype) as RouteGrid;
    Object.assign(out, this, { solid: this.solid.slice() });
    return out;
  }
  /** Mark everything a body covers (with a traveler's clearance) as solid. */
  add(bodies: readonly BodyRecipe[]): void {
    for (const b of bodies) {
      if (b.blueprint && PASSABLE.has(b.blueprint.family)) continue;
      const r = shapeReach(b.shape) + RouteGrid.CLEARANCE,
        i0 = Math.max(0, Math.floor((b.x - r - this.x0) / RouteGrid.CELL)),
        i1 = Math.min(this.size - 1, Math.floor((b.x + r - this.x0) / RouteGrid.CELL)),
        j0 = Math.max(0, Math.floor((b.y - r - this.y0) / RouteGrid.CELL)),
        j1 = Math.min(this.size - 1, Math.floor((b.y + r - this.y0) / RouteGrid.CELL));
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const c = this.center(i, j);
          if (Math.hypot(c.x - b.x, c.y - b.y) < r) this.solid[j * this.size + i] = 1;
        }
    }
  }
  private cell(x: number, y: number): number {
    const i = Math.floor((x - this.x0) / RouteGrid.CELL),
      j = Math.floor((y - this.y0) / RouteGrid.CELL);
    if (i < 0 || j < 0 || i >= this.size || j >= this.size) return -1;
    // The nearest open cell within two cells (a target spot may sit beside a solid piece).
    let best = -1,
      bestD = Infinity;
    for (let dj = -2; dj <= 2; dj++)
      for (let di = -2; di <= 2; di++) {
        const ii = i + di,
          jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= this.size || jj >= this.size) continue;
        if (this.solid[jj * this.size + ii]) continue;
        const d = di * di + dj * dj;
        if (d < bestD) {
          bestD = d;
          best = jj * this.size + ii;
        }
      }
    return best;
  }
  /** Which targets are reachable from `from` (4-connected flood fill). */
  reach(from: { x: number; y: number }, targets: { x: number; y: number }[]): boolean[] {
    const start = this.cell(from.x, from.y);
    if (start < 0) return targets.map(() => false);
    const seen = new Uint8Array(this.solid.length),
      queue = new Int32Array(this.solid.length);
    let head = 0,
      tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    while (head < tail) {
      const c = queue[head++],
        i = c % this.size,
        j = (c - i) / this.size;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const ii = i + di,
          jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= this.size || jj >= this.size) continue;
        const n = jj * this.size + ii;
        if (seen[n] || this.solid[n]) continue;
        seen[n] = 1;
        queue[tail++] = n;
      }
    }
    return targets.map((t) => {
      const c = this.cell(t.x, t.y);
      return c >= 0 && seen[c] === 1;
    });
  }
}

// ---- Results -----------------------------------------------------------------------------

export interface RealizedCluster {
  /** Ring slot it stands in, or -1 beside its anchoring mechanic. */
  slot: number;
  intended: CombinationId;
  combo: CombinationId;
  modules: ModuleId[];
  x: number;
  y: number;
  heading: number;
  region: string;
  profile: RegionProfileId;
  links: { rule: string; from: string; to: string; distance: number; reach: number; ok: boolean }[];
  /** Loose pieces left out because nothing near them had room. */
  omitted: string[];
}
export interface RealizedEncounter {
  version: 1;
  index: number;
  seed: number;
  clusters: RealizedCluster[];
  filler: { slot: number; module: ModuleId; x: number; y: number } | null;
  arena: { kit: ArenaId; heading: number; placed: number; omitted: string[] }[];
  boss: EncounterPlan["boss"];
  routes: { id: string; ok: boolean }[];
  /** Human-readable fallback log: combinations or modules replaced or omitted, and why. */
  fallbacks: string[];
  /** Interpenetrating starting pairs (must be empty: an impossible placement). */
  overlaps: string[];
  bodies: number;
}
export interface GeneratedArea {
  content: ShowcaseContent;
  manifest: RealizedEncounter;
  regions: RegionProfile[];
}
/** The three trees each clearing keeps from the M05 layout (generated areas build the rest). */
export function baseScenery(recipe: AreaRecipe, palette: number, blocked: Blocked): BodyRecipe[] {
  return CLEARING_LAYOUT.filter((p) => p.family === "tree").map((p) => {
    const distance = Math.hypot(p.dx, p.dy),
      heading = Math.atan2(p.dy, p.dx),
      reach = shapeReach(FAMILIES.tree.shape);
    let x = recipe.x + p.dx,
      y = recipe.y + p.dy;
    for (let k = 1; k <= 12 && blocked(x, y, reach); k++) {
      const turn = heading + ((k + 1) >> 1) * 0.16 * (k % 2 ? 1 : -1);
      x = round(recipe.x + Math.cos(turn) * distance);
      y = round(recipe.y + Math.sin(turn) * distance);
    }
    return propRecipe(
      `prop-tree-${recipe.index}-${p.n}`,
      "tree",
      palette,
      x,
      y,
      `area-${recipe.index}`,
    );
  });
}
/** Arrival, both portals and the warden's ground stay open (as in M10). */
function keepClear(recipe: AreaRecipe): Circle[] {
  return [
    [-230, 0, 46],
    [-265, 95, 42],
    [275, 0, 54],
    [130, 0, 34],
  ].map(([dx, dy, r]) => ({ x: recipe.x + dx, y: recipe.y + dy, r, open: true as const }));
}
const clash = (circles: Circle[], taken: Circle[], blocked: Blocked) =>
  circles.some(
    (c) =>
      blocked(c.x, c.y, c.r) || taken.some((t) => Math.hypot(t.x - c.x, t.y - c.y) < t.r + c.r + 2),
  );
/** Candidate frames around a point: turns about the clearing centre, then radial shifts. */
const SHIFTS = [0, -22, 22, -44, 44];
const TURNS = [0, 0.1, -0.1, 0.2, -0.2, 0.3, -0.3];
/** Arena kits are rings around the warden's ground: try them at every twelfth of a turn. */
const ARENA_TURNS = Array.from({ length: 12 }, (_, k) => (k * Math.PI) / 6);

/**
 * Build one generated area: the M10 set pieces around its mechanics (on the trees alone), then
 * each planned cluster, the standalone mechanism and the warden's arena. Every placement keeps
 * the essential route (arrival → warden → exit, every mechanic and pocket) walkable with all
 * placed pieces treated as solid; a cluster that cannot stand tries its next combination.
 */
export function generatedArea(
  recipe: AreaRecipe,
  palette: number,
  solid: Blocked,
  override?: EncounterPlan,
  water?: (x: number, y: number) => boolean,
): GeneratedArea {
  const plan = override ?? encounterPlan(recipe);
  if (!plan) throw new Error("Authored areas have no generated encounter");
  validateEncounterPlan(plan);
  const i = recipe.index,
    areaId = `area-${i}`,
    base = baseScenery(recipe, palette, solid);
  const showcase = areaShowcase(recipe, palette, solid, base);
  const blocked = solid;
  // Fire's pieces keep off water tiles: wading props stay wet and would never catch.
  const soaked = (b: BodyRecipe) =>
    !!water && (DRY.has(b.blueprint?.family ?? "") || b.material === "volatile") && water(b.x, b.y);
  const out: ShowcaseContent = {
    bodies: [...base, ...showcase.bodies],
    mechanisms: [...showcase.mechanisms],
    fields: [...showcase.fields],
    surfaces: [...showcase.surfaces],
  };
  const spots = new Map(
    mechanicLayout(recipe).map((m) => [
      `${m.kind}-${m.n}`,
      { x: m.x, y: m.y, r: m.radius + 8, open: true as const },
    ]),
  );
  const taken: Circle[] = [
    ...keepClear(recipe),
    ...footprint({ bodies: out.bodies, mechanisms: [], fields: out.fields, surfaces: [] }),
    ...spots.values(),
  ];
  // Pools are walkable but stay distinct.
  for (const s of out.surfaces) taken.push({ x: s.x, y: s.y, r: s.radius + 4 });
  const grid = new RouteGrid(recipe, solid);
  grid.add(out.bodies);
  const entry = { x: recipe.x + ROUTE_POINTS.entry.dx, y: recipe.y + ROUTE_POINTS.entry.dy };
  const targets = [
    { id: "warden", x: recipe.x + ROUTE_POINTS.warden.dx, y: recipe.y + ROUTE_POINTS.warden.dy },
    { id: "exit", x: recipe.x + ROUTE_POINTS.exit.dx, y: recipe.y + ROUTE_POINTS.exit.dy },
    ...mechanicLayout(recipe).map((m) => ({ id: `${m.kind}-${m.n}`, x: m.x, y: m.y })),
    ...plan.pockets.map((p, k) => ({ id: `pocket-${k}`, x: p.x, y: p.y })),
  ];
  // Only routes open before any module are required to stay open (terrain can close others).
  const baseline = grid.reach(entry, targets);
  const routesHold = (g: RouteGrid) => {
    const now = g.reach(entry, targets);
    return baseline.every((ok, k) => !ok || now[k]);
  };
  const fallbacks: string[] = [];
  const clusters: RealizedCluster[] = [];
  /** Try every frame of a candidate; commit the first that clashes with nothing. */
  const tryPlace = (
    build: (
      origin: { x: number; y: number },
      heading: number,
    ) => (Placed & { loose: Set<string> }) | null,
    origin: { x: number; y: number },
    heading: number,
    pivot: { x: number; y: number },
    options: {
      ignore?: Circle;
      turns?: readonly number[];
      accept?: (placed: Placed, heading: number) => boolean;
    } = {},
  ): (Placed & { origin: { x: number; y: number }; heading: number; omitted: string[] }) | null => {
    const others = options.ignore ? taken.filter((t) => t !== options.ignore) : taken;
    for (const shift of SHIFTS)
      for (const turn of options.turns ?? TURNS) {
        const dx = origin.x - pivot.x,
          dy = origin.y - pivot.y,
          d = Math.hypot(dx, dy) || 1,
          ux = dx / d,
          uy = dy / d,
          c = Math.cos(turn),
          s = Math.sin(turn);
        const o = {
          x: round(pivot.x + (ux * c - uy * s) * (d + shift)),
          y: round(pivot.y + (ux * s + uy * c) * (d + shift)),
        };
        const placed = build(o, heading + turn);
        if (!placed) continue;
        // Chain pieces (and fields, pools) must fit; loose pieces may be left out.
        const firm: Placed = {
          bodies: placed.bodies.filter((b) => !placed.loose.has(b.id)),
          mechanisms: placed.mechanisms,
          fields: placed.fields,
          surfaces: placed.surfaces,
        };
        const solid = footprint(firm);
        if (clash(solid, others, blocked)) continue;
        if (overlapsIn(firm.bodies).length) continue;
        if (firm.bodies.some(soaked)) continue;
        // A pool keeps clear of other content: nothing else stands soaking in it by accident.
        if (placed.surfaces.some((p) => blocked(p.x, p.y, p.radius * 0.5))) continue;
        if (
          clash(
            placed.surfaces.map((p) => ({ x: p.x, y: p.y, r: p.radius + 4 })),
            others.filter((c) => c.dry),
            () => false,
          )
        )
          continue;
        const omitted: string[] = [];
        const kept = [...firm.bodies];
        const local: Circle[] = [...solid];
        for (const b of placed.bodies) {
          if (!placed.loose.has(b.id)) continue;
          const circle = footprint({ bodies: [b], mechanisms: [], fields: [], surfaces: [] })[0];
          // Against other content: footprints with berths; within the kit: exact shapes (a
          // camp's jars stand beside their own brazier on purpose).
          if (
            clash([circle], others, blocked) ||
            soaked(b) ||
            kept.some((k) => bodiesOverlap(k, b) && !(k.assembly && k.assembly === b.assembly))
          )
            omitted.push(b.id);
          else {
            kept.push(b);
            local.push(circle);
          }
        }
        const candidate: Placed = {
          bodies: kept,
          mechanisms: placed.mechanisms,
          fields: placed.fields,
          surfaces: placed.surfaces,
        };
        if (options.accept && !options.accept(candidate, heading + turn)) continue;
        const g = grid.copy();
        g.add(kept);
        if (!routesHold(g)) continue;
        grid.add(kept);
        taken.push(...local);
        for (const p of placed.surfaces) taken.push({ x: p.x, y: p.y, r: p.radius + 4 });
        return { ...placed, bodies: kept, origin: o, heading: heading + turn, omitted };
      }
    return null;
  };
  const centre = { x: recipe.x, y: recipe.y };
  const usedCombos = new Set<CombinationId>();
  // Slots no cluster or filler planned: a cluster that cannot stand in its own slot moves there.
  const claimed = new Set<number>([
    ...plan.clusters.map((c) => c.slot),
    ...plan.fillers.map((f) => f.slot),
  ]);
  const spare = SLOTS.map((_, n) => n).filter((n) => !claimed.has(n));
  for (const [k, cluster] of plan.clusters.entries()) {
    let done = false;
    for (const combo of cluster.combos) {
      if (usedCombos.has(combo)) continue;
      const info = COMBINATIONS[combo];
      // Each role takes its first module choice, then its alternates.
      const choices = info.roles.map((r) => r.modules);
      // Anchored combinations stand beside their mechanic (rift freight on an arch's pad);
      // others try their own slot, then any spare one.
      const sites: {
        slot: number;
        origin: { x: number; y: number };
        heading: number;
        pivot: { x: number; y: number };
        ignore?: Circle;
      }[] = [];
      if (info.anchor) {
        const arches = mechanicLayout(recipe).filter((m) => m.kind === info.anchor);
        const arch = arches[1] ?? arches[0];
        if (!arch) continue;
        const outward = Math.atan2(arch.y - recipe.y, arch.x - recipe.x);
        sites.push({
          slot: -1,
          heading: outward + Math.PI / 2,
          origin: {
            x: round(arch.x + Math.cos(outward) * 34),
            y: round(arch.y + Math.sin(outward) * 34),
          },
          pivot: { x: arch.x, y: arch.y },
          ignore: spots.get(`${arch.kind}-${arch.n}`),
        });
      } else
        for (const slot of [cluster.slot, ...spare]) {
          const at = SLOTS[slot];
          sites.push({
            slot,
            heading: at.angle + Math.PI / 2,
            origin: {
              x: round(recipe.x + Math.cos(at.angle) * at.radius),
              y: round(recipe.y + Math.sin(at.angle) * at.radius),
            },
            pivot: centre,
          });
        }
      for (const site of sites) {
        for (const modules of cartesian(choices)) {
          const layout = CLUSTERS[combo];
          const result = tryPlace(
            (o, h) => buildCluster(recipe, palette, modules, layout, o, h, k),
            site.origin,
            site.heading,
            site.pivot,
            {
              ignore: site.ignore,
              // Every chain link must hold with the pieces actually kept.
              accept: (placed) => checkLinks(placed, modules, layout, k, i).every((l) => l.ok),
            },
          );
          if (!result) continue;
          const links = checkLinks(result, modules, layout, k, i);
          if (combo !== cluster.combos[0])
            fallbacks.push(`cluster ${k}: ${cluster.combos[0]} could not stand; ${combo} instead`);
          if (site.slot >= 0 && site.slot !== cluster.slot) {
            fallbacks.push(
              `cluster ${k}: slot ${cluster.slot} had no room; moved to slot ${site.slot}`,
            );
            spare.splice(spare.indexOf(site.slot), 1);
          }
          if (modules.join() !== choices.map((c) => c[0]).join())
            fallbacks.push(`cluster ${k}: ${combo} uses alternate modules ${modules.join(", ")}`);
          for (const id of result.omitted) fallbacks.push(`cluster ${k}: left out ${id} (no room)`);
          out.bodies.push(...result.bodies);
          out.mechanisms.push(...result.mechanisms);
          out.fields.push(...result.fields);
          out.surfaces.push(...result.surfaces);
          const n = Math.max(1, result.bodies.length);
          clusters.push({
            slot: site.slot,
            intended: cluster.combos[0],
            combo,
            modules,
            x: round(result.bodies.reduce((sum, b) => sum + b.x, 0) / n),
            y: round(result.bodies.reduce((sum, b) => sum + b.y, 0) / n),
            heading: round(result.heading),
            region: `combo-${i}-${k}`,
            profile: info.profile,
            links,
            omitted: result.omitted,
          });
          usedCombos.add(combo);
          done = true;
          break;
        }
        if (done) break;
      }
      if (done) break;
    }
    if (!done) fallbacks.push(`cluster ${k}: no combination could stand; the slot stays open`);
  }
  // The standalone mechanism module: its first choice that places, in its slot or a spare one.
  let filler: RealizedEncounter["filler"] = null;
  for (const f of plan.fillers)
    for (const slot of [f.slot, ...spare]) {
      for (const module of f.modules) {
        const s = SLOTS[slot],
          origin = {
            x: round(recipe.x + Math.cos(s.angle) * s.radius),
            y: round(recipe.y + Math.sin(s.angle) * s.radius),
          };
        const kit = KITS[module];
        const result = tryPlace(
          (o, h) => {
            const r = realize(
              kit,
              `m-${module}`,
              areaId,
              palette,
              o,
              h,
              i,
              `${kit.assembly?.kind ?? module}-${i}-m`,
            );
            return { ...r, loose: looseIds(kit, r.bodies) };
          },
          origin,
          s.angle + Math.PI / 2,
          centre,
        );
        if (!result) {
          fallbacks.push(`filler: ${module} could not stand at slot ${slot}`);
          continue;
        }
        out.bodies.push(...result.bodies);
        out.mechanisms.push(...result.mechanisms);
        out.fields.push(...result.fields);
        out.surfaces.push(...result.surfaces);
        for (const id of result.omitted) fallbacks.push(`filler: left out ${id} (no room)`);
        filler = { slot, module, x: result.origin.x, y: result.origin.y };
        break;
      }
      if (filler) break;
    }
  // The warden's arena around its ground.
  const ground = { x: recipe.x + ROUTE_POINTS.warden.dx, y: recipe.y + ROUTE_POINTS.warden.dy };
  const arena: RealizedEncounter["arena"] = [];
  // The ground itself stays open for the warden (its spot is in keepClear).
  // Its planned kits first; one that cannot stand gives way to another kit (recorded).
  const candidates = [...plan.boss.arena, ...ARENA_IDS.filter((a) => !plan.boss.arena.includes(a))];
  for (const id of candidates) {
    if (arena.length >= plan.boss.arena.length) break;
    const kit = ARENA_KITS[id],
      n = arena.length,
      total = kit.pieces.length;
    const result = tryPlace(
      (o, h) => {
        const r = buildArena(kit, id, areaId, palette, o, h, i, n);
        // Ring pieces stand alone: any of them may be left out (assembly parts may not).
        const loose = new Set(r.bodies.filter((b) => !b.assembly).map((b) => b.id));
        return { ...r, loose };
      },
      ground,
      0,
      { x: ground.x - 1, y: ground.y },
      {
        turns: ARENA_TURNS,
        accept: (placed) => placed.bodies.length >= Math.ceil(total * 0.6),
      },
    );
    if (!result) {
      if (plan.boss.arena.includes(id))
        fallbacks.push(`arena: ${id} could not stand around the warden's ground`);
      continue;
    }
    if (!plan.boss.arena.includes(id)) fallbacks.push(`arena: ${id} stands instead`);
    out.bodies.push(...result.bodies);
    out.mechanisms.push(...result.mechanisms);
    out.fields.push(...result.fields);
    out.surfaces.push(...result.surfaces);
    arena.push({
      kit: id,
      heading: round(result.heading),
      placed: result.bodies.length,
      omitted: result.omitted,
    });
  }
  const finalReach = grid.reach(entry, targets);
  const regions: RegionProfile[] = clusters.map((c) => ({
    id: c.region,
    areaId,
    priority: 15,
    shape: { kind: "circle", x: c.x, y: c.y, radius: 85 },
    values: { ...PROFILES[c.profile].values },
  }));
  return {
    content: out,
    regions,
    manifest: {
      version: 1,
      index: i,
      seed: recipe.seed,
      clusters,
      filler,
      arena,
      boss: plan.boss,
      routes: targets.map((t, k) => ({ id: t.id, ok: !baseline[k] || finalReach[k] })),
      fallbacks,
      overlaps: overlapsIn(out.bodies),
      bodies: out.bodies.length,
    },
  };
}
function cartesian<T>(lists: readonly (readonly T[])[]): T[][] {
  return lists.reduce<T[][]>(
    (acc, list) => acc.flatMap((prefix) => list.map((item) => [...prefix, item])),
    [[]],
  );
}
function looseIds(kit: Kit, bodies: BodyRecipe[]): Set<string> {
  const out = new Set<string>();
  kit.pieces.forEach((p, k) => {
    if (p.loose) out.add(bodies[k].id);
  });
  return out;
}
/** A combination's modules laid along its chain. */
function buildCluster(
  recipe: AreaRecipe,
  palette: number,
  modules: ModuleId[],
  layout: ClusterLayout,
  origin: { x: number; y: number },
  heading: number,
  k: number,
): Placed & { loose: Set<string> } {
  const i = recipe.index,
    areaId = `area-${i}`;
  // Total length to centre the chain on its origin.
  let along = 0;
  const offsets: number[] = [];
  modules.forEach((m, n) => {
    const kit = KITS[m];
    if (n > 0) along += layout.gaps[n - 1] - kit.start;
    else along = -kit.start;
    offsets.push(along);
    along += kit.end;
  });
  const shift = along / 2;
  const cos = Math.cos(heading),
    sin = Math.sin(heading);
  const all: Placed & { loose: Set<string> } = {
    bodies: [],
    mechanisms: [],
    fields: [],
    surfaces: [],
    loose: new Set(),
  };
  modules.forEach((m, n) => {
    const kit = KITS[m],
      x = offsets[n] - shift,
      y = layout.offsets?.[n] ?? 0,
      o = { x: origin.x + cos * x - sin * y, y: origin.y + sin * x + cos * y };
    const prefix = `c${k}-${n}`,
      r = realize(
        kit,
        prefix,
        areaId,
        palette,
        o,
        heading,
        i,
        `${kit.assembly?.kind ?? m}-${i}-c${k}`,
      );
    all.bodies.push(...r.bodies);
    all.mechanisms.push(...r.mechanisms);
    all.fields.push(...r.fields);
    all.surfaces.push(...r.surfaces);
    for (const id of looseIds(kit, r.bodies)) all.loose.add(id);
  });
  return all;
}
/** Verify a placed cluster's chain distances (edge to edge, or inside a pool/field). */
function checkLinks(
  placed: Placed,
  modules: ModuleId[],
  layout: ClusterLayout,
  k: number,
  index: number,
): RealizedCluster["links"] {
  const find = (ref: { module: number; tag: string }) => {
    const prefix = `c${k}-${ref.module}`;
    if (ref.tag === "pool") {
      const s = placed.surfaces.find((s) => s.id === `pool-${index}-${prefix}`);
      return s ? { id: s.id, x: s.x, y: s.y, r: -s.radius } : null;
    }
    if (ref.tag === "eye" || ref.tag === "lane") {
      const f = placed.fields.find((f) => f.id.endsWith(`-${index}-${prefix}-${ref.tag}`));
      if (!f) return null;
      if (f.shape.kind === "circle")
        return { id: f.id, x: f.shape.x, y: f.shape.y, r: -f.shape.radius };
      // A lane: test against its first half (props there are carried).
      const half = f.shape.length / 2;
      return {
        id: f.id,
        x: f.shape.x + Math.cos(f.shape.angle) * half * 0.5,
        y: f.shape.y + Math.sin(f.shape.angle) * half * 0.5,
        r: -Math.max(half * 0.6, f.shape.width / 2),
      };
    }
    const tag =
      ref.tag === "@ignition"
        ? modules[ref.module] === "oil-cellar"
          ? "lantern-0"
          : "brazier-0"
        : ref.tag;
    const id = `prop-${tag.split("-")[0]}-${index}-${prefix}-${tag.split("-").slice(1).join("-")}`;
    const b = placed.bodies.find((b) => b.id === id);
    return b ? { id, x: b.x, y: b.y, r: shapeReach(b.shape) } : null;
  };
  return layout.links.map((l) => {
    const a = find(l.from),
      b = find(l.to);
    if (!a || !b)
      return {
        rule: l.rule,
        from: a?.id ?? "missing",
        to: b?.id ?? "missing",
        distance: -1,
        reach: l.reach,
        ok: false,
      };
    const centre = Math.hypot(a.x - b.x, a.y - b.y);
    // A negative r is an area (pool, field): the piece must stand inside it (within reach).
    const distance =
      b.r < 0 ? round(centre - -b.r + Math.max(0, a.r)) : round(centre - Math.max(0, a.r) - b.r);
    return {
      rule: l.rule,
      from: a.id,
      to: b.id,
      distance,
      reach: l.reach,
      ok: distance <= l.reach,
    };
  });
}
/** An arena kit around the warden's ground; hanging weights are two chain assemblies. */
function buildArena(
  kit: Kit,
  id: ArenaId,
  areaId: string,
  palette: number,
  origin: { x: number; y: number },
  heading: number,
  index: number,
  n: number,
): Placed {
  const prefix = `a${n}`;
  if (id !== "arena-weights")
    return realize(
      kit,
      prefix,
      areaId,
      palette,
      origin,
      heading,
      index,
      `${kit.assembly?.kind ?? id}-${index}-a${n}`,
    );
  const out: Placed = { bodies: [], mechanisms: [], fields: [], surfaces: [] };
  for (const side of WEIGHT_CHAINS) {
    const pieces = kit.pieces.filter((p) => p.tag.startsWith(`${side}-`));
    const sub: Kit = {
      pieces,
      start: 0,
      end: 0,
      assembly: {
        kind: "chain",
        members: pieces.map((p) => `${p.family}-${p.tag}`),
        joints: [
          hinge(
            "anchor",
            `post-${side}-post`,
            `link-${side}-link0`,
            { x: 4.5, y: 0 },
            { x: -5.5, y: 0 },
            2600,
            60,
          ),
          ...[1, 2, 3].map((k) =>
            hinge(
              `link${k}`,
              `link-${side}-link${k - 1}`,
              `link-${side}-link${k}`,
              { x: 5.5, y: 0 },
              { x: -5.5, y: 0 },
              3200,
              90,
            ),
          ),
          hinge(
            "ball",
            `link-${side}-link3`,
            `ball-${side}-ball`,
            { x: 5.5, y: 0 },
            { x: -10, y: 0 },
            3200,
            90,
          ),
        ],
      },
    };
    const r = realize(
      sub,
      prefix,
      areaId,
      palette,
      origin,
      heading,
      index,
      `chain-${index}-a${n}${side}`,
    );
    out.bodies.push(...r.bodies);
    out.mechanisms.push(...r.mechanisms);
  }
  return out;
}

// ---- Land helpers ------------------------------------------------------------------------

/**
 * The terrain a land's clearings stand on, exactly as the adventure configures it (for
 * previews and agent validation without a running game).
 */
export function landWorld(seed: number, land: number): World {
  const first = areaRecipe(seed, land * 4 + 1),
    world = new World(land === 0 ? seed : first.landSeed);
  const town = {
    kind: "town" as const,
    x: 0,
    y: 0,
    radius: 265,
    layout: "town",
    name: townName(land),
  };
  const areas = Array.from({ length: 4 }, (_, k) => {
    const r = areaRecipe(seed, land * 4 + k + 1);
    return {
      kind: "area" as const,
      x: r.x,
      y: r.y,
      radius: r.radius + 35,
      layout: r.layout,
      name: r.name,
    };
  });
  world.setRegions([town, ...areas], town);
  return world;
}
/** Water tiles (shallow or deep) of a world, for module placement. */
export function waterTerrain(world: World): (x: number, y: number) => boolean {
  return (x, y) => {
    const t = world.at(x, y).terrain;
    return t === Terrain.Water || t === Terrain.DeepWater;
  };
}
/** Armor pieces a warden wears (M11 modular bosses), for the catalog and spawning. */
export function armorPieces(armor: ArmorId, pieces: number) {
  const info = ARMOR[armor];
  return Array.from({ length: pieces }, (_, k) => ({
    k,
    family: info.family,
    angle: (k / Math.max(1, pieces)) * Math.PI * 2 + 0.4,
    rest: info.rest,
  }));
}
/** The pieces of one manifest that a fresh build of the same seed would place. */
export function manifestSummary(m: RealizedEncounter) {
  return {
    index: m.index,
    combinations: m.clusters.map((c) => c.combo),
    modules: [...new Set(m.clusters.flatMap((c) => c.modules))],
    filler: m.filler?.module ?? null,
    boss: {
      title: m.boss.title,
      rig: m.boss.rig,
      moves: m.boss.moves,
      armor: `${m.boss.armor}×${m.boss.pieces}`,
      arena: m.boss.arena,
    },
    fallbacks: m.fallbacks.length,
  };
}
export { ARENA, MODULES };
/** Shape check of a saved or received realized manifest (inspection data, bounded). */
export function validateRealized(m: RealizedEncounter): void {
  const fail = (what: string) => {
    throw new Error(`Invalid encounter manifest: ${what}`);
  };
  const keys = (o: object, allowed: string[]) => Object.keys(o).every((k) => allowed.includes(k));
  if (
    !m ||
    typeof m !== "object" ||
    !keys(m, [
      "version",
      "index",
      "seed",
      "clusters",
      "filler",
      "arena",
      "boss",
      "routes",
      "fallbacks",
      "overlaps",
      "bodies",
    ]) ||
    m.version !== 1 ||
    !Number.isSafeInteger(m.index) ||
    m.index <= 8 ||
    !Number.isInteger(m.seed) ||
    !Array.isArray(m.clusters) ||
    m.clusters.length > 4 ||
    !Array.isArray(m.arena) ||
    m.arena.length > 4 ||
    !Array.isArray(m.routes) ||
    m.routes.length > 64 ||
    !Array.isArray(m.fallbacks) ||
    m.fallbacks.length > 64 ||
    m.fallbacks.some((f) => typeof f !== "string" || f.length > 240) ||
    !Array.isArray(m.overlaps) ||
    m.overlaps.length > 64 ||
    !Number.isSafeInteger(m.bodies)
  )
    fail("shape");
  for (const c of m.clusters)
    if (
      !c ||
      !Object.hasOwn(COMBINATIONS, c.combo) ||
      !Object.hasOwn(COMBINATIONS, c.intended) ||
      !Array.isArray(c.modules) ||
      c.modules.some((id) => !Object.hasOwn(MODULES, id)) ||
      !Object.hasOwn(PROFILES, c.profile) ||
      ![c.x, c.y, c.heading].every(Number.isFinite) ||
      typeof c.region !== "string" ||
      !/^combo-\d+-\d$/.test(c.region) ||
      !Array.isArray(c.links) ||
      c.links.length > 8 ||
      !Array.isArray(c.omitted) ||
      c.omitted.length > 32
    )
      fail("cluster");
  if (m.filler !== null && (!m.filler || !Object.hasOwn(MODULES, m.filler.module))) fail("filler");
  for (const a of m.arena) if (!a || !Object.hasOwn(ARENA, a.kit)) fail("arena");
  if (!m.boss || !Object.hasOwn(ARMOR, m.boss.armor) || !Array.isArray(m.boss.moves)) fail("boss");
}
