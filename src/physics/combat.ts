import { hash } from "../engine/math.ts";
import type { Player, Simulation } from "../engine/simulation.ts";
import { TILE, WORLD_LIMIT } from "../engine/world.ts";
import {
  type AttackTeam,
  IMPACT_MIN_SPEED,
  IMPACT_REPEAT_TICKS,
  INSTIGATOR_TICKS,
  impactDamage,
} from "../game/interactions.ts";
import type { Drop } from "../game/types.ts";
import { compareIds } from "./policies.ts";
import type { PhysicsWorld } from "./runtime.ts";
import type { BodyRecipe } from "./types.ts";

/**
 * M06 physical combat state owned by the host's adventure physics: who last launched each prop
 * (instigator), contact impacts waiting for the next gameplay boundary, per-pair hit
 * suppression, held props, and which loot has been checked for reachability. All of it is saved,
 * replicated in the complete scene and replayed.
 */
export interface Instigator {
  id: string;
  owner: string;
  team: AttackTeam;
  cause: string;
  until: number;
}
export interface PendingImpact {
  /** Stable event identity: tick, source prop and target. */
  id: string;
  tick: number;
  prop: string;
  target: string;
  owner: string;
  team: AttackTeam;
  /** Authored damage before the target's own rules (impact strength already applied). */
  damage: number;
  closing: number;
  x: number;
  y: number;
  angle: number;
}
export interface Hold {
  player: string;
  id: string;
  since: number;
}
export interface CombatPhysicsState {
  instigators: Instigator[];
  impacts: PendingImpact[];
  suppressed: [string, number][];
  holds: Hold[];
  /** Drop ids whose resting position has been confirmed reachable. */
  settled: number[];
}
export const lootBodyId = (drop: number) => `loot-${drop}`;
export const isPropId = (id: string) =>
  id.startsWith("crate-") || id.startsWith("wheel-") || id.startsWith("prop-");
/** Heaviest prop a traveler can lift. A wagon (about 7.4) still can; a fallen trunk cannot. */
export const GRAB_MAX_MASS = 8;
export const GRAB_REACH = 72;
export const THROW_SPEED = 430;
const HOLD_BREAK = 150;
const MAGNET_RANGE = 130;

export class CombatPhysics {
  private instigators = new Map<string, Instigator>();
  private impacts: PendingImpact[] = [];
  private suppressed = new Map<string, number>();
  private holds = new Map<string, Hold>();
  private settled = new Set<number>();
  /** Pre-step velocities of fast loose props; derived each tick, never saved. */
  private fast = new Map<string, { vx: number; vy: number; mass: number }>();

