import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { AgentRuntime } from "../src/engine/agent.ts";
import { type SaveState, Simulation } from "../src/engine/simulation.ts";
import { RIGS, type RigKind } from "../src/game/content.ts";
import {
  artBounds,
  detachables,
  enemyPose,
  fallAngle,
  fallPivot,
  RIG_BLUEPRINTS,
  rigArt,
  rigExport,
  rigGeometry,
  rigScale,
} from "../src/game/rigs.ts";
import type { Enemy } from "../src/game/types.ts";
import { decodeSnapshot, encodeSnapshot } from "../src/net/protocol.ts";
import { initializePhysics } from "../src/physics/bootstrap.ts";
import { MATERIAL_IDS } from "../src/physics/materials.ts";
import type { PolicyEdit } from "../src/physics/policies.ts";
import { REMAINS_TICKS, remainsBodyId, remainsId } from "../src/physics/rigs.ts";
import { jointAnchors } from "../src/physics/runtime.ts";

await initializePhysics();
/** Area 1 with no monsters, no waves and no area mechanics; the traveler waits at the entry. */
function arena() {
  const sim = new Simulation(142, 0);
  sim.addPlayer("local");
  sim.adventure.startArea(sim, 1);
  sim.step();
  const s = sim.adventure.state;
  s.enemies = [];
  s.spawned = s.recipe.killGoal;
  s.bossSpawned = true;
  s.mechanics = [];
  const p = sim.players.get("local")!;
  return { sim, s, p, physical: sim.physical!, world: sim.physical!.world };
}
/** A planted, passive monster of one rig beside the traveler (its body exists after a step). */
function monster(sim: Simulation, rig: RigKind, dx = 60, dy = 0, hp = 400): Enemy {
  const p = sim.players.get("local")!;
  const e = sim.adventure.spawnMonster(sim, rig, p.x + dx, p.y + dy, { hp, passive: true });
  sim.step();
  return e;
}
const strike = (sim: Simulation, e: Enemy, damage: number, angle = 0) =>
  sim.adventure.strikeEnemy(sim, "local", e.id, damage, angle);
function edit(sim: Simulation, edits: PolicyEdit[]) {
  const physical = sim.physical!;
  physical.configure({ expectedRevision: physical.world.policyState().nextRevision, edits });
  physical.world.applyPolicies(physical.world.policyState().nextRevision);
  physical.begin(sim);
}
const area = (values: Record<string, unknown>): PolicyEdit => ({
  type: "override",
  scope: "area",
  id: "area-1",
  values,
});
const members = (sim: Simulation, enemy: number) =>
  sim.physical!.world.assemblyList().find((a) => a.id === remainsId(enemy))?.members ?? [];
const centroid = (sim: Simulation, ids: string[]) => {
  const poses = ids.map((id) => sim.physical!.world.motionOf(id));
  return {
    x: poses.reduce((sum, p) => sum + p.x, 0) / poses.length,
    y: poses.reduce((sum, p) => sum + p.y, 0) / poses.length,
  };
};
/** One Whorl from beside a point (real ability input). */
function whorl(sim: Simulation, x: number, y: number) {
  sim.adventure.hero("local").whorlReady = 0;
  sim.teleport("local", x - 22, y);
  sim.step(2);
  sim.setInput("local", { x: 0, y: 0, dash: false, pulse: true, interact: false });
  sim.step();
  sim.setInput("local", { x: 0, y: 0, dash: false, pulse: false, interact: false });
}

