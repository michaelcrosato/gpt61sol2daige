import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { AgentRuntime, replay } from "../src/engine/agent.ts";
import { type SaveState, Simulation } from "../src/engine/simulation.ts";
import { encodeSnapshot, PROTOCOL_VERSION } from "../src/net/protocol.ts";
import {
  blueprintExport,
  CLEARING_LAYOUT,
  FAMILIES,
  PALETTES,
  PROP_FAMILIES,
} from "../src/physics/blueprints.ts";
import { initializePhysics } from "../src/physics/bootstrap.ts";
import { MATERIAL_IDS, MATERIALS } from "../src/physics/materials.ts";
import type { PolicyEdit } from "../src/physics/policies.ts";

await initializePhysics();
function scene() {
  const sim = new Simulation(142, 0);
  sim.addPlayer("local");
  sim.adventure.startArea(sim, 1);
  sim.adventure.state.enemies = [];
  sim.adventure.state.spawned = sim.adventure.state.recipe.killGoal;
  sim.step();
  return sim;
}
function edit(sim: Simulation, edits: PolicyEdit[]) {
  const physical = sim.physical!;
  physical.configure({ expectedRevision: physical.world.policyState().nextRevision, edits });
  physical.world.applyPolicies(physical.world.policyState().nextRevision);
  physical.begin(sim);
}
const strike = (sim: Simulation, id: string, damage: number, angle = 0) =>
  sim.adventure.strikeProp(sim, "local", id, damage, angle);
const breakEvents = (sim: Simulation) =>
  sim.adventure.state.events.filter((e) => e.type === "break").map((e) => e.text);
const goldDrops = (sim: Simulation) =>
  sim.adventure.state.drops.filter((d) => d.kind === "gold").reduce((n, d) => n + d.amount, 0);
const fixture = (name: string) =>
  JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))).toString());

test("material and blueprint registries cover every family with five land variants and export reproducibly", () => {
  assert.deepEqual(Object.keys(MATERIALS), [...MATERIAL_IDS]);
  for (const family of PROP_FAMILIES) {
    const recipe = FAMILIES[family];
    assert.equal(recipe.variants.length, PALETTES);
    if (family !== "debris") assert.equal(new Set(recipe.variants).size, PALETTES, family);
    for (const piece of recipe.pieces) assert.ok(PROP_FAMILIES.includes(piece.family));
  }
  const first = JSON.stringify(blueprintExport());
  assert.equal(first, JSON.stringify(blueprintExport()));
  assert.equal(JSON.parse(first).layout.length, CLEARING_LAYOUT.length);
  const sim = scene();
  try {
    const families = new Set(sim.physical!.props().map((p) => p.blueprint?.family));
    for (const family of [
      "crate",
      "barrel",
      "pot",
      "log",
      "stone",
      "wheel",
      "wagon",
      "fence",
      "pylon",
      "lantern",
      "tree",
    ])
      assert.ok(families.has(family as never), family);
    for (const p of sim.physical!.props()) {
      assert.ok(p.material && p.blueprint, p.id);
      assert.equal(p.blueprint!.palette, 0);
      assert.equal(
        p.consequences?.durability,
        FAMILIES[p.blueprint!.family].toughness ? 100 : undefined,
      );
    }
    const agent = new AgentRuntime(sim);
    assert.equal(JSON.stringify(agent.execute({ op: "actors", action: "recipes" })), first);
  } finally {
    sim.dispose();
  }
});

