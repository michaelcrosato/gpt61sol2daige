import assert from "node:assert/strict";
import test from "node:test";
import {
  FEATURE_GROUPS,
  PRESET_TEXT,
  presetDifferences,
  regionLabel,
  WorldPhysicsPanel,
} from "../src/app/world-physics.ts";
import { AgentRuntime } from "../src/engine/agent.ts";
import { Simulation } from "../src/engine/simulation.ts";
import { initializePhysics } from "../src/physics/bootstrap.ts";
import { POLICY_DEFAULTS, POLICY_PRESETS } from "../src/physics/policies.ts";

// M12 World physics panel logic, headless: the panel drives the agent API, so every control can
// be exercised without a browser (the browser scenarios in e2e/physics-controls.spec.ts click
// the same controls with real keyboard, mouse and touch input).

await initializePhysics();
const click = (dataset: Record<string, string>) => ({ dataset }) as unknown as HTMLElement;
function panel(paused = true, authority = true) {
  const sim = new Simulation(142, 0);
  sim.addPlayer("local");
  sim.adventure.startArea(sim, 1);
  sim.step();
  const runtime = new AgentRuntime(sim);
  const highlights: { body: string | null; region: string | null }[] = [];
  let picks = 0;
  const p = new WorldPhysicsPanel({
    sim: () => runtime.sim,
    player: () => "local",
    execute: (command) => runtime.execute(command),
    authority: () => authority,
    paused: () => paused,
    pick: () => picks++,
    highlight: (h) => highlights.push(h),
  });
  const at = (x: number, y: number) =>
    (
      runtime.execute({ op: "actors", action: "policy", x, y }) as {
        effective: typeof POLICY_DEFAULTS;
      }
    ).effective;
  return { sim, runtime, p, at, highlights, picks: () => picks };
}

test("every policy value has one labelled control with an explanation, and every preset an explanation and exact values", () => {
  const keys = FEATURE_GROUPS.flatMap((g) => g.fields.map((f) => f.key));
  assert.deepEqual([...keys].sort(), Object.keys(POLICY_DEFAULTS).sort());
  assert.equal(new Set(keys).size, keys.length);
  for (const f of FEATURE_GROUPS.flatMap((g) => g.fields)) {
    assert.ok(f.label && f.help.length > 10, f.key);
    if (typeof POLICY_DEFAULTS[f.key] === "number") assert.ok(f.range, `${f.key} has a range`);
  }
  for (const name of Object.keys(POLICY_PRESETS) as (keyof typeof POLICY_PRESETS)[])
    assert.ok(PRESET_TEXT[name].length > 20, name);
  assert.equal(presetDifferences("Reactive"), "Exactly the defaults.");
  assert.match(presetDifferences("Quiet"), /Destruction off/);
  assert.match(presetDifferences("Wild"), /Shove strength × 2\.5/);
  assert.equal(regionLabel({ id: "calm-3" }, new Map()).name, "Calm ring");
  assert.equal(
    regionLabel({ id: "combo-12-0" }, new Map([["combo-12-0", "fire-stockade" as const]])).name,
    "Burning palisade",
  );
});

