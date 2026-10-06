import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { AgentRuntime, replay } from "../src/engine/agent.ts";
import { type SaveState, Simulation } from "../src/engine/simulation.ts";
import { Terrain } from "../src/engine/world.ts";
import { ATTACKS, attackExport } from "../src/game/interactions.ts";
import { rollItem } from "../src/game/loot.ts";
import { SKILLS } from "../src/game/skills.ts";
import type { Enemy } from "../src/game/types.ts";
import { enemyBodyId } from "../src/physics/adventure.ts";
import { initializePhysics } from "../src/physics/bootstrap.ts";
import { GRAB_REACH, lootBodyId } from "../src/physics/combat.ts";
import type { PolicyEdit } from "../src/physics/policies.ts";

await initializePhysics();
/** Area 1 with one stationary monster, no waves and no area mechanics (no chain reactions). */
function arena() {
  const sim = new Simulation(142, 0);
  sim.addPlayer("local");
  sim.adventure.startArea(sim, 1);
  sim.step();
  const s = sim.adventure.state,
    e = s.enemies[0];
  s.enemies = [e];
  s.spawned = s.recipe.killGoal;
  s.mechanics = [];
  freeze(e);
  return { sim, s, e, r: s.recipe };
}
function freeze(e: Enemy, hp = 400) {
  e.rootUntil = 1e9;
  e.speed = 0;
  e.nextAttack = 1e9;
  e.hp = e.maxHp = hp;
}
function put(sim: Simulation, e: Enemy, x: number, y: number) {
  sim.physical!.world.place(enemyBodyId(e.id), x, y);
  e.x = x;
  e.y = y;
}
function edit(sim: Simulation, edits: PolicyEdit[]) {
  const physical = sim.physical!;
  physical.configure({ expectedRevision: physical.world.policyState().nextRevision, edits });
  physical.world.applyPolicies(physical.world.policyState().nextRevision);
  physical.begin(sim);
}
const events = (sim: Simulation, type: string) =>
  sim.adventure.state.events.filter((e) => e.type === type);
const aimAt = (sim: Simulation, x: number, y: number) => {
  const p = sim.players.get("local")!,
    angle = Math.atan2(y - p.y, x - p.x);
  sim.setInput("local", { aimX: Math.cos(angle), aimY: Math.sin(angle) });
};

test("the shared attack spec covers every ability and exports reproducibly", () => {
  for (const kind of ["slash0", "slash1", "slash2", "whorl", "nova", "lance", "dash", "bloom"])
    assert.ok(kind in ATTACKS, kind);
  assert.equal(ATTACKS.lance.scenery, "pierce");
  assert.equal(ATTACKS.shot.scenery, "cover");
  assert.equal(ATTACKS.charge.team, "enemy");
  assert.equal(JSON.stringify(attackExport()), JSON.stringify(attackExport()));
  const { sim } = arena();
  try {
    const agent = new AgentRuntime(sim);
    assert.deepEqual(
      agent.execute({ op: "actors", action: "attacks" }),
      JSON.parse(JSON.stringify(attackExport())),
    );
  } finally {
    sim.dispose();
  }
});

test("each active ability has a repeatable physical consequence on nearby scenery", () => {
  const results: Record<string, number> = {};
  for (const [ability, input] of [
    ["slash", { attack: true, aimX: 1, aimY: 0 }],
    ["whorl", { pulse: true }],
    ["lance", { lance: true, aimX: 1, aimY: 0 }],
    ["nova", { nova: true }],
    ["dash", { dash: true, x: 1 }],
  ] as const) {
    const { sim, r } = arena();
    try {
      const h = sim.adventure.hero("local");
      h.skills["gale-3"] = 1; // Thornlance
      h.skills["ember-3"] = 1; // Bloom Nova
      sim.players.get("local")!.energy = 100;
      const x = r.x + 160,
        y = r.y + 20;
      sim.physical!.world.place("crate-1-3", x + 28, y);
      sim.teleport("local", x, y);
      sim.players.get("local")!.facing = 0;
      sim.step(2);
      const before = sim.physical!.world.pose("crate-1-3");
      sim.setInput("local", input);
      sim.step(1);
      sim.setInput("local", {});
      sim.step(20);
      const crate = sim.physical!.world.has("crate-1-3")
        ? sim.physical!.world.pose("crate-1-3")
        : null;
      results[ability] = crate ? crate.x - before.x : Number.POSITIVE_INFINITY;
      assert.ok(results[ability] > 8, `${ability} moved the crate ${results[ability]}`);
    } finally {
      sim.dispose();
    }
  }
  assert.ok(results.nova >= results.whorl, "Bloom Nova launches harder than Whorl");
});

