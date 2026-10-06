import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { AgentRuntime, replay } from "../src/engine/agent.ts";
import { type SaveState, Simulation } from "../src/engine/simulation.ts";
import { Terrain } from "../src/engine/world.ts";
import { encounterPosition } from "../src/game/content.ts";
import { initializePhysics } from "../src/physics/bootstrap.ts";
import {
  areaMechanisms,
  insidePen,
  MECHANISMS,
  mechanismExport,
} from "../src/physics/mechanisms.ts";
import type { PolicyEdit } from "../src/physics/policies.ts";
import { jointAnchors } from "../src/physics/runtime.ts";

await initializePhysics();
/** Area 1 with no monsters and no area mechanics; the traveler waits at the entry. */
function arena(index = 1) {
  const sim = new Simulation(142, 0);
  sim.addPlayer("local");
  sim.adventure.startArea(sim, index);
  sim.step();
  const s = sim.adventure.state;
  s.enemies = [];
  s.spawned = s.recipe.killGoal;
  s.mechanics = [];
  return { sim, s, r: s.recipe, world: sim.physical!.world, physical: sim.physical! };
}
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
const reset: PolicyEdit = { type: "reset", scope: "area", id: "area-1", to: "inherited" };
const events = (sim: Simulation) =>
  sim.adventure.state.events.filter((e) => e.type === "assembly").map((e) => e.text);
const gap = (sim: Simulation, joint: string) => {
  const world = sim.physical!.world,
    entry = world.joint(joint),
    anchors = jointAnchors(entry.recipe, world.pose(entry.recipe.a), world.pose(entry.recipe.b));
  return Math.hypot(anchors.ax - anchors.bx, anchors.ay - anchors.by);
};
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

test("every area carries six registered mechanisms with joints, members and authored events", () => {
  const { sim, world } = arena();
  try {
    const kinds = world
      .assemblyList()
      .filter((a) => a.areaId === "area-1")
      .map((a) => [a.kind, a.event]);
    assert.deepEqual(kinds, [
      ["bridge", "deck"],
      ["chain", "none"],
      ["gate", "latch"],
      ["launcher", "launch"],
      ["vane", "none"],
      ["vine", "none"],
    ]);
    // M07's six per area; M10 adds town fixtures and tailwind vanes under their own ids.
    assert.equal(
      world.assemblyList().filter((a) => /^(gate|chain|vine|launcher|vane|bridge)-\d+$/.test(a.id))
        .length,
      24,
      "four areas per land",
    );
    const joints = world.jointList().filter((j) => j.recipe.assembly.endsWith("-1"));
    assert.deepEqual([...new Set(joints.map((j) => j.recipe.kind))].sort(), [
      "hinge",
      "rope",
      "slider",
      "spring",
    ]);
    for (const joint of world.jointList()) {
      const kind = joint.recipe.kind,
        span = gap(sim, joint.recipe.id);
      if (kind === "hinge") assert.ok(span < 0.6, joint.recipe.id);
      if (kind === "rope" || kind === "spring") assert.ok(span <= joint.recipe.length! + 0.6);
    }
    assert.equal(JSON.stringify(mechanismExport()), JSON.stringify(mechanismExport()));
    assert.deepEqual(Object.keys(MECHANISMS), [
      "gate",
      "chain",
      "vine",
      "launcher",
      "vane",
      "bridge",
      // M10 town fixtures.
      "stall",
      "lamp",
      "bunting",
    ]);
    const agent = new AgentRuntime(sim);
    const exported = agent.execute({ op: "actors", action: "mechanisms" }) as {
      registry: unknown;
      links: unknown[];
    };
    assert.deepEqual(exported.registry, JSON.parse(JSON.stringify(mechanismExport())));
    assert.equal(exported.links.length, world.jointList().length);
  } finally {
    sim.dispose();
  }
});

