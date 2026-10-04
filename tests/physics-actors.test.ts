import assert from "node:assert/strict";
import test from "node:test";
import { AgentRuntime, type Replay, replay } from "../src/engine/agent.ts";
import { checksum } from "../src/engine/math.ts";
import { MAX_NPCS, Simulation } from "../src/engine/simulation.ts";
import { Decor, Terrain } from "../src/engine/world.ts";
import { ambientBodyId, enemyBodyId, playerBodyId } from "../src/physics/adventure.ts";
import { initializePhysics, rapier } from "../src/physics/bootstrap.ts";
import type { PolicyEdit } from "../src/physics/policies.ts";
import { createPlayground, PhysicsWorld, physicsResources } from "../src/physics/runtime.ts";

await initializePhysics();
function scene(count = 0) {
  const sim = new Simulation(142, count);
  sim.addPlayer("local");
  sim.adventure.startArea(sim, 1);
  return sim;
}
function edit(sim: Simulation, edits: PolicyEdit[]) {
  const physical = sim.physical!;
  physical.configure({ expectedRevision: physical.world.policyState().nextRevision, edits });
  physical.world.applyPolicies(physical.world.policyState().nextRevision);
  physical.begin(sim);
}
function target(sim: Simulation, dx = 30) {
  const p = sim.players.get("local")!,
    e = sim.adventure.state.enemies[0];
  e.x = e.px = p.x + dx;
  e.y = e.py = p.y;
  e.speed = 0;
  e.rootUntil = 1e6;
  e.nextAttack = 1e6;
  e.hp = e.maxHp = e.baseHealth = 1000;
  sim.adventure.state.enemies = [e];
  sim.adventure.state.spawned = sim.adventure.state.recipe.killGoal;
  return e;
}
test("real encounter motors retain held melee, Whorl, spirit, stagger and external knockback without spin", () => {
  const sim = scene();
  try {
    const e = target(sim),
      p = sim.players.get("local")!,
      start = e.x;
    sim.setInput("local", { attack: true, pulse: true, aimX: 1 });
    sim.step();
    assert.ok(e.hp < 1000);
    assert.ok(e.x > start);
    assert.ok(e.vx > 0);
    sim.setInput("local", { x: 1, attack: true, aimX: 1 });
    sim.step();
    assert.ok(e.vx > 25, "AI must not erase the hit on the next tick");
    const hp = e.hp;
    sim.step(25);
    assert.ok(e.hp < hp, "held attack repeats");
    assert.ok(p.energy < 100);
    assert.ok(sim.adventure.hero("local").whorlReady > 0);
    const pose = sim.physical!.world.pose(playerBodyId("local"));
    assert.equal(pose.angle, 0);
    assert.equal(pose.angularVelocity, 0);
    sim.actorImpulse(playerBodyId("local"), 100, 0);
    sim.setInput("local", {});
    const x = p.x;
    sim.step(2);
    assert.ok(p.x > x);
  } finally {
    sim.dispose();
  }
});
test("dash phases through actors but continuously respects patched world obstacles under master-off", () => {
  const sim = scene();
  try {
    const p = sim.players.get("local")!,
      e = target(sim, 20);
    const tx = Math.floor(p.x / 16) + 4,
      ty = Math.floor(p.y / 16);
    sim.world.paint(tx, ty - 4, 1, 9, Terrain.DeepWater);
    edit(sim, [{ type: "master", enabled: false }]);
    sim.setInput("local", { x: 1, dash: true });
    sim.step(9);
    assert.ok(p.x > e.x + 5, "dash passes actor");
    assert.ok(p.x <= tx * 16 - p.radius + 0.5, "dash cannot cross a solid tile");
    assert.ok(sim.adventure.hero("local").invulnerableUntil > sim.tick);
    assert.equal(p.energy < 100, true);
    sim.world.paint(tx, ty - 4, 1, 9, Terrain.Path);
    sim.setInput("local", { x: 1 });
    sim.step(40);
    assert.ok(p.x > tx * 16 + 20, "patch removal releases the motor");
    assert.ok(
      !sim.physical!.world.ids().some((id) => id.includes(`-${tx}-`) && id.endsWith("water")),
    );
  } finally {
    sim.dispose();
  }
});
test("regional actor contacts separate and recover; props block and move only when permitted", () => {
  const sim = scene();
  try {
    const p = sim.players.get("local")!,
      e = target(sim, 3),
      physical = sim.physical!;
    edit(sim, [
      { type: "override", scope: "area", id: "area-1", values: { crowdContacts: false } },
    ]);
    sim.step(5);
    assert.ok(Math.hypot(p.x - e.x, p.y - e.y) < 6);
    edit(sim, [{ type: "override", scope: "area", id: "area-1", values: { crowdContacts: true } }]);
    sim.step(30);
    assert.ok(Math.hypot(p.x - e.x, p.y - e.y) > p.radius + e.radius - 1);
    sim.adventure.state.enemies = [];
    const x = p.x,
      y = p.y;
    physical.world.place("crate-1-0", x + 40, y);
    edit(sim, [
      {
        type: "override",
        scope: "area",
        id: "area-1",
        values: { dynamicProps: false, propBlocking: true },
      },
    ]);
    sim.setInput("local", { x: 1 });
    sim.step(40);
    assert.ok(p.x < x + 40 - 15);
    edit(sim, [{ type: "override", scope: "area", id: "area-1", values: { propBlocking: false } }]);
    sim.step(40);
    assert.ok(p.x > x + 40 + 20);
    sim.teleport("local", x, y);
    physical.world.place("crate-1-0", x + 40, y);
    edit(sim, [
      {
        type: "override",
        scope: "area",
        id: "area-1",
        values: { dynamicProps: true, propBlocking: true },
      },
    ]);
    sim.step(40);
    assert.ok(physical.world.pose("crate-1-0").x > x + 50, "player pushes a real adventure crate");
  } finally {
    sim.dispose();
  }
});
test("ambient crossings and switches in two regions retain identity, position, and exactly one movement owner", () => {
  const sim = scene(12);
  try {
    const r = sim.adventure.state.recipe,
      physical = sim.physical!;
    for (let i = 0; i < sim.count; i++) {
      sim.x[i] = r.x + (i < 6 ? 75 : -115) + (i % 3) * 12;
      sim.y[i] = r.y - 110 + Math.floor((i % 6) / 3) * 12;
    }
    sim.step();
    let state = physical.inspect();
    assert.equal(state.movementOwners.rapierAmbient, 6);
    assert.equal(state.movementOwners.ambient, 6);
    const identity = Array.from(sim.generation.subarray(0, sim.count)),
      positions = Array.from(sim.x.subarray(0, sim.count));
    edit(sim, [
      {
        type: "override",
        scope: "region",
        id: "reactive-1",
        values: { ambientPhysics: false, crowdContacts: false },
      },
      {
        type: "override",
        scope: "region",
        id: "quiet-1",
        values: { ambientPhysics: true, crowdContacts: true },
      },
    ]);
    state = physical.inspect();
    assert.equal(state.movementOwners.rapierAmbient, 6);
    assert.deepEqual(Array.from(sim.generation.subarray(0, sim.count)), identity);
    assert.deepEqual(Array.from(sim.x.subarray(0, sim.count)), positions);
    for (let i = 0; i < sim.count; i++)
      assert.equal(physical.world.has(ambientBodyId(i, sim.generation[i])), i >= 6);
    // Deliberate relocation used by QA; handover itself never relocates or respawns.
    const i = 6;
    physical.world.place(ambientBodyId(i, sim.generation[i]), r.x + 75, r.y - 110);
    sim.x[i] = r.x + 75;
    sim.y[i] = r.y - 110;
    sim.step();
    assert.equal(physical.ownsAmbient(i), false);
    assert.equal(sim.generation[i], identity[i]);
    edit(sim, [
      { type: "override", scope: "region", id: "reactive-1", values: { ambientPhysics: true } },
    ]);
    assert.equal(physical.ownsAmbient(i), true);
    const checkpoint = sim.save(),
      restored = Simulation.restore(checkpoint);
    try {
      sim.step(10);
      restored.step(10);
      assert.deepEqual(restored.save(), sim.save());
    } finally {
      restored.dispose();
    }
  } finally {
    sim.dispose();
  }
});
test("explicit ambient selection has no playground, interest, or camera eligibility cap", () => {
  const sim = scene(4500);
  try {
    edit(sim, [
      {
        type: "override",
        scope: "land",
        id: sim.physical!.landId,
        values: { ambientPhysics: true, crowdContacts: false },
      },
    ]);
    sim.step();
    assert.equal(sim.count, 4500);
    assert.equal(sim.physical!.inspect().movementOwners.rapierAmbient, 4500);
    for (let i = 0; i < sim.count; i++)
      assert.equal(sim.physical!.world.has(ambientBodyId(i, sim.generation[i])), true);
    sim.setPopulation(30);
    sim.step();
    assert.equal(sim.physical!.inspect().movementOwners.rapierAmbient, 30);
    sim.setPopulation(60);
    sim.step();
    assert.equal(sim.physical!.inspect().movementOwners.rapierAmbient, 60);
    assert.equal(MAX_NPCS, 65536);
  } finally {
    sim.dispose();
  }
});
test("terrain chunks, decoration patches, recall and new-land entry leave no ghost actors or colliders", () => {
  const sim = scene();
  try {
    const physical = sim.physical!,
      p = sim.players.get("local")!,
      r = sim.adventure.state.recipe;
    sim.adventure.state.enemies = [];
    sim.adventure.state.spawned = r.killGoal;
    sim.world.paint(31, -5, 4, 10, Terrain.Path);
    sim.teleport("local", 508, -24);
    sim.setInput("local", { x: 1 });
    sim.step(30);
    assert.ok(p.x > 512);
    assert.ok(physical.inspect().terrainChunks.some(([cx]) => cx === 2));
    sim.world.paint(35, -2, 1, 1, Terrain.Path, Decor.Rock);
    sim.step();
    assert.ok(physical.world.ids().some((id) => id.endsWith("35--2-decor")));
    sim.world.paint(35, -2, 1, 1, Terrain.Path);
    sim.step();
    assert.ok(!physical.world.ids().some((id) => id.endsWith("35--2-decor")));
    physical.world.place("crate-1-0", r.x - 20, r.y + 90);
    const prop = physical.world.pose("crate-1-0");
    sim.setInput("local", {});
    sim.adventure.action(sim, "local", { type: "return" });
    sim.step(150);
    assert.equal(sim.adventure.state.mode, "town");
    assert.equal(physical.world.ids().filter((id) => id.startsWith("player-")).length, 1);
    assert.ok(!physical.world.ids().some((id) => id.startsWith("enemy-")));
    assert.equal(physical.world.pose("crate-1-0").x, prop.x);
    sim.adventure.startArea(sim, 5);
    sim.step();
    assert.equal(physical.landId, "land-1-1");
    assert.ok(
      physical.world
        .ids()
        .filter((id) => id.startsWith("terrain-"))
        .every((id) => id.startsWith("terrain-land-1-1-")),
    );
    sim.adventure.startArea(sim, 1);
    sim.step();
    assert.equal(physical.world.pose("crate-1-0").x, prop.x);
  } finally {
    sim.dispose();
  }
});
test("enemy steering goes around a patched wall and charges preserve combat damage and locked rotation", () => {
  const sim = scene();
  try {
    const p = sim.players.get("local")!,
      e = target(sim, 100);
    e.speed = 70;
    e.rootUntil = 0;
    e.behavior = "hunter";
    const tx = Math.floor((p.x + 50) / 16),
      ty = Math.floor(p.y / 16);
    sim.world.paint(tx, ty - 1, 1, 3, Terrain.DeepWater);
    sim.step(300);
    assert.ok(Math.hypot(e.x - p.x, e.y - p.y) < 50, "obstacle-aware pursuit reaches the player");
    sim.physical!.world.place(enemyBodyId(e.id), p.x + 70, p.y);
    e.x = p.x + 70;
    e.y = p.y;
    e.phase = "windup";
    e.timer = 1;
    e.behavior = "charger";
    e.facing = Math.PI;
    const h = sim.adventure.hero("local");
    h.invulnerableUntil = 0;
    const hp = h.hp;
    sim.world.paint(tx, ty - 1, 1, 3, Terrain.Path);
    sim.step(26);
    assert.ok(h.hp < hp, "enemy charge still deals authored damage");
    assert.equal(sim.physical!.world.pose(enemyBodyId(e.id)).angle, 0);
  } finally {
    sim.dispose();
  }
});
test("physical checkpoint validation and queued edits are atomic; same-build replay continues", () => {
  const baseline = physicsResources(),
    agent = new AgentRuntime(scene());
  try {
    agent.beginRecording();
    agent.execute({
      op: "actors",
      action: "configure",
      expectedRevision: 0,
      edits: [
        {
          type: "override",
          scope: "region",
          id: "reactive-1",
          values: { crowdContacts: false, ambientPhysics: false },
        },
      ],
    });
    const before = agent.sim.stateHash();
    assert.throws(
      () =>
        agent.execute({
          op: "actors",
          action: "configure",
          expectedRevision: 0,
          edits: [{ type: "master", enabled: false }],
        }),
      /Stale/,
    );
    assert.equal(agent.sim.stateHash(), before);
    const bad = agent.sim.save();
    bad.actorPhysics!.world.bodies.find((b) => b.recipe.id === "crate-1-0")!.handle = 99;
    assert.throws(() => agent.execute({ op: "restore", state: bad }), /mapping/);
    assert.equal(agent.sim.stateHash(), before);
    agent.execute({ op: "input", x: 1, attack: true, pulse: true });
    agent.execute({ op: "step", ticks: 60 });
    const continued = replay(agent.execute({ op: "replay" }) as Replay);
    try {
      assert.equal(continued.stateHash(), agent.sim.stateHash());
    } finally {
      continued.dispose();
    }
    const semantic = agent.sim.physical!.entities();
    assert.ok(semantic.some((e) => e.id === playerBodyId("local")));
    assert.ok(
      semantic.every((e) => e.blueprintRevision === 1 && e.landId === agent.sim.physical!.landId),
    );
  } finally {
    agent.sim.dispose();
  }
  assert.deepEqual(physicsResources(), baseline);
});

