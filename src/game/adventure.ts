import { hash, random } from "../engine/math.ts";
import { collideCircles, moveBody } from "../engine/physics.ts";
import type { Player, Simulation } from "../engine/simulation.ts";
import { World } from "../engine/world.ts";
import { enemyBodyId, type PropHit, playerBodyId } from "../physics/adventure.ts";
import { LOOT_SETTLE_TICKS, type PendingImpact } from "../physics/combat.ts";
import { MATERIALS } from "../physics/materials.ts";
import type { AreaRecipe } from "./content.ts";
import {
  ARCHETYPES,
  areaRecipe,
  encounterPosition,
  mechanicOf,
  npcPosition,
  TOWN_NPCS,
  townName,
} from "./content.ts";
import { ATTACKS, attackRecipe, HARD_MATERIALS } from "./interactions.ts";
import { type Item, rollItem, SLOTS, starterItems } from "./loot.ts";
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

export const INVENTORY_LIMIT = 40;
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
    for (let k = 0; k < s.recipe.mechanics.length; k++)
      for (let n = 0; n < 3; n++) {
        const angle = (n / 3 + k * 0.18) * Math.PI * 2;
        s.mechanics.push({
          id: s.nextId++,
          kind: s.recipe.mechanics[k],
          x: s.recipe.x + Math.cos(angle) * (125 + k * 42),
          y: s.recipe.y + Math.sin(angle) * (125 + k * 42),
          radius: s.recipe.mechanics[k] === "wind" ? 38 : 25,
          readyAt: 0,
          activeUntil: 0,
          pair: null,
        });
      }
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
      const npc = TOWN_NPCS.find((n) => {
        const point = npcPosition(n, sim.tick);
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
  /** Gameplay-owned consequences of scenery hits: one-time party gold and readable feedback. */
  private propEffects(sim: Simulation, owner: string, angle: number, hits: PropHit[]): void {
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
      } else if (shown++ < 6)
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
    const amount = Math.max(1, Math.round(damage * (critical ? stats!.critPower : 1)));
    e.hp -= amount;
    e.hurtUntil = sim.tick + 7;
    if (!e.boss && e.phase === "windup") {
      e.phase = "recover";
      e.timer = 12;
    }
    const d = Math.hypot(e.x - fromX, e.y - fromY) || 1;
    sim.actorImpulse(
      enemyBodyId(e.id),
      ((e.x - fromX) / d) * (e.boss ? 12 : 65),
      ((e.y - fromY) / d) * (e.boss ? 12 : 65),
    );
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
    if (!sim.world.walkable(x, y)) {
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
  private enemyAttack(sim: Simulation, e: Enemy, target: Player): void {
    e.attacks++;
    const phase2 = e.boss && e.hp / e.maxHp < 0.5;
    const behavior = e.boss
      ? e.attacks % (phase2 ? 4 : 3) === 0
        ? "summoner"
        : e.attacks % 3 === 1
          ? "sentinel"
          : e.attacks % 3 === 2
            ? "spitter"
            : "charger"
      : e.behavior;
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
      this.damageArea(sim, owner, x, y, 115, stats.damage * 3.4, 0, Math.PI, "bramble");
      for (const e of s.enemies)
        if (Math.hypot(e.x - x, e.y - y) < 130) e.rootUntil = sim.tick + 100;
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
    }
    if (kind === "gravity")
      for (const e of s.enemies) {
        const d = Math.hypot(e.x - x, e.y - y);
        if (d < 170 && !e.boss) {
          sim.actorImpulse(enemyBodyId(e.id), (x - e.x) * 4, (y - e.y) * 4);
          e.rootUntil = sim.tick + 40;
        }
      }
    if (kind === "wind") {
      h.hasteUntil = sim.tick + 180;
      p.energy = Math.min(100, p.energy + 30);
      p.dashCooldown = Math.min(p.dashCooldown, 0.1);
    }
    if (kind === "cinder") h.burnUntil = sim.tick + 300;
    if (kind === "blood") {
      h.hp = Math.max(1, h.hp - stats.health * 0.18);
      h.bloodUntil = sim.tick + 900;
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
        this.place(p, other.x, other.y, sim);
        h.invulnerableUntil = sim.tick + 20;
        other.readyAt = Math.max(other.readyAt, sim.tick + 60);
        this.damageArea(sim, owner, other.x, other.y, 115, stats.damage * 2.2, 0, Math.PI, "rift");
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
  step(sim: Simulation): void {
    const s = this.state,
      tick = sim.tick;
    // Contacts collected by the previous solve become damage at this command boundary.
    if (sim.physical) this.applyImpacts(sim, sim.physical.combat.takeImpacts());
    for (const p of sim.players.values()) {
      const h = this.hero(p.id),
        stats = this.stats(p.id, tick);
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
          else
            this.damageArea(
              sim,
              effect.owner,
              effect.x,
              effect.y,
              effect.radius,
              effect.damage,
              0,
              Math.PI,
              effect.kind,
            );
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
      if (e.hp <= 0) continue;
      if (e.burnUntil > tick && tick % 30 === 0) {
        this.hit(sim, e, e.burnDamage, e.burnOwner, e.x, e.y, true);
        if (e.hp <= 0) continue;
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
