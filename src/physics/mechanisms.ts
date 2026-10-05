import { propRecipe } from "./blueprints.ts";
import type { CombatPhysics } from "./combat.ts";
import { compareIds } from "./policies.ts";
import { assemblyParts, jointAnchors, type PhysicsWorld } from "./runtime.ts";
import type {
  AssemblyKind,
  AssemblyRecipe,
  BodyPose,
  BodyRecipe,
  JointEntry,
  JointRecipe,
  PhysicsSnapshot,
} from "./types.ts";

/**
 * M07 jointed mechanisms. Each area of a land carries six assemblies north and west of its
 * clearing, away from the entry, the exit portal and the mechanic ring: a penned swinging gate,
 * a chained iron ball, a vine tether with a seed pod, a sprung launcher, a wind vane and a plank
 * causeway over the area's creek. Required travel never crosses one of them.
 */
export type MechanismKind = Exclude<AssemblyKind, "lab">;
export interface MechanismBlueprint {
  recipe: AssemblyRecipe;
  joints: JointRecipe[];
  bodies: BodyRecipe[];
}
export interface MechanismInfo {
  name: string;
  summary: string;
  /** "none": physical only. Otherwise the authored gameplay event this mechanism emits. */
  event: AssemblyRecipe["event"];
  joints: string;
}
export const MECHANISMS: Record<MechanismKind, MechanismInfo> = {
  gate: {
    name: "Swinging gate",
    summary:
      "A leaf on a sprung hinge closes a reward pen. Pushed past 83° it latches open (authored event); pushed back it swings shut.",
    event: "latch",
    joints: "hinge ±1.9 rad with a return spring (6/s², 4/s); breaks at 1000 load or 45 cut damage",
  },
  chain: {
    name: "Chained ball",
    summary:
      "An iron ball on four hinged links. Swing it into monsters; yank, throw or cut it free and it flies on with its own motion.",
    event: "none",
    joints: "hinges; anchor 2600 load / 60 cut, links 3200 / 90",
  },
  vine: {
    name: "Vine tether",
    summary:
      "Six vine segments on rope joints hold a seed pod: the tether limits how far the pod moves until it snaps or is cut.",
    event: "none",
    joints: "ropes (tethers); 260 load / 8 cut each",
  },
  launcher: {
    name: "Sprung launcher",
    summary:
      "Pull the sled back against its spring and let go: it fires (authored event), throwing what lies in front of it.",
    event: "launch",
    joints: "slider −13..+8 units and a 2000-stiffness spring (cut 40)",
  },
  vane: {
    name: "Wind vane",
    summary: "A raised vane turns on a driven pivot; Whorl and blows spin it. Physical only.",
    event: "none",
    joints: "hinge driven toward 1.4 rad/s (rate 1.5/s); unbreakable",
  },
  bridge: {
    name: "Plank causeway",
    summary:
      "Four hinged planks between bank posts span the creek. Travelers on an anchored plank do not wade; a cut lashing swings it away (authored deck event).",
    event: "deck",
    joints: "hinges; lashings 900 load / 25 cut, plank joints 1300 / 40",
  },
};
/** Reproducible registry export for agents and documentation. */
export function mechanismExport() {
  return {
    version: 1,
    kinds: structuredClone(MECHANISMS),
    joints: {
      hinge: "revolute pin; optional angle limits (rad) and a motor",
      fixed: "rigid attachment at an authored relative angle",
      rope: "tether: distance between anchors at most its length",
      spring: "damped spring toward its rest length",
      slider: "travel along one axis; optional limits (units) and a motor",
    },
    strain:
      "load = Σ over moving members of the connected part: mass × speed away from the joint's anchor, measured before each solve (ropes when taut, springs past 2.5× rest, sliders across the axis). A joint snaps when load > breakLoad × jointStrength and jointBreakage is on.",
    cut: "attacks on a member cut its nearest intact joint by the member material's damage; it severs at toughness × jointStrength",
    motors:
      "Fern rules before each solve: position motors are damped springs (stiffness 1/s², damping 1/s); velocity motors approach their speed at rate damping (1/s); limits stop motion exactly at them",
    policy:
      "mechanisms off freezes jointed parts where they stand; jointBreakage off stops new snaps and cuts; both resolve at each connected part's root",
    launchSpeed: LAUNCH_SPEED,
  };
}
/** Speed a firing launcher gives what lies in front of it (units/s, times impulse strength). */
export const LAUNCH_SPEED = 420;
const LATCH_ANGLE = 1.45;
const UNLATCH_ANGLE = 0.35;
/** Gentle, nearly critically damped return spring (stiffness 1/s², damping 1/s). */
const GATE_MOTOR = { stiffness: 6, damping: 4 };

