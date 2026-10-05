import { WORLD_LIMIT } from "../engine/world.ts";
import { type AreaRecipe, BEHAVIORS, LAYOUTS, MECHANICS, RIGS, THEMES } from "./content.ts";
import { type Item, RARITIES, SLOTS } from "./loot.ts";
import { SKILLS, STAT_LABELS } from "./skills.ts";
import { type AdventureState, DEFAULT_TUNING } from "./types.ts";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid adventure: ${message}`);
}
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const finite = (v: unknown, max = 1e15) =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= max;
const text = (v: unknown, max = 100) => typeof v === "string" && v.length <= max;
const id = (v: unknown) => typeof v === "string" && /^[\w-]{1,100}$/.test(v);
function list(value: unknown, max: number): asserts value is unknown[] {
  check(Array.isArray(value) && value.length <= max, "list size");
}
export function validateArea(recipe: AreaRecipe): void {
  check(
    recipe &&
      recipe.version === 1 &&
      integer(recipe.index, 1) &&
      integer(recipe.land) &&
      integer(recipe.seed, 0, 0xffffffff) &&
      integer(recipe.landSeed, 0, 0xffffffff),
    "area identity",
  );
  check(
    text(recipe.name, 80) &&
      text(recipe.boss, 80) &&
      THEMES.some((t) => t.id === recipe.theme) &&
      LAYOUTS.includes(recipe.layout),
    "area content",
  );
  check(
    finite(recipe.x, WORLD_LIMIT - 1024) &&
      finite(recipe.y, WORLD_LIMIT - 1024) &&
      finite(recipe.radius, 640) &&
      recipe.radius >= 200 &&
      finite(recipe.power, 1e6) &&
      recipe.power > 0,
    "area geometry",
  );
  list(recipe.mechanics, 8);
  check(
    recipe.mechanics.length > 0 &&
      recipe.mechanics.includes(recipe.signature) &&
      recipe.mechanics.every((m) => MECHANICS.some((rule) => rule.id === m)),
    "mechanics",
  );
  list(recipe.behaviors, 6);
  check(
    recipe.behaviors.length &&
      recipe.behaviors.every((b) => BEHAVIORS.includes(b)) &&
      BEHAVIORS.includes(recipe.bossBehavior),
    "behaviors",
  );
  list(recipe.rigs, 6);
  check(recipe.rigs.length && recipe.rigs.every((r) => RIGS.includes(r)), "rigs");
  check(integer(recipe.killGoal, 1, 100) && typeof recipe.procedural === "boolean", "area goals");
  if (recipe.combination)
    check(
      recipe.mechanics.includes(recipe.combination.from) &&
        recipe.mechanics.includes(recipe.combination.into),
      "combination",
    );
}
export function validateItem(item: Item): void {
  check(
    item &&
      id(item.id) &&
      text(item.name, 80) &&
      SLOTS.includes(item.slot) &&
      RARITIES.includes(item.rarity) &&
      integer(item.level, 1, 1_000_000) &&
      finite(item.power, 1e6) &&
      item.power >= 0 &&
      integer(item.value, 0, 1e12),
    "item",
  );
  check(["none", "thornburst", "echo", "ward", "gale"].includes(item.special), "item power");
  list(item.affixes, 6);
  for (const affix of item.affixes)
    check(
      affix &&
        Object.hasOwn(STAT_LABELS, affix.stat) &&
        finite(affix.value, 1e6) &&
        affix.value >= 0,
      "item affix",
    );
}
export function validateAdventure(s: AdventureState): void {
  check(s && typeof s === "object" && s.version === 1 && integer(s.seed, 0, 0xffffffff), "header");
  for (const key of [
    "run",
    "area",
    "highest",
    "townLand",
    "kills",
    "spawned",
    "enteredAt",
    "clearTicks",
    "totalKills",
    "mechanicUses",
    "transition",
    "nextId",
    "nextEvent",
  ] as const)
    check(integer(s[key]), key);
  check(
    ["town", "area"].includes(s.mode) &&
      typeof s.bossSpawned === "boolean" &&
      typeof s.cleared === "boolean",
    "phase",
  );
  validateArea(s.recipe);
  check(s.tuning && Object.keys(s.tuning).length === 7, "tuning");
  for (const key of Object.keys(DEFAULT_TUNING) as (keyof typeof DEFAULT_TUNING)[])
    check(
      finite(s.tuning[key], key.endsWith("Speed") ? 3 : 10) && s.tuning[key] >= 0.1,
      "tuning multiplier",
    );
  check(
    s.heroes &&
      typeof s.heroes === "object" &&
      !Array.isArray(s.heroes) &&
      Object.keys(s.heroes).length <= 8,
    "heroes",
  );
  for (const [heroId, hero] of Object.entries(s.heroes)) {
    check(id(heroId) && hero && typeof hero === "object", "hero id");
    for (const key of [
      "level",
      "xp",
      "gold",
      "points",
      "potions",
      "kills",
      "deaths",
      "combo",
      "comboUntil",
      "attackUntil",
      "slashReady",
      "whorlReady",
      "lanceReady",
      "novaReady",
      "potionReady",
      "invulnerableUntil",
      "hurtUntil",
      "dashUntil",
      "burnUntil",
      "hasteUntil",
      "bloodUntil",
      "recallUntil",
      "procReady",
      "goldLost",
    ] as const)
      check(integer(hero[key], 0, 1e15), `hero ${key}`);
    check(
      hero.level >= 1 &&
        hero.level <= 1e6 &&
        hero.potions <= 3 &&
        hero.combo <= 2 &&
        finite(hero.hp, 1e12) &&
        hero.hp >= 0 &&
        typeof hero.dead === "boolean",
      "hero resources",
    );
    for (const key of ["attackAt", "attackAngle", "dashAngle", "lastDash", "lastHit"] as const)
      check(finite(hero[key]), `hero ${key}`);
    check(["slash", "whorl", "lance", "nova"].includes(hero.lastAbility), "ability");
    check(
      hero.skills &&
        typeof hero.skills === "object" &&
        Object.keys(hero.skills).length <= SKILLS.length,
      "skills",
    );
    let spent = 0;
    for (const [skillId, rank] of Object.entries(hero.skills)) {
      const node = SKILLS.find((skill) => skill.id === skillId);
      check(node && integer(rank, 0, node.max), "skill rank");
      spent += rank;
    }
    check(hero.points + spent === hero.level + 2, "skill point budget");
    list(hero.inventory, 40);
    const items = new Set<string>();
    for (const item of hero.inventory) {
      validateItem(item);
      check(!items.has(item.id), "duplicate item");
      items.add(item.id);
    }
    check(hero.equipment && typeof hero.equipment === "object", "equipment");
    for (const [slot, itemId] of Object.entries(hero.equipment))
      check(
        SLOTS.includes(slot as (typeof SLOTS)[number]) &&
          hero.inventory.some((item) => item.id === itemId && item.slot === slot),
        "equipped item",
      );
    list(hero.bought, 48);
    check(
      hero.bought.every((v) => id(v)),
      "stock ids",
    );
  }
  list(s.enemies, 256);
  const enemies = new Set<number>();
  for (const enemy of s.enemies) {
    check(
      enemy &&
        integer(enemy.id) &&
        !enemies.has(enemy.id) &&
        RIGS.includes(enemy.rig) &&
        BEHAVIORS.includes(enemy.behavior) &&
        THEMES.some((t) => t.id === enemy.theme),
      "enemy identity",
    );
    enemies.add(enemy.id);
    for (const key of ["x", "y", "px", "py"] as const)
      check(finite(enemy[key], WORLD_LIMIT + 1024), "enemy coordinate");
    for (const key of [
      "vx",
      "vy",
      "radius",
      "hp",
      "baseHealth",
      "maxHp",
      "damage",
      "speed",
      "timer",
      "nextAttack",
      "facing",
      "hurtUntil",
      "burnUntil",
      "burnDamage",
      "rootUntil",
      "deadAt",
      "attacks",
      "tier",
    ] as const)
      check(finite(enemy[key], 1e12), `enemy ${key}`);
    check(
      enemy.hp >= 0 &&
        enemy.maxHp > 0 &&
        enemy.radius > 0 &&
        enemy.radius <= 64 &&
        Math.abs(enemy.vx) < 5000 &&
        Math.abs(enemy.vy) < 5000 &&
        text(enemy.name, 80) &&
        text(enemy.target) &&
        text(enemy.burnOwner),
      "enemy state",
    );
    check(
      ["walk", "windup", "charge", "recover", "dead"].includes(enemy.phase) &&
        typeof enemy.boss === "boolean" &&
        typeof enemy.elite === "boolean" &&
        typeof enemy.counted === "boolean",
      "enemy phase",
    );
  }
  list(s.projectiles, 180);
  for (const p of s.projectiles) {
    for (const key of [
      "id",
      "x",
      "y",
      "px",
      "py",
      "vx",
      "vy",
      "radius",
      "damage",
      "ttl",
      "pierce",
    ] as const)
      check(finite(p[key], 1e12), "projectile");
    check(
      text(p.owner) &&
        typeof p.enemy === "boolean" &&
        THEMES.some((t) => t.id === p.theme) &&
        Math.abs(p.vx) < 5000 &&
        Math.abs(p.vy) < 5000,
      "projectile owner",
    );
    list(p.hit, 256);
    check(
      p.hit.every((v) => integer(v)),
      "hit ids",
    );
  }
  list(s.mechanics, 32);
  for (const m of s.mechanics)
    check(
      m &&
        integer(m.id) &&
        MECHANICS.some((rule) => rule.id === m.kind) &&
        finite(m.x, WORLD_LIMIT) &&
        finite(m.y, WORLD_LIMIT) &&
        finite(m.radius, 256) &&
        integer(m.readyAt) &&
        integer(m.activeUntil) &&
        (m.pair === null || integer(m.pair)),
      "mechanic state",
    );
  list(s.drops, 150);
  for (const drop of s.drops) {
    check(
      drop &&
        integer(drop.id) &&
        finite(drop.x, WORLD_LIMIT + 1024) &&
        finite(drop.y, WORLD_LIMIT + 1024) &&
        integer(drop.born) &&
        integer(drop.amount, 0, 1e12) &&
        ["gold", "xp", "item"].includes(drop.kind),
      "drop",
    );
    if (drop.kind === "item") validateItem(drop.item!);
  }
  list(s.events, 96);
  for (const e of s.events)
    check(
      e &&
        integer(e.id) &&
        integer(e.tick) &&
        finite(e.x, WORLD_LIMIT + 1024) &&
        finite(e.y, WORLD_LIMIT + 1024) &&
        text(e.owner) &&
        text(e.text, 256) &&
        finite(e.amount, 1e12) &&
        finite(e.angle) &&
        /^#[\da-fA-F]{6}$/.test(e.color) &&
        [
          "slash",
          "whorl",
          "lance",
          "nova",
          "hit",
          "hurt",
          "kill",
          "level",
          "loot",
          "portal",
          "mechanic",
          "death",
          "potion",
          "boss",
          "impact",
          "break",
        ].includes(e.type),
      "event",
    );
  list(s.delayed, 256);
  for (const d of s.delayed) {
    check(
      d &&
        integer(d.tick) &&
        text(d.owner) &&
        finite(d.x, WORLD_LIMIT + 1024) &&
        finite(d.y, WORLD_LIMIT + 1024) &&
        finite(d.damage, 1e12) &&
        finite(d.radius, 1000) &&
        (d.kind === "echo" || MECHANICS.some((m) => m.id === d.kind)),
      "delayed effect",
    );
    check(
      d.ability === undefined || ["whorl", "lance", "nova"].includes(d.ability),
      "echo ability",
    );
    check(d.angle === undefined || finite(d.angle), "echo angle");
  }
}
