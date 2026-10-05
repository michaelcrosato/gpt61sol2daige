import type { EventQueue, RigidBody, World } from "@dimforge/rapier2d-compat";
import { checksum } from "../engine/math.ts";
import { WORLD_LIMIT } from "../engine/world.ts";
import { validateBlueprint } from "./blueprints.ts";
import { rapier } from "./bootstrap.ts";
import {
  compareIds,
  POLICY_DEFAULTS,
  type PolicyCheckpoint,
  PolicyController,
  type PolicyTransaction,
  policyId,
  type ResolvedPolicy,
} from "./policies.ts";
import {
  type BodyEntry,
  type BodyPose,
  type BodyRecipe,
  type ContactEvent,
  MAX_LAB_BODIES,
  MAX_SNAPSHOT_BYTES,
  PHYSICS_STEP,
  type PhysicsSnapshot,
  RAPIER_VERSION,
  WORLD_UNITS_PER_METRE as UNITS,
} from "./types.ts";

let liveWorlds = 0;
let liveQueues = 0;
export const physicsResources = () => ({ worlds: liveWorlds, queues: liveQueues });
export function finite(value: unknown, name: string, bound = 100_000): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > bound)
    throw new Error(`${name} must be finite and within ±${bound}`);
  return value;
}
export function validateBody(recipe: BodyRecipe, adventure = false): void {
  if (
    !recipe ||
    typeof recipe.id !== "string" ||
    !(adventure ? /^[\w-]{1,160}$/ : /^[\w-]{1,80}$/).test(recipe.id) ||
    !["fixed", "dynamic"].includes(recipe.motion)
  )
    throw new Error("Invalid physics body identity or motion");
  finite(recipe.x, "x", adventure ? WORLD_LIMIT : 10_000);
  finite(recipe.y, "y", adventure ? WORLD_LIMIT : 10_000);
  finite(recipe.angle ?? 0, "angle");
  const positive = (value: unknown, name: string, bound: number, minimum = 1) => {
    if (finite(value, name, bound) < minimum)
      throw new Error(`${name} must be at least ${minimum}`);
  };
  if (recipe.shape?.kind === "circle") positive(recipe.shape.radius, "radius", 256);
  else if (recipe.shape?.kind === "box") {
    positive(recipe.shape.width, "width", 512);
    positive(recipe.shape.height, "height", 512);
  } else throw new Error("Expected a circle or box shape");
  positive(recipe.mass ?? 1, "mass", 10_000, 0.01);
  for (const [name, value, bound] of [
    ["friction", recipe.friction ?? 0.6, 10],
    ["restitution", recipe.restitution ?? 0.3, 1],
    ["damping", recipe.damping ?? 0.35, 100],
  ] as const)
    if (finite(value, name, bound) < 0) throw new Error(`${name} cannot be negative`);
  if (recipe.ccd !== undefined && typeof recipe.ccd !== "boolean")
    throw new Error("ccd must be boolean");
  if (recipe.role !== undefined && !["prop", "terrain", "actor"].includes(recipe.role))
    throw new Error("Unknown physics body role");
  if (
    (recipe.role === "terrain" && recipe.motion !== "fixed") ||
    (recipe.role === "actor" && recipe.motion !== "dynamic")
  )
    throw new Error("Invalid body role/motion");
  if (recipe.areaId !== undefined) policyId(recipe.areaId);
  if (
    recipe.actorKind !== undefined &&
    (!adventure ||
      recipe.role !== "actor" ||
      !["player", "monster", "boss", "npc", "ambient", "loot", "sensor"].includes(recipe.actorKind))
  )
    throw new Error("Invalid adventure interaction kind");
  if (recipe.consequences !== undefined) {
    const state = recipe.consequences;
    if (
      !state ||
      typeof state !== "object" ||
      Array.isArray(state) ||
      Object.keys(state).some((key) => !["destroyed", "claimed", "durability"].includes(key)) ||
      typeof state.destroyed !== "boolean" ||
      typeof state.claimed !== "boolean"
    )
      throw new Error("Invalid prop consequence state");
    if (state.durability !== undefined && finite(state.durability, "durability", 1_000_000) < 0)
      throw new Error("Negative durability");
  }
  validateBlueprint(recipe);
}
/** Recipes hold primitives plus three small records; a direct copy keeps key order and is far
 * cheaper than structuredClone for the per-tick pose reads of every body. */
function cloneRecipe(recipe: BodyRecipe): BodyRecipe {
  const copy = { ...recipe, shape: { ...recipe.shape } };
  if (recipe.consequences) copy.consequences = { ...recipe.consequences };
  if (recipe.blueprint) copy.blueprint = { ...recipe.blueprint };
  return copy;
}
/** Same keys and order as structuredClone(entry), without its per-call cost on every save. */
function cloneEntry(entry: BodyEntry): BodyEntry {
  const copy: BodyEntry = { ...entry, recipe: cloneRecipe(entry.recipe) };
  if (entry.policy) copy.policy = clonePolicy(entry.policy);
  if (entry.policySample) copy.policySample = { ...entry.policySample };
  if (entry.drive) copy.drive = { ...entry.drive };
  if (entry.motor) copy.motor = { ...entry.motor };
  if (entry.state)
    copy.state = {
      ...cloneRecipe(entry.state),
      policy: clonePolicy(entry.state.policy),
    } as BodyPose;
  return copy;
}
/** A resolved policy holds three flat records, two strings and a list; copying them directly
 * keeps key order and gives every caller (and every save) an object it owns. */
const clonePolicy = (policy: ResolvedPolicy): ResolvedPolicy => ({
  ...policy,
  values: { ...policy.values },
  effective: { ...policy.effective },
  provenance: { ...policy.provenance },
  regions: [...policy.regions],
});
export const bodyRole = (recipe: BodyRecipe) =>
  recipe.role ?? (recipe.motion === "fixed" ? "terrain" : "prop");
const collisionGroups = (entry: BodyEntry) => {
  if (entry.recipe.actorKind) return actorGroups(entry);
  const role = bodyRole(entry.recipe);
  const membership = role === "terrain" ? 1 : role === "prop" ? 2 : 4;
  // Props always meet terrain, props and physical loot (M06); actors only through prop blocking.
  const filter =
    role === "prop"
      ? 3 |
        INTERACTION_GROUPS.loot |
        (entry.policy?.effective.propBlocking
          ? entry.held
            ? ACTORS & ~INTERACTION_GROUPS.player
            : ACTORS
          : 0)
      : role === "actor"
        ? 1 |
          (entry.policy?.effective.crowdContacts ? 4 : 0) |
          (entry.policy?.effective.propBlocking ? 2 : 0)
        : 511;
  return (membership << 16) | filter;
};