test("a thrown or Whorl-launched crate damages a monster and grants party rewards once", () => {
  // Thrown.
  {
    const { sim, s, e, r } = arena();
    try {
      const x = r.x + 160,
        y = r.y + 20;
      sim.physical!.world.place("crate-1-3", x + 20, y);
      sim.teleport("local", x, y);
      put(sim, e, x + 130, y);
      freeze(e, 15);
      sim.step(2);
      sim.adventure.action(sim, "local", { type: "grab", id: "crate-1-3" });
      aimAt(sim, e.x, e.y);
      sim.step(10);
      const kills = sim.adventure.hero("local").kills,
        drops = s.drops.length;
      sim.adventure.action(sim, "local", { type: "release", throw: true });
      sim.step(40);
      assert.equal(e.hp, 0, "the thrown crate kills the monster");
      assert.equal(sim.adventure.hero("local").kills, kills + 1);
      assert.ok(s.drops.length > drops, "the ordinary kill rewards drop");
      const impacts = events(sim, "impact").filter((ev) => ev.text === "impact:hit");
      assert.equal(impacts.length, 1);
      assert.equal(impacts[0].owner, "local");
      const settled = s.drops.length;
      sim.step(120); // Continued contact with the corpse or loot adds nothing.
      assert.ok(s.drops.length <= settled);
      assert.equal(sim.adventure.hero("local").kills, kills + 1);
    } finally {
      sim.dispose();
    }
  }
  // Whorl-launched.
  {
    const { sim, e, r } = arena();
    try {
      const x = r.x + 150,
        y = r.y + 20;
      sim.physical!.world.place("crate-1-3", x, y);
      put(sim, e, x + 110, y);
      sim.teleport("local", x - 34, y);
      sim.step(2);
      const hp = e.hp;
      sim.setInput("local", { pulse: true });
      sim.step(1);
      sim.setInput("local", {});
      sim.step(30);
      const impacts = events(sim, "impact").filter((ev) => ev.text === "impact:hit");
      assert.equal(impacts.length, 1);
      assert.equal(impacts[0].owner, "local");
      assert.ok(e.hp < hp);
    } finally {
      sim.dispose();
    }
  }
});

test("an unowned rolling object hurts a monster without inventing kill credit or rewards", () => {
  const { sim, s, e, r } = arena();
  try {
    const x = r.x + 160,
      y = r.y + 20;
    sim.teleport("local", x - 200, y - 120);
    sim.physical!.world.place("crate-1-3", x, y);
    put(sim, e, x + 80, y);
    freeze(e, 1);
    sim.step(2);
    const drops = s.drops.length,
      kills = s.kills;
    sim.physical!.world.motion("crate-1-3", 420, 0);
    sim.step(30);
    assert.equal(e.hp, 0);
    assert.equal(sim.adventure.hero("local").kills, 0, "no hero credit");
    assert.equal(s.drops.length, drops, "no invented rewards");
    assert.equal(s.kills, kills + (e.counted ? 1 : 0), "the area still counts the death");
    const kill = events(sim, "kill").at(-1)!;
    assert.equal(kill.owner, "");
    assert.equal(kill.text, "environment");
  } finally {
    sim.dispose();
  }
});