  save(): CombatPhysicsState {
    return {
      instigators: [...this.instigators.values()]
        .sort((a, b) => compareIds(a.id, b.id))
        .map((i) => ({ ...i })),
      impacts: this.impacts.map((i) => ({ ...i })),
      suppressed: [...this.suppressed].sort((a, b) => compareIds(a[0], b[0])),
      holds: [...this.holds.values()]
        .sort((a, b) => compareIds(a.player, b.player))
        .map((h) => ({ ...h })),
      settled: [...this.settled].sort((a, b) => a - b),
    };
  }
  restore(state: CombatPhysicsState | undefined): void {
    this.instigators = new Map((state?.instigators ?? []).map((i) => [i.id, { ...i }]));
    this.impacts = (state?.impacts ?? []).map((i) => ({ ...i }));
    this.suppressed = new Map(state?.suppressed ?? []);
    this.holds = new Map((state?.holds ?? []).map((h) => [h.player, { ...h }]));
    this.settled = new Set(state?.settled ?? []);
  }
  /** Land changes and new runs start without stale ownership, holds or pending impacts. */
  clear(): void {
    this.instigators.clear();
    this.impacts = [];
    this.suppressed.clear();
    this.holds.clear();
    this.settled.clear();
  }
  instigate(id: string, owner: string, team: AttackTeam, cause: string, tick: number): void {
    if (!owner) return;
    this.instigators.set(id, { id, owner, team, cause, until: tick + INSTIGATOR_TICKS });
  }
  instigator(id: string, tick: number): Instigator | null {
    const entry = this.instigators.get(id);
    return entry && entry.until >= tick ? entry : null;
  }
  /** A per-cause, per-target gate; true the first time within the suppression window. */
  once(key: string, tick: number, ticks = IMPACT_REPEAT_TICKS): boolean {
    if ((this.suppressed.get(key) ?? -1) >= tick) return false;
    this.suppressed.set(key, tick + ticks);
    return true;
  }
  takeImpacts(): PendingImpact[] {
    const impacts = this.impacts;
    this.impacts = [];
    return impacts;
  }
  holding(player: string): string | null {
    return this.holds.get(player)?.id ?? null;
  }
  holderOf(id: string): string | null {
    for (const hold of this.holds.values()) if (hold.id === id) return hold.player;
    return null;
  }
  holdList(): Hold[] {
    return [...this.holds.values()].sort((a, b) => compareIds(a.player, b.player));
  }
  /** Host-validated grab of a nearby loose prop. */
  grab(sim: Simulation, world: PhysicsWorld, player: string, id: string): void {
    const p = sim.players.get(player);
    if (!p) throw new Error("Unknown traveler");
    if (sim.adventure.hero(player).dead) throw new Error("The fallen cannot lift anything");
    if (typeof id !== "string" || !isPropId(id) || !world.has(id))
      throw new Error("Choose a loose prop to grab");
    const motion = world.motionOf(id),
      policy = world.policyOf(id);
    if (!motion.dynamic || motion.frozen || !policy.effective.dynamicProps)
      throw new Error("That prop is fixed in place here");
    if (motion.mass > GRAB_MAX_MASS) throw new Error("Too heavy to lift");
    if (Math.hypot(motion.x - p.x, motion.y - p.y) > GRAB_REACH)
      throw new Error(`Move within ${GRAB_REACH} units to grab it`);
    const holder = this.holderOf(id);
    if (holder && holder !== player) throw new Error("Another traveler is holding that");
    this.holds.set(player, { player, id, since: sim.tick });
    world.setHeld(id, true);
  }
  /** Set down (keeping a little momentum) or throw along the traveler's aim. */
  release(sim: Simulation, world: PhysicsWorld, player: string, throwIt: boolean): string | null {
    const hold = this.holds.get(player);
    if (!hold) return null;
    this.holds.delete(player);
    if (!world.has(hold.id)) return null;
    world.setHeld(hold.id, false);
    const motion = world.motionOf(hold.id);
    if (!motion.dynamic || motion.frozen) return hold.id;
    const p = sim.players.get(player);
    if (!throwIt || !p) {
      world.motion(hold.id, motion.vx * 0.4, motion.vy * 0.4, motion.angularVelocity * 0.4);
      return hold.id;
    }
    const angle = aimAngle(p),
      policy = world.policyOf(hold.id),
      force = sim.adventure.stats(player, sim.tick).force,
      speed =
        THROW_SPEED *
        force *
        policy.effective.impulseStrength *
        Math.min(1, Math.sqrt(3 / Math.max(0.05, motion.mass)));
    world.motion(hold.id, Math.cos(angle) * speed, Math.sin(angle) * speed, 3);
    this.instigate(hold.id, player, "party", "throw", sim.tick);
    return hold.id;
  }
  /** Before the solve: drive held props, then sample fast props for impact detection. */
  beforeStep(sim: Simulation, world: PhysicsWorld): void {
    for (const hold of this.holdList()) {
      const p = sim.players.get(hold.player);
      const valid =
        p &&
        !sim.adventure.hero(hold.player).dead &&
        world.has(hold.id) &&
        world.motionOf(hold.id).dynamic &&
        !world.motionOf(hold.id).frozen &&
        world.policyOf(hold.id).effective.dynamicProps;
      if (!valid || !p) {
        this.holds.delete(hold.player);
        if (world.has(hold.id)) world.setHeld(hold.id, false);
        continue;
      }
      const motion = world.motionOf(hold.id),
        pose = world.pose(hold.id),
        reach =
          pose.shape.kind === "circle"
            ? pose.shape.radius
            : Math.hypot(pose.shape.width, pose.shape.height) / 2;
      if (Math.hypot(motion.x - p.x, motion.y - p.y) > HOLD_BREAK) {
        this.holds.delete(hold.player);
        world.setHeld(hold.id, false);
        continue;
      }
      const angle = aimAngle(p),
        distance = p.radius + reach + 8,
        tx = p.x + Math.cos(angle) * distance,
        ty = p.y + Math.sin(angle) * distance;
      let vx = (tx - motion.x) * 12,
        vy = (ty - motion.y) * 12;
      const speed = Math.hypot(vx, vy);
      if (speed > 600) {
        vx *= 600 / speed;
        vy *= 600 / speed;
      }
      world.motion(hold.id, vx + p.vx, vy + p.vy, motion.angularVelocity * 0.8);
      // A swung prop belongs to its holder, so hitting a monster with it is that hero's hit.
      this.instigate(hold.id, hold.player, "party", "hold", sim.tick);
    }
    this.fast.clear();
    for (const id of world.ids()) {
      if (!isPropId(id)) continue;
      const m = world.motionOf(id);
      if (!m.dynamic || m.frozen) continue;
      if (Math.hypot(m.vx, m.vy) >= IMPACT_MIN_SPEED)
        this.fast.set(id, { vx: m.vx, vy: m.vy, mass: m.mass });
    }
  }
  /** After the solve: turn started contacts of fast props into pending impacts. */
  afterStep(sim: Simulation, world: PhysicsWorld): void {
    const tick = sim.tick;
    for (const event of world.stepStarted)
      for (const [source, target] of [
        [event.a, event.b],
        [event.b, event.a],
      ] as const) {
        const fast = this.fast.get(source);
        if (!fast || !world.has(source) || !world.has(target)) continue;
        const kind = target.startsWith("enemy-")
          ? "enemy"
          : target.startsWith("player-")
            ? "player"
            : isPropId(target)
              ? "prop"
              : null;
        if (!kind) continue;
        const a = world.motionOf(source),
          b = world.motionOf(target),
          dx = b.x - a.x,
          dy = b.y - a.y,
          d = Math.hypot(dx, dy) || 1,
          closing = Math.max(0, (fast.vx * dx + fast.vy * dy) / d);
        if (closing < IMPACT_MIN_SPEED) continue;
        const policy = world.policyOf(source);
        if (!policy.effective.impactDamage) continue;
        const instigator = this.instigator(source, tick),
          owner = instigator?.owner ?? "",
          team: AttackTeam = instigator?.team ?? "world";
        // Team rules: party and unowned props hurt monsters, enemy-launched props hurt heroes,
        // and anything can hurt scenery. A thrown prop never hurts its own side.
        if ((kind === "enemy" && team === "enemy") || (kind === "player" && team !== "enemy"))
          continue;
        if (!this.once(`${source}|${target}`, tick)) continue;
        const damage = impactDamage(fast.mass, closing) * policy.values.impactStrength;
        if (damage <= 0) continue;
        this.impacts.push({
          id: `impact-${tick}-${source}-${target}`,
          tick,
          prop: source,
          target,
          owner,
          team,
          damage: Math.round(damage * 100) / 100,
          closing: Math.round(closing * 10) / 10,
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2,
          angle: Math.atan2(dy, dx),
        });
        // Ownership carries through a chain of struck scenery.
        if (kind === "prop" && instigator) this.instigate(target, owner, team, "impact", tick);
      }
    for (const [id, entry] of [...this.instigators])
      if (entry.until < tick || !world.has(id)) this.instigators.delete(id);
    for (const [key, until] of [...this.suppressed]) if (until < tick) this.suppressed.delete(key);
  }
  /**
   * Physical loot: a launch/settle phase with real bounces off terrain and props. Magnetized
   * gold/experience leaves the solver and flies straight to its traveler; items wait for E.
   * Disabled physics keeps every drop collectible at a reachable resting place.
   */
  syncLoot(
    sim: Simulation,
    world: PhysicsWorld,
    areaAt: (x: number, y: number) => string,
    solidAt: (x: number, y: number, reach: number) => boolean,
  ): void {
    const drops = sim.adventure.state.drops,
      present = new Set(drops.map((d) => lootBodyId(d.id)));
    for (const id of world.ids()) if (id.startsWith("loot-") && !present.has(id)) world.remove(id);
    for (const id of [...this.settled])
      if (!drops.some((d) => d.id === id)) this.settled.delete(id);
    const living = [...sim.players.values()].filter((p) => !sim.adventure.hero(p.id).dead);
    for (const drop of drops) {
      const id = lootBodyId(drop.id),
        areaId = areaAt(drop.x, drop.y),
        magnet =
          drop.kind !== "item" &&
          living.some((p) => Math.hypot(p.x - drop.x, p.y - drop.y) < MAGNET_RANGE),
        physical = !magnet && world.policyAt(areaId, drop.x, drop.y).effective.physicalLoot;
      if (physical && !world.has(id)) {
        world.spawn(lootRecipe(drop, areaId));
        if (drop.born >= sim.tick - 1) {
          const angle = (hash(drop.id, 77, sim.adventure.state.seed) / 4294967296) * Math.PI * 2,
            speed = (drop.kind === "item" ? 45 : 70) + (hash(drop.id, 78) % 60);
          world.motion(id, Math.cos(angle) * speed, Math.sin(angle) * speed);
          this.settled.delete(drop.id);
        }
      } else if (!physical && world.has(id)) world.remove(id);
      if (!physical && !magnet && !this.settled.has(drop.id)) {
        recover(drop, solidAt);
        this.settled.add(drop.id);
      }
    }
  }
  /** Copy solved loot positions back and rescue drops that came to rest somewhere unreachable. */
  afterLoot(
    sim: Simulation,
    world: PhysicsWorld,
    solidAt: (x: number, y: number, reach: number) => boolean,
  ): void {
    for (const drop of sim.adventure.state.drops) {
      const id = lootBodyId(drop.id);
      if (!world.has(id)) continue;
      const m = world.motionOf(id);
      drop.x = m.x;
      drop.y = m.y;
      const resting = Math.hypot(m.vx, m.vy) < 3;
      if (!resting) {
        this.settled.delete(drop.id);
        continue;
      }
      if (this.settled.has(drop.id)) continue;
      const before = { x: drop.x, y: drop.y };
      recover(drop, solidAt);
      if (drop.x !== before.x || drop.y !== before.y) world.place(id, drop.x, drop.y);
      this.settled.add(drop.id);
    }
  }
}
export function aimAngle(p: Player) {
  const ax = p.input.aimX ?? 0,
    ay = p.input.aimY ?? 0;
  return Math.hypot(ax, ay) > 0.01 ? Math.atan2(ay, ax) : p.facing;
}
function lootRecipe(drop: Drop, areaId: string): BodyRecipe {
  return {
    id: lootBodyId(drop.id),
    motion: "dynamic",
    role: "actor",
    actorKind: "loot",
    shape: { kind: "circle", radius: drop.kind === "item" ? 5 : 3 },
    x: drop.x,
    y: drop.y,
    mass: 0.05,
    friction: 0.3,
    restitution: 0.5,
    damping: 2.4,
    areaId,
  };
}
/** Nearest reachable tile center, searched in fixed rings; unchanged when already reachable. */
function recover(drop: Drop, solidAt: (x: number, y: number, reach: number) => boolean): void {
  const reach = drop.kind === "item" ? 5 : 3;
  if (!solidAt(drop.x, drop.y, reach)) return;
  const tx = Math.floor(drop.x / TILE),
    ty = Math.floor(drop.y / TILE);
  for (let r = 1; r <= 24; r++)
    for (let k = 0; k < 8 * r; k++) {
      const side = Math.floor(k / (2 * r)),
        t = (k % (2 * r)) - r;
      const [dx, dy] = side === 0 ? [t, -r] : side === 1 ? [r, t] : side === 2 ? [-t, r] : [-r, -t];
      const x = (tx + dx) * TILE + TILE / 2,
        y = (ty + dy) * TILE + TILE / 2;
      if (Math.abs(x) > WORLD_LIMIT || Math.abs(y) > WORLD_LIMIT) continue;
      if (!solidAt(x, y, reach)) {
        drop.x = x;
        drop.y = y;
        return;
      }
    }
}
