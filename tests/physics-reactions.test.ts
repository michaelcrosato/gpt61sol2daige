import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { AgentRuntime, replay } from "../src/engine/agent.ts";
import { type SaveState, Simulation } from "../src/engine/simulation.ts";
import type { Enemy } from "../src/game/types.ts";
import { initializePhysics } from "../src/physics/bootstrap.ts";
import type { PolicyEdit } from "../src/physics/policies.ts";
import { REACTION_LAYOUT, RULES, reactionExport } from "../src/physics/reactions.ts";

await initializePhysics();
/** Area 1 with no monsters and no area mechanics; the traveler waits at the entry. */
function arena(index = 1) {
  const sim = new Simulation(142, 0);
  sim.addPlayer("local");
  sim.adventure.startArea(sim, index);
  sim.step();
  const s = sim.adventure.state;
  s.enemies = [];
  s.spawned = s.recipe.killGoal;
  s.mechanics = [];
  return { sim, s, r: s.recipe, world: sim.physical!.world, physical: sim.physical! };
}
function edit(sim: Simulation, edits: PolicyEdit[]) {
  const physical = sim.physical!;
  physical.configure({ expectedRevision: physical.world.policyState().nextRevision, edits });
  physical.world.applyPolicies(physical.world.policyState().nextRevision);
  physical.begin(sim);
}
const area = (values: Record<string, unknown>): PolicyEdit => ({
  type: "override",
  scope: "area",
  id: "area-1",
  values,
});
const reset: PolicyEdit = { type: "reset", scope: "area", id: "area-1", to: "inherited" };
/** A rooted, passive monster at a point (its body exists after one step). */
function monster(sim: Simulation, x: number, y: number, hp = 400): Enemy {
  const s = sim.adventure.state;
  (sim.adventure as unknown as { spawnEnemy: (...a: unknown[]) => void }).spawnEnemy(
    sim,
    1,
    x,
    y,
    false,
    false,
  );
  const e = s.enemies.at(-1)!;
  e.x = x;
  e.y = y;
  e.hp = e.maxHp = hp;
  e.rootUntil = 1e9;
  e.nextAttack = 1e9;
  return e;
}
const texts = (sim: Simulation) => sim.physical!.reactions.save().history.map((e) => e.text);
const at = (sim: Simulation, id: string) => sim.physical!.world.pose(id);

test("every area carries a reaction yard and an authored wind lane; the registry is complete", () => {
  const { sim, r, world, physical } = arena();
  try {
    for (let a = 1; a <= 4; a++)
      for (const p of REACTION_LAYOUT) assert.ok(world.has(`prop-${p.family}-${a}-${p.n}`));
    assert.deepEqual(
      physical.reactions
        .fieldList()
        .filter((f) => f.source === "authored")
        .map((f) => f.id),
      ["wind-1", "wind-2", "wind-3", "wind-4"],
    );
    // The yard sits south of the entry → centre → portal route, clear of required travel.
    for (const p of REACTION_LAYOUT) {
      const pose = at(sim, `prop-${p.family}-1-${p.n}`);
      assert.ok(pose.y - r.y > 90, `${pose.id} is off the route`);
    }
    const registry = reactionExport();
    assert.deepEqual(registry.stimuli, ["fire", "water", "oil", "shock", "blast"]);
    for (const rule of Object.values(registry.rules)) assert.ok(rule.when && rule.result);
    assert.equal(registry.materials.metal.conductive, true);
    assert.equal(registry.materials.wood.flammable, true);
    assert.equal(registry.containers.cask, "water");
    assert.deepEqual(Object.keys(registry.fields), [
      "wind",
      "pressure",
      "attract",
      "repel",
      "vortex",
    ]);
  } finally {
    sim.dispose();
  }
});