test("optional swept policy changes real prop CCD and synchronized pose corruption rejects atomically", () => {
  const sim = scene();
  try {
    sim.step();
    const physical = sim.physical!;
    assert.equal(physical.world.pose("crate-1-0").ccdEnabled, true);
    edit(sim, [
      { type: "override", scope: "area", id: "area-1", values: { sweptCollision: false } },
    ]);
    assert.equal(physical.world.pose("crate-1-0").ccdEnabled, false);
    assert.equal(physical.world.pose(playerBodyId("local")).ccdEnabled, true);
    edit(sim, [
      { type: "override", scope: "area", id: "area-1", values: { sweptCollision: true } },
    ]);
    assert.equal(physical.world.pose("crate-1-0").ccdEnabled, true);
    const missingMotor = sim.save();
    delete missingMotor.actorPhysics!.world.bodies.find(
      (b) => b.recipe.id === playerBodyId("local"),
    )!.motor;
    assert.throws(() => Simulation.restore(missingMotor), /Missing saved actor motor/);
    const corrupted = sim.save();
    corrupted.players[0].x += 100;
    assert.throws(() => Simulation.restore(corrupted), /pose mismatch/);
    const restored = Simulation.restore(sim.save());
    try {
      assert.equal(restored.stateHash(), sim.stateHash());
    } finally {
      restored.dispose();
    }
  } finally {
    sim.dispose();
  }
});

