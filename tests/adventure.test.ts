import assert from "node:assert/strict";
import test from "node:test";
import { AgentRuntime, type Replay, replay } from "../src/engine/agent.ts";
import { Simulation } from "../src/engine/simulation.ts";
import { areaRecipe, MECHANICS, RIGS, THEMES } from "../src/game/content.ts";
import { rollItem } from "../src/game/loot.ts";
import { SKILLS } from "../src/game/skills.ts";
import { validateAdventure, validateArea } from "../src/game/validation.ts";
import { decodeSnapshot, encodeSnapshot } from "../src/net/protocol.ts";
import { monsterPixels, rigSvg } from "../src/render/rigs.ts";
import { fightArea } from "../tools/lib/expedition-bot.ts";

function game(area = 0): Simulation {
  const sim = new Simulation(142, 0);
  sim.addPlayer("local");
  if (area) sim.adventure.startArea(sim, area);
  return sim;
}
function oneEnemy(sim: Simulation, dx = 30, dy = 0) {
  const player = sim.players.get("local")!;
  const enemy = sim.adventure.state.enemies[0];
  enemy.x = enemy.px = player.x + dx;
  enemy.y = enemy.py = player.y + dy;
  enemy.hp = enemy.maxHp = enemy.baseHealth = 1000;
  enemy.vx = enemy.vy = enemy.speed = 0;
  enemy.phase = "walk";
  enemy.rootUntil = 1e6;
  enemy.nextAttack = 1e6;
  enemy.counted = false;
  sim.adventure.state.enemies = [enemy];
  sim.adventure.state.spawned = sim.adventure.state.recipe.killGoal;
  return enemy;
}

test("eight authored areas introduce distinct named mechanics, then compose endless recipes", () => {
  const authored = Array.from({ length: 8 }, (_, i) => areaRecipe(142, i + 1));
  assert.equal(new Set(authored.map((area) => area.signature)).size, 8);
  for (const area of authored) {
    validateArea(area);
    assert.equal(area.name, MECHANICS.find((m) => m.id === area.signature)!.name);
  }
  for (const index of [9, 10, 64, 10000, 1000000000]) {
    const area = areaRecipe(142, index);
    validateArea(area);
    assert.deepEqual(area, areaRecipe(142, index));
    assert.ok(area.procedural && area.combination);
    assert.ok(Math.abs(area.x) < 4000 && Math.abs(area.y) < 400);
    assert.notDeepEqual(area, areaRecipe(143, index));
  }
  assert.ok(authored[1].x > authored[0].x && authored[3].x > authored[2].x);
  assert.throws(() => areaRecipe(142, Infinity), /positive/);
});

test("default combat clears the first area through real inputs and creates progression drops", () => {
  const sim = game(1),
    result = fightArea(sim);
  assert.equal(result.cleared, true);
  assert.equal(result.dead, false);
  const hero = sim.adventure.hero("local");
  assert.ok(hero.level > 1 && hero.gold > 80 && hero.kills > 15);
  assert.ok(sim.adventure.state.drops.some((drop) => drop.item?.rarity === "rare"));
  assert.ok(sim.adventure.state.events.some((event) => event.type === "portal"));
  // Inspection must evaluate expired buffs at the actual simulation tick.
  hero.bloodUntil = hero.hasteUntil = sim.tick - 1;
  const observed = sim.observe().adventure.stats!;
  assert.equal(observed.damage, sim.adventure.stats("local", sim.tick).damage);
  assert.equal(observed.speed, sim.adventure.stats("local", sim.tick).speed);
});

test("combat-only play can clear an area while every optional mechanic remains unavailable", () => {
  const sim = game(1);
  for (const mechanic of sim.adventure.state.mechanics) mechanic.readyAt = 1000000;
  sim.adventure.tune(sim, { playerHealth: 2 });
  const result = fightArea(sim);
  assert.equal(result.cleared, true);
  assert.equal(sim.adventure.state.mechanicUses, 0);
});

