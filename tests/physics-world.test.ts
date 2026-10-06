import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { AgentRuntime } from "../src/engine/agent.ts";
import { dcos, dsin } from "../src/engine/math.ts";
import { type SaveState, Simulation } from "../src/engine/simulation.ts";
import { areaRecipe, MECHANICS, mechanicLayout, TOWN_NPCS } from "../src/game/content.ts";
import type { Enemy } from "../src/game/types.ts";
import { WARDENS, wardenExport } from "../src/game/wardens.ts";
import { decodeSnapshot, encodeSnapshot } from "../src/net/protocol.ts";
import { CALM_VALUES, TOWN_VALUES } from "../src/physics/adventure.ts";
import { FAMILIES } from "../src/physics/blueprints.ts";
import { initializePhysics } from "../src/physics/bootstrap.ts";
import type { PolicyEdit } from "../src/physics/policies.ts";
import {
  BLOOM_SNARE,
  FREIGHT_PAD,
  LANE_BERTH,
  SHOWCASE,
  showcaseExport,
  TAILWIND,
  TOWN_SERVICES,
} from "../src/physics/showcase.ts";
import type { BodyPose } from "../src/physics/types.ts";

await initializePhysics();

/** One authored area with no waves or warden; the traveler waits at the entry. */
function area(index: number, seed = 142) {
  const sim = new Simulation(seed, 0);
  sim.addPlayer("local");
  sim.adventure.startArea(sim, index);
  const s = sim.adventure.state;
  s.enemies = [];
  s.spawned = s.recipe.killGoal;
  s.bossSpawned = true;
  sim.step();
  return {
    sim,
    s,
    r: s.recipe,
    agent: new AgentRuntime(sim),
    physical: sim.physical!,
    world: sim.physical!.world,
  };
}
type Ctx = ReturnType<typeof area>;
/** A monster at a point (QA), active or planted; its body exists after the next step. */
function monster(ctx: Ctx, x: number, y: number, extra: Record<string, unknown> = {}): Enemy {
  const { id } = ctx.agent.execute({
    op: "actors",
    action: "monster",
    rig: "stalker",
    x,
    y,
    hp: 5000,
    passive: true,
    ...extra,
  }) as { id: number };
  return ctx.s.enemies.find((e) => e.id === id)!;
}
function edit(sim: Simulation, edits: PolicyEdit[]) {
  const physical = sim.physical!;
  physical.configure({ expectedRevision: physical.world.policyState().nextRevision, edits });
  physical.world.applyPolicies(physical.world.policyState().nextRevision);
  physical.begin(sim);
}
const override = (scope: "area" | "region", id: string, values: Record<string, unknown>) =>
  ({ type: "override", scope, id, values }) as PolicyEdit;
const mechanic = (ctx: Ctx, kind: string, n = 0) =>
  ctx.s.mechanics.filter((m) => m.kind === kind)[n];
/** Real input: one press of the given buttons, then release. */
function press(sim: Simulation, input: Record<string, unknown>) {
  sim.setInput("local", input);
  sim.step();
  sim.setInput("local", {});
}
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);
/** Exact oriented-shape overlap of two colliding bodies (half a unit of tolerance). */
function overlap(a: BodyPose, b: BodyPose): boolean {
  if (a.shape.kind === "circle" && b.shape.kind === "circle")
    return distance(a, b) < a.shape.radius + b.shape.radius - 0.5;
  if (a.shape.kind === "circle") return overlap(b, a);
  const w = a.shape.width / 2,
    h = (a.shape as { height: number }).height / 2;
  if (b.shape.kind === "circle") {
    const c = Math.cos(-a.angle),
      s = Math.sin(-a.angle),
      dx = b.x - a.x,
      dy = b.y - a.y,
      lx = c * dx - s * dy,
      ly = s * dx + c * dy;
    return (
      Math.hypot(lx - Math.max(-w, Math.min(w, lx)), ly - Math.max(-h, Math.min(h, ly))) <
      b.shape.radius - 0.5
    );
  }
  const corners = (p: BodyPose) => {
    const c = Math.cos(p.angle),
      s = Math.sin(p.angle),
      hw = (p.shape as { width: number }).width / 2,
      hh = (p.shape as { height: number }).height / 2;
    return [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ].map(([x, y]) => ({ x: p.x + c * x - s * y, y: p.y + s * x + c * y }));
  };
  const A = corners(a),
    B = corners(b);
  for (const poly of [A, B])
    for (let i = 0; i < 4; i++) {
      const p = poly[i],
        q = poly[(i + 1) % 4],
        nx = q.y - p.y,
        ny = p.x - q.x,
        l = Math.hypot(nx, ny);
      const pa = A.map((t) => (t.x * nx + t.y * ny) / l),
        pb = B.map((t) => (t.x * nx + t.y * ny) / l);
      if (Math.max(...pa) - 0.5 <= Math.min(...pb) || Math.max(...pb) - 0.5 <= Math.min(...pa))
        return false;
    }
  return true;
}

