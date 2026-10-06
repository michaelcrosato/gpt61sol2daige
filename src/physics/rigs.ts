import { hash } from "../engine/math.ts";
import type { RigKind } from "../game/content.ts";
import {
  detachables,
  fallAngle,
  fallPivot,
  type PartPose,
  type RigPose,
  rigGeometry,
  rigOf,
  rigScale,
} from "../game/rigs.ts";
import type { Enemy } from "../game/types.ts";
import type { RemainsTag } from "./blueprints.ts";
import { MATERIALS } from "./materials.ts";
import type { AssemblyRecipe, BodyRecipe, JointRecipe } from "./types.ts";

/**
 * M09 physical remains. A dying monster's actor body is removed and, in the same tick, its last
 * drawn pose becomes a jointed assembly of part bodies lying where the body fell, carrying the
 * actor's momentum and the killing blow. Detachable armor, bark and lantern cores come loose as
 * separate material props. Remains are cosmetic transients with an authored lifetime.
 */
/** 45 s: how long remains and detached pieces stay before they are cleaned up. */
export const REMAINS_TICKS = 2700;
export const remainsId = (enemy: number) => `remains-${enemy}`;
export const remainsBodyId = (enemy: number, part: string) => `prop-remains-${enemy}-${part}`;
const rotate = (x: number, y: number, a: number): [number, number] => [
  Math.cos(a) * x - Math.sin(a) * y,
  Math.sin(a) * x + Math.cos(a) * y,
];
const round = (v: number) => Math.round(v * 1e4) / 1e4;
export interface SpawnedBody {
  recipe: BodyRecipe;
  vx: number;
  vy: number;
  spin: number;
}
export interface RemainsSpawn {
  assembly: AssemblyRecipe | null;
  bodies: SpawnedBody[];
  joints: JointRecipe[];
  /** Screen angle the body falls through. */
  fall: number;
}
interface Placement {
  x: number;
  y: number;
  angle: number;
  w: number;
  h: number;
}
/**
 * Builds remains from a drawn pose. With `pieces` set, only those detachables are built, as loose
 * pieces knocked off a living rig (no fall); otherwise the whole body falls and every detachable
 * not yet shed comes loose.
 */