test("the run travels outward through eight areas, two new towns, and a procedural area", () => {
  const sim = game();
  sim.adventure.tune(sim, { playerDamage: 2, playerHealth: 2 });
  const towns = [sim.adventure.observe().town];
  const seeds = [sim.world.seed];
  for (let index = 1; index <= 9; index++) {
    if (sim.adventure.state.mode === "town") sim.adventure.action(sim, "local", { type: "depart" });
    assert.equal(sim.adventure.state.area, index);
    assert.ok(fightArea(sim).cleared, `area ${index} did not clear`);
    if (index % 4 === 0)
      assert.ok(sim.adventure.state.drops.some((drop) => drop.item?.rarity === "legendary"));
    const inventory = sim.adventure.hero("local").inventory.length,
      level = sim.adventure.hero("local").level;
    sim.adventure.action(sim, "local", { type: "advance" });
    if (index % 4 === 0) {
      assert.equal(sim.adventure.state.mode, "town");
      assert.equal(sim.adventure.hero("local").potions, 3);
      assert.equal(sim.adventure.hero("local").inventory.length, inventory);
      assert.equal(sim.adventure.hero("local").level, level);
      towns.push(sim.adventure.observe().town);
      seeds.push(sim.world.seed);
    }
  }
  assert.equal(new Set(towns).size, 3);
  assert.equal(new Set(seeds).size, 3);
  assert.equal(sim.adventure.state.highest, 9);
  const restored = Simulation.restore(sim.save());
  sim.step(30);
  restored.step(30);
  assert.deepEqual(restored.save(), sim.save());
});

test("skill points, prerequisites, keystones, active unlocks and respec all affect gameplay", () => {
  assert.equal(SKILLS.length, 48);
  assert.equal(new Set(SKILLS.map((s) => s.id)).size, 48);
  for (const skill of SKILLS)
    if (skill.requires) assert.ok(SKILLS.some((s) => s.id === skill.requires));
  const sim = game(),
    hero = sim.adventure.hero("local"),
    before = sim.adventure.stats("local");
  assert.throws(() => sim.adventure.action(sim, "local", { type: "skill", id: "gale-3" }), /level/);
  sim.adventure.action(sim, "local", { type: "skill", id: "blade-0" });
  assert.ok(sim.adventure.stats("local").damage > before.damage);
  assert.equal(hero.points, 2);
  hero.gold = 500;
  sim.adventure.action(sim, "local", { type: "respec" });
  assert.equal(hero.points, 3);
  assert.equal(hero.gold, 490);
  hero.level = 3;
  hero.points = 5;
  for (let i = 0; i < 3; i++) sim.adventure.action(sim, "local", { type: "skill", id: "gale-0" });
  sim.adventure.action(sim, "local", { type: "skill", id: "gale-3" });
  assert.ok(sim.adventure.stats("local").lance);
  sim.setInput("local", { lance: true, aimX: 1 });
  sim.step();
  assert.equal(sim.adventure.state.projectiles.length, 1);
  assert.ok(sim.players.get("local")!.energy < 100);
  sim.setInput("local", {});
  sim.step(80);
  assert.equal(sim.adventure.state.projectiles.length, 0);
  assert.equal(sim.adventure.state.enemies.length, 0, "town practice cannot spawn hostiles");
  validateAdventure(sim.adventure.save());
});

test("Endless Cleave turns the third slash into a full-circle hit", () => {
  const sim = game(1),
    hero = sim.adventure.hero("local");
  hero.level = 10;
  hero.points = 12;
  for (const id of ["blade-0", "blade-3", "blade-6"])
    for (let i = 0; i < 3; i++) sim.adventure.action(sim, "local", { type: "skill", id });
  sim.adventure.action(sim, "local", { type: "skill", id: "blade-9" });
  oneEnemy(sim, -32);
  const normal = Simulation.restore(sim.save());
  delete normal.adventure.hero("local").skills["blade-9"];
  normal.adventure.hero("local").points++;
  for (const game of [sim, normal]) {
    game.setInput("local", { attack: true, aimX: 1 });
    game.step(40);
  }
  assert.ok(sim.adventure.state.enemies[0].hp < normal.adventure.state.enemies[0].hp);
});

test("all six tuning multipliers change actual stats, motion or incoming damage", () => {
  const sim = game();
  const old = sim.adventure.stats("local");
  sim.adventure.tune(sim, { playerDamage: 2, playerHealth: 2, playerSpeed: 2 });
  const stats = sim.adventure.stats("local");
  assert.equal(stats.damage, old.damage * 2);
  assert.equal(stats.health, old.health * 2);
  assert.equal(stats.speed, old.speed * 2);
  const base = game();
  for (const game of [sim, base]) {
    game.setInput("local", { x: 1 });
    game.step(30);
  }
  assert.ok(sim.players.get("local")!.x - -20 > (base.players.get("local")!.x - -20) * 1.9);
  const arena = game(1),
    enemy = oneEnemy(arena, 24);
  enemy.behavior = "hunter";
  enemy.phase = "windup";
  enemy.timer = 1;
  enemy.facing = Math.PI;
  enemy.damage = 20;
  arena.adventure.hero("local").invulnerableUntil = 0;
  const harsh = Simulation.restore(arena.save());
  harsh.adventure.tune(harsh, { enemyDamage: 2, enemyHealth: 2, enemySpeed: 2 });
  assert.equal(harsh.adventure.state.enemies[0].maxHp, enemy.maxHp * 2);
  const hp = arena.adventure.hero("local").hp;
  arena.step();
  harsh.step();
  assert.ok(hp - harsh.adventure.hero("local").hp > (hp - arena.adventure.hero("local").hp) * 1.8);
  const moving = game(1);
  const runner = oneEnemy(moving, 300);
  runner.speed = 50;
  runner.rootUntil = 0;
  const fast = Simulation.restore(moving.save());
  fast.adventure.tune(fast, { enemySpeed: 2 });
  const x = runner.x;
  moving.step(30);
  fast.step(30);
  assert.ok(
    x - fast.adventure.state.enemies[0].x > (x - moving.adventure.state.enemies[0].x) * 1.8,
  );
  assert.throws(() => sim.adventure.tune(sim, JSON.parse('{"constructor":1}')), /Invalid tuning/);
});

