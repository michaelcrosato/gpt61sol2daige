import type { PolicyCheckpoint, ResolvedPolicy } from "./policies.ts";

export const RAPIER_VERSION = "0.21.0";
export const WORLD_UNITS_PER_METRE = 16;
export const PHYSICS_STEP = 1 / 60;
// Explicit bounds for this development playground's commands/checkpoints, not an ambient budget.
export const MAX_LAB_BODIES = 4096;
export const MAX_SNAPSHOT_BYTES = 4_000_000;
export type ShapeRecipe =
  | { kind: "circle"; radius: number }
  | { kind: "box"; width: number; height: number };
export interface BodyRecipe {
  id: string;
  motion: "dynamic" | "fixed";
  shape: ShapeRecipe;
  x: number;
  y: number;
  angle?: number;
  mass?: number;
  friction?: number;
  restitution?: number;
  damping?: number;
  ccd?: boolean;
  role?: "prop" | "terrain" | "actor";
  actorKind?: "player" | "monster" | "boss" | "npc" | "ambient" | "loot" | "sensor";
  areaId?: string;
  consequences?: { destroyed: boolean; claimed: boolean; durability?: number };
}
export interface BodyPose extends BodyRecipe {
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  angularVelocity: number;
  sleeping: boolean;
  frozen: boolean;
  reactivationBlocked: boolean;
  ccdEnabled: boolean;
  policy: ResolvedPolicy;
}
export interface BodyEntry {
  recipe: BodyRecipe;
  handle: number;
  collider: number;
  policy?: ResolvedPolicy;
  policySample?: { x: number; y: number };
  frozen?: boolean;
  reactivationBlocked?: boolean;
  drive?: { x: number; y: number };
  motor?: MotorState;
  state?: BodyPose;
}
export interface MotorState {
  intentX: number;
  intentY: number;
  x: number;
  y: number;
  externalX: number;
  externalY: number;
  acceleration: number;
  recovery: number;
  staggerUntil: number;
  phaseActors: boolean;
}
export interface ContactEvent {
  tick: number;
  a: string;
  b: string;
  started: boolean;
}
export interface PhysicsSnapshot {
  version: 1 | 2 | 3 | 4;
  scene?: "adventure" | "lab";
  backend: string;
  continuation?: "snapshot" | "rebuild";
  units: typeof WORLD_UNITS_PER_METRE;
  tick: number;
  contacts: number;
  events: ContactEvent[];
  bodies: BodyEntry[];
  bytes: number[];
  checksum: number;
  policies?: PolicyCheckpoint;
}