// Independent membership bits. Loot (M06) meets terrain and props only; sensors stay reserved.
export const INTERACTION_GROUPS = {
  terrain: 1,
  prop: 2,
  player: 4,
  monster: 8,
  boss: 16,
  npc: 32,
  ambient: 64,
  loot: 128,
  sensor: 256,
} as const;
const ACTORS = 4 | 8 | 16 | 32 | 64;
function actorGroups(entry: BodyEntry): number {
  const member = INTERACTION_GROUPS[entry.recipe.actorKind!];
  if (entry.recipe.actorKind === "loot") return (member << 16) | 1 | 2;
  const optional = entry.policy!.effective;
  const actors = optional.crowdContacts && !entry.motor?.phaseActors ? ACTORS : 0;
  const filter = 1 | (optional.propBlocking ? 2 : 0) | actors;
  return (member << 16) | filter;
}

/** The only owner of Rapier handles. All external coordinates and linear impulses use Fern units. */
export class PhysicsWorld {
  private world: World;
  private queue: EventQueue;
  private registry = new Map<string, BodyEntry>();
  private colliderIds = new Map<number, string>();
  private disposed = false;
  tick = 0;
  contacts = 0;
  events: ContactEvent[] = [];
  /** Contacts that started during the most recent step, complete and in stable order. */
  stepStarted: ContactEvent[] = [];
  private policies = new PolicyController();
  readonly scene: "lab" | "adventure";

