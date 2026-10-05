import { hash } from "../engine/math.ts";
import type { MaterialId } from "../physics/materials.ts";
import { ARCHETYPES, RIGS, type RigKind } from "./content.ts";
import type { Enemy } from "./types.ts";

/**
 * M09 physical rigs. Every monster rig is a tree of parts: each part has a socket (its pivot on
 * its parent), a mass share, hinge limits, a material and its own pixel art. Collider boxes are
 * measured from that art, so a ragdoll limb is exactly the shape that is drawn. Locomotion and
 * attack poses stay authored; hits drive a lean spring that the parts follow with weight and lag.
 *
 * Sprite space: x right, y up negative, origin at the feet. Pure and engine-safe (no DOM).
 */
export type Locomotion = "grounded" | "floating" | "rooted";
/** How a body falls when it dies or is knocked down. */
export type DeathStyle = "topple" | "flip" | "collapse" | "fell";
export type AnimChannel = "legA" | "legB" | "armA" | "armB" | "tail" | "antenna" | "head" | "none";
/** Palette index (0–4) or a literal colour. */
type Color = number | string;
export type ArtOp =
  | ["r", number, number, number, number, Color]
  | ["l", number, number, number, number, number, Color]
  | ["b", number, number, number, number, Color];
export interface RigPart {
  id: string;
  parent: string | null;
  /** Joint pivot in the rest pose (sprite units). */
  pivot: readonly [number, number];
  /** Share of the rig's mass. */
  mass: number;
  /** Hinge limits relative to the parent (rad): living secondary motion and the ragdoll joint. */
  limits: readonly [number, number];
  /** Secondary motion: bend per rad of body lean and per rad/s of lean rate (weight and lag). */
  follow: number;
  lag: number;
  material: MaterialId;
  /** Armor or bark: "hit" can be knocked off by a heavy blow; "death" comes loose only on death. */
  detach?: "hit" | "death";
  channel: AnimChannel;
  /** Authored swing (rad) and phase offset of its channel; `lift` raises it in a windup. */
  swing: number;
  phase: number;
  lift: number;
  layer: number;
  /** Emissive (wraith core, totem slit): lights its surroundings while the rig lives. */
  glow?: true;
}
export interface RigBlueprint {
  kind: RigKind;
  name: string;
  locomotion: Locomotion;
  death: DeathStyle;
  /** Lean spring stiffness (1/s²) and damping (1/s). */
  stiffness: number;
  damping: number;
  /** Lean rate (rad/s) per 100 units/s of knock; the largest lean (rad). */
  recoil: number;
  maxLean: number;
  /** Running lean: rad per 100 units/s of sideways speed. */
  stride: number;
  /** Poise thresholds (% of max health, scaled by reaction strength); topple 0 = never. */
  stagger: number;
  topple: number;
  staggerTicks: number;
  toppleTicks: number;
  /** Translational knockback multiplier of the living actor (rooted rigs barely move). */
  knockback: number;
  /** Floating rigs hover this high above their shadow (sprite units). */
  hover: number;
  /** Ragdoll mass of an ordinary monster (elites ×1.5, bosses ×6). */
  mass: number;
  /** Ticks a dying body takes to reach the ground. */
  fallTicks: number;
  /** The part a rooted rig leans (its roots stay planted). */
  leanPart?: string;
  parts: readonly RigPart[];
}
export interface RigReaction {
  /** Screen-space lean (rad, + tips the top toward +x) and its rate. */
  lean: number;
  leanRate: number;
  /** Vertical squash (fraction) and its rate. */
  pitch: number;
  pitchRate: number;
  /** Accumulated blows; decays every tick. */
  poise: number;
  staggerUntil: number;
  toppleAt: number;
  toppleUntil: number;
  /** Knockdown direction (−1 or 1). */
  side: number;
  /** Latest blow (direction × speed, units/s): the direction a dying body falls. */
  knockX: number;
  knockY: number;
  /** Detachable parts already knocked off (bit = detachable index). */
  shed: number;
}
export const freshReaction = (): RigReaction => ({
  lean: 0,
  leanRate: 0,
  pitch: 0,
  pitchRate: 0,
  poise: 0,
  staggerUntil: 0,
  toppleAt: 0,
  toppleUntil: 0,
  side: 1,
  knockX: 0,
  knockY: 0,
  shed: 0,
});

const part = (
  id: string,
  parent: string | null,
  pivot: [number, number],
  mass: number,
  limits: [number, number],
  material: MaterialId,
  extra: Partial<RigPart> = {},
): RigPart => ({
  id,
  parent,
  pivot,
  mass,
  limits,
  follow: 0,
  lag: 0,
  material,
  channel: "none",
  swing: 0,
  phase: 0,
  lift: 0,
  layer: 1,
  ...extra,
});
const ARM = { follow: -0.55, lag: -0.07, layer: 2 };
const LEG = { follow: -0.45, lag: -0.02, layer: 0 };
const HEAD = { follow: 0.35, lag: 0.03, channel: "head" as const, swing: 0.04, layer: 3 };

