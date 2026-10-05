import { hash } from "../engine/math.ts";
import type { AttackTeam } from "../game/interactions.ts";
import { FAMILIES, type PropFamily, propRecipe, shapeReach } from "./blueprints.ts";
import { type CombatPhysics, isPropId } from "./combat.ts";
import { isMaterial, MATERIALS, type MaterialId } from "./materials.ts";
import { compareIds, policyId } from "./policies.ts";
import type { PhysicsWorld } from "./runtime.ts";
import type { BodyRecipe, ShapeRecipe } from "./types.ts";

/**
 * M08 material reactions and environmental fields, owned by the host's adventure physics.
 *
 * Props and monsters carry material statuses (burning, wet, oiled, charged, a lit fuse, spent).
 * Spills leave ground surfaces (water puddles, oil slicks that can burn). Fields push bodies
 * before each solve. Stimuli (fire, water, oil, shock, blast) are resolved by the rule registry
 * below at the command boundary after each solve; follow-on reactions are delayed events of the
 * same causal chain. Every chain records its owner, depth, the rules it fired and the targets it
 * visited: a rule never applies twice to one target in one chain, strength decays per hop, and
 * fuel, fuses and surfaces are finite, so every chain ends without any frame-rate cutback.
 */
export const STIMULI = ["fire", "water", "oil", "shock", "blast"] as const;
export type Stimulus = (typeof STIMULI)[number];
export interface ReactionRule {
  id: string;
  /** What starts it: a stimulus, contact with a source or surface, a timer or a break. */
  trigger: Stimulus | "contact" | "timer" | "break";
  /** Propagation rules are secondary: chain reactions off suppresses them at their source. */
  propagation: boolean;
  when: string;
  result: string;
  params: Readonly<Record<string, number>>;
}
const rule = (r: ReactionRule) => Object.freeze({ ...r, params: Object.freeze(r.params) });
/** The data-driven registry. The resolver reads every duration, radius and strength from here. */
export const RULES = {
  ignite: rule({
    id: "ignite",
    trigger: "fire",
    propagation: false,
    when: "a flammable material (wood, cloth, vegetation, volatile) or any oil-coated body, dry",
    result: "burning for the material's fuel; oil adds fuel and makes metal and stone burn too",
    params: { creatureTicks: 240, oilFuel: 240 },
  }),
  steam: rule({
    id: "steam",
    trigger: "fire",
    propagation: false,
    when: "a wet body",
    result: "no ignition: the fire boils off part of the wetness instead",
    params: { dries: 300 },
  }),
  extinguish: rule({
    id: "extinguish",
    trigger: "water",
    propagation: false,
    when: "a burning body, a burning slick or a lit fuse",
    result: "the fire or fuse goes out and the body is wet",
    params: {},
  }),
  soak: rule({
    id: "soak",
    trigger: "water",
    propagation: false,
    when: "any body splashed, standing in a puddle or wading in water",
    result: "wet: cannot ignite and conducts shock",
    params: { propTicks: 900, creatureTicks: 600 },
  }),
  coat: rule({
    id: "coat",
    trigger: "oil",
    propagation: false,
    when: "any body splashed by or standing in an oil slick",
    result: "oiled: ignites regardless of material, burns longer and hurts more",
    params: { ticks: 1800 },
  }),
  flare: rule({
    id: "flare",
    trigger: "fire",
    propagation: false,
    when: "an oil slick",
    result: "the slick burns, igniting what stands in it",
    params: { ticks: 420 },
  }),
  spread: rule({
    id: "spread",
    trigger: "contact",
    propagation: true,
    when: "a burning body or slick beside something that can ignite",
    result: "fire reaches the neighbour a moment later",
    params: { interval: 30, reach: 12, delay: 6 },
  }),
  burn: rule({
    id: "burn",
    trigger: "timer",
    propagation: false,
    when: "a burning body",
    result: "periodic fire damage: props lose durability, monsters lose health",
    params: { interval: 30, propDamage: 9, creatureDamage: 6, oilScale: 1.5 },
  }),
  burnout: rule({
    id: "burnout",
    trigger: "timer",
    propagation: false,
    when: "a burning body whose fuel runs out",
    result:
      "dry brush and cloth crumble to ash (destroyed); everything else is charred and never burns again",
    params: {},
  }),
  dry: rule({
    id: "dry",
    trigger: "timer",
    propagation: false,
    when: "a wet or oiled body",
    result: "wetness and oil wear off over their remaining ticks",
    params: {},
  }),
  conduct: rule({
    id: "conduct",
    trigger: "shock",
    propagation: true,
    when: "metal, a wet body or anything standing in a puddle",
    result:
      "charged: the discharge hops to the next conductor within reach, weaker each hop, shocking monsters, cracking glass and ceramic and setting off volatiles it touches",
    params: {
      hop: 72,
      touch: 26,
      decay: 0.85,
      floor: 0.2,
      delay: 3,
      creatureDamage: 24,
      wetScale: 1.3,
      brittleDamage: 34,
      chargedTicks: 40,
    },
  }),
  detonate: rule({
    id: "detonate",
    trigger: "fire",
    propagation: false,
    when: "a volatile container that ignites, is shocked, caught in a blast or broken",
    result:
      "a fuse burns down, then an explosion: radial pressure, blast damage to monsters and props, fire to flammables and sympathetic detonations",
    params: {
      fuse: 50,
      sparkFuse: 8,
      chainFuse: 12,
      radius: 100,
      damage: 42,
      propDamage: 60,
      pressure: 2400,
      pressureTicks: 4,
      fireRadius: 70,
    },
  }),
  spill: rule({
    id: "spill",
    trigger: "break",
    propagation: false,
    when: "a water cask or oil jar breaks",
    result: "a puddle or slick on the ground, splashing everything it covers",
    params: { waterRadius: 46, oilRadius: 38, waterTicks: 1500, oilTicks: 2400 },
  }),
  release: rule({
    id: "release",
    trigger: "break",
    propagation: false,
    when: "a lantern or Stormglass pylon breaks",
    result: "a lantern spills its flame; a pylon releases its stored charge",
    params: { fireRadius: 28, shockRadius: 36 },
  }),
  field: rule({
    id: "field",
    trigger: "contact",
    propagation: false,
    when: "a struck fan, an area mechanic or an explosion",
    result: "a wind, pressure, attraction, repulsion or vortex field pushes the bodies it covers",
    params: { fanStrength: 900, fanTicks: 240, fanLength: 230, fanWidth: 84 },
  }),
  heat: rule({
    id: "heat",
    trigger: "contact",
    propagation: false,
    when: "a body pressed against a lit brazier",
    result: "it ignites after a short contact",
    params: { reach: 6, ticks: 18 },
  }),
} as const;
export type RuleId = keyof typeof RULES;
/** Readable event colours per rule (presentation only). */
export const REACTION_COLORS: Record<string, string> = {
  ignite: "#f39a4a",
  spread: "#f3a85e",
  burn: "#e8763a",
  burnout: "#9a8b78",
  steam: "#d6e8ea",
  extinguish: "#8fd0f0",
  soak: "#6fb7e8",
  coat: "#b9a45a",
  flare: "#ff7a2a",
  conduct: "#a7dfe6",
  detonate: "#ffcf6a",
  spill: "#7cc0ea",
  release: "#f4d98d",
  field: "#b7e8d2",
  heat: "#f6a35a",
  dry: "#c8d4c0",
};
/** Burn time for each material, and how strongly wind catches it. */
export const REACTIVITY: Record<MaterialId, { fuel: number; windage: number }> = {
  wood: { fuel: 540, windage: 1 },
  stone: { fuel: 0, windage: 0.15 },
  metal: { fuel: 0, windage: 0.3 },
  glass: { fuel: 0, windage: 0.6 },
  cloth: { fuel: 240, windage: 1.8 },
  vegetation: { fuel: 300, windage: 1.3 },
  ceramic: { fuel: 0, windage: 0.6 },
  volatile: { fuel: 300, windage: 0.9 },
};
export const isFlammable = (material: MaterialId) => MATERIALS[material].flammability > 0;
/** A volatile container explodes; its debris only burns. */
const isVolatile = (b: {
  material: MaterialId | null;
  family: PropFamily | null;
  creature: boolean;
}) => !b.creature && b.material === "volatile" && b.family !== "debris";
export const isConductive = (material: MaterialId) => MATERIALS[material].conductivity >= 0.5;
/** What each container holds and what each source family releases. */
export const CONTAINERS: Partial<Record<PropFamily, "water" | "oil">> = {
  cask: "water",
  jar: "oil",
};
export const RELEASES: Partial<Record<PropFamily, "fire" | "shock">> = {
  lantern: "fire",
  pylon: "shock",
};
export const FIELD_KINDS = ["wind", "pressure", "attract", "repel", "vortex"] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];
export const FIELDS: Record<FieldKind, string> = {
  wind: "a lane pushing along its direction, scaled by each material's windage, with deterministic gusts",
  pressure: "a short radial burst (explosions): outward, strongest at the centre",
  attract: "a radial pull toward the centre (Gravity Knots)",
  repel: "a radial push away from the centre (Riftstep arrivals)",
  vortex: "a swirl around the centre with a slight inward pull (Slipstream)",
};
export type FieldShape =
  | { kind: "circle"; x: number; y: number; radius: number }
  | { kind: "lane"; x: number; y: number; angle: number; length: number; width: number };
