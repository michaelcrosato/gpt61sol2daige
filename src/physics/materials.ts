/**
 * M05 material registry. One shared recipe per material drives body response, durability,
 * breakage and feedback. Flammability and conductivity are recorded for M08 reaction rules;
 * nothing reads them as live behavior before then.
 */
export const MATERIAL_IDS = [
  "wood",
  "stone",
  "metal",
  "glass",
  "cloth",
  "vegetation",
  "ceramic",
  "volatile",
] as const;
export type MaterialId = (typeof MATERIAL_IDS)[number];
/** Presentation-only particles emitted by impacts and breaks; never bodies or saved state. */
export type MaterialFeedback = "splinters" | "dust" | "shards" | "sparks" | "fibres" | "leaves";
export interface MaterialRecipe {
  id: MaterialId;
  name: string;
  /** Mass per square world unit; blueprints multiply by their collider area. */
  density: number;
  friction: number;
  restitution: number;
  damping: number;
  /** Damage removed from every hit before durability changes; weak hits on stone do nothing. */
  resistance: number;
  /** Multiplier on the remaining damage. */
  vulnerability: number;
  /** Outward speed (units/s) given to fracture pieces, before inherited motion. */
  burst: number;
  /** Multiplier on the visible push an attack gives a loose body of this material. */
  knockback: number;
  feedback: MaterialFeedback;
  /** Base/highlight/accent colors before a land palette tints them. */
  colors: [string, string, string];
  flammability: number;
  conductivity: number;
  tags: string[];
}
export const MATERIALS: Record<MaterialId, MaterialRecipe> = {
  wood: {
    id: "wood",
    name: "Wood",
    density: 0.0026,
    friction: 0.55,
    restitution: 0.08,
    damping: 1.6,
    resistance: 0,
    vulnerability: 1,
    burst: 70,
    knockback: 1,
    feedback: "splinters",
    colors: ["#946e45", "#c99a62", "#5c4129"],
    flammability: 0.7,
    conductivity: 0.05,
    tags: ["splinters", "burnable", "floats"],
  },
  stone: {
    id: "stone",
    name: "Stone",
    density: 0.009,
    friction: 0.8,
    restitution: 0.02,
    damping: 2.4,
    resistance: 22,
    vulnerability: 0.85,
    burst: 45,
    knockback: 0.35,
    feedback: "dust",
    colors: ["#7a7f78", "#b4b9ad", "#4b5050"],
    flammability: 0,
    conductivity: 0.1,
    tags: ["resists-weak-hits", "heavy", "chips"],
  },
  metal: {
    id: "metal",
    name: "Metal",
    density: 0.012,
    friction: 0.35,
    restitution: 0.25,
    damping: 1.2,
    resistance: 14,
    vulnerability: 0.7,
    burst: 60,
    knockback: 0.5,
    feedback: "sparks",
    colors: ["#6f7a80", "#c3cfd1", "#3d4549"],
    flammability: 0,
    conductivity: 0.95,
    tags: ["conductive", "dents", "rings"],
  },
  glass: {
    id: "glass",
    name: "Glass",
    density: 0.0045,
    friction: 0.2,
    restitution: 0.3,
    damping: 1.4,
    resistance: 0,
    vulnerability: 1.6,
    burst: 120,
    knockback: 0.8,
    feedback: "shards",
    colors: ["#8fd6dc", "#e3fbf7", "#4c9aa3"],
    flammability: 0,
    conductivity: 0.02,
    tags: ["shatters", "brittle", "sharp"],
  },
  cloth: {
    id: "cloth",
    name: "Cloth",
    density: 0.0008,
    friction: 0.9,
    restitution: 0,
    damping: 4,
    resistance: 0,
    vulnerability: 1.2,
    burst: 35,
    knockback: 1.4,
    feedback: "fibres",
    colors: ["#b9925d", "#e8cf9b", "#7a5a37"],
    flammability: 0.9,
    conductivity: 0,
    tags: ["flutters", "tears", "burnable"],
  },
  vegetation: {
    id: "vegetation",
    name: "Vegetation",
    density: 0.0018,
    friction: 0.7,
    restitution: 0.05,
    damping: 2.6,
    resistance: 3,
    vulnerability: 1,
    burst: 50,
    knockback: 0.9,
    feedback: "leaves",
    colors: ["#4f7a45", "#8fbb73", "#2e4a2c"],
    flammability: 0.55,
    conductivity: 0.15,
    tags: ["sways", "sheds-leaves", "burnable"],
  },
  ceramic: {
    id: "ceramic",
    name: "Ceramic",
    density: 0.0042,
    friction: 0.45,
    restitution: 0.12,
    damping: 1.8,
    resistance: 0,
    vulnerability: 1.4,
    burst: 95,
    knockback: 0.9,
    feedback: "shards",
    colors: ["#b76f4b", "#e3a979", "#6e3f2a"],
    flammability: 0,
    conductivity: 0.02,
    tags: ["shatters", "brittle", "holds-rewards"],
  },
  volatile: {
    id: "volatile",
    name: "Volatile container",
    density: 0.003,
    friction: 0.5,
    restitution: 0.06,
    damping: 1.5,
    resistance: 0,
    vulnerability: 1.5,
    burst: 150,
    knockback: 1,
    feedback: "sparks",
    colors: ["#7f3b2c", "#d9774d", "#3e2019"],
    flammability: 1,
    conductivity: 0.1,
    tags: ["volatile", "burnable", "bursts"],
  },
};
export function isMaterial(value: unknown): value is MaterialId {
  return typeof value === "string" && (MATERIAL_IDS as readonly string[]).includes(value);
}
/** Durability lost to one hit; non-positive results are a resisted hit. */
export function materialDamage(material: MaterialId, damage: number, durabilityScale = 1): number {
  const recipe = MATERIALS[material];
  const remaining = Math.max(0, damage - recipe.resistance) * recipe.vulnerability;
  return remaining / Math.max(0.05, durabilityScale);
}
