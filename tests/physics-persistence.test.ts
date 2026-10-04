import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";
import { Simulation } from "../src/engine/simulation.ts";
import { BaselineReceiver, frameTransfer, physicalScene } from "../src/net/physical.ts";
import { initializePhysics } from "../src/physics/bootstrap.ts";
import { interactPhysics } from "../src/physics/interaction.ts";
import { physicsResources } from "../src/physics/runtime.ts";

await initializePhysics();
function scene(count = 0) {
  const sim = new Simulation(142, count);
  sim.addPlayer("local");
  sim.adventure.startArea(sim, 1);
  sim.step();
  return sim;
}
function transfer(sim: Simulation, sequence = 0) {
  const state = sim.save(true);
  return frameTransfer({
    version: 1,
    sequence,
    revision: 1,
    scene: physicalScene(state),
    events: [{ type: "scene", id: state.actorPhysics!.landId }],
    state,
  });
}
test("v2 saves retain moving crate, actor knockback, disabled region, queue and exact gameplay facts", () => {
  const sim = scene(),
    world = sim.physical!.world;
  const hero = sim.adventure.hero("local");
  hero.gold = 143;
  hero.skills["blade-0"] = 1;
  hero.points--;
  sim.adventure.state.kills = 3;
  world.impulse("crate-1-0", 120, 40);
  sim.actorImpulse("player-local", 110, 20);
  sim.physical!.configure({
    expectedRevision: 0,
    edits: [
      { type: "override", scope: "region", id: "quiet-1", values: { worldReactions: false } },
    ],
  });
  sim.step();
  sim.physical!.configure({
    expectedRevision: 1,
    edits: [{ type: "override", scope: "area", id: "area-2", values: { impulseStrength: 0.5 } }],
  });
  const state = sim.save();
  const restored = Simulation.restore(structuredClone(state));
  try {
    assert.equal(state.version, 2);
    assert.equal(state.actorPhysics!.version, 2);
    assert.equal(state.actorPhysics!.world.version, 4);
    assert.ok(world.pose("crate-1-0").vx > 0);
    assert.ok(
      state.actorPhysics!.world.bodies.find((e) => e.recipe.id === "player-local")!.motor!
        .externalX > 0,
    );
    assert.deepEqual(restored.save(), state);
    sim.step(20);
    restored.step(20);
    assert.deepEqual(restored.save(), sim.save());
    assert.equal(restored.adventure.hero("local").gold, 143);
    assert.deepEqual(restored.adventure.hero("local").skills, hero.skills);
    assert.equal(restored.adventure.state.kills, sim.adventure.state.kills);
  } finally {
    sim.dispose();
    restored.dispose();
  }
});
test("incompatible backend rebuild preserves every semantic body, motor, policy and land mutation", () => {
  const sim = scene(64);
  sim.physical!.world.impulse("wheel-1", 120, 0, 630, 45);
  sim.actorImpulse("player-local", 100, 0);
  sim.step(3);
  sim.world.paint(40, 40, 1, 1, 6, 0);
  const state = sim.save();
  state.actorPhysics!.backend = state.actorPhysics!.world.backend = "0.20.0";
  const rebuilt = Simulation.restore(state);
  try {
    const a = sim.physical!.world.poses(),
      b = rebuilt.physical!.world.poses();
    assert.equal(b.length, a.length);
    for (let i = 0; i < a.length; i++) {
      assert.ok(Math.abs(a[i].angle - b[i].angle) < 0.00001);
      assert.deepEqual({ ...b[i], angle: a[i].angle }, a[i]);
    }
    assert.deepEqual(rebuilt.save().adventure, state.adventure);
    assert.deepEqual(rebuilt.save().patches, state.patches);
    assert.deepEqual(rebuilt.save().actorPhysics!.ambient, state.actorPhysics!.ambient);
    assert.deepEqual(
      rebuilt.save().actorPhysics!.world.bodies.map((e) => e.motor),
      state.actorPhysics!.world.bodies.map((e) => e.motor),
    );
    rebuilt.step(10);
    assert.ok(
      rebuilt.physical!.world.pose("player-local").x > b.find((p) => p.id === "player-local")!.x,
    );
    const invalid = structuredClone(state);
    invalid.actorPhysics!.world.bodies[0].state!.x = Infinity;
    const resources = physicsResources();
    sim.events.push({
      tick: sim.tick,
      type: "pulse",
      x: 0,
      y: 0,
      player: "local",
      message: "A shared pulse",
    });
    assert.throws(() => Simulation.restore(invalid));
    assert.deepEqual(physicsResources(), resources);
    const shiftedTerrain = structuredClone(state);
    const tile = shiftedTerrain.actorPhysics!.world.bodies.find(
      (e) => e.recipe.role === "terrain",
    )!;
    tile.recipe.x += 1;
    tile.state!.x += 1;
    shiftedTerrain.actorPhysics!.pendingTerrain = false;
    assert.throws(() => Simulation.restore(shiftedTerrain), /terrain/);
    assert.deepEqual(physicsResources(), resources);
  } finally {
    sim.dispose();
    rebuilt.dispose();
  }
});
test("atomic baselines handle missing, duplicate, reversed and stale chunks without exposing partial scenes", () => {
  const sim = scene(256),
    replica = new Simulation(142, 0, "replica"),
    receiver = new BaselineReceiver();
  try {
    const first = transfer(sim);
    assert.ok(first.chunks.length > 1);
    receiver.begin(first.start);
    const before = replica.stateHash();
    for (const chunk of first.chunks.slice(1).reverse()) {
      assert.equal(receiver.chunk(chunk), null);
      assert.equal(receiver.chunk(chunk), null);
    }
    assert.equal(replica.stateHash(), before);
    const full = receiver.chunk({
      ...first.chunks[0],
      bytes: (first.chunks[0].bytes as Uint8Array).slice().buffer,
    })!;
    assert.ok(full);
    replica.applyReplica(full.state);
    assert.equal(replica.replicaPhysics!.world.bodies.length, sim.physical!.world.ids().length);
    const newer = transfer(sim, 2);
    receiver.begin(newer.start);
    assert.equal(receiver.chunk(first.chunks[0]), null);
    const bad = { ...newer.chunks[0], bytes: new Uint8Array(newer.chunks[0].bytes as Uint8Array) };
    receiver.chunk(bad);
    bad.bytes[0] ^= 1;
    assert.throws(() => receiver.chunk(bad), /Conflicting/);
    assert.throws(
      () => receiver.begin({ ...newer.start, sequence: 3, length: 256_000_001 }),
      /framing/,
    );
  } finally {
    sim.dispose();
    replica.dispose();
  }
});
test("replicas allocate no Rapier resources and snap angular/position interpolation across lands", () => {
  const sim = scene(),
    replica = new Simulation(142, 0, "replica");
  try {
    const resources = physicsResources();
    for (let i = 0; i < 12; i++) {
      sim.step();
      replica.applyReplica(sim.save(true));
    }
    assert.deepEqual(physicsResources(), resources);
    assert.equal(replica.physical, null);
    assert.deepEqual(replica.events, sim.events);
    const first = sim.save(true),
      wheel = first.actorPhysics!.world.bodies.find((b) => b.recipe.id === "wheel-1")!;
    wheel.state!.angle = Math.PI - 0.1;
    replica.applyReplica(first);
    const next = structuredClone(first);
    next.actorPhysics!.world.bodies.find((b) => b.recipe.id === "wheel-1")!.state!.angle =
      -Math.PI + 0.1;
    replica.applyReplica(next);
    assert.ok(
      Math.abs(replica.physicalProps(0.5).find((p) => p.id === "wheel-1")!.angle - Math.PI) < 0.001,
    );
    sim.adventure.startArea(sim, 5);
    sim.step();
    replica.applyReplica(sim.save(true));
    assert.deepEqual(replica.physicalProps(0), replica.physicalProps(1));
    for (const p of replica.players.values()) {
      assert.equal(p.px, p.x);
      assert.equal(p.py, p.y);
    }
  } finally {
    sim.dispose();
    replica.dispose();
  }
});
test("guest recovery retains own build, all selected ambient creatures, scene and owned delayed effects", () => {
  const sim = scene(128);
  sim.addPlayer("guest");
  sim.step();
  const guest = sim.adventure.hero("guest");
  guest.gold = 137;
  guest.skills["blade-0"] = 1;
  guest.points--;
  sim.adventure.state.delayed.push({
    tick: sim.tick + 20,
    owner: "guest",
    x: 600,
    y: 0,
    damage: 10,
    radius: 50,
    kind: "echo",
    ability: "whorl",
  });
  const replica = new Simulation(142, 0, "replica");
  sim.physical!.world.events.push({
    tick: sim.physical!.world.tick,
    a: "player-local",
    b: "player-guest",
    started: true,
  });
  replica.applyReplica(sim.save(true));
  const recovered = replica.continueSolo("guest");
  try {
    assert.equal(recovered.count, 128);
    assert.deepEqual(recovered.adventure.hero("local"), guest);
    assert.deepEqual(recovered.physical!.props(), sim.physical!.props());
    assert.ok(recovered.physical!.world.has("player-local"));
    assert.ok(!recovered.physical!.world.has("player-guest"));
    assert.equal(recovered.players.size, 1);
    assert.equal(recovered.adventure.state.delayed[0].owner, "local");
    recovered.setInput("local", { x: 1 });
    recovered.step(10);
    assert.ok(Number.isFinite(recovered.players.get("local")!.x));
  } finally {
    sim.dispose();
    replica.dispose();
    recovered.dispose();
  }
});
test("host validates prop range, identity, strength and rejects policy/spoofed payloads atomically", () => {
  const sim = scene();
  try {
    const world = sim.physical!.world,
      p = sim.players.get("local")!,
      crate = world.pose("crate-1-0");
    p.x = crate.x - 30;
    p.y = crate.y;
    sim.physical!.teleport("player-local", p.x, p.y);
    for (const request of [
      { id: "player-local", x: 1, y: 0 },
      { id: "crate-2-0", x: 1, y: 0 },
      { id: "crate-1-0", x: 121, y: 0 },
      { id: "crate-1-0", x: 10, y: 0, edits: [] },
    ]) {
      const before = world.pose("crate-1-0");
      assert.throws(() => interactPhysics(sim, "local", request));
      assert.deepEqual(world.pose("crate-1-0"), before);
    }
    interactPhysics(sim, "local", { id: "crate-1-0", x: 100, y: 0 });
    assert.ok(world.pose("crate-1-0").vx > 0);
  } finally {
    sim.dispose();
  }
});
test("legacy game checkpoints retain builds/terrain; CLI imports files beyond its JSONL line bound", () => {
  const sim = scene(),
    old = sim.save();
  old.version = 1;
  delete old.actorPhysics;
  const restored = Simulation.restore(old);
  mkdirSync("artifacts", { recursive: true });
  const directory = mkdtempSync("artifacts/m04-import-");
  const expanded = scene(5000);
  try {
    assert.deepEqual(restored.adventure.save(), old.adventure);
    assert.deepEqual(restored.save().patches, old.patches);
    expanded.physical!.configure({
      expectedRevision: 0,
      edits: [
        {
          type: "override",
          scope: "land",
          id: expanded.physical!.landId,
          values: { ambientPhysics: true, crowdContacts: false },
        },
      ],
    });
    expanded.step();
    const large = expanded.save();
    assert.ok(JSON.stringify(large).length > 8_000_000);
    const path = `${directory}/checkpoint.json`;
    writeFileSync(path, JSON.stringify(large));
    const output = execFileSync(process.execPath, ["tools/agent.ts", "--count", "0"], {
      input: `${JSON.stringify({ op: "restore-file", file: path })}\n`,
      encoding: "utf8",
    });
    assert.equal(JSON.parse(output).ok, true);
  } finally {
    sim.dispose();
    restored.dispose();
    expanded.dispose();
    rmSync(directory, { recursive: true });
  }
});
