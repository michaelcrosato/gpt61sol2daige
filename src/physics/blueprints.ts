import { hash } from "../engine/math.ts";
import { isMaterial, MATERIALS, type MaterialId } from "./materials.ts";
import type { BodyPose, BodyRecipe, ShapeRecipe } from "./types.ts";

/**
 * M05 prop blueprints. Every family has its own collider silhouette, material, toughness,
 * authored fracture pieces and a named variant for each of the five land palettes.
 * `durability` in a body's consequences is the remaining percentage (100 = intact).
 */
export const PROP_FAMILIES = [
  "crate",
  "barrel",
  "pot",
  "log",
  "stone",
  "wheel",
  "wagon",
  "fence",
  "pylon",
  "lantern",
  "tree",
  "stump",
  "debris",
  // M07 mechanism parts and the gate pen's reward cache.
  "post",
  "gate",
  "link",
  "ball",
  "vine",
  "pod",
  "plank",
  "sled",
  "vane",
  "chest",
  // M08 reaction scenery: heat and shock sources, conductors, containers, fuse brush and fans.
  "brazier",
  "coil",
  "rod",
  "cask",
  "jar",
  "brush",
  "fan",
] as const;
export type PropFamily = (typeof PROP_FAMILIES)[number];
export const PALETTES = 5;
/** Saved with a body recipe. Pieces name their destroyed parent; debris may expire. */
export interface PropBlueprint {
  family: PropFamily;
  palette: number;
  piece?: string;
  parent?: string;
  /** Simulation tick at which this debris is cleaned up; absent means it lasts the scene. */
  expiresAt?: number;
}
interface PieceRecipe {
  kind: string;
  family: PropFamily;
  material?: MaterialId;
  shape: ShapeRecipe;
  /** Offset and angle in the parent's frame (trees use the fall direction instead). */
  x: number;
  y: number;
  angle: number;
  motion?: "fixed" | "dynamic";
}
export interface FamilyRecipe {
  name: string;
  variants: readonly [string, string, string, string, string];
  material: MaterialId;
  /** Secondary material shown in the silhouette and named in inspection. */
  trim?: MaterialId;
  motion: "fixed" | "dynamic";
  shape: ShapeRecipe;
  massScale: number;
  /** Hit points of material damage to destroy from intact; 0 = cannot be damaged. */
  toughness: number;
  /** Base party gold granted once when destroyed. */
  reward: number;
  pieces: readonly PieceRecipe[];
  /** Gameplay role summary for inspection and documentation. */
  solid:
    | "gameplay solid"
    | "deck: travelers walk over it"
    | "raised: travelers pass under it"
    | "low: travelers walk through it";
  /** M07: false for parts that never meet actors (deck planks, raised vanes). */
  actors?: false;
  /** M07: raised parts (vanes) meet nothing; only attacks and holds move them. */
  raised?: true;
}
const box = (width: number, height: number): ShapeRecipe => ({ kind: "box", width, height });
const circle = (radius: number): ShapeRecipe => ({ kind: "circle", radius });
/** Authored pieces tile the parent footprint with >= 1 unit gaps, so a fracture never starts
 * interpenetrated (and pieces frozen at the moment of breaking can wake later). */
const plank = (k: number, w: number, h: number, x: number, y: number, angle = 0): PieceRecipe => ({
  kind: `plank${k}`,
  family: "debris",
  shape: box(w, h),
  x,
  y,
  angle,
});
const ring = (prefix: string, n: number, shape: ShapeRecipe, distance: number, start = 0) =>
  Array.from({ length: n }, (_, k) => {
    const a = start + (k / n) * Math.PI * 2;
    return {
      kind: `${prefix}${k}`,
      family: "debris" as const,
      shape,
      x: Math.round(Math.cos(a) * distance * 1000) / 1000,
      y: Math.round(Math.sin(a) * distance * 1000) / 1000,
      angle: Math.round((a + Math.PI / 2) * 1000) / 1000,
    };
  });