test("fire ignites and burns scenery down, water puts it out, and wet scenery steams instead", () => {
  const { sim, physical } = arena();
  try {
    const id = "crate-1-0",
      pose = at(sim, id);
    physical.stimulate(sim, "fire", {
      x: pose.x,
      y: pose.y,
      target: id,
      owner: "local",
      team: "party",
    });
    assert.ok(physical.reactions.status(id)!.burning > 0);
    assert.ok(texts(sim).includes("ignite:wood"));
    sim.step(65);
    const burnt = at(sim, id).consequences!.durability!;
    assert.ok(burnt < 100, "burn pulses cost durability");
    physical.stimulate(sim, "water", { x: pose.x, y: pose.y, radius: 20, owner: "local" });
    const doused = physical.reactions.status(id)!;
    assert.equal(doused.burning, 0);
    assert.ok(doused.wet > 0);
    assert.ok(texts(sim).includes("extinguish"));
    sim.step(60);
    assert.equal(at(sim, id).consequences!.durability, burnt, "no fire damage once doused");
    // A new flame on the wet barrel only boils some water off.
    physical.stimulate(sim, "fire", { x: pose.x, y: pose.y, target: id, owner: "local" });
    assert.equal(physical.reactions.status(id)!.burning, 0);
    assert.ok(texts(sim).includes("steam"));
  } finally {
    sim.dispose();
  }
});

test("a struck coil conducts through rods and a spilled puddle into wet monsters, credited to the striker", () => {
  const { sim, physical } = arena();
  try {
    const cask = at(sim, "prop-cask-1-0");
    // Break the cask: its water spills over the first rod and the monster standing beside it.
    sim.adventure.strikeProp(sim, "local", cask.id, 500);
    sim.step(1);
    const puddle = physical.reactions.surfaceList().find((s) => s.kind === "water")!;
    assert.ok(puddle, "the cask spilled a puddle");
    const wet = monster(sim, puddle.x - 10, puddle.y + 4),
      dry = monster(sim, cask.x - 140, cask.y - 30);
    sim.step(20);
    assert.ok(
      physical.reactions.status(`enemy-${wet.id}`)!.wet > 0,
      "standing in the puddle soaks it",
    );
    const before = { wet: wet.hp, dry: dry.hp };
    sim.adventure.strikeProp(sim, "local", "prop-coil-1-0", 20);
    sim.step(30);
    const chain = physical.reactions.save().chains.find((c) => c.origin === "coil")!;
    assert.equal(chain.owner, "local");
    assert.ok(chain.rules.includes("conduct"));
    assert.ok(
      chain.visited.includes(`conduct|enemy-${wet.id}`),
      "the discharge reached the monster",
    );
    assert.ok(wet.hp < before.wet, "shocked through the water");
    assert.equal(dry.hp, before.dry, "a dry monster away from conductors is untouched");
    assert.ok(texts(sim).filter((t) => t === "conduct:arc").length >= 3);
  } finally {
    sim.dispose();
  }
});

