import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { AgentRuntime, type Replay, replay } from "../src/engine/agent.ts";
import { Simulation } from "../src/engine/simulation.ts";
import { createPhysicsInitializer, initializePhysics, rapier } from "../src/physics/bootstrap.ts";
import { createPlayground, PhysicsWorld, physicsResources } from "../src/physics/runtime.ts";

await initializePhysics();

test("engine imports without browser globals and construction enforces the WASM barrier", () => {
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { Simulation } from './src/engine/simulation.ts';
    import { initializePhysics } from './src/physics/bootstrap.ts';
    if (typeof document !== 'undefined') throw Error('Unexpected DOM');
    try { new Simulation(142,0); throw Error('Missing readiness check'); }
    catch (e) { if (!e.message.includes('initializePhysics')) throw e; }
    await initializePhysics(); const sim = new Simulation(142,0); sim.dispose();
    console.log('ready');
  `,
    ],
    { encoding: "utf8" },
  );
  assert.equal(output.trim(), "ready");
});

test("shared initialization can fail, retry and cancel one caller without stale callbacks/worlds", async () => {
  const baseline = physicsResources();
  let calls = 0,
    release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const bootstrap = createPhysicsInitializer(async () => {
    calls++;
    if (calls === 1) throw new Error("Injected WASM failure");
    await gate;
    return rapier();
  });
  await assert.rejects(bootstrap.initialize(), /Injected WASM failure/);
  assert.equal(bootstrap.status().ready, false);
  assert.match(bootstrap.status().error!, /WASM failure/);
  const controller = new AbortController();
  const abandoned = bootstrap.initialize(controller.signal);
  const survivor = bootstrap.initialize();
  controller.abort(new Error("Canceled scene"));
  await assert.rejects(abandoned, /Canceled scene/);
  release();
  await survivor;
  await bootstrap.initialize();
  assert.equal(calls, 2);
  assert.equal(bootstrap.get(), rapier());
  assert.deepEqual(physicsResources(), baseline);
});

test("off-center impulses visibly translate and spin, with real wall contact and swept CCD", () => {
  const world = createPlayground();
  try {
    world.impulse("wheel", 240, 0, -140, 54);
    world.impulse("crate-0", 600, 50);
    for (let i = 0; i < 120; i++) world.step();
    const wheel = world.poses().find((body) => body.id === "wheel")!;
    assert.ok(wheel.x > -120, "push should move wheel right");
    assert.ok(Math.abs(wheel.angle) > 0.1, "off-center push should spin wheel");
    assert.ok(world.contacts > 0);
    assert.deepEqual(world.sweep().hit?.id, "wall");
    let furthestX = -180;
    for (let i = 0; i < 30; i++) {
      world.step();
      furthestX = Math.max(furthestX, world.poses().find((body) => body.id === "sweep")!.x);
    }
    const swept = world.poses().find((body) => body.id === "sweep")!;
    assert.ok(
      furthestX > 117 && furthestX < 119 && swept.x < 119,
      "fast body stopped before wall surface at x122",
    );
    assert.ok(world.events.some((event) => event.started && [event.a, event.b].includes("wall")));
    assert.ok(world.overlay().length > 20);
  } finally {
    world.dispose();
  }
});

test("a fresh scene sweep sees the wall before broad-phase initialization", () => {
  const world = createPlayground();
  try {
    assert.equal(world.sweep().hit?.id, "wall");
  } finally {
    world.dispose();
  }
});

test("snapshot round trip retains IDs, velocities, contacts and the same-build solved future", () => {
  const agent = new AgentRuntime(new Simulation(142, 0));
  let restored: Simulation | undefined, played: Simulation | undefined;
  try {
    agent.execute({ op: "physics", action: "reset" });
    agent.execute({
      op: "physics",
      action: "spawn",
      body: {
        id: "custom-ball",
        motion: "dynamic",
        shape: { kind: "circle", radius: 10 },
        x: -230,
        y: -130,
        mass: 2,
      },
    });
    agent.execute({
      op: "physics",
      action: "impulse",
      id: "wheel",
      x: 300,
      y: 70,
      atX: -140,
      atY: 53,
    });
    agent.execute({ op: "step", ticks: 75 });
    const saved = JSON.parse(JSON.stringify(agent.sim.save()));
    restored = Simulation.restore(saved);
    assert.deepEqual(restored.playground?.poses(), agent.sim.playground?.poses());
    assert.ok(restored.playground?.poses().some((body) => body.id === "custom-ball"));
    assert.equal(restored.stateHash(), agent.sim.stateHash());
    played = replay(agent.execute({ op: "replay" }) as Replay);
    assert.equal(played.stateHash(), agent.sim.stateHash());
    for (let i = 0; i < 120; i++) {
      agent.sim.step();
      restored.step();
    }
    assert.deepEqual(restored.playground?.poses(), agent.sim.playground?.poses());
    assert.equal(restored.stateHash(), agent.sim.stateHash());
  } finally {
    agent.sim.dispose();
    restored?.dispose();
    played?.dispose();
  }
});

test("repeated reset/restore/close/dispose frees worlds, queues and old handles", () => {
  const baseline = physicsResources(),
    agent = new AgentRuntime(new Simulation(142, 0));
  try {
    for (let n = 0; n < 25; n++) {
      const old = agent.sim.playground;
      agent.execute({ op: "physics", action: "reset" });
      if (old) assert.throws(() => old.step(), /disposed/);
      assert.deepEqual(physicsResources(), {
        worlds: baseline.worlds + 2,
        queues: baseline.queues + 2,
      });
      agent.execute({ op: "restore", state: agent.sim.save() });
      assert.deepEqual(physicsResources(), {
        worlds: baseline.worlds + 2,
        queues: baseline.queues + 2,
      });
      assert.equal(agent.sim.playground?.poses().length, 10);
    }
    agent.execute({ op: "physics", action: "close" });
    assert.deepEqual(physicsResources(), {
      worlds: baseline.worlds + 1,
      queues: baseline.queues + 1,
    });
    agent.execute({ op: "physics", action: "reset" });
    agent.execute({ op: "reset", seed: 142, count: 0 });
    assert.deepEqual(physicsResources(), {
      worlds: baseline.worlds + 1,
      queues: baseline.queues + 1,
    });
  } finally {
    agent.sim.dispose();
    agent.sim.dispose();
  }
  assert.deepEqual(physicsResources(), baseline);
});

test("invalid bodies, mappings and corrupted snapshots fail atomically; lab cannot become multiplayer", () => {
  const agent = new AgentRuntime(new Simulation(142, 0));
  try {
    agent.execute({ op: "physics", action: "reset" });
    const baseline = physicsResources(),
      hash = agent.sim.stateHash();
    for (const body of [
      { id: "bad", x: NaN, y: 0, motion: "dynamic", shape: { kind: "circle", radius: 3 } },
      { id: "bad", x: 0, y: 0, motion: "dynamic", shape: { kind: "box", width: -2, height: 3 } },
      { id: "wheel", x: 0, y: 0, motion: "dynamic", shape: { kind: "circle", radius: 3 } },
    ])
      assert.throws(() => agent.execute({ op: "physics", action: "spawn", body }));
    assert.throws(() =>
      agent.execute({ op: "physics", action: "impulse", id: "wheel", x: 100, atX: 0 }),
    );
    assert.throws(() => agent.execute({ op: "join", id: "guest" }), /solo-only/);
    const corrupt = agent.sim.save();
    corrupt.playground!.bytes[100] ^= 1;
    assert.throws(() => agent.execute({ op: "restore", state: corrupt }), /snapshot/);
    const mismatch = agent.sim.save();
    mismatch.playground!.bodies[0].recipe.shape = { kind: "circle", radius: 7 };
    assert.throws(
      () => agent.execute({ op: "restore", state: mismatch }),
      /semantic|shape mismatch/,
    );
    const duplicate = agent.sim.save();
    duplicate.playground!.bodies[1].handle = duplicate.playground!.bodies[0].handle;
    assert.throws(() => PhysicsWorld.restore(duplicate.playground!), /registry/);
    assert.equal(agent.sim.stateHash(), hash);
    assert.deepEqual(physicsResources(), baseline);
  } finally {
    agent.sim.dispose();
  }
});
