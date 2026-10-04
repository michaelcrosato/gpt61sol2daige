import assert from "node:assert/strict";
import { AgentRuntime, type Replay, replay } from "../src/engine/agent.ts";
import { Simulation } from "../src/engine/simulation.ts";
import { ambientBodyId, enemyBodyId, playerBodyId } from "../src/physics/adventure.ts";
import { initializePhysics } from "../src/physics/bootstrap.ts";
import type { BodyPose } from "../src/physics/types.ts";

await initializePhysics();
const populationIndex = process.argv.indexOf("--population"),
  population = populationIndex >= 0 ? Number(process.argv[populationIndex + 1]) : 32;
const sim = new Simulation(142, population),
  agent = new AgentRuntime(sim);
try {
  agent.execute({ op: "encounter", index: 1 });
  const p = sim.players.get("local")!,
    e = sim.adventure.state.enemies[0];
  e.x = e.px = p.x + 30;
  e.y = e.py = p.y;
  e.hp = e.maxHp = e.baseHealth = 1000;
  e.speed = 0;
  e.nextAttack = e.rootUntil = 1e6;
  sim.adventure.state.enemies = [e];
  sim.adventure.state.spawned = sim.adventure.state.recipe.killGoal;
  // Deliberate QA encounter setup; attacks and movement thereafter use ordinary commands.
  agent.beginRecording();
  agent.execute({ op: "input", attack: true, pulse: true, aimX: 1 });
  agent.execute({ op: "step", ticks: 1 });
  const hit = sim.physical!.world.pose(enemyBodyId(e.id));
  agent.execute({ op: "input", x: 1, attack: true, aimX: 1 });
  agent.execute({ op: "step", ticks: 1 });
  const continuation = sim.physical!.world.pose(enemyBodyId(e.id));
  assert.ok(hit.vx > 0 && continuation.vx > 0);
  assert.ok(e.hp < 1000);
  const physical = sim.physical!,
    r = sim.adventure.state.recipe;
  agent.execute({ op: "teleport", x: r.x - 110, y: r.y + 40 });
  agent.execute({ op: "input", x: 1 });
  const before = physical.world.pose("crate-1-0");
  agent.execute({ op: "step", ticks: 40 });
  const after = physical.world.pose("crate-1-0");
  assert.ok(after.x > before.x + 10);
  agent.execute({
    op: "actors",
    action: "configure",
    expectedRevision: 0,
    edits: [
      {
        type: "override",
        scope: "land",
        id: physical.landId,
        values: { ambientPhysics: true, crowdContacts: false },
      },
    ],
  });
  const start = performance.now();
  sim.step();
  const elapsedMs = performance.now() - start;
  let live = 0;
  for (let i = 0; i < sim.count; i++)
    if (physical.world.has(ambientBodyId(i, sim.generation[i]))) live++;
  assert.equal(live, population);
  agent.log.push({ op: "step", ticks: 1 });
  agent.execute({
    op: "actors",
    action: "configure",
    expectedRevision: 1,
    edits: [
      { type: "override", scope: "area", id: "area-1", values: { sweptCollision: false } },
      { type: "master", enabled: false },
    ],
  });
  agent.execute({ op: "actors", action: "apply", expectedRevision: 2 });
  const off = physical.world.pose("crate-1-0");
  agent.execute({ op: "actors", action: "impulse", id: "crate-1-0", x: 500, y: 0 });
  agent.execute({ op: "step", ticks: 1 });
  assert.equal(physical.world.pose("crate-1-0").x, off.x);
  assert.equal(physical.world.pose(playerBodyId("local")).ccdEnabled, true);
  assert.equal(physical.inspect().movementOwners.rapierAmbient, 0);
  const restored = Simulation.restore(sim.save());
  try {
    sim.step(3);
    restored.step(3);
    assert.equal(sim.stateHash(), restored.stateHash());
  } finally {
    restored.dispose();
  }
  agent.log.push({ op: "step", ticks: 3 });
  const played = replay(agent.execute({ op: "replay" }) as Replay);
  try {
    assert.equal(played.stateHash(), sim.stateHash());
  } finally {
    played.dispose();
  }
  const compact = (pose: BodyPose) => ({
    id: pose.id,
    x: pose.x,
    y: pose.y,
    vx: pose.vx,
    vy: pose.vy,
    angle: pose.angle,
    ccdEnabled: pose.ccdEnabled,
    frozen: pose.frozen,
  });
  console.log(
    JSON.stringify(
      {
        milestone: "M03",
        seed: 142,
        population,
        hit: compact(hit),
        nextAiTick: compact(continuation),
        prop: { before: compact(before), after: compact(after) },
        fullParticipation: {
          selected: population,
          liveAmbientBodies: live,
          firstTickMs: elapsedMs,
          informational: true,
        },
        masterOff: {
          prop: compact(off),
          owners: physical.inspect().movementOwners,
          essentialPlayerCcd: true,
        },
        saveContinuation: true,
        sameBuildReplay: true,
        tuning:
          "Untuned combat; deliberate isolated target/position setup. Nine-area route uses separately documented 2x player damage/health.",
      },
      null,
      2,
    ),
  );
} finally {
  sim.dispose();
}