export interface FieldRecipe {
  id: string;
  kind: FieldKind;
  areaId: string;
  shape: FieldShape;
  /** Acceleration (units/s²) at full strength, before falloff, windage and region strength. */
  strength: number;
  /** Remaining ticks; -1 is an authored, permanent field. */
  ticks: number;
  /** Wind gust amplitude (0–1), from the tick; never random. */
  gust: number;
  /** Whether travelers and monsters feel it (props, debris, assemblies and loot always do). */
  actors: boolean;
  owner: string;
  team: AttackTeam;
  /** The authored layout, a struck fan, a mechanic, an explosion or the agent. */
  source: string;
}
export interface ReactionStatus {
  /** Physics body id: a prop or `enemy-<id>`. */
  id: string;
  /** Remaining ticks of each state; 0 is absent. */
  burning: number;
  wet: number;
  oiled: number;
  charged: number;
  /** Volatile containers: ticks until detonation, 0 when unlit. */
  fuse: number;
  /** Ticks of contact with a lit brazier toward ignition. */
  heat: number;
  /** Burnt out (or a spent volatile): never ignites again. */
  charred: boolean;
  /** The chain that last changed this status, its depth and who is responsible. */
  chain: string;
  depth: number;
  owner: string;
  team: AttackTeam;
  since: number;
}
export interface ReactionSurface {
  id: string;
  kind: "water" | "oil";
  areaId: string;
  x: number;
  y: number;
  radius: number;
  /** Remaining ticks before it soaks away. */
  ticks: number;
  /** Oil slicks: remaining burning ticks. */
  burning: number;
  chain: string;
  depth: number;
  owner: string;
  team: AttackTeam;
}
export interface DelayedReaction {
  id: string;
  due: number;
  rule: RuleId;
  stimulus: Stimulus;
  /** A body or `surface:<id>`; absent for an area stimulus. */
  target?: string;
  x: number;
  y: number;
  radius: number;
  strength: number;
  chain: string;
  depth: number;
  /** The body or surface whose reaction queued it (its policy gates propagation). */
  source: string;
  /** The source's area, for its policy once the source itself is gone. */
  areaId: string;
  fromX: number;
  fromY: number;
}
export interface ReactionChain {
  id: string;
  owner: string;
  team: AttackTeam;
  origin: string;
  tick: number;
  last: number;
  /** Distinct rules in the order they first fired. */
  rules: RuleId[];
  /** `rule|target` keys already applied in this chain. */
  visited: string[];
  events: number;
  /** Highest depth reached. */
  depth: number;
}
export interface ReactionEvent {
  id: string;
  tick: number;
  chain: string;
  rule: RuleId;
  target: string;
  owner: string;
  depth: number;
  x: number;
  y: number;
  /** Arcs and spreads: where the reaction came from. */
  fromX: number;
  fromY: number;
  text: string;
}
/** Damage for the adventure to apply through its ordinary hit and scenery paths. */
export interface ReactionDamage {
  id: string;
  tick: number;
  kind: "creature" | "prop" | "area";
  target: string;
  x: number;
  y: number;
  radius: number;
  damage: number;
  cause: "fire" | "shock" | "blast";
  owner: string;
  team: AttackTeam;
  chain: string;
  angle: number;
}
export interface ReactionState {
  statuses: ReactionStatus[];
  surfaces: ReactionSurface[];
  fields: FieldRecipe[];
  delayed: DelayedReaction[];
  chains: ReactionChain[];
  /** Recent events for inspection and drawing (bounded). */
  history: ReactionEvent[];
  /** Events and damage waiting for the adventure's next step. */
  events: ReactionEvent[];
  damage: ReactionDamage[];
  coils: { id: string; readyAt: number }[];
  sequence: number;
}
/** Land archives keep timers relative, so time away never builds a backlog. */
export interface ReactionArchive extends ReactionState {
  archivedAt: number;
}
/** Explicit bounds on saved reaction content; development input bounds, not cutbacks. */
const LIMITS = {
  statuses: 4096,
  surfaces: 512,
  fields: 512,
  delayed: 8192,
  chains: 1024,
  visited: 8192,
  history: 96,
  pending: 2048,
} as const;
export const COIL_COOLDOWN = 120;
/** A sample of an entity the resolver can affect. */
interface Body {
  id: string;
  x: number;
  y: number;
  reach: number;
  creature: boolean;
  material: MaterialId | null;
  family: PropFamily | null;
  dynamic: boolean;
}
/** Hooks into the adventure physics that owns this state. */
export interface ReactionHost {
  tick: number;
  world: PhysicsWorld;
  combat: CombatPhysics;
  /** Shallow or deep water terrain at a point. */
  waterAt(x: number, y: number): boolean;
  /** The area id of a point in the current land. */
  areaAt(x: number, y: number): string;
  /** A burnt-out prop crumbles to ash: removed with a destroyed record. */
  ash(id: string, owner: string, chain: string): void;
}
const round = (value: number) => Math.round(value * 1000) / 1000;
const emptyStatus = (id: string, tick: number): ReactionStatus => ({
  id,
  burning: 0,
  wet: 0,
  oiled: 0,
  charged: 0,
  fuse: 0,
  heat: 0,
  charred: false,
  chain: "",
  depth: 0,
  owner: "",
  team: "world",
  since: tick,
});
const idle = (s: ReactionStatus) =>
  !s.burning && !s.wet && !s.oiled && !s.charged && !s.fuse && !s.heat && !s.charred;
export const surfaceId = (id: string) => `surface:${id}`;

export class ReactionPhysics {
  private statuses = new Map<string, ReactionStatus>();
  private surfaces = new Map<string, ReactionSurface>();
  private fields = new Map<string, FieldRecipe>();
  private delayed: DelayedReaction[] = [];
  private chains = new Map<string, ReactionChain>();
  private visited = new Map<string, Set<string>>();
  private history: ReactionEvent[] = [];
  private events: ReactionEvent[] = [];
  private damage: ReactionDamage[] = [];
  private coils = new Map<string, number>();
  private sequence = 0;