test("an explosion pushes, damages and kills with the igniter's credit, then breaks and ignites what it reaches", () => {
  const { sim, physical, world } = arena();
  try {
    const keg = at(sim, "prop-barrel-1-2");
    const victim = monster(sim, keg.x - 30, keg.y + 10, 20),
      bystander = monster(sim, keg.x + 40, keg.y - 46, 5000);
    sim.step(1);
    const stood = { x: bystander.x, y: bystander.y };
    const cask = at(sim, "prop-cask-1-1");
    physical.stimulate(sim, "fire", {
      x: keg.x,
      y: keg.y,
      target: keg.id,
      owner: "local",
      team: "party",
    });
    assert.ok(physical.reactions.status(keg.id)!.fuse > 0, "a volatile lights a fuse");
    sim.step(RULES.detonate.params.fuse + 4);
    assert.ok(texts(sim).includes("blast"));
    assert.ok(physical.isDestroyed(keg.id));
    assert.equal(victim.hp, 0, "the blast killed the monster");
    assert.ok(
      sim.adventure.state.events.some((e) => e.type === "kill" && e.owner === "local"),
      "and the kill is the igniter's",
    );
    // Pressure pushes; blast damage breaks the nearby cask (which then spills) with credit.
    const destroyed = physical.destroyedRecords();
    assert.ok(
      destroyed.some((d) => d.id === cask.id && d.owner === "local" && d.cause === "blast"),
    );
    assert.ok(physical.reactions.surfaceList().some((s) => s.id === `water-${cask.id}`));
    // The pressure field threw the surviving monster away from the blast.
    assert.ok(bystander.hp > 0 && bystander.hp < 5000);
    const away =
      (bystander.x - stood.x) * (stood.x - keg.x) + (bystander.y - stood.y) * (stood.y - keg.y);
    assert.ok(
      away > 0 && Math.hypot(bystander.x - stood.x, bystander.y - stood.y) > 4,
      "pushed outward",
    );
    const piece = world.ids().find((id) => id.startsWith(`${keg.id}-`));
    assert.ok(piece, "the keg left pieces");
  } finally {
    sim.dispose();
  }
});

test("fire runs the brush fuse into the keg: a reproducible multi-rule chain with causes and credit", () => {
  const run = () => {
    const { sim, physical } = arena();
    const brush = at(sim, "prop-brush-1-0");
    const e = monster(
      sim,
      at(sim, "prop-barrel-1-2").x + 24,
      at(sim, "prop-barrel-1-2").y - 20,
      30,
    );
    physical.stimulate(sim, "fire", {
      x: brush.x,
      y: brush.y,
      target: brush.id,
      owner: "local",
      team: "party",
    });
    sim.step(260);
    const state = physical.reactions.save(),
      chain = state.chains.find((c) => c.origin === "fire" && c.owner === "local")!;
    const result = {
      events: state.history.map((h) => `${h.tick}:${h.rule}:${h.text}:${h.target}`),
      chain,
      destroyed: physical.destroyedRecords().map((d) => `${d.id}:${d.owner}:${d.cause}`),
      dead: e.hp <= 0,
      hash: sim.stateHash(),
    };
    sim.dispose();
    return result;
  };
  const first = run(),
    second = run();
  assert.deepEqual(second, first, "the same chain from the same scene");
  const { chain } = first;
  assert.equal(chain.owner, "local");
  // ignite → spread along the brush → detonate the keg → spill the casks it breaks.
  for (const rule of ["ignite", "spread", "detonate", "spill"] as const)
    assert.ok(chain.rules.includes(rule), `${rule} fired`);
  assert.ok(new Set(chain.rules).size >= 4);
  assert.ok(chain.depth >= 4, "the chain reached several steps");
  assert.ok(first.dead, "the blast at the end of the fuse killed the monster");
  assert.ok(first.destroyed.includes("prop-barrel-1-2:local:blast"));
  assert.ok(
    first.destroyed.some((d) => d.startsWith("prop-brush-1-") && d.endsWith(":local:fire")),
  );
});