test("the panel edits an area, a region and the session master through the agent API, then undoes everything", () => {
  const { sim, runtime, p, at } = panel();
  try {
    const crate = sim.physical!.world.pose("crate-1-0");
    // Area scope: loose props off, applied at once while paused.
    p.click(click({ wp: "scope", scope: "area" }));
    p.click(click({ wp: "set", key: "dynamicProps", value: "false" }));
    assert.equal(at(crate.x, crate.y).dynamicProps, false);
    assert.match(p.render(), /Loose props move off at area-1\. Applied\./);
    // A numeric control: empty restores the default, out of range is refused visibly.
    const input = { dataset: { wp: "number", key: "impulseStrength" }, value: "2" };
    p.change(input as unknown as HTMLInputElement);
    assert.equal(at(crate.x, crate.y).impulseStrength, 2);
    input.value = "11";
    p.change(input as unknown as HTMLInputElement);
    assert.match(p.render(), /Shove strength × must be 0–10/);
    input.value = "";
    p.change(input as unknown as HTMLInputElement);
    assert.equal(at(crate.x, crate.y).impulseStrength, 1);
    // Default for one field keeps the others.
    p.click(click({ wp: "set", key: "destruction", value: "false" }));
    p.click(click({ wp: "set", key: "dynamicProps", value: "default" }));
    assert.equal(at(crate.x, crate.y).dynamicProps, true);
    assert.equal(at(crate.x, crate.y).destruction, false);
    // Region scope: a preset, moved and grown, then reset to authored.
    const policies = () =>
      runtime.execute({ op: "actors", action: "policies" }) as {
        state: {
          profiles: {
            regions: {
              id: string;
              priority: number;
              shape: { x: number; y: number; radius: number };
            }[];
          };
          masterWorldReactions: boolean;
          overrides: unknown[];
        };
      };
    const calm = () => policies().state.profiles.regions.find((r) => r.id === "calm-1")!;
    const authored = structuredClone(calm());
    p.click(click({ wp: "region", id: "calm-1" }));
    p.click(click({ wp: "preset", preset: "Wild" }));
    assert.equal(at(authored.shape.x, authored.shape.y).impulseStrength, 2.5);
    p.click(click({ wp: "region-grow" }));
    p.click(click({ wp: "region-raise" }));
    assert.equal(calm().shape.radius, authored.shape.radius * 1.25);
    assert.equal(calm().priority, authored.priority + 5);
    p.click(click({ wp: "reset", to: "authored" }));
    assert.deepEqual(calm(), authored);
    assert.equal(at(authored.shape.x, authored.shape.y).impulseStrength, 1, "calm again");
    // A new region around the traveler, then removed.
    p.click(click({ wp: "region-new" }));
    assert.ok(policies().state.profiles.regions.some((r) => r.id === "custom-1"));
    p.click(click({ wp: "preset", preset: "Quiet" }));
    const hero = sim.players.get("local")!;
    assert.equal(at(hero.x, hero.y).dynamicProps, false);
    p.click(click({ wp: "region-remove" }));
    assert.ok(!policies().state.profiles.regions.some((r) => r.id === "custom-1"));
    // The session master, then Undo every live change.
    p.click(click({ wp: "master", enabled: "false" }));
    assert.equal(at(crate.x, crate.y).worldReactions, false);
    p.click(click({ wp: "reset-all" }));
    assert.equal(policies().state.masterWorldReactions, true);
    assert.deepEqual(policies().state.overrides, []);
    assert.equal(at(crate.x, crate.y).destruction, true);
  } finally {
    runtime.sim.dispose();
  }
});

test("running (a co-op host), edits queue for the next tick; a guest's panel is read-only", () => {
  const host = panel(false);
  try {
    const crate = host.sim.physical!.world.pose("crate-1-0");
    host.p.click(click({ wp: "set", key: "destruction", value: "false" }));
    assert.match(host.p.render(), /Applies next tick/);
    assert.equal(host.at(crate.x, crate.y).destruction, true, "still queued");
    host.sim.step();
    assert.equal(host.at(crate.x, crate.y).destruction, false);
    // A late-join replica: the same values, no edit controls.
    const guestSim = new Simulation(142, 0);
    guestSim.applyReplica(JSON.parse(JSON.stringify(host.sim.save(true))));
    const guest = new AgentRuntime(guestSim);
    const view = new WorldPhysicsPanel({
      sim: () => guestSim,
      player: () => "local",
      execute: (command) => guest.execute(command),
      authority: () => false,
      paused: () => false,
      pick: () => {},
      highlight: () => {},
    });
    const html = view.render();
    assert.match(html, /The host controls shared physics/);
    assert.match(html, /data-key="destruction" data-value="false" aria-pressed="true" disabled/);
    guestSim.dispose();
  } finally {
    host.runtime.sim.dispose();
  }
});

test("the inspector reports an object's material, motion, policy source, mechanism and last reaction", () => {
  const { sim, runtime, p, highlights } = panel();
  try {
    const brush = sim.physical!.world.pose("prop-brush-1-0");
    sim.physical!.stimulate(sim, "fire", {
      x: brush.x,
      y: brush.y,
      target: brush.id,
      owner: "local",
      team: "party",
    });
    sim.step(3);
    assert.equal(p.selectNear(brush.x, brush.y, 4), brush.id);
    assert.deepEqual(highlights.at(-1), { body: brush.id, region: null });
    let html = p.render();
    assert.match(html, /brush · vegetation/);
    assert.match(html, /burning \d+/);
    assert.match(html, /(ignite|burn|spread) by local/);
    // A mechanism member and a policy source.
    p.click(click({ wp: "set", key: "mechanisms", value: "false" }));
    p.selectBody("prop-chain-1-ball");
    html = p.render();
    assert.match(html, /Mechanism<\/dt><dd>chain-1/);
    assert.match(html, /Jointed mechanisms off <small>\(area:area-1\/override\)<\/small>/);
    assert.match(html, /frozen/);
  } finally {
    runtime.sim.dispose();
  }
});