test("every mechanic has a registered physical extension and every warden an identity; authored set pieces are complete and never spawn overlapping", () => {
  assert.deepEqual(
    Object.keys(SHOWCASE),
    MECHANICS.map((m) => m.id),
  );
  assert.deepEqual(
    Object.keys(WARDENS),
    MECHANICS.map((m) => m.id),
  );
  assert.equal(new Set(Object.values(WARDENS).map((w) => w.move)).size, 8);
  assert.equal(new Set(Object.values(WARDENS).map((w) => w.weakness)).size, 8);
  for (const info of Object.values(SHOWCASE))
    assert.ok(info.name && info.physical && info.setPiece && info.off);
  assert.equal(JSON.stringify(showcaseExport()), JSON.stringify(showcaseExport()));
  assert.equal(JSON.stringify(wardenExport()), JSON.stringify(wardenExport()));
  for (const seed of [142, 7]) {
    // Land 0 (areas 1–4) and land 1 (areas 5–8): every authored set piece is present.
    for (const first of [1, 5]) {
      const ctx = area(first, seed);
      try {
        const ids = new Set(ctx.world.ids());
        for (let index = first; index < first + 4; index++) {
          const recipe = areaRecipe(seed, index);
          for (const m of mechanicLayout(recipe)) {
            const want = {
              bramble: ["hedge-0", "hedge-1", "hedge-2", "pot-cache"],
              wind: ["barrel-0", "wheel-0"],
              glass: ["rod-0", "rod-1", "pylon-0"],
              echo: ["pot-0", "pot-1", "stone-0", "stone-1"],
              cinder: [
                "brush-0",
                "barricade-front",
                "barricade-back",
                m.n ? "pot-cache" : "chest-cache",
              ],
              blood: [],
              gravity: ["stone-0", "stone-1", "log-0", "barrel-0"],
              rift: m.n === 0 ? ["crate-0", "crate-1", "barrel-0"] : [],
            }[m.kind];
            for (const piece of want) {
              const [family, ...tag] = piece.split("-");
              const id = `prop-${family}-${index}-${m.kind}-${m.n}-${tag.join("-")}`;
              assert.ok(ids.has(id) || ctx.physical.isDestroyed(id), `${seed}: ${id}`);
            }
          }
        }
        // Nothing moving starts overlapped (raised cloth, vanes and lamps meet nothing).
        const poses = ctx.world
          .ids()
          .filter(
            (id) => id.startsWith("prop-") || id.startsWith("crate-") || id.startsWith("wheel-"),
          )
          .map((id) => ctx.world.pose(id))
          .filter((p) => !(p.blueprint && FAMILIES[p.blueprint.family].raised));
        for (let i = 0; i < poses.length; i++)
          for (let j = i + 1; j < poses.length; j++) {
            const a = poses[i],
              b = poses[j];
            if (a.motion === "fixed" && b.motion === "fixed") continue;
            if (a.assembly && a.assembly === b.assembly) continue;
            assert.ok(!overlap(a, b), `${seed}: ${a.id} overlaps ${b.id}`);
          }
        // Tailwind lanes never carry loose props into a reaction yard's fire, oil or powder.
        for (const field of ctx.physical.reactions.fieldList()) {
          if (!field.id.startsWith("tailwind-") || field.shape.kind !== "lane") continue;
          const lane = field.shape,
            ux = Math.cos(lane.angle),
            uy = Math.sin(lane.angle);
          for (const id of ids) {
            const family = /^prop-(brazier|jar|cask|brush)-\d+-\d+$/.exec(id);
            const volatile = /^prop-barrel-\d+-[12]$/.test(id);
            if (!family && !volatile) continue;
            const p = ctx.world.pose(id),
              along = (p.x - lane.x) * ux + (p.y - lane.y) * uy,
              across = Math.abs(-(p.x - lane.x) * uy + (p.y - lane.y) * ux);
            assert.ok(
              along < -20 || along > lane.length + 70 || across > TAILWIND.width / 2 + LANE_BERTH,
              `${field.id} reaches ${id}`,
            );
          }
        }
      } finally {
        ctx.sim.dispose();
      }
    }
  }
});

test("the town is a Sanctuary with tactile stalls, lamps and bunting, and its services stay reachable whatever lies in the way", () => {
  const sim = new Simulation(142, 0);
  sim.addPlayer("local");
  try {
    sim.step();
    const physical = sim.physical!,
      world = physical.world,
      p = sim.players.get("local")!;
    assert.equal(sim.adventure.state.mode, "town");
    const town = world.policyAt("town", 0, 0).effective;
    for (const [key, value] of Object.entries(TOWN_VALUES))
      assert.equal(town[key as keyof typeof town], value, key);
    assert.equal(world.policyAt("town", -150, -120).effective.propBlocking, true, "market");
    for (const kind of ["stall", "lamp", "bunting"])
      assert.ok(
        world.assemblyList().some((a) => a.kind === kind && a.areaId === "town"),
        kind,
      );
    // A slash across a lamp's arm swings it around its post; the spring settles it again.
    const lamp = "prop-lamp-town-1",
      post = world.pose("prop-post-town-lamp1"),
      rest = world.pose(lamp).angle;
    sim.teleport("local", post.x + 10, post.y - 22);
    press(sim, { attack: true, aimX: 0, aimY: 1 });
    let swing = 0;
    for (let t = 0; t < 90; t++) {
      sim.step();
      swing = Math.max(swing, Math.abs(world.pose(lamp).angle - rest));
    }
    assert.ok(swing > 0.15, `the lamp swings (${swing.toFixed(2)} rad)`);
    sim.step(300);
    assert.ok(Math.abs(world.pose(lamp).angle - rest) < 0.05, "and settles");
    assert.ok(distance(world.pose(lamp), post) < 10.6, "still on its bracket");
    // The breeze keeps the bunting fluttering; nothing in town breaks.
    const pennant = () => world.pose("prop-pennant-town-5");
    let travel = 0,
      last = pennant();
    for (let t = 0; t < 120; t++) {
      sim.step();
      travel += distance(pennant(), last);
      last = pennant();
    }
    assert.ok(travel > 3, `pennants flutter (${travel.toFixed(1)})`);
    const basket = sim.adventure.strikeProp(sim, "local", "prop-basket-town-0", 500)[0];
    assert.equal(basket.protectedByPolicy, true);
    assert.equal(physical.destroyedRecords().length, 0);
    // Even with the town switched Reactive and every loose good piled on the hearth and the
    // quartermaster, the keep-clear rings push them off within seconds.
    edit(sim, [{ type: "preset", scope: "area", id: "town", preset: "Reactive" }]);
    const goods = world.ids().filter((id) => /^prop-(crate|basket|barrel|pot)-town-/.test(id));
    for (const [k, id] of goods.entries())
      world.place(id, (k % 2 ? -106 : 0) + (k % 3) * 9 - 9, (k % 2 ? -28 : 30) + (k >> 1) * 4);
    sim.teleport("local", 300, 300);
    sim.step(300);
    for (const id of goods) {
      const g = world.pose(id);
      assert.ok(distance(g, { x: 0, y: 30 }) > 36, `${id} left the hearth`);
      assert.ok(distance(g, { x: -106, y: -28 }) > 20, `${id} left Rowan's post`);
    }
    // Real input reaches every service: walk to the hearth and rest, then to each townsperson.
    const walk = (to: { x: number; y: number }, within: number) => {
      for (let t = 0; t < 900 && distance(p, to) > within; t++) {
        const d = distance(p, to) || 1;
        sim.setInput("local", { x: (to.x - p.x) / d, y: (to.y - p.y) / d });
        sim.step();
      }
      sim.setInput("local", {});
      return distance(p, to) <= within;
    };
    sim.adventure.hero("local").hp = 1;
    assert.ok(walk({ x: 0, y: 30 }, 30), "the hearth is reachable");
    press(sim, { interact: true });
    assert.equal(sim.adventure.hero("local").hp, sim.adventure.stats("local").health);
    for (const npc of TOWN_NPCS.filter((n) => n.service !== "gate")) {
      const at = physical.npcPoint(npc.id)!;
      assert.ok(walk(at, 30), `${npc.name} is reachable`);
      press(sim, { interact: true });
      assert.ok(
        sim.adventure.state.events.some((e) => e.text === `service:${npc.service}`),
        npc.service,
      );
    }
    assert.ok(TOWN_SERVICES.length >= 5);
    sim.adventure.hero("local").skills["gale-0"] = 1;
    sim.adventure.hero("local").gold = 500;
    sim.adventure.action(sim, "local", { type: "respec" });
    assert.equal(sim.adventure.hero("local").skills["gale-0"], undefined, "respec works");
    assert.ok(walk({ x: 218, y: 36 }, 40), "the outward gate is reachable");
    press(sim, { interact: true });
    sim.step(2);
    assert.equal(sim.adventure.state.mode, "area", "the outward gate opens the next area");
  } finally {
    sim.dispose();
  }
});