  save(): ReactionState {
    return {
      statuses: [...this.statuses.values()]
        .sort((a, b) => compareIds(a.id, b.id))
        .map((s) => ({ ...s })),
      surfaces: [...this.surfaces.values()]
        .sort((a, b) => compareIds(a.id, b.id))
        .map((s) => ({ ...s })),
      fields: [...this.fields.values()]
        .sort((a, b) => compareIds(a.id, b.id))
        .map((f) => structuredClone(f)),
      delayed: this.delayed.map((d) => ({ ...d })),
      chains: [...this.chains.values()]
        .sort((a, b) => compareIds(a.id, b.id))
        .map((c) => ({ ...c, rules: [...c.rules], visited: [...(this.visited.get(c.id) ?? [])] })),
      history: this.history.map((e) => ({ ...e })),
      events: this.events.map((e) => ({ ...e })),
      damage: this.damage.map((d) => ({ ...d })),
      coils: [...this.coils]
        .sort((a, b) => compareIds(a[0], b[0]))
        .map(([id, readyAt]) => ({ id, readyAt })),
      sequence: this.sequence,
    };
  }
  restore(state: ReactionState | undefined): void {
    this.clear();
    if (!state) return;
    for (const s of state.statuses) this.statuses.set(s.id, { ...s });
    for (const s of state.surfaces) this.surfaces.set(s.id, { ...s });
    for (const f of state.fields) this.fields.set(f.id, structuredClone(f));
    this.delayed = state.delayed.map((d) => ({ ...d }));
    for (const c of state.chains) {
      this.chains.set(c.id, { ...c, rules: [...c.rules], visited: [] });
      this.visited.set(c.id, new Set(c.visited));
    }
    this.history = state.history.map((e) => ({ ...e }));
    this.events = state.events.map((e) => ({ ...e }));
    this.damage = state.damage.map((d) => ({ ...d }));
    for (const c of state.coils) this.coils.set(c.id, c.readyAt);
    this.sequence = state.sequence;
  }
  clear(): void {
    this.statuses.clear();
    this.surfaces.clear();
    this.fields.clear();
    this.delayed = [];
    this.chains.clear();
    this.visited.clear();
    this.history = [];
    this.events = [];
    this.damage = [];
    this.coils.clear();
    this.sequence = 0;
  }
  /** Leave a land: its reactions wait with relative timers; pending output is dropped. */
  archive(tick: number): ReactionArchive {
    const state = this.save();
    // Monsters do not travel with a land; their statuses end with the encounter.
    return {
      ...state,
      statuses: state.statuses.filter((s) => isPropId(s.id)),
      delayed: state.delayed.map((d) => ({ ...d, due: d.due - tick })),
      coils: state.coils.map((c) => ({ ...c, readyAt: Math.max(0, c.readyAt - tick) })),
      events: [],
      damage: [],
      archivedAt: tick,
    };
  }
  /** Return to an archived land: relative timers resume from now. */
  unarchive(archive: ReactionArchive | undefined, tick: number): void {
    if (!archive) {
      this.clear();
      return;
    }
    const { archivedAt: _archivedAt, ...state } = archive;
    this.restore({
      ...state,
      delayed: state.delayed.map((d) => ({ ...d, due: d.due + tick })),
      coils: state.coils.map((c) => ({ ...c, readyAt: c.readyAt + tick })),
    });
  }
  /** Read-only references for drawing (no copies; never mutate). */
  view(): ReactionView {
    return {
      statuses: this.statuses,
      surfaces: [...this.surfaces.values()],
      fields: [...this.fields.values()],
    };
  }
  status(id: string): ReactionStatus | null {
    const s = this.statuses.get(id);
    return s ? { ...s } : null;
  }
  statusList(): ReactionStatus[] {
    return this.save().statuses;
  }
  surfaceList(): ReactionSurface[] {
    return this.save().surfaces;
  }
  fieldList(): FieldRecipe[] {
    return this.save().fields;
  }
  hasField(id: string): boolean {
    return this.fields.has(id);
  }
  take(): ReactionEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }
  takeDamage(): ReactionDamage[] {
    const out = this.damage;
    this.damage = [];
    return out;
  }
  /** A body left the scene (broken, cleaned up, a monster died): forget its status. */
  forget(id: string): void {
    this.statuses.delete(id);
  }
  /** Start a new causal chain. */
  begin(origin: string, owner: string, team: AttackTeam, tick: number): string {
    const id = `c${tick}-${this.sequence++}`;
    this.chains.set(id, {
      id,
      owner,
      team,
      origin,
      tick,
      last: tick,
      rules: [],
      visited: [],
      events: 0,
      depth: 0,
    });
    this.visited.set(id, new Set());
    return id;
  }
  chain(id: string): ReactionChain | null {
    const c = this.chains.get(id);
    return c ? { ...c, rules: [...c.rules], visited: [...(this.visited.get(id) ?? [])] } : null;
  }
  /** A rule's first application to a target within a chain; later ones are deduplicated. */
  private first(chain: string, rule: RuleId, target: string): boolean {
    const set = this.visited.get(chain);
    if (!set) return true;
    const key = `${rule}|${target}`;
    if (set.has(key)) return false;
    if (set.size < LIMITS.visited) set.add(key);
    return true;
  }
  private record(
    tick: number,
    chain: string,
    rule: RuleId,
    target: string,
    depth: number,
    at: { x: number; y: number },
    text: string,
    from: { x: number; y: number } = at,
  ): void {
    const c = this.chains.get(chain);
    if (c) {
      if (!c.rules.includes(rule)) c.rules.push(rule);
      c.events++;
      c.last = tick;
      c.depth = Math.max(c.depth, depth);
    }
    const event: ReactionEvent = {
      id: `${tick}:${this.sequence++}`,
      tick,
      chain,
      rule,
      target,
      owner: c?.owner ?? "",
      depth,
      x: round(at.x),
      y: round(at.y),
      fromX: round(from.x),
      fromY: round(from.y),
      text,
    };
    this.events.push(event);
    if (this.events.length > LIMITS.pending) this.events = this.events.slice(-LIMITS.pending);
    this.history.push(event);
    if (this.history.length > LIMITS.history) this.history = this.history.slice(-LIMITS.history);
  }
  private hurt(entry: Omit<ReactionDamage, "id" | "owner" | "team">): void {
    const c = this.chains.get(entry.chain);
    this.damage.push({
      ...entry,
      id: `${entry.tick}:${this.sequence++}`,
      owner: c?.owner ?? "",
      team: c?.team ?? "world",
      damage: round(entry.damage),
    });
    if (this.damage.length > LIMITS.pending) this.damage = this.damage.slice(-LIMITS.pending);
  }
  private queue(entry: Omit<DelayedReaction, "id">): void {
    if (this.delayed.length >= LIMITS.delayed) return;
    this.delayed.push({ ...entry, id: `${entry.due}:${this.sequence++}` });
  }
  private statusOf(id: string, tick: number): ReactionStatus {
    let s = this.statuses.get(id);
    if (!s) {
      s = emptyStatus(id, tick);
      if (this.statuses.size < LIMITS.statuses) this.statuses.set(id, s);
    }
    return s;
  }
  private own(s: ReactionStatus, chain: string, depth: number, tick: number): void {
    const c = this.chains.get(chain);
    s.chain = chain;
    s.depth = depth;
    s.owner = c?.owner ?? "";
    s.team = c?.team ?? "world";
    s.since = tick;
  }
  addField(field: FieldRecipe): void {
    validateField(field);
    if (!this.fields.has(field.id) && this.fields.size >= LIMITS.fields)
      throw new Error("Too many active fields");
    this.fields.set(field.id, structuredClone(field));
  }
  removeField(id: string): void {
    this.fields.delete(id);
  }

  // ---- Sampling -------------------------------------------------------------------------

  private bodies(world: PhysicsWorld): Body[] {
    const out: Body[] = [];
    for (const id of world.ids()) {
      const creature = id.startsWith("enemy-");
      if (!creature && !isPropId(id)) continue;
      const recipe = world.recipeOf(id);
      if (!creature && !recipe.material) continue;
      const m = world.motionOf(id);
      out.push({
        id,
        x: m.x,
        y: m.y,
        reach: shapeReach(recipe.shape),
        creature,
        material: recipe.material ?? null,
        family: recipe.blueprint?.family ?? null,
        dynamic: recipe.motion === "dynamic",
      });
    }
    return out;
  }
  private policy(world: PhysicsWorld, id: string) {
    return world.policyOf(id).effective;
  }
  private areaOf(host: ReactionHost, id: string, at: { x: number; y: number }): string {
    if (id.startsWith("surface:"))
      return this.surfaces.get(id.slice(8))?.areaId ?? host.areaAt(at.x, at.y);
    return host.world.has(id)
      ? (host.world.recipeOf(id).areaId ?? host.areaAt(at.x, at.y))
      : host.areaAt(at.x, at.y);
  }
  /** Surfaces in id order: map insertion order differs after a restore, sequence ids must not. */
  private sortedSurfaces(): ReactionSurface[] {
    return [...this.surfaces.values()].sort((a, b) => compareIds(a.id, b.id));
  }
  private surfacePolicy(world: PhysicsWorld, s: ReactionSurface) {
    return world.policyAt(s.areaId, s.x, s.y).effective;
  }
  private conductor(b: Body): boolean {
    const s = this.statuses.get(b.id);
    if (s?.wet) return true;
    if (b.material && isConductive(b.material)) return true;
    for (const surface of this.sortedSurfaces())
      if (surface.kind === "water" && Math.hypot(b.x - surface.x, b.y - surface.y) < surface.radius)
        return true;
    return false;
  }

  // ---- Stimuli ---------------------------------------------------------------------------

  /**
   * Apply a stimulus to one body or every body (and surface) within a radius. Primary stimuli
   * start a chain when none is given. Returns the chain id.
   */
  stimulate(
    host: ReactionHost,
    stimulus: Stimulus,
    options: {
      x: number;
      y: number;
      radius?: number;
      target?: string;
      strength?: number;
      owner?: string;
      team?: AttackTeam;
      cause?: string;
      chain?: string;
      depth?: number;
      source?: string;
      skip?: string;
      /** The rule that carried this stimulus (spread) for the record; ignite otherwise. */
      via?: RuleId;
    },
  ): string {
    const chain =
      options.chain ??
      this.begin(
        options.cause ?? stimulus,
        options.owner ?? "",
        options.team ?? "world",
        host.tick,
      );
    const depth = options.depth ?? 0,
      strength = options.strength ?? 1,
      radius = options.radius ?? 0,
      at = { x: options.x, y: options.y };
    if (stimulus === "shock") {
      this.discharge(host, at, options.source ?? "", chain, depth, strength, radius);
      return chain;
    }
    if (stimulus === "blast") {
      this.explode(host, at, options.source ?? "", chain, depth, strength);
      return chain;
    }
    if (options.target?.startsWith("surface:")) {
      const surface = this.surfaces.get(options.target.slice(8));
      if (surface) this.affectSurface(host, stimulus, surface, chain, depth, at);
      return chain;
    }
    const bodies = this.bodies(host.world);
    const targets = options.target
      ? bodies.filter((b) => b.id === options.target)
      : bodies.filter(
          (b) => b.id !== options.skip && Math.hypot(b.x - at.x, b.y - at.y) <= radius + b.reach,
        );
    for (const b of targets)
      this.affect(host, stimulus, b, chain, depth, strength, at, false, options.via);
    if (!options.target)
      for (const s of [...this.surfaces.values()].sort((a, b) => compareIds(a.id, b.id)))
        if (Math.hypot(s.x - at.x, s.y - at.y) <= radius + s.radius)
          this.affectSurface(host, stimulus, s, chain, depth, at);
    return chain;
  }
  /** One stimulus on one body, under that body's region policy. */
  private affect(
    host: ReactionHost,
    stimulus: Exclude<Stimulus, "shock" | "blast">,
    b: Body,
    chain: string,
    depth: number,
    strength: number,
    from: { x: number; y: number },
    quiet = false,
    via?: RuleId,
  ): void {
    const { tick, world } = host;
    if (!world.has(b.id) || !this.policy(world, b.id).materialReactions) return;
    const at = { x: b.x, y: b.y },
      existing = this.statuses.get(b.id);
    if (stimulus === "fire") {
      if (existing?.burning || existing?.charred) return;
      if (existing?.wet) {
        if (!this.first(chain, "steam", b.id)) return;
        existing.wet = Math.max(0, existing.wet - RULES.steam.params.dries);
        this.own(existing, chain, depth, tick);
        this.record(tick, chain, "steam", b.id, depth, at, "steam", from);
        return;
      }
      if (isVolatile(b)) {
        if (existing?.fuse) return;
        if (!this.first(chain, "detonate", b.id)) return;
        const s = this.statusOf(b.id, tick);
        s.fuse = RULES.detonate.params.fuse;
        s.burning = s.fuse;
        this.own(s, chain, depth, tick);
        this.record(tick, chain, "detonate", b.id, depth, at, "detonate:fuse", from);
        return;
      }
      // Heat cracks an oil container: it burns on its contents and bursts into a burning slick.
      if (!b.creature && b.family && CONTAINERS[b.family] === "oil") {
        if (!this.first(chain, "ignite", b.id)) return;
        const s = this.statusOf(b.id, tick);
        s.burning = RULES.ignite.params.oilFuel;
        s.heat = 0;
        this.own(s, chain, depth, tick);
        this.record(tick, chain, "ignite", b.id, depth, at, "ignite:oil", from);
        this.hurt({
          tick,
          kind: "prop",
          target: b.id,
          x: b.x,
          y: b.y,
          radius: 0,
          damage: 1000,
          cause: "fire",
          chain,
          angle: 0,
        });
        return;
      }
      const oiled = existing?.oiled ?? 0;
      const fuel = b.creature
        ? RULES.ignite.params.creatureTicks + (oiled ? RULES.ignite.params.oilFuel : 0)
        : (b.material ? REACTIVITY[b.material].fuel : 0) +
          (oiled ? RULES.ignite.params.oilFuel : 0);
      if (fuel <= 0) return;
      if (!this.first(chain, "ignite", b.id)) return;
      const s = this.statusOf(b.id, tick);
      s.burning = Math.round(fuel * Math.max(0.25, Math.min(2, strength)));
      s.heat = 0;
      this.own(s, chain, depth, tick);
      const rule = via === "spread" ? "spread" : "ignite";
      this.record(tick, chain, rule, b.id, depth, at, `${rule}:${b.material ?? "creature"}`, from);
      return;
    }
    if (stimulus === "water") {
      // Water always puts fire out; deduplication only spares repeated event records.
      const s = existing ?? this.statusOf(b.id, tick);
      if (s.burning || s.fuse) {
        s.burning = 0;
        s.fuse = 0;
        if (this.first(chain, "extinguish", b.id))
          this.record(tick, chain, "extinguish", b.id, depth, at, "extinguish", from);
      }
      const ticks = b.creature ? RULES.soak.params.creatureTicks : RULES.soak.params.propTicks;
      if (!s.wet && !quiet && this.first(chain, "soak", b.id))
        this.record(tick, chain, "soak", b.id, depth, at, "soak", from);
      s.wet = Math.max(s.wet, ticks);
      s.heat = 0;
      s.oiled = Math.max(0, s.oiled - 600);
      this.own(s, chain, depth, tick);
      return;
    }
    // Oil coats anything that is not already burning; a burning body flares.
    const s = existing ?? this.statusOf(b.id, tick);
    if (s.burning) s.burning += RULES.ignite.params.oilFuel;
    else if (!s.oiled && this.first(chain, "coat", b.id))
      this.record(tick, chain, "coat", b.id, depth, at, "coat", from);
    s.oiled = Math.max(s.oiled, RULES.coat.params.ticks);
    this.own(s, chain, depth, tick);
  }
  private affectSurface(
    host: ReactionHost,
    stimulus: Stimulus,
    s: ReactionSurface,
    chain: string,
    depth: number,
    from: { x: number; y: number },
  ): void {
    if (!this.surfacePolicy(host.world, s).materialReactions) return;
    const target = surfaceId(s.id);
    if (stimulus === "fire" && s.kind === "oil" && !s.burning) {
      if (!this.first(chain, "flare", target)) return;
      s.burning = RULES.flare.params.ticks;
      this.ownSurface(s, chain, depth);
      this.record(host.tick, chain, "flare", target, depth, s, "flare", from);
    } else if (stimulus === "water" && s.kind === "oil" && s.burning) {
      s.burning = 0;
      if (this.first(chain, "extinguish", target))
        this.record(host.tick, chain, "extinguish", target, depth, s, "extinguish:slick", from);
    }
  }
  private ownSurface(s: ReactionSurface, chain: string, depth: number): void {
    const c = this.chains.get(chain);
    s.chain = chain;
    s.depth = depth;
    s.owner = c?.owner ?? "";
    s.team = c?.team ?? "world";
  }

  // ---- Breaks, sources and devices ----------------------------------------------------------

  /**
   * A prop just broke. Containers spill, lanterns and pylons release, volatiles detonate (once
   * per chain; a spent volatile never again), and a burning parent's fire carries on in its
   * pieces. `chain` is set when a reaction caused the break.
   */
  broke(
    host: ReactionHost,
    pose: {
      id: string;
      x: number;
      y: number;
      areaId: string;
      material?: MaterialId;
      family: PropFamily;
    },
    pieces: string[],
    attack: { owner: string; team: AttackTeam; cause: string; chain?: string },
  ): void {
    const { world, tick } = host,
      status = this.statuses.get(pose.id);
    this.statuses.delete(pose.id);
    const policy = world.policyAt(pose.areaId, pose.x, pose.y).effective;
    // A burning parent's pieces keep burning on the same fuel (it is the same fire).
    if (status?.burning && !status.fuse)
      for (const id of pieces)
        if (world.has(id)) {
          const s = this.statusOf(id, tick);
          s.burning = Math.max(60, Math.round(status.burning / 2));
          s.chain = status.chain;
          s.depth = status.depth;
          s.owner = status.owner;
          s.team = status.team;
        }
    if (!policy.materialReactions) return;
    const container = CONTAINERS[pose.family],
      release = RELEASES[pose.family];
    const chain =
      attack.chain && this.chains.has(attack.chain)
        ? attack.chain
        : container || release || (pose.material === "volatile" && pose.family !== "debris")
          ? this.begin(attack.cause, attack.owner, attack.team, tick)
          : "";
    if (!chain) return;
    const depth = attack.chain ? (this.chains.get(attack.chain)?.depth ?? 0) : 0;
    if (container) {
      this.spill(host, pose, container, chain, depth);
      // Oil released by fire (a burning jar) lands already alight.
      const slick = this.surfaces.get(`oil-${pose.id}`);
      if (container === "oil" && slick && (attack.cause === "fire" || status?.burning)) {
        slick.burning = RULES.flare.params.ticks;
        this.record(tick, chain, "flare", surfaceId(slick.id), depth, slick, "flare");
      }
    }
    if (release === "fire")
      this.stimulate(host, "fire", {
        x: pose.x,
        y: pose.y,
        radius: RULES.release.params.fireRadius,
        chain,
        depth,
      });
    if (release === "shock")
      this.discharge(host, pose, pose.id, chain, depth, 1, RULES.release.params.shockRadius);
    if (release) this.record(tick, chain, "release", pose.id, depth, pose, `release:${release}`);
    // A lit volatile broken before its fuse ran out still goes off; an unlit one goes off once.
    if (pose.material === "volatile" && pose.family !== "debris" && !status?.charred) {
      if (status?.fuse) this.explode(host, pose, "", status.chain, status.depth, 1, pose.areaId);
      else if (this.first(chain, "detonate", pose.id))
        this.explode(host, pose, "", chain, depth, 1, pose.areaId);
    }
  }
  private spill(
    host: ReactionHost,
    at: { id: string; x: number; y: number; areaId: string },
    kind: "water" | "oil",
    chain: string,
    depth: number,
  ): void {
    const p = RULES.spill.params,
      surface: ReactionSurface = {
        id: `${kind}-${at.id}`,
        kind,
        areaId: at.areaId,
        x: round(at.x),
        y: round(at.y),
        radius: kind === "water" ? p.waterRadius : p.oilRadius,
        ticks: kind === "water" ? p.waterTicks : p.oilTicks,
        burning: 0,
        chain: "",
        depth,
        owner: "",
        team: "world",
      };
    if (this.surfaces.size >= LIMITS.surfaces) return;
    this.ownSurface(surface, chain, depth);
    this.surfaces.set(surface.id, surface);
    this.record(host.tick, chain, "spill", surfaceId(surface.id), depth, at, `spill:${kind}`);
    // The splash: everything the spill lands on is soaked or oiled now (its direct effect).
    this.stimulate(host, kind, {
      x: at.x,
      y: at.y,
      radius: surface.radius,
      chain,
      depth,
      skip: at.id,
    });
  }
  /** A struck storm coil discharges (with a cooldown). */
  strikeCoil(host: ReactionHost, id: string, owner: string, team: AttackTeam): boolean {
    const ready = this.coils.get(id) ?? 0;
    if (ready > host.tick || !this.policy(host.world, id).materialReactions) return false;
    this.coils.set(id, host.tick + COIL_COOLDOWN);
    const chain = this.begin("coil", owner, team, host.tick),
      m = host.world.motionOf(id);
    this.record(host.tick, chain, "conduct", id, 0, m, "discharge");
    this.discharge(host, m, id, chain, 0, 1, 0);
    return true;
  }
  /** A struck fan blows along its facing for a few seconds. */
  strikeFan(host: ReactionHost, id: string, owner: string, team: AttackTeam): void {
    const recipe = host.world.recipeOf(id),
      m = host.world.motionOf(id);
    const angle = recipe.angle ?? 0;
    this.addField({
      id: `fan:${id}`,
      kind: "wind",
      areaId: recipe.areaId ?? "",
      shape: {
        kind: "lane",
        x: round(m.x + Math.cos(angle) * 10),
        y: round(m.y + Math.sin(angle) * 10),
        angle,
        length: RULES.field.params.fanLength,
        width: RULES.field.params.fanWidth,
      },
      strength: RULES.field.params.fanStrength,
      ticks: RULES.field.params.fanTicks,
      gust: 0.15,
      actors: true,
      owner,
      team,
      source: id,
    });
    const chain = this.begin("fan", owner, team, host.tick);
    this.record(host.tick, chain, "field", id, 0, m, "field:fan");
  }

  // ---- Shock -----------------------------------------------------------------------------

  /** Discharge at a point: the source node, then hops through conductors as delayed events. */
  private discharge(
    host: ReactionHost,
    at: { x: number; y: number },
    source: string,
    chain: string,
    depth: number,
    strength: number,
    radius: number,
  ): void {
    const bodies = this.bodies(host.world),
      p = RULES.conduct.params;
    if (source && host.world.has(source)) {
      this.conduct(host, source, at, chain, depth, strength, bodies, true);
      return;
    }
    // A loose discharge (a released pylon, Stormglass, the agent) reaches what it touches.
    for (const b of bodies)
      if (Math.hypot(b.x - at.x, b.y - at.y) <= Math.max(radius, p.touch) + b.reach)
        this.conduct(host, b.id, at, chain, depth, strength, bodies, true);
    for (const s of this.sortedSurfaces())
      if (s.kind === "water" && Math.hypot(s.x - at.x, s.y - at.y) <= radius + s.radius)
        this.conduct(host, surfaceId(s.id), at, chain, depth, strength, bodies, true);
  }
  /** Shock one node, then queue hops to the conductors it reaches. */
  private conduct(
    host: ReactionHost,
    node: string,
    from: { x: number; y: number },
    chain: string,
    depth: number,
    strength: number,
    bodies: Body[],
    origin = false,
  ): void {
    const { world, tick } = host,
      p = RULES.conduct.params;
    if (!this.first(chain, "conduct", node)) return;
    const surface = node.startsWith("surface:") ? this.surfaces.get(node.slice(8)) : undefined;
    const body = surface ? undefined : bodies.find((b) => b.id === node);
    if (!surface && (!body || !world.has(node))) return;
    const at = surface ?? body!;
    const allowed = surface ? this.surfacePolicy(world, surface) : this.policy(world, node);
    if (!allowed.materialReactions) return;
    // Effects at this node.
    if (body) {
      const s = this.statusOf(body.id, tick);
      s.charged = p.chargedTicks;
      this.own(s, chain, depth, tick);
      if (body.creature)
        this.hurt({
          tick,
          kind: "creature",
          target: body.id,
          x: body.x,
          y: body.y,
          radius: 0,
          damage: p.creatureDamage * strength * (s.wet ? p.wetScale : 1),
          cause: "shock",
          chain,
          angle: Math.atan2(body.y - from.y, body.x - from.x),
        });
      else if (body.material === "glass" || body.material === "ceramic")
        this.hurt({
          tick,
          kind: "prop",
          target: body.id,
          x: body.x,
          y: body.y,
          radius: 0,
          damage: p.brittleDamage * strength,
          cause: "shock",
          chain,
          angle: 0,
        });
      else if (isVolatile(body) && !s.charred && !s.fuse) {
        // A spark in a powder keg is a new reaction: propagation from this node.
        if (allowed.chainReactions && this.first(chain, "detonate", body.id)) {
          s.fuse = RULES.detonate.params.sparkFuse;
          s.burning = s.fuse;
          this.own(s, chain, depth + 1, tick);
          this.record(tick, chain, "detonate", body.id, depth + 1, body, "detonate:spark", from);
        }
      }
    }
    this.record(
      tick,
      chain,
      "conduct",
      node,
      depth,
      at,
      origin ? "conduct:source" : "conduct:arc",
      from,
    );
    const next = strength * p.decay;
    if (next < p.floor || !allowed.chainReactions) return;
    if (body && !this.conductor(body) && !origin) return;
    // Neighbours: conductors within a hop, anything touching, and puddles this node stands in.
    const reach = surface ? surface.radius : p.hop;
    for (const other of bodies) {
      if (other.id === node) continue;
      const distance = Math.hypot(other.x - at.x, other.y - at.y);
      const gap = surface ? distance - surface.radius : distance - (body?.reach ?? 0) - other.reach;
      const terminal =
        other.creature ||
        isVolatile(other) ||
        other.material === "glass" ||
        other.material === "ceramic";
      const touches = terminal && gap <= (surface ? 0 : p.touch - 10);
      const conducts = this.conductor(other) && (surface ? gap <= 0 : distance <= reach);
      if (!touches && !conducts) continue;
      if ((this.visited.get(chain) ?? new Set()).has(`conduct|${other.id}`)) continue;
      this.queue({
        due: tick + p.delay,
        rule: "conduct",
        stimulus: "shock",
        target: other.id,
        x: other.x,
        y: other.y,
        radius: 0,
        strength: next,
        chain,
        depth: depth + 1,
        source: node,
        areaId: this.areaOf(host, node, at),
        fromX: at.x,
        fromY: at.y,
      });
    }
    for (const s of this.sortedSurfaces()) {
      if (s.kind !== "water" || surfaceId(s.id) === node) continue;
      const inside = surface
        ? Math.hypot(s.x - surface.x, s.y - surface.y) < s.radius + surface.radius
        : Math.hypot(s.x - at.x, s.y - at.y) < s.radius + (body?.reach ?? 0);
      if (!inside || (this.visited.get(chain) ?? new Set()).has(`conduct|${surfaceId(s.id)}`))
        continue;
      this.queue({
        due: tick + p.delay,
        rule: "conduct",
        stimulus: "shock",
        target: surfaceId(s.id),
        x: s.x,
        y: s.y,
        radius: 0,
        strength: next,
        chain,
        depth: depth + 1,
        source: node,
        areaId: this.areaOf(host, node, at),
        fromX: at.x,
        fromY: at.y,
      });
    }
  }

  // ---- Blast -----------------------------------------------------------------------------

  /** A volatile explodes: pressure, blast damage, then fire and sympathetic detonations. */
  private explode(
    host: ReactionHost,
    at: { x: number; y: number },
    source: string,
    chain: string,
    depth: number,
    strength: number,
    area?: string,
  ): void {
    const { world, tick } = host,
      p = RULES.detonate.params,
      areaId =
        area ??
        (source && world.has(source) ? world.recipeOf(source).areaId : undefined) ??
        host.areaAt(at.x, at.y);
    if (source) {
      const s = this.statusOf(source, tick);
      s.fuse = 0;
      s.burning = 0;
      s.charred = true;
      this.own(s, chain, depth, tick);
    }
    this.record(tick, chain, "detonate", source || "blast", depth, at, "blast");
    this.fields.set(`blast:${chain}:${source || tick}`, {
      id: `blast:${chain}:${source || tick}`,
      kind: "pressure",
      areaId,
      shape: { kind: "circle", x: round(at.x), y: round(at.y), radius: p.radius + 10 },
      strength: p.pressure * strength,
      ticks: p.pressureTicks,
      gust: 0,
      actors: true,
      owner: this.chains.get(chain)?.owner ?? "",
      team: this.chains.get(chain)?.team ?? "world",
      source: source || "blast",
    });
    const bodies = this.bodies(world);
    for (const b of bodies) {
      if (b.id === source) continue;
      const d = Math.hypot(b.x - at.x, b.y - at.y);
      if (d > p.radius + b.reach) continue;
      const falloff = 1 - Math.min(1, d / (p.radius + b.reach)) * 0.5;
      this.hurt({
        tick,
        kind: b.creature ? "creature" : "prop",
        target: b.id,
        x: b.x,
        y: b.y,
        radius: 0,
        damage: (b.creature ? p.damage : p.propDamage) * strength * falloff,
        cause: "blast",
        chain,
        angle: Math.atan2(b.y - at.y, b.x - at.x),
      });
    }
    if (source && world.has(source))
      this.hurt({
        tick,
        kind: "prop",
        target: source,
        x: at.x,
        y: at.y,
        radius: 0,
        damage: 1000,
        cause: "blast",
        chain,
        angle: 0,
      });
    // Fire and sympathetic detonations are propagation from this explosion.
    const allowed =
      source && world.has(source)
        ? this.policy(world, source)
        : world.policyAt(areaId, at.x, at.y).effective;
    if (!allowed.chainReactions) return;
    this.queue({
      due: tick + 2,
      rule: "ignite",
      stimulus: "fire",
      x: at.x,
      y: at.y,
      radius: p.fireRadius,
      strength,
      chain,
      depth: depth + 1,
      source: source || "blast",
      areaId,
      fromX: at.x,
      fromY: at.y,
    });
    for (const b of bodies)
      if (
        isVolatile(b) &&
        b.id !== source &&
        Math.hypot(b.x - at.x, b.y - at.y) <= p.radius + b.reach &&
        !this.statuses.get(b.id)?.charred &&
        this.first(chain, "detonate", b.id)
      ) {
        const s = this.statusOf(b.id, tick);
        s.fuse = p.chainFuse;
        s.burning = s.fuse;
        this.own(s, chain, depth + 1, tick);
        this.record(tick, chain, "detonate", b.id, depth + 1, b, "detonate:sympathetic", at);
      }
  }

  // ---- Per tick --------------------------------------------------------------------------

  /** Before the solve: every active field pushes the bodies it covers. */
  applyFields(host: ReactionHost): void {
    if (!this.fields.size) return;
    const { world, tick, combat } = host,
      dt = 1 / 60;
    const candidates: {
      id: string;
      x: number;
      y: number;
      windage: number;
      kind: string;
      family: PropFamily | null;
    }[] = [];
    for (const id of world.ids()) {
      const prop = isPropId(id),
        loot = id.startsWith("loot-"),
        actor = id.startsWith("enemy-") || id.startsWith("player-");
      if (!prop && !loot && !actor) continue;
      const recipe = world.recipeOf(id);
      if (recipe.motion !== "dynamic") continue;
      const m = world.motionOf(id);
      if (!m.dynamic) continue;
      candidates.push({
        id,
        x: m.x,
        y: m.y,
        windage: recipe.material ? REACTIVITY[recipe.material].windage : loot ? 1.6 : 0.8,
        kind: prop ? "prop" : loot ? "loot" : (recipe.actorKind ?? "monster"),
        family: recipe.blueprint?.family ?? null,
      });
    }
    for (const field of [...this.fields.values()].sort((a, b) => compareIds(a.id, b.id))) {
      if (field.ticks === 0) continue;
      for (const c of candidates) {
        if (!field.actors && (c.kind === "player" || c.kind === "monster" || c.kind === "boss"))
          continue;
        const accel = fieldAcceleration(field, c.x, c.y, tick);
        if (!accel) continue;
        const policy = world.policyOf(c.id).effective;
        if (!policy.environmentalForces || policy.fieldStrength <= 0) continue;
        const scale =
          policy.fieldStrength *
          (field.kind === "wind" ? c.windage : 1) *
          (c.kind === "player" ? 0.5 : c.kind === "boss" ? 0.2 : 1);
        const ax = accel.x * scale * dt,
          ay = accel.y * scale * dt;
        // Wind turns a vane rather than dragging its pinned rotor sideways.
        if (c.family === "vane") {
          if (field.kind === "wind") world.fieldPush(c.id, 0, 0, Math.hypot(ax, ay) * 0.025);
          continue;
        }
        if (world.fieldPush(c.id, ax, ay) && field.owner && c.kind !== "player")
          combat.instigate(c.id, field.owner, field.team, `field:${field.kind}`, tick);
      }
    }
  }
  /** After the solve: contact, timers, surfaces and due events, in a fixed order. */
  update(host: ReactionHost): void {
    const { world, tick } = host,
      bodies = this.bodies(world),
      byId = new Map(bodies.map((b) => [b.id, b]));
    // Forget bodies that left; spent fields end.
    for (const id of [...this.statuses.keys()]) if (!world.has(id)) this.statuses.delete(id);
    for (const [id, field] of [...this.fields]) {
      if (field.ticks > 0) field.ticks--;
      if (field.ticks === 0) this.fields.delete(id);
    }
    // Wading: water terrain soaks and puts out what stands in it (every 6 ticks).
    if (tick % 6 === 0)
      for (const b of bodies) {
        if (!b.dynamic || !host.waterAt(b.x, b.y)) continue;
        if (!this.policy(world, b.id).materialReactions) continue;
        const s = this.statuses.get(b.id);
        if (s && !s.burning && !s.fuse) {
          // Standing in water keeps a body soaked without a new chain (or event) every check.
          s.wet = Math.max(
            s.wet,
            b.creature ? RULES.soak.params.creatureTicks : RULES.soak.params.propTicks,
          );
          continue;
        }
        const chain = this.begin("water", "", "world", tick);
        this.affect(host, "water", b, chain, 0, 1, b, true);
      }
    // Lit braziers ignite whatever is pressed against them (contact builds heat over a moment).
    const touching = new Map<string, Body>();
    for (const brazier of bodies) {
      if (brazier.family !== "brazier" || !this.policy(world, brazier.id).materialReactions)
        continue;
      for (const b of bodies)
        if (
          b.id !== brazier.id &&
          !touching.has(b.id) &&
          Math.hypot(b.x - brazier.x, b.y - brazier.y) - b.reach - brazier.reach <=
            RULES.heat.params.reach
        )
          touching.set(b.id, brazier);
    }
    for (const s of this.statuses.values()) if (s.heat && !touching.has(s.id)) s.heat = 0;
    // Oil that runs against a lit brazier catches at once.
    for (const brazier of bodies) {
      if (brazier.family !== "brazier" || !this.policy(world, brazier.id).materialReactions)
        continue;
      for (const slick of this.sortedSurfaces())
        if (
          slick.kind === "oil" &&
          !slick.burning &&
          Math.hypot(slick.x - brazier.x, slick.y - brazier.y) <= slick.radius + brazier.reach
        ) {
          const chain = this.begin("brazier", slick.owner, slick.team, tick);
          this.affectSurface(host, "fire", slick, chain, 0, brazier);
        }
    }
    for (const [id, brazier] of [...touching].sort((a, b) => compareIds(a[0], b[0]))) {
      const b = byId.get(id)!,
        s = this.statuses.get(id);
      if (s?.burning || s?.charred || !this.policy(world, id).materialReactions) continue;
      const status = this.statusOf(id, tick);
      status.heat++;
      if (status.heat < RULES.heat.params.ticks) continue;
      status.heat = 0;
      const by = host.combat.instigator(id, tick);
      const chain = this.begin("brazier", by?.owner ?? "", by?.team ?? "world", tick);
      this.record(tick, chain, "heat", id, 0, b, "heat", brazier);
      this.affect(host, "fire", b, chain, 0, 1, brazier);
    }
    // Statuses: paused wherever material reactions are off (their timers wait).
    for (const id of [...this.statuses.keys()].sort(compareIds)) {
      const s = this.statuses.get(id)!,
        b = byId.get(id);
      if (!b) continue;
      const policy = this.policy(world, id);
      if (!policy.materialReactions) continue;
      if (s.wet) s.wet--;
      if (s.oiled) s.oiled--;
      if (s.charged) s.charged--;
      if (s.fuse) {
        s.fuse--;
        s.burning = s.fuse;
        if (s.fuse === 0) {
          this.statuses.set(id, s);
          this.explode(host, b, id, s.chain, s.depth, 1);
          continue;
        }
      } else if (s.burning) {
        s.burning--;
        const phase = (tick + (hash(id.length, id.charCodeAt(id.length - 1)) % 30)) % 30;
        if (phase === 0) this.burnPulse(host, b, s, bodies, policy.chainReactions);
        if (s.burning === 0) {
          // Fixed brush and cloth crumble to ash where destruction is allowed; the rest chars.
          const ash =
            !b.creature &&
            (b.material === "vegetation" || b.material === "cloth") &&
            world.recipeOf(id).motion === "fixed" &&
            FAMILIES[b.family!]?.toughness > 0 &&
            policy.destruction;
          this.record(
            tick,
            s.chain,
            "burnout",
            id,
            s.depth,
            b,
            b.creature ? "burnout" : ash ? "burnout:ash" : "burnout:char",
          );
          if (ash) {
            host.ash(id, s.owner, s.chain);
            this.statuses.delete(id);
            continue;
          }
          s.charred = !b.creature;
        }
      }
      if (idle(s)) this.statuses.delete(id);
    }
    // Surfaces: soak or oil what stands in them; burning slicks spread fire.
    for (const surface of [...this.surfaces.values()].sort((a, b) => compareIds(a.id, b.id))) {
      const policy = this.surfacePolicy(world, surface);
      if (!policy.materialReactions) continue;
      surface.ticks--;
      if (surface.burning) surface.burning--;
      if (surface.ticks <= 0) {
        this.surfaces.delete(surface.id);
        continue;
      }
      if (tick % 15 !== 0) continue;
      if (surface.kind === "water")
        for (const other of this.sortedSurfaces())
          if (
            other.kind === "oil" &&
            other.burning &&
            Math.hypot(other.x - surface.x, other.y - surface.y) < other.radius + surface.radius
          ) {
            other.burning = 0;
            this.record(
              tick,
              surface.chain,
              "extinguish",
              surfaceId(other.id),
              surface.depth,
              other,
              "extinguish:slick",
              surface,
            );
          }
      for (const b of bodies) {
        if (Math.hypot(b.x - surface.x, b.y - surface.y) > surface.radius) continue;
        if (surface.kind === "water" || !surface.burning)
          this.affect(
            host,
            surface.kind,
            b,
            surface.chain || this.begin(surface.kind, "", "world", tick),
            surface.depth,
            1,
            surface,
          );
        else if (policy.chainReactions && !this.statuses.get(b.id)?.burning)
          this.affect(host, "fire", b, surface.chain, surface.depth + 1, 1, surface);
      }
    }
    // Due events, oldest first; propagation whose source is now off is dropped, not saved up.
    const due = this.delayed
      .filter((d) => d.due <= tick)
      .sort((a, b) => a.due - b.due || compareIds(a.id, b.id));
    if (due.length) {
      const keep = new Set(due.map((d) => d.id));
      this.delayed = this.delayed.filter((d) => !keep.has(d.id));
    }
    for (const d of due) {
      if (!this.eligible(world, d)) continue;
      // A target paused by its region keeps its pending effect; a vanished target drops it.
      if (d.target) {
        const surface = d.target.startsWith("surface:")
          ? this.surfaces.get(d.target.slice(8))
          : null;
        const exists = surface ? true : !d.target.startsWith("surface:") && world.has(d.target);
        if (!exists) continue;
        const allowed = surface
          ? this.surfacePolicy(world, surface).materialReactions
          : this.policy(world, d.target).materialReactions;
        if (!allowed) {
          // Keep the same event (and id) waiting; nothing new is generated while paused.
          this.delayed.push({ ...d, due: tick + 1 });
          continue;
        }
      }
      if (d.rule === "conduct")
        this.conduct(
          host,
          d.target!,
          { x: d.fromX, y: d.fromY },
          d.chain,
          d.depth,
          d.strength,
          bodies,
        );
      else if (d.stimulus === "fire" || d.stimulus === "water" || d.stimulus === "oil")
        this.stimulate(host, d.stimulus, {
          x: d.x,
          y: d.y,
          radius: d.radius,
          ...(d.target ? { target: d.target } : {}),
          chain: d.chain,
          depth: d.depth,
          strength: d.strength,
          via: d.rule,
        });
    }
    // Every tick: drop propagation queued from a source whose chain reactions are now off.
    this.delayed = this.delayed.filter((d) => this.eligible(world, d));
    this.retire(tick);
  }
  /** Propagation is eligible only while its source permits chain reactions. */
  private eligible(world: PhysicsWorld, d: DelayedReaction): boolean {
    if (d.depth === 0) return true;
    if (d.source.startsWith("surface:")) {
      const s = this.surfaces.get(d.source.slice(8));
      return !s || this.surfacePolicy(world, s).chainReactions;
    }
    if (world.has(d.source)) return this.policy(world, d.source).chainReactions;
    return world.policyAt(d.areaId, d.fromX, d.fromY).effective.chainReactions;
  }
  private burnPulse(
    host: ReactionHost,
    b: Body,
    s: ReactionStatus,
    bodies: Body[],
    propagate: boolean,
  ): void {
    const { tick } = host,
      p = RULES.burn.params,
      scale = s.oiled ? p.oilScale : 1;
    if (b.creature)
      this.hurt({
        tick,
        kind: "creature",
        target: b.id,
        x: b.x,
        y: b.y,
        radius: 0,
        damage: p.creatureDamage * scale,
        cause: "fire",
        chain: s.chain,
        angle: 0,
      });
    else if (FAMILIES[b.family!]?.toughness > 0)
      this.hurt({
        tick,
        kind: "prop",
        target: b.id,
        x: b.x,
        y: b.y,
        radius: 0,
        damage: p.propDamage * scale,
        cause: "fire",
        chain: s.chain,
        angle: 0,
      });
    if (!propagate) return;
    const reach = RULES.spread.params.reach;
    for (const other of bodies) {
      if (other.id === b.id) continue;
      const gap = Math.hypot(other.x - b.x, other.y - b.y) - other.reach - b.reach;
      if (gap > reach) continue;
      const o = this.statuses.get(other.id);
      if (o?.burning || o?.charred) continue;
      if (!other.creature && other.material && !isFlammable(other.material) && !o?.oiled) continue;
      if ((this.visited.get(s.chain) ?? new Set()).has(`ignite|${other.id}`)) continue;
      if (
        this.delayed.some(
          (d) => d.rule === "spread" && d.chain === s.chain && d.target === other.id,
        )
      )
        continue;
      this.queue({
        due: tick + RULES.spread.params.delay,
        rule: "spread",
        stimulus: "fire",
        target: other.id,
        x: other.x,
        y: other.y,
        radius: 0,
        strength: 1,
        chain: s.chain,
        depth: s.depth + 1,
        source: b.id,
        areaId: this.areaOf(host, b.id, b),
        fromX: b.x,
        fromY: b.y,
      });
    }
    for (const surface of this.sortedSurfaces())
      if (
        surface.kind === "oil" &&
        !surface.burning &&
        Math.hypot(surface.x - b.x, surface.y - b.y) <= surface.radius + b.reach
      )
        this.queue({
          due: tick + RULES.spread.params.delay,
          rule: "spread",
          stimulus: "fire",
          target: surfaceId(surface.id),
          x: surface.x,
          y: surface.y,
          radius: 0,
          strength: 1,
          chain: s.chain,
          depth: s.depth + 1,
          source: b.id,
          areaId: this.areaOf(host, b.id, b),
          fromX: b.x,
          fromY: b.y,
        });
  }
  /** Chains with nothing left referencing them become history (the latest few are kept). */
  private retire(tick: number): void {
    if (this.chains.size <= 24) return;
    const live = new Set<string>();
    for (const s of this.statuses.values()) live.add(s.chain);
    for (const s of this.surfaces.values()) live.add(s.chain);
    for (const d of this.delayed) live.add(d.chain);
    const finished = [...this.chains.values()]
      .filter((c) => !live.has(c.id) && c.last < tick)
      .sort((a, b) => a.last - b.last || compareIds(a.id, b.id));
    for (const c of finished.slice(0, Math.max(0, this.chains.size - 24))) {
      this.chains.delete(c.id);
      this.visited.delete(c.id);
    }
    if (this.chains.size > LIMITS.chains)
      for (const c of [...this.chains.values()]
        .sort((a, b) => a.last - b.last || compareIds(a.id, b.id))
        .slice(0, this.chains.size - LIMITS.chains)) {
        this.chains.delete(c.id);
        this.visited.delete(c.id);
      }
  }
}

