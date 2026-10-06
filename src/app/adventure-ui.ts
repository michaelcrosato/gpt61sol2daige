import type { Simulation } from "../engine/simulation.ts";
import { xpForLevel } from "../game/adventure.ts";
import {
  areaRecipe,
  mechanicOf,
  npcPosition,
  TOWN_NPCS,
  themeOf,
  townName,
} from "../game/content.ts";
import { type Item, RARITY_COLORS, SLOTS, SPECIAL_TEXT } from "../game/loot.ts";
import { PATHS, PERCENT_STATS, SKILLS, STAT_LABELS, skillReason } from "../game/skills.ts";
import {
  type AdventureAction,
  type CombatEvent,
  DEFAULT_TUNING,
  type Tuning,
} from "../game/types.ts";
import { WARDENS } from "../game/wardens.ts";
import { SHOWCASE } from "../physics/showcase.ts";
import { spriteSvg } from "../render/sprites.ts";
import { icon } from "./ui.ts";

interface Options {
  sim: () => Simulation;
  player: () => string;
  role: () => string;
  action: (action: AdventureAction) => Promise<unknown>;
  showDialog: (dialog: HTMLDialogElement) => void;
  closeDialog: (dialog: HTMLDialogElement) => void;
  clearInput: () => void;
  preview: (index: number) => void;
  notify: (text: string) => void;
}
const esc = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const affixText = (stat: keyof typeof STAT_LABELS, value: number) =>
  `+${PERCENT_STATS.includes(stat) ? `${Math.round(value * 100)}%` : Number(value.toFixed(1))} ${STAT_LABELS[stat]}`;
const itemIcon = (item: Item) =>
  icon(
    item.slot === "weapon"
      ? "sword"
      : item.slot === "armor"
        ? "shield"
        : item.slot === "boots"
          ? "bolt"
          : "crystal",
    26,
  );