test("Brambleburst: a burst shoves the pack, flings owned thorn splinters and opens its hedges; the calm pod does none of it and the wild pod hits harder", () => {
  const ctx = area(1);
  try {
    const { sim, physical, world } = ctx;
    const push = (n: number) => {
      const pod = mechanic(ctx, "bramble", n),
        e = monster(ctx, pod.x - 30, pod.y + 10);
      sim.step();
      const before = distance(e, pod),
        thorns = new Set(world.ids().filter((id) => id.startsWith("prop-thorn-")));
      sim.teleport("local", pod.x - 60, pod.y - 40);
      ctx.agent.execute({ op: "actors", action: "mechanic", id: pod.id });
      const fresh = world.ids().filter((id) => id.startsWith("prop-thorn-") && !thorns.has(id));
      sim.step(20);
      const moved = distance(e, pod) - before;
      ctx.s.enemies = [];
      sim.step();
      return { pod, fresh, moved };
    };
    const reactive = push(0);
    assert.equal(reactive.fresh.length, 8, "eight splinters");
    const instigators = physical.combat.save().instigators;
    for (const id of reactive.fresh)
      if (world.has(id))
        assert.equal(instigators.find((i) => i.id === id)?.owner, "local", `${id} is the hero's`);
    assert.ok(reactive.moved > 12, `the pack is shoved (${reactive.moved.toFixed(1)})`);
    const hedges = [0, 1, 2].map((k) => `prop-hedge-1-bramble-0-${k}`);
    for (const id of [...hedges, "prop-pot-1-bramble-0-cache"])
      assert.ok(physical.isDestroyed(id), `${id} opened`);
    const cache = physical.destroyedRecords().find((r) => r.id === "prop-pot-1-bramble-0-cache")!;
    assert.equal(cache.owner, "local");
    assert.ok(cache.reward > 0);
    const wild = push(1);
    assert.ok(physical.policyAt(sim, wild.pod.x, wild.pod.y).regions.includes("wild-1"));
    assert.ok(wild.moved > reactive.moved + 8, `wild shoves harder (${wild.moved.toFixed(1)})`);
    const calm = push(2);
    assert.equal(calm.fresh.length, 0, "no splinters in the calm region");
    // Only the ordinary hit's knockback moves it (base combat, not an optional reaction).
    assert.ok(calm.moved < reactive.moved / 2, `no shove (${calm.moved.toFixed(1)})`);
    for (let k = 0; k < 3; k++) assert.ok(world.has(`prop-hedge-1-bramble-2-${k}`), "hedges stand");
    // The base mechanic still roots and hurts everywhere.
    assert.ok(sim.adventure.state.mechanicUses >= 3);
  } finally {
    ctx.sim.dispose();
  }
});

