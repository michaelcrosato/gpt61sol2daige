import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentRuntime, type Replay, replay } from "../src/engine/agent.ts";
import { Simulation } from "../src/engine/simulation.ts";
import { areaRecipe } from "../src/game/content.ts";
import { adventureAreaAt } from "../src/physics/adventure.ts";
import { initializePhysics } from "../src/physics/bootstrap.ts";
import {
  containsRegion,
  defaultPolicyState,
  editPolicies,
  PolicyController,
  type PolicyEdit,
  type PolicyState,
  type PolicyValues,
  resolvePolicy,
  validatePolicyState,
  validateShape,
} from "../src/physics/policies.ts";
import { createPlayground, PhysicsWorld, physicsResources } from "../src/physics/runtime.ts";

await initializePhysics();
const pose = (world: PhysicsWorld, id = "wheel") => world.poses().find((body) => body.id === id)!;
function apply(world: PhysicsWorld, edits: PolicyEdit[]) {
  world.configure({ expectedRevision: world.inspect().policies.nextRevision, edits });
  world.applyPolicies(world.inspect().policies.nextRevision);
}
const override = (values: PolicyValues): PolicyEdit => ({
  type: "override",
  scope: "area",
  id: "playground",
  values,
});

test("circle, rectangle and concave polygon membership include edges and stable hysteresis", () => {
  for (const shape of [
    { kind: "circle" as const, x: 0, y: 0, radius: 10 },
    { kind: "rectangle" as const, x: -10, y: -10, width: 20, height: 20 },
    {
      kind: "polygon" as const,
      points: [
        { x: -10, y: -10 },
        { x: 10, y: -10 },
        { x: 10, y: 10 },
        { x: 0, y: 0 },
        { x: -10, y: 10 },
      ],
    },
  ]) {
    validateShape(shape);
    assert.equal(containsRegion(shape, 0, -5), true);
    assert.equal(containsRegion(shape, 10, 0), true);
    assert.equal(containsRegion(shape, 10.5, 0), false);
    assert.equal(containsRegion(shape, 10.5, 0, 1), true);
    assert.equal(containsRegion(shape, 9.5, 0, -1), false);
  }
  const state = defaultPolicyState();
  assert.deepEqual(resolvePolicy(state, "playground", -170.5, -70).regions, []);
  assert.deepEqual(resolvePolicy(state, "playground", -170.5, -70, ["quiet-garden"]).regions, [
    "quiet-garden",
  ]);
  assert.equal(
    containsRegion(
      {
        kind: "polygon",
        points: [
          { x: -10, y: -10 },
          { x: 10, y: -10 },
          { x: 10, y: 10 },
          { x: 0, y: 0 },
          { x: -10, y: 10 },
        ],
      },
      0,
      5,
    ),
    false,
  );
});

test("profile inheritance, debug specificity, overlap priority/ID and absolute master-off", () => {
  let state = editPolicies(defaultPolicyState(), {
    expectedRevision: 0,
    edits: [
      {
        type: "land",
        profile: { id: "other-land", values: { impulseStrength: 3, propBlocking: false } },
      },
      {
        type: "area",
        profile: { id: "other-area", landId: "other-land", values: { dynamicProps: false } },
      },
      {
        type: "region",
        profile: {
          id: "z",
          areaId: "other-area",
          priority: 5,
          shape: { kind: "circle", x: 0, y: 0, radius: 30 },
          values: { dynamicProps: true, impulseStrength: 4 },
        },
      },
      {
        type: "region",
        profile: {
          id: "a",
          areaId: "other-area",
          priority: 5,
          shape: { kind: "rectangle", x: -20, y: -20, width: 40, height: 40 },
          values: { impulseStrength: 5 },
        },
      },
      {
        type: "region",
        profile: {
          id: "higher",
          areaId: "other-area",
          priority: 6,
          shape: {
            kind: "polygon",
            points: [
              { x: -10, y: -10 },
              { x: 10, y: -10 },
              { x: 0, y: 10 },
            ],
          },
          values: { propBlocking: true },
        },
      },
    ],
  });
  let p = resolvePolicy(state, "other-area", 0, 0);
  assert.equal(p.landId, "other-land");
  assert.equal(p.values.impulseStrength, 5);
  assert.equal(p.provenance.impulseStrength, "region:a/profile");
  assert.equal(p.provenance.propBlocking, "region:higher/profile");
  assert.equal(p.values.dynamicProps, true);
  state = editPolicies(state, {
    expectedRevision: 1,
    edits: [
      {
        type: "override",
        scope: "land",
        id: "other-land",
        values: { worldReactions: false, dynamicProps: false },
      },
      {
        type: "override",
        scope: "area",
        id: "other-area",
        values: { worldReactions: true, dynamicProps: true },
      },
      { type: "override", scope: "region", id: "a", values: { dynamicProps: false } },
    ],
  });
  p = resolvePolicy(state, "other-area", 0, 0);
  assert.equal(p.values.worldReactions, true);
  assert.equal(p.effective.dynamicProps, false);
  assert.equal(p.provenance.dynamicProps, "region:a/override");
  assert.equal(resolvePolicy(state, "other-area", 100, 100).effective.dynamicProps, true);
  state = editPolicies(state, { expectedRevision: 2, edits: [{ type: "master", enabled: false }] });
  p = resolvePolicy(state, "other-area", 0, 0);
  assert.equal(p.effective.worldReactions, false);
  assert.equal(p.effective.propBlocking, false);
  assert.equal(p.provenance.worldReactions, "session-master-off");
  assert.equal(p.values.propBlocking, true, "Inspector preserves the gated requested value");
});