test("six rig recipes: sockets, mass, limits and materials; colliders are measured from each part's art", () => {
  const styles = new Set<string>(),
    locomotion = new Set<string>();
  for (const kind of RIGS) {
    const bp = RIG_BLUEPRINTS[kind];
    styles.add(bp.death);
    locomotion.add(bp.locomotion);
    assert.equal(bp.parts[0].parent, null, `${kind} root first`);
    const seen = new Set<string>();
    let mass = 0;
    for (const p of bp.parts) {
      assert.ok(!seen.has(p.id), `${kind}.${p.id} unique`);
      if (p.parent) assert.ok(seen.has(p.parent), `${kind}.${p.id} after its parent`);
      seen.add(p.id);
      mass += p.mass;
      assert.ok(p.limits[0] <= p.limits[1]);
      assert.ok((MATERIAL_IDS as readonly string[]).includes(p.material));
    }
    assert.ok(mass > 0.9 && mass < 1.1, `${kind} mass shares sum to ${mass}`);
    for (const variant of [0, 1, 2, 3]) {
      const art = rigArt(kind, variant, variant),
        geometry = rigGeometry(kind, variant);
      for (const p of bp.parts) {
        const b = artBounds(art[p.id]),
          g = geometry[p.id];
        // The collider is exactly the part's drawn extent.
        assert.ok(Math.abs(g.cx + p.pivot[0] - (b.minX + b.maxX) / 2) < 1e-9);
        assert.ok(Math.abs(g.cy + p.pivot[1] - (b.minY + b.maxY) / 2) < 1e-9);
        assert.ok(Math.abs(g.w - Math.max(2, b.maxX - b.minX)) < 1e-9);
        assert.ok(Math.abs(g.h - Math.max(2, b.maxY - b.minY)) < 1e-9);
      }
    }
  }
  assert.deepEqual([...styles].sort(), ["collapse", "fell", "flip", "topple"]);
  assert.deepEqual([...locomotion].sort(), ["floating", "grounded", "rooted"]);
  assert.deepEqual(
    RIGS.map((k) =>
      detachables(k)
        .map((p) => `${p.id}:${p.material}:${p.detach}`)
        .join(","),
    ),
    [
      "",
      "",
      "plate0:wood:hit,plate1:wood:hit,plate2:wood:hit,plate3:wood:hit",
      "core:glass:death",
      "crown0:wood:hit,crown1:wood:hit,crown2:wood:hit",
      "plate0:metal:hit,plate1:metal:hit,plate2:metal:hit,plate3:metal:hit,emblem:metal:hit",
    ],
  );
  assert.equal(JSON.stringify(rigExport()), JSON.stringify(rigExport()));
});

test("every rig answers a blow in its own way: recoil, stagger and knockdown follow locomotion and weight", () => {
  const response = new Map<RigKind, { lean: number; moved: number; peak: number }>();
  for (const rig of RIGS) {
    const { sim } = arena();
    const e = monster(sim, rig);
    const start = { x: e.x, y: e.y },
      rest = enemyPose(e, sim.tick).parts;
    strike(sim, e, 20, 0);
    let peak = 0;
    for (let i = 0; i < 12; i++) {
      sim.step();
      peak = Math.max(peak, e.reaction.lean);
    }
    const pose = enemyPose(e, sim.tick).parts;
    assert.ok(
      pose.some((p, i) => Math.abs(p.angle - rest[i].angle) > 0.02),
      `${rig} limbs answer the blow`,
    );
    response.set(rig, {
      lean: e.reaction.lean,
      moved: Math.hypot(e.x - start.x, e.y - start.y),
      peak,
    });
    sim.dispose();
  }
  for (const rig of RIGS) assert.ok(response.get(rig)!.peak > 0.02, `${rig} recoils away`);
  // A floating wraith sways furthest; heavy rigs barely tip; a rooted totem is not driven back.
  assert.ok(response.get("wraith")!.peak > response.get("stalker")!.peak);
  assert.ok(response.get("stalker")!.peak > response.get("brute")!.peak);
  assert.ok(response.get("stalker")!.peak > response.get("warden")!.peak);
  assert.ok(response.get("totem")!.moved < response.get("stalker")!.moved * 0.5);
  // Repeated blows: grounded and floating rigs go down, a totem only staggers, a boss never falls.
  for (const rig of RIGS) {
    const { sim } = arena();
    const e = monster(sim, rig, 60, 0, 6000);
    e.phase = "windup";
    e.timer = 400;
    let toppled = false,
      staggered = false;
    for (let i = 0; i < 30 && !toppled; i++) {
      strike(sim, e, 70, 0);
      toppled ||= e.reaction.toppleUntil > sim.tick;
      staggered ||= e.reaction.staggerUntil > sim.tick;
      sim.step(4);
    }
    assert.ok(staggered, `${rig} staggers`);
    assert.equal(e.phase === "windup", false, `${rig} windup interrupted`);
    if (rig === "totem") assert.equal(toppled, false, "a rooted totem never falls over");
    else assert.ok(toppled, `${rig} is knocked down`);
    if (toppled) {
      // Down: no steering, no attack; then back on its feet.
      e.nextAttack = 0;
      const until = e.reaction.toppleUntil;
      sim.step(30);
      assert.ok(e.reaction.toppleUntil > sim.tick, `${rig} still down`);
      assert.ok(Math.hypot(e.vx, e.vy) < 15, `${rig} lies still`);
      assert.ok(e.phase !== "windup");
      sim.step(until - sim.tick + 2);
      assert.ok(e.reaction.toppleUntil <= sim.tick);
    }
    sim.dispose();
  }
  const { sim } = arena();
  const boss = sim.adventure.spawnMonster(sim, "brute", sim.players.get("local")!.x + 80, 0, {
    boss: true,
    passive: true,
    hp: 5000,
  });
  sim.step();
  for (let i = 0; i < 12; i++) strike(sim, boss, 400, 0);
  assert.equal(boss.reaction.toppleUntil, 0, "bosses only stagger");
  assert.ok(boss.reaction.staggerUntil > 0);
  sim.dispose();
});