test("paused terrain edits remain complete checkpoints before their next collision boundary", () => {
  const sim = scene();
  try {
    sim.step();
    const p = sim.players.get("local")!,
      tx = Math.floor(p.x / 16) + 3,
      ty = Math.floor(p.y / 16);
    sim.world.paint(tx, ty, 1, 1, Terrain.DeepWater);
    const saved = sim.save();
    assert.equal(saved.actorPhysics!.pendingTerrain, true);
    const restored = Simulation.restore(saved);
    try {
      assert.equal(restored.stateHash(), sim.stateHash());
      sim.step();
      restored.step();
      assert.deepEqual(restored.save(), sim.save());
      assert.ok(sim.physical!.world.ids().some((id) => id.endsWith(`${tx}-${ty}-water`)));
    } finally {
      restored.dispose();
    }
  } finally {
    sim.dispose();
  }
});

test("original M02 master-off checkpoints import frozen consequences and continue with the new controls", () => {
  const world = createPlayground();
  try {
    world.configure({ expectedRevision: 0, edits: [{ type: "master", enabled: false }] });
    world.applyPolicies(1);
    const original = world.save(),
      api = rapier(),
      raw = api.World.restoreSnapshot(new Uint8Array(original.bytes));
    try {
      for (const entry of original.bodies) {
        const role = entry.recipe.role ?? (entry.recipe.motion === "fixed" ? "terrain" : "prop"),
          membership = role === "terrain" ? 1 : role === "prop" ? 2 : 4;
        const filter = role === "terrain" ? 7 : role === "prop" ? 3 : 5;
        raw.getCollider(entry.collider).setCollisionGroups((membership << 16) | filter);
        raw.getRigidBody(entry.handle).enableCcd(entry.recipe.ccd ?? true);
        for (const group of ["values", "effective", "provenance"] as const)
          for (const key of ["crowdContacts", "ambientPhysics", "sweptCollision"])
            delete (entry.policy![group] as unknown as Record<string, unknown>)[key];
      }
      original.bytes = Array.from(raw.takeSnapshot());
      original.checksum = checksum(original.bytes);
    } finally {
      raw.free();
    }
    const imported = PhysicsWorld.restore(original);
    try {
      assert.equal(imported.pose("wheel").frozen, true);
      assert.equal(imported.pose("wheel").ccdEnabled, false);
      imported.impulse("wheel", 500, 0);
      imported.step();
      assert.equal(imported.pose("wheel").vx, 0);
      const restored = PhysicsWorld.restore(imported.save());
      try {
        imported.step();
        restored.step();
        assert.deepEqual(imported.save(), restored.save());
      } finally {
        restored.dispose();
      }
    } finally {
      imported.dispose();
    }
  } finally {
    world.dispose();
  }
});