/** Acceleration (units/s²) a field gives at a point, before material and region scaling. */
export function fieldAcceleration(
  field: FieldRecipe,
  x: number,
  y: number,
  tick: number,
): { x: number; y: number } | null {
  const shape = field.shape;
  if (shape.kind === "lane") {
    const dx = x - shape.x,
      dy = y - shape.y,
      cos = Math.cos(shape.angle),
      sin = Math.sin(shape.angle),
      along = dx * cos + dy * sin,
      across = -dx * sin + dy * cos;
    if (along < 0 || along > shape.length || Math.abs(across) > shape.width / 2) return null;
    const gust = 1 + field.gust * Math.sin(tick * 0.05 + shape.x * 0.01),
      strength = field.strength * gust * (1 - 0.5 * (along / shape.length));
    return { x: cos * strength, y: sin * strength };
  }
  const dx = x - shape.x,
    dy = y - shape.y,
    d = Math.hypot(dx, dy);
  if (d > shape.radius || d < 0.001) return null;
  const nx = dx / d,
    ny = dy / d,
    near = 1 - d / shape.radius;
  if (field.kind === "pressure" || field.kind === "repel")
    return { x: nx * field.strength * near, y: ny * field.strength * near };
  if (field.kind === "attract") {
    const pull = field.strength * (0.4 + 0.6 * near);
    return { x: -nx * pull, y: -ny * pull };
  }
  if (field.kind === "vortex") {
    const swirl = field.strength * near;
    return { x: -ny * swirl - nx * swirl * 0.35, y: nx * swirl - ny * swirl * 0.35 };
  }
  const strength = field.strength * near;
  return { x: nx * strength, y: ny * strength };
}