test("death transfers pose and momentum into a jointed ragdoll for all six rigs; armor comes loose", () => {
  for (const rig of RIGS) {
    const { sim, physical, world } = arena();
    const e = monster(sim, rig);
    strike(sim, e, 30, 0.3);
    sim.step(3);
    // The pose and body the remains must start from: the drawn pose at the death tick.
    strike(sim, e, 5000, 0.3);
    // The body is retired at the next tick boundary, before any further motion.
    const tick = sim.tick + 1,
      actor = world.motionOf(`enemy-${e.id}`),
      pose = enemyPose(e, tick),
      bp = RIG_BLUEPRINTS[rig],
      f = Math.cos(e.facing) < 0 ? -1 : 1,
      scale = rigScale(e),
      fall = fallAngle(bp, e.reaction, e.facing, e.id),
      [kx, ky] = fallPivot(bp);
    sim.step();
    assert.equal(world.has(`enemy-${e.id}`), false, `${rig}: the living actor left the solver`);
    const ids = members(sim, e.id),
      loose = detachables(rig).map((p) => remainsBodyId(e.id, p.id));
    assert.equal(
      ids.length,
      bp.parts.length - detachables(rig).length,
      `${rig}: one body per part`,
    );
    for (const id of loose) assert.ok(world.has(id), `${rig}: ${id} came loose`);
    const joints = world.jointList().filter((j) => j.recipe.assembly === remainsId(e.id));
    assert.equal(joints.length, ids.length - 1, `${rig}: one hinge per part`);
    // Before the first solve after spawning, each body sits exactly where its art was drawn,
    // turned through the fall about the fall pivot.
    const spawned = sim.physical!.rigs.record(e.id)!;
    assert.equal(spawned.born, tick);
    // Every part is in the record once; pieces knocked off earlier are already loose props.
    assert.ok(ids.every((id) => spawned.bodies.includes(id)));
    assert.ok(spawned.bodies.every((id) => ids.includes(id) || loose.includes(id)));
    const geometry = rigGeometry(rig, e.id % 4);
    const root = world.pose(remainsBodyId(e.id, bp.parts[0].id)),
      tag = root.blueprint!.rig!;
    assert.equal(tag.fall, Math.round(fall * 1e4) / 1e4);
    const pivotX = actor.x + f * kx * scale,
      pivotY = actor.y + ky * scale;
    const rootPose = pose.parts[0],
      g = geometry[rootPose.id],
      cx = rootPose.x + Math.cos(rootPose.angle) * g.cx - Math.sin(rootPose.angle) * g.cy,
      cy = rootPose.y + Math.sin(rootPose.angle) * g.cx + Math.cos(rootPose.angle) * g.cy;
    let ex = f * cx * scale + actor.x,
      ey = cy * scale + actor.y;
    if (bp.death !== "fell") {
      const dx = ex - pivotX,
        dy = ey - pivotY;
      ex = pivotX + Math.cos(fall) * dx - Math.sin(fall) * dy;
      ey = pivotY + Math.sin(fall) * dx + Math.cos(fall) * dy;
    }
    // One solve of motion separates them from the spawn point by at most their speed.
    assert.ok(Math.hypot(root.x - ex, root.y - ey) < 6, `${rig}: root starts where it was drawn`);
    // Pinned: every hinge's two anchors coincide (limbs never part from their art).
    for (const joint of joints) {
      const a = jointAnchors(joint.recipe, world.pose(joint.recipe.a), world.pose(joint.recipe.b));
      assert.ok(Math.hypot(a.ax - a.bx, a.ay - a.by) < 0.6, `${rig}: ${joint.recipe.id} pinned`);
    }
    // Momentum: the body keeps travelling the way the blow drove it.
    const v = ids
      .map((id) => world.motionOf(id))
      .reduce((sum, m) => ({ x: sum.x + m.vx, y: sum.y + m.vy }), { x: 0, y: 0 });
    if (bp.death !== "fell") assert.ok(v.x / ids.length > 20, `${rig}: carries the blow`);
    else assert.equal(world.recipeOf(remainsBodyId(e.id, "roots")).motion, "fixed");
    // It reaches the ground at its fall time, with a material thud.
    sim.step(bp.fallTicks + 1);
    const falls = sim.adventure.state.events.filter(
      (event) => event.type === "rig" && event.text.startsWith(`fall:${rig}:`),
    );
    assert.equal(falls.length, 1, `${rig}: lands once`);
    // Settled and still jointed within limits.
    sim.step(180);
    for (const joint of world.jointList().filter((j) => j.recipe.assembly === remainsId(e.id))) {
      const a = world.pose(joint.recipe.a),
        b = world.pose(joint.recipe.b),
        rel = Math.atan2(Math.sin(b.angle - a.angle), Math.cos(b.angle - a.angle)),
        [lo, hi] = joint.recipe.limits!;
      assert.ok(rel > lo - 0.08 && rel < hi + 0.08, `${rig}: ${joint.recipe.id} within limits`);
      const anchors = jointAnchors(joint.recipe, a, b);
      assert.ok(Math.hypot(anchors.ax - anchors.bx, anchors.ay - anchors.by) < 0.6);
    }
    assert.ok(physical.rigs.has(e.id));
    sim.dispose();
  }
});

