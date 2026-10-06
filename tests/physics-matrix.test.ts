import assert from "node:assert/strict";
import test from "node:test";
import { AgentRuntime } from "../src/engine/agent.ts";
import { type SaveState, Simulation } from "../src/engine/simulation.ts";
import { initializePhysics } from "../src/physics/bootstrap.ts";
import type { POLICY_DEFAULTS, PolicyEdit } from "../src/physics/policies.ts";
import { remainsId } from "../src/physics/rigs.ts";

// M12 functional matrix: every policy feature in POLICIES.md, demonstrated the same way.
// Each case's cause runs from the same saved scene (Brambleburst, seed 142):
//   on  → the effect is observed inside a scoped region;
//   off → the same cause is suppressed there;
//   the off state survives save/restore and reaches a late-join replica;
//   on again → the effect recovers from the current scene.
// Earlier milestone tests cover each feature's details; this matrix proves the uniform contract.

await initializePhysics();
type Key = keyof typeof POLICY_DEFAULTS;
interface Case {
  key: Key;
  on?: boolean | number;
  off: boolean | number;
  /** Creatures simulated (ambient physics needs some). */
  population?: number;
  /** The region the switch applies to (a circle around the cause). */
  at: (sim: Simulation) => { x: number; y: number };
  radius?: number;
  setup?: (sim: Simulation) => void;
  /** Perform the cause and return the effect's size. */
  cause: (sim: Simulation) => number;
  /** On: effect ≥ min. Off: effect ≤ max. */
  min: number;
  max: number;
}
const pose = (sim: Simulation, id: string) => sim.physical!.world.pose(id);
const moved = (sim: Simulation, id: string, act: () => void, ticks = 30) => {
  const a = pose(sim, id);
  act();
  sim.step(ticks);
  if (!sim.physical!.world.has(id)) return 999;
  const b = pose(sim, id);
  return Math.hypot(a.x - b.x, a.y - b.y);
};
const at = (id: string) => (sim: Simulation) => {
  const p = pose(sim, id);
  return { x: p.x, y: p.y };
};
function monster(sim: Simulation, x: number, y: number, hp = 400) {
  return sim.adventure.spawnMonster(sim, "stalker", x, y, { hp, passive: true });
}
function edit(sim: Simulation, edits: PolicyEdit[]) {
  const physical = sim.physical!;
  physical.configure({ expectedRevision: physical.world.policyState().nextRevision, edits });
  physical.world.applyPolicies(physical.world.policyState().nextRevision);
  physical.begin(sim);
}
const region = (sim: Simulation, c: Case, value: boolean | number): PolicyEdit[] => {
  const { x, y } = c.at(sim);
  return [
    {
      type: "region",
      profile: {
        id: "matrix",
        areaId: "area-1",
        priority: 900,
        shape: { kind: "circle", x, y, radius: c.radius ?? 60 },
        values: {},
      },
    },
    { type: "override", scope: "region", id: "matrix", values: { [c.key]: value } },
  ];
};
const effective = (sim: Simulation, c: Case, x: number, y: number) =>
  (
    new AgentRuntime(sim).execute({ op: "actors", action: "policy", x, y }) as {
      effective: Record<string, unknown>;
    }
  ).effective[c.key];

const strikeCrate = (sim: Simulation, damage: number) =>
  sim.adventure.strikeProp(sim, "local", "crate-1-0", damage, 0);
