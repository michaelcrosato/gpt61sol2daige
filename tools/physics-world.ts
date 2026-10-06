// M10 acceptance receipt: `node tools/physics-world.ts > docs/evidence/physics-m10.json`.
// Every number is measured from the headless simulation (seed 142): the town, each authored
// area's physical extension (reactive, wild and calm instances) and every warden's signature.
import { AgentRuntime } from "../src/engine/agent.ts";
import { Simulation } from "../src/engine/simulation.ts";
import type { Enemy } from "../src/game/types.ts";
import { EXPOSED, WARDEN_WINDUP, WARDENS } from "../src/game/wardens.ts";
import { initializePhysics } from "../src/physics/bootstrap.ts";
import { SHOWCASE } from "../src/physics/showcase.ts";

await initializePhysics();
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);
const RIGS = ["brute", "stalker", "totem", "wraith", "brute", "crawler", "warden", "warden"];

function area(index: number) {
  const sim = new Simulation(142, 0);
  sim.addPlayer("local");
  sim.adventure.startArea(sim, index);
  const s = sim.adventure.state;
  s.enemies = [];
  s.spawned = s.recipe.killGoal;
  s.bossSpawned = true;
  sim.step();
  return { sim, s, r: s.recipe, agent: new AgentRuntime(sim), physical: sim.physical! };
}
type Ctx = ReturnType<typeof area>;
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
const mechanic = (ctx: Ctx, kind: string, n = 0) =>
  ctx.s.mechanics.filter((m) => m.kind === kind)[n];
function press(sim: Simulation, input: Record<string, unknown>) {
  sim.setInput("local", input);
  sim.step();
  sim.setInput("local", {});
}
const regionOf = (ctx: Ctx, x: number, y: number) =>
  ctx.physical
    .policyAt(ctx.sim, x, y)
    .regions.filter((id) => /^(calm|wild)-/.test(id))
    .join("") || "plain";
const setPieces = (ctx: Ctx) =>
  ctx.physical.world
    .ids()
    .filter((id) => new RegExp(`^prop-[a-z]+-${ctx.r.index}-[a-z]+-\\d`).test(id)).length;

// Town: fixtures, a slash on a lamp, the bunting's flutter, nothing breaks, services clear.
const town = (() => {
  const sim = new Simulation(142, 0);
  sim.addPlayer("local");
  sim.step();
  const world = sim.physical!.world,
    kinds: Record<string, number> = {};
  for (const a of world.assemblyList().filter((a) => a.areaId === "town"))
    kinds[a.kind] = (kinds[a.kind] ?? 0) + 1;
  const loose = world.ids().filter((id) => /^prop-(crate|basket|barrel|pot)-town-/.test(id));
  const post = world.pose("prop-post-town-lamp1"),
    rest = world.pose("prop-lamp-town-1").angle;
  sim.teleport("local", post.x + 10, post.y - 22);
  press(sim, { attack: true, aimX: 0, aimY: 1 });
  let swing = 0;
  for (let t = 0; t < 90; t++) {
    sim.step();
    swing = Math.max(swing, Math.abs(world.pose("prop-lamp-town-1").angle - rest));
  }
  sim.step(300);
  const settled = Math.abs(world.pose("prop-lamp-town-1").angle - rest);
  let flutter = 0,
    last = world.pose("prop-pennant-town-5");
  for (let t = 0; t < 120; t++) {
    sim.step();
    flutter += distance(world.pose("prop-pennant-town-5"), last);
    last = world.pose("prop-pennant-town-5");
  }
  for (const id of loose) sim.adventure.strikeProp(sim, "local", id, 500);
  const result = {
    policy: "Sanctuary values; market region keeps prop blocking",
    assemblies: kinds,
    looseGoods: loose.length,
    lampSwingRad: round(swing),
    lampSettledRad: round(settled, 3),
    pennantTravel120Ticks: round(flutter, 1),
    destroyedAfterHardStrikes: sim.physical!.destroyedRecords().length,
    serviceFields: sim
      .physical!.reactions.fieldList()
      .filter((f) => f.id.startsWith("sanctuary-"))
      .map((f) => f.id),
  };
  sim.dispose();
  return result;
})();