function heavy(kind: "brute" | "warden"): RigBlueprint {
  const warden = kind === "warden",
    flesh: MaterialId = warden ? "vegetation" : "wood",
    armor: MaterialId = warden ? "metal" : "wood";
  return {
    kind,
    name: warden ? "Armored warden" : "Bark brute",
    locomotion: "grounded",
    death: "topple",
    stiffness: 70,
    damping: 9,
    recoil: 0.9,
    maxLean: 0.42,
    stride: 0.05,
    stagger: warden ? 38 : 30,
    topple: warden ? 110 : 85,
    staggerTicks: 16,
    toppleTicks: 70,
    knockback: 0.8,
    hover: 0,
    mass: warden ? 2.4 : 2,
    fallTicks: 20,
    parts: [
      part("torso", null, [0, -12], 0.38, [0, 0], flesh, { layer: 1 }),
      part("legL", "torso", [-8, -12], 0.1, [-1.1, 1.1], flesh, {
        ...LEG,
        channel: "legA",
        swing: 0.3,
      }),
      part("legR", "torso", [9, -12], 0.1, [-1.1, 1.1], flesh, {
        ...LEG,
        channel: "legB",
        swing: 0.3,
      }),
      ...[0, 1, 2, 3].map((i) =>
        part(`plate${i}`, "torso", [-9.5 + i * 7, -35], 0.02, [-0.06, 0.06], armor, {
          detach: "hit" as const,
          follow: 0.05,
          layer: 2,
        }),
      ),
      ...(warden
        ? [
            part("emblem", "torso", [0.5, -31], 0.03, [-0.06, 0.06], "metal", {
              detach: "hit" as const,
              layer: 2,
            }),
          ]
        : []),
      part("armL", "torso", [-18, -30], 0.12, [-2, 2], flesh, {
        ...ARM,
        channel: "armA",
        swing: 0.22,
        lift: -0.75,
        layer: 3,
      }),
      part("armR", "torso", [19, -30], 0.12, [-2, 2], flesh, {
        ...ARM,
        channel: "armB",
        swing: 0.22,
        lift: 0.75,
        layer: 3,
      }),
      part("head", "torso", [1, -38], 0.12, [-0.55, 0.55], flesh, { ...HEAD, layer: 4 }),
    ],
  };
}
export const RIG_BLUEPRINTS: Record<RigKind, RigBlueprint> = {
  stalker: {
    kind: "stalker",
    name: "Thorn stalker",
    locomotion: "grounded",
    death: "topple",
    stiffness: 55,
    damping: 6.5,
    recoil: 1.8,
    maxLean: 0.62,
    stride: 0.12,
    stagger: 22,
    topple: 62,
    staggerTicks: 18,
    toppleTicks: 62,
    knockback: 1,
    hover: 0,
    mass: 1,
    fallTicks: 16,
    parts: [
      part("torso", null, [0, -8], 0.4, [0, 0], "vegetation"),
      part("legL", "torso", [-6, -7], 0.1, [-1.2, 1.2], "vegetation", {
        ...LEG,
        channel: "legA",
        swing: 0.42,
      }),
      part("legR", "torso", [7, -8], 0.1, [-1.2, 1.2], "vegetation", {
        ...LEG,
        channel: "legB",
        swing: 0.42,
      }),
      part("armL", "torso", [-9, -19], 0.1, [-2.1, 2.1], "vegetation", {
        ...ARM,
        channel: "armA",
        swing: 0.35,
        lift: -1.05,
      }),
      part("armR", "torso", [9, -20], 0.1, [-2.1, 2.1], "vegetation", {
        ...ARM,
        channel: "armB",
        swing: 0.35,
        lift: 1.05,
      }),
      part("head", "torso", [1, -23], 0.15, [-0.65, 0.65], "vegetation", HEAD),
    ],
  },
  crawler: {
    kind: "crawler",
    name: "Spore crawler",
    locomotion: "grounded",
    death: "flip",
    stiffness: 80,
    damping: 8,
    recoil: 1.3,
    maxLean: 0.38,
    stride: 0.04,
    stagger: 18,
    topple: 52,
    staggerTicks: 16,
    toppleTicks: 66,
    knockback: 1.1,
    hover: 0,
    mass: 0.9,
    fallTicks: 14,
    parts: [
      part("body", null, [0, -13], 0.5, [0, 0], "vegetation"),
      ...[-1, 1].flatMap((side) =>
        [0, 1, 2].map((leg) =>
          part(
            `leg${side < 0 ? "L" : "R"}${leg}`,
            "body",
            [side * 7, -5 - leg * 5],
            0.05,
            [-0.9, 0.9],
            "vegetation",
            {
              follow: -0.5,
              lag: -0.05,
              channel: "legA",
              swing: 0.32,
              phase: leg * 2 + (side < 0 ? 0 : Math.PI),
              layer: 0,
            },
          ),
        ),
      ),
      part("head", "body", [2, -10], 0.1, [-0.5, 0.5], "vegetation", {
        ...HEAD,
        lift: -0.35,
        layer: 2,
      }),
      part("antennaL", "body", [-6, -20], 0.03, [-0.9, 0.9], "vegetation", {
        follow: -0.8,
        lag: -0.12,
        channel: "antenna",
        swing: 0.18,
        lift: 0.55,
        layer: 3,
      }),
      part("antennaR", "body", [6, -20], 0.03, [-0.9, 0.9], "vegetation", {
        follow: -0.8,
        lag: -0.12,
        channel: "antenna",
        swing: 0.18,
        phase: 1.7,
        lift: -0.55,
        layer: 3,
      }),
    ],
  },
  brute: heavy("brute"),
  wraith: {
    kind: "wraith",
    name: "Lantern wraith",
    locomotion: "floating",
    death: "collapse",
    stiffness: 22,
    damping: 3.2,
    recoil: 2.2,
    maxLean: 0.75,
    stride: 0.16,
    stagger: 20,
    topple: 55,
    staggerTicks: 20,
    toppleTicks: 54,
    knockback: 1.2,
    hover: 5,
    mass: 0.6,
    fallTicks: 30,
    parts: [
      part("shroud", null, [0, -24], 0.4, [0, 0], "cloth"),
      ...[0, 1, 2, 3, 4].map((i) =>
        part(`tail${i}`, "shroud", [-9 + i * 5, -15], 0.05, [-1, 1], "cloth", {
          follow: -0.9,
          lag: -0.14,
          channel: "tail",
          swing: 0.3,
          phase: i,
          layer: 0,
        }),
      ),
      part("hood", "shroud", [0, -31], 0.12, [-0.5, 0.5], "cloth", { ...HEAD, layer: 2 }),
      part("core", "shroud", [0.5, -21], 0.08, [-0.3, 0.3], "glass", {
        detach: "death",
        glow: true,
        layer: 2,
      }),
      part("armL", "shroud", [-10, -22], 0.06, [-1.8, 1.8], "cloth", {
        ...ARM,
        channel: "armA",
        swing: 0.25,
        lift: 0.55,
        layer: 3,
      }),
      part("armR", "shroud", [11, -22], 0.06, [-1.8, 1.8], "cloth", {
        ...ARM,
        channel: "armB",
        swing: 0.25,
        lift: -0.55,
        layer: 3,
      }),
    ],
  },
  totem: {
    kind: "totem",
    name: "Root totem",
    locomotion: "rooted",
    death: "fell",
    stiffness: 120,
    damping: 5,
    recoil: 1.1,
    maxLean: 0.5,
    stride: 0,
    stagger: 34,
    topple: 0,
    staggerTicks: 22,
    toppleTicks: 0,
    knockback: 0.25,
    hover: 0,
    mass: 2.2,
    fallTicks: 26,
    leanPart: "trunk",
    parts: [
      part("roots", null, [0, -6], 0.25, [0, 0], "wood", { layer: 0 }),
      part("trunk", "roots", [0, -2], 0.45, [-2.2, 2.2], "wood", { layer: 1, glow: true }),
      part("armL", "trunk", [-7, -24], 0.08, [-1.6, 1.6], "wood", {
        ...ARM,
        channel: "armA",
        swing: 0.12,
        lift: 0.6,
      }),
      part("armR", "trunk", [8, -24], 0.08, [-1.6, 1.6], "wood", {
        ...ARM,
        channel: "armB",
        swing: 0.12,
        lift: -0.6,
      }),
      ...[0, 1, 2].map((i) =>
        part(`crown${i}`, "trunk", [-6.5 + i * 8, -41], 0.04, [-0.1, 0.1], "wood", {
          detach: "hit" as const,
          follow: -0.15,
          layer: 2,
        }),
      ),
    ],
  },
  warden: heavy("warden"),
};
export const rigOf = (kind: RigKind) => RIG_BLUEPRINTS[kind];
/** Drawn (and ragdoll) scale of a monster: sprite units to world units. */
export function rigScale(e: { boss: boolean; elite: boolean; rig: RigKind }): number {
  return e.boss ? 1.65 : e.elite ? 0.9 : e.rig === "brute" || e.rig === "warden" ? 0.6 : 0.74;
}
/** Detachable parts of a rig in a stable order: bit i of `RigReaction.shed`. */
export function detachables(kind: RigKind): RigPart[] {
  return RIG_BLUEPRINTS[kind].parts.filter((p) => p.detach !== undefined);
}

