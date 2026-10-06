import { Simulation } from "../../src/engine/simulation.ts";
import { areaRecipe } from "../../src/game/content.ts";
import { COMBINATION_IDS, type CombinationId } from "../../src/game/encounters.ts";
import { PALETTES } from "../../src/physics/blueprints.ts";
import {
  generatedArea,
  landWorld,
  type RealizedCluster,
  waterTerrain,
} from "../../src/physics/encounters.ts";
import { solidTerrain } from "../../src/physics/terrain.ts";

/**
 * M11 combination demonstrations: for each compatibility rule, find a generated area of the
 * seed corpus that realized it, build that area in a real simulation, set the chain off the way
 * a traveler would (a shoved jar, a burning strike, a struck coil, a released launcher, a swung
 * ball, an arch) and report what the physical world did. Used by the headless tests and the
 * evidence receipt.
 */
export const CORPUS_SEEDS = [142, 7, 2026, 31337] as const;
export const CORPUS_INDICES = [
  9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 33, 101, 4001,
] as const;
export interface DemoResult {
  combo: CombinationId;
  seed: number;
  index: number;
  ok: boolean;
  /** Rules the chain fired (M08) and the observed outcome. */
  rules: string[];
  outcome: string;
  ticks: number;
}
/** The first corpus area whose realized encounter contains each combination. */
export function findCombos(): Map<CombinationId, { seed: number; index: number; k: number }> {
  const found = new Map<CombinationId, { seed: number; index: number; k: number }>();
  for (const index of CORPUS_INDICES)
    for (const seed of CORPUS_SEEDS) {
      const recipe = areaRecipe(seed, index),
        world = landWorld(seed, recipe.land),
        g = generatedArea(
          recipe,
          recipe.land % PALETTES,
          solidTerrain(world),
          undefined,
          waterTerrain(world),
        );
      g.manifest.clusters.forEach((c, k) => {
        if (!found.has(c.combo)) found.set(c.combo, { seed, index, k });
      });
      if (found.size === COMBINATION_IDS.length) return found;
    }
  return found;
}
/** A generated area with its monsters sent away (QA isolation, no reward). */
export function quietArea(seed: number, index: number): Simulation {
  const sim = new Simulation(seed, 0);
  sim.addPlayer("local");
  sim.adventure.startArea(sim, index);
  const s = sim.adventure.state;
  s.enemies = [];
  s.spawned = s.recipe.killGoal;
  s.bossSpawned = true;
  sim.step();
  return sim;
}
const id = (index: number, k: number, n: number, family: string, tag: string) =>
  `prop-${family}-${index}-c${k}-${n}-${tag}`;