test("loot rolls are deterministic, equipment changes stats, and restocked purchases keep unique ids", () => {
  assert.deepEqual(rollItem(142, 4, 12), rollItem(142, 4, 12));
  const legendary = rollItem(142, 4, 12, 0, "legendary");
  assert.equal(legendary.affixes.length, 4);
  assert.notEqual(legendary.special, "none");
  const sim = game(),
    hero = sim.adventure.hero("local");
  hero.level = 4;
  hero.points = 6;
  hero.gold = 10000;
  const before = sim.adventure.stats("local").damage;
  sim.adventure.action(sim, "local", { type: "buy", index: 0 });
  const item = hero.inventory.at(-1)!;
  sim.adventure.action(sim, "local", { type: "equip", id: item.id });
  assert.notEqual(sim.adventure.stats("local").damage, before);
  assert.throws(() => sim.adventure.action(sim, "local", { type: "buy", index: 0 }), /Already/);
  sim.adventure.startArea(sim, 1);
  hero.dead = true;
  hero.hp = 0;
  sim.adventure.action(sim, "local", { type: "respawn" });
  sim.adventure.action(sim, "local", { type: "buy", index: 0 });
  assert.equal(new Set(hero.inventory.map((item) => item.id)).size, hero.inventory.length);
  const sale = hero.inventory.at(-1)!,
    gold = hero.gold;
  sim.adventure.action(sim, "local", { type: "sell", id: sale.id });
  assert.equal(hero.gold, gold + sale.value);
  validateAdventure(sim.adventure.save());
});

test("loot interaction takes precedence over Bloodbloom's optional life trade", () => {
  const sim = game(6),
    player = sim.players.get("local")!,
    hero = sim.adventure.hero("local");
  const bloom = sim.adventure.state.mechanics.find((m) => m.kind === "blood")!;
  player.x = player.px = bloom.x;
  player.y = player.py = bloom.y;
  sim.adventure.state.enemies = [];
  sim.adventure.state.spawned = sim.adventure.state.recipe.killGoal;
  sim.adventure.state.drops = [
    {
      id: 999,
      x: player.x,
      y: player.y,
      born: sim.tick,
      kind: "item",
      amount: 1,
      item: rollItem(142, 800, 6),
    },
  ];
  const hp = hero.hp;
  sim.setInput("local", { interact: true });
  sim.step();
  assert.equal(hero.inventory.length, 3);
  assert.ok(hero.hp >= hp);
  assert.equal(hero.bloodUntil, 0);
  sim.setInput("local", {});
  sim.step();
  sim.setInput("local", { interact: true });
  sim.step();
  assert.ok(hero.hp < hp && hero.bloodUntil > sim.tick);
});

test("Echo Wells replay the actual ability and compose delayed secondary mechanics across saves", () => {
  const sim = game(9),
    player = sim.players.get("local")!,
    hero = sim.adventure.hero("local");
  hero.level = 3;
  hero.points = 5;
  for (let i = 0; i < 3; i++) sim.adventure.action(sim, "local", { type: "skill", id: "gale-0" });
  sim.adventure.action(sim, "local", { type: "skill", id: "gale-3" });
  sim.adventure.state.recipe.signature = "echo";
  sim.adventure.state.recipe.mechanics = ["echo", "bramble"];
  sim.adventure.state.recipe.combination = { from: "echo", into: "bramble" };
  sim.adventure.state.mechanics = [
    {
      id: 10000,
      kind: "echo",
      x: player.x,
      y: player.y,
      radius: 25,
      readyAt: 0,
      activeUntil: 0,
      pair: null,
    },
  ];
  oneEnemy(sim, 180);
  sim.setInput("local", { lance: true, aimX: 1 });
  sim.step();
  sim.setInput("local", {});
  assert.ok(sim.adventure.state.delayed.some((e) => e.ability === "lance"));
  assert.ok(sim.adventure.state.delayed.some((e) => e.kind === "bramble"));
  const restored = Simulation.restore(sim.save());
  sim.step(35);
  restored.step(35);
  assert.deepEqual(restored.save(), sim.save());
  assert.ok(sim.adventure.state.events.some((e) => e.type === "lance" && e.text === "echo"));
});