test("a crate splinters, a glass pylon shatters, stone resists a weak hit and a tree leaves a stump and pushable log", () => {
  const sim = scene();
  try {
    const physical = sim.physical!;
    // Crate: two splitting hits, wood splinters into four gameplay planks and one reward.
    const first = strike(sim, "crate-1-0", 30)[0];
    assert.equal(first.stage, 2);
    assert.ok(first.durability > 0 && first.durability < 100);
    const crate = strike(sim, "crate-1-0", 30)[0];
    assert.ok(crate.broken);
    assert.equal(crate.broken.pieces.length, 4);
    assert.ok(!physical.world.has("crate-1-0"));
    for (const id of crate.broken.pieces) {
      const piece = physical.world.pose(id);
      assert.equal(piece.blueprint?.parent, "crate-1-0");
      assert.equal(piece.material, "wood");
      assert.equal(piece.motion, "dynamic");
    }
    assert.ok(crate.broken.reward > 0);
    // Glass pylon: one hit shatters it into five shards.
    const pylon = strike(sim, "prop-pylon-1-0", 20)[0];
    assert.ok(pylon.broken);
    assert.equal(pylon.broken.pieces.length, 5);
    assert.ok(pylon.broken.pieces.every((id) => physical.world.pose(id).material === "glass"));
    // Stone: a weak hit is resisted and changes nothing.
    const stone = strike(sim, "prop-stone-1-0", 15)[0];
    assert.equal(stone.resisted, true);
    assert.equal(stone.durability, 100);
    assert.equal(physical.world.pose("prop-stone-1-0").consequences?.durability, 100);
    assert.ok(
      sim.adventure.state.events.some((e) => e.type === "impact" && e.text === "stone:resisted"),
    );
    assert.ok(strike(sim, "prop-stone-1-0", 60)[0].durability < 100, "a strong hit chips stone");
    // Tree: falls away from the hit as a fixed stump and a dynamic log.
    let tree = strike(sim, "prop-tree-1-0", 40, 0.5)[0];
    for (let n = 0; n < 10 && !tree.broken; n++) tree = strike(sim, "prop-tree-1-0", 40, 0.5)[0];
    assert.deepEqual(tree.broken?.pieces, ["prop-tree-1-0-stump", "prop-tree-1-0-log"]);
    const stump = physical.world.pose("prop-tree-1-0-stump"),
      log = physical.world.pose("prop-tree-1-0-log");
    assert.equal(stump.motion, "fixed");
    assert.equal(stump.blueprint?.family, "stump");
    assert.equal(log.motion, "dynamic");
    assert.equal(log.blueprint?.family, "log");
    assert.ok(Math.cos(Math.atan2(log.y - stump.y, log.x - stump.x) - 0.5) > 0.9, "falls away");
    assert.equal(log.consequences?.durability, 100, "the fallen log is new breakable timber");
    sim.step(60);
    const rest = physical.world.pose("prop-tree-1-0-log");
    physical.world.impulse("prop-tree-1-0-log", 0, 400);
    sim.step(20);
    assert.ok(physical.world.pose("prop-tree-1-0-log").y > rest.y + 2, "the log can be pushed");
    assert.deepEqual(breakEvents(sim), ["crate:wood", "pylon:glass", "tree:wood"]);
    assert.deepEqual(
      physical.destroyedRecords().map((d) => d.id),
      ["crate-1-0", "prop-pylon-1-0", "prop-tree-1-0"],
    );
  } finally {
    sim.dispose();
  }
});

test("disabling destruction keeps damage and prevents breakage; disabling dynamics freezes pieces without a parent", () => {
  const sim = scene();
  try {
    const physical = sim.physical!;
    const damaged = strike(sim, "crate-1-1", 25)[0].durability;
    edit(sim, [{ type: "override", scope: "area", id: "area-1", values: { destruction: false } }]);
    for (let n = 0; n < 5; n++) {
      const hit = strike(sim, "crate-1-1", 200)[0];
      assert.equal(hit.protectedByPolicy, true);
      assert.equal(hit.broken, null);
    }
    assert.equal(physical.world.pose("crate-1-1").consequences?.durability, damaged);
    assert.equal(physical.world.pose("crate-1-1").policy.effective.destruction, false);
    edit(sim, [{ type: "reset", scope: "area", id: "area-1", to: "inherited" }]);
    const broken = strike(sim, "crate-1-1", 200)[0].broken!;
    assert.ok(broken);
    edit(sim, [{ type: "override", scope: "area", id: "area-1", values: { dynamicProps: false } }]);
    sim.step(10);
    for (const id of broken.pieces) assert.equal(physical.world.pose(id).frozen, true);
    assert.ok(!physical.world.has("crate-1-1"), "freezing never reconstructs the parent");
    edit(sim, [{ type: "reset", scope: "area", id: "area-1", to: "inherited" }]);
    sim.step(10);
    for (const id of broken.pieces) assert.equal(physical.world.pose(id).frozen, false);
    assert.ok(!physical.world.has("crate-1-1"));
    // Breaking while frozen leaves pieces frozen in place instead of flying.
    edit(sim, [{ type: "override", scope: "area", id: "area-1", values: { dynamicProps: false } }]);
    const pot = strike(sim, "prop-pot-1-0", 30)[0].broken!;
    sim.step(5);
    for (const id of pot.pieces) assert.equal(physical.world.pose(id).frozen, true);
    // Every family's fracture starts disjoint: pieces frozen at the instant of breaking wake.
    const parents = physical
      .props()
      .filter((p) => p.areaId === "area-1" && FAMILIES[p.blueprint!.family].toughness > 0)
      .map((p) => p.id);
    const pieces = parents.flatMap((id) => strike(sim, id, 10_000)[0].broken!.pieces);
    assert.ok(pieces.length > 40);
    for (const id of pieces) {
      const piece = physical.world.pose(id);
      assert.equal(piece.frozen, piece.motion === "dynamic", id); // Stumps are fixed scenery.
    }
    edit(sim, [{ type: "reset", scope: "area", id: "area-1", to: "inherited" }]);
    for (const id of pieces) {
      const piece = physical.world.pose(id);
      assert.equal(piece.reactivationBlocked, false, id);
      assert.equal(piece.frozen, false, id);
    }
    // Master off is absolute.
    edit(sim, [{ type: "reset", scope: "area", id: "area-1", to: "inherited" }]);
    physical.configure({
      expectedRevision: physical.world.policyState().nextRevision,
      edits: [{ type: "master", enabled: false }],
    });
    physical.world.applyPolicies(physical.world.policyState().nextRevision);
    physical.begin(sim);
    assert.equal(strike(sim, "crate-2-0", 300)[0].protectedByPolicy, true);
    assert.ok(physical.world.has("crate-2-0"));
  } finally {
    sim.dispose();
  }
});