const part = (
  name: string,
  variants: FamilyRecipe["variants"],
  material: MaterialId,
  shape: ShapeRecipe,
  massScale: number,
  extra: Partial<FamilyRecipe> = {},
): FamilyRecipe => ({
  name,
  variants,
  material,
  motion: "dynamic",
  shape,
  massScale,
  toughness: 0,
  reward: 0,
  pieces: [],
  solid: "gameplay solid",
  ...extra,
});
export const FAMILIES: Record<PropFamily, FamilyRecipe> = {
  crate: {
    name: "Crate",
    variants: [
      "Pine slat crate",
      "Iron-bound char crate",
      "Driftwood crate",
      "Plum-stained crate",
      "Birch frost crate",
    ],
    material: "wood",
    motion: "dynamic",
    shape: box(22, 22),
    massScale: 1,
    toughness: 40,
    reward: 3,
    pieces: [-8.25, -2.75, 2.75, 8.25].map((y, k) => plank(k, 20, 4, 0, y)),
    solid: "gameplay solid",
  },
  barrel: {
    name: "Barrel",
    variants: [
      "Oak cider barrel",
      "Ember-tar barrel",
      "Salt-cask barrel",
      "Duskwine barrel",
      "Frost brine barrel",
    ],
    material: "wood",
    trim: "metal",
    motion: "dynamic",
    shape: circle(9),
    massScale: 1.4,
    toughness: 50,
    reward: 4,
    pieces: [
      ...[-5, -0.5, 4].map((y, k) => plank(k, 14, 3.5, 0, y)),
      {
        kind: "hoop",
        family: "debris",
        material: "metal",
        shape: box(10, 2),
        x: 0,
        y: 7.75,
        angle: 0,
      },
    ],
    solid: "gameplay solid",
  },
  pot: {
    name: "Pot",
    variants: ["Moss clay pot", "Ash urn", "Tideglass amphora", "Violet jar", "Frost-glazed jar"],
    material: "ceramic",
    motion: "dynamic",
    shape: circle(6),
    massScale: 1,
    toughness: 10,
    reward: 5,
    pieces: [
      [-3, -2.5],
      [3, -2.5],
      [-3, 2.5],
      [3, 2.5],
    ].map(([x, y], k) => ({
      kind: `shard${k}`,
      family: "debris" as const,
      shape: box(5, 3.5),
      x,
      y,
      angle: 0,
    })),
    solid: "gameplay solid",
  },
  log: {
    name: "Log",
    variants: [
      "Fallen oak log",
      "Scorched log",
      "Salt-bleached log",
      "Duskwood log",
      "Frozen birch log",
    ],
    material: "wood",
    motion: "dynamic",
    shape: box(46, 11),
    massScale: 2,
    toughness: 70,
    reward: 0,
    pieces: [
      { kind: "half0", family: "debris", shape: box(21, 10), x: -12, y: 0, angle: 0.1 },
      { kind: "half1", family: "debris", shape: box(21, 10), x: 12, y: 0, angle: -0.1 },
    ],
    solid: "gameplay solid",
  },
  stone: {
    name: "Loose stone",
    variants: [
      "Mossy boulder",
      "Basalt chunk",
      "Sea-worn stone",
      "Violet slate",
      "Frost-split rock",
    ],
    material: "stone",
    motion: "dynamic",
    shape: circle(9),
    massScale: 1,
    toughness: 120,
    reward: 0,
    pieces: ring("chunk", 3, circle(4), 5.2),
    solid: "gameplay solid",
  },
  wheel: {
    name: "Wheel",
    variants: ["Cart wheel", "Iron-rim wheel", "Spoked tide wheel", "Pilgrim wheel", "Sled runner"],
    material: "wood",
    trim: "metal",
    motion: "dynamic",
    shape: circle(10),
    massScale: 1,
    toughness: 45,
    reward: 0,
    pieces: [
      ...ring("rim", 4, box(10, 3), 7.5, Math.PI / 4),
      {
        kind: "hub",
        family: "debris",
        material: "metal",
        shape: circle(2.5),
        x: 0,
        y: 0,
        angle: 0,
      },
    ],
    solid: "gameplay solid",
  },
  wagon: {
    name: "Wagon",
    variants: ["Farm wagon", "Ember cart", "Fisher's wagon", "Pilgrim wagon", "Frost sled-wagon"],
    material: "wood",
    trim: "cloth",
    motion: "dynamic",
    shape: box(50, 26),
    massScale: 2.2,
    toughness: 120,
    reward: 9,
    pieces: [
      {
        kind: "canopy",
        family: "debris",
        material: "cloth",
        shape: box(22, 8),
        x: -12,
        y: -8,
        angle: 0,
      },
      plank(0, 22, 4, 12, -8),
      plank(1, 22, 4, -12, 0),
      plank(2, 22, 4, 12, 0),
      plank(3, 22, 4, -12, 7),
      { kind: "wheel0", family: "wheel", shape: circle(10), x: -15, y: 20, angle: 0 },
      { kind: "wheel1", family: "wheel", shape: circle(10), x: 15, y: 20, angle: 0 },
    ],
    solid: "gameplay solid",
  },
  fence: {
    name: "Fence",
    variants: [
      "Wattle fence",
      "Iron-spiked fence",
      "Driftwood rail",
      "Thorn fence",
      "Birch picket",
    ],
    material: "wood",
    motion: "fixed",
    shape: box(34, 5),
    massScale: 1,
    toughness: 30,
    reward: 0,
    pieces: [
      { kind: "rail0", family: "debris", shape: box(15, 4), x: -8.5, y: 0, angle: 0.15 },
      { kind: "rail1", family: "debris", shape: box(15, 4), x: 8.5, y: 0, angle: -0.15 },
    ],
    solid: "gameplay solid",
  },
  pylon: {
    name: "Glass pylon",
    variants: [
      "Greenglass pylon",
      "Obsidian pylon",
      "Tideglass pylon",
      "Amethyst pylon",
      "Iceglass pylon",
    ],
    material: "glass",
    motion: "fixed",
    shape: circle(7),
    massScale: 1,
    toughness: 15,
    reward: 0,
    pieces: ring("shard", 5, box(4, 3), 5),
    solid: "gameplay solid",
  },
  lantern: {
    name: "Lantern",
    variants: ["Moss lantern", "Ember lantern", "Tide lantern", "Dusk lantern", "Frost lantern"],
    material: "metal",
    trim: "glass",
    motion: "fixed",
    shape: circle(5),
    massScale: 1,
    toughness: 18,
    reward: 2,
    pieces: [
      { kind: "frame", family: "debris", shape: box(5, 5), x: -2.5, y: 0, angle: 0 },
      { kind: "pane", family: "debris", material: "glass", shape: box(3, 3), x: 3, y: 0, angle: 0 },
    ],
    solid: "gameplay solid",
  },
  tree: {
    name: "Tree",
    variants: ["Oak", "Ember pine", "Salt willow", "Dusk elm", "Frost birch"],
    material: "wood",
    trim: "vegetation",
    motion: "fixed",
    shape: circle(9),
    massScale: 1,
    toughness: 140,
    reward: 0,
    pieces: [
      { kind: "stump", family: "stump", shape: circle(8), x: 0, y: 0, angle: 0, motion: "fixed" },
      { kind: "log", family: "log", shape: box(46, 11), x: 34, y: 0, angle: 0 },
    ],
    solid: "gameplay solid",
  },
  stump: {
    name: "Stump",
    variants: ["Oak stump", "Pine stump", "Willow stump", "Elm stump", "Birch stump"],
    material: "wood",
    motion: "fixed",
    shape: circle(8),
    massScale: 1,
    toughness: 0,
    reward: 0,
    pieces: [],
    solid: "gameplay solid",
  },
  debris: {
    name: "Debris",
    variants: ["Debris", "Debris", "Debris", "Debris", "Debris"],
    material: "wood",
    motion: "dynamic",
    shape: box(8, 4),
    massScale: 1,
    toughness: 0,
    reward: 0,
    pieces: [],
    solid: "gameplay solid",
  },
  // Mechanism parts are never destroyed: attacks cut their joints instead (M07).
  post: part(
    "Post",
    ["Hitching post", "Iron-capped post", "Driftwood piling", "Dusk stake", "Frost post"],
    "wood",
    circle(4),
    1,
    { motion: "fixed", trim: "metal" },
  ),
  gate: part(
    "Gate",
    ["Wattle gate", "Ember gate", "Driftwood gate", "Thorn gate", "Birch gate"],
    "wood",
    box(34, 5),
    4.5,
    { trim: "metal" },
  ),
  link: part(
    "Chain link",
    ["Iron link", "Soot link", "Brine link", "Dusk link", "Rime link"],
    "metal",
    box(10, 4),
    1,
  ),
  ball: part(
    "Spiked ball",
    ["Iron morningstar", "Cinder flail", "Anchor weight", "Dusk mace", "Frost flail"],
    "metal",
    circle(9),
    2,
  ),
  vine: part(
    "Vine",
    ["Ivy vine", "Ember creeper", "Kelp rope", "Night vine", "Frost ivy"],
    "vegetation",
    box(9, 3),
    3,
  ),
  pod: part(
    "Seed pod",
    ["Moss pod", "Ember gourd", "Kelp bulb", "Dusk pod", "Frost pod"],
    "vegetation",
    circle(5),
    4,
  ),
  plank: part(
    "Causeway plank",
    ["Oak plank", "Char plank", "Driftwood plank", "Plum plank", "Birch plank"],
    "wood",
    box(22, 14),
    1.2,
    { actors: false, solid: "deck: travelers walk over it" },
  ),
  sled: part(
    "Launcher sled",
    ["Spring sled", "Ember ram", "Tide ram", "Dusk ram", "Frost ram"],
    "wood",
    box(8, 16),
    4,
    { trim: "metal" },
  ),
  vane: part(
    "Wind vane",
    ["Mill vane", "Cinder vane", "Gull vane", "Dusk vane", "Frost vane"],
    "wood",
    box(34, 4),
    3,
    { trim: "cloth", actors: false, raised: true, solid: "raised: travelers pass under it" },
  ),
  chest: {
    name: "Cache chest",
    variants: ["Moss chest", "Ember strongbox", "Salt chest", "Dusk coffer", "Frost chest"],
    material: "wood",
    trim: "metal",
    motion: "dynamic",
    shape: box(18, 13),
    massScale: 3,
    toughness: 60,
    reward: 18,
    pieces: [
      plank(0, 16, 3.5, 0, -4.5),
      plank(1, 16, 3.5, 0, 0),
      plank(2, 9, 3, 4, 4.5),
      {
        kind: "lock",
        family: "debris",
        material: "metal",
        shape: box(5, 3),
        x: -5,
        y: 4.5,
        angle: 0,
      },
    ],
    solid: "gameplay solid",
  },
  // M08: the fixed sources never break; containers and brush do (their contents spill or burn).
  brazier: part(
    "Brazier",
    ["Moss brazier", "Cinder brazier", "Driftwood brazier", "Dusk brazier", "Frost brazier"],
    "metal",
    circle(8),
    1,
    { motion: "fixed", trim: "stone" },
  ),
  coil: part(
    "Storm coil",
    ["Copper coil", "Soot coil", "Brine coil", "Dusk coil", "Rime coil"],
    "metal",
    circle(7),
    1,
    { motion: "fixed", trim: "glass" },
  ),
  rod: part(
    "Conductor rod",
    ["Copper rod", "Iron spike", "Brine rod", "Dusk rod", "Rime rod"],
    "metal",
    circle(3.5),
    1,
    { motion: "fixed" },
  ),
  cask: {
    name: "Water cask",
    variants: ["Rain cask", "Quench cask", "Brine cask", "Dew cask", "Meltwater cask"],
    material: "wood",
    trim: "metal",
    motion: "dynamic",
    shape: circle(8.5),
    massScale: 1.6,
    toughness: 40,
    reward: 0,
    pieces: [
      ...[-4.5, 0, 4.5].map((y, k) => plank(k, 13, 3.5, 0, y)),
      {
        kind: "hoop",
        family: "debris",
        material: "metal",
        shape: box(9, 2),
        x: 0,
        y: 7.5,
        angle: 0,
      },
    ],
    solid: "gameplay solid",
  },
  jar: {
    name: "Oil jar",
    variants: ["Lamp-oil jar", "Pitch jar", "Whale-oil jar", "Nightshade oil jar", "Tallow jar"],
    material: "ceramic",
    motion: "dynamic",
    shape: circle(6.5),
    massScale: 1.2,
    toughness: 20,
    reward: 0,
    pieces: ring("shard", 4, box(4, 3), 4.5),
    solid: "gameplay solid",
  },
  brush: {
    name: "Dry brush",
    variants: ["Tinder grass", "Ember bracken", "Dry kelp", "Dusk thistle", "Frost reeds"],
    material: "vegetation",
    motion: "fixed",
    shape: box(16, 7),
    massScale: 1,
    toughness: 25,
    reward: 0,
    pieces: [],
    solid: "low: travelers walk through it",
    actors: false,
  },
  fan: part(
    "Wind fan",
    ["Mill fan", "Bellows fan", "Gull fan", "Dusk fan", "Frost fan"],
    "metal",
    circle(9),
    1,
    { motion: "fixed", trim: "cloth" },
  ),
};
const area = (shape: ShapeRecipe) =>
  shape.kind === "circle" ? Math.PI * shape.radius ** 2 : shape.width * shape.height;