test("death costs gold, retains build and equipment, and town restores life and flasks", () => {
  const sim = game(1),
    hero = sim.adventure.hero("local"),
    enemy = oneEnemy(sim, 24);
  hero.gold = 100;
  hero.invulnerableUntil = 0;
  hero.hp = 1;
  enemy.behavior = "hunter";
  enemy.phase = "windup";
  enemy.timer = 1;
  enemy.facing = Math.PI;
  sim.step();
  assert.equal(hero.dead, true);
  assert.equal(hero.gold, 90);
  const items = structuredClone(hero.inventory);
  sim.adventure.action(sim, "local", { type: "respawn" });
  assert.equal(sim.adventure.state.mode, "town");
  assert.equal(hero.dead, false);
  assert.equal(hero.potions, 3);
  assert.equal(hero.hp, sim.adventure.stats("local").health);
  assert.deepEqual(hero.inventory, items);
});

test("combat commands replay exactly and malformed shared game state is rejected atomically", () => {
  const agent = new AgentRuntime(game());
  for (const command of [
    { op: "adventure", action: { type: "depart" } },
    { op: "input", x: 1, attack: true, pulse: true },
    { op: "step", ticks: 80 },
    { op: "input", x: 0, attack: true },
    { op: "step", ticks: 30 },
  ])
    agent.execute(command);
  assert.equal(
    replay(agent.execute({ op: "replay" }) as Replay).stateHash(),
    agent.sim.stateHash(),
  );
  const packet = encodeSnapshot(agent.sim, "local", 15000),
    decoded = decodeSnapshot(packet).sim;
  assert.equal(decoded.adventure.state.area, 1);
  assert.equal(decoded.adventure.hero("local").level, agent.sim.adventure.hero("local").level);
  const save = agent.sim.save();
  save.adventure!.heroes.local.points = 100000;
  assert.throws(() => Simulation.restore(save), /skill point/);
  const recipe = areaRecipe(142, 9);
  recipe.mechanics.push("unknown" as typeof recipe.signature);
  assert.throws(() => validateArea(recipe), /mechanics/);
});

test("modular rigs share deterministic export geometry and expressive poses", () => {
  for (const rig of RIGS)
    for (const theme of THEMES) {
      const recipe = { version: 1 as const, rig, theme: theme.id, seed: 142 };
      assert.deepEqual(monsterPixels(recipe, "walk", 4), monsterPixels(recipe, "walk", 4));
      assert.notEqual(rigSvg(recipe, "idle", 0), rigSvg(recipe, "windup", 12));
      assert.ok(monsterPixels(recipe).length > 20);
    }
});

test("party rewards are shared, guests cannot redirect the run, and a respawn preserves others' fight", () => {
  const sim = game();
  sim.addPlayer("guest");
  sim.adventure.action(sim, "local", { type: "depart" });
  const player = sim.players.get("local")!,
    guest = sim.players.get("guest")!;
  sim.adventure.state.enemies = [];
  sim.adventure.state.spawned = sim.adventure.state.recipe.killGoal;
  sim.adventure.state.drops = [
    { id: 9000, x: player.x, y: player.y, born: sim.tick, kind: "gold", amount: 10 },
    { id: 9001, x: player.x, y: player.y, born: sim.tick, kind: "xp", amount: 30 },
  ];
  sim.step();
  for (const id of ["local", "guest"]) {
    assert.equal(sim.adventure.hero(id).gold, 90);
    assert.equal(sim.adventure.hero(id).xp, 30);
  }
  assert.throws(() => sim.adventure.action(sim, "guest", { type: "return" }), /leader/);
  const hero = sim.adventure.hero("guest");
  hero.dead = true;
  hero.hp = 0;
  hero.deaths++;
  sim.adventure.action(sim, "guest", { type: "respawn" });
  assert.equal(sim.adventure.state.mode, "area");
  assert.equal(hero.dead, false);
  sim.adventure.state.cleared = true;
  guest.x = sim.adventure.state.recipe.x + 275;
  guest.y = sim.adventure.state.recipe.y;
  sim.setInput("guest", { interact: true });
  sim.step();
  assert.equal(sim.adventure.state.area, 1);
  assert.ok(
    sim.adventure.state.events.some((e) => e.owner === "guest" && e.text.includes("leader")),
  );
});
