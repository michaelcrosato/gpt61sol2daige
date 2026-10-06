import { hash, random } from "../engine/math.ts";
import { collideCircles, moveBody } from "../engine/physics.ts";
import type { Player, Simulation } from "../engine/simulation.ts";
import { World } from "../engine/world.ts";
import { enemyBodyId, type PropHit, playerBodyId } from "../physics/adventure.ts";
import { LOOT_SETTLE_TICKS, type PendingImpact } from "../physics/combat.ts";
import { MATERIALS } from "../physics/materials.ts";
import { insidePen } from "../physics/mechanisms.ts";
import { type FieldRecipe, REACTION_COLORS } from "../physics/reactions.ts";
import {
  ARC_STRENGTH,
  BLOOM_SNARE,
  GUST,
  KNOT,
  TAILWIND,
  THORNBURST,
  tailwindLane,
  VENT_RADIUS,
} from "../physics/showcase.ts";
import type { AreaRecipe, BehaviorId, RigKind } from "./content.ts";
import {
  ARCHETYPES,
  areaRecipe,
  encounterPosition,
  mechanicLayout,
  mechanicOf,
  npcPosition,
  RIGS,
  TOWN_NPCS,
  townName,
} from "./content.ts";
import { ATTACKS, attackRecipe, HARD_MATERIALS } from "./interactions.ts";
import { type Item, rollItem, SLOTS, starterItems } from "./loot.ts";
import {
  freshReaction,
  freshRecoil,
  hitReaction,
  recoilHit,
  rigOf,
  stepReaction,
  stepRecoil,
} from "./rigs.ts";
import { SKILLS, type StatId, skillReason } from "./skills.ts";
import {
  type AdventureAction,
  type AdventureState,
  type CombatEvent,
  DEFAULT_TUNING,
  type Enemy,
  type Hero,
  type HeroStats,
  type Mechanic,
  type Projectile,
  type Tuning,
} from "./types.ts";
import { validateAdventure, validateArea } from "./validation.ts";
import {
  ECHO_DELAY,
  EXPOSED,
  freshWarden,
  WARDEN_WINDUP,
  WARDENS,
  type WardenWeakness,
} from "./wardens.ts";