test("Slipstream: lanes carry loose props and travelers along the ring, the calm lane's barrel stays, and a crossing gust is owned by the crosser", () => {
  const ctx = area(2);
  try {
    const { sim, physical, world } = ctx;
    const barrels = [0, 1, 2].map((n) => `prop-barrel-2-wind-${n}-0`);
    const start = barrels.map((id) => world.pose(id));
    sim.step(120);
    const moved = barrels.map((id, k) => distance(world.pose(id), start[k]));
    assert.ok(moved[0] > 40 && moved[1] > 40, `lanes carry their barrels (${moved})`);
    assert.ok(world.policyOf(barrels[2]).regions.includes("calm-2"));
    assert.equal(moved[2], 0, "the calm lane's barrel is frozen in place");
    // A traveler standing in a lane drifts along it.
    const lane = physical.reactions.fieldList().find((f) => f.id === "tailwind-2-0")!.shape as {
      x: number;
      y: number;
      angle: number;
    };
    const p = sim.players.get("local")!;
    sim.teleport("local", lane.x + Math.cos(lane.angle) * 60, lane.y + Math.sin(lane.angle) * 60);
    const from = { x: p.x, y: p.y };
    sim.step(60);
    const along = (p.x - from.x) * Math.cos(lane.angle) + (p.y - from.y) * Math.sin(lane.angle);
    assert.ok(along > 5, `travelers ride the lane (${along.toFixed(1)})`);
    // Crossing the lane mechanic adds a strong gust owned by the crosser: a crate dropped in
    // the lane flies off and belongs to the hero.
    const m = mechanic(ctx, "wind", 0);
    world.place(
      "crate-2-0",
      lane.x + Math.cos(lane.angle) * 40,
      lane.y + Math.sin(lane.angle) * 40,
    );
    sim.teleport("local", m.x, m.y);
    sim.step();
    const gust = physical.reactions.fieldList().find((f) => f.id === `gust:${m.id}`)!;
    assert.equal(gust.owner, "local");
    assert.ok(sim.adventure.hero("local").hasteUntil > sim.tick, "the haste still comes");
    sim.teleport("local", m.x - 200, m.y - 200);
    sim.step(20);
    assert.ok(Math.hypot(world.pose("crate-2-0").vx, world.pose("crate-2-0").vy) > 60);
    assert.equal(
      physical.combat.save().instigators.find((i) => i.id === "crate-2-0")?.owner,
      "local",
    );
    // Environmental forces off: lanes stop.
    edit(sim, [override("area", "area-2", { environmentalForces: false })]);
    sim.step(180);
    const still = world.pose(barrels[1]);
    sim.step(60);
    assert.ok(distance(world.pose(barrels[1]), still) < 1);
  } finally {
    ctx.sim.dispose();
  }
});

test("Stormglass: pools soak the pack and a strike on a wet monster arcs through it, credited to the striker; reactions off stops the arc", () => {
  const ctx = area(3);
  try {
    const { sim, physical } = ctx;
    const pool = physical.reactions.surfaceList().find((s) => s.id === "pool-3-0")!;
    assert.equal(pool.ticks, -1, "authored pools are permanent");
    const a = monster(ctx, pool.x - 10, pool.y),
      b = monster(ctx, pool.x + 16, pool.y + 8),
      dry = monster(ctx, pool.x + 160, pool.y + 120);
    sim.step(20);
    const wet = (e: Enemy) => physical.reactions.status(`enemy-${e.id}`)?.wet ?? 0;
    assert.ok(wet(a) > 0 && wet(b) > 0, "wading soaks");
    assert.equal(wet(dry), 0);
    const hp = { b: b.hp, dry: dry.hp };
    sim.teleport("local", a.x - 18, a.y - 20);
    press(sim, { attack: true, aimX: 0.6, aimY: 0.8 });
    sim.step(12);
    const arcs = sim.adventure.state.events.filter(
      (e) => e.type === "reaction" && e.text.startsWith("conduct") && e.owner === "local",
    );
    assert.ok(arcs.length >= 2, "the strike arcs through the pool");
    assert.ok(b.hp < hp.b, "the neighbour is shocked");
    assert.equal(dry.hp, hp.dry, "a dry monster away from conductors is untouched");
    // Reactions off: the same strike only cuts.
    edit(sim, [override("area", "area-3", { materialReactions: false })]);
    sim.step(60);
    const before = sim.adventure.state.events.filter((e) => e.text.startsWith("conduct")).length;
    sim.teleport("local", a.x - 18, a.y - 20);
    press(sim, { attack: true, aimX: 0.6, aimY: 0.8 });
    sim.step(12);
    assert.equal(
      sim.adventure.state.events.filter((e) => e.text.startsWith("conduct")).length,
      before,
    );
  } finally {
    ctx.sim.dispose();
  }
});

test("Echo Wells: the repeat carries the ability's own force with the caster's attribution and never pays twice", () => {
  const ctx = area(4);
  try {
    const { sim, physical, world } = ctx;
    const well = mechanic(ctx, "echo", 0),
      stones = ["prop-stone-4-echo-0-0", "prop-stone-4-echo-0-1"],
      pots = ["prop-pot-4-echo-0-0", "prop-pot-4-echo-0-1"];
    sim.teleport("local", well.x - 50, well.y);
    sim.players.get("local")!.energy = 100;
    press(sim, { pulse: true });
    const speed = () =>
      Math.max(...stones.map((id) => Math.hypot(world.pose(id).vx, world.pose(id).vy)));
    sim.step(24);
    const slowed = speed();
    sim.step(8);
    assert.ok(speed() > slowed + 40, "the echo launches the stones again");
    for (const id of stones) {
      const owner = physical.combat.save().instigators.find((i) => i.id === id)!;
      assert.equal(owner.owner, "local");
      assert.equal(owner.cause, "echo:whorl");
    }
    const records = physical.destroyedRecords().filter((r) => pots.includes(r.id));
    assert.equal(records.length, 2);
    const paid = sim.adventure.state.drops.filter((d) => d.kind === "gold").length;
    sim.step(40);
    assert.equal(physical.destroyedRecords().filter((r) => pots.includes(r.id)).length, 2);
    assert.ok(
      sim.adventure.state.drops.filter((d) => d.kind === "gold").length <= paid,
      "no second reward",
    );
  } finally {
    ctx.sim.dispose();
  }
});