test("chain reactions off keeps the direct effect only; material reactions off pauses timers but not combat", () => {
  const { sim, physical, s } = arena();
  try {
    edit(sim, [area({ chainReactions: false })]);
    const brush = at(sim, "prop-brush-1-0");
    physical.stimulate(sim, "fire", { x: brush.x, y: brush.y, target: brush.id, owner: "local" });
    assert.ok(physical.reactions.status(brush.id)!.burning > 0, "the direct ignition happens");
    sim.step(200);
    assert.equal(physical.reactions.status("prop-brush-1-1")?.burning ?? 0, 0, "no spread");
    sim.adventure.strikeProp(sim, "local", "prop-coil-1-0", 20);
    sim.step(20);
    const coil = physical.reactions.save().chains.find((c) => c.origin === "coil")!;
    assert.deepEqual(coil.visited, ["conduct|prop-coil-1-0"], "the discharge stays at its source");
    // Material reactions off: a burning body's timer waits; new stimuli do nothing.
    const log = at(sim, "prop-log-1-0");
    edit(sim, [reset]);
    physical.stimulate(sim, "fire", { x: log.x, y: log.y, target: log.id, owner: "local" });
    sim.step(3);
    edit(sim, [area({ materialReactions: false })]);
    const crate = at(sim, "crate-1-0");
    physical.stimulate(sim, "fire", { x: crate.x, y: crate.y, target: crate.id, owner: "local" });
    assert.equal(physical.reactions.status(crate.id), null, "no new status");
    const paused = physical.reactions.status(log.id)!;
    assert.ok(paused.burning > 0);
    const durability = at(sim, log.id).consequences?.durability;
    sim.step(120);
    assert.deepEqual(physical.reactions.status(log.id), paused, "its remaining burn is paused");
    assert.equal(at(sim, log.id).consequences?.durability, durability, "and does no damage");
    // Base combat still works: a slash hurts a monster and Cinderwake's burning strike burns it.
    const e = monster(sim, s.recipe.x, s.recipe.y);
    sim.step(1);
    const hp = e.hp;
    s.heroes.local.burnUntil = sim.tick + 300;
    const p = sim.players.get("local")!;
    p.x = e.x - 20;
    p.y = e.y;
    p.facing = 0;
    sim.physical!.teleport("player-local", p.x, p.y);
    (sim.adventure as unknown as { attack: (...a: unknown[]) => void }).attack(sim, p, "slash");
    assert.ok(e.hp < hp, "the sword still lands");
    assert.ok(e.burnUntil > sim.tick, "Cinderwake's combat burn still applies");
    // Re-enable: no backlog of reactions from the paused period.
    edit(sim, [reset]);
    const before = physical.reactions.save().history.length;
    sim.step(2);
    const burst = physical.reactions.save().history.length - before;
    assert.ok(burst <= 2, `no accumulated burst (${burst} events)`);
  } finally {
    sim.dispose();
  }
});

test("a region's policy is checked at the reaction's source and its target", () => {
  const { sim, physical } = arena();
  try {
    const b2 = at(sim, "prop-brush-1-2");
    edit(sim, [
      {
        type: "region",
        profile: {
          id: "fuse-gap",
          areaId: "area-1",
          priority: 5,
          shape: { kind: "circle", x: b2.x, y: b2.y, radius: 9 },
          values: { materialReactions: false },
        },
      },
    ]);
    const brush = at(sim, "prop-brush-1-0");
    physical.stimulate(sim, "fire", { x: brush.x, y: brush.y, target: brush.id, owner: "local" });
    sim.step(220);
    const chain = physical.reactions.save().chains.find((c) => c.origin === "fire")!;
    assert.ok(chain.rules.includes("spread"), "the fire spread up to the protected segment");
    assert.equal(
      physical.reactions.status(b2.id)?.burning ?? 0,
      0,
      "the protected segment never caught",
    );
    assert.equal(
      physical.reactions.status("prop-barrel-1-2")?.fuse ?? 0,
      0,
      "the fuse stopped at the gap",
    );
  } finally {
    sim.dispose();
  }
});