test("a dead body reacts to Whorl and fields, freezes where ragdolls are off, and saves never revive it", () => {
  const { sim, world, s } = arena();
  const e = monster(sim, "stalker", 30, 0, 60);
  strike(sim, e, 5000, 0);
  sim.step(120);
  const ids = members(sim, e.id);
  const settled = centroid(sim, ids);
  const hero = sim.adventure.hero("local"),
    rewards = { kills: hero.kills, total: s.totalKills, nextId: s.nextId };
  whorl(sim, settled.x, settled.y);
  sim.step(40);
  const swept = centroid(sim, ids);
  assert.ok(Math.hypot(swept.x - settled.x, swept.y - settled.y) > 20, "Whorl throws the body");
  sim.physical!.reactions.addField({
    id: "test-gust",
    kind: "wind",
    areaId: "area-1",
    shape: { kind: "lane", x: swept.x - 60, y: swept.y, angle: 0, length: 140, width: 80 },
    strength: 900,
    ticks: 30,
    gust: 0,
    actors: false,
    owner: "",
    team: "world",
    source: "test",
  });
  sim.step(40);
  const blown = centroid(sim, ids);
  assert.ok(Math.hypot(blown.x - swept.x, blown.y - swept.y) > 15, "a field carries the body");
  // Ragdolls off: the remains settle in place as a non-reactive corpse.
  edit(sim, [area({ ragdolls: false })]);
  for (const id of ids) assert.equal(world.motionOf(id).frozen, true);
  whorl(sim, blown.x, blown.y);
  sim.physical!.reactions.addField({
    id: "test-gust-2",
    kind: "wind",
    areaId: "area-1",
    shape: { kind: "lane", x: blown.x - 60, y: blown.y, angle: 0, length: 140, width: 80 },
    strength: 900,
    ticks: 30,
    gust: 0,
    actors: false,
    owner: "",
    team: "world",
    source: "test",
  });
  sim.step(40);
  const still = centroid(sim, ids);
  assert.equal(Math.hypot(still.x - blown.x, still.y - blown.y), 0, "frozen remains do not move");
  // Saves keep the corpse dead: no revived enemy, kill or reward is repeated. (Whorl may have
  // broken a pot; that reward was earned before the save.)
  rewards.nextId = s.nextId;
  for (const portable of [false, true]) {
    const restored = Simulation.restore(JSON.parse(JSON.stringify(sim.save(portable))));
    try {
      restored.step(300);
      const h = restored.adventure.hero("local");
      assert.equal(restored.adventure.state.enemies.filter((x) => x.hp > 0).length, 0);
      assert.equal(h.kills, rewards.kills);
      assert.equal(restored.adventure.state.totalKills, rewards.total);
      // No new drop, item or reward was created for the corpse.
      assert.ok(restored.adventure.state.drops.every((d) => d.id < rewards.nextId));
      assert.ok(
        members(restored, e.id).every((id) => restored.physical!.world.motionOf(id).frozen),
      );
    } finally {
      restored.dispose();
    }
  }
  // Re-enabled: the body wakes where it lies, with no stored motion, and reacts again.
  edit(sim, [{ type: "reset", scope: "area", id: "area-1", to: "inherited" }]);
  for (const id of ids) {
    const m = world.motionOf(id);
    assert.equal(m.frozen, false);
    assert.ok(Math.hypot(m.vx, m.vy) < 1e-6);
  }
  whorl(sim, still.x, still.y);
  sim.step(30);
  const woken = centroid(sim, ids);
  assert.ok(Math.hypot(woken.x - still.x, woken.y - still.y) > 10);
  sim.dispose();
});

