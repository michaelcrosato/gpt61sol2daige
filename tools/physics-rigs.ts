// M09 acceptance receipt: `node tools/physics-rigs.ts > docs/evidence/physics-m09.json`.
// Every number is measured from the headless simulation (seed 142, area 1).
import { AgentRuntime } from "../src/engine/agent.ts";
import { Simulation } from "../src/engine/simulation.ts";
import { RIGS, type RigKind } from "../src/game/content.ts";
import { detachables, RIG_BLUEPRINTS } from "../src/game/rigs.ts";
import { initializePhysics } from "../src/physics/bootstrap.ts";
import { REMAINS_TICKS, remainsBodyId, remainsId } from "../src/physics/rigs.ts";
import { jointAnchors } from "../src/physics/runtime.ts";

await initializePhysics();
const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
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
  return sim;
}
function monster(sim: Simulation, rig: RigKind, hp = 400, dx = 60) {
  const p = sim.players.get("local")!;
  const e = sim.adventure.spawnMonster(sim, rig, p.x + dx, p.y, { hp, passive: true });
  sim.step();
  return e;
}
const centre = (sim: Simulation, ids: string[]) => {
  const m = ids.map((id) => sim.physical!.world.motionOf(id));
  return {
    x: m.reduce((s, q) => s + q.x, 0) / m.length,
    y: m.reduce((s, q) => s + q.y, 0) / m.length,
  };
};
const rigs: Record<string, unknown> = {};
for (const rig of RIGS) {
  // A single 20-damage blow from the west.
  let sim = arena();
  let e = monster(sim, rig);
  const start = { x: e.x, y: e.y };
  sim.adventure.strikeEnemy(sim, "local", e.id, 20, 0);
  let peak = 0;
  for (let i = 0; i < 30; i++) {
    sim.step();
    peak = Math.max(peak, e.reaction.lean);
  }
  const blow = {
    peakLean: round(peak),
    displaced: round(Math.hypot(e.x - start.x, e.y - start.y), 1),
  };
  sim.dispose();
  // Sustained 70-damage blows on a 6000-health body until it is knocked down (or 30 blows).
  sim = arena();
  e = monster(sim, rig, 6000);
  let blows = 0,
    staggers = 0;
  for (; blows < 30 && e.reaction.toppleUntil <= sim.tick; blows++) {
    const before = e.reaction.staggerUntil;
    sim.adventure.strikeEnemy(sim, "local", e.id, 70, 0);
    if (e.reaction.staggerUntil > before) staggers++;
    sim.step(4);
  }
  const knockdown = {
    blows,
    staggers,
    down: e.reaction.toppleUntil > sim.tick,
    shed: e.reaction.shed,
  };
  sim.dispose();
  // Death: pose and momentum into remains.
  sim = arena();
  e = monster(sim, rig, 400);
  sim.adventure.strikeEnemy(sim, "local", e.id, 30, 0.3);
  sim.step(3);
  sim.adventure.strikeEnemy(sim, "local", e.id, 5000, 0.3);
  const actor = sim.physical!.world.motionOf(`enemy-${e.id}`);
  sim.step();
  const world = sim.physical!.world,
    record = sim.physical!.rigs.record(e.id)!,
    members = world.assemblyList().find((a) => a.id === remainsId(e.id))!.members,
    joints = world.jointList().filter((j) => j.recipe.assembly === remainsId(e.id));
  const v = members
    .map((id) => world.motionOf(id))
    .reduce((s, m) => ({ x: s.x + m.vx, y: s.y + m.vy }), { x: 0, y: 0 });
  let gap = 0;
  sim.step(200);
  for (const j of world.jointList().filter((q) => q.recipe.assembly === remainsId(e.id))) {
    const a = jointAnchors(j.recipe, world.pose(j.recipe.a), world.pose(j.recipe.b));
    gap = Math.max(gap, Math.hypot(a.ax - a.bx, a.ay - a.by));
  }
  rigs[rig] = {
    locomotion: RIG_BLUEPRINTS[rig].locomotion,
    death: RIG_BLUEPRINTS[rig].death,
    parts: RIG_BLUEPRINTS[rig].parts.length,
    detachables: detachables(rig).map((p) => `${p.id}:${p.material}`),
    blow,
    knockdown,
    remains: {
      jointedBodies: members.length,
      hinges: joints.length,
      loose: record.bodies.length - members.length,
      fall: round(record.fall),
      landsAfterTicks: record.lands - record.born,
      actorSpeedAtDeath: round(Math.hypot(actor.vx, actor.vy), 1),
      ragdollSpeedAtSpawn: round(Math.hypot(v.x, v.y) / members.length, 1),
      rootsFixed:
        rig === "totem"
          ? world.recipeOf(remainsBodyId(e.id, "roots")).motion === "fixed"
          : undefined,
      maxHingeGapAfter200Ticks: round(gap),
      fallEvents: sim.adventure.state.events
        .filter((x) => x.type === "rig" && x.text.startsWith("fall:"))
        .map((x) => x.text),
    },
  };
  sim.dispose();
}
// Whorl, a field, ragdolls off, saves.
const sim = arena();
const e = monster(sim, "stalker", 60, 30);
sim.adventure.strikeEnemy(sim, "local", e.id, 5000, 0);
sim.step(120);
const ids = sim.physical!.world.assemblyList().find((a) => a.id === remainsId(e.id))!.members;
const whorl = (x: number, y: number) => {
  sim.adventure.hero("local").whorlReady = 0;
  sim.teleport("local", x - 22, y);
  sim.step(2);
  sim.setInput("local", { pulse: true });
  sim.step();
  sim.setInput("local", {});
  sim.step(40);
};
const c0 = centre(sim, ids);
whorl(c0.x, c0.y);
const c1 = centre(sim, ids);
sim.physical!.reactions.addField({
  id: "receipt-gust",
  kind: "wind",
  areaId: "area-1",
  shape: { kind: "lane", x: c1.x - 60, y: c1.y, angle: 0, length: 140, width: 80 },
  strength: 900,
  ticks: 30,
  gust: 0,
  actors: false,
  owner: "",
  team: "world",
  source: "receipt",
});
sim.step(40);
const c2 = centre(sim, ids);
const agent = new AgentRuntime(sim);
const revision = (
  agent.execute({ op: "actors", action: "inspect" }) as { policies: { nextRevision: number } }
).policies.nextRevision;
agent.execute({
  op: "actors",
  action: "configure",
  expectedRevision: revision,
  edits: [{ type: "override", scope: "area", id: "area-1", values: { ragdolls: false } }],
});
sim.step(2);
const frozen = ids.every((id) => sim.physical!.world.motionOf(id).frozen);
const c3 = centre(sim, ids);
whorl(c3.x, c3.y);
const c4 = centre(sim, ids);
const kills = sim.adventure.hero("local").kills,
  nextId = sim.adventure.state.nextId;
