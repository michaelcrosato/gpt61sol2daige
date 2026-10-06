// M11 acceptance receipt: `node tools/physics-encounters.ts > docs/evidence/physics-m11.json`.
// Every number is measured from the headless simulation: the fixed seed corpus across the five
// themes and depths (with a large index), each combination's chain in a real simulation, the
// composed wardens' armor, and save/restore with a late-join replica mid-chain. Clearing areas
// 9–12 by ordinary inputs is the route's evidence (`npm run verify:run`).
import { AgentRuntime } from "../src/engine/agent.ts";
import { type SaveState, Simulation } from "../src/engine/simulation.ts";
import { areaRecipe } from "../src/game/content.ts";
import { COMBINATION_IDS, encounterPlan } from "../src/game/encounters.ts";
import { PALETTES } from "../src/physics/blueprints.ts";
import { initializePhysics } from "../src/physics/bootstrap.ts";
import { generatedArea, landWorld, waterTerrain } from "../src/physics/encounters.ts";
import { solidTerrain } from "../src/physics/terrain.ts";
import {
  CORPUS_INDICES,
  CORPUS_SEEDS,
  demonstrate,
  findCombos,
  quietArea,
} from "./lib/encounter-demos.ts";

await initializePhysics();
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

// 1. The seed corpus.
const corpus: Record<string, unknown>[] = [];
const combos = new Map<string, number>(),
  bosses = new Set<string>();
let fallbacks = 0;
for (const seed of CORPUS_SEEDS)
  for (const index of [...CORPUS_INDICES, 1_000_001]) {
    const recipe = areaRecipe(seed, index),
      world = landWorld(seed, recipe.land),
      g = generatedArea(
        recipe,
        recipe.land % PALETTES,
        solidTerrain(world),
        undefined,
        waterTerrain(world),
      ),
      m = g.manifest;
    for (const c of m.clusters) combos.set(c.combo, (combos.get(c.combo) ?? 0) + 1);
    bosses.add(`${m.boss.rig}|${m.boss.armor}|${m.boss.moves.join("+")}|${m.boss.arena.join("+")}`);
    fallbacks += m.fallbacks.length;
    corpus.push({
      seed,
      index,
      land: recipe.land,
      theme: recipe.theme,
      mechanics: recipe.mechanics,
      combinations: m.clusters.map((c) => c.combo),
      modules: [...new Set(m.clusters.flatMap((c) => c.modules))].length,
      filler: m.filler?.module ?? null,
      warden: {
        title: m.boss.title,
        rig: m.boss.rig,
        moves: m.boss.moves,
        armor: `${m.boss.armor}×${m.boss.pieces}`,
        arena: m.arena.map((a) => a.kit),
      },
      bodies: m.bodies,
      fallbacks: m.fallbacks.length,
      overlaps: m.overlaps.length,
      routesOpen: m.routes.every((r) => r.ok),
    });
  }

// 2. Every combination's chain in a real simulation.
const found = findCombos();
const demos = COMBINATION_IDS.map((combo) => {
  const where = found.get(combo)!,
    r = demonstrate(combo, where);
  return {
    combo,
    seed: where.seed,
    index: where.index,
    ok: r.ok,
    rules: r.rules,
    outcome: r.outcome,
    ticks: r.ticks,
  };
});

