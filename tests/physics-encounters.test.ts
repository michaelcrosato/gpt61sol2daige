import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { AgentRuntime } from "../src/engine/agent.ts";
import { type SaveState, Simulation } from "../src/engine/simulation.ts";
import { areaRecipe, THEMES } from "../src/game/content.ts";
import {
  ARMOR,
  ARMOR_RULES,
  COMBINATION_IDS,
  COMBINATIONS,
  type EncounterPlan,
  encounterExport,
  encounterPlan,
  MODULE_IDS,
  MODULES,
  validateEncounterPlan,
} from "../src/game/encounters.ts";
import { WARDENS } from "../src/game/wardens.ts";
import { PALETTES } from "../src/physics/blueprints.ts";
import { initializePhysics } from "../src/physics/bootstrap.ts";
import {
  ARENA_KITS,
  CLUSTERS,
  generatedArea,
  KITS,
  landWorld,
  overlapsIn,
  waterTerrain,
} from "../src/physics/encounters.ts";
import type { PolicyEdit } from "../src/physics/policies.ts";
import { RULES } from "../src/physics/reactions.ts";
import { solidTerrain } from "../src/physics/terrain.ts";
import {
  CORPUS_INDICES,
  CORPUS_SEEDS,
  demonstrate,
  findCombos,
  quietArea,
} from "../tools/lib/encounter-demos.ts";

await initializePhysics();

const build = (seed: number, index: number, plan?: EncounterPlan) => {
  const recipe = areaRecipe(seed, index),
    world = landWorld(seed, recipe.land);
  return generatedArea(
    recipe,
    recipe.land % PALETTES,
    solidTerrain(world),
    plan,
    waterTerrain(world),
  );
};
function edit(sim: Simulation, edits: PolicyEdit[]) {
  const physical = sim.physical!;
  physical.configure({ expectedRevision: physical.world.policyState().nextRevision, edits });
  physical.world.applyPolicies(physical.world.policyState().nextRevision);
  physical.begin(sim);
}

test("the encounter grammar is a pure, validated function of the area recipe", () => {
  // Every module has a kit, every combination's roles name modules that carry the role's tag,
  // and every combination has its chain geometry.
  assert.deepEqual(Object.keys(KITS).sort(), [...MODULE_IDS].sort());
  assert.deepEqual(Object.keys(CLUSTERS).sort(), [...COMBINATION_IDS].sort());
  for (const [id, info] of Object.entries(COMBINATIONS)) {
    assert.ok(info.name && info.summary && info.start && info.chain.length, id);
    for (const role of info.roles)
      for (const m of role.modules) assert.ok(MODULES[m].tags.includes(role.tag), `${id}: ${m}`);
  }
  assert.equal(Object.keys(ARENA_KITS).length, 7);
  assert.equal(JSON.stringify(encounterExport()), JSON.stringify(encounterExport()));
  // Authored areas keep their M10 content; generated ones have a plan, the same every time.
  for (let index = 1; index <= 8; index++)
    assert.equal(encounterPlan(areaRecipe(142, index)), null);
  const plan = encounterPlan(areaRecipe(142, 13))!;
  assert.deepEqual(encounterPlan(areaRecipe(142, 13)), plan);
  validateEncounterPlan(plan);
  // Invalid references fail visibly.
  const bad = (change: (p: EncounterPlan) => void, message: RegExp) => {
    const p = structuredClone(plan);
    change(p);
    assert.throws(() => validateEncounterPlan(p), message);
  };
  bad((p) => (p.clusters[0].combos = ["lava-moat" as never]), /unknown combination lava-moat/);
  bad((p) => (p.fillers[0].modules = ["trebuchet" as never]), /unknown module trebuchet/);
  bad((p) => (p.boss.armor = "mithril" as never), /unknown armor mithril/);
  bad((p) => (p.boss.moves = ["meteor" as never]), /unknown boss move meteor/);
  bad((p) => (p.clusters[1].slot = p.clusters[0].slot), /cluster slot/);
  bad((p) => (p.index = 4), /generated areas are 9\+/);
});