test("ragdolls off at death: the authored death pose, no remains; reaction strength and master switch", () => {
  const { sim, world, s } = arena();
  edit(sim, [area({ ragdolls: false })]);
  const e = monster(sim, "brute", 40, 0, 50);
  strike(sim, e, 5000, 0);
  sim.step();
  assert.equal(world.has(`enemy-${e.id}`), false);
  assert.equal(members(sim, e.id).length, 0, "no ragdoll");
  assert.equal(sim.physical!.rigs.has(e.id), false);
  assert.ok(
    s.enemies.some((x) => x.id === e.id && x.phase === "dead"),
    "the record falls",
  );
  sim.step(45);
  assert.equal(
    s.enemies.some((x) => x.id === e.id),
    false,
    "and leaves like before",
  );
  // Reaction strength 0: no recoil, no stagger. The sword still lands.
  edit(sim, [area({ ragdolls: true, reactionStrength: 0 })]);
  const calm = monster(sim, "stalker", 60, 0, 5000);
  for (let i = 0; i < 6; i++) strike(sim, calm, 50, 0);
  sim.step();
  assert.equal(calm.reaction.lean, 0);
  assert.equal(calm.reaction.staggerUntil, 0);
  assert.ok(calm.hp < 5000 - 250);
  // Master off: recoil still shows the blow; stagger, knockdown and shedding need reactions.
  edit(sim, [
    { type: "reset", scope: "area", id: "area-1", to: "inherited" },
    { type: "master", enabled: false },
  ]);
  const brute = monster(sim, "brute", 60, 0, 5000);
  for (let i = 0; i < 8; i++) strike(sim, brute, 70, 0);
  sim.step();
  assert.ok(Math.abs(brute.reaction.lean) > 0 || Math.abs(brute.reaction.leanRate) > 0);
  assert.equal(brute.reaction.staggerUntil, 0);
  assert.equal(brute.reaction.toppleUntil, 0);
  assert.equal(brute.reaction.shed, 0);
  sim.dispose();
});