function chainRules(sim: Simulation): string[] {
  return [...new Set(sim.physical!.reactions.save().chains.flatMap((c) => c.rules))].sort();
}
function destroyed(sim: Simulation, ids: string[]): string[] {
  const set = new Set(ids);
  return sim
    .physical!.destroyedRecords()
    .filter((d) => set.has(d.id))
    .map((d) => d.id);
}
/** Step until `done` holds (or the limit); returns the ticks taken. */
function until(sim: Simulation, limit: number, done: () => boolean): number {
  for (let t = 0; t < limit; t++) {
    if (done()) return t;
    sim.step();
  }
  return done() ? limit : -1;
}
/** A planted, never-attacking monster: the thing a combination is meant to catch. */
function plant(sim: Simulation, x: number, y: number) {
  return sim.adventure.spawnMonster(sim, "crawler", x, y, { hp: 600, passive: true });
}
/** Shove a loose prop against a fixed one (as a traveler pushing it into the coals would). */
function pressAgainst(sim: Simulation, mover: string, target: string): void {
  const w = sim.physical!.world,
    a = w.pose(mover),
    b = w.pose(target),
    d = Math.hypot(a.x - b.x, a.y - b.y) || 1,
    reach =
      (a.shape.kind === "circle" ? a.shape.radius : 6) +
      (b.shape.kind === "circle" ? b.shape.radius : 6);
  w.place(mover, b.x + ((a.x - b.x) / d) * (reach + 1), b.y + ((a.y - b.y) / d) * (reach + 1));
}
/** Pull a launcher's sled back and let go, as a traveler does with V and the mouse. */
function fireLauncher(sim: Simulation, sled: string, heading: number): void {
  const w = sim.physical!.world,
    p = w.pose(sled);
  sim.teleport(
    "local",
    p.x - Math.cos(heading) * 4 + Math.sin(heading) * 14,
    p.y - Math.sin(heading) * 4 - Math.cos(heading) * 14,
  );
  sim.step(2);
  sim.adventure.action(sim, "local", { type: "grab", id: sled });
  sim.setInput("local", { aimX: -Math.cos(heading), aimY: -Math.sin(heading) });
  sim.step(26);
  sim.adventure.action(sim, "local", { type: "release", throw: false });
  sim.setInput("local", {});
}
/** Run one combination's demonstration in its own simulation. */
export function demonstrate(
  combo: CombinationId,
  where: { seed: number; index: number; k: number },
): DemoResult {
  const sim = quietArea(where.seed, where.index);
  const { index, k } = where;
  const physical = sim.physical!,
    world = physical.world,
    cluster = physical.encounters
      .find((m) => m.index === index)!
      .clusters.find((c) => c.region === `combo-${index}-${k}`) as RealizedCluster;
  const result = (ok: boolean, outcome: string, ticks: number): DemoResult => ({
    combo,
    seed: where.seed,
    index,
    ok,
    rules: chainRules(sim),
    outcome,
    ticks,
  });
  const pool = (n: number) =>
    physical.reactions.save().surfaces.find((s) => s.id === `pool-${index}-c${k}-${n}`)!;
  const fire = (target: string) => {
    const p = world.pose(target);
    physical.stimulate(sim, "fire", { x: p.x, y: p.y, target, owner: "local", team: "party" });
  };
  try {
    switch (combo) {
      case "storm-pool": {
        const water = pool(1),
          e = plant(sim, water.x, water.y);
        sim.step(30);
        const before = e.hp,
          coil = id(index, k, 0, "coil", "0"),
          p = world.pose(coil);
        physical.stimulate(sim, "shock", {
          x: p.x,
          y: p.y,
          target: coil,
          owner: "local",
          team: "party",
        });
        const t = until(sim, 60, () => e.hp < before);
        return result(t >= 0, `wading crawler ${Math.round(before)} → ${Math.round(e.hp)} HP`, t);
      }
      case "spark-pool": {
        const water = pool(1),
          e = plant(sim, water.x, water.y);
        sim.step(30);
        const before = e.hp,
          pylon = id(index, k, 0, "pylon", "1"),
          p = world.pose(pylon);
        sim.adventure.strikeProp(
          sim,
          "local",
          pylon,
          400,
          Math.atan2(p.y - water.y, p.x - water.x),
        );
        const t = until(sim, 60, () => e.hp < before);
        return result(
          t >= 0 && destroyed(sim, [pylon]).length === 1,
          `pylon broken; wading crawler ${Math.round(before)} → ${Math.round(e.hp)} HP`,
          t,
        );
      }
      case "fire-stockade":
      case "oil-flare": {
        // Shove the camp's oil jar into the brazier's coals (module 0 is the ignition).
        // Shove an oil jar into the brazier's coals (the camp's for the palisade, the cellar's
        // for the flare); an oil-cellar ignition breaks its lantern instead.
        const brazier = world.ids().find((i) => i.startsWith(`prop-brazier-${index}-c${k}-0-`)),
          lantern = world.ids().find((i) => i.startsWith(`prop-lantern-${index}-c${k}-0-`));
        const jar = [
          id(index, k, combo === "oil-flare" ? 1 : 0, "jar", "0"),
          id(index, k, combo === "oil-flare" ? 1 : 0, "jar", "1"),
        ].find((j) => world.has(j));
        if (brazier && jar) pressAgainst(sim, jar, brazier);
        else if (lantern) sim.adventure.strikeProp(sim, "local", lantern, 400, 0);
        const targets = (
          combo === "fire-stockade"
            ? [id(index, k, 2, "barricade", "front")]
            : [0, 1, 2].map((n) => id(index, k, 1, "jar", String(n)))
        ).filter((t) => world.has(t) && t !== jar);
        // The palisade must burn through; the cellar counts once its jars are ablaze.
        const reached = () =>
          targets.some(
            (t) =>
              destroyed(sim, [t]).length > 0 ||
              (combo === "oil-flare" && (physical.reactions.status(t)?.burning ?? 0) > 0),
          );
        const t = until(sim, 900, reached);
        const burning = targets.filter((x) => (physical.reactions.status(x)?.burning ?? 0) > 0);
        return result(
          t >= 0,
          combo === "fire-stockade"
            ? `stockade front ${destroyed(sim, targets).length ? "burnt through" : "burning"} ${t} ticks after the jar met the coals`
            : `cellar ablaze: ${burning.length} jar(s) burning, ${destroyed(sim, targets).length} burst`,
          t,
        );
      }
      case "powder-fuse":
      case "thorn-fire":
      case "quench-fuse": {
        fire(id(index, k, 0, "brush", "0"));
        if (combo === "quench-fuse") {
          sim.step(24);
          const cask = id(index, k, 1, "cask", "0");
          sim.adventure.strikeProp(sim, "local", cask, 400, 0);
          sim.step(600);
          const last = id(index, k, 0, "brush", "4"),
            saved = world.has(last) && (physical.reactions.status(last)?.burning ?? 0) === 0;
          return result(
            chainRules(sim).includes("extinguish") && saved,
            `fuse doused; last brush ${saved ? "unburnt" : "burnt"}`,
            624,
          );
        }
        const targets =
          combo === "powder-fuse"
            ? [id(index, k, 1, "barrel", "0"), id(index, k, 1, "barrel", "1")]
            : [id(index, k, 1, "hedge", "0")];
        // Powder must actually blow; a hedge line counts once it is ablaze.
        const t = until(sim, 1200, () => destroyed(sim, targets).length > 0);
        return result(
          t >= 0,
          combo === "powder-fuse"
            ? `powder store ${destroyed(sim, targets).length}/2 blown`
            : "hedge line burnt through",
          t,
        );
      }
      case "maelstrom-rubble":
      case "vortex-powder":
      case "gale-debris": {
        const loose = world
          .ids()
          .filter((i) => i.startsWith(`prop-`) && i.includes(`-${index}-c${k}-1-`));
        const start = new Map(loose.map((i) => [i, world.pose(i)]));
        sim.step(240);
        const moved = loose.filter((i) => {
          if (!world.has(i)) return true;
          const a = start.get(i)!,
            b = world.pose(i);
          return Math.hypot(a.x - b.x, a.y - b.y) > 25;
        });
        if (combo !== "vortex-powder")
          return result(moved.length >= 2, `${moved.length}/${loose.length} pieces carried`, 240);
        // The barrels may have swirled through water: a shock sets off wet powder too.
        const barrel = id(index, k, 1, "barrel", "0"),
          at = world.pose(barrel);
        physical.stimulate(sim, "shock", {
          x: at.x,
          y: at.y,
          target: barrel,
          owner: "local",
          team: "party",
        });
        const both = [barrel, id(index, k, 1, "barrel", "1")];
        const t = until(sim, 300, () => destroyed(sim, both).length === 2);
        return result(
          moved.length >= 2 && t >= 0,
          `${moved.length} swirling; ${destroyed(sim, both).length}/2 barrels blew together`,
          t,
        );
      }
      case "launch-powder":
      case "ram-stockade": {
        const sled = id(index, k, 0, "sled", "sled");
        fireLauncher(sim, sled, cluster.heading);
        const targets =
          combo === "launch-powder"
            ? [id(index, k, 1, "barrel", "0"), id(index, k, 1, "barrel", "1")]
            : [id(index, k, 1, "barricade", "front")];
        const durability = () =>
          targets.map((t) => (world.has(t) ? (world.pose(t).consequences?.durability ?? 100) : 0));
        const before = durability();
        const t = until(
          sim,
          240,
          () => destroyed(sim, targets).length > 0 || durability().some((d, n) => d < before[n]),
        );
        return result(
          t >= 0,
          `${combo === "launch-powder" ? "powder" : "stockade"} hit: durability ${before.map(Math.round).join("/")} → ${durability().map(Math.round).join("/")}, ${destroyed(sim, targets).length} broken`,
          t,
        );
      }
      case "swing-glass": {
        const ball = id(index, k, 0, "ball", "ball"),
          pylon = id(index, k, 1, "pylon", "0"),
          b = world.pose(ball),
          p = world.pose(pylon);
        // A heavy blow swings the ball around its post toward the glass.
        const post = world.pose(id(index, k, 0, "post", "post")),
          rx = b.x - post.x,
          ry = b.y - post.y,
          r = Math.hypot(rx, ry) || 1,
          side = Math.sign(-ry * (p.x - b.x) + rx * (p.y - b.y)) || 1;
        world.motion(ball, (-ry / r) * side * 420, (rx / r) * side * 420);
        physical.combat.instigate(ball, "local", "party", "strike", sim.tick);
        const t = until(sim, 120, () => destroyed(sim, [pylon]).length > 0);
        return result(t >= 0, `pylon ${t >= 0 ? "shattered" : "intact"}`, t);
      }
      case "rift-cart": {
        const arches = sim.adventure.state.mechanics.filter((m) => m.kind === "rift"),
          arch = arches[1] ?? arches[0];
        const members = world.ids().filter((i) => i.includes(`-${index}-c${k}-0-`));
        const start = new Map(members.map((i) => [i, world.pose(i)]));
        sim.teleport("local", arch.x, arch.y);
        sim.step(2);
        sim.adventure.useMechanic(sim, "local", arch.id);
        sim.step(2);
        const moved = members.filter((i) => {
          const a = start.get(i)!,
            b = world.pose(i);
          return Math.hypot(a.x - b.x, a.y - b.y) > 100;
        });
        const joints = world.jointList().filter((j) => j.recipe.assembly === `cart-${index}-c${k}`);
        const intact = joints.every((j) => !j.broken);
        return result(
          moved.length === members.length && intact && joints.length === 2,
          `${moved.length}/${members.length} cart members through the rift, ${joints.length} tow ropes ${intact ? "intact" : "broken"}`,
          4,
        );
      }
    }
  } finally {
    sim.dispose();
  }
}