const raw = Simulation.restore(JSON.parse(JSON.stringify(sim.save())));
sim.step(120);
raw.step(120);
const continuation = raw.stateHash() === sim.stateHash();
raw.step(300);
const save = {
  rawContinuationHashEqual: continuation,
  aliveAfterRestore: raw.adventure.state.enemies.filter((x) => x.hp > 0).length,
  killsBefore: kills,
  killsAfter: raw.adventure.hero("local").kills,
  newDropsAfterRestore: raw.adventure.state.drops.filter((d) => d.id >= nextId).length,
};
raw.dispose();
sim.step(REMAINS_TICKS);
const expiry = {
  remainsAfterLifetime: sim
    .physical!.world.ids()
    .filter((id) => id.startsWith(`prop-remains-${e.id}-`)).length,
};
sim.dispose();
// Townsfolk.
const town = new Simulation(142, 0);
town.addPlayer("local");
town.step(2);
const home = town.townsfolk()[0];
town.teleport("local", home.x - 24, home.y);
town.step(2);
town.setInput("local", { x: 1 });
town.step(24);
const shoved = town.townsfolk()[0];
town.setInput("local", {});
town.teleport("local", 0, 60);
town.step(240);
const back = town.townsfolk()[0];
const townsfolk = {
  shovedBy: round(Math.hypot(shoved.x - home.x, shoved.y - home.y), 1),
  bumpEvent: town.adventure.state.events.some((x) => x.text === "npc:bump:rowan"),
  distanceFromPostAfter4s: round(Math.hypot(back.x - home.x, back.y - home.y), 1),
};
town.dispose();
console.log(
  JSON.stringify(
    {
      seed: 142,
      area: 1,
      date: "2026-10-05",
      command: "node tools/physics-rigs.ts",
      remainsLifetimeTicks: REMAINS_TICKS,
      rigs,
      corpse: {
        whorlDisplacement: round(Math.hypot(c1.x - c0.x, c1.y - c0.y), 1),
        fieldDisplacement: round(Math.hypot(c2.x - c1.x, c2.y - c1.y), 1),
        ragdollsOffFrozen: frozen,
        whorlWhileFrozen: round(Math.hypot(c4.x - c3.x, c4.y - c3.y), 4),
      },
      save,
      expiry,
      townsfolk,
    },
    null,
    2,
  ),
);