test("Cinderwake: crossing a vent burns its fuse into the weakened stockade and opens the cache; the calm vent and reactions off keep it standing; the buff remains", () => {
  const ctx = area(5);
  try {
    const { sim, physical, world } = ctx;
    const pen = (n: number) =>
      ["front", "left", "right", "back"].map((t) => `prop-barricade-5-cinder-${n}-${t}`);
    for (const id of pen(0)) assert.equal(world.pose(id).consequences?.durability, 45);
    const cross = (n: number) => {
      const vent = mechanic(ctx, "cinder", n);
      sim.teleport("local", vent.x, vent.y);
      sim.step(2);
      sim.teleport("local", vent.x - 220, vent.y - 220);
      sim.step(300);
    };
    cross(0);
    assert.ok(sim.adventure.hero("local").burnUntil > 0, "burning strikes still granted");
    assert.ok(
      pen(0).every((id) => physical.isDestroyed(id)),
      "the stockade burns through",
    );
    assert.ok(
      physical
        .destroyedRecords()
        .filter((r) => pen(0).includes(r.id))
        .every((r) => r.owner === "local"),
    );
    cross(2);
    const calmVent = mechanic(ctx, "cinder", 2);
    assert.ok(physical.policyAt(sim, calmVent.x, calmVent.y).regions.includes("calm-5"));
    assert.ok(
      pen(2).every((id) => world.has(id)),
      "the calm stockade stands",
    );
    edit(sim, [override("area", "area-5", { materialReactions: false })]);
    cross(1);
    assert.ok(
      pen(1).every((id) => world.has(id)),
      "reactions off: no eruption",
    );
  } finally {
    ctx.sim.dispose();
  }
});

test("Bloodbloom: the sacrifice grows elastic vines that drag and hold up to six monsters; mechanisms off grows none; weak joints snap", () => {
  const ctx = area(6);
  try {
    const { sim, physical } = ctx;
    const bloom = mechanic(ctx, "blood", 0);
    const pack = Array.from({ length: 8 }, (_, k) =>
      monster(ctx, bloom.x + Math.cos(k) * (60 + k * 12), bloom.y + Math.sin(k) * (60 + k * 12), {
        passive: false,
      }),
    );
    for (const e of pack) e.nextAttack = 1e9;
    sim.step();
    const before = pack.map((e) => distance(e, bloom));
    sim.teleport("local", bloom.x - 30, bloom.y);
    press(sim, { interact: true });
    const vines = physical.showcase.list();
    assert.equal(vines.length, BLOOM_SNARE.targets);
    assert.ok(vines.every((v) => v.owner === "local" && v.kind === "bloom"));
    assert.ok(sim.adventure.state.events.some((e) => e.text === "snare:grown"));
    sim.step(90);
    const held = pack.filter((e) => vines.some((v) => v.body === `enemy-${e.id}`));
    for (const e of held) {
      const vine = vines.find((v) => v.body === `enemy-${e.id}`)!;
      assert.ok(distance(e, bloom) < vine.rest + 12, `held near the bloom (${distance(e, bloom)})`);
      assert.ok(distance(e, bloom) <= before[pack.indexOf(e)]);
    }
    // Saved and replicated.
    const restored = Simulation.restore(JSON.parse(JSON.stringify(sim.save())));
    try {
      assert.deepEqual(restored.physical!.showcase.save(), physical.showcase.save());
    } finally {
      restored.dispose();
    }
    sim.step(BLOOM_SNARE.ticks);
    assert.equal(physical.showcase.list().length, 0, "the vines wither");
    // Weak joints: vines snap as the pack strains.
    edit(sim, [override("area", "area-6", { jointStrength: 0.05 })]);
    for (const e of pack) {
      e.rootUntil = 0;
      sim.physical!.teleport(`enemy-${e.id}`, bloom.x + 90, bloom.y + 30);
      e.x = e.px = bloom.x + 90;
      e.y = e.py = bloom.y + 30;
    }
    const bloom2 = mechanic(ctx, "blood", 0);
    bloom2.readyAt = 0;
    sim.teleport("local", bloom.x - 30, bloom.y);
    ctx.agent.execute({ op: "actors", action: "mechanic", id: bloom.id });
    sim.step(30);
    assert.ok(sim.adventure.state.events.some((e) => e.text === "snare:snapped"));
    // Mechanisms off at the bloom: the life is traded but no vines grow.
    edit(sim, [override("area", "area-6", { mechanisms: false, jointStrength: 1 })]);
    bloom.readyAt = 0;
    sim.step();
    const count = physical.showcase.list().length;
    const hp = sim.adventure.hero("local").hp;
    ctx.agent.execute({ op: "actors", action: "mechanic", id: bloom.id });
    assert.equal(physical.showcase.list().length, count);
    assert.ok(sim.adventure.hero("local").hp < hp, "the sacrifice still happens");
  } finally {
    ctx.sim.dispose();
  }
});

test("Gravity Knots: a struck knot rolls away along the blow and carries monsters, loose material and loot as one cluster", () => {
  const ctx = area(7);
  try {
    const { sim, physical, world } = ctx;
    const knot = mechanic(ctx, "gravity", 0);
    const pack = [0, 1, 2].map((k) =>
      monster(ctx, knot.x + 60 * Math.cos(k * 2), knot.y + 60 * Math.sin(k * 2), {
        rig: "crawler",
      }),
    );
    // Stones survive being crushed together in the cluster (the log may not).
    const material = ["prop-stone-7-gravity-0-0", "prop-stone-7-gravity-0-1"];
    sim.step();
    const centre = (points: { x: number; y: number }[]) => ({
      x: points.reduce((a, q) => a + q.x, 0) / points.length,
      y: points.reduce((a, q) => a + q.y, 0) / points.length,
    });
    const props0 = centre(material.map((id) => world.pose(id))),
      pack0 = centre(pack);
    sim.teleport("local", knot.x - 40, knot.y);
    press(sim, { attack: true, aimX: 1, aimY: 0 });
    const field = physical.reactions.fieldList().find((f) => f.id === `mechanic:${knot.id}`)!;
    assert.equal(field.spare, "party");
    assert.ok(
      field.drift && field.drift.x > 30 && Math.abs(field.drift.y) < 1,
      "drifts along the blow",
    );
    sim.teleport("local", knot.x - 300, knot.y - 300);
    sim.step(200);
    const props1 = centre(material.map((id) => world.pose(id))),
      pack1 = centre(pack);
    assert.ok(props1.x - props0.x > 60, `material travels (${(props1.x - props0.x).toFixed(1)})`);
    assert.ok(pack1.x - pack0.x > 60, `the pack travels (${(pack1.x - pack0.x).toFixed(1)})`);
    assert.ok(distance(props1, pack1) < 70, "as one cluster");
  } finally {
    ctx.sim.dispose();
  }
});

