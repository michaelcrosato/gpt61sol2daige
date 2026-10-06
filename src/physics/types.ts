import type { PropBlueprint } from "./blueprints.ts";
import type { MaterialId } from "./materials.ts";
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
  /** M05 prop material and blueprint; both present or both absent. */
  material?: MaterialId;
  blueprint?: PropBlueprint;
  /** M07: the assembly this prop belongs to (joints are declared by the assembly). */
  assembly?: string;
}
/** M07 connection kinds: hinge (revolute), fixed attachment, tether (rope), spring, slider. */
export type JointKind = "hinge" | "fixed" | "rope" | "spring" | "slider";
export interface JointMotor {
  mode: "position" | "velocity";
  /** Hinge: relative angle (rad) or angular speed (rad/s); slider: offset (units) or speed. */
  target: number;
  /** Position motors: stiffness and damping; velocity motors: damping is the drive factor. */
  stiffness: number;
  damping: number;
}
export interface JointRecipe {
  id: string;
  kind: JointKind;
  assembly: string;
  /** Member bodies; a is the anchor side. */
  a: string;
  b: string;
  /** Attachment points in each body's local frame (Fern units). */
  anchorA: { x: number; y: number };
  anchorB: { x: number; y: number };
  /** Fixed joints: b's angle minus a's angle when attached. */
  frame?: number;
  /** Rope: maximum length; spring: rest length (units). */
  length?: number;
  /** Spring stiffness and damping (Rapier units per mass). */
  stiffness?: number;
  damping?: number;
  /** Hinge relative-angle limits (rad) or slider travel limits (units). */
  limits?: [number, number];
  /** Slider axis in a's frame (unit vector). */
  axis?: { x: number; y: number };
  /** Initial motor; its current state is saved with the joint. */
  motor?: JointMotor;
  /** Load (mass × units/s demanded at the anchors) that snaps this joint; 0 never snaps. */
  breakLoad: number;
  /** Cut damage that severs it; 0 cannot be cut. */
  toughness: number;
}
export interface JointEntry {
  recipe: JointRecipe;
  /** Rapier impulse-joint handle while intact; -1 once broken. */
  handle: number;
  broken: boolean;
  /** Accumulated cut damage. */
  damage: number;
  /** Latest measured load and the peak since attachment (inspection and feedback). */
  load: number;
  peak: number;
  motor?: JointMotor;
  brokenAt?: number;
  cause?: string;
}
export type AssemblyKind =
  | "gate"
  | "chain"
  | "vine"
  | "launcher"
  | "vane"
  | "bridge"
  | "lab"
  | "remains"
  // M10 town fixtures.
  | "stall"
  | "lamp"
  | "bunting"
  // M11 generated encounters: an unanchored cargo train.
  | "cart";
export interface AssemblyRecipe {
  id: string;
  kind: AssemblyKind;
  areaId: string;
  /** Declared policy root (normally the anchor) followed by every member. */
  root: string;
  members: string[];
  /** Mechanisms that also emit an authored gameplay event; "none" moves only physically. */
  event: "none" | "launch" | "deck" | "latch";
}
/** A joint that broke during the latest step (or at a command boundary). */
export interface JointBreak {
  id: string;
  assembly: string;
  tick: number;
  cause: string;
  load: number;
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
  /** M06: a prop held by a traveler passes through travelers (it still meets monsters). */
  held?: boolean;
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
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
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
  /** Version 7 (M07): assemblies and every joint, intact or broken. */
  assemblies?: AssemblyRecipe[];
  joints?: JointEntry[];
}