/** The authored reaction yard, relative to an area's centre: off the entry, ring and portal. */
export const REACTION_LAYOUT: readonly {
  family: PropFamily;
  n: number;
  dx: number;
  dy: number;
  angle?: number;
  material?: MaterialId;
}[] = [
  { family: "brazier", n: 0, dx: 140, dy: 104 },
  { family: "jar", n: 0, dx: 118, dy: 134 },
  { family: "jar", n: 1, dx: 134, dy: 148 },
  { family: "brush", n: 0, dx: 168, dy: 118, angle: 0.45 },
  { family: "brush", n: 1, dx: 183, dy: 125, angle: 0.45 },
  { family: "brush", n: 2, dx: 198, dy: 132, angle: 0.45 },
  { family: "brush", n: 3, dx: 213, dy: 139, angle: 0.45 },
  { family: "brush", n: 4, dx: 228, dy: 146, angle: 0.45 },
  { family: "barrel", n: 2, dx: 250, dy: 156, material: "volatile" },
  { family: "cask", n: 0, dx: 196, dy: 176 },
  { family: "cask", n: 1, dx: 214, dy: 188 },
  { family: "rod", n: 0, dx: 240, dy: 178 },
  { family: "rod", n: 1, dx: 264, dy: 186 },
  { family: "coil", n: 0, dx: 290, dy: 190 },
  { family: "fan", n: 0, dx: 92, dy: 186, angle: -0.15 },
];
/** The yard's props and the area's authored wind lane over the meadow vane. */
export function areaReactions(
  area: { index: number; x: number; y: number },
  palette: number,
  blocked: (x: number, y: number, reach: number) => boolean = () => false,
): { props: BodyRecipe[]; fields: FieldRecipe[] } {
  const props = REACTION_LAYOUT.map((p) => {
    const reach = shapeReach(FAMILIES[p.family].shape);
    let x = area.x + p.dx,
      y = area.y + p.dy;
    // A spot over solid terrain shifts in fixed steps along the yard, never randomly.
    for (let k = 1; k <= 8 && blocked(x, y, reach); k++) {
      x = round(area.x + p.dx + ((k + 1) >> 1) * 9 * (k % 2 ? 1 : -1));
      y = round(area.y + p.dy - ((k + 1) >> 1) * 6);
    }
    return propRecipe(
      `prop-${p.family}-${area.index}-${p.n}`,
      p.family,
      palette,
      x,
      y,
      `area-${area.index}`,
      {
        angle: p.angle ?? 0,
        ...(p.material ? { material: p.material } : {}),
      },
    );
  });
  const fields: FieldRecipe[] = [
    {
      id: `wind-${area.index}`,
      kind: "wind",
      areaId: `area-${area.index}`,
      shape: { kind: "lane", x: area.x + 30, y: area.y - 296, angle: 0, length: 110, width: 60 },
      strength: 150,
      ticks: -1,
      gust: 0.6,
      actors: true,
      owner: "",
      team: "world",
      source: "authored",
    },
  ];
  return { props, fields };
}