const CASES: Case[] = [
  {
    key: "worldReactions",
    off: false,
    at: at("crate-1-0"),
    cause: (sim) => moved(sim, "crate-1-0", () => strikeCrate(sim, 20)),
    min: 3,
    max: 0.01,
  },
  {
    key: "dynamicProps",
    off: false,
    at: at("crate-1-0"),
    cause: (sim) => moved(sim, "crate-1-0", () => strikeCrate(sim, 20)),
    min: 3,
    max: 0.01,
  },
  {
    key: "propBlocking",
    off: false,
    at: at("crate-1-0"),
    setup: (sim) => sim.teleport("local", pose(sim, "crate-1-0").x - 30, pose(sim, "crate-1-0").y),
    cause: (sim) => moved(sim, "crate-1-0", () => sim.setInput("local", { x: 1, y: 0 }), 50),
    min: 3,
    max: 0.5,
  },
  {
    key: "impulseStrength",
    off: 0,
    at: at("crate-1-0"),
    cause: (sim) =>
      moved(sim, "crate-1-0", () =>
        new AgentRuntime(sim).execute({
          op: "actors",
          action: "impulse",
          id: "crate-1-0",
          x: 120,
          y: 0,
        }),
      ),
    min: 3,
    max: 0.01,
  },
  {
    key: "crowdContacts",
    off: false,
    at: () => ({ x: 610, y: -30 }),
    setup: (sim) => {
      monster(sim, 610, -30);
      sim.teleport("local", 570, -30);
      sim.step(2);
    },
    // Walk east into a planted monster: with contacts it is shoved along, without you pass.
    cause: (sim) => {
      const e = sim.adventure.state.enemies.at(-1)!,
        x = e.x;
      sim.setInput("local", { x: 1, y: 0 });
      sim.step(60);
      sim.setInput("local", {});
      return Math.abs(e.x - x);
    },
    min: 5,
    max: 0.5,
  },
  {
    key: "ambientPhysics",
    on: true,
    off: false,
    population: 6,
    at: () => ({ x: 795, y: -110 }),
    setup: (sim) => {
      for (let i = 0; i < sim.count; i++) {
        sim.x[i] = 795 + (i % 3) * 12;
        sim.y[i] = -110 + Math.floor(i / 3) * 12;
      }
      sim.step();
    },
    cause: (sim) => {
      sim.step(2);
      return sim.physical!.inspect().movementOwners.rapierAmbient;
    },
    min: 6,
    max: 0,
  },
  {
    key: "sweptCollision",
    off: false,
    at: at("crate-1-0"),
    cause: (sim) => (pose(sim, "crate-1-0").ccdEnabled ? 1 : 0),
    min: 1,
    max: 0,
  },
  {
    key: "destruction",
    off: false,
    at: at("crate-1-0"),
    cause: (sim) => {
      strikeCrate(sim, 20);
      return 100 - (pose(sim, "crate-1-0").consequences?.durability ?? 100);
    },
    min: 5,
    max: 0,
  },
  {
    key: "materialDurability",
    off: 20,
    at: at("crate-1-0"),
    cause: (sim) => {
      strikeCrate(sim, 20);
      return 100 - (pose(sim, "crate-1-0").consequences?.durability ?? 100);
    },
    min: 20,
    max: 5,
  },
  {
    key: "debrisLifetime",
    on: 1,
    off: 0,
    at: at("crate-1-0"),
    // Break the crate, then count the debris pieces that expired after two seconds.
    cause: (sim) => {
      strikeCrate(sim, 5000);
      const pieces = sim.physical!.world.ids().filter((id) => id.startsWith("crate-1-0-"));
      sim.step(120);
      return pieces.filter((id) => !sim.physical!.world.has(id)).length;
    },
    min: 1,
    max: 0,
  },
  {
    key: "impactDamage",
    off: false,
    at: () => ({ x: 585, y: -30 }),
    radius: 70,
    setup: (sim) => {
      monster(sim, 610, -30);
      sim.physical!.world.place("crate-1-0", 560, -30);
      sim.step(2);
    },
    cause: (sim) => {
      const e = sim.adventure.state.enemies.at(-1)!,
        hp = e.hp;
      sim.physical!.world.motion("crate-1-0", 420, 0);
      sim.physical!.combat.instigate("crate-1-0", "local", "party", "throw", sim.tick);
      sim.step(30);
      return hp - e.hp;
    },
    min: 1,
    max: 0,
  },
  {
    key: "impactStrength",
    off: 0,
    at: () => ({ x: 585, y: -30 }),
    radius: 70,
    setup: (sim) => {
      monster(sim, 610, -30);
      sim.physical!.world.place("crate-1-0", 560, -30);
      sim.step(2);
    },
    cause: (sim) => {
      const e = sim.adventure.state.enemies.at(-1)!,
        hp = e.hp;
      sim.physical!.world.motion("crate-1-0", 420, 0);
      sim.physical!.combat.instigate("crate-1-0", "local", "party", "throw", sim.tick);
      sim.step(30);
      return hp - e.hp;
    },
    min: 1,
    max: 0,
  },
  {
    key: "projectileWorld",
    off: false,
    at: () => ({ x: 580, y: 60 }),
    radius: 120,
    setup: (sim) => {
      sim.teleport("local", 500, 60);
      monster(sim, 660, 60);
      sim.physical!.world.place("crate-1-0", 560, 60);
      sim.step(2);
    },
    // An enemy shot at the traveler: 1 when the crate takes it as cover.
    cause: (sim) => {
      const e = sim.adventure.state.enemies.at(-1)!,
        h = sim.adventure.hero("local"),
        hp = h.hp;
      h.invulnerableUntil = 0;
      (sim.adventure as unknown as { projectile: (...a: unknown[]) => void }).projectile(
        e.x,
        e.y,
        Math.PI,
        240,
        9,
        `enemy-${e.id}`,
        true,
      );
      sim.step(50);
      return h.hp < hp ? 0 : 1;
    },
    min: 1,
    max: 0,
  },
  {
    key: "physicalLoot",
    off: false,
    at: () => ({ x: 560, y: 60 }),
    radius: 90,
    setup: (sim) => {
      monster(sim, 560, 60, 5);
      sim.step(2);
    },
    cause: (sim) => {
      const e = sim.adventure.state.enemies.at(-1)!;
      sim.adventure.strikeEnemy(sim, "local", e.id, 1000, 0);
      sim.step(4);
      return sim.physical!.world.ids().filter((id) => id.startsWith("loot-")).length;
    },
    min: 1,
    max: 0,
  },
  {
    key: "mechanisms",
    off: false,
    at: at("prop-chain-1-post"),
    cause: (sim) =>
      moved(sim, "prop-chain-1-ball", () =>
        sim.physical!.world.motion("prop-chain-1-ball", 0, 260),
      ),
    min: 3,
    max: 0.01,
  },
  {
    key: "jointBreakage",
    off: false,
    at: at("prop-chain-1-post"),
    cause: (sim) => (sim.physical!.cut(sim, "local", "chain-1:anchor").broken ? 1 : 0),
    min: 1,
    max: 0,
  },
  {
    key: "jointStrength",
    off: 20,
    at: at("prop-chain-1-post"),
    // A fixed blow: enough to sever at normal strength, not at twenty times.
    cause: (sim) => (sim.physical!.cut(sim, "local", "chain-1:anchor", 120).broken ? 1 : 0),
    min: 1,
    max: 0,
  },
  {
    key: "materialReactions",
    off: false,
    at: at("prop-brush-1-0"),
    cause: (sim) => {
      const b = pose(sim, "prop-brush-1-0");
      sim.physical!.stimulate(sim, "fire", {
        x: b.x,
        y: b.y,
        target: b.id,
        owner: "local",
        team: "party",
      });
      sim.step(5);
      return sim.physical!.reactions.status(b.id)?.burning ?? 0;
    },
    min: 1,
    max: 0,
  },
  {
    key: "chainReactions",
    off: false,
    at: at("prop-brush-1-1"),
    radius: 40,
    // Fire on the first brush: does it spread along the fuse?
    cause: (sim) => {
      const b = pose(sim, "prop-brush-1-0");
      sim.physical!.stimulate(sim, "fire", {
        x: b.x,
        y: b.y,
        target: b.id,
        owner: "local",
        team: "party",
      });
      sim.step(240);
      return ["prop-brush-1-1", "prop-brush-1-2", "prop-brush-1-3"].filter(
        (id) =>
          !sim.physical!.world.has(id) || (sim.physical!.reactions.status(id)?.burning ?? 0) > 0,
      ).length;
    },
    min: 1,
    max: 0,
  },
  {
    key: "environmentalForces",
    off: false,
    at: at("crate-1-0"),
    cause: (sim) => moved(sim, "crate-1-0", () => wind(sim), 40),
    min: 3,
    max: 0.01,
  },
  {
    key: "fieldStrength",
    off: 0,
    at: at("crate-1-0"),
    cause: (sim) => moved(sim, "crate-1-0", () => wind(sim), 40),
    min: 3,
    max: 0.01,
  },
  {
    key: "ragdolls",
    off: false,
    at: () => ({ x: 560, y: 60 }),
    radius: 90,
    setup: (sim) => {
      monster(sim, 560, 60, 5);
      sim.step(2);
    },
    cause: (sim) => {
      const e = sim.adventure.state.enemies.at(-1)!;
      sim.adventure.strikeEnemy(sim, "local", e.id, 1000, 0);
      sim.step(4);
      return sim.physical!.world.assemblyList().some((a) => a.id === remainsId(e.id)) ? 1 : 0;
    },
    min: 1,
    max: 0,
  },
  {
    key: "foliage",
    off: false,
    at: at("prop-brush-1-0"),
    radius: 30,
    cause: (sim) => {
      sim.adventure.strikeProp(sim, "local", "prop-brush-1-0", 1);
      sim.step(3);
      return Math.abs(sim.physical!.rigs.bendOf("prop-brush-1-0")) * 1000;
    },
    min: 1,
    max: 0,
  },
  {
    key: "reactionStrength",
    off: 0,
    at: () => ({ x: 560, y: 60 }),
    radius: 90,
    setup: (sim) => {
      monster(sim, 560, 60, 5000);
      sim.step(2);
    },
    // A blow's poise toward stagger and knockdown.
    cause: (sim) => {
      const e = sim.adventure.state.enemies.at(-1)!;
      sim.adventure.strikeEnemy(sim, "local", e.id, 60, 0);
      return e.reaction.poise;
    },
    min: 1,
    max: 0,
  },
];
function wind(sim: Simulation) {
  const c = pose(sim, "crate-1-0");
  sim.physical!.reactions.addField({
    id: "matrix-wind",
    kind: "wind",
    areaId: "area-1",
    shape: { kind: "lane", x: c.x - 40, y: c.y, angle: 0, length: 90, width: 50 },
    strength: 600,
    ticks: -1,
    gust: 0,
    actors: false,
    owner: "",
    team: "world",
    source: "matrix",
  });
}

