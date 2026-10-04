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