/** Rest-pose art of every part, in sprite space. `variant` is the seed % 4 crest/horn length. */
export function rigArt(kind: RigKind, variant: number, seed: number): Record<string, ArtOp[]> {
  const v = variant;
  if (kind === "stalker")
    return {
      legL: [
        ["l", -6, -7, -9, 2, 4, 0],
        ["r", -13, 1, 7, 3, 2],
      ],
      legR: [
        ["l", 7, -8, 10, 2, 4, 0],
        ["r", 8, 1, 7, 3, 2],
      ],
      torso: [
        ["b", 0, -15, 11, 13, 0],
        ["b", -2, -17, 8, 10, 1],
        ["r", -5, -21, 8, 5, 2],
      ],
      armL: [
        ["l", -9, -19, -15, -6, 4, 1],
        ["r", -18, -7, 1, 5, 4],
        ["r", -16, -7, 1, 5, 4],
        ["r", -14, -7, 1, 5, 4],
      ],
      armR: [
        ["l", 9, -20, 16, -5, 4, 1],
        ["r", 14, -7, 1, 5, 4],
        ["r", 16, -7, 1, 5, 4],
        ["r", 18, -7, 1, 5, 4],
      ],
      head: [
        ["b", 1, -30, 8, 8, 1],
        ["r", -5, -34, 13, 6, 2],
        ["r", -4, -29, 4, 2, 3],
        ["r", 5, -29, 3, 2, 3],
        ["r", 0, -24, 8, 3, 0],
        ["r", 1, -24, 2, 4, 4],
        ["r", 5, -24, 1, 3, 4],
        ["l", -5, -35, -10, -43 - v, 3, 1],
        ["l", 5, -35, 10, -44 - v, 3, 2],
        ["r", -12, -44 - v, 4, 3, 2],
      ],
    };
  if (kind === "crawler") {
    const art: Record<string, ArtOp[]> = {
      body: [
        ["b", 0, -13, 14, 10, 0],
        ["b", -1, -15, 11, 8, 1],
        ["b", -3, -18, 7, 5, 2],
        ["r", -9, -22, 2, 15, 0],
        ["r", -3, -22, 2, 15, 0],
        ["r", 3, -22, 2, 15, 0],
      ],
      head: [
        ["b", 2, -6, 7, 5, 1],
        ["r", -2, -8, 3, 2, 3],
        ["r", 6, -8, 3, 2, 3],
        ["r", 2, -3, 4, 3, 4],
      ],
      antennaL: [
        ["l", -6, -20, -11, -30, 1, 2],
        ["r", -12, -31, 3, 2, 3],
      ],
      antennaR: [
        ["l", 6, -20, 13, -29, 1, 2],
        ["r", 12, -30, 3, 2, 3],
      ],
    };
    for (const side of [-1, 1])
      for (let leg = 0; leg < 3; leg++) {
        const y = -5 - leg * 5;
        art[`leg${side < 0 ? "L" : "R"}${leg}`] = [
          ["l", side * 7, y, side * (17 + leg), y - 3, 3, 0],
          ["l", side * (17 + leg), y - 3, side * (21 - leg), y + 7, 2, 1],
        ];
      }
    return art;
  }
  if (kind === "brute" || kind === "warden") {
    const warden = kind === "warden",
      speckles: ArtOp[] = [];
    for (let i = 0; i < 10; i++) {
      const h = hash(i, seed);
      speckles.push(["r", (h % 28) - 14, -37 + ((h >>> 8) % 22), 2, 3, (h >>> 15) % 3]);
    }
    const art: Record<string, ArtOp[]> = {
      legL: [
        ["l", -8, -12, -10, 1, 7, 0],
        ["r", -16, 0, 10, 5, 2],
      ],
      legR: [
        ["l", 9, -12, 10, 1, 7, 1],
        ["r", 8, 0, 11, 5, 2],
      ],
      torso: [
        ["b", 0, -26, warden ? 15 : 18, 19, 0],
        ["b", -2, -28, warden ? 12 : 15, 16, 1],
        ...speckles,
      ],
      armL: [
        ["b", -18, -34, 8, 8, 1],
        ["l", -18, -30, -24, -13, 8, 0],
        ["r", -30, -16, 12, 10, 1],
        ["r", -28, -17, 9, 3, 2],
        ["r", -28, -8, 2, 4, 4],
        ["r", -25, -8, 2, 4, 4],
        ["r", -22, -8, 2, 4, 4],
      ],
      armR: [
        ["b", 19, -34, 8, 8, 2],
        ["l", 19, -30, 25, -11, 8, 1],
        ["r", 20, -14, 12, 10, 2],
        ["r", 22, -7, 2, 4, 4],
        ["r", 25, -7, 2, 4, 4],
        ["r", 28, -7, 2, 4, 4],
      ],
      head: [
        ["b", 1, -47, 10, 10, 0],
        ["r", -7, -55, 15, 13, 1],
        ["r", -6, -56, 7, 7, 2],
        ["r", -5, -48, 4, 3, 3],
        ["r", 4, -48, 4, 3, 3],
        ["r", -3, -42, 10, 3, 0],
        ["r", -1, -42, 2, 4, 4],
        ["r", 4, -42, 2, 4, 4],
        ...[-1, 1].flatMap((side): ArtOp[] => [
          ["l", side * 7, -52, side * (14 + v), -65, 3, 2],
          ["l", side * 13, -61, side * 22, -64, 2, 4],
          ["r", side < 0 ? -25 : 22, -66, 3, 4, 3],
        ]),
      ],
    };
    for (let i = 0; i < 4; i++)
      art[`plate${i}`] = [
        ["r", -12 + i * 7, -35 + (i % 2) * 2, 5, 18 - (i % 2) * 4, 2],
        ["r", -12 + i * 7, -35, 5, 2, 3],
      ];
    if (warden)
      art.emblem = [
        ["r", -3, -31, 7, 11, 0],
        ["r", -1, -30, 3, 8, 3],
        ["r", -4, -27, 9, 2, 3],
      ];
    return art;
  }
  if (kind === "wraith") {
    const art: Record<string, ArtOp[]> = {
      shroud: [
        ["b", 0, -24, 12, 16, 0],
        ["b", -2, -27, 9, 13, 1],
      ],
      hood: [
        ["r", -7, -34, 15, 8, 2],
        ["r", -6, -28, 12, 5, 0],
        ["r", -4, -27, 3, 2, 3],
        ["r", 3, -27, 3, 2, 3],
      ],
      core: [
        ["r", -3, -21, 7, 9, 2],
        ["r", -1, -20, 3, 7, 3],
      ],
      armL: [
        ["l", -10, -22, -21, -25, 3, 1],
        ["r", -24, -29, 4, 4, 3],
      ],
      armR: [
        ["l", 11, -22, 23, -27, 3, 2],
        ["r", 21, -31, 4, 4, 3],
      ],
    };
    for (let i = 0; i < 5; i++) {
      const dx = -9 + i * 5;
      art[`tail${i}`] = [["l", dx, -15, dx + (i - 2), 3, 4 - (i % 2), i % 2]];
    }
    return art;
  }
  if (kind === "totem") {
    const art: Record<string, ArtOp[]> = {
      roots: [0, 1, 2, 3, 4].map(
        (i): ArtOp => ["l", 0, -8, -22 + i * 11, 4 + Math.round(Math.sin(i) * 2), 4, 0],
      ),
      trunk: [
        ["r", -9, -39, 19, 38, 0],
        ["r", -7, -41, 14, 36, 1],
        ["r", -6, -40, 4, 30, 2],
        ["r", -10, -28, 23, 4, 0],
        ["r", -9, -42, 20, 5, 2],
        ["r", -6, -37, 13, 10, 0],
        ["r", -4, -34, 3, 3, 3],
        ["r", 3, -34, 3, 3, 3],
        ["r", -2, -24, 6, 16, 3],
        ["r", -7, -20, 16, 3, 2],
        ["r", 0, -22, 2, 11, 4],
      ],
      armL: [
        ["l", -7, -24, -22, -30, 4, 1],
        ["r", -23, -35, 4, 7, 3],
      ],
      armR: [
        ["l", 8, -24, 23, -29, 4, 1],
        ["r", 21, -34, 4, 7, 3],
      ],
    };
    for (let i = 0; i < 3; i++)
      art[`crown${i}`] = [
        ["r", -8 + i * 8, -48 - (i % 2) * 6, 3, 8, 2],
        ["r", -8 + i * 8, -50 - (i % 2) * 6, 3, 3, 3],
      ];
    return art;
  }
  return {};
}
/** Axis-aligned bounds of a list of art operations (sprite units). */
export function artBounds(ops: readonly ArtOp[]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    minX = Math.min(minX, x0);
    minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x1);
    maxY = Math.max(maxY, y1);
  };
  for (const op of ops)
    if (op[0] === "r") add(op[1], op[2], op[1] + op[3], op[2] + op[4]);
    else if (op[0] === "l") {
      const w = op[5] / 2;
      add(
        Math.min(op[1], op[3]) - w,
        Math.min(op[2], op[4]) - w,
        Math.max(op[1], op[3]) + w,
        Math.max(op[2], op[4]) + w,
      );
    } else add(op[1] - op[3], op[2] - op[4], op[1] + op[3], op[2] + op[4] + 2);
  return { minX, minY, maxX, maxY };
}
export interface PartGeometry {
  /** Collider centre relative to the part pivot (rest pose) and its size, sprite units. */
  cx: number;
  cy: number;
  w: number;
  h: number;
}
const geometryCache = new Map<string, Record<string, PartGeometry>>();
/** Collider geometry measured from each part's art (so limbs never separate from their art). */
export function rigGeometry(kind: RigKind, variant: number): Record<string, PartGeometry> {
  const key = `${kind}:${variant}`;
  let geometry = geometryCache.get(key);
  if (!geometry) {
    // Speckles depend on the seed but stay inside the torso blob, so seed 0 measures every one.
    const art = rigArt(kind, variant, 0);
    geometry = {};
    for (const p of RIG_BLUEPRINTS[kind].parts) {
      const b = artBounds(art[p.id] ?? []);
      geometry[p.id] = {
        cx: (b.minX + b.maxX) / 2 - p.pivot[0],
        cy: (b.minY + b.maxY) / 2 - p.pivot[1],
        w: Math.max(2, b.maxX - b.minX),
        h: Math.max(2, b.maxY - b.minY),
      };
    }
    geometryCache.set(key, geometry);
  }
  return geometry;
}