test("invalid schemas and stale multi-edit transactions leave applied/queued/body state unchanged", () => {
  const agent = new AgentRuntime(new Simulation(142, 0));
  try {
    agent.execute({ op: "physics", action: "reset" });
    const world = agent.sim.playground!;
    world.impulse("wheel", 240, 0);
    world.configure({ expectedRevision: 0, edits: [override({ dynamicProps: false })] });
    assert.equal(world.inspect().policies.state.revision, 0);
    assert.equal(pose(world).frozen, false, "queue cannot change bodies before boundary");
    const saved = world.save(),
      hash = agent.sim.stateHash(),
      log = agent.log.length;
    for (const command of [
      {
        op: "physics",
        action: "configure",
        expectedRevision: 0,
        edits: [{ type: "master", enabled: false }],
      },
      {
        op: "physics",
        action: "configure",
        expectedRevision: 1,
        edits: [
          { type: "master", enabled: false },
          { type: "override", scope: "area", id: "playground", values: { impulseStrength: NaN } },
        ],
      },
      {
        op: "physics",
        action: "configure",
        expectedRevision: 1,
        edits: [
          { type: "remove", scope: "area", id: "playground" },
          { type: "remove", scope: "region", id: "quiet-garden" },
        ],
      },
      { op: "physics", action: "apply", expectedRevision: 0 },
    ])
      assert.throws(() => agent.execute(command));
    assert.deepEqual(world.save(), saved);
    assert.equal(agent.sim.stateHash(), hash);
    assert.equal(agent.log.length, log);
    world.step();
    assert.equal(world.inspect().policies.state.revision, 1);
    assert.equal(pose(world).frozen, true);
    for (const mutation of [
      (s: PolicyState) => {
        s.masterWorldReactions = "false" as unknown as boolean;
      },
      (s: PolicyState) => {
        s.profiles.lands.push(s.profiles.lands[0]);
      },
      (s: PolicyState) => {
        s.profiles.areas[0].landId = "missing";
      },
      (s: PolicyState) => {
        s.profiles.regions[0].values = { ragdolls: true } as never;
      },
      (s: PolicyState) => {
        s.profiles.regions[0].shape = {
          kind: "polygon",
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
            { x: 10, y: 0 },
          ],
        };
      },
      (s: PolicyState) => {
        s.boundaryMargin = Infinity;
      },
    ]) {
      const s = defaultPolicyState();
      mutation(s);
      assert.throws(() => validatePolicyState(s));
    }
    for (const shape of [
      { kind: "circle", x: 0, y: 0, radius: -1 },
      { kind: "rectangle", x: 0, y: 0, width: 0, height: 1 },
      {
        kind: "polygon",
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 2, y: 0 },
        ],
      },
    ])
      assert.throws(() => validateShape(shape as never));
  } finally {
    agent.sim.dispose();
  }
});