const round = (value: number) => Math.round(value * 1000) / 1000;
/** A complete prop body recipe from its blueprint; physical response comes from the material. */
export function propRecipe(
  id: string,
  family: PropFamily,
  palette: number,
  x: number,
  y: number,
  areaId: string,
  options: {
    angle?: number;
    material?: MaterialId;
    shape?: ShapeRecipe;
    motion?: "fixed" | "dynamic";
  } = {},
): BodyRecipe {
  const recipe = FAMILIES[family],
    material = options.material ?? recipe.material,
    m = MATERIALS[material],
    shape = structuredClone(options.shape ?? recipe.shape);
  return {
    id,
    motion: options.motion ?? recipe.motion,
    role: "prop",
    areaId,
    shape,
    x,
    y,
    angle: options.angle ?? 0,
    mass: Math.max(0.05, round(m.density * area(shape) * recipe.massScale)),
    friction: m.friction,
    restitution: m.restitution,
    damping: m.damping,
    material,
    blueprint: { family, palette },
    consequences: {
      destroyed: false,
      claimed: false,
      ...(recipe.toughness > 0 ? { durability: 100 } : {}),
    },
  };
}
export const damageStage = (durability: number) =>
  durability <= 0 ? 3 : durability <= 33.334 ? 2 : durability <= 66.667 ? 1 : 0;
