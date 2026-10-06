import { AgentRuntime, type Command } from "../../src/engine/agent.ts";
import type { Simulation } from "../../src/engine/simulation.ts";
import type { PolicyEdit, PresetName, RegionProfile } from "../../src/physics/policies.ts";
import { remainsId } from "../../src/physics/rigs.ts";

/**
 * M12 showcase route: a JSON scene recipe (`examples/showcase.json`) played headless. Setup uses
 * agent commands; each beat after that uses only ordinary inputs (walking, aiming, slashing,
 * grabbing, throwing, Whorl) and the World physics panel's policy edits. The browser scenario
 * (`e2e/showcase.spec.ts`) plays the same recipe with real keys, mouse and panel clicks.
 */
export type Target = string | [number, number];
export type Step =
  | { walk: Target; offset?: [number, number]; near?: number }
  | { slash: Target; until?: "destroyed"; ticks: number }
  | { grab: string }
  | { drag: [number, number]; ticks: number }
  | { carry: Target; ticks: number; until?: "burning" }
  | { release: "drop" | "throw" }
  | { throw: Target }
  | { whorl: true }
  | { wait: number }
  | { region: string; preset?: PresetName; reset?: "authored" }
  | { check: Expectation[] };
export type Expectation =
  | { destroyed: string }
  | { intact: string }
  | { dead: string }
  | { remains: string }
  | { moved: string; min: number }
  | { rules: string[] }
  | { event: { type: string; text: string; owner?: string } }
  | { policy: { at: string; values: Record<string, boolean | number> } };
export interface Beat {
  id: string;
  title: string;
  say: string;
  /** Where the traveler is placed when the beat begins (staging, like setup). */
  at?: [number, number];
  steps: Step[];
  expect: Expectation[];
}
export interface ShowcaseRecipe {
  version: 1;
  name: string;
  about?: string;
  seed: number;
  area: number;
  zoom?: number;
  setup: (Command & { as?: string })[];
  beats: Beat[];
}
export interface BeatResult {
  id: string;
  title: string;
  ok: boolean;
  ticks: number;
  inputs: string[];
  checks: { expect: Expectation; ok: boolean; got: unknown }[];
}

export function validateRecipe(recipe: ShowcaseRecipe): void {
  if (recipe?.version !== 1) throw new Error("Showcase recipe version must be 1");
  if (!Number.isInteger(recipe.seed) || !Number.isInteger(recipe.area))
    throw new Error("Showcase recipe needs integer seed and area");
  if (!Array.isArray(recipe.setup) || !Array.isArray(recipe.beats) || !recipe.beats.length)
    throw new Error("Showcase recipe needs setup commands and beats");
  const ids = new Set<string>();
  for (const beat of recipe.beats) {
    if (!beat.id || ids.has(beat.id)) throw new Error(`Duplicate or missing beat id ${beat.id}`);
    ids.add(beat.id);
    if (!Array.isArray(beat.steps) || !Array.isArray(beat.expect) || !beat.expect.length)
      throw new Error(`Beat ${beat.id} needs steps and expectations`);
  }
}