test("a fixed seed corpus across all five themes and depths composes twelve-plus combinations and varied warden assemblies with valid placement and routes", () => {
  const combos = new Set<string>(),
    bosses = new Set<string>(),
    themes = new Set<string>(),
    armors = new Set<string>(),
    moduleSets = new Map<string, Set<string>>();
  let areas = 0,
    fallbacks = 0,
    short = 0;
  for (const seed of CORPUS_SEEDS)
    for (const index of CORPUS_INDICES) {
      const recipe = areaRecipe(seed, index),
        g = build(seed, index),
        m = g.manifest,
        plan = encounterPlan(recipe)!;
      areas++;
      themes.add(recipe.theme);
      fallbacks += m.fallbacks.length;
      assert.deepEqual(m.overlaps, [], `${seed}/${index}: nothing starts interpenetrated`);
      assert.deepEqual(overlapsIn(g.content.bodies), []);
      // A cluster with no room anywhere leaves its slot open, recorded (a valid alternate path).
      assert.ok(
        m.clusters.length >= Math.min(2, plan.clusters.length),
        `${seed}/${index}: clusters`,
      );
      if (m.clusters.length < plan.clusters.length) {
        short++;
        assert.ok(m.fallbacks.some((f) => /no combination could stand/.test(f)));
      }
      for (const c of m.clusters) {
        combos.add(c.combo);
        for (const l of c.links)
          assert.ok(l.ok, `${seed}/${index} ${c.combo}: ${l.rule} ${l.distance}`);
      }
      for (const r of m.routes) assert.ok(r.ok, `${seed}/${index}: route to ${r.id} stays open`);
      assert.ok(m.filler, `${seed}/${index}: a standalone mechanism`);
      assert.ok(
        m.arena.filter((a) => a.placed > 0).length >= 1,
        `${seed}/${index}: the warden has an arena`,
      );
      const b = m.boss;
      armors.add(b.armor);
      bosses.add(`${b.rig}|${b.armor}|${b.moves.join("+")}|${b.arena.join("+")}`);
      const set = new Set(m.clusters.flatMap((c) => c.modules));
      moduleSets.set(`${seed}/${index}`, set);
      // Regions follow the realized clusters with their combination's profile.
      assert.equal(g.regions.length, m.clusters.length);
    }
  assert.ok(areas >= 80);
  assert.ok(short <= areas * 0.05, `${short} areas left a cluster out`);
  assert.deepEqual([...themes].sort(), THEMES.map((t) => t.id).sort(), "all five themes");
  assert.ok(combos.size >= 12, `${combos.size} distinct combinations`);
  assert.ok(bosses.size >= 12, `${bosses.size} distinct warden assemblies`);
  assert.equal(armors.size, Object.keys(ARMOR).length);
  // Variation is more than a palette: generated areas of one land differ in their modules.
  const land2 = [9, 10, 11, 12].map((i) => [...moduleSets.get(`142/${i}`)!].sort().join());
  assert.ok(new Set(land2).size >= 3, "areas of one land compose different modules");
  assert.ok(fallbacks > 0, "the corpus exercises fallbacks (and records them)");
  // A large index still composes.
  const far = build(142, 1_000_001).manifest;
  assert.equal(far.clusters.length, 3);
});

test("each compatibility rule sets off its causal chain in a real simulation", () => {
  const found = findCombos();
  assert.equal(found.size, COMBINATION_IDS.length, "every combination appears in the corpus");
  for (const [combo, where] of found) {
    const r = demonstrate(combo, where);
    assert.ok(r.ok, `${combo} (${where.seed}/${where.index}): ${r.outcome}`);
    // The M08 rules of its chain fired (hooks like launcher:fired are checked by outcome).
    for (const rule of COMBINATIONS[combo].chain)
      if (Object.hasOwn(RULES, rule) && combo !== "quench-fuse")
        assert.ok(r.rules.includes(rule), `${combo}: ${rule} fired (${r.rules.join(",")})`);
  }
});