test("impact damage follows its region policy and strength; off keeps the push but not the hurt", () => {
  const strike = (values: Record<string, unknown>) => {
    const { sim, e, r } = arena();
    try {
      const x = r.x + 160,
        y = r.y + 20;
      sim.teleport("local", x - 200, y - 120);
      sim.physical!.world.place("crate-1-3", x, y);
      put(sim, e, x + 80, y);
      if (Object.keys(values).length)
        edit(sim, [{ type: "override", scope: "area", id: "area-1", values }]);
      sim.step(2);
      sim.physical!.combat.instigate("crate-1-3", "local", "party", "test", sim.tick);
      sim.physical!.world.motion("crate-1-3", 400, 0);
      sim.step(30);
      return {
        hurt: events(sim, "impact").find((ev) => ev.text === "impact:hit")?.amount ?? 0,
        moved: sim.physical!.world.pose("crate-1-3").x - x,
      };
    } finally {
      sim.dispose();
    }
  };
  const normal = strike({}),
    doubled = strike({ impactStrength: 2 }),
    off = strike({ impactDamage: false });
  assert.ok(normal.hurt > 0);
  assert.ok(Math.abs(doubled.hurt - normal.hurt * 2) < 0.05, `${doubled.hurt} vs ${normal.hurt}`);
  assert.equal(off.hurt, 0);
  assert.ok(off.moved > 20, "the crate still flies with impact damage off");
});

test("Thornlance pierces soft scenery, stops on stone, ricochets with the stat; shots treat props as cover", () => {
  const lance = (ricochet: number, prop: string) => {
    const { sim, s, r } = arena();
    const h = sim.adventure.hero("local");
    h.skills["gale-3"] = 1;
    if (ricochet) h.skills["gale-4"] = ricochet; // Static Charge also grants ricochets.
    const x = r.x + 160,
      y = r.y + 20;
    sim.physical!.world.place(prop, x + 60, y);
    sim.teleport("local", x, y);
    sim.step(2);
    sim.players.get("local")!.energy = 100;
    sim.setInput("local", { lance: true, aimX: 1, aimY: 0 });
    sim.step(1);
    sim.setInput("local", {});
    const p = s.projectiles.find((pr) => !pr.enemy)!;
    sim.step(12);
    return { sim, s, p, prop };
  };
  // A pot (ceramic) shatters and the lance flies on without spending a pierce.
  {
    const { sim, p } = lance(0, "prop-pot-1-0");
    try {
      assert.ok(sim.physical!.destroyedRecords().some((d) => d.id === "prop-pot-1-0"));
      assert.equal(p.pierce, ATTACKS.lance.pierce);
      assert.ok(p.ttl > 0, "still flying");
    } finally {
      sim.dispose();
    }
  }
  // Stone stops it; with a ricochet it deflects instead.
  {
    const { sim, s, p } = lance(0, "prop-stone-1-0");
    try {
      assert.ok(!s.projectiles.includes(p), "stopped on stone");
      assert.ok(events(sim, "impact").some((ev) => ev.text === "stone:cover"));
    } finally {
      sim.dispose();
    }
  }
  {
    const { sim, p } = lance(1, "prop-stone-1-0");
    try {
      assert.ok(events(sim, "impact").some((ev) => ev.text === "stone:deflect"));
      assert.equal(p.ricochet, 0);
      assert.ok(p.vx < 0, "bounced back off the stone");
    } finally {
      sim.dispose();
    }
  }
  // Enemy shots: a crate is cover; with projectile-world collision off the shot goes through.
  for (const off of [false, true]) {
    const { sim, s, e, r } = arena();
    try {
      const x = r.x + 160,
        y = r.y + 20;
      sim.teleport("local", x, y);
      put(sim, e, x + 140, y);
      sim.physical!.world.place("crate-1-3", x + 60, y);
      if (off)
        edit(sim, [
          { type: "override", scope: "area", id: "area-1", values: { projectileWorld: false } },
        ]);
      sim.step(2);
      const h = sim.adventure.hero("local"),
        hp = h.hp;
      h.invulnerableUntil = 0;
      (
        sim.adventure as unknown as {
          projectile: (...a: unknown[]) => void;
        }
      ).projectile(e.x, e.y, Math.PI, 240, 9, `enemy-${e.id}`, true);
      sim.step(50);
      assert.equal(h.hp < hp, off, off ? "base hit still lands" : "the crate is cover");
      assert.equal(s.projectiles.length, 0);
    } finally {
      sim.dispose();
    }
  }
});

