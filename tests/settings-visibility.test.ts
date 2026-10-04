import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS, parseSettings, updateSettings } from "../src/app/preferences.ts";
import { MAX_NPCS } from "../src/engine/limits.ts";
import { Simulation } from "../src/engine/simulation.ts";
import { EntityVisibility } from "../src/engine/visibility.ts";
import { decodeSnapshot, encodeSnapshot, MAX_PACKET } from "../src/net/protocol.ts";

test("settings persist exact values and reject malformed or excessive work budgets", () => {
  const next = updateSettings(
    { ...DEFAULT_SETTINGS },
    { drawDistance: 16384, entityLimit: MAX_NPCS, population: 32768, showPerformance: false },
  );
  assert.deepEqual(parseSettings(JSON.stringify(next)), next);
  for (const raw of [null, "{", '"bad"', '{"version":99}', '{"version":1,"population":999999999}'])
    assert.deepEqual(parseSettings(raw), DEFAULT_SETTINGS);
  for (const patch of [
    { drawDistance: 255 },
    { entityLimit: MAX_NPCS + 1 },
    { population: 2.5 },
    { drawDistance: Infinity },
  ])
    assert.throws(() => updateSettings(next, patch), /integer/);
  assert.deepEqual(updateSettings(next, { entityLimit: 0 }).entityLimit, 0);
});
test("view budgets enforce a real draw radius and cap, favor nearby creatures, and keep stable identities", () => {
  const x = new Float64Array([95, 2, -4, 90, 200, 0]),
    y = new Float64Array([0, 0, 0, 0, 0, 80]);
  const view = new EntityVisibility(6);
  view.select(x, y, 6, { x: 0, y: 0, radius: 100, top: -20, bottom: 20 }, 2);
  assert.equal(view.candidates, 4);
  assert.deepEqual([...view.ids.subarray(0, view.count)], [1, 2]);
  view.select(x, y, 6, { x: 0, y: 0, radius: 100 }, 0);
  assert.equal(view.count, 0);
  view.select(x, y, 6, { x: 0, y: 0, radius: 3 }, 6);
  assert.deepEqual([...view.ids.subarray(0, view.count)], [1]);
  view.select(x, y, 6, { x: 90, y: 0, radius: 10 }, 6);
  assert.deepEqual([...view.ids.subarray(0, view.count)], [0, 3]);
});
test("the expanded maximum remains finite and resumes exactly from a checkpoint", () => {
  const sim = new Simulation(142, MAX_NPCS);
  sim.addPlayer("p");
  sim.setInput("p", { x: 0.4, dash: true });
  sim.step(4);
  assert.equal(sim.count, 65536);
  assert.ok(sim.x.every(Number.isFinite));
  assert.ok(sim.y.every(Number.isFinite));
  const restored = Simulation.restore(sim.save());
  sim.step(4);
  restored.step(4);
  assert.deepEqual(restored.save(), sim.save());
});
test("full-capacity packets preserve entity 65535 and bounded per-client camera interests", () => {
  const sim = new Simulation(142, MAX_NPCS);
  sim.addPlayer("p");
  const packet = encodeSnapshot(sim, "p", 16384);
  assert.ok(packet.byteLength > 1_000_000 && packet.byteLength <= MAX_PACKET);
  const result = decodeSnapshot(packet);
  assert.equal(result.population, MAX_NPCS);
  assert.equal(result.sim.count, MAX_NPCS);
  assert.ok(Math.abs(result.sim.x[65535] - sim.x[65535]) < 0.001);
  const small = decodeSnapshot(
    encodeSnapshot(sim, "p", { x: 700, y: 0, radius: 256, entityLimit: 150 }),
  );
  assert.equal(small.population, MAX_NPCS);
  assert.ok(small.sim.count <= 150);
  for (let i = 0; i < small.sim.count; i++)
    assert.ok(Math.hypot(small.sim.x[i] - 700, small.sim.y[i]) <= 256.001);
  const empty = decodeSnapshot(
    encodeSnapshot(sim, "p", { x: 0, y: 0, radius: 1024, entityLimit: 0 }),
  );
  assert.equal(empty.sim.count, 0);
  assert.equal(empty.sim.players.size, 1);
});

test("high-population checkpoints remain deterministic while party regions rebalance", () => {
  const sim = new Simulation(142, 16384);
  sim.addPlayer("p0");
  sim.addPlayer("p1");
  sim.step(2);
  sim.players.get("p1")!.x = 10000;
  const restored = Simulation.restore(sim.save());
  sim.step(90);
  restored.step(90);
  assert.deepEqual(restored.save(), sim.save());
});
