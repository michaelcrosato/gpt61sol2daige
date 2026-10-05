/**
 * M06 shared attack interaction specification. Every damaging action (hero abilities, mechanic
 * effects, enemy charges and shots, launched-prop impacts) is described by one recipe: its
 * query shape, authored damage, physical impulse and torque, scenery material damage, and how
 * scenery treats it (cover, pierce, phase). Gameplay owns damage and rewards; physics applies
 * the impulses and reports contacts back through these recipes.
 */
export type AttackTeam = "party" | "enemy" | "world";
/** How scenery treats a projectile or sweep: stopped by it, passing through soft material, or
 * ignoring it entirely. */
export type SceneryRule = "cover" | "pierce" | "phase";
export interface AttackRecipe {
  kind: string;
  team: AttackTeam;
  query: "arc" | "circle" | "sweep" | "projectile" | "contact";
  /** Outward speed (units/s) given to loose props in reach, before material knockback, the
   * region's impulse strength and the owner's force. */
  impulse: number;
  /** Angular speed (rad/s) added to struck props, signed by the attack's swing. */
  torque: number;
  /** Multiplier on authored damage when it lands on scenery material. */
  material: number;
  scenery: SceneryRule;
  /** Additional enemies a projectile passes through. */
  pierce: number;
  /** Bounces off hard scenery before a projectile stops. */
  ricochet: number;
  /** Shown in inspection and documentation. */
  summary: string;
}
const recipe = (r: AttackRecipe) => Object.freeze(r);
export const ATTACKS = {
  slash0: recipe({
    kind: "slash0",
    team: "party",
    query: "arc",
    impulse: 150,
    torque: 2,
    material: 1,
    scenery: "phase",
    pierce: 0,
    ricochet: 0,
    summary: "Opening slash: a short shove and spin for loose props in the arc.",
  }),
  slash1: recipe({
    kind: "slash1",
    team: "party",
    query: "arc",
    impulse: 175,
    torque: 3,
    material: 1,
    scenery: "phase",
    pierce: 0,
    ricochet: 0,
    summary: "Second slash: a slightly wider, stronger shove.",
  }),
  slash2: recipe({
    kind: "slash2",
    team: "party",
    query: "arc",
    impulse: 270,
    torque: 6,
    material: 1.25,
    scenery: "phase",
    pierce: 0,
    ricochet: 0,
    summary: "Combo finisher: launches props hard enough to hurt monsters they strike.",
  }),
  whorl: recipe({
    kind: "whorl",
    team: "party",
    query: "circle",
    impulse: 360,
    torque: 4,
    material: 1,
    scenery: "phase",
    pierce: 0,
    ricochet: 0,
    summary: "Radial burst: flings every loose prop around the hero outward.",
  }),
  nova: recipe({
    kind: "nova",
    team: "party",
    query: "circle",
    impulse: 430,
    torque: 6,
    material: 1.2,
    scenery: "phase",
    pierce: 0,
    ricochet: 0,
    summary: "Bloom Nova: the widest, strongest radial launch.",
  }),
  lance: recipe({
    kind: "lance",
    team: "party",
    query: "projectile",
    impulse: 220,
    torque: 3,
    material: 1,
    scenery: "pierce",
    pierce: 5,
    ricochet: 0,
    summary:
      "Thornlance: pierces soft scenery (wood costs one pierce), breaks what it can and stops on stone, metal and rooted terrain unless it has ricochets left.",
  }),
  dash: recipe({
    kind: "dash",
    team: "party",
    query: "sweep",
    impulse: 190,
    torque: 2,
    material: 0,
    scenery: "phase",
    pierce: 0,
    ricochet: 0,
    summary: "Dash: shoulders loose props out of the path without damaging them.",
  }),
  bloom: recipe({
    kind: "bloom",
    team: "party",
    query: "circle",
    impulse: 240,
    torque: 3,
    material: 1,
    scenery: "phase",
    pierce: 0,
    ricochet: 0,
    summary: "Living Bastion bloom: a healing burst that also pushes props away.",
  }),
  mechanic: recipe({
    kind: "mechanic",
    team: "party",
    query: "circle",
    impulse: 220,
    torque: 3,
    material: 1,
    scenery: "phase",
    pierce: 0,
    ricochet: 0,
    summary: "Area mechanics and delayed effects (bramble, rift, glass, echo).",
  }),
  charge: recipe({
    kind: "charge",
    team: "enemy",
    query: "contact",
    impulse: 260,
    torque: 3,
    material: 0.6,
    scenery: "phase",
    pierce: 0,
    ricochet: 0,
    summary: "Enemy charge: ploughs props ahead of it, which then hurt heroes they strike.",
  }),
  shot: recipe({
    kind: "shot",
    team: "enemy",
    query: "projectile",
    impulse: 60,
    torque: 1,
    material: 0.5,
    scenery: "cover",
    pierce: 0,
    ricochet: 0,
    summary: "Enemy shots: any prop or rooted terrain is cover; fragile cover takes damage.",
  }),
  impact: recipe({
    kind: "impact",
    team: "world",
    query: "contact",
    impulse: 0,
    torque: 0,
    material: 1,
    scenery: "phase",
    pierce: 0,
    ricochet: 0,
    summary:
      "Launched props: damage scales with mass and closing speed above 110 units/s; credit follows the recent instigator.",
  }),
} as const satisfies Record<string, AttackRecipe>;
export type AttackKind = keyof typeof ATTACKS;
/** Mechanic/delayed causes share one recipe; named hero abilities have their own. */
export function attackRecipe(cause: string): AttackRecipe {
  return (ATTACKS as Record<string, AttackRecipe>)[cause] ?? ATTACKS.mechanic;
}
/** Hard scenery stops a piercing projectile (or bounces it while ricochets remain). */
export const HARD_MATERIALS = ["stone", "metal"] as const;
/** Fragile scenery breaks under a piercing projectile without spending a pierce. */
export const FRAGILE_MATERIALS = ["glass", "ceramic", "cloth", "vegetation", "volatile"] as const;
/** Impacts below this closing speed (units/s) never hurt anything. */
export const IMPACT_MIN_SPEED = 110;
/** Seconds of instigator ownership after a push or throw. */
export const INSTIGATOR_TICKS = 150;
/** Ticks before the same prop can hurt the same target again. */
export const IMPACT_REPEAT_TICKS = 30;
/** Authored impact damage before the region's impact strength. */
export const impactDamage = (mass: number, closingSpeed: number) =>
  Math.max(0, closingSpeed - IMPACT_MIN_SPEED) * mass * 0.09;
/** Reproducible registry export for agents and documentation. */
export function attackExport() {
  return {
    version: 1,
    attacks: structuredClone(ATTACKS),
    hardMaterials: [...HARD_MATERIALS],
    fragileMaterials: [...FRAGILE_MATERIALS],
    impact: {
      minimumClosingSpeed: IMPACT_MIN_SPEED,
      damage: "max(0, closingSpeed - 110) * mass * 0.09 * impactStrength",
      ownershipTicks: INSTIGATOR_TICKS,
      repeatTicks: IMPACT_REPEAT_TICKS,
      teams:
        "party-owned props hurt monsters; enemy-owned props hurt heroes; unowned props hurt monsters without kill credit or drops",
    },
  };
}