// ---- Validation --------------------------------------------------------------------------

const TEAMS = ["party", "enemy", "world"];
function plain(
  value: unknown,
  keys: string[],
  name: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Invalid ${name}`);
  const actual = Object.keys(value);
  if (actual.some((k) => !keys.includes(k))) throw new Error(`Unknown ${name} field`);
}
function int(value: unknown, name: string, min = 0, max = 2 ** 31): void {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max)
    throw new Error(`Invalid ${name}`);
}
function num(value: unknown, name: string, min: number, max: number): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`Invalid ${name}`);
}
function str(value: unknown, name: string, max = 200): void {
  if (typeof value !== "string" || value.length > max) throw new Error(`Invalid ${name}`);
}
export function validateField(f: FieldRecipe): void {
  plain(
    f,
    [
      "id",
      "kind",
      "areaId",
      "shape",
      "strength",
      "ticks",
      "gust",
      "actors",
      "owner",
      "team",
      "source",
    ],
    "field",
  );
  if (typeof f.id !== "string" || !/^[\w:.-]{1,200}$/.test(f.id))
    throw new Error("Invalid field id");
  if (!(FIELD_KINDS as readonly string[]).includes(f.kind)) throw new Error("Invalid field kind");
  if (f.areaId !== "") policyId(f.areaId);
  const s = f.shape;
  if (s?.kind === "circle") {
    plain(s, ["kind", "x", "y", "radius"], "field shape");
    num(s.x, "field x", -1e6, 1e6);
    num(s.y, "field y", -1e6, 1e6);
    num(s.radius, "field radius", 1, 2000);
  } else if (s?.kind === "lane") {
    plain(s, ["kind", "x", "y", "angle", "length", "width"], "field shape");
    num(s.x, "field x", -1e6, 1e6);
    num(s.y, "field y", -1e6, 1e6);
    num(s.angle, "field angle", -100, 100);
    num(s.length, "field length", 1, 4000);
    num(s.width, "field width", 1, 2000);
  } else throw new Error("Invalid field shape");
  num(f.strength, "field strength", 0, 20000);
  if (f.ticks !== -1) int(f.ticks, "field ticks", 0, 1_000_000);
  num(f.gust, "field gust", 0, 1);
  if (typeof f.actors !== "boolean") throw new Error("Invalid field actors");
  str(f.owner, "field owner", 80);
  if (!TEAMS.includes(f.team)) throw new Error("Invalid field team");
  str(f.source, "field source");
}
export function validateReactions(state: ReactionState | ReactionArchive, archived = false): void {
  plain(
    state,
    [
      "statuses",
      "surfaces",
      "fields",
      "delayed",
      "chains",
      "history",
      "events",
      "damage",
      "coils",
      "sequence",
      ...(archived ? ["archivedAt"] : []),
    ],
    "reaction state",
  );
  for (const key of [
    "statuses",
    "surfaces",
    "fields",
    "delayed",
    "chains",
    "history",
    "events",
    "damage",
    "coils",
  ])
    if (!Array.isArray((state as unknown as Record<string, unknown>)[key]))
      throw new Error(`Invalid reaction ${key}`);
  if (
    state.statuses.length > LIMITS.statuses ||
    state.surfaces.length > LIMITS.surfaces ||
    state.fields.length > LIMITS.fields ||
    state.delayed.length > LIMITS.delayed ||
    state.chains.length > LIMITS.chains ||
    state.history.length > LIMITS.history ||
    state.events.length > LIMITS.pending ||
    state.damage.length > LIMITS.pending
  )
    throw new Error("Reaction state exceeds its bounds");
  int(state.sequence, "reaction sequence");
  if (archived) int((state as ReactionArchive).archivedAt, "reaction archive tick");
  const unique = (ids: string[], name: string) => {
    if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${name}`);
    for (let i = 1; i < ids.length; i++)
      if (compareIds(ids[i - 1], ids[i]) > 0) throw new Error(`Unsorted ${name}`);
  };
  for (const s of state.statuses) {
    plain(
      s,
      [
        "id",
        "burning",
        "wet",
        "oiled",
        "charged",
        "fuse",
        "heat",
        "charred",
        "chain",
        "depth",
        "owner",
        "team",
        "since",
      ],
      "reaction status",
    );
    str(s.id, "status id");
    for (const k of [
      "burning",
      "wet",
      "oiled",
      "charged",
      "fuse",
      "heat",
      "depth",
      "since",
    ] as const)
      int(s[k], `status ${k}`, 0, 10_000_000);
    if (typeof s.charred !== "boolean") throw new Error("Invalid status charred");
    str(s.chain, "status chain");
    str(s.owner, "status owner", 80);
    if (!TEAMS.includes(s.team)) throw new Error("Invalid status team");
  }
  unique(
    state.statuses.map((s) => s.id),
    "reaction status",
  );
  for (const s of state.surfaces) {
    plain(
      s,
      [
        "id",
        "kind",
        "areaId",
        "x",
        "y",
        "radius",
        "ticks",
        "burning",
        "chain",
        "depth",
        "owner",
        "team",
      ],
      "reaction surface",
    );
    str(s.id, "surface id");
    if (s.kind !== "water" && s.kind !== "oil") throw new Error("Invalid surface kind");
    if (s.areaId !== "") policyId(s.areaId);
    num(s.x, "surface x", -1e6, 1e6);
    num(s.y, "surface y", -1e6, 1e6);
    num(s.radius, "surface radius", 1, 500);
    for (const k of ["ticks", "burning", "depth"] as const)
      int(s[k], `surface ${k}`, 0, 10_000_000);
    str(s.chain, "surface chain");
    str(s.owner, "surface owner", 80);
    if (!TEAMS.includes(s.team)) throw new Error("Invalid surface team");
  }
  unique(
    state.surfaces.map((s) => s.id),
    "reaction surface",
  );
  for (const f of state.fields) validateField(f);
  unique(
    state.fields.map((f) => f.id),
    "reaction field",
  );
  const rules = Object.keys(RULES);
  for (const d of state.delayed) {
    plain(
      d,
      [
        "id",
        "due",
        "rule",
        "stimulus",
        "target",
        "x",
        "y",
        "radius",
        "strength",
        "chain",
        "depth",
        "source",
        "areaId",
        "fromX",
        "fromY",
      ],
      "delayed reaction",
    );
    str(d.id, "delayed id");
    int(d.due, "delayed due", archived ? -10_000_000 : 0, 1e12);
    if (!rules.includes(d.rule)) throw new Error("Invalid delayed rule");
    if (!(STIMULI as readonly string[]).includes(d.stimulus)) throw new Error("Invalid stimulus");
    if (d.target !== undefined) str(d.target, "delayed target");
    for (const k of ["x", "y", "fromX", "fromY"] as const) num(d[k], `delayed ${k}`, -1e6, 1e6);
    num(d.radius, "delayed radius", 0, 2000);
    num(d.strength, "delayed strength", 0, 10);
    str(d.chain, "delayed chain");
    int(d.depth, "delayed depth", 0, 100_000);
    str(d.source, "delayed source");
    if (d.areaId !== "") policyId(d.areaId);
  }
  const chainIds = new Set<string>();
  for (const c of state.chains) {
    plain(
      c,
      ["id", "owner", "team", "origin", "tick", "last", "rules", "visited", "events", "depth"],
      "reaction chain",
    );
    str(c.id, "chain id");
    if (chainIds.has(c.id)) throw new Error("Duplicate reaction chain");
    chainIds.add(c.id);
    str(c.owner, "chain owner", 80);
    if (!TEAMS.includes(c.team)) throw new Error("Invalid chain team");
    str(c.origin, "chain origin");
    int(c.tick, "chain tick");
    int(c.last, "chain last");
    int(c.events, "chain events");
    int(c.depth, "chain depth", 0, 100_000);
    if (!Array.isArray(c.rules) || c.rules.some((r) => !rules.includes(r)))
      throw new Error("Invalid chain rules");
    if (
      !Array.isArray(c.visited) ||
      c.visited.length > LIMITS.visited ||
      c.visited.some((v) => typeof v !== "string")
    )
      throw new Error("Invalid chain visited targets");
  }
  for (const e of [...state.history, ...state.events]) {
    plain(
      e,
      [
        "id",
        "tick",
        "chain",
        "rule",
        "target",
        "owner",
        "depth",
        "x",
        "y",
        "fromX",
        "fromY",
        "text",
      ],
      "reaction event",
    );
    if (!rules.includes(e.rule)) throw new Error("Invalid reaction event rule");
    int(e.tick, "event tick");
    int(e.depth, "event depth", 0, 100_000);
    for (const k of ["x", "y", "fromX", "fromY"] as const) num(e[k], `event ${k}`, -1e6, 1e6);
    for (const k of ["id", "chain", "target", "owner", "text"] as const) str(e[k], `event ${k}`);
  }
  for (const d of state.damage) {
    plain(
      d,
      [
        "id",
        "tick",
        "kind",
        "target",
        "x",
        "y",
        "radius",
        "damage",
        "cause",
        "owner",
        "team",
        "chain",
        "angle",
      ],
      "reaction damage",
    );
    if (!["creature", "prop", "area"].includes(d.kind)) throw new Error("Invalid damage kind");
    if (!["fire", "shock", "blast"].includes(d.cause)) throw new Error("Invalid damage cause");
    if (!TEAMS.includes(d.team)) throw new Error("Invalid damage team");
    int(d.tick, "damage tick");
    for (const k of ["x", "y", "angle"] as const) num(d[k], `damage ${k}`, -1e6, 1e6);
    num(d.radius, "damage radius", 0, 2000);
    num(d.damage, "damage amount", 0, 100_000);
    for (const k of ["id", "target", "owner", "chain"] as const) str(d[k], `damage ${k}`);
  }
  for (const c of state.coils) {
    plain(c, ["id", "readyAt"], "coil");
    str(c.id, "coil id");
    int(c.readyAt, "coil ready tick", 0, 1e12);
  }
  unique(
    state.coils.map((c) => c.id),
    "coil",
  );
}
/** Reproducible registry export for agents, tools and documentation. */
export function reactionExport() {
  return {
    version: 1,
    stimuli: [...STIMULI],
    rules: structuredClone(RULES),
    materials: Object.fromEntries(
      Object.entries(REACTIVITY).map(([id, r]) => [
        id,
        {
          ...r,
          flammable: isFlammable(id as MaterialId),
          conductive: isConductive(id as MaterialId),
        },
      ]),
    ),
    containers: { ...CONTAINERS },
    releases: { ...RELEASES },
    fields: { ...FIELDS },
    layout: structuredClone(REACTION_LAYOUT),
    chains:
      "a chain records its owner, the rules it fired and the targets they reached; a rule applies to a target once per chain, strength decays per hop, and fuel, fuses and surfaces are finite",
    policies:
      "materialReactions off pauses every status and surface timer there and blocks new statuses; chainReactions off drops propagation queued from there (never saved up); environmentalForces off and fieldStrength 0 stop field pushes on bodies there",
  };
}
export interface ReactionView {
  statuses: ReadonlyMap<string, ReactionStatus>;
  surfaces: readonly ReactionSurface[];
  fields: readonly FieldRecipe[];
}
const replicaViews = new WeakMap<ReactionState, ReactionView>();
/** Statuses, surfaces and fields for drawing from a received scene (cached per snapshot). */
export function reactionView(state: ReactionState | undefined): ReactionView {
  if (!state) return { statuses: new Map(), surfaces: [], fields: [] };
  let view = replicaViews.get(state);
  if (!view) {
    view = {
      statuses: new Map(state.statuses.map((s) => [s.id, s])),
      surfaces: state.surfaces,
      fields: state.fields,
    };
    replicaViews.set(state, view);
  }
  return view;
}
export const isReactionMaterial = isMaterial;
export type { ShapeRecipe };