test("a generated land builds from seed; saved breaks and moves stay authoritative through restore and travel", () => {
  const sim = quietArea(142, 9);
  try {
    const physical = sim.physical!,
      world = physical.world;
    assert.equal(physical.grammar, true);
    const manifest = physical.encounters.find((m) => m.index === 9)!;
    assert.deepEqual(manifest, build(142, 9).manifest, "the same seed builds the same content");
    // No legacy layout in a generated area; its clusters, filler and arena stand instead.
    assert.ok(!world.has("crate-9-0") && !world.has("prop-gate-9-leaf"));
    const pieces = world.ids().filter((id) => /-9-(c\d|m-|a\d)/.test(id));
    assert.ok(pieces.length >= 15, `${pieces.length} generated pieces`);
    // A second simulation with the same seed builds identical initial bodies.
    const twin = quietArea(142, 9);
    try {
      const poses = (s: Simulation) =>
        s
          .physical!.world.ids()
          .filter((id) => /-9-(c\d|m-|a\d)/.test(id))
          .map((id) => {
            const p = s.physical!.world.pose(id);
            return `${id}@${Math.round(p.x)},${Math.round(p.y)}`;
          });
      assert.deepEqual(poses(twin), poses(sim));
    } finally {
      twin.dispose();
    }
    // Break one module piece and shove another; both facts survive save and restore.
    const breakable = pieces.find(
      (id) => /-(jar|crate|pot|barrel|cask)-/.test(id) && !id.includes("volatile"),
    )!;
    sim.adventure.strikeProp(sim, "local", breakable, 5000, 0);
    sim.step(2);
    assert.ok(!world.has(breakable) && physical.isDestroyed(breakable));
    const loose = pieces.find(
      (id) =>
        id !== breakable &&
        world.has(id) &&
        world.pose(id).motion === "dynamic" &&
        !world.pose(id).assembly,
    )!;
    const at = world.pose(loose);
    world.place(loose, at.x + 30, at.y + 18);
    sim.step(2);
    const moved = world.pose(loose);
    for (const portable of [false, true]) {
      const restored = Simulation.restore(JSON.parse(JSON.stringify(sim.save(portable))));
      try {
        const w = restored.physical!.world;
        assert.ok(!w.has(breakable), "a broken piece never regenerates");
        assert.ok(Math.hypot(w.pose(loose).x - moved.x, w.pose(loose).y - moved.y) < 2);
        assert.deepEqual(restored.physical!.encounters, physical.encounters);
        assert.equal(restored.physical!.grammar, true);
        if (!portable) {
          sim.step(20);
          restored.step(20);
          assert.equal(restored.stateHash(), sim.stateHash());
        }
      } finally {
        restored.dispose();
      }
    }
    // Travel to the next land and back: the archived land keeps its breaks.
    sim.adventure.startArea(sim, 13);
    sim.step();
    assert.ok(sim.physical!.world.ids().some((id) => id.includes("-13-c0-")));
    sim.adventure.startArea(sim, 9);
    sim.step();
    assert.ok(!sim.physical!.world.has(breakable));
    assert.ok(sim.physical!.isDestroyed(breakable));
  } finally {
    sim.dispose();
  }
});

test("a real pre-M11 checkpoint in a generated land keeps its saved content; the next fresh land is generated", () => {
  // Made on main 03154c8 (M10): area 9 of seed 142 with crate-9-0 broken.
  const legacy = JSON.parse(
    gunzipSync(
      readFileSync(new URL("./fixtures/m10-generated-raw.json.gz", import.meta.url)),
    ).toString(),
  ) as SaveState;
  assert.equal(legacy.actorPhysics!.version, 8);
  const sim = Simulation.restore(structuredClone(legacy));
  try {
    const world = sim.physical!.world;
    assert.equal(sim.physical!.grammar, false);
    assert.ok(world.has("prop-gate-9-leaf"), "its M07 mechanisms stay");
    assert.ok(!world.has("crate-9-0") && sim.physical!.isDestroyed("crate-9-0"));
    assert.ok(!world.ids().some((id) => /-9-c\d-/.test(id)), "nothing generated over it");
    assert.equal(sim.save().actorPhysics!.version, 9);
    const again = Simulation.restore(structuredClone(sim.save()));
    try {
      assert.deepEqual(again.physical!.world.ids(), world.ids());
      assert.equal(again.physical!.grammar, false);
    } finally {
      again.dispose();
    }
    // The agent says why there is no manifest here.
    assert.throws(
      () => new AgentRuntime(sim).execute({ op: "encounters", action: "export", index: 9 }),
      /saved before generated encounters/,
    );
    sim.adventure.startArea(sim, 13);
    sim.step();
    assert.equal(sim.physical!.grammar, true);
    assert.ok(sim.physical!.world.ids().some((id) => /-13-c\d-/.test(id)));
  } finally {
    sim.dispose();
  }
});

