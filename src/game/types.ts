import type { Body } from "../engine/physics.ts";
import type { AreaRecipe, BehaviorId, MechanicId, RigKind, ThemeId } from "./content.ts";
import type { GearSlot, Item } from "./loot.ts";

export interface Tuning {
  difficulty: number;
  playerDamage: number;
  playerHealth: number;
  playerSpeed: number;
  enemyDamage: number;
  enemyHealth: number;
  enemySpeed: number;
}
export const DEFAULT_TUNING: Tuning = {
  difficulty: 1,
  playerDamage: 1,
  playerHealth: 1,
  playerSpeed: 1,
  enemyDamage: 1,
  enemyHealth: 1,
  enemySpeed: 1,
};
export interface Hero {
  level: number;
  xp: number;
  gold: number;
  points: number;
  skills: Record<string, number>;
  inventory: Item[];
  equipment: Partial<Record<GearSlot, string>>;
  hp: number;
  potions: number;
  kills: number;
  deaths: number;
  combo: number;
  comboUntil: number;
  attackAt: number;
  attackUntil: number;
  attackAngle: number;
  slashReady: number;
  whorlReady: number;
  lanceReady: number;
  novaReady: number;
  potionReady: number;
  invulnerableUntil: number;
  hurtUntil: number;
  dashUntil: number;
  dashAngle: number;
  lastDash: number;
  burnUntil: number;
  hasteUntil: number;
  bloodUntil: number;
  recallUntil: number;
  lastHit: number;
  procReady: number;
  dead: boolean;
  bought: string[];
  lastAbility: "slash" | "whorl" | "lance" | "nova";
  goldLost: number;
}
export interface Enemy extends Body {
  id: number;
  px: number;
  py: number;
  rig: RigKind;
  behavior: BehaviorId;
  theme: ThemeId;
  name: string;
  elite: boolean;
  boss: boolean;
  hp: number;
  baseHealth: number;
  maxHp: number;
  damage: number;
  speed: number;
  phase: "walk" | "windup" | "charge" | "recover" | "dead";
  timer: number;
  nextAttack: number;
  facing: number;
  target: string;
  hurtUntil: number;
  burnUntil: number;
  burnDamage: number;
  burnOwner: string;
  rootUntil: number;
  deadAt: number;
  attacks: number;
  counted: boolean;
  tier: number;
}
export interface Projectile {
  id: number;
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  radius: number;
  owner: string;
  enemy: boolean;
  damage: number;
  ttl: number;
  pierce: number;
  hit: number[];
  theme: ThemeId;
  /** M06: bounces left off hard scenery. */
  ricochet?: number;
  /** M06: scenery this projectile already struck (it never strikes the same prop twice). */
  scenery?: string[];
}
export interface Mechanic {
  id: number;
  kind: MechanicId;
  x: number;
  y: number;
  radius: number;
  readyAt: number;
  activeUntil: number;
  pair: number | null;
}
export interface Drop {
  id: number;
  x: number;
  y: number;
  born: number;
  kind: "gold" | "xp" | "item";
  amount: number;
  item?: Item;
}
export interface CombatEvent {
  id: number;
  tick: number;
  type:
    | "slash"
    | "whorl"
    | "lance"
    | "nova"
    | "hit"
    | "hurt"
    | "kill"
    | "level"
    | "loot"
    | "portal"
    | "mechanic"
    | "death"
    | "potion"
    | "boss"
    | "impact"
    | "break"
    | "grab"
    | "assembly";
  x: number;
  y: number;
  owner: string;
  text: string;
  amount: number;
  angle: number;
  color: string;
}
export interface DelayedEffect {
  tick: number;
  owner: string;
  x: number;
  y: number;
  damage: number;
  radius: number;
  kind: "echo" | MechanicId;
  ability?: "whorl" | "lance" | "nova";
  angle?: number;
}
export interface AdventureState {
  version: 1;
  seed: number;
  run: number;
  area: number;
  highest: number;
  townLand: number;
  mode: "town" | "area";
  recipe: AreaRecipe;
  kills: number;
  spawned: number;
  bossSpawned: boolean;
  cleared: boolean;
  enteredAt: number;
  clearTicks: number;
  totalKills: number;
  mechanicUses: number;
  transition: number;
  nextId: number;
  nextEvent: number;
  tuning: Tuning;
  heroes: Record<string, Hero>;
  enemies: Enemy[];
  projectiles: Projectile[];
  mechanics: Mechanic[];
  drops: Drop[];
  events: CombatEvent[];
  delayed: DelayedEffect[];
}
export interface HeroStats {
  damage: number;
  health: number;
  speed: number;
  haste: number;
  crit: number;
  critPower: number;
  armor: number;
  regen: number;
  leech: number;
  reach: number;
  cooldown: number;
  gold: number;
  xp: number;
  luck: number;
  burn: number;
  chain: number;
  execute: number;
  spirit: number;
  /** M06: multiplier on the physical impulse of this hero's attacks and throws. */
  force: number;
  /** M06: multiplier on this hero's material damage to scenery. */
  shatter: number;
  /** M06: Thornlance bounces off hard scenery. */
  ricochet: number;
  lance: boolean;
  nova: boolean;
  powers: string[];
}
export type AdventureAction =
  | {
      type:
        | "depart"
        | "advance"
        | "return"
        | "respawn"
        | "rest"
        | "respec"
        | "new-run"
        | "sell-spares";
    }
  | { type: "skill"; id: string }
  | { type: "grab"; id: string }
  | { type: "release"; throw: boolean }
  | { type: "equip" | "sell"; id: string }
  | { type: "buy"; index: number }
  | { type: "tuning"; values: Partial<Tuning> };