// Each area's extension, measured on the reactive (n=0), wild (n=1) and calm (n=2) instance
// where the effect is a count or a distance.
const areas: Record<string, unknown>[] = [];
for (let index = 1; index <= 8; index++) {
  const ctx = area(index),
    { sim, physical, r } = ctx,
    world = physical.world;
  const kind = r.signature,
    entry: Record<string, unknown> = {
      area: index,
      name: r.name,
      mechanic: kind,
      extension: SHOWCASE[kind].name,
      setPieces: setPieces(ctx),
      regions: [0, 1, 2].map((n) =>
        regionOf(ctx, mechanic(ctx, kind, n).x, mechanic(ctx, kind, n).y),
      ),
    };
  if (kind === "bramble") {
    const burst = (n: number) => {
      const pod = mechanic(ctx, "bramble", n),
        e = monster(ctx, pod.x - 30, pod.y + 10);
      sim.step();
      const before = distance(e, pod),
        thorns = new Set(world.ids().filter((id) => id.startsWith("prop-thorn-")));
      sim.teleport("local", pod.x - 60, pod.y - 40);
      ctx.agent.execute({ op: "actors", action: "mechanic", id: pod.id });
      const fresh = world.ids().filter((id) => id.startsWith("prop-thorn-") && !thorns.has(id));
      sim.step(20);
      const shove = round(distance(e, pod) - before, 1);
      ctx.s.enemies = [];
      sim.step();
      const hedges = [0, 1, 2].filter((k) =>
        physical.isDestroyed(`prop-hedge-1-bramble-${n}-${k}`),
      );
      return { splinters: fresh.length, shove, hedgesOpened: hedges.length };
    };
    entry.measured = { reactive: burst(0), wild: burst(1), calm: burst(2) };
  } else if (kind === "wind") {
    const barrels = [0, 1, 2].map((n) => `prop-barrel-2-wind-${n}-0`),
      start = barrels.map((id) => world.pose(id));
    sim.step(120);
    entry.measured = {
      barrelTravel120Ticks: barrels.map((id, k) => round(distance(world.pose(id), start[k]), 1)),
    };
  } else if (kind === "glass") {
    const pool = physical.reactions.surfaceList().find((s) => s.id === "pool-3-0")!;
    const a = monster(ctx, pool.x - 10, pool.y),
      b = monster(ctx, pool.x + 16, pool.y + 8);
    sim.step(20);
    const hp = b.hp;
    sim.teleport("local", a.x - 18, a.y - 20);
    press(sim, { attack: true, aimX: 0.6, aimY: 0.8 });
    sim.step(12);
    entry.measured = {
      poolTicks: pool.ticks,
      arcs: ctx.s.events.filter((e) => e.text.startsWith("conduct") && e.owner === "local").length,
      neighbourDamage: round(hp - b.hp, 1),
    };
  } else if (kind === "echo") {
    const well = mechanic(ctx, "echo", 0),
      stones = ["prop-stone-4-echo-0-0", "prop-stone-4-echo-0-1"];
    sim.teleport("local", well.x - 50, well.y);
    sim.players.get("local")!.energy = 100;
    press(sim, { pulse: true });
    const speed = () =>
      Math.max(...stones.map((id) => Math.hypot(world.pose(id).vx, world.pose(id).vy)));
    sim.step(24);
    const before = speed();
    sim.step(8);
    const after = speed(),
      paid = ctx.s.drops.filter((d) => d.kind === "gold").length;
    sim.step(40);
    entry.measured = {
      stoneSpeedBeforeEcho: round(before, 1),
      stoneSpeedAfterEcho: round(after, 1),
      cause: physical.combat.save().instigators.find((i) => i.id === stones[0])?.cause,
      extraGoldDrops: ctx.s.drops.filter((d) => d.kind === "gold").length - paid,
    };
  } else if (kind === "cinder") {
    const pen = (n: number) =>
      ["front", "left", "right", "back"].map((t) => `prop-barricade-5-cinder-${n}-${t}`);
    const cross = (n: number) => {
      const vent = mechanic(ctx, "cinder", n);
      sim.teleport("local", vent.x, vent.y);
      sim.step(2);
      sim.teleport("local", vent.x - 220, vent.y - 220);
      sim.step(300);
      return pen(n).filter((id) => physical.isDestroyed(id)).length;
    };
    entry.measured = { boardsBurntReactive: cross(0), boardsBurntCalm: cross(2) };
  } else if (kind === "blood") {
    const bloom = mechanic(ctx, "blood", 0),
      pack = Array.from({ length: 8 }, (_, k) =>
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
    sim.step(90);
    const held = pack.filter((e) => vines.some((v) => v.body === `enemy-${e.id}`));
    entry.measured = {
      vines: vines.length,
      pulledIn: held.map((e) => round(before[pack.indexOf(e)] - distance(e, bloom), 1)),
    };
  } else if (kind === "gravity") {
    const knot = mechanic(ctx, "gravity", 0),
      pack = [0, 1, 2].map((k) =>
        monster(ctx, knot.x + 60 * Math.cos(k * 2), knot.y + 60 * Math.sin(k * 2), {
          rig: "crawler",
        }),
      ),
      material = ["prop-stone-7-gravity-0-0", "prop-stone-7-gravity-0-1"];
    sim.step();
    const centre = (points: { x: number; y: number }[]) => ({
      x: points.reduce((a, q) => a + q.x, 0) / points.length,
      y: points.reduce((a, q) => a + q.y, 0) / points.length,
    });
    const props0 = centre(material.map((id) => world.pose(id))),
      pack0 = centre(pack);
    sim.teleport("local", knot.x - 40, knot.y);
    press(sim, { attack: true, aimX: 1, aimY: 0 });
    sim.teleport("local", knot.x - 300, knot.y - 300);
    sim.step(200);
    const props1 = centre(material.map((id) => world.pose(id))),
      pack1 = centre(pack);
    entry.measured = {
      materialTravel: round(props1.x - props0.x, 1),
      packTravel: round(pack1.x - pack0.x, 1),
      clusterSpread: round(distance(props1, pack1), 1),
    };
  } else if (kind === "rift") {
    const arches = ctx.s.mechanics.filter((m) => m.kind === "rift"),
      a = arches[0],
      b = arches.find((m) => m.id === a.pair)!,
      freight = ["prop-crate-8-rift-0-0", "prop-crate-8-rift-0-1", "prop-barrel-8-rift-0-0"];
    sim.teleport("local", a.x - 20, a.y);
    press(sim, { interact: true });
    const arrived = freight.filter((id) => distance(world.pose(id), b) < 70).length;
    sim.step(30);
    entry.measured = {
      freightCarried: arrived,
      survivedArrival: freight.filter((id) => world.has(id)).length,
      outwardAfter30Ticks: freight.map((id) => round(distance(world.pose(id), b), 1)),
    };
  }
  areas.push(entry);
  sim.dispose();
}

// Wardens: the signature telegraph measured in ticks, with its locked target.
const wardens: Record<string, unknown>[] = [];
for (let index = 1; index <= 8; index++) {
  const ctx = area(index),
    { sim, r } = ctx;
  const boss = monster(ctx, r.x + 60, r.y, {
    rig: RIGS[index - 1],
    boss: true,
    clear: true,
    hp: 1e6,
    passive: false,
  });
  sim.teleport("local", r.x - 60, r.y + 10);
  sim.adventure.hero("local").invulnerableUntil = 1e9;
  ctx.agent.execute({ op: "actors", action: "warden", id: `enemy-${boss.id}` });
  let telegraph = 0,
    move = "",
    locked = true,
    target: { x: number; y: number } | null = null;
  for (let t = 0; t < 200; t++) {
    sim.step();
    if (boss.phase === "windup") {
      telegraph++;
      move ||= boss.warden!.move;
      target ??= { x: boss.warden!.tx, y: boss.warden!.ty };
      if (boss.warden!.tx !== target.x || boss.warden!.ty !== target.y) locked = false;
    } else if (telegraph) break;
  }
  const w = WARDENS[r.signature];
  wardens.push({
    area: index,
    warden: r.boss,
    move,
    telegraphTicks: telegraph,
    targetLocked: locked,
    telegraph: w.telegraph,
    exposedBy: w.exposedBy,
  });
  sim.dispose();
}

console.log(
  JSON.stringify(
    {
      milestone: "M10",
      seed: 142,
      tickRate: 60,
      town,
      areas,
      wardens: {
        windup: WARDEN_WINDUP,
        exposed: EXPOSED,
        measured: wardens,
        exposures:
          "tests/physics-world.test.ts proves every identity's weakness through its own area's rule",
      },
    },
    null,
    2,
  ),
);