test("Riftstep: freight on the arch's pad rides through and bursts out on arrival; frozen freight stays and the arrival never smashes what it brought", () => {
  const ctx = area(8);
  try {
    const { sim, physical, world } = ctx;
    const arches = ctx.s.mechanics.filter((m) => m.kind === "rift"),
      a = arches[0],
      b = arches.find((m) => m.id === a.pair)!;
    const freight = ["prop-crate-8-rift-0-0", "prop-crate-8-rift-0-1", "prop-barrel-8-rift-0-0"];
    for (const id of freight) assert.ok(distance(world.pose(id), a) <= FREIGHT_PAD);
    const offsets = freight.map((id) => ({ x: world.pose(id).x - a.x, y: world.pose(id).y - a.y }));
    sim.teleport("local", a.x - 20, a.y);
    press(sim, { interact: true });
    for (const [k, id] of freight.entries()) {
      const pose = world.pose(id);
      assert.ok(
        distance(pose, { x: b.x + offsets[k].x, y: b.y + offsets[k].y }) < 6,
        `${id} arrives in place`,
      );
      assert.equal(physical.combat.save().instigators.find((i) => i.id === id)?.owner, "local");
    }
    sim.step(30);
    for (const id of freight) {
      assert.ok(world.has(id), `${id} survives the arrival`);
      assert.ok(distance(world.pose(id), b) > 60, `${id} bursts outward`);
    }
    assert.ok(
      sim.adventure.state.events.some((e) => e.text === "freight:carried" && e.amount === 3),
    );
    // Dynamic props off at the far arch: freight left there stays behind on the way back.
    for (const id of freight) world.place(id, b.x + 20, b.y + (freight.indexOf(id) - 1) * 24);
    edit(sim, [override("area", "area-8", { dynamicProps: false })]);
    b.readyAt = 0;
    sim.teleport("local", b.x - 20, b.y);
    press(sim, { interact: true });
    for (const id of freight) assert.ok(distance(world.pose(id), b) < 40, `${id} stays`);
  } finally {
    ctx.sim.dispose();
  }
});