test("material toughness and debris lifetime come from region policy and debris expires on the tick", () => {
  const sim = scene();
  try {
    const physical = sim.physical!;
    edit(sim, [
      {
        type: "override",
        scope: "area",
        id: "area-1",
        values: { materialDurability: 4, debrisLifetime: 2 },
      },
    ]);
    const tough = strike(sim, "crate-1-2", 30)[0];
    assert.ok(Math.abs(tough.durability - (100 - (30 / 4 / 40) * 100)) < 1e-9);
    const broken = strike(sim, "prop-pot-1-0", 200)[0].broken!;
    const expires = physical.world.pose(broken.pieces[0]).blueprint!.expiresAt!;
    assert.equal(expires, sim.tick + 120);
    while (sim.tick < expires - 1) sim.step();
    assert.ok(broken.pieces.every((id) => physical.world.has(id)));
    sim.step(2);
    assert.ok(broken.pieces.every((id) => !physical.world.has(id)));
    assert.equal(physical.destroyedRecords().length, 1, "the destroyed parent stays recorded");
    // Scene-lifetime debris (0) and non-debris pieces never expire.
    edit(sim, [{ type: "reset", scope: "area", id: "area-1", to: "inherited" }]);
    const crate = strike(sim, "crate-1-3", 200)[0].broken!;
    assert.ok(
      crate.pieces.every((id) => physical.world.pose(id).blueprint!.expiresAt === undefined),
    );
  } finally {
    sim.dispose();
  }
});

test("continuous contact and repeated hits never destroy or reward an object twice", () => {
  const sim = scene();
  try {
    const physical = sim.physical!;
    let barrel = physical.world.pose("prop-barrel-1-0");
    // Real slashes through player input: the same path a person uses. Hits knock the barrel
    // back, so each swing follows it (and keeps striking where it broke afterwards).
    const swing = () => {
      if (physical.world.has("prop-barrel-1-0")) barrel = physical.world.pose("prop-barrel-1-0");
      sim.teleport("local", barrel.x - 24, barrel.y);
      sim.setInput("local", { attack: true, aimX: 1, aimY: 0 });
      sim.step();
      sim.setInput("local", {});
      sim.step(24);
    };
    const destroyed = () => physical.destroyedRecords().some((r) => r.id === "prop-barrel-1-0");
    for (let n = 0; n < 40 && !destroyed(); n++) swing();
    assert.ok(destroyed(), "slashes break the barrel");
    const reward = physical.destroyedRecords().reduce((n, r) => n + r.reward, 0);
    assert.ok(reward > 0);
    for (let n = 0; n < 20; n++) swing();
    const after = physical.destroyedRecords();
    assert.equal(new Set(after.map((r) => r.id)).size, after.length);
    assert.ok(after.every((r) => !physical.world.has(r.id)));
    const pieceIds = after.flatMap((r) => r.pieces);
    assert.equal(new Set(pieceIds).size, pieceIds.length);
    assert.equal(
      breakEvents(sim).filter((text) => text.startsWith("barrel:")).length,
      after.filter((r) => r.family === "barrel").length,
    );
    const hero = sim.adventure.hero("local");
    assert.equal(
      hero.gold + goldDrops(sim) - 80,
      after.reduce((n, r) => n + r.reward, 0),
      "party gold rises by each destroyed parent's reward exactly once",
    );
    // Resting pieces in contact for seconds create no further destruction.
    const settled = physical.destroyedRecords().length;
    sim.step(300);
    assert.equal(physical.destroyedRecords().length, settled);
  } finally {
    sim.dispose();
  }
});

