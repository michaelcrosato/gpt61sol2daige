import { type AreaRecipe, type MechanicId, mechanicLayout, TOWN_NPCS } from "../game/content.ts";
import { CLEARING_LAYOUT, clearingProps, FAMILIES, propRecipe, shapeReach } from "./blueprints.ts";
import { areaMechanisms, type MechanismBlueprint, type MechanismKind } from "./mechanisms.ts";
import { areaReactions, type FieldRecipe, type ReactionSurface } from "./reactions.ts";
import type { BodyRecipe, JointRecipe } from "./types.ts";

/**
 * M10 authored world: the town's Sanctuary scene and each area's physical extension of its
 * mechanics. Everything here is a recipe built from the M05–M09 vocabulary (families, joints,
 * fields and surfaces) and a pure function of the area recipe and land palette, so a land
 * rebuilds the same scene and replicas draw it from received state alone.
 */
export interface ShowcaseContent {
  bodies: BodyRecipe[];
  mechanisms: MechanismBlueprint[];
  fields: FieldRecipe[];
  /** Authored permanent surfaces (Stormglass pools): `ticks` is -1. */
  surfaces: ReactionSurface[];
}
export interface ShowcaseInfo {
  name: string;
  /** What the mechanic now does physically, for the guide and documentation. */
  physical: string;
  /** What its authored set piece is. */
  setPiece: string;
  /** What switching the governing control off changes; the base mechanic always works. */
  off: string;
}
/** The physical extension of each area mechanic (M10). */
export const SHOWCASE: Record<MechanicId, ShowcaseInfo> = {
  bramble: {
    name: "Thornburst",
    physical:
      "A burst pod shoves the pack outward before the roots hold it, flings thorn splinters that hurt what they strike and breaks fragile hedges.",
    setPiece: "A thorn-hedge arc behind each pod shelters a seed cache.",
    off: "Environmental forces off: no shove. Dynamic props off: no splinters. Destruction off: hedges stand.",
  },
  wind: {
    name: "Tailwind lanes",
    physical:
      "Each lane carries travelers, monsters and loose props along the ring; crossing it adds a strong gust owned by the crosser, so what it throws hurts monsters.",
    setPiece: "A permanent wind lane with a barrel, a wheel and a vane that it drives.",
    off: "Environmental forces off: lanes and gusts stop; the haste and spirit remain.",
  },
  glass: {
    name: "Conductor yard",
    physical:
      "Pylons discharge into a standing pool and conductor rods; monsters wading the pool get wet, and any hero strike on a wet monster arcs through the wet pack.",
    setPiece:
      "A permanent pool, two conductor rods and a breakable glass pylon that releases its charge.",
    off: "Material reactions off: no pool soaking, conduction or arcs; the pylon's direct lightning still hits.",
  },
  echo: {
    name: "Resonant echo",
    physical:
      "A well repeats the ability's full physical force (Whorl's and Nova's launch, Thornlance's pierce) for the same caster; anything already broken or claimed pays once.",
    setPiece: "Resonance pots and stones around each well.",
    off: "World reactions off: the echo repeats damage only.",
  },
  cinder: {
    name: "Vent eruption",
    physical:
      "Crossing a vent erupts it: fire runs along a dry-brush fuse into a weakened barricade, which burns through and opens its cache.",
    setPiece: "A brush fuse leading to a weakened four-board stockade around a cache.",
    off: "Material reactions off: no eruption or burning; the burning-strike buff remains.",
  },
  blood: {
    name: "Bloom snare",
    physical:
      "Trading life at a bloom grows living vines: elastic restraints that drag up to six nearby monsters toward the bloom and hold them until they wither or snap.",
    setPiece: "The bloom itself: vines anchor there.",
    off: "Mechanisms off: no vines (or held vines go slack); joint breakage off: vines never snap. The damage and experience bonus remains.",
  },
  gravity: {
    name: "Drifting knot",
    physical:
      "A struck knot rolls away along the blow, and its pull drags the gathered monsters, loose material and loot with it as one moving cluster.",
    setPiece: "Stones, a log and a barrel around each knot.",
    off: "Environmental forces off: no pull or drift; the knot's root and impulse remain.",
  },
  rift: {
    name: "Rift freight",
    physical:
      "Loose props and unanchored assemblies on an arch's pad travel with the traveler and burst outward on arrival; arrivals stagger monsters nearby.",
    setPiece: "A pad of crates and a barrel at the first arch.",
    off: "Dynamic props off: freight stays behind. Environmental forces off: no arrival push.",
  },
};
/** Town services and the clear ring each keeps (M10 Sanctuary protection). */
export const TOWN_SERVICES = [
  { id: "rest", name: "Hearth", x: 0, y: 30, radius: 60 },
  { id: "gate", name: "Outward gate", x: 218, y: 36, radius: 56 },
  ...TOWN_NPCS.map((npc) => ({
    id: npc.id,
    name: npc.name,
    x: npc.x,
    y: npc.y,
    radius: 34,
  })),
] as const;
/** The tactile market square: inside it loose props block travelers (Sanctuary elsewhere). */
export const TOWN_MARKET = { x: -230, y: -178, width: 210, height: 103 } as const;
/** A Riftstep arch's pad: loose props within this reach travel with the traveler. */
export const FREIGHT_PAD = 58;