// ---- Ordinary-input lead-ins (route evidence) ----------------------------------------------

/** Combinations a traveler can set off with ordinary inputs alone, in order of preference. */
export const INPUT_STARTS: readonly CombinationId[] = [
  "fire-stockade",
  "oil-flare",
  "storm-pool",
  "launch-powder",
  "ram-stockade",
  "spark-pool",
  "rift-cart",
];
/** A validated character action; a refusal (a frozen prop, say) is recorded, not thrown. */
function act(
  sim: Simulation,
  action: Parameters<Simulation["adventure"]["action"]>[2],
  inputs: string[],
  label: string,
): boolean {
  try {
    sim.adventure.action(sim, "local", action);
    inputs.push(label);
    return true;
  } catch (error) {
    inputs.push(`${label}: refused (${(error as Error).message})`);
    return false;
  }
}
/** Whether the traveler still holds a prop. */
const combat = (physical: NonNullable<Simulation["physical"]>, id: string) =>
  physical.combat.holderOf(id) === "local";
/** Walk (direction input only, optionally aiming) until within `reach` of a point. */
function walkTo(
  sim: Simulation,
  x: number,
  y: number,
  reach: number,
  limit = 900,
  aim?: { x: number; y: number },
): boolean {
  const p = sim.players.get("local")!;
  for (let t = 0; t < limit; t++) {
    const dx = x - p.x,
      dy = y - p.y,
      d = Math.hypot(dx, dy);
    if (d <= reach) {
      sim.setInput("local", {});
      return true;
    }
    // Sidestep briefly when blocked (a fence, a monster): still only a direction input.
    const side = Math.floor(t / 40) % 3 === 2 ? 1.1 : 0;
    const a = Math.atan2(dy, dx) + side;
    const aimTo = aim
      ? {
          aimX: (aim.x - p.x) / (Math.hypot(aim.x - p.x, aim.y - p.y) || 1),
          aimY: (aim.y - p.y) / (Math.hypot(aim.x - p.x, aim.y - p.y) || 1),
        }
      : {};
    sim.setInput("local", { x: Math.cos(a), y: Math.sin(a), ...aimTo });
    sim.step();
  }
  sim.setInput("local", {});
  return false;
}
export interface LeadIn {
  combo: CombinationId;
  cluster: string;
  inputs: string[];
  /** The tick the lead-in began: chains and breaks since then are its result. */
  since: number;
  /** Filled by `leadResult`: rules fired by chains the traveler started, and cluster breaks. */
  rules?: string[];
  destroyed?: string[];
}
/** What a lead-in set off, read after the fight (the chain runs on while the bot fights). */
export function leadResult(sim: Simulation, lead: LeadIn): LeadIn {
  const physical = sim.physical!,
    prefix = `-${lead.cluster.split("-")[1]}-c${lead.cluster.split("-")[2]}-`;
  return {
    ...lead,
    rules: [
      ...new Set(
        physical.reactions
          .save()
          .chains.filter((ch) => ch.owner === "local" && ch.tick >= lead.since)
          .flatMap((ch) => ch.rules),
      ),
    ].sort(),
    destroyed: physical
      .destroyedRecords()
      .filter((d) => d.tick >= lead.since && d.id.includes(prefix))
      .map((d) => d.id)
      .sort(),
  };
}
/**
 * Set off one combination of the current generated area with ordinary inputs (walking, V to
 * grab, aim and release, a slash, E at an arch). Returns null when the area has none of the
 * input-startable combinations.
 */