export function remainsRecipes(input: {
  enemy: Pick<Enemy, "id" | "rig" | "theme" | "boss" | "elite" | "facing" | "reaction">;
  pose: RigPose;
  x: number;
  y: number;
  vx: number;
  vy: number;
  areaId: string;
  palette: number;
  tick: number;
  flip: boolean;
  pieces?: string[];
}): RemainsSpawn {
  const e = input.enemy,
    bp = rigOf(e.rig),
    variant = e.id % 4,
    geometry = rigGeometry(e.rig, variant),
    f = input.flip ? -1 : 1,
    scale = rigScale(e),
    massScale = bp.mass * (e.boss ? 6 : e.elite ? 1.5 : 1),
    loose = new Set(detachables(e.rig).map((p) => p.id)),
    shed = new Set(
      detachables(e.rig)
        .filter((_, i) => e.reaction.shed & (1 << i))
        .map((p) => p.id),
    );
  const living = input.pieces !== undefined,
    fall = living ? 0 : fallAngle(bp, e.reaction, e.facing, e.id),
    [kx, ky] = fallPivot(bp),
    pivotX = f * kx * scale,
    pivotY = ky * scale;
  const poses = new Map(input.pose.parts.map((p) => [p.id, p]));
  // Rooted rigs fell their trunk; their roots stay where they grew.
  const turns = (id: string) => !living && !(bp.death === "fell" && id === bp.parts[0].id);
  const place = (pose: PartPose): Placement => {
    const g = geometry[pose.id],
      [ox, oy] = rotate(g.cx, g.cy, pose.angle);
    let x = f * (pose.x + ox) * scale,
      y = (pose.y + oy) * scale,
      angle = f * pose.angle;
    if (turns(pose.id)) {
      [x, y] = rotate(x - pivotX, y - pivotY, fall);
      x += pivotX;
      y += pivotY;
      angle += fall;
    }
    return {
      x: input.x + x,
      y: input.y + y,
      angle,
      w: Math.max(1, g.w * scale),
      h: Math.max(1, g.h * scale),
    };
  };
  const world = (id: string, sx: number, sy: number): [number, number] => {
    let x = f * sx * scale,
      y = sy * scale;
    if (turns(id)) {
      [x, y] = rotate(x - pivotX, y - pivotY, fall);
      x += pivotX;
      y += pivotY;
    }
    return [input.x + x, input.y + y];
  };
  const root = bp.parts[0],
    rootPlace = place(poses.get(root.id)!),
    [kwx, kwy] = [input.x + pivotX, input.y + pivotY],
    [px, py] = rotate(kwx - rootPlace.x, kwy - rootPlace.y, -rootPlace.angle);
  const tag = (part: string, isLoose: boolean): RemainsTag => ({
    kind: e.rig,
    part,
    theme: e.theme,
    variant,
    scale,
    flip: input.flip,
    enemy: e.id,
    born: input.tick,
    fall: round(fall),
    px: round(px),
    py: round(py),
    loose: isLoose,
  });
  const knockScale = Math.min(
    1,
    260 / Math.max(1, Math.hypot(e.reaction.knockX, e.reaction.knockY)),
  );
  const baseVx = input.vx + e.reaction.knockX * 0.35 * knockScale,
    baseVy = input.vy + e.reaction.knockY * 0.35 * knockScale;
  const bodies: SpawnedBody[] = [],
    joints: JointRecipe[] = [],
    placed = new Map<string, Placement>(),
    assemblyId = remainsId(e.id),
    members: string[] = [];
  for (const part of bp.parts) {
    const isLoose = loose.has(part.id);
    if (living ? !input.pieces!.includes(part.id) : shed.has(part.id)) continue;
    const pose = poses.get(part.id);
    if (!pose) continue;
    const at = place(pose),
      material = MATERIALS[part.material],
      id = remainsBodyId(e.id, part.id),
      seed = hash(e.id, part.id.length * 31 + part.id.charCodeAt(0));
    placed.set(part.id, at);
    const fixedRoot = !living && bp.death === "fell" && part.parent === null;
    const recipe: BodyRecipe = {
      id,
      motion: fixedRoot ? "fixed" : "dynamic",
      role: "prop",
      areaId: input.areaId,
      shape: { kind: "box", width: round(at.w), height: round(at.h) },
      x: at.x,
      y: at.y,
      angle: at.angle,
      mass: Math.max(0.02, round(massScale * part.mass)),
      friction: material.friction,
      restitution: 0.05,
      damping: isLoose ? material.damping : 3.2,
      material: part.material,
      blueprint: {
        family: "remains",
        palette: input.palette,
        expiresAt: input.tick + REMAINS_TICKS,
        rig: tag(part.id, isLoose || living),
      },
    };
    if (!isLoose && !living) {
      recipe.assembly = assemblyId;
      members.push(id);
    }
    let vx = baseVx,
      vy = baseVy,
      spin = (((seed % 1000) / 1000) * 2 - 1) * (part.parent === null ? 0.6 : 2.4);
    if (isLoose || living) {
      // Knocked-off pieces burst outward from the body with a tumble.
      const centre = place(poses.get(root.id)!),
        away = Math.atan2(at.y - centre.y, at.x - centre.x) + (((seed >>> 10) % 100) / 100 - 0.5),
        burst = 55 + ((seed >>> 4) % 35);
      vx += Math.cos(away) * burst;
      vy += Math.sin(away) * burst;
      spin = (((seed >>> 3) % 1000) / 1000 - 0.5) * 9;
    } else if (bp.death === "collapse") {
      // A collapsing shroud spreads and settles onto its shadow.
      const centre = place(poses.get(root.id)!),
        away = Math.atan2(at.y - centre.y, at.x - centre.x);
      vx += Math.cos(away) * 22;
      vy += Math.sin(away) * 22 + 16;
    }
    if (fixedRoot) vx = vy = spin = 0;
    bodies.push({ recipe, vx, vy, spin });
  }
  if (!living)
    for (const part of bp.parts) {
      if (part.parent === null || loose.has(part.id) || shed.has(part.id)) continue;
      const a = placed.get(part.parent),
        b = placed.get(part.id),
        pose = poses.get(part.id);
      if (!a || !b || !pose) continue;
      const [wx, wy] = world(part.id, pose.x, pose.y);
      const [ax, ay] = rotate(wx - a.x, wy - a.y, -a.angle),
        [bx, by] = rotate(wx - b.x, wy - b.y, -b.angle);
      joints.push({
        id: `${assemblyId}:${part.id}`,
        kind: "hinge",
        assembly: assemblyId,
        a: remainsBodyId(e.id, part.parent),
        b: remainsBodyId(e.id, part.id),
        anchorA: { x: round(ax), y: round(ay) },
        anchorB: { x: round(bx), y: round(by) },
        limits: f > 0 ? [part.limits[0], part.limits[1]] : [-part.limits[1], -part.limits[0]],
        breakLoad: 0,
        toughness: 0,
      });
    }
  return {
    assembly: members.length
      ? {
          id: assemblyId,
          kind: "remains",
          areaId: input.areaId,
          root: remainsBodyId(e.id, root.id),
          members,
          event: "none",
        }
      : null,
    bodies,
    joints,
    fall,
  };
}