/** Plays a recipe headless; every beat's checks are measured, not assumed. */
export class ShowcaseRun {
  readonly runtime: AgentRuntime;
  readonly vars = new Map<string, string>();
  private readonly start = new Map<string, { x: number; y: number }>();
  readonly recipe: ShowcaseRecipe;
  constructor(recipe: ShowcaseRecipe) {
    validateRecipe(recipe);
    this.recipe = recipe;
    this.runtime = new AgentRuntime();
  }
  get sim(): Simulation {
    return this.runtime.sim;
  }
  setup(): void {
    for (const raw of this.recipe.setup) {
      const { as, ...command } = raw;
      const result = this.runtime.execute(command as Command) as { id?: number } | undefined;
      if (as && result?.id !== undefined) this.vars.set(`$${as}`, `enemy-${result.id}`);
    }
  }
  private hero() {
    return this.sim.players.get("local")!;
  }
  /** A body id, a `$var` (an enemy, or its remains once it has fallen), or a point. */
  where(target: Target): { x: number; y: number } | null {
    if (Array.isArray(target)) return { x: target[0], y: target[1] };
    const id = this.vars.get(target) ?? target;
    if (id.startsWith("enemy-")) {
      const e = this.sim.adventure.state.enemies.find((en) => `enemy-${en.id}` === id);
      if (e && e.hp > 0) return { x: e.x, y: e.y };
      const members = this.remainsMembers(id);
      if (members.length) return this.sim.physical!.world.pose(members[0]);
      return e ? { x: e.x, y: e.y } : null;
    }
    const world = this.sim.physical!.world;
    return world.has(id) ? world.pose(id) : null;
  }
  remainsMembers(enemy: string): string[] {
    const id = remainsId(Number(enemy.slice(6)));
    return this.sim.physical!.world.assemblyList().find((a) => a.id === id)?.members ?? [];
  }
  private aim(at: { x: number; y: number }) {
    const p = this.hero(),
      d = Math.hypot(at.x - p.x, at.y - p.y) || 1;
    return { aimX: (at.x - p.x) / d, aimY: (at.y - p.y) / d };
  }
  private walk(to: { x: number; y: number }, near: number, limit = 900): boolean {
    const p = this.hero();
    for (let t = 0; t < limit; t++) {
      const dx = to.x - p.x,
        dy = to.y - p.y;
      if (Math.hypot(dx, dy) <= near) break;
      const side = Math.floor(t / 40) % 3 === 2 ? 1.1 : 0,
        a = Math.atan2(dy, dx) + side;
      this.sim.setInput("local", { x: Math.cos(a), y: Math.sin(a) });
      this.sim.step();
    }
    this.sim.setInput("local", {});
    this.sim.step();
    return Math.hypot(to.x - p.x, to.y - p.y) <= near + 2;
  }
  private destroyed(id: string): boolean {
    return this.sim.physical!.isDestroyed(id);
  }
  private action(
    action: Parameters<Simulation["adventure"]["action"]>[2],
    inputs: string[],
    label: string,
  ) {
    try {
      this.sim.adventure.action(this.sim, "local", action);
      inputs.push(label);
      return true;
    } catch (error) {
      inputs.push(`${label}: refused (${(error as Error).message})`);
      return false;
    }
  }
  /** The World physics panel's region edits, as the same agent transaction. */
  regionEdit(region: string, edit: { preset?: PresetName; reset?: "authored" }): void {
    const policies = this.runtime.execute({ op: "actors", action: "policies" }) as {
      nextRevision: number;
    };
    const edits: PolicyEdit[] = edit.preset
      ? [{ type: "preset", scope: "region", id: region, preset: edit.preset }]
      : [{ type: "reset", scope: "region", id: region, to: "authored" }];
    this.runtime.execute({
      op: "actors",
      action: "configure",
      expectedRevision: policies.nextRevision,
      edits,
    });
    this.sim.step();
  }
  step(step: Step, inputs: string[]): void {
    const sim = this.sim;
    if ("walk" in step) {
      const at = this.where(step.walk);
      if (!at) throw new Error(`Unknown walk target ${step.walk}`);
      const [dx, dy] = step.offset ?? [0, 0];
      this.walk({ x: at.x + dx, y: at.y + dy }, step.near ?? 10);
      inputs.push(`walk to ${typeof step.walk === "string" ? step.walk : step.walk.join(",")}`);
    } else if ("slash" in step) {
      const target = String(step.slash);
      for (let t = 0; t < step.ticks; t++) {
        if (step.until === "destroyed" && this.destroyed(target)) break;
        const at = this.where(step.slash);
        if (!at) break;
        // Follow a target the blows push away, so it stays within reach.
        const p = this.hero(),
          d = Math.hypot(at.x - p.x, at.y - p.y),
          chase = d > 26 ? { x: (at.x - p.x) / d, y: (at.y - p.y) / d } : {};
        sim.setInput("local", { ...this.aim(at), ...chase, attack: true });
        sim.step();
      }
      sim.setInput("local", {});
      sim.step();
      inputs.push(`slash ${target} (LMB/J)`);
    } else if ("grab" in step) {
      this.action({ type: "grab", id: step.grab }, inputs, `V: grab ${step.grab}`);
    } else if ("drag" in step) {
      for (let t = 0; t < step.ticks; t++) {
        sim.setInput("local", { x: step.drag[0], y: step.drag[1] });
        sim.step();
      }
      sim.setInput("local", {});
      inputs.push(`hold ${step.drag.join(",")} for ${step.ticks} ticks`);
    } else if ("carry" in step) {
      const held = sim.physical!.combat.holding("local");
      for (let t = 0; t < step.ticks; t++) {
        if (
          step.until === "burning" &&
          held &&
          (sim.physical!.reactions.status(held)?.burning ?? 0) > 0
        )
          break;
        const at = this.where(step.carry)!,
          p = this.hero();
        sim.setInput("local", { ...this.aim(at), x: (at.x - p.x) / 40, y: (at.y - p.y) / 40 });
        sim.step();
      }
      sim.setInput("local", {});
      inputs.push(`carry it into ${step.carry}`);
    } else if ("release" in step) {
      if (sim.physical!.combat.holding("local"))
        this.action(
          { type: "release", throw: step.release === "throw" },
          inputs,
          step.release === "throw" ? "throw" : "V: set it down",
        );
    } else if ("throw" in step) {
      const at = this.where(step.throw);
      if (!at) throw new Error(`Unknown throw target ${step.throw}`);
      sim.setInput("local", this.aim(at));
      sim.step();
      this.action(
        { type: "release", throw: true },
        inputs,
        `attack while holding: throw at ${step.throw}`,
      );
    } else if ("whorl" in step) {
      sim.setInput("local", { pulse: true });
      sim.step();
      sim.setInput("local", {});
      inputs.push("Q: Whorl");
    } else if ("wait" in step) {
      sim.step(step.wait);
    } else if ("region" in step) {
      this.regionEdit(step.region, step);
      inputs.push(
        `World physics (O): region ${step.region} → ${step.preset ?? `reset to ${step.reset}`}`,
      );
    }
  }
  /** Remember positions that `moved` expectations compare against. */
  mark(beat: Beat): void {
    this.start.clear();
    for (const e of beat.expect)
      if ("moved" in e) {
        const at = this.where(e.moved);
        if (at) this.start.set(e.moved, { x: at.x, y: at.y });
      }
  }
  check(e: Expectation, since: number): { ok: boolean; got: unknown } {
    const sim = this.sim,
      physical = sim.physical!;
    if ("destroyed" in e)
      return { ok: this.destroyed(e.destroyed), got: this.destroyed(e.destroyed) };
    if ("intact" in e) return { ok: !this.destroyed(e.intact), got: !this.destroyed(e.intact) };
    if ("dead" in e) {
      const id = this.vars.get(e.dead) ?? e.dead,
        alive = sim.adventure.state.enemies.find((en) => `enemy-${en.id}` === id && en.hp > 0);
      return { ok: !alive, got: alive ? alive.hp : "dead" };
    }
    if ("remains" in e) {
      const members = this.remainsMembers(this.vars.get(e.remains) ?? e.remains);
      return { ok: members.length > 0, got: members.length };
    }
    if ("moved" in e) {
      const a = this.start.get(e.moved),
        b = this.where(e.moved);
      const d = a && b ? Math.hypot(a.x - b.x, a.y - b.y) : -1;
      return { ok: d >= e.min, got: Math.round(d * 10) / 10 };
    }
    if ("rules" in e) {
      const rules = new Set(
        physical.reactions
          .save()
          .chains.filter((c) => c.owner === "local" && c.tick >= since)
          .flatMap((c) => c.rules),
      );
      return { ok: e.rules.every((r) => rules.has(r as never)), got: [...rules].sort() };
    }
    if ("event" in e) {
      const hit = sim.adventure.state.events.find(
        (ev) =>
          ev.tick >= since &&
          ev.type === e.event.type &&
          ev.text.startsWith(e.event.text) &&
          (!e.event.owner || ev.owner === e.event.owner),
      );
      return { ok: !!hit, got: hit ? `${hit.type}:${hit.text}/${hit.owner}` : null };
    }
    const region = sim.physicalRegions().find((r: RegionProfile) => r.id === e.policy.at);
    const at = region?.shape.kind === "circle" ? region.shape : this.where(e.policy.at);
    const effective = (
      this.runtime.execute({ op: "actors", action: "policy", x: at?.x ?? 0, y: at?.y ?? 0 }) as {
        effective: Record<string, unknown>;
      }
    ).effective;
    const ok = Object.entries(e.policy.values).every(([k, v]) => effective[k] === v);
    return {
      ok,
      got: Object.fromEntries(Object.keys(e.policy.values).map((k) => [k, effective[k]])),
    };
  }
  play(beat: Beat): BeatResult {
    // Every beat starts from the recipe's clean scene, so one beat never changes the next.
    this.vars.clear();
    this.setup();
    if (beat.at) {
      this.runtime.execute({ op: "teleport", x: beat.at[0], y: beat.at[1] });
      this.sim.step(2);
    }
    const since = this.sim.tick,
      inputs: string[] = [];
    this.mark(beat);
    const inline: BeatResult["checks"] = [];
    for (const step of beat.steps) {
      if ("check" in step) {
        for (const e of step.check) inline.push({ expect: e, ...this.check(e, since) });
        continue;
      }
      try {
        this.step(step, inputs);
      } catch (error) {
        inputs.push(`failed: ${(error as Error).message}`);
        inline.push({ expect: { intact: "step" }, ok: false, got: (error as Error).message });
        break;
      }
    }
    const checks = [...inline, ...beat.expect.map((e) => ({ expect: e, ...this.check(e, since) }))];
    return {
      id: beat.id,
      title: beat.title,
      ok: checks.every((c) => c.ok),
      ticks: this.sim.tick - since,
      inputs,
      checks,
    };
  }
}