test("heavy blows knock armor and bark off as material props; death frees the rest without duplicates", () => {
  for (const [rig, material] of [
    ["brute", "wood"],
    ["warden", "metal"],
    ["totem", "wood"],
  ] as const) {
    const { sim, world } = arena();
    const e = monster(sim, rig, 60, 0, 2000);
    for (let i = 0; i < 6 && !e.reaction.shed; i++) {
      strike(sim, e, 300, 0);
      sim.step(2);
    }
    assert.ok(e.reaction.shed > 0, `${rig} sheds`);
    const first = detachables(rig).find((_, i) => e.reaction.shed & (1 << i))!;
    const piece = world.pose(remainsBodyId(e.id, first.id));
    assert.equal(piece.material, material);
    assert.equal(piece.blueprint!.rig!.loose, true);
    assert.equal(piece.assembly, undefined);
    assert.ok(
      sim.adventure.state.events.some(
        (x) => x.type === "rig" && x.text === `shed:${rig}:${material}`,
      ),
    );
    strike(sim, e, 1e5, 0);
    sim.step();
    const loose = detachables(rig).map((p) => remainsBodyId(e.id, p.id));
    assert.ok(
      loose.every((id) => world.has(id)),
      `${rig}: every piece is loose once`,
    );
    assert.equal(
      new Set(world.ids().filter((id) => id.startsWith(`prop-remains-${e.id}-`))).size,
      RIG_BLUEPRINTS[rig].parts.length,
    );
    sim.dispose();
  }
  // A wraith keeps its lantern core while it lives; the core falls loose as glass at death.
  const { sim, world } = arena();
  const wraith = monster(sim, "wraith", 60, 0, 2000);
  for (let i = 0; i < 6; i++) strike(sim, wraith, 300, 0);
  assert.equal(wraith.reaction.shed, 0);
  strike(sim, wraith, 1e5, 0);
  sim.step();
  assert.equal(world.recipeOf(remainsBodyId(wraith.id, "core")).material, "glass");
  sim.dispose();
});

test("burning or soaked monsters pass their state to their remains; remains expire whole", () => {
  const { sim, world, physical } = arena();
  const e = monster(sim, "stalker", 50, 0, 40);
  physical.stimulate(sim, "fire", { x: e.x, y: e.y, target: `enemy-${e.id}`, owner: "local" });
  sim.step();
  assert.ok((physical.reactions.status(`enemy-${e.id}`)?.burning ?? 0) > 0);
  strike(sim, e, 5000, 0);
  sim.step();
  const root = remainsBodyId(e.id, "torso");
  assert.ok((physical.reactions.status(root)?.burning ?? 0) > 0, "the remains keep burning");
  assert.equal(physical.reactions.status(`enemy-${e.id}`), null);
  sim.step(REMAINS_TICKS);
  assert.equal(world.has(root), false, "remains leave at their authored lifetime");
  assert.equal(
    world.assemblyList().some((a) => a.id === remainsId(e.id)),
    false,
  );
  assert.equal(
    world.jointList().some((j) => j.recipe.assembly === remainsId(e.id)),
    false,
  );
  assert.equal(physical.rigs.has(e.id), false);
  // The scene stays valid after the cleanup.
  const restored = Simulation.restore(JSON.parse(JSON.stringify(sim.save())));
  restored.dispose();
  sim.dispose();
});

test("mid-fall saves continue exactly; a guest receives the same remains, poses and results", () => {
  const { sim, physical } = arena();
  const living = monster(sim, "wraith", -70, 20);
  const dying = monster(sim, "crawler", 60, 0, 40);
  strike(sim, living, 40, 0);
  strike(sim, dying, 5000, 0.4);
  sim.step(5);
  for (const portable of [false, true]) {
    const restored = Simulation.restore(JSON.parse(JSON.stringify(sim.save(portable))));
    try {
      assert.deepEqual(restored.physical!.rigs.save(), physical.rigs.save());
      if (!portable) {
        sim.step(60);
        restored.step(60);
        assert.equal(restored.stateHash(), sim.stateHash());
      }
    } finally {
      restored.dispose();
    }
  }
  // The guest's complete scene carries every remains body and tag; its header carries living
  // reaction states, so a guest draws the same poses.
  const guest = new Simulation(142, 0);
  try {
    guest.applyReplica(JSON.parse(JSON.stringify(sim.save(true))) as SaveState);
    const hostBodies = physical
      .props()
      .filter((p) => p.blueprint?.rig)
      .map((p) => `${p.id}:${p.x.toFixed(3)}:${p.y.toFixed(3)}:${p.angle.toFixed(4)}`)
      .sort();
    const guestBodies = guest
      .physicalProps()
      .filter((p) => p.blueprint?.rig)
      .map((p) => `${p.id}:${p.x.toFixed(3)}:${p.y.toFixed(3)}:${p.angle.toFixed(4)}`)
      .sort();
    assert.deepEqual(guestBodies, hostBodies);
    assert.deepEqual(guest.replicaPhysics!.rigs, physical.rigs.save());
    const seen = new AgentRuntime(guest).execute({ op: "actors", action: "rigs" }) as {
      remains: { enemy: number; bodies: unknown[] }[];
    };
    assert.equal(seen.remains[0].enemy, dying.id);
    assert.equal(seen.remains[0].bodies.length, members(sim, dying.id).length + 0);
  } finally {
    guest.dispose();
  }
  const packet = encodeSnapshot(sim, "local");
  const replica = decodeSnapshot(packet).sim;
  try {
    const host = sim.adventure.state.enemies.find((x) => x.id === living.id)!,
      remote = replica.adventure.state.enemies.find((x) => x.id === living.id)!;
    assert.deepEqual(enemyPose(remote, sim.tick), enemyPose(host, sim.tick));
  } finally {
    replica.dispose();
  }
  sim.dispose();
});