/** One dead monster's remains (inspection, landing and cleanup). */
export interface RemainsRecord {
  enemy: number;
  rig: RigKind;
  born: number;
  /** Tick the falling body reaches the ground (thud, dust). */
  lands: number;
  owner: string;
  boss: boolean;
  fall: number;
  bodies: string[];
}
/** Bend of one plant (rad, + toward screen +x) and its rate. */
export interface FoliageBend {
  id: string;
  bend: number;
  rate: number;
}
export interface RigEvent {
  tick: number;
  text: string;
  x: number;
  y: number;
  owner: string;
  amount: number;
}
export interface RigState {
  version: 1;
  remains: RemainsRecord[];
  foliage: FoliageBend[];
  events: RigEvent[];
}
export const FOLIAGE_FAMILIES = new Set(["tree", "brush"]);
/** Foliage spring: stiffness, damping, rad per (units/s²) of field and per unit/s of contact. */
const FOLIAGE = {
  tree: { stiffness: 18, damping: 3.5, field: 0.0011, contact: 0.004, limit: 0.35 },
  brush: { stiffness: 30, damping: 4.5, field: 0.0035, contact: 0.06, limit: 0.9 },
} as const;
/** Remains bookkeeping, landing events and foliage bend: part of the host physical scene. */
export class RigPhysics {
  private remains = new Map<number, RemainsRecord>();
  private foliage = new Map<string, FoliageBend>();
  private events: RigEvent[] = [];
  /** Pending foliage kicks this tick (attacks, falling bodies): id -> bend rate. */
  private kicks = new Map<string, number>();
  add(record: RemainsRecord): void {
    this.remains.set(record.enemy, structuredClone(record));
  }
  has(enemy: number): boolean {
    return this.remains.has(enemy);
  }
  record(enemy: number): RemainsRecord | undefined {
    const r = this.remains.get(enemy);
    return r ? structuredClone(r) : undefined;
  }
  list(): RemainsRecord[] {
    return [...this.remains.values()]
      .sort((a, b) => a.enemy - b.enemy)
      .map((r) => structuredClone(r));
  }
  /** Forget remains whose bodies are all gone (expired or the land changed). */
  prune(has: (id: string) => boolean): void {
    for (const [enemy, record] of this.remains)
      if (!record.bodies.some(has)) this.remains.delete(enemy);
  }
  emit(event: RigEvent): void {
    this.events.push(event);
    if (this.events.length > 64) this.events = this.events.slice(-64);
  }
  take(): RigEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }
  kick(id: string, rate: number): void {
    this.kicks.set(id, (this.kicks.get(id) ?? 0) + rate);
  }
  bendOf(id: string): number {
    return this.foliage.get(id)?.bend ?? 0;
  }
  foliageView(): Map<string, number> {
    return new Map([...this.foliage.values()].map((f) => [f.id, f.bend]));
  }
  /**
   * After the solve: landing events at their tick, then foliage. Each plant's bend is a spring;
   * where foliage response is on, wind and pressure fields, moving bodies brushing past and
   * blows push it; where it is off, it only returns toward rest.
   */
  update(
    tick: number,
    plants: {
      id: string;
      family: "tree" | "brush";
      x: number;
      y: number;
      foliage: boolean;
      /** Field strength where environmental forces are on there, else 0. */
      fields: number;
    }[],
    movers: { x: number; y: number; vx: number; reach: number }[],
    field: (x: number, y: number) => number,
    landing: (record: RemainsRecord) => { x: number; y: number; material: string } | null,
  ): void {
    for (const record of [...this.remains.values()].sort((a, b) => a.enemy - b.enemy))
      if (record.lands === tick) {
        const at = landing(record);
        if (at)
          this.emit({
            tick,
            text: `fall:${record.rig}:${at.material}`,
            x: at.x,
            y: at.y,
            owner: record.owner,
            amount: record.boss ? 3 : 1,
          });
      }
    const dt = 1 / 60;
    for (const plant of plants) {
      const tune = FOLIAGE[plant.family];
      let state = this.foliage.get(plant.id);
      const kick = this.kicks.get(plant.id) ?? 0;
      let push = 0;
      if (plant.foliage) {
        if (plant.fields > 0) push += field(plant.x, plant.y) * tune.field * plant.fields;
        for (const m of movers) {
          const d = Math.hypot(m.x - plant.x, m.y - plant.y);
          if (d < m.reach) push += m.vx * tune.contact * (1 - d / m.reach);
        }
      }
      if (!state && push === 0 && kick === 0) continue;
      state ??= { id: plant.id, bend: 0, rate: 0 };
      if (plant.foliage) state.rate += kick;
      state.rate += (-tune.stiffness * state.bend - tune.damping * state.rate + push) * dt;
      state.bend = Math.max(-tune.limit, Math.min(tune.limit, state.bend + state.rate * dt));
      if (Math.abs(state.bend) < 1e-4 && Math.abs(state.rate) < 1e-4) this.foliage.delete(plant.id);
      else this.foliage.set(plant.id, state);
    }
    this.kicks.clear();
    for (const id of [...this.foliage.keys()])
      if (!plants.some((p) => p.id === id)) this.foliage.delete(id);
  }
  save(): RigState {
    return {
      version: 1,
      remains: this.list(),
      foliage: [...this.foliage.values()]
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((f) => ({ ...f })),
      events: structuredClone(this.events),
    };
  }
  restore(state: RigState | undefined): void {
    this.remains = new Map((state?.remains ?? []).map((r) => [r.enemy, structuredClone(r)]));
    this.foliage = new Map((state?.foliage ?? []).map((f) => [f.id, { ...f }]));
    this.events = structuredClone(state?.events ?? []);
    this.kicks.clear();
  }
  clear(): void {
    this.restore(undefined);
  }
}
export function validateRigState(state: RigState, has: (id: string) => boolean): void {
  const finite = (v: unknown, bound = 1e6) =>
    typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= bound;
  if (
    !state ||
    typeof state !== "object" ||
    state.version !== 1 ||
    !Array.isArray(state.remains) ||
    !Array.isArray(state.foliage) ||
    !Array.isArray(state.events) ||
    state.remains.length > 4096 ||
    state.foliage.length > 4096 ||
    state.events.length > 64
  )
    throw new Error("Invalid rig state");
  const enemies = new Set<number>();
  for (const r of state.remains) {
    if (
      !r ||
      !Number.isSafeInteger(r.enemy) ||
      r.enemy < 0 ||
      enemies.has(r.enemy) ||
      typeof r.rig !== "string" ||
      !Number.isSafeInteger(r.born) ||
      !Number.isSafeInteger(r.lands) ||
      r.lands < r.born ||
      typeof r.owner !== "string" ||
      r.owner.length > 80 ||
      typeof r.boss !== "boolean" ||
      !finite(r.fall, 7) ||
      !Array.isArray(r.bodies) ||
      r.bodies.length < 1 ||
      r.bodies.length > 64 ||
      r.bodies.some((id) => typeof id !== "string" || !id.startsWith(`prop-remains-${r.enemy}-`))
    )
      throw new Error("Invalid remains record");
    enemies.add(r.enemy);
  }
  const plants = new Set<string>();
  for (const f of state.foliage) {
    if (
      !f ||
      typeof f.id !== "string" ||
      plants.has(f.id) ||
      !has(f.id) ||
      !finite(f.bend, 1) ||
      !finite(f.rate, 1000)
    )
      throw new Error("Invalid foliage bend");
    plants.add(f.id);
  }
  for (const e of state.events)
    if (
      !e ||
      !Number.isSafeInteger(e.tick) ||
      typeof e.text !== "string" ||
      !/^[a-z]+:[\w:-]{1,60}$/.test(e.text) ||
      !finite(e.x) ||
      !finite(e.y) ||
      typeof e.owner !== "string" ||
      e.owner.length > 80 ||
      !finite(e.amount, 100)
    )
      throw new Error("Invalid rig event");
}