export function variantName(blueprint: PropBlueprint): string {
  return FAMILIES[blueprint.family].variants[blueprint.palette % PALETTES];
}
export interface FracturePiece {
  recipe: BodyRecipe;
  vx: number;
  vy: number;
  angularVelocity: number;
}
/**
 * Authored fracture with a seeded burst. Pieces inherit the parent's motion plus an outward
 * material burst; a tree falls away from the hit as a stump and a pushable log.
 */
export function fracture(
  parent: BodyPose,
  hitAngle: number,
  tick: number,
  debrisLifetimeTicks: number,
): FracturePiece[] {
  const blueprint = parent.blueprint!,
    family = FAMILIES[blueprint.family],
    material = parent.material ?? family.material,
    burst = MATERIALS[material].burst,
    seed = [...parent.id].reduce((h, c) => hash(h, c.charCodeAt(0)), 0x51ed);
  const frame = blueprint.family === "tree" ? hitAngle : parent.angle,
    cos = Math.cos(frame),
    sin = Math.sin(frame);
  return family.pieces.map((piece, k) => {
    // Seeded variation lives in burst speed and spin; authored offsets keep pieces disjoint.
    const jitter = (n: number) => ((hash(seed, k, n) % 2001) / 1000 - 1) * 1.5;
    const x = parent.x + cos * piece.x - sin * piece.y,
      y = parent.y + sin * piece.x + cos * piece.y;
    const pieceFamily = piece.family,
      debris = pieceFamily === "debris",
      motion =
        piece.motion ??
        (debris || FAMILIES[pieceFamily].motion === "dynamic" ? "dynamic" : "fixed");
    const recipe = propRecipe(
      `${parent.id}-${piece.kind}`,
      pieceFamily,
      blueprint.palette,
      x,
      y,
      parent.areaId!,
      {
        angle: frame + piece.angle,
        material: piece.material ?? (debris ? material : FAMILIES[pieceFamily].material),
        shape: piece.shape,
        motion,
      },
    );
    recipe.blueprint = {
      family: pieceFamily,
      palette: blueprint.palette,
      piece: piece.kind,
      parent: parent.id,
      ...(debris && debrisLifetimeTicks > 0 ? { expiresAt: tick + debrisLifetimeTicks } : {}),
    };
    if (motion === "fixed") return { recipe, vx: 0, vy: 0, angularVelocity: 0 };
    const outward = Math.atan2(y - parent.y, x - parent.x) || hitAngle,
      speed = blueprint.family === "tree" ? 40 : burst * (0.6 + (hash(seed, k, 3) % 400) / 1000);
    return {
      recipe,
      vx: parent.vx + Math.cos(outward) * speed + Math.cos(hitAngle) * speed * 0.4,
      vy: parent.vy + Math.sin(outward) * speed + Math.sin(hitAngle) * speed * 0.4,
      angularVelocity: parent.angularVelocity + jitter(4) * 3,
    };
  });
}
/** Authored clearing layout, relative to an area's center. Fixed scenery stays off the entry,
 * mechanic ring, boss spot and outward portal. */