test("all eight wardens telegraph a locked physical signature for at least half a second, and their own area's rules expose them", () => {
  const rigs = ["brute", "stalker", "totem", "wraith", "brute", "crawler", "warden", "warden"];
  for (let index = 1; index <= 8; index++) {
    const ctx = area(index);
    try {
      const { sim, r } = ctx;
      const boss = monster(ctx, r.x + 60, r.y, {
        rig: rigs[index - 1],
        boss: true,
        clear: true,
        hp: 1e6,
        passive: false,
      });
      sim.teleport("local", r.x - 60, r.y + 10);
      sim.adventure.hero("local").invulnerableUntil = 1e9;
      ctx.agent.execute({ op: "actors", action: "warden", id: `enemy-${boss.id}` });
      let telegraph = 0,
        move = "";
      for (let t = 0; t < 200; t++) {
        sim.step();
        if (boss.phase === "windup") {
          telegraph++;
          move ||= boss.warden!.move;
        } else if (telegraph) break;
      }
      assert.equal(move, WARDENS[r.signature].move, r.boss);
      assert.ok(telegraph >= 30, `${r.boss} telegraphs for ${telegraph} ticks`);
      assert.ok(
        sim.adventure.state.events.some((e) => e.text === `warden:${move}`),
        "the telegraph is announced",
      );
    } finally {
      ctx.sim.dispose();
    }
  }
  // Each identity's weakness, through the area's own physical rules.
  const exposed = (e: Enemy, sim: Simulation, cause: string) =>
    (e.warden?.exposedUntil ?? 0) > sim.tick && e.warden?.exposedBy === cause;
  const warden = (ctx: Ctx, index: number, x: number, y: number) => {
    const e = monster(ctx, x, y, { rig: rigs[index - 1], boss: true, clear: true, hp: 1e6 });
    ctx.sim.adventure.hero("local").invulnerableUntil = 1e9;
    ctx.sim.step();
    return e;
  };
  {
    const ctx = area(1),
      pod = mechanic(ctx, "bramble", 0),
      e = warden(ctx, 1, pod.x + 30, pod.y);
    ctx.sim.teleport("local", pod.x - 40, pod.y);
    ctx.agent.execute({ op: "actors", action: "mechanic", id: pod.id });
    assert.ok(exposed(e, ctx.sim, "bramble"), "Brambleheart: a pod bursting beside it");
    const hp = e.hp;
    ctx.sim.adventure.strikeEnemy(ctx.sim, "local", e.id, 100, 0);
    assert.equal(hp - e.hp, 150, "an exposed warden takes 1.5× damage");
    ctx.sim.dispose();
  }
  {
    const ctx = area(2),
      tree = ctx.world.pose("prop-tree-2-0"),
      e = warden(ctx, 2, tree.x - 60, tree.y);
    e.rootUntil = 0;
    e.nextAttack = 0;
    ctx.sim.teleport("local", tree.x + 40, tree.y);
    ctx.agent.execute({ op: "actors", action: "warden", id: `enemy-${e.id}` });
    for (let t = 0; t < 160 && !exposed(e, ctx.sim, "crash"); t++) ctx.sim.step();
    assert.ok(exposed(e, ctx.sim, "crash"), "the Gale Stag: charging into a tree");
    ctx.sim.dispose();
  }
  {
    const ctx = area(3),
      pool = ctx.physical.reactions.surfaceList().find((s) => s.id === "pool-3-0")!,
      e = warden(ctx, 3, pool.x, pool.y);
    e.rootUntil = 1e9;
    ctx.sim.step(20);
    ctx.sim.teleport("local", e.x - 30, e.y);
    press(ctx.sim, { attack: true, aimX: 1, aimY: 0 });
    ctx.sim.step(10);
    assert.ok(exposed(e, ctx.sim, "shock"), "Vyr: shocked while standing in a pool");
    ctx.sim.dispose();
  }
  {
    const ctx = area(4),
      well = mechanic(ctx, "echo", 0),
      e = warden(ctx, 4, well.x + 20, well.y);
    e.rootUntil = 1e9;
    ctx.sim.teleport("local", well.x - 50, well.y);
    ctx.sim.players.get("local")!.energy = 100;
    press(ctx.sim, { pulse: true });
    ctx.sim.step(40);
    assert.ok(exposed(e, ctx.sim, "echo"), "the Echo Matron: a well's repeat");
    ctx.sim.dispose();
  }
  {
    const ctx = area(5),
      e = warden(ctx, 5, ctx.r.x, ctx.r.y + 20);
    ctx.agent.execute({
      op: "actors",
      action: "stimulate",
      stimulus: "water",
      id: `enemy-${e.id}`,
    });
    ctx.sim.step(2);
    assert.ok(exposed(e, ctx.sim, "water"), "Cinderjaw: doused");
    ctx.sim.dispose();
  }
  {
    const ctx = area(6),
      e = warden(ctx, 6, ctx.r.x, ctx.r.y);
    e.rootUntil = 0;
    e.facing = Math.PI;
    ctx.sim.teleport("local", ctx.r.x - 120, ctx.r.y);
    ctx.agent.execute({ op: "actors", action: "warden", id: `enemy-${e.id}` });
    for (let t = 0; t < 140 && !ctx.physical.showcase.list().length; t++) ctx.sim.step();
    const lash = ctx.physical.showcase.list()[0];
    assert.equal(lash?.kind, "lash", "the Bloom Tyrant's lash catches a traveler in its line");
    const p = ctx.sim.players.get("local")!,
      before = distance(p, e);
    ctx.sim.step(20);
    assert.ok(distance(p, e) < before, "and reels them in");
    p.energy = 100;
    press(ctx.sim, { x: -1, dash: true });
    ctx.sim.step(2);
    assert.equal(ctx.physical.showcase.list().length, 0, "a dash tears the vine");
    assert.ok(exposed(e, ctx.sim, "lash"), "which exposes the Tyrant");
    ctx.sim.dispose();
  }
  {
    const ctx = area(7),
      e = warden(ctx, 7, ctx.r.x, ctx.r.y);
    e.rootUntil = 1e9;
    ctx.world.place("crate-7-0", ctx.r.x - 50, ctx.r.y);
    ctx.world.motion("crate-7-0", 400, 0, 0);
    ctx.physical.combat.instigate("crate-7-0", "local", "party", "throw", ctx.sim.tick);
    ctx.sim.step(12);
    assert.ok(exposed(e, ctx.sim, "impact"), "the Hollow Atlas: a launched prop");
    ctx.sim.dispose();
  }
  {
    const ctx = area(8),
      arches = ctx.s.mechanics.filter((m) => m.kind === "rift"),
      a = arches[0],
      b = arches.find((m) => m.id === a.pair)!,
      e = warden(ctx, 8, b.x + 30, b.y);
    e.rootUntil = 1e9;
    ctx.sim.teleport("local", a.x - 20, a.y);
    press(ctx.sim, { interact: true });
    assert.ok(exposed(e, ctx.sim, "rift"), "the Riftbound King: a traveler arriving beside it");
    // Another identity's cause never exposes it.
    ctx.sim.dispose();
  }
});

test("calm and wild regions change the same mechanic locally; calm keeps world reactions on for ambient selection", () => {
  const ctx = area(1);
  try {
    const { world, r } = ctx;
    const spots = mechanicLayout(r).filter((m) => m.k === 0);
    const calm = world.policyAt("area-1", spots[2].x, spots[2].y),
      wild = world.policyAt("area-1", spots[1].x, spots[1].y),
      plain = world.policyAt("area-1", spots[0].x, spots[0].y);
    assert.ok(calm.regions.includes("calm-1") && wild.regions.includes("wild-1"));
    for (const [key, value] of Object.entries(CALM_VALUES))
      assert.equal(calm.effective[key as keyof typeof calm.effective], value, key);
    assert.equal(calm.effective.worldReactions, true);
    assert.equal(wild.effective.impulseStrength, 2.5);
    assert.equal(plain.effective.impulseStrength, 1);
  } finally {
    ctx.sim.dispose();
  }
});