/** Brambleburst with its waves and mechanics stilled, the traveler at the trailhead. */
function base(c: Case): SaveState {
  const sim = new Simulation(142, c.population ?? 0);
  try {
    sim.addPlayer("local");
    sim.adventure.startArea(sim, 1);
    const s = sim.adventure.state;
    s.enemies = [];
    s.spawned = s.recipe.killGoal;
    s.mechanics = [];
    sim.step();
    c.setup?.(sim);
    return JSON.parse(JSON.stringify(sim.save())) as SaveState;
  } finally {
    sim.dispose();
  }
}

const MATRIX_KEYS = CASES.map((c) => c.key);
const results: Record<string, unknown>[] = [];
for (const c of CASES)
  test(`${c.key}: on, off in a region, off survives save/restore and replication, on again`, () => {
    const saved = base(c);
    const run = (value: boolean | number | undefined) => {
      const sim = Simulation.restore(structuredClone(saved));
      if (value !== undefined) {
        edit(sim, region(sim, c, value));
        sim.step(2);
      }
      return sim;
    };
    // On.
    const on = run(c.on);
    const onEffect = c.cause(on);
    on.dispose();
    // Off in a region around the cause.
    const off = run(c.off);
    const { x, y } = c.at(off);
    assert.equal(effective(off, c, x, y), c.key === "worldReactions" ? false : c.off);
    const offSave = JSON.parse(JSON.stringify(off.save())) as SaveState;
    const guestView = JSON.parse(JSON.stringify(off.save(true))) as SaveState;
    const offEffect = c.cause(off);
    off.dispose();
    // The off state survives save/restore …
    const restored = Simulation.restore(offSave);
    assert.equal(effective(restored, c, x, y), c.key === "worldReactions" ? false : c.off);
    const restoredEffect = c.cause(restored);
    restored.dispose();
    // … and reaches a late-join replica.
    const guest = new Simulation(142, 0);
    guest.applyReplica(guestView);
    const guestValue = effective(guest, c, x, y);
    guest.dispose();
    // On again from the off scene: remove the region's override.
    const again = Simulation.restore(offSave);
    edit(again, [
      { type: "reset", scope: "region", id: "matrix", to: "inherited" },
      ...(c.on !== undefined
        ? [
            {
              type: "override" as const,
              scope: "region" as const,
              id: "matrix",
              values: { [c.key]: c.on },
            },
          ]
        : []),
    ]);
    again.step(2);
    const againEffect = c.cause(again);
    again.dispose();
    results.push({ key: c.key, onEffect, offEffect, restoredEffect, guestValue, againEffect });
    assert.ok(onEffect >= c.min, `${c.key} on: effect ${onEffect} ≥ ${c.min}`);
    assert.ok(offEffect <= c.max, `${c.key} off: effect ${offEffect} ≤ ${c.max}`);
    assert.ok(
      restoredEffect <= c.max,
      `${c.key} restored off: effect ${restoredEffect} ≤ ${c.max}`,
    );
    assert.equal(
      guestValue,
      c.key === "worldReactions" ? false : c.off,
      `${c.key} reaches a guest`,
    );
    assert.ok(againEffect >= c.min, `${c.key} on again: effect ${againEffect} ≥ ${c.min}`);
  });