test("a gate swings around its hinge, latches open as an authored event and the latch is saved", () => {
  const { sim, world, physical } = arena();
  try {
    const before = world.pose("prop-gate-1-leaf");
    world.impulse("prop-gate-1-leaf", 0, 600); // Push the leaf outward (south).
    sim.step(30);
    const leaf = world.pose("prop-gate-1-leaf");
    assert.ok(leaf.angle - before.angle > 1.2, `swung ${leaf.angle}`);
    assert.ok(gap(sim, "gate-1:hinge") < 0.5, "still pinned to its hinge post");
    assert.ok(leaf.angle < 1.92, "the hinge limit stops it");
    sim.step(2);
    assert.ok(events(sim).includes("gate:latched"));
    assert.equal(world.joint("gate-1:hinge").motor!.target, 1.6, "latched motor state");
    sim.step(120);
    assert.ok(Math.abs(world.pose("prop-gate-1-leaf").angle - 1.6) < 0.25, "stays open");
    for (const portable of [false, true]) {
      const restored = Simulation.restore(
        JSON.parse(JSON.stringify(sim.save(portable))) as SaveState,
      );
      try {
        assert.equal(restored.physical!.world.joint("gate-1:hinge").motor!.target, 1.6);
        assert.deepEqual(
          restored.physical!.mechanisms.save().gates.find((g) => g.id === "gate-1"),
          physical.mechanisms.save().gates.find((g) => g.id === "gate-1"),
        );
      } finally {
        restored.dispose();
      }
    }
    // A slow, deliberate push closes it again and the spring holds it shut. The push turns the
    // leaf about its hinge pin (its centre moves with the turn), not just about its own centre.
    for (let t = 0; t < 90 && Math.abs(world.pose("prop-gate-1-leaf").angle) > 0.3; t++) {
      const entry = world.joint("gate-1:hinge"),
        p = world.pose("prop-gate-1-leaf"),
        pin = jointAnchors(entry.recipe, world.pose(entry.recipe.a), p);
      world.motion(p.id, 1.5 * (p.y - pin.ay), -1.5 * (p.x - pin.ax), -1.5);
      sim.step(1);
    }
    sim.step(60);
    assert.ok(events(sim).includes("gate:closed"));
    assert.ok(Math.abs(world.pose("prop-gate-1-leaf").angle) < 0.2);
  } finally {
    sim.dispose();
  }
});

test("a tether limits motion, a hard yank snaps it and a cut anchor frees the part with its motion", () => {
  // Tether: pulling the pod never takes it past the vine's reach.
  {
    const { sim, world } = arena();
    try {
      const root = world.pose("prop-vine-1-root");
      for (let t = 0; t < 40; t++) {
        world.motion("prop-vine-1-pod", 200, 120);
        sim.step(1);
      }
      assert.ok(distance(world.pose("prop-vine-1-pod"), root) <= 70.1);
      assert.ok(world.jointList().every((j) => !j.broken));
      // A hard yank exceeds the tether's break load and snaps it; the pod flies on.
      for (let t = 0; t < 6; t++) {
        world.motion("prop-vine-1-pod", 700, 0);
        sim.step(1);
      }
      const broken = world.jointList().filter((j) => j.broken);
      assert.ok(broken.length >= 1 && broken.every((j) => j.cause === "strain"));
      sim.step(30);
      assert.ok(distance(world.pose("prop-vine-1-pod"), root) > 90);
      sim.step(2);
      assert.ok(events(sim).some((e) => /^vine:\w+:snapped$/.test(e)));
    } finally {
      sim.dispose();
    }
  }
  // Anchor: a swinging ball keeps its velocity when its chain is cut at the post.
  {
    const { sim, world, physical } = arena();
    try {
      const post = world.pose("prop-chain-1-post");
      world.motion("prop-chain-1-ball", 0, 260);
      sim.step(6);
      const moving = world.pose("prop-chain-1-ball");
      assert.ok(distance(moving, post) <= 58.6, "the chain holds it on its circle");
      const result = physical.cut(sim, "local", "chain-1:anchor");
      assert.equal(result.broken, true);
      sim.step(1);
      const freed = world.pose("prop-chain-1-ball"),
        speed = Math.hypot(moving.vx, moving.vy),
        after = Math.hypot(freed.vx, freed.vy);
      assert.ok(speed > 60 && after > speed * 0.6, `inherited ${after} of ${speed}`);
      assert.ok((freed.vx * moving.vx + freed.vy * moving.vy) / (speed * after) > 0.6);
      sim.step(40);
      assert.ok(distance(world.pose("prop-chain-1-ball"), post) > 70, "flew beyond the chain");
      assert.equal(world.partOf("prop-chain-1-ball")!.anchored, false);
      sim.step(1);
      const cut = sim.adventure.state.events.find((e) => e.text === "chain:anchor:cut")!;
      assert.equal(cut.owner, "local");
    } finally {
      sim.dispose();
    }
  }
});