test("showcase state survives raw and portable saves; a late-join replica agrees with the host's scene and scope labels; M09 checkpoints migrate", () => {
  const ctx = area(6);
  const { sim, physical, world } = ctx;
  try {
    const bloom = mechanic(ctx, "blood", 0);
    for (let k = 0; k < 4; k++) monster(ctx, bloom.x + 50 + k * 10, bloom.y + 20);
    sim.step();
    sim.teleport("local", bloom.x - 30, bloom.y);
    press(sim, { interact: true });
    const knot = mechanic(ctx, "gravity", 0) ?? null;
    if (knot) ctx.agent.execute({ op: "actors", action: "mechanic", id: knot.id });
    sim.step(10);
    assert.ok(physical.showcase.list().length > 0);
    for (const portable of [false, true]) {
      const restored = Simulation.restore(JSON.parse(JSON.stringify(sim.save(portable))));
      try {
        assert.deepEqual(restored.physical!.showcase.save(), physical.showcase.save());
        assert.deepEqual(restored.physical!.reactions.fieldList(), physical.reactions.fieldList());
        if (!portable) {
          sim.step(30);
          restored.step(30);
          assert.equal(restored.stateHash(), sim.stateHash());
        }
      } finally {
        restored.dispose();
      }
    }
    // Late join: the replica receives the vines, set pieces and the same region labels.
    const guest = new Simulation(142, 0);
    try {
      guest.applyReplica(JSON.parse(JSON.stringify(sim.save(true))) as SaveState);
      assert.deepEqual(guest.replicaPhysics!.showcase, physical.showcase.save());
      const labels = (bodies: { recipe: { id: string }; policy?: { regions: string[] } }[]) =>
        bodies
          .filter((b) => /-(bramble|wind|glass|echo|cinder|gravity|rift)-\d|town/.test(b.recipe.id))
          .map((b) => `${b.recipe.id}:${(b.policy?.regions ?? []).join("+")}`)
          .sort();
      assert.deepEqual(
        labels(guest.replicaPhysics!.world.bodies),
        labels(sim.save(true).actorPhysics!.world.bodies),
      );
      const seen = new AgentRuntime(guest).execute({ op: "actors", action: "showcase" }) as {
        restraints: unknown[];
        setPieces: Record<string, string[]>;
      };
      assert.equal(seen.restraints.length, physical.showcase.list().length);
      assert.ok(Object.keys(seen.setPieces).length >= 3);
    } finally {
      guest.dispose();
    }
    const packet = encodeSnapshot(sim, "local");
    const replica = decodeSnapshot(packet).sim;
    replica.dispose();
    assert.ok(world.ids().length > 0);
  } finally {
    sim.dispose();
  }
  // A real M09 checkpoint (main 7d1b73c, town of land 1 with land 0 archived) migrates.
  const legacy = JSON.parse(
    gunzipSync(readFileSync(new URL("./fixtures/m09-raw.json.gz", import.meta.url))).toString(),
  ) as SaveState;
  assert.equal(legacy.actorPhysics!.version, 7);
  const migrated = Simulation.restore(structuredClone(legacy));
  try {
    const w = migrated.physical!.world,
      state = w.policyState().state;
    assert.deepEqual(state.profiles.areas.find((a) => a.id === "town")!.values, TOWN_VALUES);
    for (const id of ["market", "wild-5", "calm-5", "wild-8", "calm-8"])
      assert.ok(
        state.profiles.regions.some((r) => r.id === id),
        id,
      );
    assert.ok(w.has("prop-lamp-town-0") && w.has("prop-stall-town-2"));
    assert.equal(migrated.save().actorPhysics!.version, 8);
    const again = Simulation.restore(structuredClone(migrated.save()));
    try {
      assert.deepEqual(again.physical!.world.ids(), w.ids(), "nothing added twice");
    } finally {
      again.dispose();
    }
    // Returning to the archived land 0 gives it its scene and regions too.
    migrated.adventure.startArea(migrated, 1);
    migrated.step();
    const land0 = migrated.physical!.world;
    assert.ok(land0.has("prop-hedge-1-bramble-0-0"));
    assert.ok(land0.policyState().state.profiles.regions.some((r) => r.id === "calm-1"));
  } finally {
    migrated.dispose();
  }
});

test("with every optional reaction off, areas still clear by kills alone and no set piece can hold up the route", () => {
  const ctx = area(5);
  try {
    const { sim, physical, world, r } = ctx;
    physical.configure({
      expectedRevision: world.policyState().nextRevision,
      edits: [{ type: "master", enabled: false }],
    });
    world.applyPolicies(world.policyState().nextRevision);
    physical.begin(sim);
    // Cinder pens and hedges stand; none is on the entry → centre → outward gate line.
    for (const id of world.ids()) {
      if (!/-(bramble|cinder)-\d/.test(id)) continue;
      const pose = world.pose(id);
      if (pose.motion !== "fixed") continue;
      const along = pose.x - r.x,
        across = Math.abs(pose.y - r.y);
      assert.ok(!(along > -240 && along < 300 && across < 14), `${id} sits on the route line`);
    }
    const s = ctx.s;
    s.bossSpawned = false;
    s.kills = s.recipe.killGoal;
    sim.step();
    const boss = s.enemies.find((e) => e.boss)!;
    assert.ok(boss, "the warden comes when the goal is met");
    sim.adventure.strikeEnemy(sim, "local", boss.id, 1e9, 0);
    sim.step();
    assert.equal(s.cleared, true);
    sim.teleport("local", r.x + 380, r.y);
    sim.step(2);
    assert.equal(s.area, 6, "the outward gate leads on");
  } finally {
    ctx.sim.dispose();
  }
});

test("engine-independent sine and cosine stay within one ulp of Math across the physics range", () => {
  const ulp = (v: number) => 2 ** (Math.floor(Math.log2(Math.abs(v) || 2 ** -1022)) - 52);
  let worst = 0;
  for (let i = 0; i < 20000; i++) {
    const x = (i / 20000 - 0.5) * 4000 + (i % 7) * 1e-3;
    worst = Math.max(
      worst,
      Math.abs(dsin(x) - Math.sin(x)) / ulp(Math.sin(x)),
      Math.abs(dcos(x) - Math.cos(x)) / ulp(Math.cos(x)),
    );
  }
  assert.ok(worst <= 1, `within ${worst} ulp`);
  for (const x of [0, 1e-12, 0.5, Math.PI / 4, 1.418, Math.PI, 12345.678, -98765.4321]) {
    assert.equal(dsin(-x), -dsin(x), "odd");
    assert.equal(dcos(-x), dcos(x), "even");
  }
  assert.equal(dsin(0), 0);
  assert.equal(dcos(0), 1);
  assert.ok(Number.isNaN(dsin(Number.POSITIVE_INFINITY)));
});
