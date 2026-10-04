import assert from "node:assert/strict";
import test from "node:test";
import { AgentRuntime, type Replay, replay } from "../src/engine/agent.ts";
import { hash, noise } from "../src/engine/math.ts";
import { collideCircles, moveBody, SpatialHash } from "../src/engine/physics.ts";
import { idleInput, MAX_NPCS, Simulation } from "../src/engine/simulation.ts";
import { Decor, LANDMARKS, Terrain, World } from "../src/engine/world.ts";
import { initializePhysics } from "../src/physics/bootstrap.ts";

await initializePhysics();

test("coordinate hashing and smooth noise are stable across negative and distant coordinates", () => {
  assert.equal(hash(-32000, 65482, 142), hash(-32000, 65482, 142));
  assert.notEqual(hash(-32000, 65482, 142), hash(-32000, 65482, 143));
  for (const x of [-1e6, -12.34, -0.1, 0, 1e6]) {
    const n = noise(x, 18.2, 142);
    assert.ok(n >= 0 && n <= 1);
    assert.ok(Math.abs(n - noise(x + 0.00001, 18.2, 142)) < 0.0001);
  }
});
test("streaming is bounded, regenerates identical data, and is request-order independent", () => {
  const world = new World(142, 8),
    expected = structuredClone(world.getChunk(-13, 14));
  for (let i = 0; i < 60; i++) world.getChunk(i * 100, -i * 113);
  assert.equal(world.chunks.size, 8);
  assert.equal(world.evicted, 53);
  assert.deepEqual(world.getChunk(-13, 14), expected);
  const other = new World(142);
  other.getChunk(1, 1);
  assert.deepEqual(other.getChunk(-13, 14), expected);
  assert.notDeepEqual(new World(143).getChunk(-13, 14).variants, expected.variants);
});
test("all named destinations and the spawn are navigable", () => {
  for (const seed of [0, 142, 43801, 0xffffffff]) {
    const world = new World(seed);
    for (const landmark of LANDMARKS) assert.equal(world.walkable(landmark.x, landmark.y), true);
    for (let i = 0; i < 200; i++) {
      const p = world.spawnPoint(i);
      assert.ok(world.walkable(p.x, p.y));
    }
  }
});

test("declarative level brushes invalidate chunks, survive saves, and replay deterministically", () => {
  const agent = new AgentRuntime(new Simulation(142, 40));
  const old = agent.sim.world.getChunk(0, 0);
  agent.execute({ op: "paint", tx: 0, ty: 0, width: 4, height: 4, terrain: 6, decor: 0 });
  assert.equal(agent.sim.world.patches.size, 16);
  assert.notEqual(agent.sim.world.getChunk(0, 0), old);
  assert.equal(agent.sim.world.at(8, 8).terrain, Terrain.Stone);
  agent.execute({ op: "step", ticks: 10 });
  const restored = Simulation.restore(agent.sim.save());
  assert.equal(restored.world.patches.size, 16);
  assert.equal(restored.stateHash(), agent.sim.stateHash());
  assert.equal(
    replay(agent.execute({ op: "replay" }) as Replay).stateHash(),
    agent.sim.stateHash(),
  );
  assert.throws(() => agent.sim.world.paint(0, 0, 999999, 999999, 1), /Brush/);
  assert.throws(() => agent.sim.world.paint(0, 0, 1, 1, 50), /Invalid terrain/);
  assert.equal(agent.sim.world.patches.size, 16, "invalid brush is atomic");
});
test("spatial broad phase handles negative coordinates and never repeats a hash collision", () => {
  const grid = new SpatialHash(4),
    x = new Float64Array([-1, 1, 5000, -5000]),
    y = new Float64Array([0, 0, 5000, -5000]);
  grid.build(x, y, 4);
  const found: number[] = [];
  grid.query(0, 0, 8, (i) => found.push(i));
  assert.deepEqual(found.sort(), [0, 1]);
});
test("impulse collision conserves momentum, resolves overlap, and supports unequal mass", () => {
  const a = { x: 0, y: 0, vx: 10, vy: 0, radius: 5 },
    b = { x: 8, y: 0, vx: -3, vy: 0, radius: 5 };
  const momentum = a.vx * 2 + b.vx;
  assert.equal(collideCircles(a, b, 2, 1, 1), true);
  assert.ok(Math.abs(a.vx * 2 + b.vx - momentum) < 1e-8);
  assert.ok(b.x - a.x >= 10);
  assert.ok(b.vx > a.vx);
});
test("swept substeps keep a high-speed body from tunneling through a one-tile wall", () => {
  class WallWorld extends World {
    override tile(tx: number) {
      return {
        terrain: tx === 10 ? Terrain.DeepWater : Terrain.Path,
        decor: Decor.None,
        variant: 0,
      };
    }
  }
  const body = { x: 125, y: 8, vx: 4000, vy: 0, radius: 6 };
  assert.ok(moveBody(new WallWorld(), body, 1 / 60) > 0);
  assert.ok(body.x <= 154.01, `body.x=${body.x}`);
  assert.ok(body.vx < 0);
});
test("identical input produces identical simulation, including collisions and AI", () => {
  const run = () => {
    const s = new Simulation(472, 500);
    s.addPlayer("local");
    s.setInput("local", { x: 0.7, y: -0.4, dash: true });
    s.step(130);
    s.setInput("local", { x: -1, pulse: true });
    s.step(90);
    return s;
  };
  assert.equal(run().stateHash(), run().stateHash());
});
test("checkpoint restore resumes the exact future state", () => {
  const sim = new Simulation(142, 300);
  sim.addPlayer("local");
  sim.setInput("local", { x: 1, y: 0.2, dash: true, pulse: true });
  sim.step(60);
  const restored = Simulation.restore(JSON.parse(JSON.stringify(sim.save())));
  assert.equal(restored.stateHash(), sim.stateHash());
  sim.step(120);
  restored.step(120);
  assert.equal(restored.stateHash(), sim.stateHash());
  assert.deepEqual(restored.save(), sim.save());
});
test("quest is playable from gathering wisps through all three shared beacons", () => {
  const sim = new Simulation(142, 9),
    p = sim.addPlayer("local");
  for (let i = 0; i < sim.count; i++) {
    sim.x[i] = p.x + (i % 3) * 10;
    sim.y[i] = p.y + Math.floor(i / 3) * 10;
    sim.kind[i] = 0;
  }
  sim.setInput("local", { pulse: true });
  sim.step();
  assert.equal(sim.shards, 9);
  sim.setInput("local", idleInput());
  sim.step(80);
  sim.setInput("local", { pulse: true });
  sim.step();
  assert.equal(sim.shards, 9, "same wisps cannot be farmed twice");
  for (const l of LANDMARKS.slice(1)) {
    sim.setInput("local", idleInput());
    sim.step();
    sim.teleport("local", l.x, l.y);
    sim.setInput("local", { interact: true });
    sim.step();
  }
  assert.equal(sim.beacons.size, 3);
  assert.equal(sim.shards, 0);
  assert.equal(sim.observe().quest.complete, true);
});
test("player slots enforce eight simultaneous travelers and release disconnected slots", () => {
  const sim = new Simulation(0, 0);
  for (let i = 0; i < 8; i++) sim.addPlayer(`p${i}`);
  assert.throws(() => sim.addPlayer("ninth"), /full/);
  sim.removePlayer("p3");
  sim.addPlayer("replacement");
  assert.equal(sim.players.size, 8);
  assert.equal(new Set([...sim.players.values()].map((p) => p.color)).size, 8);
});