const round = (value: number) => Math.round(value * 1000) / 1000;
const member = (assembly: string, recipe: BodyRecipe): BodyRecipe => ({ ...recipe, assembly });
function mechanism(
  kind: MechanismKind,
  id: string,
  areaId: string,
  bodies: BodyRecipe[],
  joints: Omit<JointRecipe, "assembly">[],
): MechanismBlueprint {
  return {
    recipe: {
      id,
      kind,
      areaId,
      root: bodies[0].id,
      members: bodies.map((b) => b.id),
      event: "none",
    },
    bodies: bodies.map((b) => member(id, b)),
    joints: joints.map((j) => ({ ...j, assembly: id })),
  };
}

/** The town's Sanctuary scene: stalls, hanging lamps, bunting, market goods and its fields. */
export function townScene(palette: number): ShowcaseContent {
  const areaId = "town",
    body = (
      id: string,
      family: Parameters<typeof propRecipe>[1],
      x: number,
      y: number,
      options: Parameters<typeof propRecipe>[6] = {},
    ) => propRecipe(id, family, palette, round(x), round(y), areaId, options);
  const bodies: BodyRecipe[] = [],
    mechanisms: MechanismBlueprint[] = [];
  // Market stalls: a fixed counter under a sprung cloth awning.
  [
    [-182, -96],
    [-134, -118],
    [-80, -130],
  ].forEach(([x, y], k) => {
    const counter = `prop-stall-town-${k}`,
      awning = `prop-awning-town-${k}`;
    mechanisms.push(
      mechanism(
        "stall",
        `stall-town-${k}`,
        areaId,
        [body(counter, "stall", x, y), body(awning, "awning", x, y - 4)],
        [
          {
            id: `stall-town-${k}:pivot`,
            kind: "hinge",
            a: counter,
            b: awning,
            anchorA: { x: 0, y: -4 },
            anchorB: { x: 0, y: 0 },
            limits: [-0.9, 0.9],
            motor: { mode: "position", target: 0, stiffness: 14, damping: 5 },
            breakLoad: 900,
            toughness: 30,
          },
        ],
      ),
    );
    bodies.push(body(`prop-basket-town-${k}`, "basket", x, y + 18));
  });
  // Hanging lamps on bracket arms (they replace the painted lamp posts).
  [
    [-145, 48],
    [126, 52],
    [54, 104],
    [-14, -120],
  ].forEach(([x, y], k) => {
    const post = `prop-post-town-lamp${k}`,
      lamp = `prop-lamp-town-${k}`;
    mechanisms.push(
      mechanism(
        "lamp",
        `lamp-town-${k}`,
        areaId,
        [body(post, "post", x, y), body(lamp, "lamp", x + 10, y)],
        [
          {
            id: `lamp-town-${k}:arm`,
            kind: "hinge",
            a: post,
            b: lamp,
            anchorA: { x: 0, y: 0 },
            anchorB: { x: -10, y: 0 },
            motor: { mode: "position", target: 0, stiffness: 10, damping: 3 },
            breakLoad: 700,
            toughness: 20,
          },
        ],
      ),
    );
  });
  // Bunting: ten pennants on ropes between two posts across the market's north side.
  {
    const a = { x: -190, y: -150 },
      b = { x: -60, y: -170 },
      count = 10,
      length = Math.hypot(b.x - a.x, b.y - a.y),
      ux = (b.x - a.x) / length,
      uy = (b.y - a.y) / length,
      angle = Math.atan2(uy, ux),
      west = "prop-post-town-bunting0",
      east = "prop-post-town-bunting1",
      step = length / (count + 1),
      pennants = Array.from({ length: count }, (_, j) => `prop-pennant-town-${j}`);
    // Each rope spans the gap between its anchors with a unit of slack: the line can bow.
    const rope = (id: string, from: string, to: string, ax: number, bx: number) => ({
      id,
      kind: "rope" as const,
      a: from,
      b: to,
      anchorA: { x: ax, y: 0 },
      anchorB: { x: bx, y: 0 },
      length: round(step - Math.abs(ax) - Math.abs(bx) + 1),
      breakLoad: 400,
      toughness: 10,
    });
    mechanisms.push(
      mechanism(
        "bunting",
        "bunting-town",
        areaId,
        [
          body(west, "post", a.x, a.y, { angle }),
          ...pennants.map((id, j) =>
            body(id, "pennant", a.x + ux * step * (j + 1), a.y + uy * step * (j + 1), { angle }),
          ),
          body(east, "post", b.x, b.y, { angle }),
        ],
        [
          rope("bunting-town:rope0", west, pennants[0], 0, -4.5),
          ...pennants
            .slice(1)
            .map((id, j) => rope(`bunting-town:rope${j + 1}`, pennants[j], id, 4.5, -4.5)),
          rope(`bunting-town:rope${count}`, pennants[count - 1], east, 4.5, 0),
        ],
      ),
    );
  }
  // Harmless market goods.
  for (const [family, k, x, y] of [
    ["crate", 0, -214, -88],
    ["crate", 1, -152, -80],
    ["barrel", 0, -50, -100],
    ["pot", 0, -36, -114],
    ["pot", 1, -26, -98],
    ["basket", 3, -110, -152],
    ["basket", 4, 40, -80],
  ] as const)
    bodies.push(body(`prop-${family}-town-${k}`, family, x, y));
  const fields: FieldRecipe[] = [
    {
      // A gusting breeze across the bunting: the line bows downwind and flutters with the gusts.
      id: "breeze-town",
      kind: "wind",
      areaId,
      shape: { kind: "lane", x: -129.9, y: -191.6, angle: 1.418, length: 64, width: 140 },
      strength: 300,
      ticks: -1,
      gust: 0.8,
      actors: false,
      owner: "",
      team: "world",
      source: "authored",
    },
    // Keep-clear rings: loose props drift off the hearth, the gate and each townsperson's post.
    ...TOWN_SERVICES.map(
      (s): FieldRecipe => ({
        id: `sanctuary-${s.id}`,
        kind: "repel",
        areaId,
        shape: { kind: "circle", x: s.x, y: s.y, radius: s.radius },
        strength: 400,
        ticks: -1,
        gust: 0,
        actors: false,
        owner: "",
        team: "world",
        source: "authored",
      }),
    ),
  ];
  return {
    bodies: [...mechanisms.flatMap((m) => m.bodies), ...bodies],
    mechanisms,
    fields,
    surfaces: [],
  };
}