test("save/load, replay, recall and late-join replicas preserve the same destruction state", () => {
  const sim = scene();
  const agent = new AgentRuntime(sim);
  agent.beginRecording();
  try {
    agent.execute({ op: "actors", action: "damage", id: "crate-1-0", damage: 200 });
    agent.execute({ op: "actors", action: "damage", id: "prop-tree-1-0", damage: 200, angle: 1 });
    agent.execute({ op: "actors", action: "damage", id: "prop-pylon-2-0", damage: 200 });
    agent.execute({ op: "actors", action: "damage", id: "prop-wagon-1-0", damage: 60 });
    agent.execute({ op: "step", ticks: 30 });
    const physical = sim.physical!;
    const destroyed = physical.destroyedRecords(),
      props = JSON.stringify(physical.props());
    assert.equal(destroyed.length, 3);
    // Save/restore, raw and portable.
    for (const portable of [false, true]) {
      const restored = Simulation.restore(JSON.parse(JSON.stringify(sim.save(portable))));
      try {
        assert.deepEqual(restored.physical!.destroyedRecords(), destroyed);
        assert.deepEqual(
          restored.physical!.props().map((p) => [p.id, p.consequences, p.blueprint]),
          physical.props().map((p) => [p.id, p.consequences, p.blueprint]),
        );
        if (!portable) assert.equal(JSON.stringify(restored.physical!.props()), props);
      } finally {
        restored.dispose();
      }
    }
    // Replay of the agent recording reaches the same hash.
    const recording = agent.execute({ op: "replay" }) as Parameters<typeof replay>[0];
    replay(recording).dispose();
    // Late join: a guest built from the portable baseline sees the same destruction.
    const guest = new Simulation(142, 0);
    try {
      guest.applyReplica(JSON.parse(JSON.stringify(sim.save(true))) as SaveState);
      assert.deepEqual(guest.replicaPhysics!.destroyed, destroyed);
      const guestAgent = new AgentRuntime(guest);
      const seen = guestAgent.execute({ op: "actors", action: "props" }) as {
        props: { id: string }[];
        destroyed: unknown[];
      };
      assert.deepEqual(seen.destroyed, destroyed);
      assert.ok(!seen.props.some((p) => p.id === "crate-1-0"));
      assert.ok(seen.props.some((p) => p.id === "prop-tree-1-0-stump"));
      assert.throws(
        () => guestAgent.execute({ op: "actors", action: "damage", id: "crate-1-1", damage: 9 }),
        /host/,
      );
    } finally {
      guest.dispose();
    }
    assert.equal(PROTOCOL_VERSION, 7);
    assert.ok(encodeSnapshot(sim, "local").byteLength > 0);
    assert.throws(
      () =>
        agent.execute({
          op: "actors",
          action: "spawn",
          body: {
            ...structuredClone(destroyed[1]),
            id: "prop-tree-1-0",
            role: "prop",
            motion: "fixed",
            shape: { kind: "circle", radius: 9 },
            areaId: "area-1",
          },
        }),
      /retired/,
    );
    // Recall: leave the land, enter a new one, come back. Destruction persists, nothing respawns.
    sim.adventure.action(sim, "local", { type: "return" });
    sim.step(150);
    sim.adventure.startArea(sim, 5);
    sim.step();
    assert.equal(physical.landId, "land-1-1");
    assert.equal(physical.destroyedRecords().length, 0);
    assert.ok(physical.world.has("prop-tree-5-0"));
    const archived = sim.save();
    sim.adventure.startArea(sim, 1);
    sim.step();
    assert.deepEqual(physical.destroyedRecords(), destroyed);
    assert.ok(!physical.world.has("crate-1-0") && !physical.world.has("prop-tree-1-0"));
    assert.ok(physical.world.has("prop-tree-1-0-stump") && physical.world.has("prop-tree-1-0-log"));
    // The archived land inside a checkpoint carries its destruction, too.
    const restored = Simulation.restore(JSON.parse(JSON.stringify(archived)));
    try {
      const archive = restored.physical!.save().archives.find((a) => a.id === "land-1-0")!;
      assert.deepEqual(archive.destroyed, destroyed);
      restored.adventure.startArea(restored, 1);
      restored.step();
      assert.deepEqual(restored.physical!.destroyedRecords(), destroyed);
      assert.ok(!restored.physical!.world.has("crate-1-0"));
    } finally {
      restored.dispose();
    }
  } finally {
    sim.dispose();
  }
});