test("same crate crosses reactive/quiet/reactive without returning to spawn or retaining motion", () => {
  const world = createPlayground();
  try {
    world.spawn({
      id: "crossing-crate",
      motion: "dynamic",
      shape: { kind: "box", width: 12, height: 12 },
      x: -140,
      y: -85,
      mass: 1,
      damping: 0,
      consequences: { destroyed: true, claimed: true, durability: 7 },
    });
    world.impulse("crossing-crate", -120, 0, -140, -82);
    for (let tick = 0; tick < 60 && !pose(world, "crossing-crate").frozen; tick++) world.step();
    const frozen = pose(world, "crossing-crate");
    assert.equal(frozen.frozen, true);
    assert.ok(frozen.x < -170);
    assert.notEqual(frozen.x, -140);
    assert.equal(frozen.vx, 0);
    assert.equal(frozen.angularVelocity, 0);
    world.impulse("crossing-crate", 1000, 0);
    for (let i = 0; i < 40; i++) world.step();
    assert.equal(pose(world, "crossing-crate").x, frozen.x);
    assert.equal(pose(world, "crossing-crate").angle, frozen.angle);
    world.place("crossing-crate", -145, -85);
    const woke = pose(world, "crossing-crate");
    assert.equal(woke.frozen, false);
    assert.equal(woke.vx, 0);
    assert.equal(woke.angularVelocity, 0);
    assert.equal(woke.angle, frozen.angle);
    assert.deepEqual(woke.consequences, frozen.consequences);
    world.impulse("crossing-crate", 120, 0);
    for (let i = 0; i < 8; i++) world.step();
    assert.ok(pose(world, "crossing-crate").x > -135);
    apply(world, [
      {
        type: "region",
        profile: {
          id: "quiet-garden",
          areaId: "playground",
          priority: 10,
          shape: { kind: "circle", x: -125, y: -85, radius: 20 },
          values: { worldReactions: false },
        },
      },
    ]);
    assert.equal(
      pose(world, "crossing-crate").frozen,
      true,
      "paused region edit takes effect without advancing tick",
    );
    const beforeTick = world.tick;
    apply(world, [
      { type: "override", scope: "region", id: "quiet-garden", values: { worldReactions: true } },
    ]);
    assert.equal(world.tick, beforeTick);
    assert.equal(pose(world, "crossing-crate").frozen, false);
    assert.equal(pose(world, "crossing-crate").vx, 0);
  } finally {
    world.dispose();
  }
});

test("real contact traveler blocks on frozen props, passes disabled props and always hits terrain", () => {
  const world = new PhysicsWorld();
  try {
    world.spawn({
      id: "terrain",
      motion: "fixed",
      shape: { kind: "box", width: 12, height: 200 },
      x: 120,
      y: 0,
    });
    world.spawn({
      id: "prop",
      motion: "dynamic",
      shape: { kind: "box", width: 24, height: 24 },
      x: 0,
      y: 60,
    });
    world.spawn({
      id: "actor",
      role: "actor",
      motion: "dynamic",
      shape: { kind: "circle", radius: 10 },
      x: -80,
      y: 60,
      mass: 8,
      restitution: 0,
      damping: 0,
    });
    apply(world, [override({ dynamicProps: false, propBlocking: true })]);
    world.drive("actor", 100, 0);
    for (let i = 0; i < 80; i++) world.step();
    assert.ok(pose(world, "actor").x < -19, "prop collision blocks actor");
    assert.equal(pose(world, "prop").x, 0);
    assert.ok(world.events.some((e) => e.started && [e.a, e.b].includes("prop")));
    apply(world, [override({ propBlocking: false })]);
    for (let i = 0; i < 60; i++) world.step();
    assert.ok(pose(world, "actor").x > 60, "disabled prop no longer blocks the traveler");
    assert.equal(pose(world, "prop").x, 0, "nonblocking still preserves frozen props");
    apply(world, [{ type: "master", enabled: false }]);
    for (let i = 0; i < 60; i++) world.step();
    assert.ok(pose(world, "actor").x < 106, "terrain remains essential under master-off");
    apply(world, [{ type: "master", enabled: true }, override({ propBlocking: true })]);
    world.place("actor", -80, 60);
    for (let i = 0; i < 80; i++) world.step();
    assert.ok(pose(world, "actor").x < -19, "reenabled collision works again");
    apply(world, [override({ dynamicProps: true })]);
    world.place("actor", -80, 60);
    for (let i = 0; i < 75; i++) world.step();
    assert.ok(pose(world, "prop").x > 20, "traveler pushes a real reactive prop");
    world.drive("actor", 0, 0);
    world.place("prop", 0, 60);
    world.place("actor", -80, 40);
    apply(world, [
      override({ dynamicProps: false }),
      {
        type: "region",
        profile: {
          id: "actor-quiet",
          areaId: "playground",
          priority: 40,
          shape: { kind: "rectangle", x: -95, y: 34, width: 135, height: 12 },
          values: { propBlocking: false },
        },
      },
      { type: "override", scope: "region", id: "actor-quiet", values: { propBlocking: false } },
    ]);
    world.drive("actor", 100, 0);
    for (let i = 0; i < 45; i++) world.step();
    assert.equal(pose(world, "actor").policy.effective.propBlocking, false);
    assert.equal(pose(world, "prop").policy.effective.propBlocking, true);
    assert.ok(
      pose(world, "actor").x > -10,
      "optional contact also requires the actor's regional permission",
    );
    assert.equal(pose(world, "prop").x, 0);
  } finally {
    world.dispose();
  }
});