/** The gate pen's footprint (fence walls included), relative to its area's center. */
export const PEN_BOUNDS = { left: -131, right: -82, top: -315, bottom: -258 } as const;
/** Whether a point lies inside an area's gate pen, where no monster should start a wave. */
export function insidePen(area: { x: number; y: number }, x: number, y: number): boolean {
  const dx = x - area.x,
    dy = y - area.y;
  return (
    dx > PEN_BOUNDS.left && dx < PEN_BOUNDS.right && dy > PEN_BOUNDS.top && dy < PEN_BOUNDS.bottom
  );
}
/** The six mechanisms and their companion scenery for one area. */
export function areaMechanisms(
  area: { index: number; x: number; y: number },
  palette: number,
): { mechanisms: MechanismBlueprint[]; extras: BodyRecipe[] } {
  const i = area.index,
    areaId = `area-${i}`,
    ax = area.x,
    ay = area.y;
  const member = (assembly: string, recipe: BodyRecipe): BodyRecipe => ({ ...recipe, assembly });
  const body = (
    id: string,
    family: Parameters<typeof propRecipe>[1],
    x: number,
    y: number,
    options: Parameters<typeof propRecipe>[6] = {},
  ) => propRecipe(id, family, palette, round(x), round(y), areaId, options);
  const mechanisms: MechanismBlueprint[] = [],
    extras: BodyRecipe[] = [];
  const add = (
    kind: MechanismKind,
    root: string,
    bodies: BodyRecipe[],
    joints: Omit<JointRecipe, "assembly">[],
  ) => {
    const id = `${kind}-${i}`;
    mechanisms.push({
      recipe: {
        id,
        kind,
        areaId,
        root,
        members: bodies.map((b) => b.id),
        event: MECHANISMS[kind].event,
      },
      bodies: bodies.map((b) => member(id, b)),
      joints: joints.map((j) => ({ ...j, assembly: id })),
    });
  };
  // Gate: a pen of three fence walls closed by the gate leaf, with a reward chest inside. Every
  // linked part keeps an authored gap from its neighbor, so their contacts never need disabling.
  {
    const hx = ax - 127,
      gy = ay - 262,
      hinge = `prop-gate-${i}-hinge`,
      leaf = `prop-gate-${i}-leaf`;
    add(
      "gate",
      hinge,
      [
        body(hinge, "post", hx, gy),
        body(leaf, "gate", hx + 19.5, gy, { shape: { kind: "box", width: 30, height: 5 } }),
      ],
      [
        {
          id: `gate-${i}:hinge`,
          kind: "hinge",
          a: hinge,
          b: leaf,
          anchorA: { x: 0, y: 0 },
          anchorB: { x: -19.5, y: 0 },
          limits: [-1.9, 1.9],
          motor: { mode: "position", target: 0, ...GATE_MOTOR },
          breakLoad: 1000,
          toughness: 45,
        },
      ],
    );
    const wall = (width: number) => ({ shape: { kind: "box" as const, width, height: 5 } });
    extras.push(
      body(`prop-gate-${i}-latch`, "post", hx + 39, gy),
      body(`prop-fence-${i}-pen0`, "fence", hx - 4, gy - 26, { angle: Math.PI / 2, ...wall(52) }),
      body(`prop-fence-${i}-pen1`, "fence", hx + 43, gy - 26, { angle: Math.PI / 2, ...wall(52) }),
      body(`prop-fence-${i}-pen2`, "fence", hx + 20.75, gy - 52, wall(50)),
      // Beyond the leaf's 34.6-unit sweep, so a swinging gate never jams on it.
      body(`prop-chest-${i}-0`, "chest", hx + 31, gy - 38),
    );
  }
  // Chain: post, four links and an iron ball reaching east.
  {
    const cx = ax - 210,
      cy = ay + 215,
      post = `prop-chain-${i}-post`,
      links = [0, 1, 2, 3].map((k) => `prop-chain-${i}-link${k}`),
      ball = `prop-chain-${i}-ball`;
    add(
      "chain",
      post,
      [
        body(post, "post", cx, cy),
        ...links.map((id, k) => body(id, "link", cx + 10 + 11 * k, cy)),
        body(ball, "ball", cx + 58.5, cy),
      ],
      [
        hingeJoint(
          `chain-${i}:anchor`,
          post,
          links[0],
          { x: 4.5, y: 0 },
          { x: -5.5, y: 0 },
          2600,
          60,
        ),
        ...[1, 2, 3].map((k) =>
          hingeJoint(
            `chain-${i}:link${k}`,
            links[k - 1],
            links[k],
            { x: 5.5, y: 0 },
            { x: -5.5, y: 0 },
            3200,
            90,
          ),
        ),
        hingeJoint(`chain-${i}:ball`, links[3], ball, { x: 5.5, y: 0 }, { x: -10, y: 0 }, 3200, 90),
      ],
    );
  }
  // Vine: a root stake, six segments on rope joints and a seed pod.
  {
    const vx = ax - 255,
      vy = ay - 95,
      root = `prop-vine-${i}-root`,
      segments = [0, 1, 2, 3, 4, 5].map((k) => `prop-vine-${i}-seg${k}`),
      pod = `prop-vine-${i}-pod`;
    const rope = (
      id: string,
      a: string,
      b: string,
      anchorA: { x: number; y: number },
      anchorB: { x: number; y: number },
      length: number,
    ): Omit<JointRecipe, "assembly"> => ({
      id,
      kind: "rope",
      a,
      b,
      anchorA,
      anchorB,
      length,
      breakLoad: 260,
      toughness: 8,
    });
    add(
      "vine",
      root,
      [
        body(root, "post", vx, vy),
        ...segments.map((id, k) => body(id, "vine", vx + 9.5 + 10 * k, vy)),
        body(pod, "pod", vx + 70, vy),
      ],
      [
        rope(`vine-${i}:root`, root, segments[0], { x: 0, y: 0 }, { x: -4.5, y: 0 }, 5),
        ...[1, 2, 3, 4, 5].map((k) =>
          rope(
            `vine-${i}:seg${k}`,
            segments[k - 1],
            segments[k],
            { x: 4.5, y: 0 },
            { x: -4.5, y: 0 },
            1,
          ),
        ),
        rope(`vine-${i}:pod`, segments[5], pod, { x: 4.5, y: 0 }, { x: -5, y: 0 }, 1),
      ],
    );
  }
  // Launcher: a fixed frame, a sled on a slider and spring, aimed south across the creek.
  {
    const lx = ax + 150,
      ly = ay - 272,
      frame = `prop-launcher-${i}-frame`,
      sled = `prop-launcher-${i}-sled`;
    add(
      "launcher",
      frame,
      [
        body(frame, "post", lx, ly, { shape: { kind: "box", width: 18, height: 8 } }),
        body(sled, "sled", lx, ly + 22, { shape: { kind: "box", width: 16, height: 8 } }),
      ],
      [
        {
          id: `launcher-${i}:slider`,
          kind: "slider",
          a: frame,
          b: sled,
          anchorA: { x: 0, y: 22 },
          anchorB: { x: 0, y: 0 },
          axis: { x: 0, y: 1 },
          limits: [-13, 8],
          breakLoad: 0,
          toughness: 0,
        },
        {
          id: `launcher-${i}:spring`,
          kind: "spring",
          a: frame,
          b: sled,
          anchorA: { x: 0, y: 0 },
          anchorB: { x: 0, y: 0 },
          length: 22,
          stiffness: 2000,
          damping: 4,
          breakLoad: 0,
          toughness: 40,
        },
      ],
    );
    extras.push(body(`prop-stone-${i}-launch`, "stone", lx, ly + 36));
  }
  // Vane: a raised rotor on a driven pivot.
  {
    const wx = ax + 90,
      wy = ay - 286,
      mast = `prop-vane-${i}-mast`,
      rotor = `prop-vane-${i}-rotor`;
    add(
      "vane",
      mast,
      [body(mast, "post", wx, wy), body(rotor, "vane", wx, wy)],
      [
        {
          id: `vane-${i}:pivot`,
          kind: "hinge",
          a: mast,
          b: rotor,
          anchorA: { x: 0, y: 0 },
          anchorB: { x: 0, y: 0 },
          motor: { mode: "velocity", target: 1.4, stiffness: 0, damping: 1.5 },
          breakLoad: 0,
          toughness: 0,
        },
      ],
    );
  }
  // Causeway: four hinged planks between bank posts across the creek.
  {
    const bx = ax - 10,
      south = `prop-bridge-${i}-south`,
      north = `prop-bridge-${i}-north`,
      planks = [0, 1, 2, 3].map((k) => `prop-bridge-${i}-plank${k}`);
    add(
      "bridge",
      south,
      [
        body(south, "post", bx, ay - 180),
        ...planks.map((id, k) => body(id, "plank", bx, ay - 192 - 16 * k)),
        body(north, "post", bx, ay - 252),
      ],
      [
        hingeJoint(`bridge-${i}:south`, south, planks[0], { x: 0, y: -4 }, { x: 0, y: 8 }, 900, 25),
        ...[1, 2, 3].map((k) =>
          hingeJoint(
            `bridge-${i}:deck${k}`,
            planks[k - 1],
            planks[k],
            { x: 0, y: -8 },
            { x: 0, y: 8 },
            1300,
            40,
          ),
        ),
        hingeJoint(`bridge-${i}:north`, planks[3], north, { x: 0, y: -8 }, { x: 0, y: 4 }, 900, 25),
      ],
    );
  }
  return { mechanisms, extras };
}
const round = (value: number) => Math.round(value * 1000) / 1000;
function hingeJoint(
  id: string,
  a: string,
  b: string,
  anchorA: { x: number; y: number },
  anchorB: { x: number; y: number },
  breakLoad: number,
  toughness: number,
): Omit<JointRecipe, "assembly"> {
  return { id, kind: "hinge", a, b, anchorA, anchorB, breakLoad, toughness };
}