export const CLEARING_LAYOUT: readonly {
  family: PropFamily;
  n: number;
  dx: number;
  dy: number;
  angle?: number;
  material?: MaterialId;
}[] = [
  { family: "barrel", n: 0, dx: 20, dy: 100 },
  { family: "barrel", n: 1, dx: 44, dy: 108, material: "volatile" },
  { family: "pot", n: 0, dx: -100, dy: 82 },
  { family: "pot", n: 1, dx: -114, dy: 97 },
  { family: "log", n: 0, dx: 70, dy: 160, angle: 0.35 },
  { family: "stone", n: 0, dx: -150, dy: 150 },
  { family: "stone", n: 1, dx: -172, dy: 136 },
  { family: "wagon", n: 0, dx: -30, dy: 240, angle: -0.1 },
  { family: "fence", n: 0, dx: 140, dy: 236 },
  { family: "fence", n: 1, dx: 176, dy: 236 },
  { family: "fence", n: 2, dx: 212, dy: 236 },
  { family: "pylon", n: 0, dx: 112, dy: -138 },
  { family: "lantern", n: 0, dx: -150, dy: 46 },
  { family: "tree", n: 0, dx: 70, dy: 296 },
  { family: "tree", n: 1, dx: -262, dy: -200 },
  { family: "tree", n: 2, dx: 250, dy: -236 },
];
export const shapeReach = (shape: ShapeRecipe) =>
  shape.kind === "circle" ? shape.radius : Math.hypot(shape.width, shape.height) / 2;