test("real M04 checkpoints migrate: exact legacy bodies, M05 content added once, validation is strict", () => {
  // Produced by main 9bd16f0 (M04 + PR #9): land-1-1 active with land-1-0 archived.
  for (const name of ["m04-raw.json.gz", "m04-portable.json.gz"]) {
    const legacy = fixture(name) as SaveState;
    assert.equal(legacy.actorPhysics!.version, 2);
    assert.equal(legacy.actorPhysics!.world.version, 4);
    const before = legacy.actorPhysics!.world.bodies.filter((b) => b.recipe.role === "prop");
    const sim = Simulation.restore(structuredClone(legacy));
    try {
      const physical = sim.physical!;
      for (const entry of before) {
        const pose = physical.world.pose(entry.recipe.id);
        assert.equal(pose.mass, entry.recipe.mass);
        assert.deepEqual(pose.shape, entry.recipe.shape);
        assert.equal(pose.material, "wood");
        assert.equal(pose.blueprint?.palette, 1);
        if (name === "m04-raw.json.gz") {
          assert.equal(pose.x, entry.state!.x);
          assert.equal(pose.vx, entry.state!.vx);
        }
      }
      assert.equal(physical.destroyedRecords().length, 0);
      assert.ok(physical.world.has("prop-tree-5-0"), "M05 scenery joins the active land");
      const saved = sim.save();
      assert.equal(saved.actorPhysics!.version, 4);
      assert.equal(saved.actorPhysics!.world.version, 6);
      const archive = saved.actorPhysics!.archives.find((a) => a.id === "land-1-0")!;
      assert.ok(archive.props.some((p) => p.id === "prop-wagon-1-0"));
      assert.ok(archive.props.filter((p) => p.id.startsWith("crate-")).every((p) => p.material));
      assert.deepEqual(archive.destroyed, []);
      // Migrated content is stable: a second save/restore adds nothing more.
      const again = Simulation.restore(structuredClone(saved));
      try {
        assert.deepEqual(again.physical!.world.ids(), physical.world.ids());
      } finally {
        again.dispose();
      }
      sim.step(30);
      assert.ok(strike(sim, "crate-5-0", 200)[0].broken, "legacy crates break like M05 crates");
      // Returning to the migrated archived land restores its M04 props exactly, plus M05 scenery.
      const archived = legacy.actorPhysics!.archives.find((a) => a.id === "land-1-0")!;
      sim.adventure.startArea(sim, 1);
      sim.step();
      assert.equal(physical.landId, "land-1-0");
      for (const prop of archived.props) {
        const pose = physical.world.pose(prop.id);
        assert.equal(pose.mass, prop.mass);
        assert.equal(pose.material, "wood");
        assert.ok(Math.hypot(pose.x - prop.x, pose.y - prop.y) < 2, prop.id); // One solved tick.
      }
      assert.equal(physical.world.pose("prop-wagon-1-0").blueprint?.family, "wagon");
      assert.ok(strike(sim, "prop-pylon-1-0", 50)[0].broken);
    } finally {
      sim.dispose();
    }
  }
  const legacy = fixture("m04-raw.json.gz") as SaveState;
  const forged = structuredClone(legacy);
  forged.actorPhysics!.version = 3;
  assert.throws(() => Simulation.restore(forged), /./, "a v3 envelope needs a v5 world");
  const sim = scene();
  try {
    strike(sim, "crate-1-0", 200);
    const state = sim.save();
    const duplicate = structuredClone(state);
    duplicate.actorPhysics!.destroyed!.push(structuredClone(duplicate.actorPhysics!.destroyed![0]));
    assert.throws(() => Simulation.restore(duplicate));
    const resurrected = structuredClone(state);
    resurrected.actorPhysics!.destroyed![0].id = "crate-1-1";
    assert.throws(() => Simulation.restore(resurrected), /destroyed/i);
    const badMaterial = structuredClone(state);
    const body = badMaterial.actorPhysics!.world.bodies.find((b) => b.recipe.id === "crate-1-1")!;
    (body.recipe as { material: string }).material = "plasma";
    assert.throws(() => Simulation.restore(badMaterial));
    const badDurability = structuredClone(state);
    const pot = badDurability.actorPhysics!.world.bodies.find(
      (b) => b.recipe.id === "prop-pot-1-0",
    )!;
    pot.recipe.consequences = { destroyed: false, claimed: false, durability: 140 };
    assert.throws(() => Simulation.restore(badDurability));
  } finally {
    sim.dispose();
  }
});