test("mechanisms off freezes whole parts where they stand; on again wakes them without a kick", () => {
  const { sim, world } = arena();
  try {
    world.impulse("prop-gate-1-leaf", 0, 300);
    world.motion("prop-chain-1-ball", 0, 200);
    sim.step(4);
    edit(sim, [area({ mechanisms: false })]);
    sim.step(1);
    const parts = [
      "prop-gate-1-leaf",
      "prop-chain-1-ball",
      "prop-chain-1-link2",
      "prop-vine-1-pod",
    ];
    const frozen = parts.map((id) => world.pose(id));
    for (const pose of frozen) assert.equal(pose.frozen, true, pose.id);
    assert.equal(world.pose("crate-1-0").frozen, false, "loose props keep moving");
    world.impulse("prop-gate-1-leaf", 0, 900);
    sim.step(30);
    for (const before of frozen) {
      const now = world.pose(before.id);
      assert.equal(now.x, before.x);
      assert.equal(now.angle, before.angle);
    }
    // A link cut while frozen stays cut; the freed pod is then a loose prop, not a frozen part.
    sim.physical!.cut(sim, "local", "vine-1:pod");
    sim.step(1);
    assert.equal(world.pose("prop-vine-1-pod").frozen, false);
    assert.equal(world.pose("prop-vine-1-seg5").frozen, true);
    edit(sim, [reset]);
    sim.step(1);
    for (const before of frozen) {
      const now = world.pose(before.id);
      assert.equal(now.frozen, false, before.id);
      assert.ok(Math.hypot(now.vx, now.vy) < 2 && Math.abs(now.angularVelocity) < 2, before.id);
      assert.ok(distance(now, before) < 0.5, "no impulse explosion on wake");
    }
    assert.equal(world.joint("vine-1:pod").broken, true, "re-enabling never repairs a link");
  } finally {
    sim.dispose();
  }
});

test("joint breakage off keeps parts attached and stops cuts; joints off with breakage on still cuts", () => {
  const yank = (sim: Simulation) => {
    for (let t = 0; t < 6; t++) {
      sim.physical!.world.motion("prop-chain-1-ball", 700, 0);
      sim.step(1);
    }
  };
  {
    const { sim, world, physical } = arena();
    try {
      edit(sim, [area({ jointBreakage: false })]);
      yank(sim);
      assert.ok(
        world.jointList().every((j) => !j.broken),
        "no strain breaks",
      );
      assert.ok(world.joint("chain-1:anchor").peak > 2600, "the yank was strong enough");
      const cut = physical.cut(sim, "local", "chain-1:anchor");
      assert.equal(cut.protectedByPolicy, true);
      assert.equal(world.joint("chain-1:anchor").broken, false);
      edit(sim, [reset]);
      yank(sim);
      assert.ok(world.jointList().some((j) => j.broken && j.cause === "strain"));
    } finally {
      sim.dispose();
    }
  }
  {
    const { sim, world, physical } = arena();
    try {
      edit(sim, [area({ mechanisms: false })]);
      const ball = world.pose("prop-chain-1-ball");
      assert.equal(physical.cut(sim, "local", "chain-1:ball").broken, true);
      sim.step(10);
      assert.equal(world.pose("prop-chain-1-ball").x, ball.x, "a cut part does not move while off");
      edit(sim, [reset]);
      world.impulse("prop-chain-1-ball", 2000, 0);
      sim.step(30);
      assert.ok(world.pose("prop-chain-1-ball").x - ball.x > 40, "released once mechanisms resume");
    } finally {
      sim.dispose();
    }
  }
});

