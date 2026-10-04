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
}
export interface BodyPose extends BodyRecipe {
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  angularVelocity: number;
  sleeping: boolean;
}
export interface ContactEvent {
  tick: number;
  a: string;
  b: string;
  started: boolean;
}
export interface PhysicsSnapshot {
  version: 1;
  backend: typeof RAPIER_VERSION;
  units: typeof WORLD_UNITS_PER_METRE;
  tick: number;
  contacts: number;
  events: ContactEvent[];
  bodies: { recipe: BodyRecipe; handle: number; collider: number }[];
  bytes: number[];
  checksum: number;
}
