import type { EventQueue, RigidBody, World } from "@dimforge/rapier2d-compat";
import { checksum } from "../engine/math.ts";
import { rapier } from "./bootstrap.ts";
import {
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
const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const physicsResources = () => ({ worlds: liveWorlds, queues: liveQueues });
export function finite(value: unknown, name: string, bound = 100_000): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > bound)
    throw new Error(`${name} must be finite and within ±${bound}`);
  return value;
}
export function validateBody(recipe: BodyRecipe): void {
  if (
    !recipe ||
    typeof recipe.id !== "string" ||
    !/^[\w-]{1,80}$/.test(recipe.id) ||
    !["fixed", "dynamic"].includes(recipe.motion)
  )
    throw new Error("Invalid physics body identity or motion");
  finite(recipe.x, "x", 10_000);
  finite(recipe.y, "y", 10_000);
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
}

/** The only owner of Rapier handles. All external coordinates and linear impulses use Fern units. */
export class PhysicsWorld {
  private world: World;
  private queue: EventQueue;
  private registry = new Map<string, { recipe: BodyRecipe; handle: number; collider: number }>();
  private colliderIds = new Map<number, string>();
  private disposed = false;
  tick = 0;
  contacts = 0;
  events: ContactEvent[] = [];

  constructor(world?: World) {
    const api = rapier();
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
  spawn(recipe: BodyRecipe): void {
    this.alive();
    validateBody(recipe);
    if (this.registry.has(recipe.id)) throw new Error("Duplicate physics body ID");
    if (this.registry.size >= MAX_LAB_BODIES)
      throw new Error("Playground body limit reached (4096)");
    const api = rapier();
    const descriptor = (
      recipe.motion === "dynamic" ? api.RigidBodyDesc.dynamic() : api.RigidBodyDesc.fixed()
    )
      .setTranslation(recipe.x / UNITS, recipe.y / UNITS)
      .setRotation(recipe.angle ?? 0)
      .setLinearDamping(recipe.damping ?? 0.35)
      .setAngularDamping(recipe.damping ?? 0.35)
      .setCcdEnabled(recipe.ccd ?? true);
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
      this.registry.set(recipe.id, {
        recipe: structuredClone(recipe),
        handle: body.handle,
        collider: collider.handle,
      });
      this.colliderIds.set(collider.handle, recipe.id);
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
    if (!body.isDynamic()) throw new Error("Fixed bodies cannot receive impulses");
    const impulse = { x: x / UNITS, y: y / UNITS };
    if (atX === undefined) body.applyImpulse(impulse, true);
    else body.applyImpulseAtPoint(impulse, { x: atX / UNITS, y: atY! / UNITS }, true);
  }
  step(): void {
    this.alive();
    this.world.step(this.queue);
    this.tick++;
    this.queue.drainCollisionEvents((a, b, started) => {
      const ids = [this.colliderIds.get(a), this.colliderIds.get(b)].sort();
      if (!ids[0] || !ids[1]) throw new Error("Unregistered physics contact");
      if (started) this.contacts++;
      this.events.push({ tick: this.tick, a: ids[0], b: ids[1], started });
    });
    // Stable ordering for observations and later reaction rules.
    this.events.sort(
      (a, b) =>
        a.tick - b.tick ||
        compareIds(a.a, b.a) ||
        compareIds(a.b, b.b) ||
        Number(a.started) - Number(b.started),
    );
    this.events = this.events.slice(-64);
    for (const pose of this.poses()) this.validatePose(pose);
  }
  private validatePose(pose: BodyPose): void {
    for (const value of [pose.x, pose.y, pose.angle, pose.vx, pose.vy, pose.angularVelocity])
      if (!Number.isFinite(value)) throw new Error("Nonfinite physical state");
  }
  poses(): BodyPose[] {
    this.alive();
    return [...this.registry.values()]
      .sort((a, b) => compareIds(a.recipe.id, b.recipe.id))
      .map(({ recipe, handle }) => {
        const body = this.world.getRigidBody(handle),
          position = body.translation(),
          velocity = body.linvel();
        return {
          ...structuredClone(recipe),
          x: position.x * UNITS,
          y: position.y * UNITS,
          angle: body.rotation(),
          vx: velocity.x * UNITS,
          vy: velocity.y * UNITS,
          angularVelocity: body.angvel(),
          sleeping: body.isSleeping(),
        };
      });
  }
  inspect() {
    return {
      backend: `Rapier2D ${RAPIER_VERSION}`,
      units: UNITS,
      tick: this.tick,
      contacts: this.contacts,
      bodies: this.poses(),
      events: structuredClone(this.events),
    };
  }
  overlay(): Float32Array {
    this.alive();
    // Copy; renderer never owns a Rapier buffer/handle.
    return this.world.debugRender().vertices.map((value) => value * UNITS);
  }
  sweep() {
    const body = this.body("sweep");
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
  save(): PhysicsSnapshot {
    this.alive();
    const bytes = Array.from(this.world.takeSnapshot());
    if (bytes.length > MAX_SNAPSHOT_BYTES)
      throw new Error("Playground checkpoint exceeds its 4 MB binary bound");
    return {
      version: 1,
      backend: RAPIER_VERSION,
      units: UNITS,
      tick: this.tick,
      contacts: this.contacts,
      events: structuredClone(this.events),
      bodies: structuredClone([...this.registry.values()]),
      bytes,
      checksum: checksum(bytes),
    };
  }
  static restore(snapshot: PhysicsSnapshot): PhysicsWorld {
    validatePhysicsSnapshot(snapshot);
    const api = rapier();
    let restored: PhysicsWorld | undefined;
    try {
      const world = api.World.restoreSnapshot(new Uint8Array(snapshot.bytes));
      if (!world) throw new Error("Rapier rejected snapshot");
      restored = new PhysicsWorld(world);
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
          collider.parent()?.handle !== body.handle ||
          body.numColliders() !== 1 ||
          body.isDynamic() !== (entry.recipe.motion === "dynamic") ||
          (!body.isDynamic() && !body.isFixed())
        )
          throw new Error("Snapshot body mapping mismatch");
        const near = (a: number, b: number) =>
          Math.abs(a - b) <= Math.max(0.0001, Math.abs(b) * 0.0001);
        if (
          !near(collider.mass(), entry.recipe.mass ?? 1) ||
          !near(collider.friction(), entry.recipe.friction ?? 0.6) ||
          !near(collider.restitution(), entry.recipe.restitution ?? 0.3) ||
          !near(body.linearDamping(), entry.recipe.damping ?? 0.35) ||
          !near(body.angularDamping(), entry.recipe.damping ?? 0.35) ||
          body.isCcdEnabled() !== (entry.recipe.ccd ?? true)
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
        restored.colliderIds.set(entry.collider, entry.recipe.id);
      }
      restored.tick = snapshot.tick;
      restored.contacts = snapshot.contacts;
      restored.events = structuredClone(snapshot.events);
      for (const pose of restored.poses()) restored.validatePose(pose);
      return restored;
    } catch (error) {
      restored?.dispose();
      throw new Error(
        `Invalid physics snapshot: ${error instanceof Error ? error.message : String(error)}`,
      );
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

export function validatePhysicsSnapshot(snapshot: PhysicsSnapshot): void {
  if (
    !snapshot ||
    snapshot.version !== 1 ||
    snapshot.backend !== RAPIER_VERSION ||
    snapshot.units !== UNITS ||
    !Number.isSafeInteger(snapshot.tick) ||
    snapshot.tick < 0 ||
    !Number.isSafeInteger(snapshot.contacts) ||
    snapshot.contacts < 0 ||
    !Array.isArray(snapshot.bodies) ||
    snapshot.bodies.length > MAX_LAB_BODIES ||
    !Array.isArray(snapshot.bytes) ||
    snapshot.bytes.length < 32 ||
    snapshot.bytes.length > MAX_SNAPSHOT_BYTES ||
    snapshot.bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255) ||
    checksum(snapshot.bytes) !== snapshot.checksum ||
    !Array.isArray(snapshot.events) ||
    snapshot.events.length > 64
  )
    throw new Error("Invalid or incompatible physics snapshot header/bytes");
  const ids = new Set<string>(),
    handles = new Set<number>(),
    colliders = new Set<number>();
  for (const entry of snapshot.bodies) {
    if (!entry) throw new Error("Invalid physics body registry");
    validateBody(entry.recipe);
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