test("grab/release validates reach, weight and ownership; held props survive save and pass through the holder", () => {
  const { sim, r } = arena();
  try {
    const x = r.x + 160,
      y = r.y + 20;
    sim.physical!.world.place("crate-1-3", x + 20, y);
    sim.teleport("local", x, y);
    sim.addPlayer("guest");
    sim.teleport("guest", x - 300, y);
    sim.step(2);
    assert.throws(
      () => sim.adventure.action(sim, "guest", { type: "grab", id: "crate-1-3" }),
      new RegExp(`within ${GRAB_REACH}`),
    );
    assert.throws(
      () => sim.adventure.action(sim, "local", { type: "grab", id: "prop-tree-1-0" }),
      /fixed/,
    );
    assert.throws(
      () => sim.adventure.action(sim, "local", { type: "grab", id: "player-guest" }),
      /loose prop/,
    );
    assert.throws(
      () => sim.adventure.action(sim, "local", { type: "release", throw: true }),
      /not holding/,
    );
    sim.adventure.action(sim, "local", { type: "grab", id: "crate-1-3" });
    sim.teleport("guest", x + 30, y + 10);
    assert.throws(
      () => sim.adventure.action(sim, "guest", { type: "grab", id: "crate-1-3" }),
      /Another traveler/,
    );
    sim.setInput("local", { x: 1 });
    sim.step(30);
    const p = sim.players.get("local")!,
      crate = sim.physical!.world.pose("crate-1-3");
    assert.ok(p.x > x + 10, "the holder walks freely with the prop");
    assert.ok(crate.x > p.x, "the prop is carried in front");
    const state = sim.save();
    assert.deepEqual(
      state.actorPhysics!.combat!.holds.map((h) => h.id),
      ["crate-1-3"],
    );
    const restored = Simulation.restore(JSON.parse(JSON.stringify(state)) as SaveState);
    try {
      assert.equal(restored.physical!.combat.holding("local"), "crate-1-3");
      restored.step(5);
      assert.equal(restored.physical!.combat.holding("local"), "crate-1-3");
    } finally {
      restored.dispose();
    }
    const forged = JSON.parse(JSON.stringify(state)) as SaveState;
    forged.actorPhysics!.combat!.holds = [];
    assert.throws(() => Simulation.restore(forged), /Held prop flag/);
    sim.adventure.action(sim, "local", { type: "release", throw: false });
    assert.equal(sim.physical!.combat.holding("local"), null);
    // Freezing the region breaks a hold instead of dragging a frozen prop.
    sim.adventure.action(sim, "local", { type: "grab", id: "crate-1-3" });
    edit(sim, [{ type: "override", scope: "area", id: "area-1", values: { dynamicProps: false } }]);
    sim.step(2);
    assert.equal(sim.physical!.combat.holding("local"), null);
  } finally {
    sim.dispose();
  }
});

