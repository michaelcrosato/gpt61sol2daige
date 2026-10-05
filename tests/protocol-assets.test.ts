import assert from "node:assert/strict";
import test from "node:test";
import {
  MATERIAL_SOUNDS,
  REACTION_SOUNDS,
  type SoundName,
  synthesize,
  wav,
} from "../src/audio/synth.ts";
import { Simulation } from "../src/engine/simulation.ts";
import { decodeSnapshot, encodeSnapshot, snapshotBuffer } from "../src/net/protocol.ts";
import { initializePhysics } from "../src/physics/bootstrap.ts";
import { spritePixels, spriteSvg, validateRecipe } from "../src/render/sprites.ts";

await initializePhysics();

test("binary snapshots synchronize players, shared quest, and thousands of creatures", () => {
  const sim = new Simulation(142, 6000);
  for (let i = 0; i < 8; i++) sim.addPlayer(`p${i}`);
  sim.step(5);
  sim.shards = 7;
  sim.beacons.add("north");
  const packet = encodeSnapshot(sim, "p0", 15000),
    result = decodeSnapshot(packet);
  assert.equal(result.sim.count, 6000);
  assert.equal(result.sim.players.size, 8);
  assert.equal(result.sim.shards, 7);
  assert.ok(result.sim.beacons.has("north"));
  assert.equal(result.population, 6000);
  assert.equal(result.sim.tick, 5);
  assert.ok(packet.byteLength < 110000);
  for (let i = 0; i < 6000; i++) assert.ok(Math.abs(sim.x[i] - result.sim.x[i]) < 0.001);
});
test("relative float encoding preserves subpixel precision millions of units from origin", () => {
  const sim = new Simulation(142, 1),
    p = sim.addPlayer("p");
  p.x = 8_000_000.321;
  p.y = -8_000_000.123;
  sim.x[0] = p.x + 12.987;
  sim.y[0] = p.y - 900.123;
  const decoded = decodeSnapshot(encodeSnapshot(sim, "p", 2000)).sim;
  assert.ok(Math.abs(decoded.x[0] - sim.x[0]) < 0.00001);
  assert.ok(Math.abs(decoded.y[0] - sim.y[0]) < 0.0001);
});

test("combat snapshots preserve personal builds, interpolate motion and snap across portals", () => {
  const host = new Simulation(142, 0);
  host.addPlayer("host");
  host.addPlayer("guest");
  host.adventure.action(host, "host", { type: "buy", index: 2 });
  host.adventure.action(host, "guest", { type: "buy", index: 2 });
  host.adventure.action(host, "guest", { type: "skill", id: "blade-0" });
  host.adventure.action(host, "host", { type: "depart" });
  host.step(1);
  const client = decodeSnapshot(encodeSnapshot(host, "guest")).sim;
  assert.equal(client.adventure.hero("guest").inventory.length, 3);
  assert.equal(client.adventure.hero("host").inventory.length, 2);
  assert.equal(client.adventure.hero("guest").skills["blade-0"], 1);
  const enemy = host.adventure.state.enemies[0],
    oldX = enemy.x,
    oldPlayerX = client.players.get("guest")!.x;
  enemy.x += 20;
  host.players.get("guest")!.x += 30;
  host.tick += 6;
  decodeSnapshot(encodeSnapshot(host, "guest"), client);
  assert.equal(client.adventure.state.enemies[0].px, oldX);
  assert.equal(client.adventure.state.enemies[0].x, oldX + 20);
  assert.equal(client.players.get("guest")!.px, oldPlayerX);
  host.adventure.startArea(host, 2);
  decodeSnapshot(encodeSnapshot(host, "guest"), client);
  assert.equal(client.players.get("guest")!.px, client.players.get("guest")!.x);
  assert.ok(client.adventure.state.enemies.every((e) => e.px === e.x && e.py === e.y));
});

test("chunked PeerJS Uint8Array payloads preserve offsets and decode large snapshots", () => {
  const sim = new Simulation(142, 2400);
  sim.addPlayer("p");
  const packet = encodeSnapshot(sim, "p", 15000);
  const padded = new Uint8Array(packet.byteLength + 20);
  padded.set(new Uint8Array(packet), 10);
  const normalized = snapshotBuffer(padded.subarray(10, 10 + packet.byteLength));
  assert.equal(decodeSnapshot(normalized).sim.count, 2400);
  assert.deepEqual(new Uint8Array(normalized), new Uint8Array(packet));
});
test("interest filtering excludes remote creatures and malformed packets are rejected atomically", () => {
  const sim = new Simulation(142, 10);
  sim.addPlayer("p");
  sim.x.fill(10000);
  sim.y.fill(10000);
  assert.equal(decodeSnapshot(encodeSnapshot(sim, "p", 100)).sim.count, 0);
  const packet = encodeSnapshot(sim, "p", 15000);
  const before = sim.stateHash();
  new DataView(packet).setUint32(4, 20000, true);
  assert.throws(() => decodeSnapshot(packet, sim), /framing/);
  assert.equal(sim.stateHash(), before);
  assert.throws(() => decodeSnapshot(new ArrayBuffer(2)), /size/);
  const bad = encodeSnapshot(sim, "p", 15000);
  const view = new DataView(bad);
  view.setFloat32(8 + view.getUint32(0, true) + 4, NaN, true);
  assert.throws(() => decodeSnapshot(bad, sim), /entity/);
  assert.equal(sim.stateHash(), before);
});
test("sprite recipes are deterministic, animated and restrict palette injection", () => {
  const recipe = validateRecipe({ version: 1, kind: "player", seed: 142 });
  assert.equal(spriteSvg(recipe), spriteSvg(recipe));
  assert.notEqual(spriteSvg(recipe, 0), spriteSvg(recipe, 2));
  assert.ok(spritePixels(recipe).length > 10);
  assert.throws(
    () =>
      validateRecipe({
        version: 1,
        kind: "player",
        seed: 1,
        palette: ["<script>", "#000000", "#000000", "#000000", "#000000"],
      }),
    /Palette/,
  );
});
test("every procedural sound is deterministic, non-silent, bounded, and encodes valid PCM WAV", () => {
  for (const name of [
    "pulse",
    "shard",
    "beacon",
    "dash",
    "step",
    "ambient",
    "slash",
    "hit",
    "hurt",
    "level",
    ...MATERIAL_SOUNDS,
    "crumble",
    ...REACTION_SOUNDS,
  ] as SoundName[]) {
    const samples = synthesize(name),
      bytes = wav(samples),
      view = new DataView(bytes.buffer);
    assert.deepEqual(samples, synthesize(name));
    assert.ok(samples.every((s) => Number.isFinite(s) && Math.abs(s) <= 1));
    const rms = Math.sqrt(samples.reduce((sum, s) => sum + s * s, 0) / samples.length);
    assert.ok(rms > 0.005, `${name} is silent`);
    assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), "RIFF");
    assert.equal(view.getUint32(40, true), samples.length * 2);
    assert.equal(view.getUint32(24, true), 22050);
  }
});