test("the wayfarer recoils and its lantern swings without touching input or movement", () => {
  const run = (shaken: boolean) => {
    const { sim, p } = arena();
    if (shaken) {
      const h = sim.adventure.hero("local");
      h.recoil.lean = 0.25;
      h.recoil.leanRate = 3;
      h.recoil.swing = 0.9;
    }
    sim.setInput("local", { x: 1, y: 0.3, dash: false, pulse: false, interact: false });
    sim.step(12);
    sim.setInput("local", { x: -1, y: 0, dash: false, pulse: false, interact: false });
    sim.step(6);
    const out = { x: p.x, y: p.y, vx: p.vx, recoil: { ...sim.adventure.hero("local").recoil } };
    sim.dispose();
    return out;
  };
  const calm = run(false),
    shaken = run(true);
  assert.equal(shaken.x, calm.x);
  assert.equal(shaken.y, calm.y);
  assert.ok(calm.vx < 0, "the reversal is followed at once");
  assert.ok(Math.abs(calm.recoil.swing) > 0.02, "starting and turning swing the lantern");
  // A blow leans the traveler away from it and swings the lantern; it settles again.
  const { sim } = arena();
  const e = monster(sim, "stalker", 20, 0);
  e.rootUntil = 0;
  e.nextAttack = 0;
  let leaned = 0;
  for (
    let i = 0;
    i < 120 && sim.adventure.hero("local").hp >= sim.adventure.stats("local").health;
    i++
  )
    sim.step();
  for (let i = 0; i < 8; i++) {
    sim.step();
    leaned = Math.max(leaned, Math.abs(sim.adventure.hero("local").recoil.lean));
  }
  assert.ok(leaned > 0.02, "a hit leans the wayfarer");
  sim.dispose();
});

test("townsfolk are shoved and recover; their services follow them", () => {
  const sim = new Simulation(142, 0);
  sim.addPlayer("local");
  sim.step(2);
  const physical = sim.physical!,
    home = sim.townsfolk()[0];
  assert.equal(sim.adventure.state.mode, "town");
  assert.ok(physical.world.has("npc-rowan"));
  sim.teleport("local", home.x - 24, home.y);
  sim.step(2);
  sim.setInput("local", { x: 1, y: 0, dash: false, pulse: false, interact: false });
  sim.step(24);
  const shoved = sim.townsfolk()[0];
  assert.ok(shoved.x - home.x > 8, "the traveler shoves Rowan aside");
  assert.ok(
    sim.adventure.state.events.some((e) => e.type === "rig" && e.text === "npc:bump:rowan"),
  );
  // The shop is offered where Rowan stands now.
  const player = sim.players.get("local")!;
  sim.setInput("local", { x: 0, y: 0, dash: false, pulse: false, interact: false });
  sim.teleport("local", shoved.x + 30, shoved.y + 10);
  sim.step();
  assert.ok(sim.adventure.interact(sim, player));
  assert.ok(sim.adventure.state.events.some((e) => e.text === "service:shop"));
  // Left alone, they walk back to their post.
  sim.teleport("local", 0, 60);
  sim.step(240);
  const back = sim.townsfolk()[0];
  assert.ok(Math.hypot(back.x - home.x, back.y - home.y) < 10, "Rowan returns to the stall");
  // Leaving town removes their bodies; the land keeps no townsfolk in its areas.
  sim.adventure.startArea(sim, 1);
  sim.step();
  assert.equal(physical.world.has("npc-rowan"), false);
  sim.dispose();
});