test("a connected part follows its root's region policy, so a boundary never splits a chain", () => {
  const { sim, world, r } = arena();
  try {
    const ball = world.pose("prop-chain-1-ball"),
      post = world.pose("prop-chain-1-post");
    const region = (id: string, x: number, y: number): PolicyEdit => ({
      type: "region",
      profile: {
        id,
        areaId: "area-1",
        priority: 40,
        shape: { kind: "circle", x, y, radius: 16 },
        values: { mechanisms: false },
      },
    });
    edit(sim, [region("ball-quiet", ball.x, ball.y)]);
    sim.step(1);
    assert.equal(world.pose("prop-chain-1-ball").frozen, false, "the ball follows the post");
    assert.deepEqual(
      world.pose("prop-chain-1-ball").policy.regions,
      world.pose(post.id).policy.regions,
    );
    edit(sim, [region("post-quiet", post.x, post.y)]);
    sim.step(1);
    for (const id of world.partMembers(post.id))
      if (world.pose(id).motion === "dynamic") assert.equal(world.pose(id).frozen, true, id);
    // A checkpoint whose member disagrees with its root is rejected.
    const state = JSON.parse(JSON.stringify(sim.save())) as SaveState;
    const entry = state.actorPhysics!.world.bodies.find(
      (b) => b.recipe.id === "prop-chain-1-ball",
    )!;
    entry.policySample = { x: entry.policySample!.x + 1, y: entry.policySample!.y };
    assert.throws(() => Simulation.restore(state), /root/);
    assert.ok(r.index === 1);
  } finally {
    sim.dispose();
  }
});

test("required travel stays clear and the causeway is a worthwhile shortcut, jammed or not", () => {
  const { sim, world, r } = arena();
  try {
    // Every mechanism part and companion stays off the entry–exit lane and portals.
    const { mechanisms, extras } = areaMechanisms(r, 0);
    for (const body of [...mechanisms.flatMap((m) => m.bodies), ...extras]) {
      assert.ok(Math.abs(body.y - r.y) > 90, `${body.id} off the lane`);
      for (const [x, y] of [
        [r.x - 230, r.y],
        [r.x - 265, r.y + 95],
        [r.x + 275, r.y],
      ])
        assert.ok(Math.hypot(body.x - x, body.y - y) > 90, `${body.id} clear of portals`);
    }
    // No wave starts inside the gate pen, whatever the encounter rolls.
    for (let ordinal = 0; ordinal < 200; ordinal++) {
      const p = encounterPosition(r, ordinal);
      if (insidePen(r, p.x, p.y)) {
        sim.adventure.state.spawned = ordinal;
        (sim.adventure as unknown as { spawnEnemy: (...a: unknown[]) => void }).spawnEnemy(
          sim,
          ordinal,
          p.x,
          p.y,
          false,
          true,
        );
        const e = sim.adventure.state.enemies.at(-1)!;
        assert.equal(insidePen(r, e.x, e.y), false);
      }
    }
    sim.adventure.state.enemies = [];
    // Crossing the creek on the deck is about twice as fast as wading beside it.
    const plank = world.pose("prop-bridge-1-plank0");
    assert.equal(sim.world.at(plank.x, plank.y - 16).terrain, Terrain.Water);
    const cross = (x: number) => {
      sim.teleport("local", x, plank.y);
      sim.step(2);
      const start = sim.players.get("local")!.y;
      sim.setInput("local", { y: -1 });
      sim.step(20);
      sim.setInput("local", {});
      return start - sim.players.get("local")!.y;
    };
    const deck = cross(plank.x),
      wading = cross(plank.x + 60);
    assert.ok(deck > wading * 1.6, `deck ${deck} vs wading ${wading}`);
    // Physics off (master) keeps the anchored deck usable; cutting a lashing loses the span.
    edit(sim, [{ type: "master", enabled: false }]);
    assert.ok(cross(plank.x) > wading * 1.6, "a frozen anchored deck still carries travelers");
    edit(sim, [{ type: "master", enabled: true }]);
    sim.physical!.cut(sim, "local", "bridge-1:south");
    sim.physical!.cut(sim, "local", "bridge-1:north");
    sim.step(2);
    assert.ok(events(sim).includes("bridge:span-lost"));
    assert.equal(sim.physical!.deckAt(plank.x, plank.y), false);
  } finally {
    sim.dispose();
  }
});