type Circle = { x: number; y: number; r: number; anchor?: string };
/** Existing content and gameplay spots of one area that set pieces must leave clear. */
/** Reaction sources earlier milestones placed: set pieces keep a berth so none of their fire,
 * charge or blasts reaches new content by accident. */
const SOURCES = new Set(["pylon", "lantern", "brazier", "coil", "jar", "cask", "fan"]);
function occupied(
  recipe: AreaRecipe,
  palette: number,
  blocked: Blocked,
  base?: readonly BodyRecipe[],
): Circle[] {
  const out: Circle[] = [];
  const add = (b: BodyRecipe) => {
    const family = b.blueprint?.family ?? "",
      source = SOURCES.has(family) || b.material === "volatile";
    out.push({ x: b.x, y: b.y, r: shapeReach(b.shape) + (source ? 30 : 0) });
  };
  if (base) {
    // M11 generated areas: only the base scenery stands before the set pieces.
    for (const b of base) add(b);
    for (const [dx, dy, r] of [
      [-230, 0, 46],
      [-265, 95, 42],
      [275, 0, 54],
      [130, 0, 22],
    ] as const)
      out.push({ x: recipe.x + dx, y: recipe.y + dy, r });
    return out;
  }
  for (let n = 0; n < 4; n++)
    out.push({ x: recipe.x - 55 + (n % 2) * 25, y: recipe.y + 40 + Math.floor(n / 2) * 25, r: 16 });
  out.push({ x: recipe.x - 85, y: recipe.y + 40, r: 10 });
  for (const b of clearingProps(recipe, palette, blocked)) add(b);
  const { mechanisms, extras } = areaMechanisms(recipe, palette);
  for (const m of mechanisms) for (const b of m.bodies) add(b);
  for (const b of extras) add(b);
  for (const b of areaReactions(recipe, palette, blocked).props) add(b);
  // Arrival, both portals, the advance lane's mouth and the warden's spawn stay open.
  for (const [dx, dy, r] of [
    [-230, 0, 46],
    [-265, 95, 42],
    [275, 0, 54],
    // The warden spawns here (its body is 22 units across the radius).
    [130, 0, 22],
  ] as const)
    out.push({ x: recipe.x + dx, y: recipe.y + dy, r });
  return out;
}
type Blocked = (x: number, y: number, reach: number) => boolean;
/** Set-piece builder: local (a outward from the clearing's centre, b along the ring). */
interface Piece {
  family: Parameters<typeof propRecipe>[1];
  tag: string;
  a: number;
  b: number;
  /** Extra turn on top of the frame's outward heading. */
  turn?: number;
  durability?: number;
}
const FRAME_TURNS = [
  0,
  ...Array.from({ length: 10 }, (_, k) => [0.3 * (k + 1), -0.3 * (k + 1)]).flat(),
];
/** Lane props slide along their lane (and a little across it) instead of turning out of it. */
const LANE_SLIDES = [0, 18, 36, -18, 54, 72, -36, 90];
/** Candidate frames in a fixed order: each turn (or slide), then pushed further out. */
const FRAMES = [0, 14, 28, 42].flatMap((push) =>
  FRAME_TURNS.map((turn) => ({ turn, shift: 0, push })),
);
const SLIDES = [0, 12, -12].flatMap((push) =>
  LANE_SLIDES.map((shift) => ({ turn: 0, shift, push })),
);
/**
 * Place a set piece as a unit: the whole frame turns around its mechanic (or slides along its
 * lane) in fixed steps, never randomly, until no piece lands on terrain, other content, another
 * mechanic or a gameplay spot. The frame's own mechanic does not count: pieces gather round it.
 */