test("a generated warden composes its moves, weaknesses, mounted armor and arena", () => {
  // An area whose warden has a water weakness from its second move (not its signature).
  let where: { seed: number; index: number } | null = null;
  for (const index of CORPUS_INDICES)
    for (const seed of CORPUS_SEEDS) {
      const plan = encounterPlan(areaRecipe(seed, index))!;
      if (
        !where &&
        plan.boss.weaknesses.includes("water") &&
        plan.boss.moves[0] !== "breath" &&
        plan.boss.armor === "bark"
      )
        where = { seed, index };
    }
  assert.ok(where, "the corpus has a bark-armored warden with a water weakness");
  const sim = quietArea(where.seed, where.index);
  try {
    const s = sim.adventure.state,
      plan = encounterPlan(s.recipe)!,
      physical = sim.physical!;
    assert.deepEqual(sim.adventure.wardenMoves(), plan.boss.moves);
    assert.ok(
      plan.boss.moves.length >= 2 && new Set(plan.boss.moves).size === plan.boss.moves.length,
    );
    for (const m of plan.boss.moves)
      assert.ok(
        plan.boss.weaknesses.includes(Object.values(WARDENS).find((w) => w.move === m)!.weakness),
      );
    // The arena kits stand around the warden's ground.
    const arena = physical.encounters.find((m) => m.index === s.recipe.index)!.arena;
    assert.deepEqual(
      arena.map((a) => a.kit),
      plan.boss.arena,
    );
    // Fought on dry ground near the arrival (its arena's flood pool would soak the bark first:
    // a wet plate steams instead of burning, so bark must burn before the warden is doused).
    const e = sim.adventure.spawnMonster(sim, plan.boss.rig, s.recipe.x - 150, s.recipe.y, {
      boss: true,
      hp: 8000,
      passive: true,
    });
    assert.equal(e.name, plan.boss.title);
    assert.equal(e.warden!.armor, plan.boss.pieces);
    sim.step(3);
    const pieces = physical.armorPieces(e);
    assert.equal(pieces.length, plan.boss.pieces);
    assert.equal(e.warden!.armor, 0, "armor is mounted once");
    assert.ok(pieces.every((id) => physical.world.pose(id).blueprint!.family === "plate"));
    const mounts = physical.showcase.list().filter((r) => r.kind === "mount");
    assert.equal(mounts.length, plan.boss.pieces);
    assert.ok(
      Math.abs(physical.armorFactor(e) - (1 - ARMOR_RULES.reduction * pieces.length)) < 1e-9,
    );
    // Armor absorbs part of a blow.
    const before = e.hp;
    sim.adventure.strikeEnemy(sim, "local", e.id, 100, 0);
    const armored = before - e.hp;
    assert.ok(armored < 100 && armored > 50, `armored blow ${armored}`);
    // The rotation: each slam turn takes the next composed move.
    e.attacks = 0;
    assert.equal(sim.adventure.nextMove(e), plan.boss.moves[0]);
    e.attacks = 3;
    assert.equal(sim.adventure.nextMove(e), plan.boss.moves[1]);
    // Fire strips bark: a burning plate burns away and the warden takes more of each blow.
    for (const id of pieces) assert.equal(physical.reactions.status(id)?.wet ?? 0, 0, `${id} dry`);
    for (const id of pieces) {
      const p = physical.world.pose(id);
      physical.stimulate(sim, "fire", {
        x: p.x,
        y: p.y,
        target: id,
        owner: "local",
        team: "party",
      });
    }
    for (let t = 0; t < 900 && physical.armorPieces(e).length; t++) sim.step();
    assert.equal(physical.armorPieces(e).length, 0, "the bark burnt away");
    assert.equal(physical.armorFactor(e), 1);
    // Its second move's weakness exposes it: doused, it staggers and takes more damage.
    physical.stimulate(sim, "water", { x: e.x, y: e.y, radius: 30, owner: "local", team: "party" });
    sim.step(2);
    assert.ok(e.warden!.exposedUntil > sim.tick, "water exposes it");
    const exposedBefore = e.hp;
    sim.adventure.strikeEnemy(sim, "local", e.id, 100, 0);
    assert.ok(exposedBefore - e.hp >= 140, "exposed and bare: 1.5× damage");
  } finally {
    sim.dispose();
  }
});