test("the sprung launcher fires when released, throwing its payload as its cocker's", () => {
  const { sim, world } = arena();
  try {
    const sled = world.pose("prop-launcher-1-sled");
    sim.teleport("local", sled.x + 20, sled.y - 6);
    sim.step(2);
    sim.adventure.action(sim, "local", { type: "grab", id: sled.id });
    sim.setInput("local", { aimX: 0, aimY: -1 });
    sim.step(25);
    assert.ok(world.pose(sled.id).y - sled.y < -8, "pulled back against the spring");
    sim.step(1);
    assert.ok(events(sim).includes("launcher:cocked"));
    sim.adventure.action(sim, "local", { type: "release", throw: false });
    sim.setInput("local", {});
    sim.step(4);
    const stone = world.pose("prop-stone-1-launch");
    assert.ok(stone.vy > 250, `launched at ${stone.vy}`);
    assert.equal(sim.physical!.combat.instigator(stone.id, sim.tick)?.owner, "local");
    sim.step(1);
    const fired = sim.adventure.state.events.find((e) => e.text === "launcher:fired")!;
    assert.equal(fired.owner, "local");
  } finally {
    sim.dispose();
  }
});

test("Whorl, pulling, throwing and enemy charges move assemblies through the same paths", () => {
  // Whorl beside the chain ball launches it on its chain, owned by the traveler.
  {
    const { sim, world } = arena();
    try {
      const ball = world.pose("prop-chain-1-ball");
      sim.teleport("local", ball.x - 20, ball.y + 14);
      sim.step(2);
      sim.setInput("local", { pulse: true });
      sim.step(1);
      sim.setInput("local", {});
      sim.step(3);
      const after = world.pose(ball.id);
      assert.ok(Math.hypot(after.vx, after.vy) > 60);
      assert.equal(sim.physical!.combat.instigator(ball.id, sim.tick)?.owner, "local");
    } finally {
      sim.dispose();
    }
  }
  // Pulling: a held gate leaf swings open with the traveler.
  {
    const { sim, world } = arena();
    try {
      const leaf = world.pose("prop-gate-1-leaf");
      sim.teleport("local", leaf.x + 6, leaf.y + 14);
      sim.step(2);
      sim.adventure.action(sim, "local", { type: "grab", id: leaf.id });
      sim.setInput("local", { y: 1, aimX: 0, aimY: 1 });
      sim.step(40);
      sim.setInput("local", {});
      assert.ok(world.pose(leaf.id).angle > 0.6, "pulled open");
      assert.ok(gap(sim, "gate-1:hinge") < 0.5);
    } finally {
      sim.dispose();
    }
  }
  // Throwing a held pod tears the vine; the pod flies off as the thrower's.
  {
    const { sim, world } = arena();
    try {
      const pod = world.pose("prop-vine-1-pod");
      sim.teleport("local", pod.x - 4, pod.y + 14);
      sim.step(2);
      sim.adventure.action(sim, "local", { type: "grab", id: pod.id });
      sim.setInput("local", { aimX: 1, aimY: 0 });
      sim.step(6);
      sim.adventure.action(sim, "local", { type: "release", throw: true });
      sim.step(20);
      assert.ok(world.jointList().some((j) => j.recipe.assembly === "vine-1" && j.broken));
      assert.equal(sim.physical!.combat.instigator(pod.id, sim.tick)?.owner, "local");
    } finally {
      sim.dispose();
    }
  }
  // An enemy charge ploughs the gate leaf through the attack path.
  {
    const { sim, world } = arena();
    try {
      const leaf = world.pose("prop-gate-1-leaf");
      sim.physical!.damageProps(sim, {
        owner: "enemy-1",
        cause: "charge",
        team: "enemy",
        x: leaf.x,
        y: leaf.y - 18,
        radius: 24,
        damage: 0,
        impulse: 260,
        material: 0.6,
      });
      sim.step(10);
      assert.ok(Math.abs(world.pose(leaf.id).angle) > 0.3, "the charge swings the gate");
    } finally {
      sim.dispose();
    }
  }
});