test("eight widely separated travelers all receive streamed wildlife within the bounded cache", () => {
  const sim = new Simulation(142, 800);
  for (let i = 0; i < 8; i++) {
    const p = sim.addPlayer(`p${i}`);
    p.x = i * 10000;
    p.y = 0;
  }
  sim.step(120);
  const travelers = [...sim.players.values()];
  for (let i = 1; i < travelers.length; i++)
    assert.ok(travelers[i].x - travelers[i - 1].x > 8000, "travelers remain separated");
  for (const p of sim.players.values()) {
    let nearby = 0;
    for (let i = 0; i < sim.count; i++)
      if (Math.hypot(sim.x[i] - p.x, sim.y[i] - p.y) < 1500) nearby++;
    assert.ok(nearby >= 90, `${p.id} only has ${nearby} nearby creatures`);
  }
  assert.ok(sim.world.chunks.size <= 1024);
  const restored = Simulation.restore(sim.save());
  restored.step(20);
  sim.step(20);
  assert.deepEqual(restored.save(), sim.save());
});
test("agent commands validate inputs, support batch-style workflows, and replay exactly", () => {
  const agent = new AgentRuntime(new Simulation(142, 100));
  for (const command of [
    { op: "input", x: 1 },
    { op: "step", ticks: 70 },
    { op: "input", x: 0, y: -1 },
    { op: "step", ticks: 15 },
    { op: "population", count: 150 },
    { op: "step", ticks: 5 },
  ])
    agent.execute(command);
  const recording = agent.execute({ op: "replay" }) as Replay;
  assert.equal(replay(recording).stateHash(), agent.sim.stateHash());
  assert.throws(() => agent.execute({ op: "population", count: MAX_NPCS + 1 }), /Population/);
  assert.throws(() => agent.execute({ op: "reset", seed: -1 }), /seed/);
  assert.throws(() => agent.execute({ op: "step", ticks: -1 }), /Step/);
  assert.throws(() => agent.execute({ op: "teleport", x: Infinity, y: 0 }), /finite/);
  assert.throws(() => agent.execute({ op: "nonsense" }), /Unknown/);
  assert.throws(() => replay({ ...recording, hash: "bad" }), /diverged/);
});
test("untrusted checkpoints are rejected before allocating an invalid world", () => {
  const sim = new Simulation(142, 10);
  sim.addPlayer("local");
  const state = sim.save();
  state.npcs.x[0] = NaN;
  assert.throws(() => Simulation.restore(state), /Invalid NPC/);
  const duplicate = sim.save();
  duplicate.players.push(duplicate.players[0]);
  assert.throws(() => Simulation.restore(duplicate), /Invalid saved player/);
});
test("population can reach 65536 and safely shrink and expand without nonfinite state", () => {
  const sim = new Simulation(142, MAX_NPCS);
  sim.addPlayer("local");
  sim.step(4);
  assert.equal(sim.count, MAX_NPCS);
  assert.ok(sim.x.every(Number.isFinite));
  assert.ok(sim.y.every(Number.isFinite));
  sim.setPopulation(100);
  sim.setPopulation(200);
  sim.step();
  assert.equal(sim.count, 200);
});
