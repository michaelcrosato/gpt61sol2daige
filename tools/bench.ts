import { mkdir, writeFile } from "node:fs/promises";
import { cpus, platform, release } from "node:os";
import { Simulation } from "../src/engine/simulation.ts";
import { encodeSnapshot } from "../src/net/protocol.ts";

const results = [];
for (const count of [1000, 2400, 6000, 8192]) {
  const sim = new Simulation(142, count);
  sim.addPlayer("local");
  sim.setInput("local", { x: 0.6, y: -0.2 });
  sim.step(120);
  const times: number[] = [];
  for (let i = 0; i < 360; i++) {
    const start = performance.now();
    sim.step();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const result = {
    count,
    ticks: 360,
    p50Ms: +times[180].toFixed(3),
    p95Ms: +times[342].toFixed(3),
    maxMs: +times[359].toFixed(3),
    averageMs: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(3),
    chunks: sim.world.chunks.size,
    hash: sim.stateHash(),
    snapshotBytes: encodeSnapshot(sim, "local", 15000).byteLength,
  };
  results.push(result);
  console.log(JSON.stringify(result));
}
const report = {
  measuredAt: new Date().toISOString(),
  environment: {
    node: process.version,
    os: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model,
    logicalCores: cpus().length,
  },
  method:
    "120 warm-up ticks, 360 measured ticks, seed 142, one moving player. CPU simulation only; not a rendering or internet-latency benchmark.",
  results,
};
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/benchmark.json", JSON.stringify(report, null, 2));