test("an unanchored part travels whole through a rift; an anchored one cannot follow", () => {
  const { sim, world, physical } = arena();
  try {
    physical.cut(sim, "local", "chain-1:anchor");
    sim.step(5);
    const ball = world.pose("prop-chain-1-ball");
    sim.teleport("local", ball.x - 14, ball.y);
    sim.step(1);
    sim.adventure.action(sim, "local", { type: "grab", id: ball.id });
    sim.step(1);
    const members = world.partMembers(ball.id),
      before = members.map((id) => world.pose(id));
    assert.equal(members.length, 5, "four links and the ball");
    physical.carry(sim, "local", 300, 40);
    for (const [k, id] of members.entries()) {
      const now = world.pose(id);
      assert.ok(
        Math.abs(now.x - before[k].x - 300) < 0.01 && Math.abs(now.y - before[k].y - 40) < 0.01,
      );
    }
    for (const joint of world
      .jointList()
      .filter((j) => j.recipe.assembly === "chain-1" && !j.broken))
      assert.ok(gap(sim, joint.recipe.id) < 0.6, "joints travel intact");
    sim.adventure.action(sim, "local", { type: "release", throw: false });
    // Anchored: the hold lets go and the gate stays at its post.
    const leaf = world.pose("prop-gate-1-leaf");
    sim.teleport("local", leaf.x + 6, leaf.y + 14);
    sim.step(1);
    sim.adventure.action(sim, "local", { type: "grab", id: leaf.id });
    physical.carry(sim, "local", 300, 40);
    assert.equal(physical.combat.holding("local"), null);
    assert.ok(distance(world.pose(leaf.id), leaf) < 5);
    assert.throws(() => world.place(leaf.id, leaf.x + 100, leaf.y), /Anchored/);
  } finally {
    sim.dispose();
  }
});

test("membership, broken links and motor state survive saves, replay, late join and land recall", () => {
  const { sim, world, physical } = arena();
  const agent = new AgentRuntime(sim);
  try {
    sim.step(1); // Retire the cleared monsters' bodies before the recording starts.
    agent.beginRecording();
    agent.execute({ op: "actors", action: "cut", id: "vine-1:seg3" });
    agent.execute({ op: "actors", action: "impulse", id: "prop-gate-1-leaf", x: 0, y: 600 });
    agent.execute({ op: "step", ticks: 30 });
    agent.execute({
      op: "actors",
      action: "motor",
      id: "vane-1:pivot",
      motor: { mode: "velocity", target: -2, stiffness: 0, damping: 1.5 },
    });
    agent.execute({ op: "step", ticks: 5 });
    const joints = world.jointList(),
      assemblies = world.assemblyList(),
      mechanisms = physical.mechanisms.save();
    assert.ok(joints.some((j) => j.recipe.id === "vine-1:seg3" && j.broken));
    assert.equal(world.joint("gate-1:hinge").motor!.target, 1.6);
    replay(agent.execute({ op: "replay" }) as Parameters<typeof replay>[0]).dispose();
    for (const portable of [false, true]) {
      const restored = Simulation.restore(
        JSON.parse(JSON.stringify(sim.save(portable))) as SaveState,
      );
      try {
        assert.deepEqual(restored.physical!.world.assemblyList(), assemblies);
        assert.deepEqual(
          restored
            .physical!.world.jointList()
            .map((j) => [j.recipe.id, j.broken, j.motor, j.damage]),
          joints.map((j) => [j.recipe.id, j.broken, j.motor, j.damage]),
        );
        assert.deepEqual(restored.physical!.mechanisms.save(), mechanisms);
        if (!portable) {
          sim.step(10);
          restored.step(10);
          assert.equal(restored.stateHash(), sim.stateHash());
        }
      } finally {
        restored.dispose();
      }
    }
    const guest = new Simulation(142, 0);
    try {
      guest.applyReplica(JSON.parse(JSON.stringify(sim.save(true))) as SaveState);
      assert.deepEqual(guest.replicaPhysics!.world.joints, world.jointList());
      assert.deepEqual(guest.replicaPhysics!.mechanisms, physical.mechanisms.save());
      assert.equal(guest.physicalLinks().length, world.jointList().length);
      const guestAgent = new AgentRuntime(guest);
      const seen = guestAgent.execute({ op: "actors", action: "mechanisms" }) as {
        joints: unknown[];
      };
      assert.equal(seen.joints.length, world.jointList().length);
      assert.throws(
        () => guestAgent.execute({ op: "actors", action: "cut", id: "gate-1:hinge" }),
        /host/,
      );
    } finally {
      guest.dispose();
    }
    // Leave for another land and come back: the archive keeps every link and latch.
    sim.adventure.startArea(sim, 5);
    sim.step(5);
    assert.ok(sim.physical!.world.assemblyList().some((a) => a.id === "gate-5"));
    sim.adventure.startArea(sim, 1);
    sim.step(1);
    const back = sim.physical!.world;
    assert.equal(back.joint("vine-1:seg3").broken, true);
    assert.equal(back.joint("gate-1:hinge").motor!.target, 1.6);
    assert.equal(back.joint("vane-1:pivot").motor!.target, -2);
    assert.equal(sim.physical!.mechanisms.save().gates.find((g) => g.id === "gate-1")!.latched, 1);
  } finally {
    sim.dispose();
  }
});