function placeFrame(
  anchor: { x: number; y: number; key: string },
  heading: number,
  pieces: Piece[],
  taken: Circle[],
  blocked: Blocked,
  slide = false,
  push = true,
): {
  heading: number;
  spots: { x: number; y: number; angle: number; reach: number; clash: boolean }[];
} {
  let best: ReturnType<typeof placeFrame> | null = null,
    fewest = Infinity;
  const frames = slide ? SLIDES : push ? FRAMES : FRAMES.filter((f) => f.push === 0);
  for (const { turn, shift, push } of frames) {
    const h = heading + turn,
      ux = Math.cos(h),
      uy = Math.sin(h);
    let clashes = 0;
    const spots = pieces.map((p) => {
      const a = p.a + push * Math.sign(p.a || 1),
        x = round(anchor.x + ux * a - uy * (p.b + shift)),
        y = round(anchor.y + uy * a + ux * (p.b + shift)),
        reach = shapeReach(FAMILIES[p.family].shape);
      const clash =
        blocked(x, y, reach) ||
        taken.some(
          (c) => c.anchor !== anchor.key && Math.hypot(c.x - x, c.y - y) < c.r + reach + 2,
        );
      if (clash) clashes++;
      return { x, y, angle: round(h + (p.turn ?? 0)), reach, clash };
    });
    if (clashes < fewest) {
      fewest = clashes;
      best = { heading: h, spots };
    }
    if (clashes === 0) break;
  }
  for (const s of best!.spots) if (!s.clash) taken.push({ x: s.x, y: s.y, r: s.reach });
  // A loose piece still clashing looks for room on its own around the same mechanic (a pot or
  // a stone need not keep formation; hedges, fuses and pens do).
  for (const [k, spot] of best!.spots.entries()) {
    if (!spot.clash || !LOOSE.has(pieces[k].family)) continue;
    const base = Math.atan2(spot.y - anchor.y, spot.x - anchor.x),
      radius = Math.hypot(spot.x - anchor.x, spot.y - anchor.y);
    search: for (const grow of [0, 12, 24, 36])
      for (let turn = 0; turn <= 12; turn++) {
        const a = base + ((turn + 1) >> 1) * 0.26 * (turn % 2 ? 1 : -1),
          x = round(anchor.x + Math.cos(a) * (radius + grow)),
          y = round(anchor.y + Math.sin(a) * (radius + grow));
        if (
          blocked(x, y, spot.reach) ||
          taken.some(
            (c) => c.anchor !== anchor.key && Math.hypot(c.x - x, c.y - y) < c.r + spot.reach + 2,
          ) ||
          best!.spots.some(
            (o, j) =>
              j !== k && !o.clash && Math.hypot(o.x - x, o.y - y) < o.reach + spot.reach + 2,
          )
        )
          continue;
        Object.assign(spot, { x, y, clash: false });
        taken.push({ x, y, r: spot.reach });
        break search;
      }
  }
  return best!;
}
const LOOSE = new Set(["pot", "stone", "barrel", "wheel", "crate", "log"]);
/** The authored pieces around one mechanic of each kind (local frame of `placeFrame`). */
function piecesFor(kind: MechanicId, n: number): Piece[] {
  switch (kind) {
    case "bramble":
      return [
        { family: "hedge", tag: "0", a: 34, b: -18, turn: Math.PI / 2 - 0.5 },
        { family: "hedge", tag: "1", a: 38, b: 0, turn: Math.PI / 2 },
        { family: "hedge", tag: "2", a: 34, b: 18, turn: Math.PI / 2 + 0.5 },
        { family: "pot", tag: "cache", a: 58, b: 0 },
      ];
    case "wind":
      // Along the lane (b): it starts beside the lane mechanic and runs around the ring.
      return [
        { family: "barrel", tag: "0", a: 0, b: 62 },
        { family: "wheel", tag: "0", a: 12, b: 104 },
      ];
    case "glass":
      return [
        { family: "rod", tag: "0", a: -16, b: -28 },
        { family: "rod", tag: "1", a: -16, b: 28 },
        { family: "pylon", tag: "0", a: -98, b: 0 },
      ];
    case "echo":
      return [
        { family: "pot", tag: "0", a: 24, b: -20 },
        { family: "pot", tag: "1", a: 24, b: 20 },
        { family: "stone", tag: "0", a: -26, b: -24 },
        { family: "stone", tag: "1", a: -26, b: 24 },
      ];
    case "cinder":
      return [
        { family: "brush", tag: "0", a: 26, b: 0 },
        { family: "brush", tag: "1", a: 42, b: 0 },
        { family: "brush", tag: "2", a: 58, b: 0 },
        { family: "barricade", tag: "front", a: 70, b: 0, turn: Math.PI / 2, durability: 45 },
        { family: "barricade", tag: "left", a: 86, b: -16, durability: 45 },
        { family: "barricade", tag: "right", a: 86, b: 16, durability: 45 },
        { family: "barricade", tag: "back", a: 102, b: 0, turn: Math.PI / 2, durability: 45 },
        { family: n === 0 ? "chest" : "pot", tag: "cache", a: 86, b: 0 },
      ];
    case "gravity":
      return [
        { family: "stone", tag: "0", a: 36, b: -24 },
        { family: "stone", tag: "1", a: 36, b: 24 },
        { family: "log", tag: "0", a: 66, b: 0, turn: Math.PI / 2 },
        { family: "barrel", tag: "0", a: 6, b: 46 },
      ];
    case "rift":
      return n === 0
        ? [
            { family: "crate", tag: "0", a: -30, b: -21 },
            { family: "crate", tag: "1", a: -30, b: 21 },
            { family: "barrel", tag: "0", a: -54, b: 0 },
          ]
        : [];
    default:
      return [];
  }
}
/** Wind lanes run around the ring, starting just behind their mechanic. */
export const TAILWIND = { length: 220, width: 64, strength: 190, gust: 0.5, back: 10 } as const;
/** Clearance beside a lane's edge to any hazard it must not feed. */
export const LANE_BERTH = 16;
/**
 * Yard props a lane must never deliver loose props into: the brazier ignites what touches it,
 * and oil, water, brush and powder sit around it. (Coils, rods and fans only react to strikes,
 * and lane-driven props stay below the impact speed.)
 */