/** Pending gameplay record of a mechanism change, emitted by the adventure at its next step. */
export interface MechanismEvent {
  id: string;
  tick: number;
  assembly: string;
  kind: AssemblyKind;
  /** `<kind>:<what>`, for example `gate:latched`, `launcher:fired`, `chain:anchor:cut`. */
  text: string;
  owner: string;
  x: number;
  y: number;
}
export interface MechanismState {
  gates: { id: string; latched: -1 | 0 | 1 }[];
  launchers: { id: string; cocked: boolean; by: string }[];
  bridges: { id: string; spanned: boolean }[];
  events: MechanismEvent[];
  sequence: number;
}
const angleOf = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Authored mechanism behavior on top of the joints: gate latches, launcher firing, causeway
 * span, and break records with their responsible traveler. Saved with the land. */
export class MechanismPhysics {
  private gates = new Map<string, -1 | 0 | 1>();
  private launchers = new Map<string, { cocked: boolean; by: string }>();
  private bridges = new Map<string, boolean>();
  private events: MechanismEvent[] = [];
  private sequence = 0;
  save(): MechanismState {
    return {
      gates: [...this.gates]
        .sort((a, b) => compareIds(a[0], b[0]))
        .map(([id, latched]) => ({ id, latched })),
      launchers: [...this.launchers]
        .sort((a, b) => compareIds(a[0], b[0]))
        .map(([id, s]) => ({ id, cocked: s.cocked, by: s.by })),
      bridges: [...this.bridges]
        .sort((a, b) => compareIds(a[0], b[0]))
        .map(([id, spanned]) => ({ id, spanned })),
      events: structuredClone(this.events),
      sequence: this.sequence,
    };
  }
  restore(state: MechanismState | undefined): void {
    this.clear();
    if (!state) return;
    for (const g of state.gates) this.gates.set(g.id, g.latched);
    for (const l of state.launchers) this.launchers.set(l.id, { cocked: l.cocked, by: l.by });
    for (const b of state.bridges) this.bridges.set(b.id, b.spanned);
    this.events = structuredClone(state.events);
    this.sequence = state.sequence;
  }
  clear(): void {
    this.gates.clear();
    this.launchers.clear();
    this.bridges.clear();
    this.events = [];
    this.sequence = 0;
  }
  /** Start tracking a newly attached assembly at its authored resting state. */
  track(recipe: AssemblyRecipe): void {
    if (recipe.kind === "gate" && !this.gates.has(recipe.id)) this.gates.set(recipe.id, 0);
    if (recipe.kind === "launcher" && !this.launchers.has(recipe.id))
      this.launchers.set(recipe.id, { cocked: false, by: "" });
    if (recipe.kind === "bridge" && !this.bridges.has(recipe.id)) this.bridges.set(recipe.id, true);
  }
  /** Events waiting for the adventure to emit them; taken once. */
  take(): MechanismEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }
  record(
    world: PhysicsWorld,
    tick: number,
    assembly: string,
    text: string,
    owner: string,
    at?: { x: number; y: number },
  ): void {
    const recipe = world.assemblyList().find((a) => a.id === assembly)!;
    const point = at ?? world.motionOf(recipe.root);
    this.events.push({
      id: `${tick}:${assembly}:${this.sequence++}`,
      tick,
      assembly,
      kind: recipe.kind,
      text,
      owner,
      x: point.x,
      y: point.y,
    });
    if (this.events.length > 64) this.events = this.events.slice(-64);
  }
  /** A joint break as an event: who caused it (the attacker, else whoever launched the part). */
  recordBreak(
    world: PhysicsWorld,
    combat: CombatPhysics,
    tick: number,
    jointId: string,
    cause: string,
    owner?: string,
  ): void {
    const entry = world.joint(jointId),
      recipe = world.assemblyList().find((a) => a.id === entry.recipe.assembly)!;
    const responsible =
      owner ??
      combat.instigator(entry.recipe.b, tick)?.owner ??
      combat.instigator(entry.recipe.a, tick)?.owner ??
      "";
    const name = jointId.split(":")[1];
    const a = world.pose(entry.recipe.a),
      b = world.pose(entry.recipe.b),
      anchors = jointAnchors(entry.recipe, a, b);
    this.record(
      world,
      tick,
      recipe.id,
      `${recipe.kind}:${name}:${cause === "strain" ? "snapped" : "cut"}`,
      responsible,
      { x: (anchors.ax + anchors.bx) / 2, y: (anchors.ay + anchors.by) / 2 },
    );
  }
  /** After each solve: latches, launches, spans and strain breaks. */
  update(tick: number, world: PhysicsWorld, combat: CombatPhysics): void {
    for (const event of world.drainJointBreaks())
      this.recordBreak(world, combat, tick, event.id, event.cause);
    for (const recipe of world.assemblyList()) {
      if (recipe.kind === "gate") this.gate(tick, world, combat, recipe);
      else if (recipe.kind === "launcher") this.launcher(tick, world, combat, recipe);
      else if (recipe.kind === "bridge") {
        const spanned = this.spanned(world, recipe);
        if (this.bridges.get(recipe.id) && !spanned)
          this.record(world, tick, recipe.id, "bridge:span-lost", "");
        this.bridges.set(recipe.id, spanned);
      }
    }
  }
  private spanned(world: PhysicsWorld, recipe: AssemblyRecipe): boolean {
    const south = recipe.members[0],
      north = recipe.members[recipe.members.length - 1];
    return world.partMembers(south).includes(north);
  }
  private gate(tick: number, world: PhysicsWorld, combat: CombatPhysics, recipe: AssemblyRecipe) {
    const hinge = `${recipe.id}:hinge`,
      joint = world.joint(hinge);
    if (joint.broken) return;
    const leaf = world.pose(joint.recipe.b),
      post = world.pose(joint.recipe.a);
    if (leaf.frozen || !leaf.policy.effective.mechanisms) return;
    const relative = angleOf(leaf.angle - post.angle),
      latched = this.gates.get(recipe.id) ?? 0;
    const who = combat.holderOf(leaf.id) ?? combat.instigator(leaf.id, tick)?.owner ?? "";
    if (latched === 0 && Math.abs(relative) > LATCH_ANGLE) {
      const side = relative > 0 ? 1 : -1;
      this.gates.set(recipe.id, side);
      world.setMotor(hinge, { mode: "position", target: side * 1.6, ...GATE_MOTOR });
      this.record(world, tick, recipe.id, "gate:latched", who);
    } else if (
      latched !== 0 &&
      Math.abs(relative) < UNLATCH_ANGLE &&
      Math.abs(leaf.angularVelocity - post.angularVelocity) < 2
    ) {
      // Only a deliberate push closes a latched gate; a rebound off the hinge stop does not.
      this.gates.set(recipe.id, 0);
      world.setMotor(hinge, { mode: "position", target: 0, ...GATE_MOTOR });
      this.record(world, tick, recipe.id, "gate:closed", who);
    }
  }
  private launcher(
    tick: number,
    world: PhysicsWorld,
    combat: CombatPhysics,
    recipe: AssemblyRecipe,
  ) {
    const slider = world.joint(`${recipe.id}:slider`),
      spring = world.joint(`${recipe.id}:spring`);
    if (slider.broken || spring.broken) return;
    const frame = world.pose(slider.recipe.a),
      sled = world.pose(slider.recipe.b);
    if (sled.frozen || !sled.policy.effective.mechanisms) return;
    const axisX =
        Math.cos(frame.angle) * slider.recipe.axis!.x -
        Math.sin(frame.angle) * slider.recipe.axis!.y,
      axisY =
        Math.sin(frame.angle) * slider.recipe.axis!.x +
        Math.cos(frame.angle) * slider.recipe.axis!.y;
    const restX =
        frame.x +
        Math.cos(frame.angle) * slider.recipe.anchorA.x -
        Math.sin(frame.angle) * slider.recipe.anchorA.y,
      restY =
        frame.y +
        Math.sin(frame.angle) * slider.recipe.anchorA.x +
        Math.cos(frame.angle) * slider.recipe.anchorA.y;
    const offset = (sled.x - restX) * axisX + (sled.y - restY) * axisY,
      speed = sled.vx * axisX + sled.vy * axisY;
    const state = this.launchers.get(recipe.id) ?? { cocked: false, by: "" };
    if (!state.cocked && offset < -9) {
      state.cocked = true;
      state.by = combat.holderOf(sled.id) ?? combat.instigator(sled.id, tick)?.owner ?? "";
      this.record(world, tick, recipe.id, "launcher:cocked", state.by);
    } else if (state.cocked && combat.holderOf(sled.id) === null && offset > -3) {
      state.cocked = false;
      if (speed > 180) {
        // Authored event: whatever lies in front of the sled is thrown along the launch axis.
        const half = sled.shape.kind === "box" ? sled.shape.height / 2 : 4;
        for (const id of world.ids()) {
          if (!id.startsWith("prop-") && !id.startsWith("crate-") && !id.startsWith("wheel-"))
            continue;
          if (recipe.members.includes(id)) continue;
          const m = world.motionOf(id);
          if (!m.dynamic || m.frozen) continue;
          const along = (m.x - sled.x) * axisX + (m.y - sled.y) * axisY - half,
            across = Math.abs((m.x - sled.x) * -axisY + (m.y - sled.y) * axisX);
          if (along < -2 || along > 40 || across > 14) continue;
          const launch = LAUNCH_SPEED * world.policyOf(id).effective.impulseStrength;
          world.motion(id, axisX * launch, axisY * launch, m.angularVelocity);
          combat.instigate(id, state.by, "party", "launcher", tick);
        }
        this.record(world, tick, recipe.id, "launcher:fired", state.by);
      }
    }
    this.launchers.set(recipe.id, state);
  }
}
export function validateMechanisms(
  state: MechanismState | undefined,
  assemblies: AssemblyRecipe[],
): void {
  if (!state || typeof state !== "object") throw new Error("Missing mechanism state");
  const kinds = new Map(assemblies.map((a) => [a.id, a.kind]));
  const id = (value: unknown) => typeof value === "string" && /^[\w-]{1,120}$/.test(value);
  const owner = (value: unknown) => typeof value === "string" && value.length <= 80;
  if (
    !Array.isArray(state.gates) ||
    !Array.isArray(state.launchers) ||
    !Array.isArray(state.bridges) ||
    !Array.isArray(state.events) ||
    state.events.length > 64 ||
    !Number.isSafeInteger(state.sequence) ||
    state.sequence < 0 ||
    state.gates.some(
      (g) => !id(g?.id) || kinds.get(g.id) !== "gate" || ![-1, 0, 1].includes(g.latched),
    ) ||
    state.launchers.some(
      (l) =>
        !id(l?.id) ||
        kinds.get(l.id) !== "launcher" ||
        typeof l.cocked !== "boolean" ||
        !owner(l.by),
    ) ||
    state.bridges.some(
      (b) => !id(b?.id) || kinds.get(b.id) !== "bridge" || typeof b.spanned !== "boolean",
    ) ||
    state.events.some(
      (e) =>
        !e ||
        typeof e.id !== "string" ||
        !Number.isSafeInteger(e.tick) ||
        !id(e.assembly) ||
        kinds.get(e.assembly) !== e.kind ||
        typeof e.text !== "string" ||
        !/^[a-z]+:[\w:-]{1,60}$/.test(e.text) ||
        !owner(e.owner) ||
        ![e.x, e.y].every(Number.isFinite),
    ) ||
    new Set(state.gates.map((g) => g.id)).size !== state.gates.length ||
    new Set(state.launchers.map((l) => l.id)).size !== state.launchers.length ||
    new Set(state.bridges.map((b) => b.id)).size !== state.bridges.length
  )
    throw new Error("Invalid mechanism state");
}