test("projectiles fly over deck planks and under the raised vane; neither can be grabbed", () => {
  const { sim, world, physical } = arena();
  try {
    const plank = world.pose("prop-bridge-1-plank1"),
      rotor = world.pose("prop-vane-1-rotor");
    for (const target of [plank, rotor]) {
      const hit = physical.sceneryHit(target.x - 40, target.y, 80, 0, 3);
      assert.ok(!hit || hit.id !== target.id, `${target.id} is not cover`);
    }
    sim.teleport("local", plank.x + 20, plank.y);
    sim.step(1);
    assert.throws(
      () => sim.adventure.action(sim, "local", { type: "grab", id: plank.id }),
      /out of reach/,
    );
  } finally {
    sim.dispose();
  }
});

test("real M06 checkpoints migrate: mechanisms join once, archived lands gain them on return", () => {
  const legacy = JSON.parse(
    gunzipSync(readFileSync(new URL("./fixtures/m06-raw.json.gz", import.meta.url))).toString(),
  ) as SaveState;
  assert.equal(legacy.actorPhysics!.version, 4);
  assert.equal(legacy.actorPhysics!.world.version, 6);
  const sim = Simulation.restore(structuredClone(legacy));
  try {
    const world = sim.physical!.world;
    assert.deepEqual(sim.physical!.destroyedRecords(), legacy.actorPhysics!.destroyed);
    assert.equal(
      world.assemblyList().filter((a) => /^(gate|chain|vine|launcher|vane|bridge)-\d+$/.test(a.id))
        .length,
      24,
    );
    assert.ok(world.has("prop-gate-5-leaf"));
    const saved = sim.save();
    assert.equal(saved.actorPhysics!.version, 8);
    assert.equal(saved.actorPhysics!.world.version, 9);
    const archive = saved.actorPhysics!.archives.find((a) => a.id === "land-1-0")!;
    assert.equal(archive.assemblies, undefined, "an archived pre-M07 land stays as it was saved");
    const again = Simulation.restore(structuredClone(saved));
    try {
      assert.deepEqual(again.physical!.world.ids(), world.ids(), "nothing added twice");
    } finally {
      again.dispose();
    }
    sim.adventure.startArea(sim, 1);
    sim.step(1);
    assert.ok(sim.physical!.world.has("prop-gate-1-leaf"), "returning adds the land's mechanisms");
    assert.ok(
      sim.physical!.destroyedRecords().some((d) => d.id === "prop-pot-1-0"),
      "and keeps its destruction",
    );
    assert.ok(!sim.physical!.world.has("prop-pot-1-0"));
  } finally {
    sim.dispose();
  }
});