export const INVENTORY_LIMIT = 40;
const round3 = (value: number) => Math.round(value * 1000) / 1000;
/** A gale charge slowed below this (units/s) has run into something solid. */
const CRASH_SPEED = 90;
export const MAX_ENEMIES = 100;
export const xpForLevel = (level: number) => Math.floor(80 + 25 * level ** 1.35);
export function freshHero(level = 1): Hero {
  const inventory = starterItems();
  return {
    level,
    xp: 0,
    gold: 80,
    points: level + 2,
    skills: {},
    inventory,
    equipment: { weapon: inventory[0].id, armor: inventory[1].id },
    hp: 100,
    potions: 3,
    kills: 0,
    deaths: 0,
    combo: 0,
    comboUntil: 0,
    attackAt: -100,
    attackUntil: 0,
    attackAngle: 0,
    slashReady: 0,
    whorlReady: 0,
    lanceReady: 0,
    novaReady: 0,
    potionReady: 0,
    invulnerableUntil: 0,
    hurtUntil: 0,
    dashUntil: 0,
    dashAngle: 0,
    lastDash: -100,
    burnUntil: 0,
    hasteUntil: 0,
    bloodUntil: 0,
    recallUntil: 0,
    lastHit: -1000,
    procReady: 0,
    dead: false,
    bought: [],
    lastAbility: "slash",
    goldLost: 0,
    recoil: freshRecoil(),
  };
}
function initialState(seed: number): AdventureState {
  return {
    version: 1,
    seed: seed >>> 0,
    run: 1,
    area: 0,
    highest: 0,
    townLand: 0,
    mode: "town",
    recipe: areaRecipe(seed, 1),
    kills: 0,
    spawned: 0,
    bossSpawned: false,
    cleared: false,
    enteredAt: 0,
    clearTicks: 0,
    totalKills: 0,
    mechanicUses: 0,
    transition: 0,
    nextId: 1,
    nextEvent: 1,
    tuning: { ...DEFAULT_TUNING },
    heroes: {},
    enemies: [],
    projectiles: [],
    mechanics: [],
    drops: [],
    events: [],
    delayed: [],
  };
}
export class Adventure {
  state: AdventureState;
  constructor(seed: number) {
    this.state = initialState(seed);
  }
  hero(id: string): Hero {
    if (!Object.hasOwn(this.state.heroes, id))
      Object.defineProperty(this.state.heroes, id, {
        value: freshHero(),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    return this.state.heroes[id];
  }
  removePlayer(id: string): void {
    delete this.state.heroes[id];
  }
  retainPlayer(oldId: string, newId = "local"): void {
    const hero = this.state.heroes[oldId] ?? freshHero();
    this.state.heroes = { [newId]: hero };
    for (const enemy of this.state.enemies) if (enemy.target === oldId) enemy.target = newId;
    this.state.projectiles = this.state.projectiles.filter((p) => p.enemy || p.owner === oldId);
    for (const p of this.state.projectiles) if (!p.enemy) p.owner = newId;
    this.state.delayed = this.state.delayed
      .filter((effect) => effect.owner === oldId)
      .map((effect) => ({ ...effect, owner: newId }));
    for (const event of this.state.events) if (event.owner === oldId) event.owner = newId;
  }
  stats(id: string, tick = 0): HeroStats {
    const hero = this.hero(id),
      stats: Record<StatId, number> = {
        damage: 0,
        life: 0,
        speed: 0,
        haste: 0,
        crit: 0,
        critPower: 0,
        armor: 0,
        regen: 0,
        leech: 0,
        reach: 0,
        cooldown: 0,
        gold: 0,
        xp: 0,
        luck: 0,
        burn: 0,
        chain: 0,
        execute: 0,
        spirit: 0,
        force: 0,
        shatter: 0,
        ricochet: 0,
      };
    const powers: string[] = [];
    let weapon = 8,
      lance = false,
      nova = false;
    for (const skill of SKILLS) {
      const rank = hero.skills[skill.id] ?? 0;
      stats[skill.stat] += skill.value * rank;
      if (skill.physical) stats[skill.physical.stat] += skill.physical.value * rank;
      if (rank && skill.unlock === "lance") lance = true;
      if (rank && skill.unlock === "nova") nova = true;
      if (rank && skill.power) powers.push(skill.power);
    }
    for (const slot of SLOTS) {
      const item = hero.inventory.find((entry) => entry.id === hero.equipment[slot]);
      if (!item) continue;
      if (slot === "weapon") weapon = item.power;
      if (slot === "armor") stats.armor += item.power;
      for (const affix of item.affixes) stats[affix.stat] += affix.value;
      if (item.special !== "none") powers.push(item.special);
    }
    return {
      damage:
        (weapon + (hero.level - 1) * 2.1) *
        (1 + stats.damage) *
        this.state.tuning.playerDamage *
        (hero.bloodUntil > tick ? 1.4 : 1),
      health: (100 + (hero.level - 1) * 13 + stats.life) * this.state.tuning.playerHealth,
      speed:
        1.4 *
        (1 + Math.min(2, stats.speed)) *
        this.state.tuning.playerSpeed *
        (hero.hasteUntil > tick ? 1.4 : 1),
      haste: 1 + Math.min(3, stats.haste),
      crit: Math.min(0.8, 0.05 + stats.crit),
      critPower: 1.6 + stats.critPower,
      armor: stats.armor,
      regen: 0.4 + stats.regen,
      leech: stats.leech,
      reach: 46 + stats.reach,
      cooldown: Math.max(0.25, 1 - stats.cooldown),
      gold: 1 + stats.gold,
      xp: (1 + stats.xp) * (hero.bloodUntil > tick ? 1.5 : 1),
      luck: stats.luck,
      burn: stats.burn + (hero.burnUntil > tick ? 0.7 : 0),
      chain: Math.min(0.9, stats.chain),
      execute: Math.min(0.35, stats.execute),
      spirit: stats.spirit,
      force: 1 + Math.min(4, stats.force),
      shatter: 1 + Math.min(4, stats.shatter),
      ricochet: Math.min(8, Math.floor(stats.ricochet)),
      lance,
      nova,
      powers,
    };
  }
  configureWorld(sim: Simulation): void {
    sim.world = this.configureTerrain(sim.world);
    sim.physical?.synchronizeLand(sim);
  }
  /** The same seed/region configuration is used by pre-allocation checkpoint validation. */
  configureTerrain(world: World): World {
    const s = this.state;
    const seed =
      s.mode === "town"
        ? s.townLand === 0
          ? s.seed
          : areaRecipe(s.seed, s.townLand * 4 + 1).landSeed
        : s.recipe.landSeed;
    if (world.seed !== seed) world = new World(seed);
    const town = {
      kind: "town" as const,
      x: 0,
      y: 0,
      radius: 265,
      layout: "town",
      name: townName(s.townLand),
    };
    const areas = Array.from({ length: 4 }, (_, i) => {
      const recipe =
        s.mode === "area" && s.recipe.index === s.townLand * 4 + i + 1
          ? s.recipe
          : areaRecipe(s.seed, s.townLand * 4 + i + 1);
      return {
        kind: "area" as const,
        x: recipe.x,
        y: recipe.y,
        radius: recipe.radius + 35,
        layout: recipe.layout,
        name: recipe.name,
      };
    });
    world.setRegions(
      [town, ...areas],
      s.mode === "town"
        ? town
        : {
            kind: "area",
            x: s.recipe.x,
            y: s.recipe.y,
            radius: s.recipe.radius + 35,
            layout: s.recipe.layout,
            name: s.recipe.name,
          },
    );
    return world;
  }
  onJoin(sim: Simulation, player: Player): void {
    const other = Object.values(this.state.heroes)[0];
    if (!Object.hasOwn(this.state.heroes, player.id))
      Object.defineProperty(this.state.heroes, player.id, {
        value: freshHero(other?.level ?? 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    const hero = this.hero(player.id);
    hero.hp = this.stats(player.id).health;
    if (this.state.mode === "area")
      this.place(player, this.state.recipe.x - 240, this.state.recipe.y + player.color * 12, sim);
  }
  private place(p: Player, x: number, y: number, sim: Simulation): void {
    const tick = sim.tick;
    sim.physical?.teleport(playerBodyId(p.id), x, y);
    p.x = p.px = x;
    p.y = p.py = y;
    p.vx = p.vy = 0;
    this.hero(p.id).invulnerableUntil = tick + 120;
    this.hero(p.id).recallUntil = 0;
  }
  private emit(
    sim: Simulation,
    type: CombatEvent["type"],
    x: number,
    y: number,
    owner = "",
    text = "",
    amount = 0,
    angle = 0,
    color = "#d3e7a1",
  ): void {
    const s = this.state;
    s.events.push({
      id: s.nextEvent++,
      tick: sim.tick,
      type,
      x,
      y,
      owner,
      text,
      amount,
      angle,
      color,
    });
    if (s.events.length > 96) s.events.shift();
  }
  startArea(sim: Simulation, index: number, recipe?: AreaRecipe): void {
    const next = recipe ?? areaRecipe(this.state.seed, index);
    validateArea(next);
    const s = this.state;
    s.recipe = structuredClone(next);
    s.area = next.index;
    s.mode = "area";
    s.townLand = s.recipe.land;
    s.kills = 0;
    s.spawned = 0;
    s.bossSpawned = false;
    s.cleared = false;
    s.enteredAt = sim.tick;
    s.clearTicks = 0;
    s.transition++;
    s.enemies = [];
    s.projectiles = [];
    s.drops = [];
    s.delayed = [];
    s.mechanics = [];
    this.configureWorld(sim);
    for (const player of sim.players.values()) {
      const hero = this.hero(player.id);
      hero.dead = false;
      hero.hp = Math.max(hero.hp, this.stats(player.id).health * 0.5);
      this.place(player, s.recipe.x - 230, s.recipe.y + (player.color - 2) * 12, sim);
    }
    for (const m of mechanicLayout(s.recipe))
      s.mechanics.push({
        id: s.nextId++,
        kind: m.kind,
        x: m.x,
        y: m.y,
        radius: m.radius,
        readyAt: 0,
        activeUntil: 0,
        pair: null,
      });
    const rifts = s.mechanics.filter((m) => m.kind === "rift");
    for (let i = 0; i < rifts.length; i++)
      rifts[i].pair = rifts[(i + 1) % rifts.length]?.id ?? null;
    this.spawnWave(sim);
    this.emit(
      sim,
      "portal",
      s.recipe.x - 230,
      s.recipe.y,
      "",
      `${s.recipe.name} · ${mechanicOf(s.recipe.signature).description}`,
    );
  }
  private enterTown(sim: Simulation, land = this.state.townLand): void {
    const s = this.state;
    s.mode = "town";
    s.townLand = land;
    s.transition++;
    s.enemies = [];
    s.projectiles = [];
    s.mechanics = [];
    s.drops = [];
    s.delayed = [];
    this.configureWorld(sim);
    for (const p of sim.players.values()) {
      const h = this.hero(p.id);
      h.dead = false;
      h.hp = this.stats(p.id).health;
      h.potions = 3;
      h.bought = [];
      p.energy = 100;
      this.place(p, -20 + p.color * 16, 55, sim);
    }
    this.emit(sim, "portal", 0, 30, "", `${townName(land)} · Rest, resupply, then travel outward.`);
  }
  nextArea(): number {
    return Math.max(this.state.townLand * 4 + 1, this.state.highest + 1);
  }
  canLead(sim: Simulation, id: string): boolean {
    return sim.players.keys().next().value === id;
  }
  shop(id: string): Item[] {
    const h = this.hero(id),
      seed = hash(this.state.townLand, h.level, this.state.seed + 983);
    return Array.from({ length: 6 }, (_, i) =>
      rollItem(
        seed,
        i + 1,
        Math.max(h.level, this.state.highest + 1),
        0,
        i === 5 ? "rare" : "magic",
        SLOTS[i % 4],
      ),
    );
  }
  action(sim: Simulation, id: string, action: AdventureAction): void {
    const p = sim.players.get(id);
    if (!p) throw new Error("Unknown traveler");
    const h = this.hero(id),
      s = this.state;
    if (!action || typeof action !== "object" || typeof action.type !== "string")
      throw new Error("Expected a game action");
    if (
      ["depart", "advance", "return", "new-run", "tuning"].includes(action.type) &&
      !this.canLead(sim, id)
    )
      throw new Error("The expedition leader controls the shared route and tuning");
    switch (action.type) {
      case "depart":
        if (s.mode !== "town") throw new Error("You are already in the wild");
        this.startArea(sim, this.nextArea());
        break;
      case "advance": {
        if (s.mode !== "area" || !s.cleared)
          throw new Error("Defeat the area's warden to open the outward gate");
        if (s.area % 4 === 0) this.enterTown(sim, s.recipe.land + 1);
        else this.startArea(sim, s.area + 1);
        break;
      }
      case "return":
        if (s.mode === "town") return;
        if (h.dead) this.enterTown(sim);
        else {
          h.recallUntil = sim.tick + 150;
          this.emit(sim, "portal", p.x, p.y, id, "Returning to town… stay still and avoid damage.");
        }
        break;
      case "respawn":
        if (!h.dead) throw new Error("Your lantern is still burning");
        if (
          s.mode === "area" &&
          [...sim.players.keys()].some((other) => other !== id && !this.hero(other).dead)
        ) {
          h.dead = false;
          h.hp = this.stats(id).health;
          h.potions = 3;
          p.energy = 100;
          this.place(p, s.recipe.x - 230, s.recipe.y + p.color * 12, sim);
          this.emit(sim, "portal", p.x, p.y, id, "Your lantern rekindles at the trailhead.");
        } else this.enterTown(sim);
        break;
      case "rest":
        if (s.mode !== "town") throw new Error("Rest at an apothecary in town");
        h.hp = this.stats(id).health;
        h.potions = 3;
        p.energy = 100;
        this.emit(sim, "potion", p.x, p.y, id, "Life, spirit and flasks restored.");
        break;
      case "skill": {
        const reason = skillReason(action.id, h.skills, h.points, h.level);
        if (reason) throw new Error(reason);
        h.skills[action.id] = (h.skills[action.id] ?? 0) + 1;
        h.points--;
        if (!h.dead) h.hp = Math.min(this.stats(id).health, h.hp + 18);
        this.emit(
          sim,
          "level",
          p.x,
          p.y,
          id,
          `${SKILLS.find((skill) => skill.id === action.id)!.name} learned.`,
        );
        break;
      }
      case "respec": {
        if (s.mode !== "town") throw new Error("Respec safely in town");
        const spent = Object.values(h.skills).reduce((sum, rank) => sum + rank, 0),
          cost = spent * 10;
        if (h.gold < cost) throw new Error(`Respec costs ${cost} gold`);
        h.gold -= cost;
        h.points += spent;
        h.skills = {};
        h.hp = Math.min(h.hp, this.stats(id).health);
        break;
      }
      case "equip": {
        const item = h.inventory.find((entry) => entry.id === action.id);
        if (!item) throw new Error("That item is not in your satchel");
        h.equipment[item.slot] = item.id;
        h.hp = Math.min(h.hp, this.stats(id).health);
        this.emit(sim, "loot", p.x, p.y, id, `Equipped ${item.name}.`);
        break;
      }
      case "sell": {
        if (s.mode !== "town") throw new Error("Sell equipment to Rowan in town");
        const item = h.inventory.find((entry) => entry.id === action.id);
        if (!item) throw new Error("Unknown item");
        if (Object.values(h.equipment).includes(item.id))
          throw new Error("Unequip an item by replacing it before selling");
        h.gold += item.value;
        h.inventory = h.inventory.filter((entry) => entry.id !== item.id);
        break;
      }
      case "buy": {
        if (s.mode !== "town") throw new Error("Visit the quartermaster in town");
        if (!Number.isInteger(action.index) || action.index < 0 || action.index > 5)
          throw new Error("Invalid stock index");
        const stock = this.shop(id)[action.index];
        if (h.bought.includes(stock.id)) throw new Error("Already purchased this stock");
        if (h.gold < stock.value * 2) throw new Error(`You need ${stock.value * 2} gold`);
        if (h.inventory.length >= INVENTORY_LIMIT)
          throw new Error("Satchel full: sell or equip your finds");
        const item = { ...stock, id: `purchase-${s.seed.toString(36)}-${s.nextId++}` };
        h.gold -= item.value * 2;
        h.inventory.push(item);
        h.bought.push(stock.id);
        this.emit(sim, "loot", p.x, p.y, id, `${item.name} added to your satchel.`);
        break;
      }
      case "sell-spares": {
        if (s.mode !== "town") throw new Error("Sell equipment to Rowan in town");
        const equipped = new Set(Object.values(h.equipment));
        const spare = h.inventory.filter(
          (item) => !equipped.has(item.id) && (item.rarity === "common" || item.rarity === "magic"),
        );
        const ids = new Set(spare.map((item) => item.id)),
          gold = spare.reduce((sum, item) => sum + item.value, 0);
        h.inventory = h.inventory.filter((item) => !ids.has(item.id));
        h.gold += gold;
        this.emit(
          sim,
          "loot",
          p.x,
          p.y,
          id,
          `Sold ${spare.length} spare items for ${gold} gold. Rare and legendary finds kept.`,
        );
        break;
      }
      case "tuning":
        this.tune(sim, action.values);
        break;
      case "new-run": {
        const next = initialState(hash(s.run, 321, s.seed));
        next.run = s.run + 1;
        next.tuning = { ...s.tuning };
        this.state = next;
        for (const player of sim.players.values()) this.hero(player.id);
        this.enterTown(sim, 0);
        break;
      }
      case "grab": {
        if (!sim.physical) throw new Error("Grabbing needs the host's physical scene");
        if (h.dead) throw new Error("The fallen cannot lift anything");
        sim.physical.release(sim, id, false);
        sim.physical.grab(sim, id, action.id);
        this.emit(sim, "grab", p.x, p.y, id, action.id);
        break;
      }
      case "release": {
        if (!sim.physical) throw new Error("Grabbing needs the host's physical scene");
        if (typeof action.throw !== "boolean")
          throw new Error("Release needs throw: true or false");
        const released = sim.physical.release(sim, id, action.throw);
        if (!released) throw new Error("You are not holding anything");
        this.emit(sim, "grab", p.x, p.y, id, `${action.throw ? "throw" : "drop"}:${released}`);
        break;
      }
      default:
        throw new Error("Unknown game action");
    }
  }
  tune(sim: Simulation, values: Partial<Tuning>): void {
    if (!values || typeof values !== "object" || Array.isArray(values))
      throw new Error("Expected tuning multipliers");
    for (const [key, value] of Object.entries(values))
      if (
        !Object.hasOwn(DEFAULT_TUNING, key) ||
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0.1 ||
        value > (key.endsWith("Speed") ? 3 : 10)
      )
        throw new Error(`Invalid tuning value: ${key}`);
    const ratios = new Map(
      [...sim.players.keys()].map((id) => [id, this.hero(id).hp / this.stats(id).health]),
    );
    Object.assign(this.state.tuning, values);
    for (const id of sim.players.keys())
      this.hero(id).hp = this.stats(id).health * (ratios.get(id) ?? 1);
    for (const enemy of this.state.enemies) {
      const ratio = enemy.hp / enemy.maxHp;
      enemy.maxHp = enemy.baseHealth * this.state.tuning.enemyHealth * this.state.tuning.difficulty;
      enemy.hp = enemy.maxHp * ratio;
    }
  }
  interact(sim: Simulation, p: Player): boolean {
    const s = this.state;
    if (s.mode === "town") {
      if (Math.hypot(p.x - 218, p.y - 36) < 64) {
        if (!this.canLead(sim, p.id)) {
          this.emit(sim, "portal", p.x, p.y, p.id, "The expedition leader opens the outward gate.");
          return true;
        }
        this.action(sim, p.id, { type: "depart" });
        return true;
      }
      // Services follow their townsperson, wherever a shove has moved them (M09).
      const npc = TOWN_NPCS.find((n) => {
        const point = sim.physical?.npcPoint(n.id) ?? npcPosition(n, sim.tick);
        return Math.hypot(p.x - point.x, p.y - point.y) < 42;
      });
      if (npc) {
        this.emit(sim, "portal", npc.x, npc.y, p.id, `service:${npc.service}`);
        return true;
      }
      if (Math.hypot(p.x, p.y) < 58) {
        this.action(sim, p.id, { type: "rest" });
        return true;
      }
      return false;
    }
    const drop = s.drops.find((d) => d.kind === "item" && Math.hypot(d.x - p.x, d.y - p.y) < 48);
    if (drop?.item) {
      const hero = this.hero(p.id);
      if (hero.inventory.length >= INVENTORY_LIMIT) {
        this.emit(sim, "loot", p.x, p.y, p.id, "Satchel full. Visit Rowan to sell equipment.");
        return true;
      }
      hero.inventory.push(drop.item);
      s.drops = s.drops.filter((d) => d.id !== drop.id);
      this.emit(sim, "loot", drop.x, drop.y, p.id, `Found ${drop.item.name}.`);
      return true;
    }
    if (s.cleared && Math.hypot(p.x - s.recipe.x - 275, p.y - s.recipe.y) < 68) {
      if (this.canLead(sim, p.id)) this.action(sim, p.id, { type: "advance" });
      else
        this.emit(
          sim,
          "portal",
          p.x,
          p.y,
          p.id,
          "Collect your finds; the leader opens the next area.",
        );
      return true;
    }
    if (Math.hypot(p.x - s.recipe.x + 265, p.y - s.recipe.y - 95) < 45) {
      if (this.canLead(sim, p.id)) this.action(sim, p.id, { type: "return" });
      else this.emit(sim, "portal", p.x, p.y, p.id, "The leader can return the party to town.");
      return true;
    }
    for (const m of s.mechanics)
      if (
        m.readyAt <= sim.tick &&
        Math.hypot(p.x - m.x, p.y - m.y) < 48 &&
        (m.kind === "blood" || m.kind === "rift")
      ) {
        this.activate(sim, m, p.id);
        return true;
      }
    return false;
  }
  dash(sim: Simulation, p: Player): void {
    const h = this.hero(p.id),
      stats = this.stats(p.id, sim.tick);
    h.dashUntil = sim.tick + 9;
    h.dashAngle = p.facing;
    h.lastDash = sim.tick;
    h.invulnerableUntil = Math.max(h.invulnerableUntil, sim.tick + 16);
    if (stats.powers.includes("gale")) p.dashCooldown *= 0.75;
    // A dash tears free of a Bloom Tyrant's lash, and the torn vine exposes it (M10).
    for (const body of sim.physical?.breakLashes(sim, p.id) ?? []) {
      const warden = this.state.enemies.find((e) => enemyBodyId(e.id) === body);
      if (warden) this.expose(sim, warden, "lash", p.id);
    }
    // Dash shoulders loose props out of the path (no damage); they stay this hero's for impacts.
    if (sim.physical)
      sim.physical.damageProps(sim, {
        owner: p.id,
        cause: "dash",
        x: p.x + Math.cos(p.facing) * 30,
        y: p.y + Math.sin(p.facing) * 30,
        radius: 42,
        damage: 0,
        angle: p.facing,
        arc: Math.PI,
        impulse: ATTACKS.dash.impulse * stats.force,
        torque: ATTACKS.dash.torque,
        material: 0,
        team: "party",
      });
    if (stats.powers.includes("thunder"))
      this.state.delayed.push({
        tick: sim.tick + 9,
        owner: p.id,
        x: p.x + Math.cos(p.facing) * 65,
        y: p.y + Math.sin(p.facing) * 65,
        radius: 85,
        damage: stats.damage * 1.6,
        kind: "glass",
      });
  }
  aim(p: Player): number {
    if (Math.hypot(p.input.aimX ?? 0, p.input.aimY ?? 0) > 0.01)
      return Math.atan2(p.input.aimY ?? 0, p.input.aimX ?? 0);
    let nearest: Enemy | undefined,
      d = 380 ** 2;
    for (const e of this.state.enemies) {
      const distance = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
      if (e.hp > 0 && distance < d) {
        nearest = e;
        d = distance;
      }
    }
    return nearest ? Math.atan2(nearest.y - p.y, nearest.x - p.x) : p.facing;
  }
  private attack(sim: Simulation, p: Player, ability: Hero["lastAbility"]): void {
    const h = this.hero(p.id),
      stats = this.stats(p.id, sim.tick),
      tick = sim.tick;
    if (h.dead) return;
    const key = `${ability}Ready` as "slashReady" | "whorlReady" | "lanceReady" | "novaReady";
    if (
      h[key] > tick ||
      (ability === "lance" && !stats.lance) ||
      (ability === "nova" && !stats.nova)
    )
      return;
    const cost = { slash: 0, whorl: 20, lance: 17, nova: 35 }[ability];
    if (p.energy < cost) return;
    p.energy -= cost;
    const angle = this.aim(p);
    p.facing = angle;
    h.attackAngle = angle;
    h.attackAt = tick;
    h.attackUntil = tick + 16;
    h.lastAbility = ability;
    const color = ability === "lance" ? "#a5e3e4" : ability === "nova" ? "#efbe83" : "#ddebc0";
    this.emit(sim, ability, p.x, p.y, p.id, "", 0, angle, color);
    if (ability === "slash") {
      h.combo = tick > h.comboUntil ? 0 : (h.combo + 1) % 3;
      h.comboUntil = tick + 55;
      h.slashReady = tick + Math.max(6, Math.round([17, 16, 22][h.combo] / stats.haste));
      this.damageArea(
        sim,
        p.id,
        p.x,
        p.y,
        stats.reach + h.combo * 5,
        stats.damage * [1, 1.15, 1.8][h.combo],
        angle,
        stats.powers.includes("cleave") && h.combo === 2 ? Math.PI : 1.1 + h.combo * 0.18,
        `slash${h.combo}`,
      );
      sim.actorImpulse(playerBodyId(p.id), Math.cos(angle) * 28, Math.sin(angle) * 28);
    } else if (ability === "lance") {
      h.lanceReady = tick + Math.round(48 * stats.cooldown);
      this.projectile(
        p.x,
        p.y,
        angle,
        470,
        stats.damage * 2.7,
        p.id,
        false,
        54,
        ATTACKS.lance.pierce,
        stats.ricochet,
      );
    } else {
      const radius = ability === "whorl" ? 102 : 155;
      const damage = stats.damage * (ability === "whorl" ? 2 : 3.8);
      h[key] = tick + Math.round((ability === "whorl" ? 95 : 270) * stats.cooldown);
      this.damageArea(sim, p.id, p.x, p.y, radius, damage, 0, Math.PI, ability);
      if (stats.powers.includes("echo") && ability === "whorl")
        this.state.delayed.push({
          tick: tick + 22,
          x: p.x,
          y: p.y,
          owner: p.id,
          radius,
          damage: damage * 0.7,
          kind: "echo",
          ability: "whorl",
        });
    }
    for (const m of this.state.mechanics) {
      if (
        m.kind === "echo" &&
        ability !== "slash" &&
        Math.hypot(p.x - m.x, p.y - m.y) < 100 &&
        m.readyAt <= tick
      ) {
        m.readyAt = tick + 110;
        m.activeUntil = tick + 45;
        this.state.mechanicUses++;
        this.state.delayed.push({
          tick: tick + 28,
          x: m.x,
          y: m.y,
          owner: p.id,
          radius: ability === "nova" ? 155 : 102,
          damage: stats.damage * (ability === "nova" ? 3.8 : ability === "lance" ? 2.7 : 2),
          kind: "echo",
          ability: ability as "whorl" | "lance" | "nova",
          angle,
        });
        if (this.state.recipe.combination?.from === "echo")
          this.state.delayed.push({
            tick: tick + 24,
            x: m.x,
            y: m.y,
            owner: p.id,
            radius: 130,
            damage: stats.damage * 2,
            kind: this.state.recipe.combination.into,
          });
      } else if (["bramble", "glass", "gravity"].includes(m.kind)) {
        const dx = m.x - p.x,
          dy = m.y - p.y,
          r = ability === "slash" ? stats.reach + 28 : ability === "whorl" ? 130 : 190;
        if (
          Math.hypot(dx, dy) < r &&
          (ability !== "slash" || Math.cos(Math.atan2(dy, dx) - angle) > -0.1)
        )
          this.activate(sim, m, p.id);
      }
    }
  }
  private damageArea(
    sim: Simulation,
    owner: string,
    x: number,
    y: number,
    radius: number,
    damage: number,
    angle = 0,
    arc = Math.PI,
    cause = "attack",
    spare: readonly string[] = [],
  ): void {
    for (const enemy of [...this.state.enemies]) {
      const dx = enemy.x - x,
        dy = enemy.y - y;
      if (
        enemy.hp > 0 &&
        Math.hypot(dx, dy) < radius + enemy.radius &&
        (arc >= Math.PI || Math.cos(Math.atan2(dy, dx) - angle) >= Math.cos(arc))
      )
        this.hit(sim, enemy, damage, owner, x, y);
    }
    // The same authored hit reaches scenery through its interaction spec; the base enemy hit
    // above is unchanged. A hero's force and shatter stats scale the physical part only.
    const physical = sim.physical;
    if (physical) {
      const spec = attackRecipe(cause),
        stats = Object.hasOwn(this.state.heroes, owner) ? this.stats(owner, sim.tick) : null;
      this.propEffects(
        sim,
        owner,
        angle,
        physical.damageProps(sim, {
          owner,
          cause,
          x,
          y,
          radius,
          damage,
          angle,
          arc,
          impulse: spec.impulse * (stats?.force ?? 1),
          torque: spec.torque,
          material: spec.material * (stats?.shatter ?? 1),
          team: spec.team,
          // M08: burning strikes (Cinderwake, burn skills) set flammable scenery alight.
          ...(stats && stats.burn > 0 ? { element: "fire" as const } : {}),
          ...(spare.length ? { spare } : {}),
        }),
      );
    }
  }
  /** Agent/QA strike on one prop: the attack path's material damage, rewards and feedback. */
  strikeProp(sim: Simulation, owner: string, id: string, damage: number, angle = 0): PropHit[] {
    const physical = sim.physical;
    if (!physical) throw new Error("Only the host can damage shared scenery");
    const target = physical.world.pose(id);
    const hits = physical.damageProps(sim, {
      owner,
      cause: "agent",
      x: target.x,
      y: target.y,
      radius: 0,
      damage,
      angle,
      only: id,
    });
    this.propEffects(sim, owner, angle, hits);
    return hits;
  }
  /**
   * Agent/QA (M09): a monster with a chosen rig, uncounted for the area goal. `passive` keeps it
   * planted and never attacking, so its hit, stagger and death can be inspected.
   */
  spawnMonster(
    sim: Simulation,
    rig: RigKind,
    x: number,
    y: number,
    options: { hp?: number; passive?: boolean; boss?: boolean; clear?: boolean } = {},
  ): Enemy {
    if (this.state.mode !== "area") throw new Error("Monsters can only be placed in an area");
    if (!RIGS.includes(rig)) throw new Error("Unknown rig");
    // QA isolation: other live monsters leave (no kill, no reward) and no further waves come.
    if (options.clear) {
      this.state.enemies = this.state.enemies.filter((e) => e.hp <= 0);
      this.state.spawned = Math.max(this.state.spawned, this.state.recipe.killGoal);
      this.state.bossSpawned = true;
    }
    const behavior = (Object.keys(ARCHETYPES) as BehaviorId[]).find(
      (b) => ARCHETYPES[b].rig === rig,
    )!;
    const before = this.state.enemies.length;
    this.spawnEnemy(
      sim,
      this.state.spawned + this.state.enemies.length + 1000,
      x,
      y,
      !!options.boss,
      false,
    );
    if (this.state.enemies.length === before) throw new Error("The live monster budget is full");
    const e = this.state.enemies.at(-1)!;
    e.rig = rig;
    if (!options.boss) {
      e.behavior = behavior;
      e.name = ARCHETYPES[behavior].name;
      e.radius = behavior === "sentinel" || behavior === "charger" ? 11 : 7;
    }
    e.x = e.px = x;
    e.y = e.py = y;
    if (options.hp !== undefined) e.hp = e.maxHp = Math.max(1, options.hp);
    if (options.passive) {
      // Within the validated tick range (saves stay valid).
      e.rootUntil = 1e11;
      e.nextAttack = 1e11;
    }
    sim.physical?.teleport(enemyBodyId(e.id), x, y);
    return e;
  }
  /**
   * Agent/QA (M10): use an area mechanic as this hero through its ordinary activation (the
   * mechanic must be ready). Returns the mechanic.
   */
  useMechanic(sim: Simulation, owner: string, id: number): Mechanic {
    const m = this.state.mechanics.find((mechanic) => mechanic.id === id);
    if (!m) throw new Error("Unknown mechanic");
    if (!sim.players.has(owner)) throw new Error("Unknown traveler");
    if (m.readyAt > sim.tick) throw new Error("Mechanic is not ready");
    this.activate(sim, m, owner);
    return structuredClone(m);
  }
  /**
   * Agent/QA (M10): a living warden starts telegraphing its signature move on its next attack,
   * which is due now. Returns the warden.
   */
  wardenSignature(sim: Simulation, id: number): Enemy {
    const e = this.state.enemies.find((enemy) => enemy.id === id && enemy.hp > 0);
    if (!e?.boss) throw new Error("No living warden with that id");
    e.attacks = 0;
    e.nextAttack = sim.tick;
    if (e.phase !== "charge") {
      e.phase = "walk";
      e.timer = 0;
    }
    e.warden ??= freshWarden();
    return e;
  }
  /** Agent/QA (M09): a blow to a monster through the ordinary hit path, credited to `owner`. */
  strikeEnemy(sim: Simulation, owner: string, id: number, damage: number, angle: number): Enemy {
    const e = this.state.enemies.find((enemy) => enemy.id === id && enemy.hp > 0);
    if (!e) throw new Error("Unknown or defeated monster");
    this.hit(sim, e, damage, owner, e.x - Math.cos(angle) * 30, e.y - Math.sin(angle) * 30);
    return e;
  }
  /** Gameplay-owned consequences of scenery hits: one-time party gold and readable feedback. */
  private propEffects(
    sim: Simulation,
    owner: string,
    angle: number,
    hits: PropHit[],
    quiet = false,
  ): void {
    const s = this.state;
    let shown = 0;
    for (const hit of hits) {
      const color = MATERIALS[hit.material].colors[1];
      if (hit.broken) {
        // Scenery rewards go to the party only for a hero's own destruction.
        if (hit.broken.reward > 0 && Object.hasOwn(s.heroes, owner)) {
          s.drops.push({
            id: s.nextId++,
            x: hit.x,
            y: hit.y + 4,
            born: sim.tick,
            kind: "gold",
            amount: hit.broken.reward,
          });
          if (s.drops.length > 150) s.drops = s.drops.slice(-150);
        }
        this.emit(
          sim,
          "break",
          hit.x,
          hit.y,
          owner,
          `${hit.family}:${hit.material}`,
          hit.broken.pieces.length,
          angle,
          color,
        );
      } else if (!quiet && shown++ < 6)
        this.emit(
          sim,
          "impact",
          hit.x,
          hit.y,
          owner,
          `${hit.material}:${hit.resisted ? "resisted" : hit.protectedByPolicy ? "protected" : `stage${hit.stage}`}`,
          Math.round(hit.damage * 10) / 10,
          angle,
          color,
        );
    }
  }
  /**
   * M06 projectile-world collision. Enemy shots treat props and rooted terrain as cover; a
   * Thornlance pierces soft scenery (wood costs a pierce, fragile material none) and stops on
   * hard scenery unless it has ricochets left. Off in a region: base target hits only.
   */
  private projectileScenery(sim: Simulation, projectile: Projectile): boolean {
    const physical = sim.physical!,
      spec = projectile.enemy ? ATTACKS.shot : ATTACKS.lance;
    if (!physical.policyAt(sim, projectile.px, projectile.py).effective.projectileWorld)
      return false;
    projectile.scenery ??= [];
    const hero = Object.hasOwn(this.state.heroes, projectile.owner),
      stats = hero ? this.stats(projectile.owner, sim.tick) : null;
    let sx = projectile.px,
      sy = projectile.py;
    for (let n = 0; n < 6; n++) {
      const dx = projectile.x - sx,
        dy = projectile.y - sy;
      if (Math.hypot(dx, dy) < 0.01) return false;
      const hit = physical.sceneryHit(sx, sy, dx, dy, projectile.radius, projectile.scenery);
      if (!hit) return false;
      const hx = sx + dx * hit.fraction,
        hy = sy + dy * hit.fraction,
        heading = Math.atan2(projectile.vy, projectile.vx);
      projectile.scenery.push(hit.id);
      if (projectile.scenery.length > 64) projectile.scenery.shift();
      if (hit.role === "prop")
        this.propEffects(
          sim,
          projectile.owner,
          heading,
          physical.damageProps(sim, {
            owner: projectile.owner,
            cause: spec.kind,
            x: hx,
            y: hy,
            radius: 64, // `only` names the struck prop; the contact point lies on its surface.
            damage: projectile.damage,
            angle: heading,
            only: hit.id,
            impulse: spec.impulse * (stats?.force ?? 1),
            torque: spec.torque,
            material: spec.material * (stats?.shatter ?? 1),
            team: spec.team,
            ...(stats && stats.burn > 0 ? { element: "fire" as const } : {}),
          }),
        );
      const material = hit.material ?? "stone",
        hard =
          hit.role === "terrain" ||
          hit.family === "stump" ||
          (HARD_MATERIALS as readonly string[]).includes(material);
      if (spec.scenery === "cover" || (hard && !(projectile.ricochet ?? 0))) {
        projectile.x = hx;
        projectile.y = hy;
        this.emit(sim, "impact", hx, hy, projectile.owner, `${material}:cover`, 0, heading);
        return true;
      }
      if (hard) {
        // Reflect about the scenery's outward normal and continue with the remaining travel.
        projectile.ricochet = (projectile.ricochet ?? 0) - 1;
        const dot = projectile.vx * hit.nx + projectile.vy * hit.ny,
          remaining = (1 - hit.fraction) / 60;
        projectile.vx -= 2 * dot * hit.nx;
        projectile.vy -= 2 * dot * hit.ny;
        sx = hx + hit.nx;
        sy = hy + hit.ny;
        projectile.x = sx + projectile.vx * remaining;
        projectile.y = sy + projectile.vy * remaining;
        projectile.hit = [];
        this.emit(sim, "impact", hx, hy, projectile.owner, `${material}:deflect`, 0, heading);
        continue;
      }
      if (material === "wood" && hit.family !== "debris" && --projectile.pierce < 0) {
        projectile.x = hx;
        projectile.y = hy;
        return true;
      }
      sx = hx;
      sy = hy;
    }
    return false;
  }
  /**
   * M08 reaction damage and events from the previous solve: fire, shock and blasts reach
   * monsters through the ordinary hit path (credited to the chain's owner) and scenery through
   * the same material damage, rewards and feedback as an attack.
   */
  private applyReactions(sim: Simulation): void {
    const physical = sim.physical!;
    for (const d of physical.reactions.takeDamage()) {
      const owner = Object.hasOwn(this.state.heroes, d.owner) ? d.owner : "";
      if (d.kind === "creature") {
        if (d.team === "enemy") continue;
        const e = this.state.enemies.find((en) => enemyBodyId(en.id) === d.target);
        if (!e || e.hp <= 0) continue;
        // Vyr is exposed by a shock that reaches it while it is wet.
        if (e.boss && d.cause === "shock" && (physical.reactions.status(d.target)?.wet ?? 0) > 0)
          this.expose(sim, e, "shock", owner);
        this.hit(
          sim,
          e,
          d.damage,
          owner,
          e.x - Math.cos(d.angle) * 20,
          e.y - Math.sin(d.angle) * 20,
          true,
        );
      } else if (d.kind === "area" || physical.world.has(d.target))
        this.propEffects(
          sim,
          d.owner,
          d.angle,
          physical.damageProps(sim, {
            owner: d.owner,
            cause: d.cause,
            x: d.x,
            y: d.y,
            radius: d.kind === "area" ? d.radius : 64,
            damage: d.damage,
            angle: d.angle,
            ...(d.kind === "prop" ? { only: d.target } : d.target ? { except: d.target } : {}),
            impulse: 0,
            material: 1,
            team: d.team,
            chain: d.chain,
          }),
          // Fire pulses read through the flames; only a resulting break gets its own effect.
          d.cause === "fire",
        );
    }
    for (const e of physical.reactions.take()) {
      // Soaking and oiling show on the bodies themselves; they stay in the reaction history.
      if (e.rule === "soak" || e.rule === "coat") continue;
      const length = Math.hypot(e.x - e.fromX, e.y - e.fromY),
        color = REACTION_COLORS[e.rule] ?? "#e9d9a8";
      this.emit(
        sim,
        "reaction",
        length > 1 ? e.fromX : e.x,
        length > 1 ? e.fromY : e.y,
        e.owner,
        e.text,
        Math.round(length * 10) / 10,
        length > 1 ? Math.atan2(e.y - e.fromY, e.x - e.fromX) : 0,
        color,
      );
    }
  }
  /** Launched-prop impacts: damage through the ordinary hit path with the recorded owner. */
  private applyImpacts(sim: Simulation, impacts: PendingImpact[]): void {
    for (const impact of impacts) {
      if (impact.target.startsWith("enemy-")) {
        const e = this.state.enemies.find((en) => enemyBodyId(en.id) === impact.target);
        if (!e || e.hp <= 0 || impact.team === "enemy") continue;
        const owner = Object.hasOwn(this.state.heroes, impact.owner) ? impact.owner : "";
        this.emit(
          sim,
          "impact",
          impact.x,
          impact.y,
          owner,
          "impact:hit",
          impact.damage,
          impact.angle,
        );
        // The Hollow Atlas is exposed by a prop a traveler launched into it.
        if (e.boss && owner) this.expose(sim, e, "impact", owner);
        this.hit(sim, e, impact.damage, owner, impact.x, impact.y, true);
      } else if (impact.target.startsWith("player-")) {
        const p = sim.players.get(impact.target.slice(7));
        if (p && impact.team === "enemy")
          this.damageHero(sim, p, impact.damage * 0.6, impact.x, impact.y);
      } else if (sim.physical?.world.has(impact.target))
        this.propEffects(
          sim,
          impact.owner,
          impact.angle,
          sim.physical.damageProps(sim, {
            owner: impact.owner,
            cause: "impact",
            x: impact.x,
            y: impact.y,
            radius: 64,
            damage: impact.damage,
            angle: impact.angle,
            only: impact.target,
            impulse: 0,
            team: impact.team,
          }),
        );
    }
  }
  private hit(
    sim: Simulation,
    e: Enemy,
    damage: number,
    owner: string,
    fromX: number,
    fromY: number,
    secondary = false,
  ): void {
    if (e.hp <= 0) return;
    const h = Object.hasOwn(this.state.heroes, owner) ? this.state.heroes[owner] : null,
      stats = h ? this.stats(owner, sim.tick) : null;
    const critical =
      stats && random(e.id, sim.tick + this.state.nextEvent, this.state.seed) < stats.crit;
    // An exposed warden (M10) takes more damage while its weakness lasts.
    const exposed = (e.warden?.exposedUntil ?? 0) > sim.tick ? EXPOSED.damage : 1;
    const amount = Math.max(1, Math.round(damage * exposed * (critical ? stats!.critPower : 1)));
    e.hp -= amount;
    e.hurtUntil = sim.tick + 7;
    if (!e.boss && e.phase === "windup") {
      e.phase = "recover";
      e.timer = 12;
    }
    const d = Math.hypot(e.x - fromX, e.y - fromY) || 1,
      rig = rigOf(e.rig),
      dx = d > 1e-6 ? (e.x - fromX) / d : 0,
      dy = d > 1e-6 ? (e.y - fromY) / d : 0;
    sim.actorImpulse(
      enemyBodyId(e.id),
      dx * (e.boss ? 12 : 65) * rig.knockback,
      dy * (e.boss ? 12 : 65) * rig.knockback,
    );
    this.rigHit(sim, e, dx, dy, amount, secondary);
    this.emit(
      sim,
      "hit",
      e.x,
      e.y - 15,
      owner,
      critical ? "crit" : "",
      amount,
      0,
      critical ? "#f4d98d" : "#e9ebd6",
    );
    // M10 Conductor yard: in a Stormglass area a hero's strike on a wet monster arcs through
    // the wet pack. An arced monster stays charged for a moment, so one strike arcs once.
    if (h && !secondary && sim.physical && this.state.recipe.mechanics.includes("glass")) {
      const body = enemyBodyId(e.id),
        status = sim.physical.reactions.status(body);
      if (status && status.wet > 0 && !status.charged && sim.physical.world.has(body))
        sim.physical.stimulate(sim, "shock", {
          x: e.x,
          y: e.y,
          target: body,
          owner,
          team: "party",
          cause: "stormglass:arc",
          strength: ARC_STRENGTH,
        });
    }
    if (h && stats) {
      h.hp = Math.min(stats.health, h.hp + stats.leech);
      if (stats.burn > 0 && !secondary) {
        e.burnUntil = sim.tick + 150;
        e.burnDamage = (amount * stats.burn) / 5;
        e.burnOwner = owner;
      }
      if (stats.execute > 0 && e.hp / e.maxHp < stats.execute && !e.boss) e.hp = 0;
      if (
        !secondary &&
        stats.chain > 0 &&
        random(e.id, sim.tick, this.state.seed + 982) < stats.chain
      ) {
        const target = this.state.enemies.find(
          (other) =>
            other.id !== e.id && other.hp > 0 && Math.hypot(other.x - e.x, other.y - e.y) < 130,
        );
        if (target) {
          this.emit(
            sim,
            "lance",
            e.x,
            e.y,
            owner,
            "chain",
            Math.hypot(target.x - e.x, target.y - e.y),
            Math.atan2(target.y - e.y, target.x - e.x),
            "#a7dfe6",
          );
          this.hit(sim, target, amount * 0.55, owner, e.x, e.y, true);
        }
      }
    }
    if (e.hp <= 0 && e.phase !== "dead") this.kill(sim, e, owner);
  }
  /**
   * M09 rig response to a blow: recoil, poise, stagger, knockdown and shed armor. Reaction
   * strength comes from the monster's region; stagger, knockdown and shedding need effective
   * world reactions. A stagger or knockdown interrupts the attack it was winding up.
   */
  private rigHit(
    sim: Simulation,
    e: Enemy,
    dx: number,
    dy: number,
    amount: number,
    secondary: boolean,
  ): void {
    const policy = sim.physical?.policyAt(sim, e.x, e.y),
      strength = policy ? policy.values.reactionStrength : 1,
      outcome = hitReaction(rigOf(e.rig), e.reaction, {
        dx,
        dy,
        speed: 65 + Math.min(120, amount * 2),
        percent: (amount / e.maxHp) * 100 * (secondary ? 0.6 : 1),
        strength,
        physical: policy ? policy.effective.worldReactions : true,
        boss: e.boss,
        tick: sim.tick,
      });
    if (outcome.toppled || outcome.staggered) {
      if (e.phase === "windup" || e.phase === "charge") {
        e.phase = "recover";
        e.timer = outcome.toppled ? rigOf(e.rig).toppleTicks : 14;
      } else if (outcome.toppled) {
        e.phase = "recover";
        e.timer = Math.max(e.timer, rigOf(e.rig).toppleTicks);
      }
      this.emit(
        sim,
        "rig",
        e.x,
        e.y,
        "",
        `${outcome.toppled ? "topple" : "stagger"}:${e.rig}`,
        e.boss ? 3 : outcome.toppled ? 2 : 1,
        Math.atan2(dy, dx),
        "#efd9a6",
      );
    }
    if (outcome.shed >= 0 && sim.physical) {
      const material = sim.physical.shed(sim, e, outcome.shed);
      if (material)
        this.emit(sim, "rig", e.x, e.y, "", `shed:${e.rig}:${material}`, 1, Math.atan2(dy, dx));
    }
  }
  private kill(sim: Simulation, e: Enemy, owner: string): void {
    const s = this.state;
    e.hp = 0;
    e.phase = "dead";
    e.deadAt = sim.tick;
    e.vx = e.vy = 0;
    if (e.counted) s.kills++;
    s.totalKills++;
    if (!owner && !e.boss) {
      // An unowned rolling object (M06) ends the fight but invents no hero credit or rewards.
      this.emit(sim, "kill", e.x, e.y, "", "environment", 1);
      return;
    }
    const h = Object.hasOwn(s.heroes, owner) ? s.heroes[owner] : null,
      stats = h ? this.stats(owner, sim.tick) : null;
    if (h) h.kills++;
    const gold = Math.round((e.boss ? 60 : e.elite ? 12 : 4) * (1 + Math.min(s.area, 500) * 0.13));
    const xp = Math.round((e.boss ? 140 : e.elite ? 35 : 19) * (1 + Math.min(s.area, 500) * 0.09));
    s.drops.push(
      { id: s.nextId++, x: e.x - 4, y: e.y, born: sim.tick, kind: "gold", amount: gold },
      { id: s.nextId++, x: e.x + 4, y: e.y, born: sim.tick, kind: "xp", amount: xp },
    );
    if (e.boss || e.elite || random(e.id, s.area, s.seed + 989) < 0.23) {
      const item = rollItem(
        s.recipe.seed,
        s.nextId++,
        Math.max(s.area, h?.level ?? 1),
        stats?.luck ?? 0,
        e.boss ? (s.area % 4 === 0 ? "legendary" : "rare") : undefined,
      );
      s.drops.push({
        id: s.nextId++,
        x: e.x,
        y: e.y + 7,
        born: sim.tick,
        kind: "item",
        amount: 1,
        item,
      });
    }
    this.emit(sim, "kill", e.x, e.y, owner, e.boss ? `${e.name} defeated` : "", e.boss ? 3 : 1);
    if (
      stats &&
      h &&
      h.procReady <= sim.tick &&
      (stats.powers.includes("thornburst") ||
        (stats.powers.includes("inferno") && e.burnUntil > sim.tick))
    ) {
      h.procReady = sim.tick + 18;
      s.delayed.push({
        tick: sim.tick + 1,
        x: e.x,
        y: e.y,
        owner,
        radius: 85,
        damage: stats.damage * 1.1,
        kind: "bramble",
      });
    }
    if (e.boss) {
      s.cleared = true;
      s.highest = Math.max(s.highest, s.area);
      s.clearTicks = sim.tick - s.enteredAt;
      for (const [id, hero] of Object.entries(s.heroes)) {
        hero.potions = Math.min(3, hero.potions + 1);
        this.gainXp(sim, id, Math.round(xp * 0.5 * this.stats(id, sim.tick).xp));
      }
      this.emit(
        sim,
        "portal",
        s.recipe.x + 275,
        s.recipe.y,
        "",
        s.area % 4 === 0
          ? "The way to a new land is open. Rest and resupply in its town."
          : "The outward gate is open. Another area awaits.",
      );
    }
    if (s.drops.length > 150) s.drops = s.drops.slice(-150);
  }
  private gainXp(sim: Simulation, id: string, amount: number): void {
    const h = this.hero(id);
    h.xp += amount;
    while (h.xp >= xpForLevel(h.level) && h.level < 1_000_000) {
      h.xp -= xpForLevel(h.level);
      h.level++;
      h.points++;
      if (!h.dead) h.hp = this.stats(id).health;
      const p = sim.players.get(id);
      if (p) this.emit(sim, "level", p.x, p.y, id, `Level ${h.level} · a new skill point`, h.level);
    }
  }
  private damageHero(sim: Simulation, p: Player, amount: number, x: number, y: number): void {
    const h = this.hero(p.id);
    if (h.dead || h.invulnerableUntil > sim.tick || this.state.mode === "town") return;
    const stats = this.stats(p.id, sim.tick),
      damage = Math.max(
        1,
        Math.round(
          (amount * this.state.tuning.enemyDamage * this.state.tuning.difficulty) /
            (1 + stats.armor / 90),
        ),
      );
    h.hp = Math.max(0, h.hp - damage);
    h.hurtUntil = sim.tick + 12;
    h.invulnerableUntil = sim.tick + 16;
    h.lastHit = sim.tick;
    h.recallUntil = 0;
    const d = Math.hypot(p.x - x, p.y - y) || 1;
    sim.actorImpulse(playerBodyId(p.id), ((p.x - x) / d) * 80, ((p.y - y) / d) * 80);
    // M09: a controlled lean and a swinging lantern; input and movement stay untouched.
    recoilHit(
      h.recoil,
      (p.x - x) / d,
      sim.physical?.policyAt(sim, p.x, p.y).values.reactionStrength ?? 1,
    );
    this.emit(sim, "hurt", p.x, p.y - 20, p.id, "", damage, 0, "#ef9b8f");
    if (h.hp <= 0) {
      h.dead = true;
      h.deaths++;
      h.goldLost = Math.floor(h.gold * 0.1);
      h.gold -= h.goldLost;
      this.emit(
        sim,
        "death",
        p.x,
        p.y,
        p.id,
        "Your lantern dims. Return to town with your build intact.",
      );
    }
  }
  private potion(sim: Simulation, p: Player): void {
    const h = this.hero(p.id),
      stats = this.stats(p.id, sim.tick);
    if (h.dead || h.potions <= 0 || h.potionReady > sim.tick || h.hp >= stats.health) return;
    h.potions--;
    h.potionReady = sim.tick + 75;
    h.hp = Math.min(
      stats.health,
      h.hp + stats.health * (stats.powers.includes("ward") ? 0.85 : 0.6),
    );
    this.emit(sim, "potion", p.x, p.y, p.id, "Flask restored life.");
    if (stats.powers.includes("bloom"))
      this.damageArea(sim, p.id, p.x, p.y, 120, stats.damage * 3, 0, Math.PI, "bloom");
  }
  private spawnWave(sim: Simulation): void {
    const s = this.state,
      count = Math.min(8 + Math.floor(s.area / 3), s.recipe.killGoal - s.spawned, 18);
    for (let i = 0; i < count && s.enemies.filter((e) => e.hp > 0).length < MAX_ENEMIES; i++) {
      const ordinal = s.spawned++,
        point = encounterPosition(s.recipe, ordinal);
      this.spawnEnemy(sim, ordinal, point.x, point.y, false, true);
    }
  }
  private spawnEnemy(
    sim: Simulation,
    ordinal: number,
    x: number,
    y: number,
    boss: boolean,
    counted: boolean,
  ): void {
    const s = this.state;
    if (s.enemies.filter((e) => e.hp > 0).length >= MAX_ENEMIES) return;
    const behavior = boss
        ? s.recipe.bossBehavior
        : s.recipe.behaviors[ordinal % s.recipe.behaviors.length],
      archetype = ARCHETYPES[behavior];
    const elite = !boss && ordinal > 2 && hash(ordinal, s.area, s.seed) % 7 === 0;
    const baseHealth =
      (boss ? 230 + Math.min(100, s.area) * 15 : archetype.hp) *
      s.recipe.power *
      (elite ? 2 : 1) *
      (1 + (sim.players.size - 1) * 0.45);
    const hp = baseHealth * s.tuning.enemyHealth * s.tuning.difficulty;
    // Nothing starts a wave penned behind a gate (M07): a jammed gate must not trap the goal.
    if (!sim.world.walkable(x, y) || insidePen(s.recipe, x, y)) {
      x = s.recipe.x + ((ordinal % 7) - 3) * 18;
      y = s.recipe.y + ((ordinal % 5) - 2) * 18;
    }
    s.enemies.push({
      id: s.nextId++,
      x,
      y,
      px: x,
      py: y,
      vx: 0,
      vy: 0,
      radius: boss ? 22 : behavior === "sentinel" || behavior === "charger" ? 11 : 7,
      rig: boss
        ? (
            ["brute", "stalker", "totem", "wraith", "brute", "crawler", "warden", "warden"] as const
          )[(s.area - 1) % 8]
        : s.recipe.procedural
          ? s.recipe.rigs[ordinal % s.recipe.rigs.length]
          : archetype.rig,
      behavior,
      theme: s.recipe.theme,
      name: boss ? s.recipe.boss : `${elite ? "Elder " : ""}${archetype.name}`,
      boss,
      elite,
      hp,
      baseHealth,
      maxHp: hp,
      damage: archetype.damage * Math.sqrt(s.recipe.power) * (boss ? 1.4 : elite ? 1.3 : 1),
      speed: archetype.speed * (boss ? 0.85 : 1),
      phase: "walk",
      timer: 0,
      nextAttack: sim.tick + (boss ? 95 : 25 + (ordinal % 40)),
      facing: 0,
      target: "",
      hurtUntil: 0,
      burnUntil: 0,
      burnDamage: 0,
      burnOwner: "",
      rootUntil: 0,
      deadAt: 0,
      attacks: 0,
      counted,
      tier: s.area,
      reaction: freshReaction(),
      ...(boss ? { warden: freshWarden() } : {}),
    });
    if (boss) this.emit(sim, "boss", x, y, "", s.recipe.boss);
  }
  private projectile(
    x: number,
    y: number,
    angle: number,
    speed: number,
    damage: number,
    owner: string,
    enemy: boolean,
    ttl = 160,
    pierce = 0,
    ricochet = 0,
  ): void {
    if (this.state.projectiles.length >= 180) return;
    this.state.projectiles.push({
      id: this.state.nextId++,
      x,
      y,
      px: x,
      py: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: enemy ? 4 : 5,
      owner,
      enemy,
      damage,
      ttl,
      pierce,
      hit: [],
      theme: this.state.recipe.theme,
      ricochet,
      scenery: [],
    });
  }
  /** A warden's attack cycle: summon, slam (its M10 signature), volley, and charge in phase II. */
  private bossBehavior(e: Enemy, attacks: number): BehaviorId {
    const phase2 = e.hp / e.maxHp < 0.5;
    return attacks % (phase2 ? 4 : 3) === 0
      ? "summoner"
      : attacks % 3 === 1
        ? "sentinel"
        : attacks % 3 === 2
          ? "spitter"
          : "charger";
  }
  /**
   * M10: a warden about to slam telegraphs its signature move instead, for longer, with a
   * locked target (lanes, lines and markers do not follow the traveler).
   */
  private beginSignature(sim: Simulation, e: Enemy, target: Player): void {
    if (this.bossBehavior(e, e.attacks + 1) !== "sentinel") return;
    const s = this.state,
      w = (e.warden ??= freshWarden()),
      recipe = WARDENS[s.recipe.signature];
    w.move = recipe.move;
    e.timer = Math.max(30, Math.round(WARDEN_WINDUP / Math.sqrt(s.tuning.enemySpeed)));
    w.tx = e.x;
    w.ty = e.y;
    if (w.move === "gale" || w.move === "lash" || w.move === "breath") {
      const reach = w.move === "gale" ? 300 : w.move === "lash" ? 230 : 150;
      w.tx = round3(e.x + Math.cos(e.facing) * reach);
      w.ty = round3(e.y + Math.sin(e.facing) * reach);
    } else if (w.move === "blink") {
      // The marked arch nearest the traveler that is not where the King already stands.
      const arches = s.mechanics
        .filter((m) => m.kind === "rift" && Math.hypot(m.x - e.x, m.y - e.y) > 60)
        .sort(
          (a, b) =>
            Math.hypot(a.x - target.x, a.y - target.y) -
              Math.hypot(b.x - target.x, b.y - target.y) || a.id - b.id,
        );
      const arch = arches[0];
      w.tx = round3(arch ? arch.x : e.x + Math.cos(e.facing) * 140);
      w.ty = round3(arch ? arch.y : e.y + Math.sin(e.facing) * 140);
    } else if (w.move === "collapse" && sim.physical)
      sim.physical.reactions.addField({
        id: `collapse:${e.id}`,
        kind: "attract",
        areaId: sim.physical.areaAt(sim, e.x, e.y),
        shape: { kind: "circle", x: round3(e.x), y: round3(e.y), radius: 210 },
        strength: 320,
        ticks: e.timer,
        gust: 0,
        actors: true,
        owner: `enemy-${e.id}`,
        team: "enemy",
        source: "warden:collapse",
        spare: "enemy",
      });
    this.emit(sim, "mechanic", e.x, e.y, "", `warden:${w.move}`, e.timer, e.facing, "#f0b88a");
  }
  /** A warden's slam on every traveler in reach (the ordinary sentinel strike). */
  private slam(sim: Simulation, e: Enemy, x: number, y: number, reach: number, scale = 1.3): void {
    for (const p of sim.players.values())
      if (Math.hypot(p.x - x, p.y - y) < reach) this.damageHero(sim, p, e.damage * scale, x, y);
    this.emit(sim, "mechanic", x, y, "", "hostile", reach, e.facing, "#e8a08a");
  }
  /** A short field around a warden's strike that spares monsters (M10 arena physics). */
  private wardenField(
    sim: Simulation,
    e: Enemy,
    id: string,
    kind: FieldRecipe["kind"],
    x: number,
    y: number,
    radius: number,
    strength: number,
    ticks: number,
  ): void {
    const physical = sim.physical;
    if (!physical) return;
    physical.reactions.addField({
      id,
      kind,
      areaId: physical.areaAt(sim, x, y),
      shape: { kind: "circle", x: round3(x), y: round3(y), radius },
      strength,
      ticks,
      gust: 0,
      actors: true,
      owner: `enemy-${e.id}`,
      team: "enemy",
      source: "warden",
      spare: "enemy",
    });
  }
  /** M10: resolve a warden's telegraphed signature move. */
  private signature(sim: Simulation, e: Enemy): void {
    const w = e.warden!,
      owner = `enemy-${e.id}`,
      physical = sim.physical,
      tick = sim.tick;
    e.phase = "recover";
    e.timer = 36;
    const move = w.move;
    w.move = "";
    if (move === "thornburst") {
      this.slam(sim, e, e.x, e.y, 125);
      physical?.thornburst(sim, { x: e.x, y: e.y, owner, team: "enemy", cause: "warden" });
      if (physical)
        this.propEffects(
          sim,
          owner,
          0,
          physical.damageProps(sim, {
            owner,
            cause: "warden",
            x: e.x,
            y: e.y,
            radius: THORNBURST.radius,
            damage: e.damage,
            impulse: 0,
            material: 1,
            team: "enemy",
          }),
        );
    } else if (move === "gale") {
      // The charge follows its locked lane with a gale at its back.
      e.facing = Math.atan2(w.ty - e.y, w.tx - e.x);
      e.phase = "charge";
      e.timer = 32;
      w.move = "gale";
      if (physical)
        physical.reactions.addField({
          id: `gale:${e.id}:${tick}`,
          kind: "wind",
          areaId: physical.areaAt(sim, e.x, e.y),
          shape: {
            kind: "lane",
            x: round3(e.x),
            y: round3(e.y),
            angle: round3(e.facing),
            length: 300,
            width: 70,
          },
          strength: 420,
          ticks: 40,
          gust: 0,
          actors: true,
          owner,
          team: "enemy",
          source: "warden:gale",
          spare: "enemy",
        });
    } else if (move === "discharge") {
      this.slam(sim, e, e.x, e.y, 125);
      physical?.stimulate(sim, "shock", {
        x: e.x,
        y: e.y,
        radius: 70,
        owner,
        team: "enemy",
        cause: "warden",
      });
    } else if (move === "echo") {
      this.slam(sim, e, e.x, e.y, 125);
      w.echoAt = tick + ECHO_DELAY;
      w.tx = round3(e.x);
      w.ty = round3(e.y);
    } else if (move === "breath") {
      const cone = Math.cos(0.45);
      for (const p of sim.players.values()) {
        const d = Math.hypot(p.x - e.x, p.y - e.y);
        if (d < 150 && (d < 1 || Math.cos(Math.atan2(p.y - e.y, p.x - e.x) - e.facing) > cone))
          this.damageHero(sim, p, e.damage * 1.2, e.x, e.y);
      }
      this.emit(sim, "mechanic", e.x, e.y, "", "hostile", 150, e.facing, "#f39a62");
      for (const reach of [40, 80, 120])
        physical?.stimulate(sim, "fire", {
          x: e.x + Math.cos(e.facing) * reach,
          y: e.y + Math.sin(e.facing) * reach,
          radius: 26,
          owner,
          team: "enemy",
          cause: "warden",
        });
    } else if (move === "lash") {
      const dx = w.tx - e.x,
        dy = w.ty - e.y,
        length = Math.hypot(dx, dy) || 1;
      for (const p of sim.players.values()) {
        const along = ((p.x - e.x) * dx + (p.y - e.y) * dy) / length,
          across = Math.abs((p.x - e.x) * dy - (p.y - e.y) * dx) / length;
        if (along < -10 || along > length + 10 || across > 24 || this.hero(p.id).dead) continue;
        this.damageHero(sim, p, e.damage * 0.6, e.x, e.y);
        physical?.lash(sim, e, p.id);
      }
      this.emit(sim, "mechanic", e.x, e.y, "", "hostile", length, Math.atan2(dy, dx), "#d97b93");
    } else if (move === "collapse") {
      physical?.reactions.removeField(`collapse:${e.id}`);
      this.slam(sim, e, e.x, e.y, 125);
      this.wardenField(sim, e, `collapse:${e.id}:burst`, "pressure", e.x, e.y, 140, 1800, 5);
    } else if (move === "blink") {
      sim.physical?.teleport(enemyBodyId(e.id), w.tx, w.ty);
      e.x = e.px = w.tx;
      e.y = e.py = w.ty;
      this.wardenField(sim, e, `blink:${e.id}:${tick}`, "repel", e.x, e.y, 115, 1400, 8);
      this.slam(sim, e, e.x, e.y, 100);
    }
  }
  /** Each tick: the Echo Matron's pending echo slam, and Cinderjaw being doused. */
  private wardenUpkeep(sim: Simulation, e: Enemy): void {
    const w = e.warden!;
    if (w.echoAt && sim.tick >= w.echoAt) {
      w.echoAt = 0;
      this.slam(sim, e, w.tx, w.ty, 110);
      this.wardenField(sim, e, `echo:${e.id}:${sim.tick}`, "repel", w.tx, w.ty, 120, 1300, 8);
    }
    if (
      this.state.recipe.signature === "cinder" &&
      (sim.physical?.reactions.status(enemyBodyId(e.id))?.wet ?? 0) > 0
    )
      this.expose(sim, e, "water", "");
  }
  /**
   * M10 warden weakness: the area's own rule used against its warden staggers it, breaks its
   * current telegraph and makes it take more damage for a moment. Only its own weakness counts.
   */
  private expose(sim: Simulation, e: Enemy, cause: WardenWeakness, owner: string): void {
    const s = this.state,
      tick = sim.tick;
    if (!e.boss || e.hp <= 0 || s.mode !== "area" || WARDENS[s.recipe.signature].weakness !== cause)
      return;
    const w = (e.warden ??= freshWarden());
    if (w.exposedUntil > tick || tick - w.lastExposed < EXPOSED.cooldown) return;
    w.exposedUntil = tick + EXPOSED.ticks;
    w.exposedBy = cause;
    w.lastExposed = tick;
    e.reaction.staggerUntil = Math.max(e.reaction.staggerUntil, tick + EXPOSED.stagger);
    if (e.phase === "windup") {
      e.phase = "recover";
      e.timer = EXPOSED.stagger;
      if (w.move === "collapse") sim.physical?.reactions.removeField(`collapse:${e.id}`);
      w.move = "";
    }
    this.emit(
      sim,
      "rig",
      e.x,
      e.y - 24,
      owner,
      `warden:exposed:${cause}`,
      EXPOSED.ticks,
      0,
      "#f6e39a",
    );
  }
  private enemyAttack(sim: Simulation, e: Enemy, target: Player): void {
    e.attacks++;
    if (e.boss && e.warden?.move) {
      this.signature(sim, e);
      e.nextAttack =
        sim.tick +
        Math.floor(ARCHETYPES[e.behavior].cooldown * (e.hp / e.maxHp < 0.5 ? 0.48 : 0.65));
      e.target = target.id;
      return;
    }
    const phase2 = e.boss && e.hp / e.maxHp < 0.5;
    const behavior = e.boss ? this.bossBehavior(e, e.attacks) : e.behavior;
    if (behavior === "charger") {
      e.phase = "charge";
      e.timer = e.boss ? 32 : 25;
      if (!sim.physical) {
        e.vx = Math.cos(e.facing) * (e.boss ? 280 : 240);
        e.vy = Math.sin(e.facing) * (e.boss ? 280 : 240);
      }
    } else if (behavior === "spitter" || behavior === "orbiter") {
      const amount = e.boss ? (phase2 ? 9 : 5) : e.elite ? 3 : 1;
      for (let i = 0; i < amount; i++)
        this.projectile(
          e.x,
          e.y,
          e.facing + (i - (amount - 1) / 2) * 0.22,
          e.boss ? 165 : 140,
          e.damage,
          `enemy-${e.id}`,
          true,
        );
      e.phase = "recover";
      e.timer = 20;
    } else if (behavior === "summoner") {
      const count = e.boss ? 3 : 2;
      for (let i = 0; i < count; i++)
        if (this.state.enemies.filter((other) => other.hp > 0).length < 32)
          this.spawnEnemy(
            sim,
            i + e.attacks * 11,
            e.x + Math.cos(i * 2.4) * 48,
            e.y + Math.sin(i * 2.4) * 48,
            false,
            false,
          );
      this.emit(sim, "mechanic", e.x, e.y, "", "", 70, 0, "#b8a6d4");
      e.phase = "recover";
      e.timer = 30;
    } else {
      const reach = e.boss ? 125 : behavior === "sentinel" ? 66 : 32;
      for (const p of sim.players.values())
        if (
          Math.hypot(p.x - e.x, p.y - e.y) < reach &&
          (e.boss || Math.cos(Math.atan2(p.y - e.y, p.x - e.x) - e.facing) > 0)
        )
          this.damageHero(sim, p, e.damage * (e.boss ? 1.3 : 1), e.x, e.y);
      this.emit(sim, "mechanic", e.x, e.y, "", "hostile", reach, e.facing, "#e8a08a");
      e.phase = "recover";
      e.timer = e.boss ? 36 : 22;
    }
    e.nextAttack =
      sim.tick +
      Math.floor(ARCHETYPES[e.behavior].cooldown * (e.boss ? (phase2 ? 0.48 : 0.65) : 1));
    e.target = target.id;
  }
  private activate(sim: Simulation, mechanic: Mechanic, owner: string, chained = false): void {
    const s = this.state,
      p = sim.players.get(owner);
    if (!p || (!chained && mechanic.readyAt > sim.tick)) return;
    const h = this.hero(owner),
      stats = this.stats(owner, sim.tick);
    mechanic.readyAt =
      sim.tick + (mechanic.kind === "wind" ? 45 : mechanic.kind === "cinder" ? 100 : 360);
    mechanic.activeUntil = sim.tick + 80;
    if (!chained) s.mechanicUses++;
    const { x, y, kind } = mechanic;
    this.emit(
      sim,
      "mechanic",
      x,
      y,
      owner,
      mechanicOf(kind).name,
      kind === "gravity" ? 155 : 105,
      0,
      mechanicOf(kind).color,
    );
    if (kind === "bramble") {
      // M10 Thornburst: the shove and splinters leave before the roots take hold.
      sim.physical?.thornburst(sim, { x, y, owner, team: "party", cause: "bramble" });
      this.damageArea(sim, owner, x, y, 115, stats.damage * 3.4, 0, Math.PI, "bramble");
      for (const e of s.enemies)
        if (Math.hypot(e.x - x, e.y - y) < 130) {
          e.rootUntil = sim.tick + 100;
          if (e.boss && e.hp > 0) this.expose(sim, e, "bramble", owner);
        }
    }
    if (kind === "glass") {
      const targets = s.enemies
        .filter((e) => e.hp > 0 && Math.hypot(e.x - x, e.y - y) < 190)
        .slice(0, 12);
      for (const e of targets) {
        this.emit(
          sim,
          "lance",
          x,
          y,
          owner,
          "chain",
          Math.hypot(e.x - x, e.y - y),
          Math.atan2(e.y - y, e.x - x),
          "#a7dfe6",
        );
        this.hit(sim, e, stats.damage * 2.7, owner, x, y);
      }
      // M08: the struck pylon's charge also runs through wet and metal scenery around it.
      sim.physical?.stimulate(sim, "shock", {
        x,
        y,
        radius: 40,
        owner,
        team: "party",
        cause: "stormglass",
      });
    }
    if (kind === "gravity") {
      for (const e of s.enemies) {
        const d = Math.hypot(e.x - x, e.y - y);
        if (d < 170 && !e.boss) {
          sim.actorImpulse(enemyBodyId(e.id), (x - e.x) * 4, (y - e.y) * 4);
          e.rootUntil = sim.tick + 40;
        }
      }
      // M10 Drifting knot: the struck knot's pull rolls away along the blow, dragging the
      // gathered monsters, loose material and loot with it (it spares the party).
      const heading = Math.atan2(y - p.y, x - p.x) || 0;
      this.field(
        sim,
        mechanic,
        "attract",
        { x, y, radius: KNOT.radius },
        KNOT.strength,
        KNOT.ticks,
        true,
        owner,
        {
          spare: "party",
          drift: {
            x: Math.round(Math.cos(heading) * KNOT.drift * 1000) / 1000,
            y: Math.round(Math.sin(heading) * KNOT.drift * 1000) / 1000,
          },
        },
      );
    }
    if (kind === "wind") {
      // M08: crossing a lane whirls the air around it for the activation's duration.
      this.field(sim, mechanic, "vortex", { x, y, radius: 90 }, 360, 80, true, owner);
      // M10 Tailwind: a strong gust down the lane, owned by the crosser (what it throws hurts).
      sim.physical?.reactions.addField({
        id: `gust:${mechanic.id}`,
        kind: "wind",
        areaId: sim.physical.areaAt(sim, x, y),
        shape: { kind: "lane", ...tailwindLane(s.recipe, { x, y }), width: TAILWIND.width },
        strength: GUST.strength,
        ticks: GUST.ticks,
        gust: 0,
        actors: true,
        owner,
        team: "party",
        source: "mechanic:wind",
      });
      h.hasteUntil = sim.tick + 180;
      p.energy = Math.min(100, p.energy + 30);
      p.dashCooldown = Math.min(p.dashCooldown, 0.1);
    }
    if (kind === "cinder") {
      h.burnUntil = sim.tick + 300;
      // M10 Vent eruption: fire at the vent, and up its own brush fuse wherever the set piece
      // had to stand, runs on into the weakened barricade.
      const physical = sim.physical;
      if (physical) {
        const chain = physical.stimulate(sim, "fire", {
          x,
          y,
          radius: VENT_RADIUS,
          owner,
          team: "party",
          cause: "vent",
        });
        const spot = mechanicLayout(s.recipe).find((l) => Math.hypot(l.x - x, l.y - y) < 1),
          fuse = spot ? `prop-brush-${s.recipe.index}-cinder-${spot.n}-0` : "";
        if (fuse && physical.world.has(fuse)) {
          const at = physical.world.motionOf(fuse);
          physical.reactions.stimulate(physical.reactionHost(sim), "fire", {
            x: at.x,
            y: at.y,
            target: fuse,
            chain,
          });
        }
      }
    }
    if (kind === "blood") {
      h.hp = Math.max(1, h.hp - stats.health * 0.18);
      h.bloodUntil = sim.tick + 900;
      // M10 Bloom snare: the sacrifice grows living vines to the nearest monsters.
      if (sim.physical) {
        const targets = s.enemies
          .filter((e) => e.hp > 0 && Math.hypot(e.x - x, e.y - y) < BLOOM_SNARE.radius)
          .sort(
            (a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y) || a.id - b.id,
          )
          .slice(0, BLOOM_SNARE.targets);
        for (const r of sim.physical.snare(sim, { x, y, owner }, targets)) {
          const e = targets.find((t) => enemyBodyId(t.id) === r.body);
          if (e && !e.boss) e.rootUntil = Math.max(e.rootUntil, r.until);
        }
      }
    }
    if (kind === "echo")
      s.delayed.push({
        tick: sim.tick + 25,
        x,
        y,
        owner,
        radius: 130,
        damage: stats.damage * 3,
        kind: "echo",
      });
    if (kind === "rift") {
      const other = s.mechanics.find((m) => m.id === mechanic.pair);
      if (other) {
        // An unanchored held part rides along through the rift as one unit; M10 freight on the
        // arch's pad travels with it, keeping its place around the arch.
        sim.physical?.carry(sim, p.id, other.x - p.x, other.y - p.y);
        const freight =
          sim.physical?.freight(sim, p.id, mechanic, other.x - mechanic.x, other.y - mechanic.y) ??
          [];
        this.place(p, other.x, other.y, sim);
        // M08: the arrival shockwave is a short repelling field around the partner arch.
        this.field(
          sim,
          other,
          "repel",
          { x: other.x, y: other.y, radius: 115 },
          1400,
          8,
          true,
          owner,
        );
        h.invulnerableUntil = sim.tick + 20;
        other.readyAt = Math.max(other.readyAt, sim.tick + 60);
        // The arrival strikes what waited there; the freight it brought only gets the push.
        this.damageArea(
          sim,
          owner,
          other.x,
          other.y,
          115,
          stats.damage * 2.2,
          0,
          Math.PI,
          "rift",
          freight,
        );
        // The Riftbound King cannot bear a traveler's arrival beside it.
        for (const e of s.enemies)
          if (e.boss && e.hp > 0 && Math.hypot(e.x - other.x, e.y - other.y) < 115)
            this.expose(sim, e, "rift", owner);
      }
    }
    if (!chained && s.recipe.combination?.from === kind && s.delayed.length < 40)
      s.delayed.push({
        tick: sim.tick + 24,
        x,
        y,
        owner,
        damage: stats.damage * 2,
        radius: 130,
        kind: s.recipe.combination.into,
      });
  }
  /** An area mechanic's physical field (M08), owned by the hero who used it. */
  private field(
    sim: Simulation,
    mechanic: Mechanic,
    kind: FieldRecipe["kind"],
    at: { x: number; y: number; radius: number },
    strength: number,
    ticks: number,
    actors: boolean,
    owner: string,
    extra: Pick<FieldRecipe, "spare" | "drift"> = {},
  ): void {
    const physical = sim.physical;
    if (!physical) return;
    physical.reactions.addField({
      id: `mechanic:${mechanic.id}`,
      kind,
      areaId: physical.areaAt(sim, at.x, at.y),
      shape: { kind: "circle", x: at.x, y: at.y, radius: at.radius },
      strength,
      ticks,
      gust: 0,
      actors,
      owner,
      team: "party",
      source: `mechanic:${mechanic.kind}`,
      ...extra,
    });
  }
  step(sim: Simulation): void {
    const s = this.state,
      tick = sim.tick;
    // Contacts collected by the previous solve become damage at this command boundary.
    if (sim.physical) {
      this.applyImpacts(sim, sim.physical.combat.takeImpacts());
      // Mechanism changes (latches, launches, snapped or cut links) from the previous solve.
      for (const e of sim.physical.mechanisms.take())
        this.emit(sim, "assembly", e.x, e.y, e.owner, e.text, 0, 0, "#e7d7a1");
      // Remains reaching the ground and travelers bumping townsfolk (M09).
      for (const e of sim.physical.rigs.take())
        this.emit(sim, "rig", e.x, e.y, e.owner, e.text, e.amount, 0, "#d9cfa8");
      // Living vines growing, snapping and withering; rift freight arriving (M10).
      for (const e of sim.physical.showcase.take())
        this.emit(sim, "assembly", e.x, e.y, e.owner, e.text, e.amount, 0, "#c9e39a");
      this.applyReactions(sim);
    }
    for (const p of sim.players.values()) {
      const h = this.hero(p.id),
        stats = this.stats(p.id, tick);
      stepRecoil(h.recoil, p.vx, p.vy);
      h.hp = Math.min(stats.health, h.hp + (h.dead ? 0 : stats.regen / 60));
      p.energy = Math.min(100, p.energy + stats.spirit / 60);
      if (h.dead) continue;
      if (h.recallUntil) {
        if (Math.hypot(p.input.x, p.input.y) > 0 || h.lastHit > h.recallUntil - 150)
          h.recallUntil = 0;
        else if (tick >= h.recallUntil) {
          this.enterTown(sim);
          return;
        }
      }
      if (p.input.attack) this.attack(sim, p, "slash");
      if (p.input.pulse) this.attack(sim, p, "whorl");
      if (p.input.lance) this.attack(sim, p, "lance");
      if (p.input.nova) this.attack(sim, p, "nova");
      if (p.input.potion) this.potion(sim, p);
      if (
        s.mode === "town" &&
        this.canLead(sim, p.id) &&
        p.x > 305 &&
        p.x < 420 &&
        Math.abs(p.y) < 140
      ) {
        this.startArea(sim, this.nextArea());
        return;
      }
      if (
        s.mode === "area" &&
        s.cleared &&
        this.canLead(sim, p.id) &&
        p.x > s.recipe.x + 330 &&
        p.x < s.recipe.x + 450 &&
        Math.abs(p.y - s.recipe.y) < 120
      ) {
        this.action(sim, p.id, { type: "advance" });
        return;
      }
      for (const m of s.mechanics)
        if (Math.hypot(p.x - m.x, p.y - m.y) < m.radius) {
          if (m.kind === "wind" || m.kind === "cinder") this.activate(sim, m, p.id);
          if (m.kind === "cinder" && tick % 60 === 0) this.damageHero(sim, p, 4, m.x, m.y);
        }
    }
    for (const effect of [...s.delayed])
      if (effect.tick <= tick) {
        s.delayed = s.delayed.filter((item) => item !== effect);
        if (effect.kind === "echo") {
          if (effect.ability === "lance")
            this.projectile(
              effect.x,
              effect.y,
              effect.angle ?? 0,
              470,
              effect.damage,
              effect.owner,
              false,
              54,
              ATTACKS.lance.pierce,
              Object.hasOwn(s.heroes, effect.owner) ? this.stats(effect.owner, tick).ricochet : 0,
            );
          else {
            // M10 Resonant echo: the repeat carries the ability's own physical force, owned by
            // the original caster; what the first cast broke or claimed is not paid again.
            for (const e of s.enemies)
              if (e.boss && e.hp > 0 && Math.hypot(e.x - effect.x, e.y - effect.y) < effect.radius)
                this.expose(sim, e, "echo", effect.owner);
            this.damageArea(
              sim,
              effect.owner,
              effect.x,
              effect.y,
              effect.radius,
              effect.damage,
              0,
              Math.PI,
              effect.ability ? `echo:${effect.ability}` : effect.kind,
            );
          }
          this.emit(
            sim,
            effect.ability ?? "nova",
            effect.x,
            effect.y,
            effect.owner,
            "echo",
            0,
            0,
            "#c1b9ec",
          );
        } else
          this.activate(
            sim,
            {
              id: -1,
              kind: effect.kind,
              x: effect.x,
              y: effect.y,
              radius: effect.radius,
              readyAt: 0,
              activeUntil: 0,
              pair: null,
            },
            effect.owner,
            true,
          );
      }
    for (const e of s.enemies) {
      e.px = e.x;
      e.py = e.y;
      stepReaction(rigOf(e.rig), e.reaction, e.vx);
      if (e.hp <= 0) continue;
      if (e.burnUntil > tick && tick % 30 === 0) {
        this.hit(sim, e, e.burnDamage, e.burnOwner, e.x, e.y, true);
        if (e.hp <= 0) continue;
      }
      if (e.warden) this.wardenUpkeep(sim, e);
      // Knocked down (M09): no steering and no attack until it is back on its feet.
      if (e.reaction.toppleUntil > tick) {
        if (sim.physical) sim.physical.enemyIntent(sim, e, 0, 0, false);
        else e.vx = e.vy = 0;
        continue;
      }
      let target: Player | undefined,
        distance = Infinity;
      for (const p of sim.players.values()) {
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (!this.hero(p.id).dead && d < distance) {
          target = p;
          distance = d;
        }
      }
      if (!target) continue;
      let intentX = 0,
        intentY = 0;
      if (e.phase === "windup") {
        if (--e.timer <= 0) this.enemyAttack(sim, e, target);
      } else if (e.phase === "charge") {
        intentX = Math.cos(e.facing) * (e.boss ? 280 : 240);
        intentY = Math.sin(e.facing) * (e.boss ? 280 : 240);
        // M10 Gale Stag: a gale charge that runs into something solid crashes (its weakness).
        if (
          e.warden?.move === "gale" &&
          sim.physical &&
          e.timer < 28 &&
          Math.hypot(e.vx, e.vy) < CRASH_SPEED &&
          sim.physical.blockedAhead(e, 14)
        ) {
          e.warden.move = "";
          e.phase = "recover";
          e.timer = 50;
          this.emit(sim, "rig", e.x, e.y, "", "warden:crash", 1, e.facing, "#e8d6a0");
          this.expose(sim, e, "crash", "");
          if (sim.physical) sim.physical.enemyIntent(sim, e, 0, 0, false);
          continue;
        }
        // A charge ploughs props ahead of it once each; they then belong to this enemy.
        if (sim.physical)
          this.propEffects(
            sim,
            `enemy-${e.id}`,
            e.facing,
            sim.physical.damageProps(sim, {
              owner: `enemy-${e.id}`,
              cause: "charge",
              x: e.x + Math.cos(e.facing) * e.radius,
              y: e.y + Math.sin(e.facing) * e.radius,
              radius: e.radius + 8,
              damage: e.damage,
              angle: e.facing,
              arc: 1.3,
              impulse: ATTACKS.charge.impulse,
              torque: ATTACKS.charge.torque,
              material: ATTACKS.charge.material,
              team: "enemy",
              once: `charge-${e.id}-${e.attacks}`,
            }),
          );
        for (const p of sim.players.values())
          if (Math.hypot(e.x - p.x, e.y - p.y) < e.radius + 10)
            this.damageHero(sim, p, e.damage * 1.3, e.x, e.y);
        if (--e.timer <= 0) {
          e.phase = "recover";
          e.timer = 25;
          if (e.warden?.move === "gale") e.warden.move = "";
        }
      } else if (e.phase === "recover") {
        if (!sim.physical) {
          e.vx *= 0.86;
          e.vy *= 0.86;
        }
        if (--e.timer <= 0) e.phase = "walk";
      } else {
        const archetype = ARCHETYPES[e.behavior],
          angle = Math.atan2(target.y - e.y, target.x - e.x);
        e.facing = angle;
        if (distance < (e.boss ? 245 : archetype.range) && tick >= e.nextAttack) {
          e.phase = "windup";
          e.timer = Math.max(
            16,
            Math.round((e.boss ? 46 : archetype.windup) / Math.sqrt(s.tuning.enemySpeed)),
          );
          if (e.boss) this.beginSignature(sim, e, target);
          if (!sim.physical) e.vx = e.vy = 0;
        } else {
          let direction = angle,
            speed =
              e.speed *
              s.tuning.enemySpeed *
              (1 + Math.min(1, Math.max(0, s.tuning.difficulty - 1) * 0.1));
          if (e.behavior === "spitter" || e.behavior === "summoner") {
            if (distance < 115) direction += Math.PI;
            else if (distance < 200) speed *= 0.1;
          }
          if (e.behavior === "orbiter")
            direction += (Math.PI / 2) * (e.id % 2 ? 1 : -1) * (distance < 170 ? 1 : 0.35);
          if (e.rootUntil > tick) speed = 0;
          intentX = Math.cos(direction) * speed;
          intentY = Math.sin(direction) * speed;
          if (!sim.physical) {
            e.vx += (intentX - e.vx) * 0.1;
            e.vy += (intentY - e.vy) * 0.1;
          }
        }
      }
      if (sim.physical) sim.physical.enemyIntent(sim, e, intentX, intentY, e.phase === "walk");
      else if (e.phase !== "windup") moveBody(sim.world, e, 1 / 60);
    }
    if (!sim.physical)
      for (let i = 0; i < s.enemies.length; i++)
        if (s.enemies[i].hp > 0)
          for (let j = i + 1; j < s.enemies.length; j++)
            if (s.enemies[j].hp > 0)
              collideCircles(
                s.enemies[i],
                s.enemies[j],
                s.enemies[i].boss ? 8 : 1,
                s.enemies[j].boss ? 8 : 1,
                0.05,
              );
    if (!sim.physical)
      for (const enemy of s.enemies)
        if (enemy.hp > 0)
          for (const p of sim.players.values())
            if (!this.hero(p.id).dead && this.hero(p.id).dashUntil <= tick)
              collideCircles(p, enemy, 2.5, enemy.boss ? 8 : 1, 0.05);
    s.enemies = s.enemies.filter((e) => e.hp > 0 || tick - e.deadAt < 40);
    for (const projectile of s.projectiles) {
      projectile.px = projectile.x;
      projectile.py = projectile.y;
      projectile.x += projectile.vx / 60;
      projectile.y += projectile.vy / 60;
      projectile.ttl--;
      if (sim.physical && this.projectileScenery(sim, projectile)) projectile.ttl = 0;
      if (projectile.enemy) {
        for (const p of sim.players.values())
          if (Math.hypot(p.x - projectile.x, p.y - projectile.y) < 12) {
            this.damageHero(sim, p, projectile.damage, projectile.px, projectile.py);
            projectile.ttl = 0;
          }
      } else {
        for (const e of s.enemies)
          if (
            e.hp > 0 &&
            !projectile.hit.includes(e.id) &&
            Math.hypot(e.x - projectile.x, e.y - projectile.y) < e.radius + projectile.radius
          ) {
            this.hit(sim, e, projectile.damage, projectile.owner, projectile.px, projectile.py);
            projectile.hit.push(e.id);
            if (--projectile.pierce < 0) {
              projectile.ttl = 0;
              break;
            }
          }
      }
    }
    s.projectiles = s.projectiles.filter((projectile) => projectile.ttl > 0);
    for (const drop of s.drops)
      if (drop.kind !== "item") {
        const p = [...sim.players.values()]
          .filter((p) => !this.hero(p.id).dead)
          .sort(
            (a, b) =>
              Math.hypot(a.x - drop.x, a.y - drop.y) - Math.hypot(b.x - drop.x, b.y - drop.y),
          )[0];
        if (!p) continue;
        const distance = Math.hypot(p.x - drop.x, p.y - drop.y);
        // The magnet waits out the drop's launch/settle phase (M06 physical loot).
        if (distance < 130 && tick - drop.born >= LOOT_SETTLE_TICKS) {
          drop.x += (p.x - drop.x) * 0.16;
          drop.y += (p.y - drop.y) * 0.16;
        }
        if (distance < 18) {
          for (const id of sim.players.keys()) {
            const stats = this.stats(id, sim.tick);
            if (drop.kind === "gold") this.hero(id).gold += Math.round(drop.amount * stats.gold);
            else this.gainXp(sim, id, Math.round(drop.amount * stats.xp));
          }
          drop.amount = 0;
        }
      }
    s.drops = s.drops.filter((drop) => drop.amount > 0);
    if (s.mode !== "area") return;
    const alive = s.enemies.filter((e) => e.hp > 0).length;
    if (!s.cleared && s.spawned < s.recipe.killGoal && alive < 5) this.spawnWave(sim);
    if (!s.bossSpawned && s.spawned >= s.recipe.killGoal && s.kills >= s.recipe.killGoal) {
      s.bossSpawned = true;
      this.spawnEnemy(sim, 0, s.recipe.x + 130, s.recipe.y, true, false);
    }
  }
  observe(id?: string, tick = 0) {
    const s = this.state,
      player = id ?? Object.keys(s.heroes)[0];
    return {
      mode: s.mode,
      area: s.area,
      land: s.townLand,
      town: townName(s.townLand),
      name: s.mode === "town" ? townName(s.townLand) : s.recipe.name,
      recipe: s.recipe,
      kills: s.kills,
      goal: s.recipe.killGoal,
      cleared: s.cleared,
      highest: s.highest,
      mechanicUses: s.mechanicUses,
      tuning: { ...s.tuning },
      enemies: s.enemies
        .filter((e) => e.hp > 0)
        .map(({ id, name, x, y, hp, maxHp, phase, boss, behavior }) => ({
          id,
          name,
          x,
          y,
          hp,
          maxHp,
          phase,
          boss,
          behavior,
        })),
      drops: s.drops.map(({ id, kind, x, y, amount, item }) => ({
        id,
        kind,
        x,
        y,
        amount,
        name: item?.name,
        rarity: item?.rarity,
      })),
      hero: player ? structuredClone(this.hero(player)) : null,
      stats: player ? this.stats(player, tick) : null,
      events: s.events.slice(-12),
    };
  }
  save(): AdventureState {
    return structuredClone(this.state);
  }
  restore(state: AdventureState): void {
    validateAdventure(state);
    this.state = structuredClone(state);
    // M09 state did not exist in older checkpoints: rigs start at rest.
    for (const hero of Object.values(this.state.heroes)) hero.recoil ??= freshRecoil();
    for (const enemy of this.state.enemies) enemy.reaction ??= freshReaction();
  }
  networkState(viewer: string): AdventureState {
    const state = this.save();
    for (const [id, hero] of Object.entries(state.heroes))
      if (id !== viewer)
        hero.inventory = hero.inventory.filter((item) =>
          Object.values(hero.equipment).includes(item.id),
        );
    return state;
  }
}
