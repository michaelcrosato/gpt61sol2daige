import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AgentRuntime, type Command, type Replay, replay } from "../src/engine/agent.ts";
import { Simulation } from "../src/engine/simulation.ts";
import { initializePhysics } from "../src/physics/bootstrap.ts";
import { physicsResources } from "../src/physics/runtime.ts";

await initializePhysics();
const source = process.argv[2] ?? "examples/physics-playground.jsonl";
const commands = (await readFile(source, "utf8"))
  .split(/\r?\n/)
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line) as Command);
const agent = new AgentRuntime(new Simulation(142, 0));
let restored: Simulation | undefined;
let played: Simulation | undefined;
try {
  const results = commands.map((command) => agent.execute(command));
  const before = agent.sim.playground?.inspect();
  if (!before) throw new Error("Scene must leave an active playground");
  const policySamples = commands.flatMap((command, index) =>
    command.op === "physics" && command.action === "inspect"
      ? [results[index] as typeof before]
      : [],
  );
  if (source === "examples/physics-regions.jsonl") {
    assert.equal(policySamples.length, 6);
    const crates = policySamples.map(
      (sample) => sample.bodies.find((body) => body.id === "crossing-crate")!,
    );
    assert.ok(
      crates[0].frozen && crates[0].x < -170,
      "Crate must physically enter the quiet rectangle",
    );
    assert.equal(crates[1].x, crates[0].x, "Quiet region suppresses the repeated impulse");
    assert.equal(crates[1].angle, crates[0].angle, "Frozen angle must stay at its solved pose");
    assert.ok(
      !crates[2].frozen && crates[2].vx === 0 && crates[2].angularVelocity === 0,
      "Return wakes with zero motion",
    );
    assert.ok(crates[3].x > crates[2].x + 10, "The same returned crate must respond again");
    assert.equal(crates[3].policy.provenance.worldReactions, "area:playground/override");
    assert.ok(
      crates[4].frozen && !crates[4].policy.effective.propBlocking,
      "Master-off beats the region's live override",
    );
    assert.equal(crates[4].policy.provenance.worldReactions, "session-master-off");
    assert.ok(!crates[5].frozen && crates[5].vx === 0, "Master re-enable discards disabled motion");
    assert.equal(crates[5].policy.provenance.worldReactions, "region:circle/override");
    assert.equal(
      policySamples[3].tick,
      policySamples[5].tick,
      "Paused edits must not step the scene",
    );
    for (const crate of crates)
      assert.deepEqual(crate.consequences, { destroyed: false, claimed: true, durability: 7 });
  }
  played = replay(agent.execute({ op: "replay" }) as Replay);
  const replayHash = played.stateHash();
  restored = Simulation.restore(JSON.parse(JSON.stringify(agent.sim.save())));
  agent.sim.step(60);
  restored.step(60);
  assert.deepEqual(restored.playground?.poses(), agent.sim.playground?.poses());
  assert.equal(restored.stateHash(), agent.sim.stateHash());
  if (!process.argv[2]) {
    const wheel = before.bodies.find((body) => body.id === "wheel")!;
    assert.ok(wheel.x > -120 && Math.abs(wheel.angle) > 0.1, "Wheel must translate and spin");
    assert.ok(before.contacts > 0, "Scene must produce contacts");
    assert.ok(
      before.events.some((event) => event.started && [event.a, event.b].includes("wall")),
      "Must contact wall",
    );
    const swept = before.bodies.find((body) => body.id === "sweep")!;
    assert.ok(swept.x <= 118.5, "CCD must stop the fast body before the wall");
  }
  console.log(
    JSON.stringify(
      {
        scene: source,
        before,
        sweep: results.find((result) => !!result && typeof result === "object" && "hit" in result),
        replayHash,
        continuationHash: agent.sim.stateHash(),
        snapshotContinuation: "passed",
        policySamples,
      },
      null,
      2,
    ),
  );
} finally {
  agent.sim.dispose();
  restored?.dispose();
  played?.dispose();
  assert.deepEqual(physicsResources(), { worlds: 0, queues: 0 });
}