const HAZARDS = new Set(["brazier", "jar", "cask", "brush", "barrel"]);
/**
 * A tailwind lane's heading and length: around the ring one way or the other, as long as
 * possible, such that the lane and the run-out beyond its end stay clear of the reaction
 * yard's hazards (props it carries never start an unowned fire).
 */
export function tailwindLane(
  recipe: Pick<AreaRecipe, "index" | "x" | "y">,
  at: { x: number; y: number },
  palette = 0,
  base?: readonly BodyRecipe[],
): { x: number; y: number; angle: number; length: number } {
  // The yard's sources and containers, and the clearing's powder barrel and lantern (M11
  // generated areas: their base scenery; modules placed later keep out of the lanes).
  const hazards = base
    ? base.filter(
        (p) =>
          HAZARDS.has(p.blueprint!.family) ||
          p.material === "volatile" ||
          p.blueprint!.family === "lantern",
      )
    : [
        ...areaReactions(recipe, palette).props.filter((p) => HAZARDS.has(p.blueprint!.family)),
        ...clearingProps(recipe, palette).filter(
          (p) => p.material === "volatile" || p.blueprint!.family === "lantern",
        ),
      ];
  const outward = Math.atan2(at.y - recipe.y, at.x - recipe.x);
  let fallback: { x: number; y: number; angle: number; length: number } | null = null;
  for (const length of [TAILWIND.length, 170, 130])
    for (const side of [1, -1]) {
      const angle = outward + (side * Math.PI) / 2,
        ux = Math.cos(angle),
        uy = Math.sin(angle),
        x = at.x - ux * TAILWIND.back,
        y = at.y - uy * TAILWIND.back,
        lane = { x: round(x), y: round(y), angle: round(angle), length };
      fallback ??= lane;
      const clear = hazards.every((h) => {
        const along = (h.x - x) * ux + (h.y - y) * uy,
          across = Math.abs(-(h.x - x) * uy + (h.y - y) * ux);
        return along < -20 || along > length + 70 || across > TAILWIND.width / 2 + LANE_BERTH;
      });
      if (clear) return lane;
    }
  return fallback!;
}
/** Stormglass pools sit inward of each pylon, overlapping its discharge. */
export const POOL = { inward: 50, radius: 40 } as const;
/**
 * One area's M10 set pieces for every mechanic it has (three of each, around the mechanics).
 * Later areas combine kinds, so their set pieces combine through the same shared rules.
 */