/** One drawable connection: both attachment points and what holds them. */
export interface LinkView {
  id: string;
  kind: JointEntry["recipe"]["kind"];
  assembly: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  broken: boolean;
  /** Load as a fraction of its break threshold (0 when it cannot snap). */
  strain: number;
}
/** Drawable joints from member poses (host poses or a replica's received states). */
export function linkViews(
  joints: JointEntry[],
  poseOf: (id: string) => Pick<BodyPose, "x" | "y" | "angle"> | undefined,
): LinkView[] {
  const out: LinkView[] = [];
  for (const joint of joints) {
    const a = poseOf(joint.recipe.a),
      b = poseOf(joint.recipe.b);
    if (!a || !b) continue;
    const anchors = jointAnchors(joint.recipe, a, b);
    out.push({
      id: joint.recipe.id,
      kind: joint.recipe.kind,
      assembly: joint.recipe.assembly,
      ...anchors,
      broken: joint.broken,
      strain: joint.recipe.breakLoad > 0 ? Math.min(1, joint.load / joint.recipe.breakLoad) : 0,
    });
  }
  return out;
}
/** Plank members still tied to a bank post, in a received or live scene. */
function anchoredPlanks(
  assemblies: AssemblyRecipe[],
  joints: JointEntry[],
  motionOf: (id: string) => "fixed" | "dynamic" | null,
): string[] {
  const parts = assemblyParts(assemblies, joints, motionOf);
  return assemblies
    .filter((a) => a.kind === "bridge")
    .flatMap((a) => a.members.filter((id) => id.includes("-plank") && parts.get(id)?.anchored));
}
/** Whether a point stands on an anchored causeway plank (travelers there do not wade). */
export function onDeck(
  planks: Pick<BodyPose, "x" | "y" | "angle" | "shape">[],
  x: number,
  y: number,
): boolean {
  for (const p of planks) {
    if (p.shape.kind !== "box") continue;
    const dx = x - p.x,
      dy = y - p.y,
      c = Math.cos(-p.angle),
      s = Math.sin(-p.angle),
      lx = dx * c - dy * s,
      ly = dx * s + dy * c;
    if (Math.abs(lx) <= p.shape.width / 2 + 2 && Math.abs(ly) <= p.shape.height / 2 + 2)
      return true;
  }
  return false;
}
export function deckPlanks(world: PhysicsWorld): BodyPose[] {
  return anchoredPlanks(world.assemblyList(), world.jointList(), (id) =>
    world.has(id) ? world.recipeOf(id).motion : null,
  ).map((id) => world.pose(id));
}
const replicaDecks = new WeakMap<PhysicsSnapshot, BodyPose[]>();
/** Deck planks of a received scene, computed once per snapshot. */
export function replicaDeckPlanks(snapshot: PhysicsSnapshot): BodyPose[] {
  let planks = replicaDecks.get(snapshot);
  if (!planks) {
    const states = new Map(snapshot.bodies.map((b) => [b.recipe.id, b]));
    planks = anchoredPlanks(
      snapshot.assemblies ?? [],
      snapshot.joints ?? [],
      (id) => states.get(id)?.recipe.motion ?? null,
    )
      .map((id) => states.get(id)?.state)
      .filter((p): p is BodyPose => !!p);
    replicaDecks.set(snapshot, planks);
  }
  return planks;
}