test("waking overlap correction uses current pose, zero velocity and preserves consequences", () => {
  const world = new PhysicsWorld();
  try {
    world.spawn({
      id: "wall",
      motion: "fixed",
      shape: { kind: "box", width: 20, height: 100 },
      x: 0,
      y: 0,
    });
    apply(world, [override({ dynamicProps: false })]);
    world.spawn({
      id: "prop",
      motion: "dynamic",
      shape: { kind: "box", width: 20, height: 20 },
      x: 5,
      y: 0,
      consequences: { destroyed: false, claimed: true, durability: 0 },
    });
    assert.equal(pose(world, "prop").x, 5);
    apply(world, [override({ dynamicProps: true })]);
    const p = pose(world, "prop");
    assert.equal(p.frozen, false);
    assert.ok(p.x >= 20, "penetration corrected before wake");
    assert.equal(p.vx, 0);
    assert.equal(p.vy, 0);
    assert.equal(p.angularVelocity, 0);
    assert.equal(world.tick, 0);
    assert.deepEqual(p.consequences, { destroyed: false, claimed: true, durability: 0 });
    const restored = PhysicsWorld.restore(JSON.parse(JSON.stringify(world.save())));
    assert.deepEqual(restored.inspect(), world.inspect());
    restored.dispose();
  } finally {
    world.dispose();
  }
});

test("working presets, numeric zero and scope resets preserve the scene", () => {
  const world = createPlayground();
  try {
    for (const [preset, speed, blocking] of [
      ["Wild", 600, true],
      ["Sanctuary", 84, false],
      ["Reactive", 240, true],
    ] as const) {
      apply(world, [{ type: "preset", scope: "area", id: "playground", preset }]);
      world.place("wheel", -140, 45);
      world.impulse("wheel", 240, 0);
      assert.ok(Math.abs(pose(world).vx - speed) < 0.001);
      assert.equal(pose(world).policy.effective.propBlocking, blocking);
    }
    apply(world, [override({ impulseStrength: 0 })]);
    world.place("wheel", -140, 45);
    world.impulse("wheel", 240, 0);
    assert.equal(pose(world).vx, 0);
    apply(world, [{ type: "preset", scope: "area", id: "playground", preset: "Quiet" }]);
    assert.equal(pose(world).frozen, true);
    const position = pose(world).x;
    apply(world, [{ type: "reset", scope: "area", id: "playground", to: "inherited" }]);
    assert.equal(pose(world).frozen, false);
    assert.equal(pose(world).x, position);
    apply(world, [
      {
        type: "region",
        profile: {
          id: "quiet-garden",
          areaId: "playground",
          priority: 99,
          shape: { kind: "circle", x: 0, y: 0, radius: 5 },
          values: { dynamicProps: false },
        },
      },
      { type: "reset", scope: "region", id: "quiet-garden", to: "authored" },
    ]);
    assert.deepEqual(
      world.inspect().policies.state.profiles.regions[0],
      defaultPolicyState().authored.regions[0],
    );
    assert.deepEqual(world.inspect().policies.capabilities, [
      "worldReactions",
      "dynamicProps",
      "propBlocking",
      "impulseStrength",
      "crowdContacts",
      "ambientPhysics",
      "sweptCollision",
      "destruction",
      "materialDurability",
      "debrisLifetime",
      "impactDamage",
      "impactStrength",
      "projectileWorld",
      "physicalLoot",
      "mechanisms",
      "jointBreakage",
      "jointStrength",
      "materialReactions",
      "chainReactions",
      "environmentalForces",
      "fieldStrength",
    ]);
  } finally {
    world.dispose();
  }
});