  constructor(world?: World, options?: { scene: "adventure"; policies?: PolicyCheckpoint }) {
    const api = rapier();
    this.scene = options?.scene ?? "lab";
    if (options?.policies) this.policies = new PolicyController(options.policies);
    this.world = world ?? new api.World({ x: 0, y: 0 });
    liveWorlds++;
    try {
      this.queue = new api.EventQueue(true);
      liveQueues++;
      this.world.timestep = PHYSICS_STEP;
    } catch (error) {
      this.world.free();
      liveWorlds--;
      throw error;
    }
  }
  private alive(): void {
    if (this.disposed) throw new Error("Physics world is disposed");
  }
  private body(id: string): RigidBody {
    this.alive();
    const entry = this.registry.get(id);
    if (!entry) throw new Error(`Unknown physics body: ${id}`);
    return this.world.getRigidBody(entry.handle);
  }
  has(id: string): boolean {
    return this.registry.has(id);
  }
  /** Material damage and claims change semantic consequences only; colliders are untouched. */
  setConsequences(id: string, consequences: NonNullable<BodyRecipe["consequences"]>): void {
    const entry = this.registry.get(id);
    if (!entry) throw new Error(`Unknown physics body: ${id}`);
    const next = { ...entry.recipe, consequences: structuredClone(consequences) };
    validateBody(next, this.scene === "adventure");
    entry.recipe = next;
  }
  motion(id: string, vx: number, vy: number, angularVelocity = 0): void {
    const body = this.body(id);
    body.setLinvel({ x: vx / UNITS, y: vy / UNITS }, true);
    body.setAngvel(angularVelocity, true);
    const motor = this.registry.get(id)!.motor;
    if (motor) {
      motor.x = Math.fround(vx);
      motor.y = Math.fround(vy);
      motor.externalX = 0;
      motor.externalY = 0;
    }
  }
  ids(): string[] {
    return [...this.registry.keys()].sort(compareIds);
  }
  remove(id: string): void {
    const entry = this.registry.get(id);
    if (!entry) return;
    this.world.removeRigidBody(this.body(id));
    this.colliderIds.delete(entry.collider);
    this.registry.delete(id);
    this.events = this.events.filter((event) => event.a !== id && event.b !== id);
  }
  pose(id: string): BodyPose {
    const entry = this.registry.get(id);
    if (!entry) throw new Error(`Unknown physics body: ${id}`);
    const body = this.body(id),
      p = body.translation(),
      v = body.linvel();
    return {
      ...cloneRecipe(entry.recipe),
      x: p.x * UNITS,
      y: p.y * UNITS,
      angle: body.rotation(),
      vx: v.x * UNITS,
      vy: v.y * UNITS,
      angularVelocity: body.angvel(),
      sleeping: body.isSleeping(),
      frozen: entry.frozen ?? false,
      reactivationBlocked: entry.reactivationBlocked ?? false,
      ccdEnabled: body.isCcdEnabled(),
      policy: clonePolicy(entry.policy!),
    };
  }
  motor(
    id: string,
    x: number,
    y: number,
    acceleration = 0.18,
    staggerUntil = 0,
    phaseActors = false,
  ): void {
    finite(x, "motor x", 8000);
    finite(y, "motor y", 8000);
    const entry = this.registry.get(id);
    if (!entry?.recipe.actorKind) throw new Error("Motor requires an adventure actor");
    entry.motor ??= {
      intentX: 0,
      intentY: 0,
      x: 0,
      y: 0,
      externalX: 0,
      externalY: 0,
      acceleration,
      recovery: 6,
      staggerUntil: 0,
      phaseActors: false,
    };
    Object.assign(entry.motor, {
      intentX: Math.fround(x),
      intentY: Math.fround(y),
      acceleration,
      staggerUntil,
      phaseActors,
    });
  }
  velocityChange(id: string, x: number, y: number): void {
    finite(x, "velocity change x", 8000);
    finite(y, "velocity change y", 8000);
    const entry = this.registry.get(id)!;
    if (!entry.motor) this.motor(id, 0, 0);
    entry.motor!.externalX = Math.fround(entry.motor!.externalX + x);
    entry.motor!.externalY = Math.fround(entry.motor!.externalY + y);
    const body = this.body(id),
      velocity = body.linvel();
    body.setLinvel({ x: velocity.x + x / UNITS, y: velocity.y + y / UNITS }, true);
  }
  bindArea(id: string, areaId: string): void {
    const entry = this.registry.get(id)!;
    this.policies.resolve(areaId, 0, 0);
    if (entry.recipe.areaId !== areaId) {
      entry.recipe.areaId = areaId;
      entry.policy = undefined;
    }
  }
  /** Solved motion read straight from Rapier, without building a pose. */
  motionOf(id: string) {
    const entry = this.registry.get(id);
    if (!entry) throw new Error(`Unknown physics body: ${id}`);
    const body = this.body(id),
      p = body.translation(),
      v = body.linvel();
    return {
      x: p.x * UNITS,
      y: p.y * UNITS,
      vx: v.x * UNITS,
      vy: v.y * UNITS,
      angularVelocity: body.angvel(),
      mass: entry.recipe.mass ?? 1,
      dynamic: body.isDynamic(),
      frozen: entry.frozen ?? false,
    };
  }
  /** The body's applied policy, read-only and shared; copy before keeping it. */
  policyOf(id: string): ResolvedPolicy {
    const entry = this.registry.get(id);
    if (!entry) throw new Error(`Unknown physics body: ${id}`);
    return entry.policy!;
  }
  /** A held prop passes through travelers so it cannot shove its own holder around. */
  setHeld(id: string, held: boolean): void {
    const entry = this.registry.get(id);
    if (!entry || bodyRole(entry.recipe) !== "prop") throw new Error("Only props can be held");
    if (held) entry.held = true;
    else delete entry.held;
    this.world.getCollider(entry.collider).setCollisionGroups(collisionGroups(entry));
  }
  /** Adds spin to a loose prop, scaled like impulses; frozen or fixed bodies ignore it. */
  spin(id: string, angularVelocity: number): void {
    finite(angularVelocity, "spin", 200);
    const entry = this.registry.get(id),
      body = this.body(id);
    if (!entry || bodyRole(entry.recipe) !== "prop" || !body.isDynamic()) return;
    if (!entry.policy!.effective.dynamicProps) return;
    body.setAngvel(body.angvel() + angularVelocity * entry.policy!.effective.impulseStrength, true);
  }
  /**
   * First scenery collider a circle meets moving from (x, y) by (dx, dy): props and terrain the
   * caller accepts. Returns the hit fraction and the scenery's outward contact normal.
   */
  castScenery(
    x: number,
    y: number,
    dx: number,
    dy: number,
    radius: number,
    accept: (id: string, role: "prop" | "terrain") => boolean,
  ): { id: string; fraction: number; nx: number; ny: number } | null {
    const api = rapier(),
      length = Math.hypot(dx, dy);
    let best: { id: string; fraction: number; nx: number; ny: number } | null = null;
    this.world.propagateModifiedBodyPositionsToColliders();
    for (const entry of this.entries()) {
      const role = bodyRole(entry.recipe);
      if ((role !== "prop" && role !== "terrain") || !accept(entry.recipe.id, role)) continue;
      const collider = this.world.getCollider(entry.collider),
        p = collider.translation();
      if (Math.hypot(p.x * UNITS - x, p.y * UNITS - y) > length + radius + 64) continue;
      const cast = collider.castShape(
        { x: 0, y: 0 },
        new api.Ball(radius / UNITS),
        { x: x / UNITS, y: y / UNITS },
        0,
        { x: dx / UNITS, y: dy / UNITS },
        0,
        1,
        true,
      );
      if (cast && (!best || cast.time_of_impact < best.fraction))
        best = {
          id: entry.recipe.id,
          fraction: cast.time_of_impact,
          nx: cast.normal1.x,
          ny: cast.normal1.y,
        };
    }
    return best;
  }
  obstacleFraction(id: string, dx: number, dy: number, radius: number): number {
    const entry = this.registry.get(id)!,
      body = this.body(id),
      position = body.translation();
    let fraction = 1;
    const api = rapier();
    this.world.propagateModifiedBodyPositionsToColliders();
    for (const other of this.registry.values()) {
      if (other === entry || bodyRole(other.recipe) === "actor") continue;
      if (
        bodyRole(other.recipe) === "prop" &&
        (!entry.policy!.effective.propBlocking || !other.policy!.effective.propBlocking)
      )
        continue;
      const collider = this.world.getCollider(other.collider),
        p = collider.translation();
      // Local geometric rejection only accelerates the query; every obstacle remains in the world.
      if (
        Math.hypot((p.x - position.x) * UNITS, (p.y - position.y) * UNITS) >
        Math.hypot(dx, dy) + radius + 512
      )
        continue;
      const cast = collider.castShape(
        { x: 0, y: 0 },
        new api.Ball(radius / UNITS),
        position,
        0,
        { x: dx / UNITS, y: dy / UNITS },
        0,
        1,
        true,
      );
      if (cast) fraction = Math.min(fraction, cast.time_of_impact);
    }
    return fraction;
  }
  boundary(): void {
    this.policies.apply();
    this.synchronizePolicies();
  }
  policyState() {
    return this.policies.inspect();
  }
  spawn(recipe: BodyRecipe): void {
    this.alive();
    validateBody(recipe, this.scene === "adventure");
    if (this.registry.has(recipe.id)) throw new Error("Duplicate physics body ID");
    if (this.scene === "lab" && this.registry.size >= MAX_LAB_BODIES)
      throw new Error("Playground body limit reached (4096)");
    const policy = this.policies.resolve(recipe.areaId ?? "playground", recipe.x, recipe.y);
    const api = rapier();
    const descriptor = (
      recipe.motion === "dynamic" ? api.RigidBodyDesc.dynamic() : api.RigidBodyDesc.fixed()
    )
      .setTranslation(recipe.x / UNITS, recipe.y / UNITS)
      .setRotation(recipe.angle ?? 0)
      .setLinearDamping(recipe.damping ?? 0.35)
      .setAngularDamping(recipe.damping ?? 0.35)
      .setCcdEnabled(recipe.ccd ?? true);
    if (recipe.actorKind) descriptor.lockRotations();
    const body = this.world.createRigidBody(descriptor);
    try {
      const shape = recipe.shape;
      const collider = this.world.createCollider(
        (shape.kind === "circle"
          ? api.ColliderDesc.ball(shape.radius / UNITS)
          : api.ColliderDesc.cuboid(shape.width / (2 * UNITS), shape.height / (2 * UNITS))
        )
          .setMass(recipe.mass ?? 1)
          .setFriction(recipe.friction ?? 0.6)
          .setRestitution(recipe.restitution ?? 0.3)
          .setActiveEvents(api.ActiveEvents.COLLISION_EVENTS),
        body,
      );
      const entry: BodyEntry = {
        recipe: structuredClone(recipe),
        handle: body.handle,
        collider: collider.handle,
        policy,
        frozen: false,
        reactivationBlocked: false,
      };
      this.registry.set(recipe.id, entry);
      this.colliderIds.set(collider.handle, recipe.id);
      this.synchronizePolicies([entry]);
    } catch (error) {
      this.world.removeRigidBody(body);
      throw error;
    }
  }
  impulse(id: string, x: number, y: number, atX?: number, atY?: number): void {
    finite(x, "impulse x");
    finite(y, "impulse y");
    if ((atX === undefined) !== (atY === undefined)) throw new Error("Supply both atX and atY");
    if (atX !== undefined) {
      finite(atX, "atX");
      finite(atY, "atY");
    }
    const body = this.body(id);
    const entry = this.registry.get(id)!;
    if (bodyRole(entry.recipe) === "prop" && !entry.policy!.effective.dynamicProps) return; // No stored motion or impulse backlog in a quiet region.
    if (!body.isDynamic()) throw new Error("Fixed bodies cannot receive impulses");
    const strength =
      bodyRole(entry.recipe) === "prop" ? entry.policy!.effective.impulseStrength : 1;
    const impulse = { x: (x * strength) / UNITS, y: (y * strength) / UNITS };
    if (entry.recipe.actorKind) {
      this.velocityChange(id, x / body.mass(), y / body.mass());
      return;
    }
    if (atX === undefined) body.applyImpulse(impulse, true);
    else body.applyImpulseAtPoint(impulse, { x: atX / UNITS, y: atY! / UNITS }, true);
  }
  step(boundaryApplied = false): void {
    this.alive();
    if (!boundaryApplied) this.boundary();
    for (const entry of this.entries())
      if (entry.motor) {
        const motor = entry.motor,
          body = this.body(entry.recipe.id);
        this.world.getCollider(entry.collider).setCollisionGroups(collisionGroups(entry));
        const alpha =
          this.tick < motor.staggerUntil ? motor.acceleration * 0.25 : motor.acceleration;
        const dx = (motor.intentX - motor.x) * alpha,
          dy = (motor.intentY - motor.y) * alpha;
        // Walking is limited to 6000 units/s²; authored dash/charge bursts start immediately.
        // Impacts remain separate from both motor modes.
        const length = Math.hypot(dx, dy),
          scale = Math.min(1, (motor.acceleration === 1 ? 2000 : 100) / Math.max(length, 1));
        motor.x = Math.fround(motor.x + dx * scale);
        motor.y = Math.fround(motor.y + dy * scale);
        const decay = Math.exp(-motor.recovery * PHYSICS_STEP);
        motor.externalX = Math.fround(motor.externalX * decay);
        motor.externalY = Math.fround(motor.externalY * decay);
        body.setLinvel(
          { x: (motor.x + motor.externalX) / UNITS, y: (motor.y + motor.externalY) / UNITS },
          true,
        );
      } else if (entry.drive) {
        const body = this.body(entry.recipe.id);
        body.setLinvel({ x: entry.drive.x / UNITS, y: entry.drive.y / UNITS }, true);
        body.setAngvel(0, true);
      }
    this.world.step(this.queue);
    if (this.scene === "adventure")
      for (const entry of this.entries()) {
        const body = this.body(entry.recipe.id);
        if (!body.isDynamic()) continue;
        const position = body.translation(),
          velocity = body.linvel();
        const radius =
          entry.recipe.shape.kind === "circle"
            ? entry.recipe.shape.radius
            : Math.hypot(entry.recipe.shape.width, entry.recipe.shape.height) / 2;
        const bound = (WORLD_LIMIT - radius) / UNITS;
        const x = Math.max(-bound, Math.min(bound, position.x)),
          y = Math.max(-bound, Math.min(bound, position.y));
        if (x !== position.x || y !== position.y) {
          body.setTranslation({ x, y }, false);
          body.setLinvel(
            { x: x === position.x ? velocity.x : 0, y: y === position.y ? velocity.y : 0 },
            false,
          );
        }
      }
    for (const entry of this.entries())
      if (entry.motor) {
        const velocity = this.body(entry.recipe.id).linvel();
        // Retain contact response as external motion instead of erasing it on the next AI update.
        entry.motor.externalX = Math.fround(velocity.x * UNITS - entry.motor.x);
        entry.motor.externalY = Math.fround(velocity.y * UNITS - entry.motor.y);
      }
    this.tick++;
    const started: ContactEvent[] = [];
    this.queue.drainCollisionEvents((a, b, begun) => {
      const ids = [this.colliderIds.get(a), this.colliderIds.get(b)].sort();
      if (!ids[0] || !ids[1]) return; // Removed colliders may emit their final stopped event.
      const event = { tick: this.tick, a: ids[0], b: ids[1], started: begun };
      if (begun) {
        this.contacts++;
        started.push(event);
      }
      this.events.push(event);
    });
    this.stepStarted = started.sort((x, y) => compareIds(x.a, y.a) || compareIds(x.b, y.b));
    // Stable ordering for observations and later reaction rules.
    this.events.sort(
      (a, b) =>
        a.tick - b.tick ||
        compareIds(a.a, b.a) ||
        compareIds(a.b, b.b) ||
        Number(a.started) - Number(b.started),
    );
    this.events = this.events.slice(-64);
    // Read solved values directly: building complete poses here cloned every body each tick.
    for (const { handle } of this.registry.values()) {
      const body = this.world.getRigidBody(handle),
        p = body.translation(),
        v = body.linvel();
      for (const value of [p.x, p.y, body.rotation(), v.x, v.y, body.angvel()])
        if (!Number.isFinite(value)) throw new Error("Nonfinite physical state");
    }
  }
  private validatePose(pose: BodyPose): void {
    for (const value of [pose.x, pose.y, pose.angle, pose.vx, pose.vy, pose.angularVelocity])
      if (!Number.isFinite(value)) throw new Error("Nonfinite physical state");
  }
  poses(): BodyPose[] {
    this.alive();
    return [...this.registry.values()]
      .sort((a, b) => compareIds(a.recipe.id, b.recipe.id))
      .map(({ recipe, handle, policy, frozen, reactivationBlocked }) => {
        const body = this.world.getRigidBody(handle),
          position = body.translation(),
          velocity = body.linvel();
        return {
          ...cloneRecipe(recipe),
          x: position.x * UNITS,
          y: position.y * UNITS,
          angle: body.rotation(),
          vx: velocity.x * UNITS,
          vy: velocity.y * UNITS,
          angularVelocity: body.angvel(),
          sleeping: body.isSleeping(),
          frozen: frozen ?? false,
          reactivationBlocked: reactivationBlocked ?? false,
          ccdEnabled: body.isCcdEnabled(),
          policy: clonePolicy(policy!),
        };
      });
  }
  inspect(limit = this.scene === "lab" ? MAX_LAB_BODIES : 100) {
    return {
      backend: `Rapier2D ${RAPIER_VERSION}`,
      units: UNITS,
      tick: this.tick,
      contacts: this.contacts,
      scene: this.scene,
      bodyCount: this.registry.size,
      bodies: this.ids()
        .slice(0, limit)
        .map((id) => this.pose(id)),
      events: structuredClone(this.events),
      policies: this.policies.inspect(),
    };
  }
  private entries() {
    return [...this.registry.values()].sort((a, b) => compareIds(a.recipe.id, b.recipe.id));
  }
  configure(transaction: PolicyTransaction) {
    this.alive();
    // Validate every final body binding before enqueue; removal cannot strand a live body.
    const projected = new PolicyController(this.policies.save());
    const result = projected.configure(transaction);
    projected.apply();
    for (const entry of this.entries()) {
      const p = this.body(entry.recipe.id).translation();
      projected.resolve(entry.recipe.areaId ?? "playground", p.x * UNITS, p.y * UNITS);
    }
    this.policies.configure(transaction);
    return result;
  }
  applyPolicies(expectedRevision: number) {
    this.alive();
    this.policies.apply(expectedRevision);
    this.synchronizePolicies();
    return this.inspect();
  }
  policyAt(areaId: string, x: number, y: number, previous: string[] = []) {
    finite(x, "policy x", this.scene === "adventure" ? WORLD_LIMIT : 10_000);
    finite(y, "policy y", this.scene === "adventure" ? WORLD_LIMIT : 10_000);
    return this.policies.resolve(areaId, x, y, previous);
  }
  place(id: string, x: number, y: number) {
    finite(x, "placement x", this.scene === "adventure" ? WORLD_LIMIT : 10_000);
    finite(y, "placement y", this.scene === "adventure" ? WORLD_LIMIT : 10_000);
    const body = this.body(id);
    body.setTranslation({ x: x / UNITS, y: y / UNITS }, true);
    this.clearMotion(body);
    const motor = this.registry.get(id)!.motor;
    if (motor)
      Object.assign(motor, { x: 0, y: 0, externalX: 0, externalY: 0, intentX: 0, intentY: 0 });
    this.registry.get(id)!.reactivationBlocked = false;
    this.synchronizePolicies();
  }
  drive(id: string, x: number, y: number) {
    finite(x, "drive x", 600);
    finite(y, "drive y", 600);
    this.body(id);
    const entry = this.registry.get(id)!;
    if (bodyRole(entry.recipe) !== "actor") throw new Error("Drive requires a lab contact actor");
    entry.drive = { x, y };
  }
  private clearMotion(body: RigidBody) {
    body.setLinvel({ x: 0, y: 0 }, false);
    body.setAngvel(0, false);
    body.resetForces(false);
    body.resetTorques(false);
  }
  private separate(entry: BodyEntry) {
    const body = this.body(entry.recipe.id),
      collider = this.world.getCollider(entry.collider);
    // Deterministic pairwise correction also works before the first broad-phase step.
    for (let pass = 0; pass < 32; pass++) {
      let overlap = false;
      this.world.propagateModifiedBodyPositionsToColliders();
      for (const other of this.entries()) {
        if (other === entry) continue;
        const a = collisionGroups(entry),
          b = collisionGroups(other);
        if (!((a >>> 16) & b & 0xffff) || !((b >>> 16) & a & 0xffff)) continue;
        const contact = collider.contactCollider(this.world.getCollider(other.collider), 0);
        if (!contact || contact.distance >= -0.001 / UNITS) continue;
        const p = body.translation(),
          correction = -contact.distance + 0.01 / UNITS;
        body.setTranslation(
          { x: p.x - contact.normal1.x * correction, y: p.y - contact.normal1.y * correction },
          false,
        );
        this.world.propagateModifiedBodyPositionsToColliders();
        overlap = true;
      }
      if (!overlap) return true;
    }
    return false; // Inspector offers deliberate placement when no valid pose can be found.
  }
  private synchronizePolicies(selected?: BodyEntry[]) {
    const entries = selected ?? this.entries(),
      api = rapier(),
      waking: BodyEntry[] = [];
    for (const entry of entries) {
      const body = this.body(entry.recipe.id),
        p = body.translation();
      entry.policy = this.policies.resolve(
        entry.recipe.areaId ?? "playground",
        p.x * UNITS,
        p.y * UNITS,
        entry.policy?.regions,
      );
      entry.policySample = { x: p.x * UNITS, y: p.y * UNITS };
      const frozen =
        entry.recipe.motion === "dynamic" &&
        bodyRole(entry.recipe) === "prop" &&
        !entry.policy.effective.dynamicProps;
      if (frozen && !entry.frozen) {
        this.clearMotion(body);
        body.setBodyType(api.RigidBodyType.Fixed, false);
        entry.reactivationBlocked = false;
      } else if (!frozen && entry.frozen) {
        this.clearMotion(body);
        waking.push(entry);
      }
      entry.frozen = frozen;
      this.world.getCollider(entry.collider).setCollisionGroups(collisionGroups(entry));
      // Core characters always sweep solid obstacles, even under master-off.
      body.enableCcd(
        entry.recipe.actorKind
          ? true
          : (entry.recipe.ccd ?? true) &&
              (bodyRole(entry.recipe) !== "prop" || entry.policy.effective.sweptCollision),
      );
    }
    for (const entry of waking) {
      const body = this.body(entry.recipe.id),
        p = body.translation();
      const valid = this.separate(entry);
      if (!valid) body.setTranslation(p, false);
      entry.reactivationBlocked = !valid;
      entry.frozen = !valid;
      if (valid) {
        body.setBodyType(api.RigidBodyType.Dynamic, true);
        this.clearMotion(body);
        const corrected = body.translation();
        // A correction into a quiet region must never leave the body reactive there.
        entry.policy = this.policies.resolve(
          entry.recipe.areaId ?? "playground",
          corrected.x * UNITS,
          corrected.y * UNITS,
          entry.policy?.regions,
        );
        entry.policySample = { x: corrected.x * UNITS, y: corrected.y * UNITS };
        if (!entry.policy.effective.dynamicProps) {
          body.setBodyType(api.RigidBodyType.Fixed, false);
          entry.frozen = true;
        }
        this.world.getCollider(entry.collider).setCollisionGroups(collisionGroups(entry));
      }
    }
  }
  overlay(): Float32Array {
    this.alive();
    // Copy; renderer never owns a Rapier buffer/handle.
    return this.world.debugRender().vertices.map((value) => value * UNITS);
  }
  sweep() {
    const body = this.body("sweep");
    if (!body.isDynamic()) throw new Error("Swept body is frozen; enable its policy first");
    const api = rapier();
    const start = { x: -180 / UNITS, y: 110 / UNITS };
    // Pairwise casts also see newly spawned bodies before the first broad-phase step.
    this.world.propagateModifiedBodyPositionsToColliders();
    let hit: { id: string; fraction: number } | null = null;
    for (const entry of [...this.registry.values()].sort((a, b) =>
      compareIds(a.recipe.id, b.recipe.id),
    )) {
      if (entry.recipe.id === "sweep") continue;
      const cast = this.world
        .getCollider(entry.collider)
        .castShape(
          { x: 0, y: 0 },
          new api.Ball(4 / UNITS),
          start,
          0,
          { x: 400 / UNITS, y: 0 },
          0,
          1,
          true,
        );
      if (cast && (!hit || cast.time_of_impact < hit.fraction))
        hit = { id: entry.recipe.id, fraction: cast.time_of_impact };
    }
    body.setTranslation(start, true);
    body.setLinvel({ x: 24_000 / UNITS, y: 0 }, true);
    body.setAngvel(0, true);
    return {
      body: "sweep",
      from: { x: -180, y: 110 },
      to: { x: 220, y: 110 },
      hit,
    };
  }
  save(portable = false): PhysicsSnapshot {
    this.alive();
    const bytes = portable ? [] : Array.from(this.world.takeSnapshot());
    if (this.scene === "lab" && bytes.length > MAX_SNAPSHOT_BYTES)
      throw new Error("Playground checkpoint exceeds its 4 MB binary bound");
    return {
      version: 6,
      scene: this.scene,
      backend: RAPIER_VERSION,
      continuation: portable ? "rebuild" : "snapshot",
      units: UNITS,
      tick: this.tick,
      contacts: this.contacts,
      events: structuredClone(this.events),
      bodies: [...this.registry.values()].map((entry) => ({
        ...cloneEntry(entry),
        state: this.pose(entry.recipe.id),
      })),
      bytes,
      checksum: checksum(bytes),
      policies: this.policies.save(),
    };
  }
  static restore(snapshot: PhysicsSnapshot): PhysicsWorld {
    snapshot = upgradePolicySamples(snapshot);
    validatePhysicsSnapshot(snapshot);
    // World v6 (M06) changed prop collision filters for loot; older raw bytes carry the old
    // filters, so their semantic state is rebuilt exactly like an incompatible backend.
    if (
      snapshot.version >= 4 &&
      (snapshot.backend !== RAPIER_VERSION ||
        snapshot.continuation === "rebuild" ||
        snapshot.version < 6)
    )
      return PhysicsWorld.rebuild(snapshot);
    // M02 version-2 saves predate the new registered controls. Import their applied samples
    // and legacy masks explicitly; do not reinterpret them as a current malformed snapshot.
    const legacyPolicies =
      snapshot.version === 2 &&
      snapshot.bodies.some((entry) => entry.policy?.values.crowdContacts === undefined);
    if (legacyPolicies) snapshot = structuredClone(snapshot);
    const api = rapier();
    let restored: PhysicsWorld | undefined;
    try {
      const world = api.World.restoreSnapshot(new Uint8Array(snapshot.bytes));
      if (!world) throw new Error("Rapier rejected snapshot");
      restored = new PhysicsWorld(
        world,
        snapshot.scene === "adventure" ? { scene: "adventure" } : undefined,
      );
      restored.policies = new PolicyController(snapshot.policies);
      if (
        world.bodies.len() !== snapshot.bodies.length ||
        world.colliders.len() !== snapshot.bodies.length ||
        world.impulseJoints.len() !== 0 ||
        world.multibodyJoints.len() !== 0 ||
        world.softBodies.len() !== 0 ||
        world.gravity.x !== 0 ||
        world.gravity.y !== 0
      )
        throw new Error("Snapshot world does not match playground registry");
      for (const entry of snapshot.bodies) {
        const body = world.getRigidBody(entry.handle),
          collider = world.getCollider(entry.collider);
        if (
          !body ||
          !collider ||
          body.handle !== entry.handle ||
          collider.handle !== entry.collider ||
          collider.parent()?.handle !== body.handle ||
          body.numColliders() !== 1 ||
          body.isDynamic() !== (entry.recipe.motion === "dynamic" && !entry.frozen) ||
          (!body.isDynamic() && !body.isFixed())
        )
          throw new Error("Snapshot body mapping mismatch");
        const near = (a: number, b: number) =>
          Math.abs(a - b) <= Math.max(0.0001, Math.abs(b) * 0.0001);
        if (legacyPolicies) {
          const role = bodyRole(entry.recipe),
            membership = role === "terrain" ? 1 : role === "prop" ? 2 : 4;
          const filter =
            role === "terrain"
              ? 7
              : role === "prop"
                ? 3 | (entry.policy!.effective.propBlocking ? 4 : 0)
                : 5 | (entry.policy!.effective.propBlocking ? 2 : 0);
          if (collider.collisionGroups() !== ((membership << 16) | filter))
            throw new Error("Legacy collision groups mismatch");
          entry.policy = restored.policies.resolve(
            entry.recipe.areaId ?? "playground",
            entry.policySample!.x,
            entry.policySample!.y,
            entry.policy!.regions,
          );
          if (body.isCcdEnabled() !== (entry.recipe.ccd ?? true))
            throw new Error("Legacy CCD setting mismatch");
          body.enableCcd(
            (entry.recipe.ccd ?? true) &&
              (role !== "prop" || entry.policy.effective.sweptCollision),
          );
          collider.setCollisionGroups(collisionGroups(entry));
        }
        if (
          !near(collider.mass(), entry.recipe.mass ?? 1) ||
          !near(collider.friction(), entry.recipe.friction ?? 0.6) ||
          !near(collider.restitution(), entry.recipe.restitution ?? 0.3) ||
          !near(body.linearDamping(), entry.recipe.damping ?? 0.35) ||
          !near(body.angularDamping(), entry.recipe.damping ?? 0.35) ||
          body.isCcdEnabled() !==
            (entry.recipe.actorKind
              ? true
              : (entry.recipe.ccd ?? true) &&
                (bodyRole(entry.recipe) !== "prop" ||
                  (entry.policy?.effective.sweptCollision ?? true))) ||
          (entry.recipe.actorKind &&
            (body.effectiveWorldInvInertia() !== 0 || body.rotation() !== 0 || body.angvel() !== 0))
        )
          throw new Error("Snapshot body properties mismatch");
        const shape = entry.recipe.shape;
        if (
          (shape.kind === "circle" &&
            (collider.shapeType() !== api.ShapeType.Ball ||
              Math.abs(collider.radius() * UNITS - shape.radius) > 0.001)) ||
          (shape.kind === "box" &&
            (collider.shapeType() !== api.ShapeType.Cuboid ||
              Math.abs(collider.halfExtents()!.x * 2 * UNITS - shape.width) > 0.001 ||
              Math.abs(collider.halfExtents()!.y * 2 * UNITS - shape.height) > 0.001))
        )
          throw new Error("Snapshot collider shape mismatch");
        restored.registry.set(entry.recipe.id, structuredClone(entry));
        if (snapshot.version === 1) {
          const added = restored.registry.get(entry.recipe.id)!;
          const p = body.translation();
          added.policy = restored.policies.resolve(
            entry.recipe.areaId ?? "playground",
            p.x * UNITS,
            p.y * UNITS,
          );
          added.frozen = false;
          added.reactivationBlocked = false;
          added.policySample = { x: p.x * UNITS, y: p.y * UNITS };
          collider.setCollisionGroups(collisionGroups(added));
        } else {
          const saved = entry.policy!;
          // Start-of-tick membership is persisted: a moving body can cross before the next boundary.
          const state = restored.policies.inspect().state;
          if (
            !saved ||
            saved.areaId !== (entry.recipe.areaId ?? "playground") ||
            !Array.isArray(saved.regions) ||
            saved.regions.some(
              (id) => !state.profiles.regions.some((r) => r.id === id && r.areaId === saved.areaId),
            ) ||
            JSON.stringify(saved) !==
              JSON.stringify(
                restored.policies.resolve(
                  saved.areaId,
                  entry.policySample!.x,
                  entry.policySample!.y,
                  saved.regions,
                ),
              ) ||
            entry.frozen !==
              (entry.recipe.motion === "dynamic" &&
                bodyRole(entry.recipe) === "prop" &&
                (!saved.effective.dynamicProps || entry.reactivationBlocked)) ||
            collider.collisionGroups() !== collisionGroups(entry) ||
            (entry.frozen &&
              (body.linvel().x !== 0 || body.linvel().y !== 0 || body.angvel() !== 0))
          )
            throw new Error("Snapshot applied policy/body mismatch");
        }
        if (
          entry.state &&
          JSON.stringify(restored.pose(entry.recipe.id)) !== JSON.stringify(entry.state)
        )
          throw new Error("Semantic/binary pose mismatch");
        restored.colliderIds.set(entry.collider, entry.recipe.id);
      }
      restored.tick = snapshot.tick;
      restored.contacts = snapshot.contacts;
      restored.events = structuredClone(snapshot.events);
      if (snapshot.version === 1) restored.synchronizePolicies();
      for (const pose of restored.poses()) restored.validatePose(pose);
      // Queue/reference checks must run against all bodies, without changing the restored world.
      const projected = new PolicyController(restored.policies.save());
      projected.apply();
      for (const entry of restored.entries())
        projected.resolve(entry.recipe.areaId ?? "playground", 0, 0);
      return restored;
    } catch (error) {
      restored?.dispose();
      throw new Error(
        `Invalid physics snapshot: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  /** Explicit backend migration. Restore every semantic fact; never respawn content recipes. */
  private static rebuild(snapshot: PhysicsSnapshot): PhysicsWorld {
    const result = new PhysicsWorld(
      undefined,
      snapshot.scene === "adventure"
        ? { scene: "adventure", policies: snapshot.policies }
        : undefined,
    );
    try {
      result.policies = new PolicyController(snapshot.policies);
      for (const saved of snapshot.bodies) {
        const pose = saved.state!;
        result.spawn({ ...saved.recipe, x: pose.x, y: pose.y, angle: pose.angle });
        const entry = result.registry.get(saved.recipe.id)!;
        const handle = entry.handle,
          collider = entry.collider;
        Object.assign(entry, structuredClone(saved), { handle, collider });
        const body = result.body(saved.recipe.id);
        body.setBodyType(
          saved.recipe.motion === "dynamic" && !saved.frozen
            ? rapier().RigidBodyType.Dynamic
            : rapier().RigidBodyType.Fixed,
          false,
        );
        body.setTranslation({ x: pose.x / UNITS, y: pose.y / UNITS }, false);
        body.setRotation(pose.angle, false);
        body.setLinvel({ x: pose.vx / UNITS, y: pose.vy / UNITS }, false);
        body.setAngvel(pose.angularVelocity, false);
        body.enableCcd(pose.ccdEnabled);
        result.world.getCollider(collider).setCollisionGroups(collisionGroups(entry));
        if (pose.sleeping && body.isDynamic()) body.sleep();
      }
      result.tick = snapshot.tick;
      result.contacts = snapshot.contacts;
      result.events = structuredClone(snapshot.events);
      for (const pose of result.poses()) result.validatePose(pose);
      return result;
    } catch (error) {
      result.dispose();
      throw error;
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.registry.clear();
    this.colliderIds.clear();
    this.events.length = 0;
    try {
      this.queue.free();
    } finally {
      liveQueues--;
      try {
        this.world.free();
      } finally {
        liveWorlds--;
      }
    }
  }
}

/** Older checkpoints predate later registered fields (M05 destruction, M06 combat). Recompute
 * each applied sample and prove every field it did record is unchanged before accepting the
 * added defaults. */
export function upgradePolicySamples(snapshot: PhysicsSnapshot): PhysicsSnapshot {
  const missing = (values: object) =>
    (Object.keys(POLICY_DEFAULTS) as (keyof typeof POLICY_DEFAULTS)[]).filter(
      (key) => !(key in values),
    );
  if (
    !snapshot ||
    ![3, 4, 5].includes(snapshot.version) ||
    !Array.isArray(snapshot.bodies) ||
    !snapshot.bodies.some((b) => b?.policy?.values && missing(b.policy.values).length)
  )
    return snapshot;
  const upgraded = structuredClone(snapshot),
    controller = new PolicyController(upgraded.policies);
  for (const entry of upgraded.bodies) {
    const saved = entry?.policy;
    if (!saved || !entry.policySample) continue;
    const absent = missing(saved.values);
    if (!absent.length) continue;
    const resolved = structuredClone(
      controller.resolve(saved.areaId, entry.policySample.x, entry.policySample.y, saved.regions),
    );
    const legacy = structuredClone(resolved);
    for (const key of absent) {
      delete (legacy.values as Partial<typeof legacy.values>)[key];
      delete (legacy.effective as Partial<typeof legacy.effective>)[key];
      delete (legacy.provenance as Partial<typeof legacy.provenance>)[key];
    }
    if (JSON.stringify(legacy) !== JSON.stringify(saved))
      throw new Error("Invalid physics snapshot: legacy applied policy mismatch");
    entry.policy = resolved;
    if (entry.state) entry.state.policy = structuredClone(resolved);
  }
  return upgraded;
}
export function validatePhysicsSnapshot(snapshot: PhysicsSnapshot): void {
  snapshot = upgradePolicySamples(snapshot);
  if (
    !snapshot ||
    ![1, 2, 3, 4, 5, 6].includes(snapshot.version) ||
    (snapshot.version === 3 && snapshot.scene !== "adventure") ||
    (snapshot.version < 3 && snapshot.scene !== undefined) ||
    (snapshot.version >= 4 && !["adventure", "lab"].includes(snapshot.scene!)) ||
    (snapshot.version < 4 && snapshot.backend !== RAPIER_VERSION) ||
    (snapshot.version >= 4 &&
      (!/^\d+\.\d+\.\d+$/.test(snapshot.backend) ||
        !["snapshot", "rebuild"].includes(snapshot.continuation!))) ||
    snapshot.units !== UNITS ||
    !Number.isSafeInteger(snapshot.tick) ||
    snapshot.tick < 0 ||
    !Number.isSafeInteger(snapshot.contacts) ||
    snapshot.contacts < 0 ||
    !Array.isArray(snapshot.bodies) ||
    (snapshot.scene !== "adventure" && snapshot.bodies.length > MAX_LAB_BODIES) ||
    !Array.isArray(snapshot.bytes) ||
    (snapshot.continuation !== "rebuild" && snapshot.bytes.length < 32) ||
    (snapshot.continuation === "rebuild" && snapshot.bytes.length !== 0) ||
    snapshot.bytes.length > (snapshot.scene === "adventure" ? 256_000_000 : MAX_SNAPSHOT_BYTES) ||
    snapshot.bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255) ||
    checksum(snapshot.bytes) !== snapshot.checksum ||
    !Array.isArray(snapshot.events) ||
    snapshot.events.length > 64
  )
    throw new Error("Invalid or incompatible physics snapshot header/bytes");
  if (snapshot.version >= 2) {
    if (!snapshot.policies) throw new Error("Missing physics policies");
    new PolicyController(snapshot.policies);
  }
  const ids = new Set<string>(),
    handles = new Set<number>(),
    colliders = new Set<number>();
  for (const entry of snapshot.bodies) {
    if (!entry) throw new Error("Invalid physics body registry");
    validateBody(entry.recipe, snapshot.scene === "adventure");
    if (
      entry.recipe.actorKind &&
      ["player", "monster", "boss", "ambient"].includes(entry.recipe.actorKind) &&
      !entry.motor
    )
      throw new Error("Missing saved actor motor");
    if (
      entry.held !== undefined &&
      (entry.held !== true || bodyRole(entry.recipe) !== "prop" || snapshot.version < 6)
    )
      throw new Error("Invalid held prop flag");
    if (
      snapshot.version >= 2 &&
      (typeof entry.frozen !== "boolean" ||
        typeof entry.reactivationBlocked !== "boolean" ||
        !entry.policy)
    )
      throw new Error("Invalid applied body policy");
    if (snapshot.version >= 2) {
      if (!entry.policySample) throw new Error("Missing applied policy position");
      finite(entry.policySample.x, "policy sample x", 1e12);
      finite(entry.policySample.y, "policy sample y", 1e12);
    }
    if (entry.drive) {
      if (bodyRole(entry.recipe) !== "actor") throw new Error("Invalid saved actor drive");
      finite(entry.drive.x, "drive x", 600);
      finite(entry.drive.y, "drive y", 600);
    }
    if (entry.motor) {
      if (snapshot.scene !== "adventure" || !entry.recipe.actorKind)
        throw new Error("Invalid saved motor");
      for (const key of ["intentX", "intentY", "x", "y", "externalX", "externalY"] as const)
        finite(entry.motor[key], key, 16000);
      if (
        !Number.isSafeInteger(entry.motor.staggerUntil) ||
        entry.motor.staggerUntil < 0 ||
        typeof entry.motor.phaseActors !== "boolean" ||
        !Number.isFinite(entry.motor.acceleration) ||
        entry.motor.acceleration <= 0 ||
        entry.motor.acceleration > 1 ||
        entry.motor.recovery !== 6
      )
        throw new Error("Invalid motor configuration");
    }
    if (
      ids.has(entry.recipe.id) ||
      handles.has(entry.handle) ||
      colliders.has(entry.collider) ||
      !Number.isFinite(entry.handle) ||
      entry.handle < 0 ||
      !Number.isFinite(entry.collider) ||
      entry.collider < 0
    )
      throw new Error("Invalid physics body registry");
    ids.add(entry.recipe.id);
    handles.add(entry.handle);
    colliders.add(entry.collider);
  }
  if (snapshot.version >= 4) {
    const controller = new PolicyController(snapshot.policies);
    const projected = new PolicyController(snapshot.policies);
    projected.apply();
    for (const entry of snapshot.bodies) {
      const p = entry.state;
      if (!p) throw new Error("Missing semantic physical state");
      validateBody(p, snapshot.scene === "adventure");
      for (const key of ["x", "y"] as const) finite(p[key], key, WORLD_LIMIT);
      for (const key of ["angle", "vx", "vy", "angularVelocity"] as const) finite(p[key], key);
      const expectedRecipe = { ...entry.recipe, x: p.x, y: p.y, angle: p.angle };
      const expectedPolicy = controller.resolve(
        entry.recipe.areaId ?? "playground",
        entry.policySample!.x,
        entry.policySample!.y,
        entry.policy!.regions,
      );
      const recipeKeys = [
        "id",
        "motion",
        "shape",
        "mass",
        "friction",
        "restitution",
        "damping",
        "ccd",
        "role",
        "actorKind",
        "areaId",
        "consequences",
        "material",
        "blueprint",
      ];
      if (
        recipeKeys.some(
          (key) =>
            JSON.stringify(p[key as keyof BodyPose]) !==
            JSON.stringify(expectedRecipe[key as keyof BodyRecipe]),
        ) ||
        JSON.stringify(expectedPolicy) !== JSON.stringify(entry.policy) ||
        JSON.stringify(p.policy) !== JSON.stringify(entry.policy) ||
        typeof p.sleeping !== "boolean" ||
        typeof p.ccdEnabled !== "boolean" ||
        p.frozen !== entry.frozen ||
        p.reactivationBlocked !== entry.reactivationBlocked ||
        entry.frozen !==
          (entry.recipe.motion === "dynamic" &&
            bodyRole(entry.recipe) === "prop" &&
            (!entry.policy!.effective.dynamicProps || entry.reactivationBlocked)) ||
        ((entry.frozen || entry.recipe.motion === "fixed") &&
          (p.vx !== 0 || p.vy !== 0 || p.angularVelocity !== 0)) ||
        (entry.recipe.actorKind && (p.angle !== 0 || p.angularVelocity !== 0)) ||
        p.ccdEnabled !==
          (entry.recipe.actorKind
            ? true
            : (entry.recipe.ccd ?? true) &&
              (bodyRole(entry.recipe) !== "prop" || entry.policy!.effective.sweptCollision))
      )
        throw new Error("Invalid semantic physical state/policy");
      projected.resolve(entry.recipe.areaId ?? "playground", 0, 0);
    }
  }
  for (const event of snapshot.events)
    if (
      !event ||
      !ids.has(event.a) ||
      !ids.has(event.b) ||
      event.a === event.b ||
      typeof event.started !== "boolean" ||
      !Number.isSafeInteger(event.tick) ||
      event.tick < 1 ||
      event.tick > snapshot.tick
    )
      throw new Error("Invalid physics contact event");
}

export function createPlayground(): PhysicsWorld {
  const world = new PhysicsWorld();
  try {
    world.spawn({
      id: "wall",
      motion: "fixed",
      shape: { kind: "box", width: 12, height: 300 },
      x: 128,
      y: 0,
    });
    world.spawn({
      id: "backstop",
      motion: "fixed",
      shape: { kind: "box", width: 440, height: 12 },
      x: 0,
      y: -158,
    });
    for (let i = 0; i < 6; i++)
      world.spawn({
        id: `crate-${i}`,
        motion: "dynamic",
        shape: { kind: "box", width: 26, height: 26 },
        x: -50 + (i % 3) * 29,
        y: -40 + Math.floor(i / 3) * 29,
        mass: 2,
        restitution: 0.25,
      });
    world.spawn({
      id: "wheel",
      motion: "dynamic",
      shape: { kind: "circle", radius: 16 },
      x: -140,
      y: 45,
      mass: 1,
    });
    world.spawn({
      id: "sweep",
      motion: "dynamic",
      shape: { kind: "circle", radius: 4 },
      x: -180,
      y: 110,
      mass: 0.5,
      restitution: 0,
      damping: 0,
      ccd: true,
    });
    return world;
  } catch (error) {
    world.dispose();
    throw error;
  }
}