export function leadIn(sim: Simulation, settle = 20): LeadIn | null {
  const physical = sim.physical;
  if (!physical) return null;
  const s = sim.adventure.state,
    index = s.recipe.index,
    manifest = physical.encounters.find((m) => m.index === index);
  if (!manifest) return null;
  const pick = INPUT_STARTS.map((combo) =>
    manifest.clusters.findIndex((c) => c.combo === combo),
  ).find((k) => k >= 0);
  if (pick === undefined) return null;
  const k = manifest.clusters[pick].region.split("-")[2],
    c = manifest.clusters[pick],
    world = physical.world,
    inputs: string[] = [],
    since = sim.tick;
  const piece = (n: number, family: string, tag: string) =>
    `prop-${family}-${index}-c${k}-${n}-${tag}`;
  const aimAt = (x: number, y: number) => {
    const p = sim.players.get("local")!,
      d = Math.hypot(x - p.x, y - p.y) || 1;
    return { aimX: (x - p.x) / d, aimY: (y - p.y) / d };
  };
  switch (c.combo) {
    case "fire-stockade":
    case "oil-flare": {
      const jar = [piece(c.combo === "oil-flare" ? 1 : 0, "jar", "0"), piece(0, "jar", "1")].find(
        (j) => world.has(j),
      );
      const brazier = piece(0, "brazier", "0");
      if (!jar) return null;
      const at = world.pose(jar);
      walkTo(sim, at.x, at.y, 30);
      inputs.push("walk to an oil jar");
      if (!act(sim, { type: "grab", id: jar }, inputs, "V: grab it")) break;
      // Walk the held jar into the brazier's coals, aiming at them (heat lights it).
      const b = world.pose(brazier);
      walkTo(sim, b.x, b.y, 24, 300, { x: b.x, y: b.y });
      for (
        let t = 0;
        t < 60 && world.has(jar) && !(physical.reactions.status(jar)?.burning ?? 0);
        t++
      ) {
        sim.setInput("local", {
          ...aimAt(b.x, b.y),
          x: (b.x - sim.players.get("local")!.x) / 40,
          y: (b.y - sim.players.get("local")!.y) / 40,
        });
        sim.step();
      }
      inputs.push("aim at the brazier and walk the jar into its coals");
      if (world.has(jar) && combat(physical, jar))
        act(sim, { type: "release", throw: false }, inputs, "let go");
      // Step back out of the burning slick.
      walkTo(sim, at.x - 50, at.y, 12, 200);
      break;
    }
    case "storm-pool":
    case "spark-pool": {
      const target = c.combo === "storm-pool" ? piece(0, "coil", "0") : piece(0, "pylon", "1");
      const at = world.pose(target);
      walkTo(sim, at.x, at.y, 22);
      for (let t = 0; t < 40 && world.has(target); t++) {
        sim.setInput("local", { ...aimAt(at.x, at.y), attack: true });
        sim.step();
      }
      inputs.push(`walk to the ${c.combo === "storm-pool" ? "coil" : "pylon"} and slash it`);
      break;
    }
    case "launch-powder":
    case "ram-stockade": {
      const sled = piece(0, "sled", "sled"),
        at = world.pose(sled);
      walkTo(sim, at.x - Math.cos(c.heading) * 4, at.y - Math.sin(c.heading) * 4, 20);
      inputs.push("walk to the launcher");
      if (!act(sim, { type: "grab", id: sled }, inputs, "V: grab the sled")) break;
      sim.setInput("local", { aimX: -Math.cos(c.heading), aimY: -Math.sin(c.heading) });
      sim.step(26);
      act(sim, { type: "release", throw: false }, inputs, "pull it back and let go");
      break;
    }
    case "rift-cart": {
      const arches = s.mechanics.filter((m) => m.kind === "rift"),
        arch = arches[1] ?? arches[0];
      walkTo(sim, arch.x, arch.y, 16);
      sim.setInput("local", { interact: true });
      sim.step();
      inputs.push("walk onto the arch and press E");
      break;
    }
    default:
      return null;
  }
  sim.setInput("local", {});
  sim.step(settle);
  return { combo: c.combo, cluster: c.region, inputs, since };
}