// The dependency combinations POLICIES.md names, where one value changes another's meaning.
// Region boundaries in both directions and broader overrides are covered in
// tests/physics-policies.test.ts; each feature's own details in its milestone's tests.
test("dependency combinations: master off beats features on; joints off still cut; impact damage without destruction; base combat without reactions", () => {
  const scene = base({
    key: "worldReactions",
    off: false,
    at: at("crate-1-0"),
    cause: () => 0,
    min: 0,
    max: 0,
  });
  const open = (edits: PolicyEdit[]) => {
    const sim = Simulation.restore(structuredClone(scene));
    edit(sim, edits);
    sim.step(2);
    return sim;
  };
  const policy = (sim: Simulation, x: number, y: number) =>
    new AgentRuntime(sim).execute({ op: "actors", action: "policy", x, y }) as {
      values: Record<string, unknown>;
      effective: Record<string, unknown>;
    };
  const area = (values: Record<string, boolean>): PolicyEdit => ({
    type: "override",
    scope: "area",
    id: "area-1",
    values,
  });
  const pieces = (sim: Simulation) =>
    sim.physical!.world.ids().filter((id) => id.startsWith("crate-1-0-")).length;

  // Master off with destruction and loose props explicitly on: the requested values stay
  // inspectable, the master wins, a heavy blow neither moves nor breaks the crate …
  let sim = open([
    area({ destruction: true, dynamicProps: true }),
    { type: "master", enabled: false },
  ]);
  try {
    const c = pose(sim, "crate-1-0");
    const p = policy(sim, c.x, c.y);
    assert.equal(p.values.destruction, true);
    assert.equal(p.values.dynamicProps, true);
    assert.equal(p.effective.destruction, false);
    assert.equal(p.effective.dynamicProps, false);
    assert.ok(moved(sim, "crate-1-0", () => strikeCrate(sim, 5000)) < 0.01);
    assert.ok(sim.physical!.world.has("crate-1-0"));
    assert.equal(pieces(sim), 0);
    // … and base combat still runs: a blow hurts and kills a monster, credited to the traveler.
    const e = monster(sim, 610, -30, 50);
    sim.step(2);
    const kills = sim.adventure.hero("local").kills;
    sim.adventure.strikeEnemy(sim, "local", e.id, 30, 0);
    assert.ok(e.hp < 50, `hurt to ${e.hp}`);
    sim.adventure.strikeEnemy(sim, "local", e.id, 1000, 0);
    sim.step(2);
    assert.ok(e.hp <= 0);
    assert.equal(sim.adventure.hero("local").kills, kills + 1);
  } finally {
    sim.dispose();
  }

  // Joints off with breakage on: the chain is frozen, yet a cut still severs its anchor.
  sim = open([area({ mechanisms: false, jointBreakage: true })]);
  try {
    const travel = moved(sim, "prop-chain-1-ball", () =>
      sim.physical!.world.motion("prop-chain-1-ball", 0, 260),
    );
    assert.ok(travel < 0.01, `frozen ball moved ${travel}`);
    assert.ok(sim.physical!.cut(sim, "local", "chain-1:anchor").broken);
  } finally {
    sim.dispose();
  }

  // Destruction off with impact damage on: a thrown crate still hurts, and stays whole.
  sim = open([area({ destruction: false, impactDamage: true })]);
  try {
    const e = monster(sim, 610, -30);
    sim.physical!.world.place("crate-1-0", 560, -30);
    sim.step(2);
    const hp = e.hp;
    sim.physical!.world.motion("crate-1-0", 420, 0);
    sim.physical!.combat.instigate("crate-1-0", "local", "party", "throw", sim.tick);
    sim.step(30);
    assert.ok(hp - e.hp >= 1, `impact dealt ${hp - e.hp}`);
    strikeCrate(sim, 5000);
    sim.step(2);
    assert.ok(sim.physical!.world.has("crate-1-0"));
    assert.equal(pieces(sim), 0);
  } finally {
    sim.dispose();
  }
});
test("the matrix covers every policy value", async () => {
  const { POLICY_DEFAULTS } = await import("../src/physics/policies.ts");
  assert.deepEqual([...MATRIX_KEYS].sort(), Object.keys(POLICY_DEFAULTS).sort());
  if (process.env.MATRIX_REPORT) console.log(JSON.stringify(results));
});
