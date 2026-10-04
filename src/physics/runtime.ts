import type { EventQueue, RigidBody, World } from "@dimforge/rapier2d-compat";
import { checksum } from "../engine/math.ts";
import { rapier } from "./bootstrap.ts";
import { compareIds, PolicyController, type PolicyTransaction, policyId } from "./policies.ts";
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
  if (recipe.role !== undefined && !["prop", "terrain", "actor"].includes(recipe.role))
    throw new Error("Unknown physics body role");
  if (
    (recipe.role === "terrain" && recipe.motion !== "fixed") ||
    (recipe.role === "actor" && recipe.motion !== "dynamic")
  )
    throw new Error("Invalid body role/motion");
  if (recipe.areaId !== undefined) policyId(recipe.areaId);
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
}
export const bodyRole = (recipe: BodyRecipe) =>
  recipe.role ?? (recipe.motion === "fixed" ? "terrain" : "prop");
const collisionGroups = (entry: BodyEntry) => {
  const role = bodyRole(entry.recipe);
  const membership = role === "terrain" ? 1 : role === "prop" ? 2 : 4;
  const filter =
    role === "prop"
      ? 3 | (entry.policy?.effective.propBlocking ? 4 : 0)
      : role === "actor"
        ? 5 | (entry.policy?.effective.propBlocking ? 2 : 0)
        : 7;
  return (membership << 16) | filter;
};

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
  private policies = new PolicyController();

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
      this.synchronizePolicies();
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
    if (atX === undefined) body.applyImpulse(impulse, true);
    else body.applyImpulseAtPoint(impulse, { x: atX / UNITS, y: atY! / UNITS }, true);
  }
  step(): void {
    this.alive();
    this.policies.apply();
    this.synchronizePolicies();
    for (const entry of this.entries())
      if (entry.drive) {
        const body = this.body(entry.recipe.id);
        body.setLinvel({ x: entry.drive.x / UNITS, y: entry.drive.y / UNITS }, true);
        body.setAngvel(0, true);
      }
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
      .map(({ recipe, handle, policy, frozen, reactivationBlocked }) => {
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
          frozen: frozen ?? false,
          reactivationBlocked: reactivationBlocked ?? false,
          policy: structuredClone(policy!),
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
  policyAt(areaId: string, x: number, y: number) {
    finite(x, "policy x", 10_000);
    finite(y, "policy y", 10_000);
    return this.policies.resolve(areaId, x, y);
  }
  place(id: string, x: number, y: number) {
    finite(x, "placement x", 10_000);
    finite(y, "placement y", 10_000);
    const body = this.body(id);
    body.setTranslation({ x: x / UNITS, y: y / UNITS }, true);
    this.clearMotion(body);
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
  private synchronizePolicies() {
    const entries = this.entries(),
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
  save(): PhysicsSnapshot {
    this.alive();
    const bytes = Array.from(this.world.takeSnapshot());
    if (bytes.length > MAX_SNAPSHOT_BYTES)
      throw new Error("Playground checkpoint exceeds its 4 MB binary bound");
    return {
      version: 2,
      backend: RAPIER_VERSION,
      units: UNITS,
      tick: this.tick,
      contacts: this.contacts,
      events: structuredClone(this.events),
      bodies: structuredClone([...this.registry.values()]),
      bytes,
      checksum: checksum(bytes),
      policies: this.policies.save(),
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
          collider.parent()?.handle !== body.handle ||
          body.numColliders() !== 1 ||
          body.isDynamic() !== (entry.recipe.motion === "dynamic" && !entry.frozen) ||
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
    ![1, 2].includes(snapshot.version) ||
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
  if (snapshot.version === 2) {
    if (!snapshot.policies) throw new Error("Missing physics policies");
    new PolicyController(snapshot.policies);
  }
  const ids = new Set<string>(),
    handles = new Set<number>(),
    colliders = new Set<number>();
  for (const entry of snapshot.bodies) {
    if (!entry) throw new Error("Invalid physics body registry");
    validateBody(entry.recipe);
    if (
      snapshot.version === 2 &&
      (typeof entry.frozen !== "boolean" ||
        typeof entry.reactivationBlocked !== "boolean" ||
        !entry.policy)
    )
      throw new Error("Invalid applied body policy");
    if (snapshot.version === 2) {
      if (!entry.policySample) throw new Error("Missing applied policy position");
      finite(entry.policySample.x, "policy sample x", 1e12);
      finite(entry.policySample.y, "policy sample y", 1e12);
    }
    if (entry.drive) {
      if (bodyRole(entry.recipe) !== "actor") throw new Error("Invalid saved actor drive");
      finite(entry.drive.x, "drive x", 600);
      finite(entry.drive.y, "drive y", 600);
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