export interface PoseInput {
  phase: "walk" | "windup" | "charge" | "recover" | "dead";
  /** Moving fast enough to walk. */
  moving: boolean;
  /** Animation clock in frames (16 per stride cycle); may be fractional. */
  frame: number;
  /** Windup progress 0..1. */
  windup: number;
  reaction: RigReaction;
  /** Simulation tick (fractional between ticks while drawing). */
  tick: number;
  /** Drawn facing left (sprite mirrored). */
  flip: boolean;
}
export interface PartPose {
  id: string;
  /** Pivot position and cumulative angle in sprite space. */
  x: number;
  y: number;
  angle: number;
}
export interface RigPose {
  parts: PartPose[];
  /** Hover (floating rigs) plus bob, applied to the whole figure (sprite units, negative up). */
  lift: number;
  /** Vertical squash of a living figure (presentation; 0 = none). */
  squash: number;
  /** A living knockdown in progress: 0 standing .. 1 down. */
  down: number;
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const ease = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
/** Parent parts come before their children in every blueprint. */
const rotate = (x: number, y: number, a: number): [number, number] => [
  Math.cos(a) * x - Math.sin(a) * y,
  Math.sin(a) * x + Math.cos(a) * y,
];
/** Pivot about which a rig falls or is knocked down (sprite space). */
export function fallPivot(bp: RigBlueprint): [number, number] {
  if (bp.death === "flip") return [bp.parts[0].pivot[0], bp.parts[0].pivot[1]];
  if (bp.death === "fell") {
    const trunk = bp.parts.find((p) => p.id === bp.leanPart)!;
    return [trunk.pivot[0], trunk.pivot[1]];
  }
  return [0, 0];
}
/** Living knockdown progress (0..1) from the reaction state. */
export function knockdown(bp: RigBlueprint, r: RigReaction, tick: number): number {
  if (bp.topple <= 0 || r.toppleUntil <= r.toppleAt || tick >= r.toppleUntil) return 0;
  const since = tick - r.toppleAt,
    left = r.toppleUntil - tick;
  return Math.min(ease(since / 10), ease(left / 16));
}
/**
 * The drawn pose of a living rig: authored locomotion/attack channels plus secondary motion that
 * follows the lean spring within each joint's limits. A knockdown rotates the figure about its
 * fall pivot (grounded rigs fall over, a crawler flips on its back); floating rigs scatter.
 */
export function rigPose(bp: RigBlueprint, input: PoseInput): RigPose {
  const f = input.flip ? -1 : 1,
    r = input.reaction,
    lean = r.lean * f,
    rate = r.leanRate * f,
    t = (input.frame / 16) * Math.PI * 2,
    walking = input.moving && input.phase === "walk",
    windup = input.phase === "windup" ? ease(input.windup) : 0,
    thrust = input.phase === "charge" ? 1 : 0;
  const down = input.phase === "dead" ? 0 : knockdown(bp, r, input.tick);
  const out = new Map<string, PartPose>();
  for (const p of bp.parts) {
    let local = 0;
    if (p.channel === "legA" || p.channel === "legB")
      local = walking ? Math.sin(t + p.phase) * p.swing * (p.channel === "legB" ? -1 : 1) : 0;
    else if (p.channel === "armA" || p.channel === "armB")
      local = walking ? Math.sin(t) * p.swing * (p.channel === "armB" ? 1 : -1) : 0;
    else if (p.channel === "tail") local = Math.sin(t + p.phase) * p.swing;
    else if (p.channel === "antenna") local = Math.sin(t * 0.5 + p.phase) * p.swing;
    else if (p.channel === "head") local = walking ? Math.sin(t * 2) * p.swing : 0;
    // Authored attack intent: a windup raises, a charge thrusts.
    local += p.lift * windup - p.lift * 0.45 * thrust;
    local += p.follow * lean + p.lag * rate;
    if (bp.leanPart === p.id) local += lean;
    // Down on the ground, legs and arms flail.
    if (down > 0 && p.parent !== null && bp.locomotion === "grounded")
      local += Math.sin(input.frame * 0.9 + p.pivot[0]) * 0.35 * down;
    if (p.parent !== null) local = clamp(local, p.limits[0], p.limits[1]);
    const parent = p.parent === null ? null : out.get(p.parent)!;
    if (!parent) out.set(p.id, { id: p.id, x: p.pivot[0], y: p.pivot[1], angle: local });
    else {
      const parentPart = bp.parts.find((q) => q.id === p.parent)!,
        [dx, dy] = rotate(
          p.pivot[0] - parentPart.pivot[0],
          p.pivot[1] - parentPart.pivot[1],
          parent.angle,
        );
      out.set(p.id, { id: p.id, x: parent.x + dx, y: parent.y + dy, angle: parent.angle + local });
    }
  }
  // The whole figure leans about its feet (floating rigs about their middle; rooted rigs lean
  // their trunk above instead) and falls about its fall pivot when knocked down.
  let parts = [...out.values()];
  const body = bp.locomotion === "rooted" ? 0 : lean,
    centre: [number, number] = bp.locomotion === "floating" ? [0, -20] : [0, 0];
  if (body !== 0) parts = parts.map((p) => turn(p, body, centre));
  if (down > 0) {
    if (bp.locomotion === "floating") {
      // Scattered: the form pulls apart and spins, then gathers again.
      parts = parts.map((p, i) => {
        const a = (i / parts.length) * Math.PI * 2;
        return {
          ...p,
          x: p.x + Math.cos(a) * 7 * down,
          y: p.y + Math.sin(a) * 5 * down,
          angle: p.angle + Math.sin(a) * 0.8 * down,
        };
      });
    } else {
      const angle = (bp.death === "flip" ? Math.PI : (Math.PI / 2) * 0.92) * r.side * f * down;
      parts = parts.map((p) => turn(p, angle, fallPivot(bp)));
    }
  }
  return {
    parts,
    lift: -bp.hover + (bp.locomotion === "floating" ? Math.sin(t) * 2 : 0),
    squash: clamp(r.pitch, -0.25, 0.25),
    down,
  };
}
function turn(p: PartPose, angle: number, [cx, cy]: [number, number]): PartPose {
  const [x, y] = rotate(p.x - cx, p.y - cy, angle);
  return { id: p.id, x: cx + x, y: cy + y, angle: p.angle + angle };
}

/** Animation clock of a monster: 16 frames per second of simulation, offset by its id. */
export const rigFrame = (tick: number, id: number) => (tick * 16) / 60 + (id % 16);
/**
 * The pose a monster is drawn in at a (possibly fractional) tick. The death transfer uses the
 * same function at the death tick, so remains start exactly where the living art was.
 */
export function enemyPose(
  e: Pick<
    Enemy,
    "id" | "rig" | "phase" | "vx" | "vy" | "timer" | "boss" | "behavior" | "facing" | "reaction"
  >,
  tick: number,
): RigPose {
  const windup = e.boss ? 46 : ARCHETYPES[e.behavior].windup;
  return rigPose(RIG_BLUEPRINTS[e.rig], {
    phase: e.phase,
    moving: Math.hypot(e.vx, e.vy) > 3,
    frame: rigFrame(tick, e.id),
    windup: e.phase === "windup" ? clamp(1 - e.timer / windup, 0, 1) : 0,
    reaction: e.reaction,
    tick,
    flip: Math.cos(e.facing) < 0,
  });
}
/**
 * Screen-space angle a dying body falls through (and lies at), from the killing blow: bodies fall
 * away from it and mostly sideways, so they read as lying down from the top-down camera.
 */
export function fallAngle(bp: RigBlueprint, r: RigReaction, facing: number, seed: number): number {
  const jitter = ((hash(seed, 911) % 1000) / 1000 - 0.5) * 0.4;
  if (bp.death === "flip") return Math.PI + jitter;
  const speed = Math.hypot(r.knockX, r.knockY),
    side = speed > 1 ? (r.knockX >= 0 ? 1 : -1) : Math.cos(facing) < 0 ? 1 : -1,
    tilt = speed > 1 ? clamp(r.knockY / speed, -1, 1) * 0.4 : jitter;
  // A shroud slumps part of the way over as it sinks and spreads.
  if (bp.death === "collapse") return side * 0.85 + jitter * 0.5;
  // Head direction φ (screen): sideways, tilted by the blow's vertical part; α = φ + π/2.
  const alpha = Math.atan2(tilt, side) + Math.PI / 2;
  return Math.atan2(Math.sin(alpha), Math.cos(alpha));
}

const DT = 1 / 60;
/** Poise every blow adds before its share of the monster's health. */
export const POISE_PER_BLOW = 10;
/** One tick of a living rig's lean spring and poise recovery. */
export function stepReaction(bp: RigBlueprint, r: RigReaction, vx: number): void {
  const target = clamp((vx / 100) * bp.stride, -bp.maxLean * 0.5, bp.maxLean * 0.5);
  r.leanRate += (-bp.stiffness * (r.lean - target) - bp.damping * r.leanRate) * DT;
  r.lean += r.leanRate * DT;
  if (Math.abs(r.lean) > bp.maxLean) {
    r.lean = Math.sign(r.lean) * bp.maxLean;
    r.leanRate *= -0.3;
  }
  r.pitchRate += (-bp.stiffness * 1.6 * r.pitch - bp.damping * 1.4 * r.pitchRate) * DT;
  r.pitch += r.pitchRate * DT;
  r.pitch = clamp(r.pitch, -0.3, 0.3);
  r.poise = Math.max(0, r.poise - 0.5);
  for (const key of ["lean", "leanRate", "pitch", "pitchRate"] as const)
    if (Math.abs(r[key]) < 1e-6) r[key] = 0;
}
export interface HitOutcome {
  staggered: boolean;
  toppled: boolean;
  /** Detachable index knocked off by this blow, or −1. */
  shed: number;
}
/**
 * A blow from direction (dx, dy) (unit, toward the target) with knock speed `speed`:
 * recoil, poise build-up (percent of max health), stagger and knockdown. `strength` is the
 * resolved reaction strength (0 leaves the rig unmoved); `physical` gates stagger, knockdown
 * and shedding (effective world reactions).
 */
export function hitReaction(
  bp: RigBlueprint,
  r: RigReaction,
  hit: {
    dx: number;
    dy: number;
    speed: number;
    percent: number;
    strength: number;
    physical: boolean;
    boss: boolean;
    tick: number;
  },
): HitOutcome {
  const s = hit.strength,
    k = (hit.speed / 100) * bp.recoil * s * (hit.boss ? 0.35 : 1);
  r.leanRate += hit.dx * k * 4;
  r.pitchRate -= Math.abs(hit.dy) * k * 1.2;
  r.knockX = hit.dx * hit.speed * Math.max(s, 0.05);
  r.knockY = hit.dy * hit.speed * Math.max(s, 0.05);
  const outcome: HitOutcome = { staggered: false, toppled: false, shed: -1 };
  if (!hit.physical || s <= 0) return outcome;
  // Every blow counts (sustained combos knock monsters down), heavier blows count more.
  r.poise = Math.min(1000, r.poise + (POISE_PER_BLOW + hit.percent) * s);
  const scale = hit.boss ? 2.5 : 1,
    down = r.toppleUntil > hit.tick;
  if (!hit.boss && bp.topple > 0 && !down && r.poise >= bp.topple) {
    r.toppleAt = hit.tick;
    r.toppleUntil = hit.tick + bp.toppleTicks;
    r.side = hit.dx >= 0 ? 1 : -1;
    r.poise = 0;
    outcome.toppled = true;
  } else if (!down && r.poise >= bp.stagger * scale && r.staggerUntil <= hit.tick) {
    r.staggerUntil = hit.tick + bp.staggerTicks;
    r.poise -= bp.stagger * scale * 0.5;
    outcome.staggered = true;
  }
  if (outcome.staggered || outcome.toppled) {
    const loose = detachables(bp.kind);
    for (let i = 0; i < loose.length; i++)
      if (loose[i].detach === "hit" && !(r.shed & (1 << i))) {
        r.shed |= 1 << i;
        outcome.shed = i;
        break;
      }
  }
  return outcome;
}

/** The wayfarer's controlled recoil: a lean that never touches input, and a swinging lantern. */
export interface HeroRecoil {
  lean: number;
  leanRate: number;
  swing: number;
  swingRate: number;
  /** Velocity at the end of the previous tick (lantern inertia). */
  vx: number;
  vy: number;
}
export const freshRecoil = (): HeroRecoil => ({
  lean: 0,
  leanRate: 0,
  swing: 0,
  swingRate: 0,
  vx: 0,
  vy: 0,
});
export function stepRecoil(r: HeroRecoil, vx: number, vy: number): void {
  const ax = (vx - r.vx) / DT;
  r.vx = vx;
  r.vy = vy;
  r.leanRate += (-90 * r.lean - 11 * r.leanRate) * DT;
  r.lean = clamp(r.lean + r.leanRate * DT, -0.3, 0.3);
  // A pendulum on the lantern hand: the body's acceleration swings it the other way.
  r.swingRate += (-38 * Math.sin(r.swing) - 2.6 * r.swingRate - ax * 0.012) * DT;
  r.swing = clamp(r.swing + r.swingRate * DT, -1.3, 1.3);
  for (const key of ["lean", "leanRate", "swing", "swingRate"] as const)
    if (Math.abs(r[key]) < 1e-6) r[key] = 0;
}
export function recoilHit(r: HeroRecoil, dx: number, strength: number): void {
  r.leanRate += dx * 3.2 * strength;
  r.swingRate += dx * 5 * strength;
}

/** Reproducible registry export for agents and documentation. */
export function rigExport() {
  return {
    version: 1,
    space: "sprite units: x right, y up (negative), origin at the feet; angles in radians",
    rigs: Object.fromEntries(
      RIGS.map((kind) => [
        kind,
        {
          ...structuredClone(RIG_BLUEPRINTS[kind]),
          geometry: rigGeometry(kind, 0),
          detachables: detachables(kind).map((p) => p.id),
        },
      ]),
    ),
    reaction:
      "hits add lean rate (recoil × knock × reaction strength) and poise ((10 + % of max health) × strength, secondary hits 0.6× of the percentage); poise decays 0.5/tick; stagger and knockdown need effective world reactions; bosses only stagger, at 2.5× poise",
    death:
      "topple: falls sideways about the feet; flip: rolls onto its back about the body; collapse: the shroud sinks and spreads; fell: the trunk falls about the planted roots",
  };
}