test("applied/off and queued policies survive JSON save, replay, continuation; corrupt loads are atomic", () => {
  const baseline = physicsResources(),
    agent = new AgentRuntime(new Simulation(142, 0));
  let restored: Simulation | undefined, played: Simulation | undefined;
  try {
    agent.execute({ op: "physics", action: "reset" });
    agent.execute({
      op: "physics",
      action: "configure",
      expectedRevision: 0,
      edits: [override({ dynamicProps: false })],
    });
    agent.execute({ op: "physics", action: "apply", expectedRevision: 1 });
    agent.execute({
      op: "physics",
      action: "configure",
      expectedRevision: 1,
      edits: [
        {
          type: "region",
          profile: {
            id: "polygon",
            areaId: "playground",
            priority: 30,
            shape: {
              kind: "polygon",
              points: [
                { x: -200, y: 0 },
                { x: -100, y: 0 },
                { x: -100, y: 90 },
                { x: -200, y: 90 },
              ],
            },
            values: { worldReactions: true, dynamicProps: true },
          },
        },
        { type: "override", scope: "region", id: "polygon", values: { dynamicProps: true } },
      ],
    });
    const saved = JSON.parse(JSON.stringify(agent.sim.save()));
    restored = Simulation.restore(saved);
    assert.deepEqual(restored.playground!.inspect(), agent.sim.playground!.inspect());
    played = replay(agent.execute({ op: "replay" }) as Replay);
    assert.equal(played.stateHash(), agent.sim.stateHash());
    for (let i = 0; i < 60; i++) {
      agent.sim.step();
      restored.step();
    }
    assert.equal(restored.stateHash(), agent.sim.stateHash());
    assert.equal(pose(restored.playground!).frozen, false);
    const hash = agent.sim.stateHash(),
      resources = physicsResources();
    for (const mutate of [
      (s: ReturnType<Simulation["save"]>) => {
        s.playground!.policies!.state.revision = -1;
      },
      (s: ReturnType<Simulation["save"]>) => {
        s.playground!.bodies[0].policy!.effective.dynamicProps =
          !s.playground!.bodies[0].policy!.effective.dynamicProps;
      },
      (s: ReturnType<Simulation["save"]>) => {
        s.playground!.bodies[0].recipe.areaId = "missing";
      },
      (s: ReturnType<Simulation["save"]>) => {
        s.playground!.policies!.pending = [
          { expectedRevision: 0, edits: [{ type: "master", enabled: false }] },
        ];
      },
    ]) {
      const broken = agent.sim.save();
      mutate(broken);
      assert.throws(() => agent.execute({ op: "restore", state: broken }));
      assert.equal(agent.sim.stateHash(), hash);
      assert.deepEqual(physicsResources(), resources);
    }
    const legacy = createPlayground();
    try {
      apply(legacy, [override({ worldReactions: true })]);
      legacy.spawn({
        id: "legacy-quiet",
        motion: "dynamic",
        shape: { kind: "circle", radius: 5 },
        x: -210,
        y: -70,
      });
      const snapshot = legacy.save();
      snapshot.version = 1;
      delete snapshot.scene;
      delete snapshot.continuation;
      delete snapshot.policies;
      delete snapshot.assemblies;
      delete snapshot.joints;
      for (const body of snapshot.bodies) {
        delete body.policy;
        delete body.policySample;
        delete body.frozen;
        delete body.reactivationBlocked;
        delete body.state;
      }
      const migrated = PhysicsWorld.restore(snapshot);
      assert.equal(migrated.save().version, 8);
      assert.equal(
        pose(migrated, "legacy-quiet").frozen,
        true,
        "M01 import applies the M02 authored policy at the existing pose",
      );
      const remigrated = PhysicsWorld.restore(migrated.save());
      assert.deepEqual(remigrated.inspect(), migrated.inspect());
      remigrated.dispose();
      migrated.dispose();
    } finally {
      legacy.dispose();
    }
    const controller = new PolicyController();
    assert.throws(() => controller.configure({ expectedRevision: 0, edits: [] }));
  } finally {
    agent.sim.dispose();
    restored?.dispose();
    played?.dispose();
  }
  assert.deepEqual(physicsResources(), baseline);
});
test("memoized policy resolution equals uncached resolution, is frozen and follows applied edits", () => {
  const sim = new Simulation(142, 0);
  try {
    sim.addPlayer("local");
    sim.adventure.startArea(sim, 1);
    sim.step();
    const controller = new PolicyController(sim.physical!.world.save().policies);
    const state = controller.save().state;
    const areas = state.profiles.areas.map((a) => a.id);
    // Sweep every area across region interiors, edges and outside points, with both
    // hysteresis inputs, so shared results must match the uncached resolver exactly.
    for (const region of state.profiles.regions) {
      const shape = region.shape;
      const [cx, cy, reach] =
        shape.kind === "circle"
          ? [shape.x, shape.y, shape.radius + 4]
          : shape.kind === "rectangle"
            ? [shape.x + shape.width / 2, shape.y + shape.height / 2, shape.width / 2 + 4]
            : [0, 0, 4];
      for (let step = -12; step <= 12; step++)
        for (const areaId of [region.areaId, ...areas.slice(0, 2)])
          for (const previous of [[], [region.id]]) {
            const x = cx + (reach * step) / 10,
              y = cy - (reach * step) / 17;
            const cached = controller.resolve(areaId, x, y, previous);
            assert.deepEqual(cached, resolvePolicy(state, areaId, x, y, previous));
            assert.ok(Object.isFrozen(cached) && Object.isFrozen(cached.effective));
            assert.equal(controller.resolve(areaId, x, y, previous), cached);
          }
    }
    const before = controller.resolve("area-1", 0, 0);
    assert.throws(() => controller.resolve("missing-area", 0, 0), /Unknown body area/);
    controller.configure({
      expectedRevision: state.revision,
      edits: [{ type: "override", scope: "area", id: "area-1", values: { ambientPhysics: true } }],
    });
    // Queued edits do not leak into resolution until applied.
    assert.equal(controller.resolve("area-1", 0, 0), before);
    controller.apply();
    const after = controller.resolve("area-1", 0, 0);
    assert.notEqual(after, before);
    assert.equal(after.values.ambientPhysics, true);
    assert.deepEqual(after, resolvePolicy(controller.save().state, "area-1", 0, 0));
  } finally {
    sim.dispose();
  }
});
test("cached area footprints classify exactly like rebuilt area recipes across lands and seeds", () => {
  const reference = (s: Simulation["adventure"]["state"], x: number, y: number) => {
    if (Math.hypot(x, y) < 265) return "town";
    for (let i = 0; i < 4; i++) {
      const r =
        s.mode === "area" && s.recipe.index === s.townLand * 4 + i + 1
          ? s.recipe
          : areaRecipe(s.seed, s.townLand * 4 + i + 1);
      if (Math.hypot(x - r.x, y - r.y) < r.radius + 35) return `area-${r.index}`;
    }
    return "wilderness";
  };
  for (const seed of [142, 7, 3298013210]) {
    const sim = new Simulation(seed, 0);
    try {
      sim.addPlayer("local");
      for (const [land, area] of [
        [0, 0],
        [0, 3],
        [2, 0],
        [2, 10],
      ]) {
        const state = sim.adventure.state;
        state.townLand = land;
        if (area) sim.adventure.startArea(sim, area);
        let checked = 0;
        for (let x = -1400; x <= 1400; x += 37)
          for (let y = -1400; y <= 1400; y += 41) {
            assert.equal(adventureAreaAt(state, x, y), reference(state, x, y));
            checked++;
          }
        assert.ok(checked > 5000);
      }
    } finally {
      sim.dispose();
    }
  }
});