test("armor mounts snap under strain, fall loose with their warden and stay off where mechanisms are off", () => {
  const sim = quietArea(7, 13);
  try {
    const s = sim.adventure.state,
      plan = encounterPlan(s.recipe)!,
      physical = sim.physical!;
    const e = sim.adventure.spawnMonster(sim, plan.boss.rig, s.recipe.x + 130, s.recipe.y, {
      boss: true,
      hp: 8000,
      passive: true,
    });
    sim.step(3);
    const pieces = physical.armorPieces(e);
    assert.ok(pieces.length >= 2);
    // A violent yank on one piece snaps its tether: it becomes a loose prop.
    physical.world.motion(pieces[0], 900, 0);
    sim.step(2);
    assert.ok(!physical.showcase.list().some((r) => r.body === pieces[0]));
    assert.ok(physical.world.has(pieces[0]));
    assert.ok(
      physical.showcase.take().some((ev) => ev.text === "mount:snapped") ||
        !physical.armorPieces(e).includes(pieces[0]),
    );
    // The warden dies: every remaining mount is released and the pieces stay as loose props.
    sim.adventure.strikeEnemy(sim, "local", e.id, 1e5, 0);
    sim.step(2);
    assert.equal(physical.showcase.list().filter((r) => r.kind === "mount").length, 0);
    assert.ok(pieces.every((id) => physical.world.has(id) || physical.isDestroyed(id)));
    // Mechanisms off at the warden's ground: it fights unarmored.
    edit(sim, [
      {
        type: "override",
        scope: "area",
        id: `area-${s.recipe.index}`,
        values: { mechanisms: false },
      },
    ]);
    const bare = sim.adventure.spawnMonster(sim, plan.boss.rig, s.recipe.x + 130, s.recipe.y, {
      boss: true,
      hp: 8000,
      passive: true,
    });
    sim.step(3);
    assert.equal(physical.armorPieces(bare).length, 0);
    assert.equal(physical.armorFactor(bare), 1);
    assert.equal(bare.warden!.armor, 0, "the off state is not a pending backlog");
  } finally {
    sim.dispose();
  }
});

test("a struck cargo train cuts its tow ropes; its crate and barrel stay mechanism members and never break", () => {
  // Regression: a projectile that broke a cart's crate tried to remove an assembly member.
  const where = findCombos().get("rift-cart")!,
    sim = quietArea(where.seed, where.index);
  try {
    const physical = sim.physical!,
      world = physical.world,
      member = (family: string, tag: string) =>
        `prop-${family}-${where.index}-c${where.k}-0-${tag}`,
      cargo = [member("crate", "cargo"), member("barrel", "cargo"), member("wagon", "bed")];
    const intact = () =>
      world.jointList().filter((j) => !j.broken && j.recipe.a.includes(`-c${where.k}-0-`)).length;
    const before = intact();
    for (let n = 0; n < 4; n++)
      for (const id of cargo) sim.adventure.strikeProp(sim, "local", id, 5000, 0);
    sim.step(5);
    assert.ok(intact() < before, "the blows cut the tow ropes");
    for (const id of cargo) {
      assert.ok(world.has(id) && !physical.isDestroyed(id), `${id} stays in the scene`);
      assert.notEqual(world.pose(id).assembly, undefined);
    }
  } finally {
    sim.dispose();
  }
});