test("fans, wind lanes and mechanic fields push bodies; a fan bends a monster's charge", () => {
  const blown = (forces: boolean) => {
    const { sim, physical, world } = arena();
    if (!forces) edit(sim, [area({ environmentalForces: false })]);
    const fan = at(sim, "prop-fan-1-0");
    const e = monster(sim, fan.x + 60, fan.y - 8);
    e.rootUntil = 0;
    e.target = "local";
    sim.step(1);
    sim.adventure.strikeProp(sim, "local", fan.id, 10);
    const start = { x: e.x, y: e.y };
    const cask = at(sim, "prop-cask-1-0");
    sim.step(60);
    const result = {
      monster: Math.hypot(e.x - start.x, e.y - start.y),
      monsterAlong: e.x - start.x,
      cask: Math.hypot(at(sim, cask.id).x - cask.x, at(sim, cask.id).y - cask.y),
      fields: physical.reactions.fieldList().map((f) => f.id),
    };
    void world;
    sim.dispose();
    return result;
  };
  const on = blown(true),
    off = blown(false);
  assert.ok(on.fields.includes("fan:prop-fan-1-0"));
  assert.ok(on.cask > off.cask + 30, `the fan blew the cask away (${on.cask} vs ${off.cask})`);
  assert.ok(on.monsterAlong > off.monsterAlong + 20, "the monster was driven downwind");
  // The authored wind lane spins the meadow vane faster than its motor alone.
  const { sim, world } = arena();
  try {
    sim.step(240);
    const spun = Math.abs(world.pose("prop-vane-1-rotor").angularVelocity);
    edit(sim, [area({ environmentalForces: false })]);
    sim.step(240);
    const calm = Math.abs(world.pose("prop-vane-1-rotor").angularVelocity);
    assert.ok(spun > calm + 0.3, `wind turns the vane (${spun.toFixed(2)} vs ${calm.toFixed(2)})`);
  } finally {
    sim.dispose();
  }
  // A Gravity Knot gathers loose props; field strength scales it per region.
  const gather = (strength: number) => {
    const { sim, physical, world, r } = arena();
    if (strength !== 1) edit(sim, [area({ fieldStrength: strength })]);
    const pot = at(sim, "prop-pot-1-0");
    physical.reactions.addField({
      id: "test-knot",
      kind: "attract",
      areaId: "area-1",
      shape: { kind: "circle", x: r.x, y: r.y, radius: 200 },
      strength: 340,
      ticks: 60,
      gust: 0,
      actors: false,
      owner: "local",
      team: "party",
      source: "test",
    });
    sim.step(60);
    const after = world.pose(pot.id);
    const d = Math.hypot(pot.x - r.x, pot.y - r.y) - Math.hypot(after.x - r.x, after.y - r.y);
    sim.dispose();
    return d;
  };
  const full = gather(1),
    none = gather(0);
  assert.ok(full > 10, `the pot was drawn in (${full.toFixed(1)})`);
  assert.ok(Math.abs(none) < 1, "field strength 0 stops it");
});