test("foliage bends to wind, passing bodies and blows; switched off it only returns to rest", () => {
  const { sim, physical } = arena();
  const tree = physical.world.pose("prop-tree-1-0"),
    brush = physical.world.pose("prop-brush-1-0");
  physical.reactions.addField({
    id: "test-wind",
    kind: "wind",
    areaId: "area-1",
    shape: { kind: "lane", x: tree.x - 40, y: tree.y, angle: 0, length: 90, width: 50 },
    strength: 600,
    ticks: -1,
    gust: 0,
    actors: false,
    owner: "",
    team: "world",
    source: "test",
  });
  sim.step(40);
  assert.ok(physical.rigs.bendOf(tree.id) > 0.02, "the canopy leans downwind");
  // Walking through the brush pushes it aside.
  sim.teleport("local", brush.x - 30, brush.y);
  sim.step(2);
  sim.setInput("local", { x: 1, y: 0, dash: false, pulse: false, interact: false });
  sim.step(22);
  sim.setInput("local", { x: 0, y: 0, dash: false, pulse: false, interact: false });
  assert.ok(Math.abs(physical.rigs.bendOf(brush.id)) > 0.02, "the brush bends as you pass");
  assert.ok(
    physical.rigs.save().foliage.some((f) => f.id === brush.id),
    "bend is saved state",
  );
  edit(sim, [area({ foliage: false })]);
  sim.step(240);
  assert.ok(Math.abs(physical.rigs.bendOf(tree.id)) < 0.002, "off: it returns to rest");
  sim.adventure.strikeProp(sim, "local", brush.id, 1);
  sim.step(3);
  assert.equal(physical.rigs.bendOf(brush.id), 0, "and blows add nothing");
  sim.dispose();
});

test("two runs of the same fight produce identical rigs, remains and hashes", () => {
  const fight = () => {
    const { sim } = arena();
    const list = (["stalker", "crawler", "brute", "wraith", "totem", "warden"] as const).map(
      (rig, i) => monster(sim, rig, 50 + (i % 3) * 30, (i < 3 ? -1 : 1) * 30, 150),
    );
    for (let round = 0; round < 5; round++) {
      for (const e of list) if (e.hp > 0) strike(sim, e, 45, round * 0.7);
      sim.step(7);
    }
    sim.step(90);
    const hash = sim.stateHash();
    sim.dispose();
    return hash;
  };
  assert.equal(fight(), fight());
});

test("a real M08 checkpoint migrates: rigs start at rest, the dead stay dead, versions advance", () => {
  const legacy = JSON.parse(
    gunzipSync(readFileSync(new URL("./fixtures/m08-raw.json.gz", import.meta.url))).toString(),
  ) as SaveState;
  assert.equal(legacy.actorPhysics!.version, 6);
  assert.equal(legacy.actorPhysics!.world.version, 8);
  const sim = Simulation.restore(structuredClone(legacy));
  try {
    for (const e of sim.adventure.state.enemies) assert.equal(e.reaction.lean, 0);
    assert.equal(sim.adventure.hero("local").recoil.swing, 0);
    const dead = sim.adventure.state.enemies.find((e) => e.phase === "dead")!;
    assert.ok(dead, "the fixture holds a dying monster");
    assert.equal(sim.physical!.world.policyOf("prop-coil-5-0").effective.ragdolls, true);
    sim.step(60);
    assert.equal(sim.physical!.rigs.has(dead.id), false, "no remains appear for an earlier death");
    assert.equal(
      sim.adventure.state.enemies.some((e) => e.id === dead.id),
      false,
    );
    const saved = sim.save();
    assert.equal(saved.actorPhysics!.version, 7);
    assert.equal(saved.actorPhysics!.world.version, 9);
    const again = Simulation.restore(structuredClone(saved));
    again.dispose();
  } finally {
    sim.dispose();
  }
});