// 3. A composed warden: armor mounted, damage reduced, stripped by its counter.
function warden(seed: number, index: number) {
  const sim = quietArea(seed, index);
  try {
    const s = sim.adventure.state,
      plan = encounterPlan(s.recipe)!,
      physical = sim.physical!;
    const e = sim.adventure.spawnMonster(sim, plan.boss.rig, s.recipe.x - 150, s.recipe.y, {
      boss: true,
      hp: 8000,
      passive: true,
    });
    sim.step(3);
    const mounted = physical.armorPieces(e).length,
      factor = physical.armorFactor(e),
      before = e.hp;
    sim.adventure.strikeEnemy(sim, "local", e.id, 100, 0);
    const armoredBlow = round(before - e.hp);
    // Strip it with its counter: fire burns bark, shock cracks glass, a blast breaks stone and
    // knocks iron censers loose.
    const stimulus =
      plan.boss.armor === "glass" ? "shock" : plan.boss.armor === "bark" ? "fire" : "blast";
    let ticks = 0;
    for (const id of physical.armorPieces(e)) {
      const p = physical.world.pose(id);
      physical.stimulate(sim, stimulus, {
        x: p.x,
        y: p.y,
        radius: stimulus === "blast" ? 40 : undefined,
        target: id,
        owner: "local",
        team: "party",
      });
    }
    for (; ticks < 900 && physical.armorPieces(e).length > 0; ticks++) sim.step();
    const after = physical.armorPieces(e).length,
      bareBefore = e.hp;
    sim.adventure.strikeEnemy(sim, "local", e.id, 100, 0);
    return {
      seed,
      index,
      title: plan.boss.title,
      rig: plan.boss.rig,
      moves: plan.boss.moves,
      weaknesses: plan.boss.weaknesses,
      armor: plan.boss.armor,
      mounted,
      damageFactor: round(factor),
      armoredBlow,
      stripWith: stimulus,
      piecesAfterStrip: after,
      ticksToStrip: ticks,
      blowAfterStrip: round(bareBefore - e.hp),
    };
  } finally {
    sim.dispose();
  }
}
const wardens: ReturnType<typeof warden>[] = [];
const armorSeen = new Set<string>();
for (const index of CORPUS_INDICES)
  for (const seed of CORPUS_SEEDS) {
    const armor = encounterPlan(areaRecipe(seed, index))!.boss.armor;
    if (armorSeen.has(armor)) continue;
    armorSeen.add(armor);
    wardens.push(warden(seed, index));
  }

// 5. Save/restore and a late-join replica of a generated encounter mid-chain.
const persistence = (() => {
  const where = found.get("powder-fuse")!,
    sim = quietArea(where.seed, where.index);
  try {
    const physical = sim.physical!,
      brush = `prop-brush-${where.index}-c${where.k}-0-0`;
    const p = physical.world.pose(brush);
    physical.stimulate(sim, "fire", {
      x: p.x,
      y: p.y,
      target: brush,
      owner: "local",
      team: "party",
    });
    sim.step(30);
    const restored = Simulation.restore(JSON.parse(JSON.stringify(sim.save())));
    sim.step(240);
    restored.step(240);
    const equal = restored.stateHash() === sim.stateHash();
    const destroyed = physical.destroyedRecords().map((d) => d.id);
    restored.dispose();
    const guest = new Simulation(where.seed, 0);
    guest.applyReplica(JSON.parse(JSON.stringify(sim.save(true))) as SaveState);
    const exported = new AgentRuntime(guest).execute({
      op: "encounters",
      action: "export",
      index: where.index,
    }) as { mutations: { destroyed: { id: string }[] } };
    guest.dispose();
    return {
      seed: where.seed,
      index: where.index,
      restoredMidChainHashEqual: equal,
      destroyedAfterChain: destroyed.filter((id) => /-c\d-/.test(id)),
      replicaSeesDestroyed: exported.mutations.destroyed.map((d) => d.id),
    };
  } finally {
    sim.dispose();
  }
})();

console.log(
  JSON.stringify(
    {
      milestone: "M11",
      corpus: {
        seeds: CORPUS_SEEDS,
        indices: [...CORPUS_INDICES, 1_000_001],
        areas: corpus.length,
        themes: [...new Set(corpus.map((c) => c.theme))],
        distinctCombinations: combos.size,
        combinations: Object.fromEntries([...combos.entries()].sort()),
        distinctWardenAssemblies: bosses.size,
        fallbacks,
        overlaps: corpus.reduce((n, c) => n + (c.overlaps as number), 0),
        routesClosed: corpus.filter((c) => !c.routesOpen).length,
        areasList: corpus,
      },
      demonstrations: demos,
      wardens,
      cleared:
        "areas 9–12 are cleared by ordinary inputs in the route with reactions on and off; an area holding an input-startable combination starts it first: docs/evidence/physics-m11-route*.jsonl",
      persistence,
    },
    null,
    2,
  ),
);