test("statuses, surfaces, fields and mid-chain timers survive saves, replay, late join and land recall", () => {
  const { sim, physical } = arena();
  const agent = new AgentRuntime(sim);
  try {
    sim.step(1);
    agent.beginRecording();
    agent.execute({ op: "actors", action: "damage", id: "prop-cask-1-0", damage: 500 });
    agent.execute({ op: "actors", action: "stimulate", stimulus: "fire", id: "prop-brush-1-0" });
    agent.execute({
      op: "actors",
      action: "field",
      field: {
        id: "agent-gust",
        kind: "wind",
        shape: { kind: "lane", x: 900, y: 120, angle: 0, length: 200, width: 80 },
        strength: 300,
        ticks: 600,
      },
    });
    agent.execute({ op: "step", ticks: 40 });
    const mid = physical.reactions.save();
    assert.ok(mid.delayed.length || mid.statuses.some((s) => s.burning), "saved mid-chain");
    assert.ok(mid.surfaces.length && mid.fields.some((f) => f.id === "agent-gust"));
    replay(agent.execute({ op: "replay" }) as Parameters<typeof replay>[0]).dispose();
    for (const portable of [false, true]) {
      const now = physical.reactions.save();
      const restored = Simulation.restore(
        JSON.parse(JSON.stringify(sim.save(portable))) as SaveState,
      );
      try {
        assert.deepEqual(restored.physical!.reactions.save(), now);
        if (!portable) {
          sim.step(120);
          restored.step(120);
          assert.equal(restored.stateHash(), sim.stateHash());
          assert.deepEqual(restored.physical!.reactions.save(), physical.reactions.save());
        }
      } finally {
        restored.dispose();
      }
    }
    // A guest receives the complete reaction state with the scene.
    const guest = new Simulation(142, 0);
    try {
      guest.applyReplica(JSON.parse(JSON.stringify(sim.save(true))) as SaveState);
      assert.deepEqual(guest.replicaPhysics!.reactions, physical.reactions.save());
      const view = guest.physicalReactions();
      assert.equal(view.surfaces.length, physical.reactions.surfaceList().length);
      assert.equal(view.fields.length, physical.reactions.fieldList().length);
      const guestAgent = new AgentRuntime(guest);
      const seen = guestAgent.execute({ op: "actors", action: "reactions" }) as {
        state: { statuses: unknown[] };
      };
      assert.equal(seen.state.statuses.length, physical.reactions.statusList().length);
      assert.throws(
        () =>
          guestAgent.execute({ op: "actors", action: "stimulate", stimulus: "fire", x: 0, y: 0 }),
        /host/,
      );
    } finally {
      guest.dispose();
    }
    // Leave for another land and return: reaction state waits with relative timers.
    const burning = physical.reactions.statusList().filter((s) => s.burning);
    sim.adventure.startArea(sim, 5);
    sim.step(300);
    assert.ok(sim.physical!.world.has("prop-coil-5-0"));
    sim.adventure.startArea(sim, 1);
    sim.step(1);
    const back = sim.physical!.reactions;
    for (const s of burning) {
      const now = back.status(s.id);
      if (sim.physical!.world.has(s.id)) assert.ok(now && now.burning > 0, `${s.id} still burning`);
    }
    assert.ok(
      back.surfaceList().some((s) => s.kind === "water"),
      "the puddle is still there",
    );
  } finally {
    sim.dispose();
  }
});

test("real M07 checkpoints migrate: yards and wind lanes join once, archived lands gain them on return", () => {
  const legacy = JSON.parse(
    gunzipSync(readFileSync(new URL("./fixtures/m07-raw.json.gz", import.meta.url))).toString(),
  ) as SaveState;
  assert.equal(legacy.actorPhysics!.version, 5);
  assert.equal(legacy.actorPhysics!.world.version, 7);
  const sim = Simulation.restore(structuredClone(legacy));
  try {
    const world = sim.physical!.world;
    assert.ok(world.has("prop-coil-5-0") && world.has("prop-brazier-8-0"));
    assert.ok(sim.physical!.reactions.hasField("wind-5"));
    assert.deepEqual(sim.physical!.destroyedRecords(), legacy.actorPhysics!.destroyed);
    const saved = sim.save();
    assert.equal(saved.actorPhysics!.version, 7);
    assert.equal(saved.actorPhysics!.world.version, 9);
    const archive = saved.actorPhysics!.archives.find((a) => a.id === "land-1-0")!;
    assert.equal(archive.reactions, undefined, "an archived pre-M08 land stays as it was saved");
    const again = Simulation.restore(structuredClone(saved));
    try {
      assert.deepEqual(again.physical!.world.ids(), world.ids(), "nothing added twice");
    } finally {
      again.dispose();
    }
    // Policy samples gained the M08 controls with their defaults.
    assert.equal(world.policyOf("prop-coil-5-0").effective.materialReactions, true);
    assert.equal(world.policyOf("prop-gate-5-leaf").values.fieldStrength, 1);
    sim.adventure.startArea(sim, 1);
    sim.step(1);
    assert.ok(sim.physical!.world.has("prop-coil-1-0"), "returning adds the land's yard");
    assert.ok(sim.physical!.reactions.hasField("wind-1"));
    assert.equal(sim.physical!.world.joint("vine-1:seg3").broken, true, "and keeps its M07 state");
    assert.ok(!sim.physical!.world.has("prop-pot-1-0"), "and its destruction");
  } finally {
    sim.dispose();
  }
});
