import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { AgentRuntime, type Command, type Replay, replay } from "../src/engine/agent.ts";
import { Simulation } from "../src/engine/simulation.ts";
import { initializePhysics } from "../src/physics/bootstrap.ts";

await initializePhysics();

const args = process.argv.slice(2);
if (args[0] === "replay") {
  const recording = JSON.parse(await readFile(args[1], "utf8")) as Replay;
  const sim = replay(recording);
  try {
    console.log(JSON.stringify({ ok: true, ...sim.observe() }));
  } finally {
    sim.dispose();
  }
} else {
  const seedIndex = args.indexOf("--seed"),
    countIndex = args.indexOf("--count");
  const agent = new AgentRuntime(
    new Simulation(
      seedIndex >= 0 ? Number(args[seedIndex + 1]) : 142,
      countIndex >= 0 ? Number(args[countIndex + 1]) : 2400,
    ),
  );
  try {
    const lines = createInterface({ input: process.stdin, terminal: false });
    for await (const line of lines) {
      if (!line.trim()) continue;
      let id: unknown;
      try {
        if (line.length > 8_000_000) throw new Error("Command exceeds 8 MB");
        let command = JSON.parse(line) as Command;
        id = command.id;
        if (command.op === "restore-file") {
          if (typeof command.file !== "string") throw new Error("Checkpoint file path required");
          command = { op: "restore", id, state: JSON.parse(await readFile(command.file, "utf8")) };
        }
        console.log(JSON.stringify({ ok: true, id, result: agent.execute(command) }));
      } catch (error) {
        console.log(
          JSON.stringify({
            ok: false,
            id,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
    const outIndex = args.indexOf("--record");
    if (outIndex >= 0)
      await writeFile(args[outIndex + 1], JSON.stringify(agent.execute({ op: "replay" })));
  } finally {
    agent.sim.dispose();
  }
}