test("physical loot launches, settles, collects once, survives saving and stays collectible without physics", () => {
  const { sim, s, e, r } = arena();
  try {
    put(sim, e, r.x + 150, r.y + 20);
    sim.teleport("local", r.x - 200, r.y - 40);
    sim.step(2);
    freeze(e, 1);
    (sim.adventure as unknown as { hit: (...a: unknown[]) => void }).hit(
      sim,
      e,
      50,
      "local",
      e.x,
      e.y,
    );
    sim.step(1);
    const loot = s.drops.map((d) => lootBodyId(d.id));
    assert.ok(loot.length >= 2);
    for (const id of loot) assert.ok(sim.physical!.world.has(id));
    const start = s.drops.map((d) => [d.x, d.y]);
    sim.step(120);
    assert.ok(s.drops.some((d, i) => Math.hypot(d.x - start[i][0], d.y - start[i][1]) > 4));
    const restored = Simulation.restore(JSON.parse(JSON.stringify(sim.save())) as SaveState);
    try {
      assert.deepEqual(
        restored.physical!.world.ids().filter((id) => id.startsWith("loot-")),
        sim.physical!.world.ids().filter((id) => id.startsWith("loot-")),
      );
    } finally {
      restored.dispose();
    }
    const gold = sim.adventure.hero("local").gold,
      amount = s.drops.filter((d) => d.kind === "gold").reduce((n, d) => n + d.amount, 0),
      target = s.drops.find((d) => d.kind === "gold")!;
    sim.teleport("local", target.x - 60, target.y);
    sim.step(120);
    assert.equal(sim.adventure.hero("local").gold, gold + amount);
    assert.ok(
      !sim
        .physical!.world.ids()
        .some((id) => id.startsWith("loot-") && !s.drops.some((d) => lootBodyId(d.id) === id)),
    );
    // Physics off: the drop stays collectible where it is, with no body.
    edit(sim, [{ type: "override", scope: "area", id: "area-1", values: { physicalLoot: false } }]);
    s.drops.push({ id: s.nextId++, x: r.x + 300, y: r.y, born: sim.tick, kind: "gold", amount: 7 });
    sim.step(2);
    assert.ok(!sim.physical!.world.ids().some((id) => id.startsWith("loot-")));
    const before = sim.adventure.hero("local").gold;
    sim.teleport("local", r.x + 240, r.y);
    sim.step(90);
    assert.equal(sim.adventure.hero("local").gold, before + 7);
  } finally {
    sim.dispose();
  }
});

test("valuable drops that come to rest in deep water are recovered to reachable ground", () => {
  const { sim, s, r } = arena();
  try {
    sim.teleport("local", r.x - 200, r.y - 40);
    const tx = Math.floor((r.x + 300) / 16),
      ty = Math.floor(r.y / 16);
    sim.world.paint(tx - 2, ty - 2, 5, 5, Terrain.DeepWater);
    sim.step(2);
    s.drops.push({
      id: s.nextId++,
      x: tx * 16 + 8,
      y: ty * 16 + 8,
      born: sim.tick - 10,
      kind: "item",
      amount: 1,
      item: rollItem(1, 9, 1),
    });
    sim.step(60);
    const drop = s.drops.at(-1)!;
    const tile = sim.world.sample(Math.floor(drop.x / 16), Math.floor(drop.y / 16));
    assert.notEqual(tile.terrain, Terrain.DeepWater);
  } finally {
    sim.dispose();
  }
});

test("physical modifiers ride existing skills and affixes with concrete effects", () => {
  const nodes = SKILLS.filter((n) => n.physical);
  assert.deepEqual(
    nodes.map((n) => [n.id, n.physical!.stat]),
    [
      ["blade-6", "shatter"],
      ["root-7", "force"],
      ["gale-4", "ricochet"],
    ],
  );
  assert.equal(SKILLS.length, 48);
  const rolled = Array.from({ length: 400 }, (_, i) => rollItem(142, i, 20));
  const physical = rolled.filter((item) =>
    item.affixes.some((a) => ["force", "shatter", "ricochet"].includes(a.stat)),
  );
  assert.ok(physical.length > 20);
  assert.ok(
    physical
      .filter((item) => item.affixes.some((a) => a.stat === "ricochet"))
      .every((item) => item.slot === "weapon"),
  );
  assert.deepEqual(rollItem(142, 7, 20), rollItem(142, 7, 20));
  // Force makes the same Whorl shove a crate farther.
  const shove = (force: number) => {
    const { sim, r } = arena();
    try {
      sim.adventure.hero("local").skills["root-7"] = force;
      const x = r.x + 160,
        y = r.y + 20;
      sim.physical!.world.place("crate-1-3", x + 28, y);
      sim.teleport("local", x, y);
      sim.step(2);
      sim.setInput("local", { pulse: true });
      sim.step(1);
      sim.setInput("local", {});
      sim.step(1);
      return sim.physical!.world.pose("crate-1-3").vx;
    } finally {
      sim.dispose();
    }
  };
  assert.ok(shove(1) > shove(0) * 1.1);
});