export function areaShowcase(
  recipe: AreaRecipe,
  palette: number,
  blocked: Blocked = () => false,
  base?: readonly BodyRecipe[],
): ShowcaseContent {
  const i = recipe.index,
    areaId = `area-${i}`,
    taken = occupied(recipe, palette, blocked, base);
  const bodies: BodyRecipe[] = [],
    mechanisms: MechanismBlueprint[] = [],
    fields: FieldRecipe[] = [],
    surfaces: ReactionSurface[] = [];
  const spots = mechanicLayout(recipe);
  // Every other mechanic's spot stays clear for activation.
  for (const m of spots)
    taken.push({ x: m.x, y: m.y, r: m.radius + 6, anchor: `${m.kind}-${m.n}` });
  for (const m of spots) {
    const outward = Math.atan2(m.y - recipe.y, m.x - recipe.x),
      pieces = piecesFor(m.kind, m.n),
      prefix = `${m.kind}-${m.n}`;
    const lane = m.kind === "wind" ? tailwindLane(recipe, m, palette, base) : null;
    if (lane)
      fields.push({
        id: `tailwind-${i}-${m.n}`,
        kind: "wind",
        areaId,
        shape: { kind: "lane", ...lane, width: TAILWIND.width },
        strength: TAILWIND.strength,
        ticks: -1,
        gust: TAILWIND.gust,
        actors: true,
        owner: "",
        team: "world",
        source: "authored",
      });
    if (m.kind === "glass")
      surfaces.push({
        id: `pool-${i}-${m.n}`,
        kind: "water",
        areaId,
        x: round(m.x - Math.cos(outward) * POOL.inward),
        y: round(m.y - Math.sin(outward) * POOL.inward),
        radius: POOL.radius,
        ticks: -1,
        burning: 0,
        chain: "",
        depth: 0,
        owner: "",
        team: "world",
      });
    if (!pieces.length) continue;
    // A wind lane's props sit in the lane and slide along it to find room. Its frame's
    // "outward" axis is the lane turned back a quarter, so local b runs down the lane.
    const frame = placeFrame(
      { x: m.x, y: m.y, key: prefix },
      lane ? lane.angle - Math.PI / 2 : outward,
      pieces,
      taken,
      blocked,
      m.kind === "wind",
      // Freight must stay on its arch's pad.
      m.kind !== "rift",
    );
    pieces.forEach((p, k) => {
      const s = frame.spots[k];
      // Crowded clearings (procedural areas) may leave out a piece; nothing spawns overlapped.
      if (s.clash) return;
      const recipe = propRecipe(
        `prop-${p.family}-${i}-${prefix}-${p.tag}`,
        p.family,
        palette,
        s.x,
        s.y,
        areaId,
        { angle: s.angle },
      );
      if (p.durability !== undefined && recipe.consequences)
        recipe.consequences.durability = p.durability;
      bodies.push(recipe);
    });
    if (lane) {
      // A raised vane over the lane's far end: the wind spins it like the clearing's vane.
      const reach = Math.min(160, lane.length - 30),
        x = round(m.x + Math.cos(lane.angle) * reach + Math.cos(outward) * 18),
        y = round(m.y + Math.sin(lane.angle) * reach + Math.sin(outward) * 18),
        id = `vane-${i}-${prefix}`,
        mast = `prop-vane-${i}-${prefix}-mast`,
        rotor = `prop-vane-${i}-${prefix}-rotor`;
      if (!blocked(x, y, 4) && !taken.some((c) => Math.hypot(c.x - x, c.y - y) < c.r + 6)) {
        taken.push({ x, y, r: 4 });
        const vane = mechanism(
          "vane",
          id,
          areaId,
          [
            propRecipe(mast, "post", palette, x, y, areaId),
            propRecipe(rotor, "vane", palette, x, y, areaId),
          ],
          [
            {
              id: `${id}:pivot`,
              kind: "hinge",
              a: mast,
              b: rotor,
              anchorA: { x: 0, y: 0 },
              anchorB: { x: 0, y: 0 },
              motor: { mode: "velocity", target: 0.6, stiffness: 0, damping: 0.6 },
              breakLoad: 0,
              toughness: 0,
            },
          ],
        );
        mechanisms.push(vane);
        bodies.push(...vane.bodies);
      }
    }
  }
  return { bodies, mechanisms, fields, surfaces };
}
/** Reproducible registry export for agents and documentation. */
export function showcaseExport() {
  return {
    version: 1,
    mechanics: structuredClone(SHOWCASE),
    town: {
      profile: "Sanctuary",
      services: structuredClone(TOWN_SERVICES),
      market: { ...TOWN_MARKET, values: { propBlocking: true } },
      protection:
        "Services are reached by distance and follow their townsfolk; Sanctuary props never block travelers outside the market; keep-clear rings push loose props off each service point; town fixtures never break.",
    },
    clearing: CLEARING_LAYOUT.length,
    tailwind: TAILWIND,
    pool: POOL,
  };
}

// ---- Runtime state ------------------------------------------------------------------------

/**
 * An elastic restraint (M10 living vine): it pulls its body back toward an anchor point (or an
 * anchor body it follows) once stretched past its rest length. Fern rules, applied as velocity
 * changes before each solve like M08 fields: a restrained monster is dragged and held, and the
 * vine snaps when its strain exceeds its break load (joint breakage) or withers when it ends.
 */