export class AdventureUI {
  private readonly options: Options;
  private selectedSkill = SKILLS[0].id;
  private selectedItem = "starter-blade";
  private signature = "";
  private panel: "inventory" | "skills" | "town" | "pause" | "death" | "mechanics" | null = null;
  private seenDeath = "";
  private readonly dialog: HTMLDialogElement;
  constructor(options: Options) {
    this.options = options;
    document.querySelector(".welcome h1")!.innerHTML = "A quiet town.<br><em>A hungry wild.</em>";
    document.querySelector(".welcome .eyebrow")!.textContent = "THE NEXT EXPEDITION";
    document.querySelector(".welcome p")!.innerHTML =
      "Keep your lantern. Take up the blade.<br>The frontier grows with every victory.";
    el("begin").innerHTML = `Begin the hunt ${icon("diagonal", 18)}`;
    el("trail-note").innerHTML =
      `<span>${icon("sword", 17)}</span><div>Keep moving. Keep your edge.<small>LMB attacks · Q whirls · Shift evades</small></div>`;
    document.querySelector(".chapter h2")!.innerHTML = "Roots beneath.<br>Wilds ahead.";
    document.querySelector(".chapter p")!.textContent =
      "A town to return to. A thousand places to test your blade.";
    document.querySelector(".chapter-illustration span")!.textContent = "Carry a little fire.";
    document.querySelector<HTMLElement>(".journal")!.hidden = true;
    document
      .querySelector(".party-section")!
      .insertAdjacentHTML(
        "afterend",
        `<div class="run-journal"><div class="section-label">YOUR WAYFARER <span id="hero-level">LEVEL 1</span></div><div class="journal-resource"><span>${icon("heart", 15)}<b id="journal-life">112 / 112</b></span><span>${icon("coin", 15)}<b id="journal-gold">80</b></span></div><div class="journal-xp"><i id="journal-xp-fill"></i></div><div class="journal-build-buttons"><button id="inventory-open">${icon("bag", 16)}Equipment <kbd>I</kbd></button><button id="skills-open">${icon("tree", 16)}Skill tree <b id="skill-point-count">3</b></button></div><div class="section-label run-section-label">THE OUTWARD PATH <span id="run-area-index">LAND 01</span></div><h3 id="run-area-name">Mosslight Hollow</h3><p id="run-objective">Rest, resupply, then enter Brambleburst.</p><div class="run-progress-track"><i id="run-progress-fill"></i></div><div class="run-progress-meta"><span id="run-kills">Town sanctuary</span><span id="run-clock">00:00</span></div><button id="run-advance" class="primary-button full">Begin Brambleburst ${icon("arrow", 16)}</button><button id="town-open" class="text-button">${icon("bag", 14)}Rest & resupply</button><div class="mechanic-summary" id="mechanic-summary"><span id="mechanic-symbol">✹</span><div><strong id="mechanic-name">Brambleburst</strong><p id="mechanic-copy">A new trick awaits beyond the gate.</p></div></div><button id="mechanics-open" class="text-button">Area mechanics ${icon("diagonal", 13)}</button></div>`,
      );
    el("lantern").hidden = true;
    el("pulse").setAttribute("aria-label", "Whorl");
    el("pulse").title = "Whorl (Q / 2)";
    el("pulse").innerHTML = `<kbd>Q</kbd>${icon("sun", 22)}<span>Whorl</span>`;
    el("dash").innerHTML = `<kbd>SHIFT</kbd>${icon("bolt", 22)}<span>Dash</span>`;
    document
      .querySelector(".hotbar")!
      .insertAdjacentHTML(
        "afterbegin",
        `<button class="ability active" id="attack-button" aria-label="Slash attack" title="Hold left mouse / J to attack"><kbd>LMB</kbd>${icon("sword", 23)}<span>Wayblade</span></button>`,
      );
    el("dash").insertAdjacentHTML(
      "beforebegin",
      `<button class="ability" id="lance-button" aria-label="Thornlance" title="Unlock Thornlance in Stormstep"><kbd>R</kbd>${icon("diagonal", 22)}<span>Thornlance</span></button><button class="ability" id="nova-button" aria-label="Bloom Nova" title="Unlock Bloom Nova in Emberwake"><kbd>F</kbd>${icon("fire", 22)}<span>Bloom Nova</span></button><button class="ability" id="grab-button" aria-label="Grab a nearby loose prop" title="Grab a nearby loose prop (V). Attack throws it; V sets it down."><kbd>V</kbd>${icon("hand", 22)}<span id="grab-label">Grab</span></button>`,
    );
    el("dash").insertAdjacentHTML(
      "afterend",
      `<button class="ability flask-ability" id="potion-button" aria-label="Use healing flask" title="Healing flask (1)"><kbd>1</kbd>${icon("flask", 22)}<span id="flask-count">3 / 3</span></button>`,
    );
    document.querySelector(".input-hints")!.innerHTML =
      `<span><kbd>W A S D</kbd> move</span><span><kbd>LMB / J</kbd> attack</span><span><kbd>E</kbd> interact</span><span><kbd>V</kbd> grab · throw</span><span><kbd>P</kbd> pause</span>`;
    el("world-canvas").setAttribute(
      "aria-label",
      "Fern hack-and-slash. WASD moves, left mouse or J attacks, Q casts Whorl, Shift or Space dashes, E interacts, V grabs a loose prop (attack throws it), 1 heals.",
    );
    el("viewport").insertAdjacentHTML(
      "beforeend",
      `<div class="adventure-shortcuts"><button id="quick-inventory" title="Equipment (I)" aria-label="Open equipment">${icon("bag", 17)}<kbd>I</kbd></button><button id="quick-skills" title="Skill tree (K)" aria-label="Open skill tree">${icon("tree", 18)}<kbd>K</kbd><i id="skill-alert"></i></button><button id="pause-game" title="Pause & tuning (P)" aria-label="Pause game">${icon("pause", 17)}<kbd>P</kbd></button></div><div class="player-vitals"><span class="level-medallion" id="hud-level">1</span><div class="vital-bars"><div class="health-line"><span>WAYFARER</span><strong id="hud-life">112 / 112</strong></div><div class="health-track"><i id="hud-health-fill"></i></div><div class="xp-track"><i id="hud-xp-fill"></i></div></div><span class="gold-readout">${icon("coin", 14)}<b id="hud-gold">80</b></span></div><div class="boss-hud" id="boss-hud" hidden><span id="boss-name"></span><div><i id="boss-health"></i></div><small id="boss-phase">WARDEN OF THE AREA</small></div><div class="interaction-prompt" id="interaction-prompt" hidden></div><div class="area-toast" id="area-toast" hidden></div>`,
    );
    el("game-settings").insertAdjacentHTML(
      "beforebegin",
      `<button class="icon-button" id="game-inventory" aria-label="Game equipment" title="Equipment (I)">${icon("bag", 18)}</button><button class="icon-button" id="game-skills" aria-label="Game skill tree" title="Skills (K)">${icon("tree", 18)}</button><button class="icon-button" id="game-pause" aria-label="Game pause menu" title="Pause (P)">${icon("pause", 18)}</button>`,
    );
    el("app").insertAdjacentHTML(
      "beforeend",
      `<dialog class="adventure-dialog" id="adventure-dialog" aria-labelledby="adventure-title"><form method="dialog"><button class="dialog-close icon-button" aria-label="Close adventure panel">${icon("close", 20)}</button></form><div class="adventure-dialog-heading"><div><span class="eyebrow" id="adventure-eyebrow">YOUR WAYFARER</span><h2 id="adventure-title">A build of your own.</h2></div><div class="dialog-wallet">${icon("coin", 16)}<strong id="dialog-gold">80</strong><span id="dialog-points">3 skill points</span></div></div><div id="adventure-panel"></div><p class="adventure-notice" id="adventure-notice" role="status" aria-live="polite"></p></dialog>`,
    );
    this.dialog = el<HTMLDialogElement>("adventure-dialog");
    this.dialog.addEventListener("close", () => {
      if (!this.dialog.open) this.panel = null;
    });
    this.dialog.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-skill], [data-item], [data-action], [data-buy], [data-preset], [data-panel]",
      );
      if (!target) return;
      if (target.dataset.skill) {
        this.selectedSkill = target.dataset.skill;
        this.signature = "";
        this.update();
      }
      if (target.dataset.item) {
        this.selectedItem = target.dataset.item;
        this.signature = "";
        this.update();
      }
      if (target.dataset.buy) void this.act({ type: "buy", index: Number(target.dataset.buy) });
      if (target.dataset.preset)
        void this.act({
          type: "tuning",
          values: { ...DEFAULT_TUNING, difficulty: Number(target.dataset.preset) },
        });
      if (target.dataset.panel)
        this.open(target.dataset.panel as NonNullable<AdventureUI["panel"]>);
      switch (target.dataset.action) {
        case "learn":
          void this.act({ type: "skill", id: this.selectedSkill });
          break;
        case "equip":
          void this.act({ type: "equip", id: this.selectedItem });
          break;
        case "sell":
          void this.act({ type: "sell", id: this.selectedItem });
          break;
        case "rest":
          void this.act({ type: "rest" });
          break;
        case "sell-spares":
          void this.act({ type: "sell-spares" });
          break;
        case "respec":
          void this.act({ type: "respec" });
          break;
        case "resume":
          this.close();
          break;
        case "return":
          this.close();
          void this.act({ type: "return" });
          break;
        case "respawn":
          this.close();
          void this.act({ type: "respawn" });
          break;
        case "depart":
          this.close();
          void this.act({ type: "depart" });
          break;
        case "advance":
          this.close();
          void this.act({ type: "advance" });
          break;
        case "audio":
          el("sound").click();
          break;
        case "journal":
          this.close();
          el("game-journal").click();
          break;
        case "settings":
          this.close();
          el("settings-open").click();
          break;
        case "new-run":
          if (target.dataset.confirm === "yes") {
            this.close();
            void this.act({ type: "new-run" });
          } else {
            target.dataset.confirm = "yes";
            target.textContent = "Confirm: reset this run and build";
          }
          break;
        case "preview":
          try {
            this.options.preview(Number(el<HTMLInputElement>("area-preview").value));
            this.close();
          } catch (error) {
            this.notice(error);
          }
          break;
      }
    });
    this.dialog.addEventListener("input", (event) => {
      const input = event.target as HTMLInputElement;
      if (input.dataset.tune)
        el(`tune-${input.dataset.tune}-value`).textContent = `${Number(input.value).toFixed(2)}×`;
    });
    this.dialog.addEventListener("change", (event) => {
      const input = event.target as HTMLInputElement;
      if (input.dataset.tune)
        void this.act({ type: "tuning", values: { [input.dataset.tune]: Number(input.value) } });
    });
    for (const id of ["inventory-open", "quick-inventory", "game-inventory"])
      el(id).addEventListener("click", () => this.open("inventory"));
    for (const id of ["skills-open", "quick-skills", "game-skills"])
      el(id).addEventListener("click", () => this.open("skills"));
    for (const id of ["pause-game", "game-pause"])
      el(id).addEventListener("click", () => this.open("pause"));
    el("town-open").addEventListener("click", () =>
      this.options.sim().adventure.state.mode === "town"
        ? this.open("town")
        : void this.act({ type: "return" }),
    );
    el("mechanics-open").addEventListener("click", () => this.open("mechanics"));
    el("run-advance").addEventListener("click", () => {
      const s = this.options.sim().adventure.state;
      void this.act({
        type: this.options.sim().adventure.hero(this.options.player()).dead
          ? "respawn"
          : s.mode === "town"
            ? "depart"
            : s.cleared
              ? "advance"
              : "return",
      });
    });
    document.querySelector("#help-dialog p")!.textContent =
      "Clear packs, defeat each area's warden, and carry your build outward into new lands. Every area mechanic is optional.";
    document.querySelector(".help-grid")!.innerHTML = [
      ["W A S D / ARROWS", "Move"],
      ["LMB / J", "Hold for a three-hit blade combo"],
      ["SHIFT / SPACE", "Dash through danger"],
      ["Q / 2", "Whorl"],
      ["R / 3", "Thornlance (Stormstep unlock)"],
      ["F / 4", "Bloom Nova (Emberwake unlock)"],
      ["1", "Healing flask"],
      ["E", "Talk, collect equipment, use a portal"],
      ["I / K", "Equipment / skill tree"],
      ["P", "Pause and playtest tuning"],
      ["T", "Channel a return to town"],
      ["M / G", "Atlas / fullscreen game mode"],
      ["MIDDLE DRAG", "Pan; C follows your traveler"],
    ]
      .map(([key, text]) => `<kbd>${key}</kbd><span>${text}</span>`)
      .join("");
  }
  private notice(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    el("adventure-notice").textContent = message;
    if (!this.dialog.open) this.options.notify(message);
  }
  async act(action: AdventureAction): Promise<void> {
    try {
      await this.options.action(action);
      el("adventure-notice").textContent = "";
      this.signature = "";
      this.update();
    } catch (error) {
      this.notice(error);
    }
  }
  open(panel: NonNullable<AdventureUI["panel"]>): void {
    this.options.clearInput();
    this.panel = panel;
    this.signature = "";
    this.dialog.className = `adventure-dialog panel-${panel}`;
    this.update();
    if (!this.dialog.open) this.options.showDialog(this.dialog);
  }
  close(): void {
    if (this.dialog.open) this.options.closeDialog(this.dialog);
  }
  event(event: CombatEvent): void {
    if (event.owner && event.owner !== this.options.player()) return;
    if (event.text.startsWith("service:")) {
      this.open("town");
      return;
    }
    if (event.type === "portal" || event.type === "boss") {
      el("area-toast").textContent = event.text;
      el("area-toast").hidden = false;
      setTimeout(() => {
        el("area-toast").hidden = true;
      }, 3000);
    }
    if (["loot", "level", "potion"].includes(event.type) && event.text)
      this.options.notify(event.text);
  }
  update(): void {
    const sim = this.options.sim(),
      id = this.options.player(),
      s = sim.adventure.state,
      h = sim.adventure.hero(id),
      stats = sim.adventure.stats(id, sim.tick);
    const percent = Math.max(0, Math.min(100, (h.hp / stats.health) * 100));
    for (const key of ["hud-life", "journal-life"])
      el(key).textContent = `${Math.ceil(h.hp)} / ${Math.ceil(stats.health)}`;
    for (const key of ["hud-gold", "journal-gold", "dialog-gold"])
      el(key).textContent = Math.floor(h.gold).toLocaleString();
    el("hero-level").textContent = `LEVEL ${h.level}`;
    el("hud-level").textContent = String(h.level);
    el("hud-health-fill").style.width = `${percent}%`;
    for (const key of ["hud-xp-fill", "journal-xp-fill"])
      el(key).style.width = `${Math.min(100, (h.xp / xpForLevel(h.level)) * 100)}%`;
    el("skill-point-count").textContent = String(h.points);
    el("skill-alert").hidden = h.points === 0;
    el("dialog-points").textContent = `${h.points} skill point${h.points === 1 ? "" : "s"}`;
    el("flask-count").textContent = `${h.potions} / 3`;
    el("lance-button").classList.toggle("locked", !stats.lance);
    el("lance-button").title = stats.lance
      ? "Thornlance (R / 3)"
      : "Unlock Thornlance in the Stormstep skill path";
    el("nova-button").classList.toggle("locked", !stats.nova);
    el("nova-button").title = stats.nova
      ? "Bloom Nova (F / 4)"
      : "Unlock Bloom Nova in the Emberwake skill path";
    for (const [button, ready] of [
      ["pulse", h.whorlReady],
      ["lance-button", h.lanceReady],
      ["nova-button", h.novaReady],
      ["potion-button", h.potionReady],
    ] as const)
      el(button).classList.toggle("cooling", ready > sim.tick);
    el("run-area-index").textContent = `LAND ${String(s.townLand + 1).padStart(2, "0")}`;
    const landTheme = themeOf(
      s.mode === "town" ? areaRecipe(s.seed, s.townLand * 4 + 1).theme : s.recipe.theme,
    );
    document.querySelector(".location-tag")!.textContent = landTheme.name.toUpperCase();
    document.querySelector(".chapter .eyebrow")!.innerHTML =
      `${landTheme.name.toUpperCase()} <span>${String(s.townLand + 1).padStart(2, "0")}</span>`;
    el("run-area-name").textContent = s.mode === "town" ? townName(s.townLand) : s.recipe.name;
    el("run-objective").textContent =
      s.mode === "town"
        ? `Rest, resupply, then enter ${areaRecipe(s.seed, sim.adventure.nextArea()).name}.`
        : s.cleared
          ? "The warden has fallen. Follow the outward gate."
          : s.bossSpawned
            ? `Defeat ${s.recipe.boss}. Read the telegraphs; make each dash count.`
            : `Defeat ${s.recipe.killGoal} creatures to draw out the area's warden.`;
    el("run-progress-fill").style.width =
      `${s.mode === "town" ? 0 : Math.min(100, (s.kills / s.recipe.killGoal) * 100)}%`;
    el("run-kills").textContent =
      s.mode === "town"
        ? "TOWN SANCTUARY"
        : s.cleared
          ? "AREA CLEARED"
          : `${s.kills} / ${s.recipe.killGoal} defeated`;
    const seconds = Math.floor((s.cleared ? s.clearTicks : sim.tick - s.enteredAt) / 60);
    el("run-clock").textContent =
      s.mode === "town"
        ? `RUN ${s.run}`
        : `${Math.floor(seconds / 60)
            .toString()
            .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
    el("run-advance").innerHTML =
      `${s.mode === "town" ? "Enter the next area" : s.cleared ? (s.area % 4 === 0 ? "Enter the next land" : "Continue outward") : "Return to town"} ${icon("arrow", 16)}`;
    el("town-open").textContent = s.mode === "town" ? "Rest & resupply" : "Town portal · T";
    if (h.dead) el("run-advance").textContent = "Rekindle your lantern";
    el<HTMLButtonElement>("run-advance").disabled = this.options.role() === "guest" && !h.dead;
    el<HTMLButtonElement>("town-open").disabled =
      this.options.role() === "guest" && s.mode !== "town";
    const mechanic = mechanicOf(
      s.mode === "town"
        ? areaRecipe(s.seed, sim.adventure.nextArea()).signature
        : s.recipe.signature,
    );
    el("mechanic-symbol").textContent = mechanic.icon;
    el("mechanic-symbol").style.color = mechanic.color;
    el("mechanic-name").textContent = mechanic.name;
    el("mechanic-copy").textContent = mechanic.description;
    const boss = s.enemies.find((e) => e.boss && e.hp > 0);
    el("boss-hud").hidden = !boss;
    if (boss) {
      el("boss-name").textContent = boss.name;
      el("boss-health").style.width = `${Math.max(0, boss.hp / boss.maxHp) * 100}%`;
      const warden = boss.warden,
        identity = WARDENS[s.recipe.signature];
      el("boss-phase").textContent =
        warden && warden.exposedUntil > sim.tick
          ? `EXPOSED · ${identity.exposedBy.toUpperCase()}`
          : warden?.move && boss.phase === "windup"
            ? `${identity.name.toUpperCase()} · DODGE THE ${identity.telegraph === "ring" ? "RING" : identity.telegraph === "marker" ? "MARKED ARCH" : "LINE"}`
            : boss.hp / boss.maxHp < 0.5
              ? "ENRAGED · PHASE II"
              : "WARDEN OF THE AREA";
    }
    const p = sim.players.get(id);
    let hint = "";
    if (p) {
      if (s.mode === "town") {
        // Services follow their townsperson's body (M09); the prompt follows it too.
        const folk = sim.townsfolk();
        const npc = TOWN_NPCS.find((n, k) => {
          const at = folk[k] ?? npcPosition(n, sim.tick);
          return Math.hypot(at.x - p.x, at.y - p.y) < 43;
        });
        if (npc) hint = `[E] ${npc.name} · ${npc.role}`;
        else if (Math.hypot(p.x - 218, p.y - 36) < 65)
          hint = `[E] Enter ${areaRecipe(s.seed, sim.adventure.nextArea()).name}`;
      } else {
        const drop = s.drops.find(
          (d) => d.kind === "item" && Math.hypot(d.x - p.x, d.y - p.y) < 48,
        );
        if (drop?.item) hint = `[E] Pick up ${drop.item.name}`;
        else if (s.cleared && Math.hypot(p.x - s.recipe.x - 275, p.y - s.recipe.y) < 68)
          hint = "[E] Continue through the outward gate";
        else {
          const m = s.mechanics.find(
            (m) => ["blood", "rift"].includes(m.kind) && Math.hypot(m.x - p.x, m.y - p.y) < 48,
          );
          if (m)
            hint =
              m.kind === "blood"
                ? `[E] ${mechanicOf(m.kind).name} · trade life; vines snare the pack`
                : `[E] ${mechanicOf(m.kind).name} · loose props on the pad travel with you`;
        }
      }
    }
    el("interaction-prompt").textContent = hint;
    el("interaction-prompt").hidden = !hint;
    const deathKey = `${s.seed}:${s.run}:${id}:${h.deaths}`;
    if (h.dead && deathKey !== this.seenDeath) {
      this.seenDeath = deathKey;
      this.open("death");
      return;
    }
    if (!h.dead && this.panel === "death") this.close();
    if (!this.panel) return;
    const signature = JSON.stringify([
      this.panel,
      this.selectedSkill,
      this.selectedItem,
      h.level,
      h.xp,
      h.gold,
      h.points,
      h.skills,
      h.inventory,
      h.equipment,
      h.bought,
      stats,
      s.area,
      s.mode,
      s.cleared,
      s.tuning,
      this.options.role(),
    ]);
    if (signature === this.signature) return;
    this.signature = signature;
    el("adventure-title").textContent = {
      inventory: "A build of your own.",
      skills: "Put down deeper roots.",
      town: "A little warmth. A sharper edge.",
      pause: "A moment to breathe.",
      death: "The lantern dims.",
      mechanics: "Make the wild work for you.",
    }[this.panel];
    el("adventure-eyebrow").textContent = {
      inventory: "EQUIPMENT & SATCHEL",
      skills: "48 NODES · FOUR PATHS · YOUR CHOICE",
      town: townName(s.townLand).toUpperCase(),
      pause:
        this.options.role() === "solo"
          ? "EXPEDITION PAUSED"
          : "CO-OP CONTINUES WHILE MENUS ARE OPEN",
      death: "YOUR BUILD IS NOT LOST",
      mechanics: `${s.recipe.name.toUpperCase()} · OPTIONAL ADVANTAGES`,
    }[this.panel];
    if (this.panel === "inventory") {
      const selected = h.inventory.find((item) => item.id === this.selectedItem) ?? h.inventory[0];
      if (selected) this.selectedItem = selected.id;
      el("adventure-panel").innerHTML =
        `<div class="inventory-layout"><section class="character-sheet"><div class="character-silhouette">${spriteSvg({ version: 1, kind: "player", seed: 142 }).replace('viewBox="-32 -56 64 64"', 'viewBox="-16 -28 34 34"')}<span>WAYFARER · LEVEL ${h.level}</span></div><div class="equipment-slots">${SLOTS.map(
          (slot) => {
            const item = h.inventory.find((item) => item.id === h.equipment[slot]);
            return `<button data-item="${esc(item?.id ?? "")}" class="equipment-slot"><span>${slot}</span><strong style="color:${item ? RARITY_COLORS[item.rarity] : "#74886d"}">${item ? esc(item.name) : "Empty"}</strong></button>`;
          },
        ).join("")}</div><dl class="character-stats">${[
          ["Damage", stats.damage.toFixed(1)],
          ["Maximum life", Math.round(stats.health)],
          ["Armor", Math.round(stats.armor)],
          ["Attack speed", `${stats.haste.toFixed(2)}×`],
          ["Critical chance", `${Math.round(stats.crit * 100)}%`],
          ["Move speed", `${stats.speed.toFixed(2)}×`],
        ]
          .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
          .join(
            "",
          )}</dl></section><section class="satchel-panel"><div class="panel-heading">Your finds <span>${h.inventory.length} / 40</span></div><button class="text-button sell-spares" data-action="sell-spares" ${s.mode !== "town" ? "disabled" : ""}>Sell unequipped common & magic gear</button><div class="item-grid">${h.inventory.map((item) => `<button class="item-card ${item.id === this.selectedItem ? "selected" : ""}" data-item="${esc(item.id)}" style="--rarity:${RARITY_COLORS[item.rarity]}" aria-label="Inspect ${esc(item.name)}"><span class="item-level">${item.level}</span>${itemIcon(item)}<strong>${esc(item.name)}</strong><small>${Object.values(h.equipment).includes(item.id) ? "EQUIPPED" : item.rarity.toUpperCase()}</small></button>`).join("")}</div>${selected ? this.itemDetail(selected, sim, id) : "<p>No equipment yet. The wild has plenty to offer.</p>"}</section></div>`;
    } else if (this.panel === "skills") {
      const selected = SKILLS.find((node) => node.id === this.selectedSkill)!;
      const reason = skillReason(selected.id, h.skills, h.points, h.level);
      el("adventure-panel").innerHTML =
        `<div class="skills-layout"><div class="skills-scroll"><div class="skills-forest">${PATHS.map(
          (path) =>
            `<section class="skill-path" style="--path:${path.color}"><h3>${icon(path.icon, 19)}${path.name}</h3><p>${path.subtitle}</p><div class="skill-nodes">${SKILLS.filter(
              (node) => node.path === path.id,
            )
              .map((node) => {
                const rank = h.skills[node.id] ?? 0,
                  available = !skillReason(node.id, h.skills, h.points, h.level);
                return `<button class="skill-node ${rank ? "learned" : ""} ${available ? "available" : ""} ${node.id === this.selectedSkill ? "selected" : ""} ${node.tier === 3 ? "keystone" : ""}" data-skill="${node.id}" aria-label="${esc(node.name)}, rank ${rank} of ${node.max > 3 ? "mastery" : node.max}"><span>${node.tier === 3 ? "✦" : node.unlock ? "✧" : "◇"}</span><strong>${node.name}</strong><small>${rank} / ${node.max > 3 ? "∞" : node.max}</small></button>`;
              })
              .join("")}</div></section>`,
        ).join(
          "",
        )}</div></div><aside class="skill-detail"><span class="eyebrow">${selected.tier === 3 ? "KEYSTONE / MASTERY" : `TIER ${selected.tier + 1}`}</span><h3>${selected.name}</h3><p>${selected.description}</p><span class="skill-rank">Rank ${h.skills[selected.id] ?? 0} / ${selected.max > 3 ? "∞" : selected.max}</span><p class="skill-requirement">${reason ?? "One skill point. A lasting change to your build."}</p><button class="primary-button full" data-action="learn" ${reason ? "disabled" : ""}>Learn · 1 point ${icon("plus", 15)}</button><div class="skill-respec"><p>Follow the links upward. Mix paths freely. Mastery nodes keep growing beyond the finite tree.</p><button class="text-button" data-action="respec" ${s.mode !== "town" ? "disabled" : ""}>Respec in town · ${Object.values(h.skills).reduce((a, b) => a + b, 0) * 10} gold</button></div></aside></div>`;
    } else if (this.panel === "town") {
      el("adventure-panel").innerHTML =
        `<div class="town-services"><div class="town-service"><span class="service-icon">${icon("flask", 27)}</span><div><h3>Iona, apothecary</h3><p>Restore life and spirit. Refill all three flasks.</p></div><button class="secondary-button" data-action="rest" ${s.mode !== "town" ? "disabled" : ""}>Rest · free</button></div><div class="town-service"><span class="service-icon">${icon("portal", 27)}</span><div><h3>Orin, waykeeper</h3><p>Next: ${esc(areaRecipe(s.seed, sim.adventure.nextArea()).name)}. Every fourth area opens a new land and town.</p></div><button class="secondary-button" data-action="depart" ${s.mode !== "town" || this.options.role() === "guest" ? "disabled" : ""}>Travel outward</button></div></div><div class="panel-heading shop-heading">Rowan's provisions <span>STOCK SCALES WITH YOUR LEVEL</span></div><div class="shop-grid">${sim.adventure
          .shop(id)
          .map(
            (item, index) =>
              `<div class="shop-card" style="--rarity:${RARITY_COLORS[item.rarity]}">${itemIcon(item)}<div><strong>${esc(item.name)}</strong><small>${item.slot.toUpperCase()} · LV ${item.level} · POWER ${item.power}</small><p>${item.affixes.map((a) => affixText(a.stat, a.value)).join("<br>")}</p></div><button class="secondary-button" data-buy="${index}" ${h.bought.includes(item.id) || h.gold < item.value * 2 || s.mode !== "town" ? "disabled" : ""}>${h.bought.includes(item.id) ? "Purchased" : `${item.value * 2} gold`}</button></div>`,
          )
          .join(
            "",
          )}</div><button class="text-button" data-panel="inventory">Open equipment to equip or sell your finds ${icon("arrow", 14)}</button>`;
    } else if (this.panel === "mechanics") {
      const recipe = s.mode === "town" ? areaRecipe(s.seed, sim.adventure.nextArea()) : s.recipe;
      el("adventure-panel").innerHTML =
        `<p class="mechanic-intro">Defeat creatures and their warden to clear this area. These mechanics are optional: ignore them, or use them to clear faster and earn more.</p><div class="mechanic-guide">${recipe.mechanics
          .map((kind) => {
            const m = mechanicOf(kind);
            const physical = SHOWCASE[kind];
            return `<article><span style="color:${m.color}">${m.icon}</span><div><h3>${m.name} ${kind === recipe.signature ? "<small>AREA SIGNATURE</small>" : ""}</h3><p>${m.description}</p><p class="mechanic-physical"><b>${physical.name}.</b> ${physical.physical}</p><strong>${m.advantage}</strong></div></article>`;
          })
          .join(
            "",
          )}</div>${recipe.combination ? `<div class="combination-note">NEW COMBINATION: ${mechanicOf(recipe.combination.from).name} also triggers ${mechanicOf(recipe.combination.into).name} after a short delay.</div>` : ""}<div class="combination-note warden-note">${esc(recipe.boss).toUpperCase()} · ${WARDENS[recipe.signature].name}: ${WARDENS[recipe.signature].summary} Weakness: ${WARDENS[recipe.signature].exposedBy}.</div><p class="mechanic-intro">One ${mechanicOf(recipe.signature).name} spot is calm (its physical effects are off) and one is wild (stronger); the rest follow the area.</p><div class="area-facts"><span>Land ${recipe.land + 1} · ${themeOf(recipe.theme).name}</span><span>${recipe.killGoal} creatures + ${recipe.boss}</span><span>${recipe.procedural ? "PROCEDURALLY COMPOSED" : "AUTHORED INTRODUCTION"}</span></div>`;
    } else if (this.panel === "death") {
      el("adventure-panel").innerHTML =
        `<div class="death-summary">${icon("fire", 45)}<p>The wild keeps ${h.goldLost} gold.<br>Your levels, skills and equipment stay with you.</p><div><span>AREA <strong>${s.area}</strong></span><span>LEVEL <strong>${h.level}</strong></span><span>DEFEATED <strong>${h.kills}</strong></span></div><button class="primary-button" data-action="respawn">${sim.players.size > 1 && [...sim.players.keys()].some((other) => other !== id && !sim.adventure.hero(other).dead) ? "Rejoin at the trailhead" : `Return to ${esc(townName(s.townLand))}`} ${icon("arrow", 17)}</button></div>`;
    } else {
      const host = this.options.role() !== "guest";
      const tune = (key: keyof Tuning, label: string, max: number) =>
        `<label class="tuning-field"><span>${label}<b id="tune-${key}-value">${s.tuning[key].toFixed(2)}×</b></span><input type="range" min="0.1" max="${max}" step="0.05" value="${s.tuning[key]}" data-tune="${key}" aria-label="${label} multiplier" ${host ? "" : "disabled"} /></label>`;
      el("adventure-panel").innerHTML =
        `<div class="pause-actions"><button class="primary-button" data-action="${h.dead ? "respawn" : "resume"}">${h.dead ? "Rekindle your lantern" : "Return to the wild"} ${icon("play", 16)}</button><button class="secondary-button" data-panel="inventory">Equipment</button><button class="secondary-button" data-panel="skills">Skill tree</button><button class="secondary-button" data-action="settings">Display settings</button><button class="secondary-button" data-action="audio">Toggle sound</button><button class="secondary-button" data-action="journal">Run journal</button></div><div class="difficulty-card"><div><span class="eyebrow">QUICK PLAYTEST TUNING</span><h3>Choose your edge.</h3><p>Changes apply immediately. Adjust the challenge as you explore.</p></div>${tune("difficulty", "Overall difficulty", 3)}<div class="difficulty-presets"><button data-preset="0.6" ${host ? "" : "disabled"}>Story</button><button data-preset="1" ${host ? "" : "disabled"}>Wild</button><button data-preset="1.75" ${host ? "" : "disabled"}>Savage</button></div></div><details class="advanced-tuning" open><summary>Player & enemy multipliers</summary><div class="tuning-columns"><section><h3>Your wayfarer</h3>${tune("playerDamage", "Player damage", 5)}${tune("playerHealth", "Player health", 5)}${tune("playerSpeed", "Player speed", 3)}</section><section><h3>The creatures</h3>${tune("enemyDamage", "Enemy damage", 5)}${tune("enemyHealth", "Enemy health", 5)}${tune("enemySpeed", "Enemy speed", 3)}</section></div></details>${host ? `<details class="advanced-tuning"><summary>Encounter preview & new run</summary><p>Preview any generated area for QA. This changes the active encounter for the party.</p><div class="input-row"><input id="area-preview" type="number" min="1" step="1" value="${Math.max(1, s.area)}" aria-label="Preview area number" /><button class="secondary-button" data-action="preview">Preview area</button></div><button class="text-button" data-action="new-run">Start a new run…</button></details>` : "<p class=co-op-note>The host controls shared difficulty and encounters.</p>"}<button class="text-button" data-action="return" ${s.mode === "town" || !host ? "disabled" : ""}>Channel a return to town · T</button>`;
    }
  }
  private itemDetail(item: Item, sim: Simulation, id: string): string {
    const h = sim.adventure.hero(id),
      equipped = h.equipment[item.slot] === item.id,
      current = h.inventory.find((other) => other.id === h.equipment[item.slot]);
    const delta = item.power - (current?.power ?? 0);
    return `<div class="item-detail" style="--rarity:${RARITY_COLORS[item.rarity]}"><div><span class="eyebrow">${item.rarity.toUpperCase()} ${item.slot.toUpperCase()} · LEVEL ${item.level}</span><h3>${esc(item.name)}</h3></div><div class="item-power">${item.power}<span>POWER</span><small class="${delta >= 0 ? "positive" : "negative"}">${equipped ? "EQUIPPED" : `${delta >= 0 ? "+" : ""}${delta} vs equipped`}</small></div><ul>${item.affixes.map((a) => `<li>${affixText(a.stat, a.value)}</li>`).join("")}</ul>${item.special !== "none" ? `<p class="legendary-effect">${SPECIAL_TEXT[item.special]}</p>` : ""}<div class="item-actions"><button class="primary-button small" data-action="equip" ${equipped ? "disabled" : ""}>${equipped ? "Equipped" : "Equip"}</button><button class="secondary-button" data-action="sell" ${equipped || sim.adventure.state.mode !== "town" ? "disabled" : ""}>Sell · ${item.value} gold</button></div></div>`;
  }
}