test("agent encounter tools catalog, preview, validate and export reproducible manifests; impossible placements fail visibly", () => {
  const sim = quietArea(142, 10);
  const agent = new AgentRuntime(sim);
  try {
    const catalog = agent.execute({ op: "encounters" }) as Record<string, Record<string, unknown>>;
    assert.equal(Object.keys(catalog.modules).length, MODULE_IDS.length);
    assert.equal(Object.keys(catalog.combinations).length, COMBINATION_IDS.length);
    assert.ok(catalog.kits["storm-coil"] && catalog.arenaKits["arena-pillars"]);
    const preview = agent.execute({ op: "encounters", action: "preview", index: 13 }) as {
      reproduce: { op: string }[];
      realized: { clusters: { combo: string }[] };
      rules: Record<string, unknown>;
      policies: { id: string; values: Record<string, unknown> }[];
      modules: { id: string }[];
    };
    assert.deepEqual(
      preview.reproduce.map((c) => c.op),
      ["reset", "encounter"],
    );
    assert.ok(preview.realized.clusters.length >= 2 && preview.modules.length > 10);
    assert.ok(Object.keys(preview.rules).length > 0 && preview.policies.length >= 2);
    // A manifest reproduces from its seed; a tampered one does not.
    const ok = agent.execute({ op: "encounters", action: "validate", manifest: preview }) as {
      ok: boolean;
      errors: string[];
    };
    assert.ok(ok.ok, ok.errors.join("; "));
    const tampered = structuredClone(preview);
    tampered.realized.clusters[0].combo = "rift-cart";
    const bad = agent.execute({ op: "encounters", action: "validate", manifest: tampered }) as {
      ok: boolean;
      errors: string[];
    };
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.some((e) => /does not reproduce/.test(e)));
    // Unknown references and impossible placements are errors, not silence.
    const plan = encounterPlan(areaRecipe(142, 13))!;
    const unknown = structuredClone(plan);
    unknown.fillers[0].modules = ["trebuchet" as never];
    const refused = agent.execute({
      op: "encounters",
      action: "validate",
      seed: 142,
      plan: unknown,
    }) as {
      ok: boolean;
      errors: string[];
    };
    assert.equal(refused.ok, false);
    assert.match(refused.errors[0], /unknown module trebuchet/);
    // Rift freight needs an arch; an area without Riftstep cannot stand it anywhere.
    const noRift = CORPUS_INDICES.find((i) => !areaRecipe(142, i).mechanics.includes("rift"))!;
    const impossible = encounterPlan(areaRecipe(142, noRift))!;
    impossible.clusters[0].combos = ["rift-cart"];
    const placed = agent.execute({
      op: "encounters",
      action: "validate",
      seed: 142,
      plan: impossible,
    }) as { ok: boolean; errors: string[] };
    assert.equal(placed.ok, false);
    assert.ok(
      placed.errors.some((e) => /impossible placement/.test(e)),
      placed.errors.join("; "),
    );
    // Export: the live land's manifest as built, its policies and its mutations.
    const live = agent.execute({ op: "encounters", action: "export" }) as {
      realized: { index: number };
      policies: { values: unknown }[];
      mutations: { destroyed: { id: string }[] };
      modules: { id: string; assembly?: string }[];
    };
    assert.equal(live.realized.index, 10);
    assert.ok(live.policies.every((p) => p.values !== null));
    const piece = live.modules.find((m) => /-(jar|crate|pot|cask)-/.test(m.id) && !m.assembly)!;
    sim.adventure.strikeProp(sim, "local", piece.id, 5000, 0);
    sim.step(2);
    const after = agent.execute({ op: "encounters", action: "export" }) as typeof live;
    assert.ok(after.mutations.destroyed.some((d) => d.id === piece.id));
    assert.ok(COMBINATION_IDS.length === Object.keys(CLUSTERS).length);
  } finally {
    sim.dispose();
  }
});

test("a late-join replica receives the generated encounter, its regions and a warden's armor", () => {
  const sim = quietArea(2026, 17);
  try {
    const s = sim.adventure.state,
      plan = encounterPlan(s.recipe)!;
    sim.adventure.spawnMonster(sim, plan.boss.rig, s.recipe.x + 130, s.recipe.y, {
      boss: true,
      hp: 8000,
      passive: true,
    });
    sim.step(3);
    const guest = new Simulation(2026, 0);
    try {
      guest.applyReplica(JSON.parse(JSON.stringify(sim.save(true))) as SaveState);
      assert.deepEqual(guest.physicalEncounters(), sim.physical!.encounters);
      const ids = new Set(guest.replicaPhysics!.world.bodies.map((b) => b.recipe.id));
      for (const id of sim.physical!.world.ids().filter((i) => /-17-(c\d|a\d|m-)/.test(i)))
        assert.ok(ids.has(id), id);
      assert.equal(
        [...guest.physicalRestraints()].filter((r) => r.kind === "mount").length,
        plan.boss.pieces,
      );
      const regions = guest.physicalRegions().filter((r) => r.id.startsWith("combo-17-"));
      assert.equal(regions.length, plan.clusters.length);
      const exported = new AgentRuntime(guest).execute({
        op: "encounters",
        action: "export",
        index: 17,
      }) as { realized: { index: number } };
      assert.equal(exported.realized.index, 17);
    } finally {
      guest.dispose();
    }
  } finally {
    sim.dispose();
  }
});