export interface Restraint {
  id: string;
  /** M11 adds "mount": a warden's armor piece (a prop) tethered to the warden. */
  kind: "bloom" | "lash" | "mount";
  /** The restrained body: `enemy-<id>` or `player-<id>` (a mount: `prop-armor-<enemy>-<k>`). */
  body: string;
  /** Anchor point; an anchor body (a warden's lash) moves it each tick. */
  x: number;
  y: number;
  anchor: string;
  rest: number;
  /** Pull per unit of stretch (1/s²). */
  stiffness: number;
  /** Strain (mass × units/s) that snaps the vine, before joint strength. */
  breakLoad: number;
  until: number;
  born: number;
  owner: string;
  team: "party" | "enemy" | "world";
  /** Latest strain, for inspection and drawing. */
  load: number;
}
export interface ShowcaseEvent {
  tick: number;
  /** `snare:grown`, `snare:snapped`, `snare:withered`, `lash:caught`, `freight:carried`… */
  text: string;
  owner: string;
  x: number;
  y: number;
  amount: number;
}
export interface ShowcaseState {
  restraints: Restraint[];
  /** Ids of transient bodies made by showcase rules (thorn splinters). */
  sequence: number;
  events: ShowcaseEvent[];
}
export const RESTRAINT_LIMIT = 64;
export const BLOOM_SNARE = {
  radius: 170,
  targets: 6,
  ticks: 360,
  stiffness: 9,
  /** Rest length: this share of the distance at sprouting, never shorter than `minimum`. */
  share: 0.35,
  minimum: 20,
  breakLoad: 1800,
} as const;
/** Thornburst (bramble pods and Brambleheart): the shove and the splinter ring. */
export const THORNBURST = {
  radius: 115,
  pressure: 2600,
  pressureTicks: 5,
  splinters: 8,
  speed: 320,
  mass: 0.6,
  lifetime: 420,
} as const;
/** Drifting knot: the pull that rolls away along the blow. */
export const KNOT = { radius: 150, strength: 520, ticks: 210, drift: 36 } as const;
/** Tailwind gust from crossing a lane. */
export const GUST = { strength: 520, ticks: 120 } as const;
/** Vent eruption: the fire's reach around the vent. */
export const VENT_RADIUS = 24;
/** Conductor-yard arcs: strength of the shock a strike on a wet monster sets off. */
export const ARC_STRENGTH = 0.7;
/** The Bloom Tyrant's lash on a traveler: a short, stiff vine a dash tears. */
export const LASH = { rest: 40, stiffness: 14, breakLoad: 900, ticks: 150 } as const;
export class ShowcasePhysics {
  private restraints = new Map<string, Restraint>();
  private events: ShowcaseEvent[] = [];
  sequence = 0;
  save(): ShowcaseState {
    return {
      restraints: this.list(),
      sequence: this.sequence,
      events: this.events.map((e) => ({ ...e })),
    };
  }
  restore(state: ShowcaseState | undefined): void {
    this.clear();
    if (!state) return;
    for (const r of state.restraints) this.restraints.set(r.id, { ...r });
    this.sequence = state.sequence;
    this.events = state.events.map((e) => ({ ...e }));
  }
  clear(): void {
    this.restraints.clear();
    this.events = [];
    this.sequence = 0;
  }
  /** Leaving a land: vines hold monsters and travelers, so none travel with it. */
  archive(): ShowcaseState {
    return { restraints: [], sequence: this.sequence, events: [] };
  }
  list(): Restraint[] {
    return [...this.restraints.values()]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((r) => ({ ...r }));
  }
  /** Read-only view for drawing (no copies; never mutate). */
  view(): Iterable<Restraint> {
    return this.restraints.values();
  }
  /** A body left the world (a death, a departure): its vines go with it. */
  release(body: string): void {
    for (const [id, r] of this.restraints)
      if (r.body === body || r.anchor === body) this.restraints.delete(id);
  }
  /** Saves never reference a missing body (a monster killed since the last solve). */
  prune(has: (id: string) => boolean): void {
    for (const [id, r] of this.restraints)
      if (!has(r.body) || (r.anchor && !has(r.anchor))) this.restraints.delete(id);
  }
  holding(body: string): Restraint[] {
    return this.list().filter((r) => r.body === body);
  }
  add(r: Omit<Restraint, "id" | "load">): Restraint | null {
    if (this.restraints.size >= RESTRAINT_LIMIT) return null;
    const restraint = { ...r, id: `snare-${this.sequence++}`, load: 0 };
    this.restraints.set(restraint.id, restraint);
    return { ...restraint };
  }
  remove(id: string, text: string, tick: number, at: { x: number; y: number }): void {
    const r = this.restraints.get(id);
    if (!r) return;
    this.restraints.delete(id);
    this.emit({ tick, text, owner: r.owner, x: at.x, y: at.y, amount: 0 });
  }
  emit(event: ShowcaseEvent): void {
    this.events.push(event);
    if (this.events.length > 64) this.events = this.events.slice(-64);
  }
  take(): ShowcaseEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }
  /**
   * Before each solve: anchors follow their bodies, slack or stretched vines pull, and vines
   * snap or wither. `world` is the policy/body interface of the land.
   */
  update(
    tick: number,
    world: {
      has(id: string): boolean;
      motionOf(id: string): { x: number; y: number; vx: number; vy: number; mass: number };
      policy(id: string): { mechanisms: boolean; jointBreakage: boolean; jointStrength: number };
      pull(id: string, dvx: number, dvy: number): void;
    },
  ): void {
    for (const r of [...this.restraints.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (!world.has(r.body) || (r.anchor && !world.has(r.anchor))) {
        this.restraints.delete(r.id);
        continue;
      }
      if (r.anchor) {
        const a = world.motionOf(r.anchor);
        r.x = round(a.x);
        r.y = round(a.y);
      }
      const m = world.motionOf(r.body);
      const label = r.kind === "bloom" ? "snare" : r.kind;
      if (tick >= r.until) {
        this.remove(r.id, `${label}:withered`, tick, m);
        continue;
      }
      const policy = world.policy(r.body);
      r.load = 0;
      // Mechanisms off: the vine goes slack (it neither pulls nor strains) but still withers.
      if (!policy.mechanisms) continue;
      const dx = r.x - m.x,
        dy = r.y - m.y,
        d = Math.hypot(dx, dy),
        stretch = d - r.rest;
      if (stretch <= 0 || d < 0.001) continue;
      const nx = dx / d,
        ny = dy / d,
        away = Math.max(0, -(m.vx * nx + m.vy * ny)),
        dv = Math.min(240, (stretch * r.stiffness) / 60 + away * 0.25);
      r.load = round(m.mass * (away + stretch * 4));
      if (policy.jointBreakage && r.load > r.breakLoad * policy.jointStrength) {
        this.remove(r.id, `${label}:snapped`, tick, m);
        continue;
      }
      world.pull(r.body, nx * dv, ny * dv);
    }
  }
}
export function validateShowcase(state: ShowcaseState, has: (id: string) => boolean): void {
  const fail = (what: string) => {
    throw new Error(`Invalid showcase ${what}`);
  };
  const finite = (v: unknown, bound = 1e7) =>
    typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= bound;
  const int = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
  const keys = (o: object, allowed: string[]) => Object.keys(o).every((k) => allowed.includes(k));
  if (
    !state ||
    typeof state !== "object" ||
    !keys(state, ["restraints", "sequence", "events"]) ||
    !Array.isArray(state.restraints) ||
    state.restraints.length > RESTRAINT_LIMIT ||
    !int(state.sequence) ||
    !Array.isArray(state.events) ||
    state.events.length > 64
  )
    fail("state");
  const ids = new Set<string>();
  for (const r of state.restraints) {
    if (
      !r ||
      typeof r !== "object" ||
      !keys(r, [
        "id",
        "kind",
        "body",
        "x",
        "y",
        "anchor",
        "rest",
        "stiffness",
        "breakLoad",
        "until",
        "born",
        "owner",
        "team",
        "load",
      ]) ||
      typeof r.id !== "string" ||
      !/^snare-\d+$/.test(r.id) ||
      ids.has(r.id) ||
      !["bloom", "lash", "mount"].includes(r.kind) ||
      typeof r.body !== "string" ||
      !(r.kind === "mount"
        ? /^prop-armor-\d+-\d+$/.test(r.body)
        : /^(enemy|player)-[\w-]{1,80}$/.test(r.body)) ||
      (r.kind === "mount" && !/^enemy-\d+$/.test(r.anchor)) ||
      typeof r.anchor !== "string" ||
      (r.anchor !== "" && !/^enemy-\d+$/.test(r.anchor)) ||
      ![r.x, r.y].every((v) => finite(v, 1e6)) ||
      !finite(r.rest, 2000) ||
      r.rest < 0 ||
      !finite(r.stiffness, 1000) ||
      r.stiffness < 0 ||
      !finite(r.breakLoad, 1e7) ||
      r.breakLoad < 0 ||
      !int(r.until) ||
      !int(r.born) ||
      typeof r.owner !== "string" ||
      r.owner.length > 80 ||
      !["party", "enemy", "world"].includes(r.team) ||
      !finite(r.load) ||
      !has(r.body) ||
      (r.anchor !== "" && !has(r.anchor))
    )
      fail("restraint");
    ids.add(r.id);
  }
  for (const e of state.events)
    if (
      !e ||
      typeof e !== "object" ||
      !keys(e, ["tick", "text", "owner", "x", "y", "amount"]) ||
      !int(e.tick) ||
      typeof e.text !== "string" ||
      !/^[\w:.-]{1,120}$/.test(e.text) ||
      typeof e.owner !== "string" ||
      e.owner.length > 80 ||
      ![e.x, e.y, e.amount].every((v) => finite(v, 1e6))
    )
      fail("event");
}