test("pending impacts, instigators and holds survive saving; replays and late joiners agree", () => {
  const { sim, e, r } = arena();
  const agent = new AgentRuntime(sim);
  try {
    const x = r.x + 160,
      y = r.y + 20;
    sim.physical!.world.place("crate-1-3", x + 20, y);
    sim.teleport("local", x, y);
    put(sim, e, x + 130, y);
    sim.step(2);
    agent.beginRecording();
    agent.execute({ op: "adventure", action: { type: "grab", id: "crate-1-3" } });
    agent.execute({ op: "input", aimX: 1, aimY: 0 });
    agent.execute({ op: "step", ticks: 10 });
    agent.execute({ op: "adventure", action: { type: "release", throw: true } });
    let saved: SaveState | null = null;
    for (let t = 0; t < 40 && !saved; t++) {
      agent.execute({ op: "step", ticks: 1 });
      if ((sim.physical!.save().combat?.impacts.length ?? 0) > 0) saved = sim.save();
    }
    assert.ok(saved, "an impact is pending at a tick boundary");
    assert.ok(saved!.actorPhysics!.combat!.instigators.some((i) => i.owner === "local"));
    const restored = Simulation.restore(JSON.parse(JSON.stringify(saved)) as SaveState);
    try {
      const hp = restored.adventure.state.enemies[0].hp;
      restored.step(1);
      assert.ok(restored.adventure.state.enemies[0].hp < hp, "the pending hit lands after restore");
    } finally {
      restored.dispose();
    }
    agent.execute({ op: "step", ticks: 5 });
    replay(agent.execute({ op: "replay" }) as Parameters<typeof replay>[0]).dispose();
    const guest = new Simulation(142, 0);
    try {
      guest.applyReplica(JSON.parse(JSON.stringify(sim.save(true))) as SaveState);
      assert.deepEqual(guest.replicaPhysics!.combat, sim.physical!.save().combat);
    } finally {
      guest.dispose();
    }
  } finally {
    sim.dispose();
  }
});

test("real M05 checkpoints migrate to the M06 envelope and keep their destruction", () => {
  const legacy = JSON.parse(
    gunzipSync(readFileSync(new URL("./fixtures/m05-raw.json.gz", import.meta.url))).toString(),
  ) as SaveState;
  assert.equal(legacy.actorPhysics!.version, 3);
  assert.equal(legacy.actorPhysics!.world.version, 5);
  const sim = Simulation.restore(structuredClone(legacy));
  try {
    assert.deepEqual(sim.physical!.destroyedRecords(), legacy.actorPhysics!.destroyed);
    for (const entry of legacy.actorPhysics!.world.bodies.filter((b) => b.recipe.role === "prop")) {
      const pose = sim.physical!.world.pose(entry.recipe.id);
      assert.equal(pose.consequences?.durability, entry.recipe.consequences?.durability);
      assert.ok(Math.abs(pose.x - entry.state!.x) < 1e-6);
    }
    const saved = sim.save();
    assert.equal(saved.actorPhysics!.version, 8);
    assert.equal(saved.actorPhysics!.world.version, 9);
    assert.deepEqual(saved.actorPhysics!.combat!.holds, []);
    sim.step(10);
    const forged = structuredClone(legacy);
    forged.actorPhysics!.version = 4;
    assert.throws(() => Simulation.restore(forged));
  } finally {
    sim.dispose();
  }
});