/**
 * Clearing props for one area. A spot over solid terrain (deep water, rooted decor) turns
 * around the area center in fixed steps, keeping its distance from the mechanic ring.
 */
export function clearingProps(
  area: { index: number; x: number; y: number },
  palette: number,
  blocked: (x: number, y: number, reach: number) => boolean = () => false,
): BodyRecipe[] {
  return CLEARING_LAYOUT.map((p) => {
    const reach = shapeReach(FAMILIES[p.family].shape),
      distance = Math.hypot(p.dx, p.dy),
      heading = Math.atan2(p.dy, p.dx);
    let x = area.x + p.dx,
      y = area.y + p.dy;
    for (let k = 1; k <= 12 && blocked(x, y, reach); k++) {
      const turn = heading + ((k + 1) >> 1) * 0.16 * (k % 2 ? 1 : -1);
      x = round(area.x + Math.cos(turn) * distance);
      y = round(area.y + Math.sin(turn) * distance);
    }
    return propRecipe(
      `prop-${p.family}-${area.index}-${p.n}`,
      p.family,
      palette,
      x,
      y,
      `area-${area.index}`,
      { angle: p.angle ?? 0, ...(p.material ? { material: p.material } : {}) },
    );
  });
}
/** M03/M04 crates and wheels keep their exact bodies; M05 adds their material blueprint. */
export function legacyBlueprint(
  id: string,
  palette: number,
): Pick<BodyRecipe, "material" | "blueprint"> | null {
  if (/^crate-\d+-\d+$/.test(id))
    return { material: "wood", blueprint: { family: "crate", palette } };
  if (/^wheel-\d+$/.test(id)) return { material: "wood", blueprint: { family: "wheel", palette } };
  return null;
}
export function validateBlueprint(recipe: BodyRecipe): void {
  if (recipe.material === undefined && recipe.blueprint === undefined) return;
  if (!isMaterial(recipe.material) || !recipe.blueprint || recipe.role !== "prop")
    throw new Error("Prop blueprints require a registered material and prop role");
  const b = recipe.blueprint;
  if (
    typeof b !== "object" ||
    Array.isArray(b) ||
    Object.keys(b).some(
      (key) => !["family", "palette", "piece", "parent", "expiresAt"].includes(key),
    ) ||
    !(PROP_FAMILIES as readonly string[]).includes(b.family) ||
    !Number.isInteger(b.palette) ||
    b.palette < 0 ||
    b.palette >= PALETTES ||
    (b.piece !== undefined && (typeof b.piece !== "string" || !/^[a-z]+\d*$/.test(b.piece))) ||
    (b.parent !== undefined &&
      (typeof b.parent !== "string" || !/^[\w-]{1,160}$/.test(b.parent))) ||
    (b.piece === undefined) !== (b.parent === undefined) ||
    (b.expiresAt !== undefined && (!Number.isSafeInteger(b.expiresAt) || b.expiresAt < 0))
  )
    throw new Error("Invalid prop blueprint");
  const toughness = FAMILIES[b.family].toughness,
    durability = recipe.consequences?.durability;
  if (toughness > 0 ? durability === undefined || durability > 100 : durability !== undefined)
    throw new Error("Prop durability does not match its blueprint");
}
/** Reproducible registry export for agents, tools and documentation. */
export function blueprintExport() {
  return {
    version: 1,
    durability: "percentage remaining; toughness is material damage from intact to destroyed",
    stages: { intact: ">66.7%", cracked: ">33.3%", failing: ">0%", destroyed: "0%" },
    materials: structuredClone(MATERIALS),
    families: Object.fromEntries(
      PROP_FAMILIES.map((family) => [
        family,
        {
          ...structuredClone(FAMILIES[family]),
          example: propRecipe(`prop-${family}-1-0`, family, 0, 0, 0, "area-1"),
        },
      ]),
    ),
    layout: structuredClone(CLEARING_LAYOUT),
  };
}
