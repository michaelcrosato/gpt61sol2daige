import { MAX_NPCS } from "../engine/limits.ts";
import { clamp, hash, lerp } from "../engine/math.ts";
import type { Player, Simulation } from "../engine/simulation.ts";
import { EntityVisibility } from "../engine/visibility.ts";
import {
  CHUNK_SIZE,
  CHUNK_TILES,
  type Chunk,
  Decor,
  LANDMARKS,
  Terrain,
  TILE,
  type World,
} from "../engine/world.ts";
import { THEMES, themeOf } from "../game/content.ts";
import type { BodyPose } from "../physics/types.ts";
import { type AdventureActor, CombatRenderer } from "./combat.ts";
import { PropRenderer } from "./props.ts";
import { drawFields, drawStatus, drawSurfaces } from "./reactions.ts";
import { remainsGroups } from "./rigs.ts";
import { PALETTE, type SpriteRecipe, spritePixels } from "./sprites.ts";

const GROUND = ["#304f39", "#486747", "#818164", "#34666a", "#294f59", "#8a8766", "#6a7662"];
const SHADES = ["#36563d", "#4d6c48", "#89896b", "#386d6e", "#2d5660", "#949171", "#73806b"];
const PLAYER_COLORS = [
  "#d4e9a2",
  "#dca693",
  "#9ccddd",
  "#c7abd9",
  "#f1cf89",
  "#d7adc4",
  "#91d6ba",
  "#c2c6ed",
];
type DrawItem = {
  y: number;
  kind: "decor" | "npc" | "player" | "landmark" | "adventure" | "physical" | "remains";
  x: number;
  type: number;
  variant: number;
  player?: Player;
  id?: string;
  adventure?: AdventureActor;
  physical?: BodyPose;
  /** M09: one dead monster's remains, drawn together. */
  remains?: BodyPose[];
};
export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly mini: HTMLCanvasElement;
  x = 70;
  y = 0;
  zoom = 1.8;
  targetZoom = 1.8;
  width = 1000;
  height = 650;
  follow = true;
  debug = false;
  lantern = true;
  daytime = 0.38;
  /** M09 local screen feedback preferences: shake strength (0–1) and hit/blast flashes. */
  shake = 1;
  flash = true;
  /** Last frame's camera shake and flash (inspection and tests). */
  feedback = { shake: 0, flash: 0 };
  drawDistance = 4096;
  entityLimit = 8192;
  waypoint: { x: number; y: number } | null = null;
  /** Local prompt for the grab interaction (presentation only). */
  grabHint: { x: number; y: number; text: string } | null = null;
  /** Prop the local traveler holds, outlined in the world. */
  heldProp: string | null = null;
  metrics = { drawn: 0, candidates: 0, limited: 0, renderMs: 0, terrainCanvases: 0, lod: "detail" };
  private readonly visible = new EntityVisibility(MAX_NPCS);
  private readonly terrainCache = new Map<string, HTMLCanvasElement>();
  private readonly spriteCache = new Map<string, HTMLCanvasElement>();
  private readonly combat = new CombatRenderer();
  private readonly props = new PropRenderer();
  private ground: readonly string[] = GROUND;
  private shades: readonly string[] = SHADES;
  private theme = "";
  private transition = -1;
  private readonly overview = document.createElement("canvas");
  private overviewKey = "";
  private readonly dots = document.createElement("canvas");
  private dotImage?: ImageData;
  private dotPixels?: Uint32Array;
  private readonly dotColors = new Uint32Array(
    new Uint8Array([173, 217, 178, 255, 196, 173, 121, 255, 124, 172, 155, 255]).buffer,
  );
  private seed = -1;
  private revision = -1;
  private cachedWorld?: World;
  private frame = 0;
  private observer: ResizeObserver;
  constructor(canvas: HTMLCanvasElement, mini: HTMLCanvasElement) {
    this.canvas = canvas;
    this.mini = mini;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas 2D is unavailable");
    this.ctx = ctx;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
  }
  dispose(): void {
    this.observer.disconnect();
  }
  resize(): void {
    const rect = this.canvas.getBoundingClientRect(),
      ratio = Math.min(devicePixelRatio || 1, 2);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.max(1, Math.round(rect.width * ratio));
    this.canvas.height = Math.max(1, Math.round(rect.height * ratio));
    this.ctx.imageSmoothingEnabled = false;
  }
  private drawDistantCreatures(sim: Simulation, alpha: number, ratio: number): void {
    const width = Math.ceil(this.width),
      height = Math.ceil(this.height);
    const context = this.dots.getContext("2d")!;
    if (!this.dotImage || this.dots.width !== width || this.dots.height !== height) {
      this.dots.width = width;
      this.dots.height = height;
      this.dotImage = context.createImageData(width, height);
      this.dotPixels = new Uint32Array(this.dotImage.data.buffer);
    }
    const pixels = this.dotPixels!;
    pixels.fill(0);
    for (let n = 0; n < this.visible.count; n++) {
      const i = this.visible.ids[n];
      if (
        sim.adventure.state.mode === "area" &&
        !sim.ownsPhysicalAmbient(i) &&
        (sim.x[i] - sim.adventure.state.recipe.x) ** 2 +
          (sim.y[i] - sim.adventure.state.recipe.y) ** 2 <
          (sim.adventure.state.recipe.radius + 35) ** 2
      )
        continue;
      const x = Math.round(
        (lerp(sim.px[i], sim.x[i], alpha) - this.x) * this.zoom + this.width / 2,
      );
      const y = Math.round(
        (lerp(sim.py[i], sim.y[i], alpha) - this.y) * this.zoom + this.height / 2,
      );
      if (x < 0 || x >= width - 1 || y < 0 || y >= height - 1) continue;
      const offset = y * width + x,
        color = this.dotColors[sim.kind[i]];
      pixels[offset] =
        pixels[offset + 1] =
        pixels[offset + width] =
        pixels[offset + width + 1] =
          color;
      this.metrics.drawn++;
    }
    // One upload and one composite replace tens of thousands of Canvas draw calls.
    context.putImageData(this.dotImage, 0, 0);
    this.ctx.save();
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.ctx.drawImage(this.dots, 0, 0, this.width, this.height);
    this.ctx.restore();
  }
  setZoom(zoom: number): void {
    this.targetZoom = clamp(zoom, 0.08, 5);
  }
  screenToWorld(x: number, y: number): { x: number; y: number } {
    return {
      x: this.x + (x - this.width / 2) / this.zoom,
      y: this.y + (y - this.height / 2) / this.zoom,
    };
  }
  private sprite(
    kind: SpriteRecipe["kind"],
    variant = 0,
    frame = 0,
    color = 0,
    lantern = true,
  ): HTMLCanvasElement {
    const key = `${kind}:${variant % 4}:${frame % 8}:${color}:${lantern}`;
    const existing = this.spriteCache.get(key);
    if (existing) return existing;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    const palette = kind === "player" ? [...PALETTE.player] : undefined;
    if (palette && color) palette[2] = PLAYER_COLORS[color % 8];
    for (const p of spritePixels(
      { version: 1, kind, seed: (variant % 4) + 142, palette },
      frame % 8,
      { lantern },
    )) {
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x + 32, p.y + 56, p.w, p.h);
    }
    this.spriteCache.set(key, canvas);
    return canvas;
  }
  private chunkCanvas(chunk: Chunk): HTMLCanvasElement {
    const key = `${chunk.cx},${chunk.cy}`;
    const existing = this.terrainCache.get(key);
    if (existing) {
      this.terrainCache.delete(key);
      this.terrainCache.set(key, existing);
      return existing;
    }
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = CHUNK_SIZE;
    const ctx = canvas.getContext("2d")!;
    for (let y = 0; y < CHUNK_TILES; y++)
      for (let x = 0; x < CHUNK_TILES; x++) {
        const i = y * CHUNK_TILES + x,
          type = chunk.tiles[i],
          v = chunk.variants[i],
          px = x * TILE,
          py = y * TILE;
        ctx.fillStyle = this.ground[type];
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = this.shades[type];
        for (let j = 0; j < 7; j++) {
          const h = hash(v, j, 731),
            ox = h % 15,
            oy = (h >>> 8) % 15;
          ctx.fillRect(px + ox, py + oy, 1 + (h & 1), 1);
        }
        if (type === Terrain.Forest || type === Terrain.Meadow) {
          ctx.fillStyle = type === Terrain.Forest ? "#3c6140" : "#5a7a4d";
          if (v % 3 === 0) {
            ctx.fillRect(px + 4, py + 9, 1, 3);
            ctx.fillRect(px + 3, py + 8, 1, 2);
            ctx.fillRect(px + 6, py + 7, 1, 4);
          }
          if (v % 13 === 0) {
            ctx.fillStyle = "#768853";
            ctx.fillRect(px + 11, py + 5, 2, 2);
          }
        } else if (type === Terrain.Path) {
          ctx.fillStyle = "#747959";
          ctx.fillRect(px + 2 + (v % 3), py + 3, 4, 2);
          ctx.fillRect(px + 9, py + 11, 3, 1);
        } else if (type === Terrain.Stone) {
          ctx.strokeStyle = "#4c6250";
          ctx.strokeRect(px + 1, py + 1, 13, 13);
          ctx.fillStyle = "#89947c";
          ctx.fillRect(px + 2, py + 2, 11, 1);
          ctx.fillStyle = "#4c6c40";
          ctx.fillRect(px, py + 13, 4, 3);
        }
      }
    this.terrainCache.set(key, canvas);
    if (this.terrainCache.size > 96)
      this.terrainCache.delete(this.terrainCache.keys().next().value!);
    return canvas;
  }
  draw(
    sim: Simulation,
    localId: string,
    alpha: number,
    time: number,
    delta: number,
    renderTick = sim.tick,
  ): void {
    this.combat.tick = renderTick;
    this.combat.interpolation = alpha;
    const start = performance.now(),
      ctx = this.ctx;
    const adventure = sim.adventure.state;
    const theme = themeOf(
      adventure.mode === "area"
        ? adventure.recipe.theme
        : THEMES[adventure.townLand % THEMES.length].id,
    );
    if (theme.id !== this.theme) {
      this.theme = theme.id;
      this.ground = theme.ground;
      this.shades = this.ground.map((color) => {
        const n = Number.parseInt(color.slice(1), 16);
        return `#${[n >> 16, (n >> 8) & 255, n & 255]
          .map((c) =>
            Math.min(255, c + 7)
              .toString(16)
              .padStart(2, "0"),
          )
          .join("")}`;
      });
      this.terrainCache.clear();
      this.overviewKey = "";
    }
    if (
      this.cachedWorld !== sim.world ||
      this.seed !== sim.world.seed ||
      this.revision !== sim.world.revision
    ) {
      this.terrainCache.clear();
      this.overviewKey = "";
      this.seed = sim.world.seed;
      this.revision = sim.world.revision;
      this.cachedWorld = sim.world;
    }
    const player = sim.players.get(localId);
    if (this.transition !== adventure.transition) {
      if (this.transition >= 0 && player) {
        this.x = player.x;
        this.y = player.y;
        this.follow = true;
      }
      this.transition = adventure.transition;
    }
    if (player && this.follow) {
      const smoothing = 1 - Math.exp(-delta * 6);
      this.x = lerp(this.x, lerp(player.px, player.x, alpha), smoothing);
      this.y = lerp(this.y, lerp(player.py, player.y, alpha), smoothing);
    }
    this.zoom = lerp(this.zoom, this.targetZoom, 1 - Math.exp(-delta * 10));
    const ratio = this.canvas.width / this.width;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = "#233b30";
    ctx.fillRect(0, 0, this.width, this.height);
    const feedback = this.screenFeedback(sim, localId, renderTick);
    ctx.translate(this.width / 2 + feedback.dx, this.height / 2 + feedback.dy);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
    const left = this.x - Math.min(this.drawDistance, this.width / (2 * this.zoom) + 60),
      right = this.x + Math.min(this.drawDistance, this.width / (2 * this.zoom) + 60);
    const top = this.y - Math.min(this.drawDistance, this.height / (2 * this.zoom) + 60),
      bottom = this.y + Math.min(this.drawDistance, this.height / (2 * this.zoom) + 80);
    const fog = Math.hypot(this.width, this.height) / (2 * this.zoom) > this.drawDistance * 0.92;
    ctx.save();
    if (fog) {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.drawDistance, 0, Math.PI * 2);
      ctx.clip();
    }
    const items: DrawItem[] = [];
    this.metrics.drawn = 0;
    const visibleChunks =
      (Math.ceil((right - left) / CHUNK_SIZE) + 1) * (Math.ceil((bottom - top) / CHUNK_SIZE) + 1);
    if (this.zoom < 0.4 || visibleChunks > 88) {
      this.metrics.lod = "overview";
      const stride = this.zoom < 0.17 ? 128 : 64;
      const startX = Math.floor(left / stride),
        startY = Math.floor(top / stride);
      const columns = Math.ceil(right / stride) - startX,
        rows = Math.ceil(bottom / stride) - startY;
      const key = `${stride}:${startX}:${startY}:${columns}:${rows}`;
      if (this.overviewKey !== key) {
        this.overview.width = columns;
        this.overview.height = rows;
        const overview = this.overview.getContext("2d")!;
        for (let y = 0; y < rows; y++)
          for (let x = 0; x < columns; x++) {
            overview.fillStyle =
              this.ground[
                sim.world.sample(
                  ((startX + x) * stride) / TILE,
                  ((startY + y) * stride) / TILE,
                ).terrain
              ];
            overview.fillRect(x, y, 1, 1);
          }
        this.overviewKey = key;
      }
      ctx.drawImage(
        this.overview,
        startX * stride,
        startY * stride,
        columns * stride,
        rows * stride,
      );
    } else {
      this.metrics.lod = this.zoom < 0.8 ? "canopy" : "detail";
      const minCX = Math.floor(left / CHUNK_SIZE),
        maxCX = Math.floor(right / CHUNK_SIZE),
        minCY = Math.floor(top / CHUNK_SIZE),
        maxCY = Math.floor(bottom / CHUNK_SIZE);
      for (let cy = minCY; cy <= maxCY; cy++)
        for (let cx = minCX; cx <= maxCX; cx++) {
          const chunk = sim.world.getChunk(cx, cy);
          ctx.drawImage(this.chunkCanvas(chunk), cx * CHUNK_SIZE, cy * CHUNK_SIZE);
          for (let i = 0; i < 256; i++) {
            const x = cx * CHUNK_SIZE + (i % 16) * TILE + 8,
              y = cy * CHUNK_SIZE + Math.floor(i / 16) * TILE + 10;
            if (x < left || x > right || y < top || y > bottom) continue;
            const type = chunk.decor[i],
              v = chunk.variants[i];
            if (
              type === Decor.Crystal &&
              sim.collected.has(`${Math.floor(x / TILE)},${Math.floor(y / TILE)}`)
            )
              continue;
            if (type) items.push({ x, y, type, variant: v, kind: "decor" });
            if (
              (chunk.tiles[i] === Terrain.Water || chunk.tiles[i] === Terrain.DeepWater) &&
              v % 6 === 0
            ) {
              ctx.fillStyle = `rgba(137,193,177,${0.13 + Math.sin(time * 0.7 + v) * 0.1})`;
              ctx.fillRect(x - 5 + Math.round(Math.sin(time + v) * 2), y - 4, 7, 1);
            }
          }
        }
    }
    this.combat.ground(ctx, sim, time, this.zoom);
    this.visible.select(
      sim.x,
      sim.y,
      sim.count,
      { x: this.x, y: this.y, radius: this.drawDistance, left, right, top, bottom },
      this.entityLimit,
    );
    this.metrics.candidates = this.visible.candidates;
    this.metrics.limited = this.visible.candidates - this.visible.count;
    if (this.zoom < 0.65) {
      this.drawDistantCreatures(sim, alpha, ratio);
    } else
      for (let n = 0; n < this.visible.count; n++) {
        const i = this.visible.ids[n],
          x = lerp(sim.px[i], sim.x[i], alpha),
          y = lerp(sim.py[i], sim.y[i], alpha);
        if (
          adventure.mode === "area" &&
          !sim.ownsPhysicalAmbient(i) &&
          (x - adventure.recipe.x) ** 2 + (y - adventure.recipe.y) ** 2 <
            (adventure.recipe.radius + 35) ** 2
        )
          continue;
        if (x < left || x > right || y < top || y > bottom) continue;
        this.metrics.drawn++;
        items.push({ kind: "npc", x, y, type: sim.kind[i], variant: i, id: String(i) });
      }
    for (const actor of this.combat.actors(sim, alpha))
      if (
        actor.x >= left - 90 &&
        actor.x <= right + 90 &&
        actor.y >= top - 130 &&
        actor.y <= bottom + 90
      )
        items.push({
          kind: "adventure",
          x: actor.x,
          y: actor.y,
          type: 0,
          variant: 0,
          adventure: actor,
        });
    for (const l of LANDMARKS.filter(
      (landmark) => adventure.mode === "town" && landmark.kind === "camp",
    ))
      if (l.x >= left && l.x <= right && l.y >= top && l.y <= bottom)
        items.push({
          kind: "landmark",
          x: l.x,
          y: l.y,
          type: l.kind === "camp" ? 0 : 1,
          variant: 0,
          id: l.id,
        });
    for (const p of sim.players.values())
      items.push({
        kind: "player",
        x: lerp(p.px, p.x, alpha),
        y: lerp(p.py, p.y, alpha),
        type: p.color,
        variant: 0,
        player: p,
      });
    this.props.beginFrame();
    const reactions = sim.physicalReactions();
    this.props.activeFans = new Set(
      reactions.fields.filter((f) => f.id.startsWith("fan:")).map((f) => f.source),
    );
    // Puddles and slicks lie under props and actors.
    drawSurfaces(
      ctx,
      reactions.surfaces.filter(
        (s) =>
          s.x > left - s.radius &&
          s.x < right + s.radius &&
          s.y > top - s.radius &&
          s.y < bottom + s.radius,
      ),
      time,
    );
    const held = new Set(
      (sim.physical
        ? sim.physical.combat.holdList()
        : (sim.replicaPhysics?.combat?.holds ?? [])
      ).map((hold) => hold.id),
    );
    const physical = sim.physicalProps(alpha),
      remains = remainsGroups(physical);
    // A monster is drawn by its remains only once its body is a ragdoll; loose armor knocked
    // off while it lived (or where ragdolls are off) leaves its death pose to the record.
    this.combat.remains = new Set(
      [...remains]
        .filter(([, bodies]) => bodies.some((b) => !b.blueprint!.rig!.loose))
        .map(([id]) => id),
    );
    this.props.foliage = sim.physicalFoliage();
    for (const prop of physical)
      if (
        !prop.blueprint?.rig &&
        prop.x > left - 40 &&
        prop.x < right + 40 &&
        prop.y > top - 40 &&
        prop.y < bottom + 70
      )
        items.push({ kind: "physical", x: prop.x, y: prop.y, type: 0, variant: 0, physical: prop });
    // A dead monster's remains sort as one body at its lowest point (M09).
    for (const [enemy, bodies] of remains) {
      const x = bodies.reduce((sum, b) => sum + b.x, 0) / bodies.length,
        y = Math.max(...bodies.map((b) => b.y));
      if (x > left - 60 && x < right + 60 && y > top - 40 && y < bottom + 90)
        items.push({ kind: "remains", x, y, type: 0, variant: enemy, remains: bodies });
    }
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    const links = sim
      .physicalLinks(alpha)
      .filter(
        (l) =>
          Math.max(l.ax, l.bx) > left - 40 &&
          Math.min(l.ax, l.bx) < right + 40 &&
          Math.max(l.ay, l.by) > top - 40 &&
          Math.min(l.ay, l.by) < bottom + 70,
      );
    const frame = Math.floor(time * 9);
    for (const item of items) {
      if (item.kind === "decor") this.drawDecor(item, player, time);
      else if (item.kind === "physical")
        this.props.draw(
          ctx,
          item.physical!,
          time,
          sim.tick,
          held.has(item.physical!.id),
          reactions.statuses.get(item.physical!.id),
        );
      else if (item.kind === "remains") {
        this.combat.rigs.remains(ctx, item.remains!, renderTick, (x, y, r, color, strength) =>
          this.combat.light(ctx, x, y, r, color, strength),
        );
        for (const body of item.remains!) {
          const status = reactions.statuses.get(body.id);
          if (status) drawStatus(ctx, body.x, body.y, 6, status, time);
        }
      } else if (item.kind === "adventure")
        this.combat.actor(ctx, item.adventure!, sim, alpha, time, this.zoom);
      else if (item.kind === "landmark") this.drawLandmark(item, sim, time);
      else if (item.kind === "npc") {
        ctx.fillStyle = "#162f2c55";
        ctx.fillRect(item.x - 4, item.y, 8, 3);
        ctx.drawImage(
          this.sprite(
            ["wisp", "deer", "beetle"][item.type] as SpriteRecipe["kind"],
            0,
            frame + (item.variant % 8),
          ),
          Math.round(item.x) - 32,
          Math.round(item.y) - 56,
        );
      } else {
        const p = item.player!;
        ctx.fillStyle = "#1b30268a";
        ctx.beginPath();
        ctx.ellipse(item.x, item.y + 1, 8, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        if (this.lantern) {
          const swing = sim.adventure.hero(p.id).recoil.swing,
            side = Math.cos(p.facing) < -0.3 ? -1 : 1,
            lx = item.x + side * 9 - Math.sin(swing) * 5,
            ly = item.y - 6 + (1 - Math.cos(swing)) * 3;
          const glow = ctx.createRadialGradient(lx, ly, 0, lx, ly, 25);
          glow.addColorStop(0, "#f2d68a24");
          glow.addColorStop(1, "#f2d68a00");
          ctx.fillStyle = glow;
          ctx.fillRect(item.x - 20, item.y - 35, 60, 60);
        }
        const walk = Math.hypot(p.vx, p.vy) > 5 ? Math.floor(p.steps / 3.5) : 0,
          hero = sim.adventure.hero(p.id),
          recoil = hero.recoil,
          mirror = Math.cos(p.facing) < -0.3 ? -1 : 1;
        ctx.save();
        ctx.translate(Math.round(item.x), Math.round(item.y));
        if (hero.dead) {
          ctx.rotate(-Math.PI / 2);
          ctx.scale(1, 0.55);
          ctx.globalAlpha = 0.7;
        } else ctx.rotate(recoil.lean); // M09 controlled recoil about the feet
        ctx.scale(mirror, 1);
        // The cloak's hem trails the body's motion; the silhouette stays the wayfarer's.
        const trail = clamp(-p.vx * mirror * 0.035, -3, 3);
        ctx.fillStyle = "#567b70";
        ctx.fillRect(-7 + Math.min(0, trail), -6, 3 + Math.abs(trail), 4);
        ctx.drawImage(this.sprite("player", 0, walk, p.color, false), -32, -56);
        // The lantern hangs from the hand and swings like a pendulum (M09).
        ctx.save();
        ctx.translate(9, -9);
        ctx.rotate(hero.dead ? 0 : recoil.swing * mirror);
        ctx.fillStyle = "#6e6349";
        ctx.fillRect(-2, 1, 4, 5);
        ctx.fillStyle = PALETTE.player[4];
        ctx.fillRect(-1, 2, 2, 3);
        ctx.restore();
        ctx.restore();
        this.combat.player(ctx, sim, p, item.x, item.y);
        ctx.fillStyle = PLAYER_COLORS[p.color];
        ctx.beginPath();
        ctx.moveTo(item.x, item.y - 30);
        ctx.lineTo(item.x - 3, item.y - 34);
        ctx.lineTo(item.x + 3, item.y - 34);
        ctx.fill();
        if (p.id !== localId || this.zoom < 0.6) {
          ctx.font = `${Math.max(7, 10 / this.zoom)}px monospace`;
          ctx.textAlign = "center";
          ctx.fillStyle = "#e0e9cd";
          ctx.fillText(p.name, item.x, item.y - 39);
        }
      }
    }
    this.props.links(ctx, links, time);
    // Monster statuses (burning, soaked, oiled, charged) over the actors.
    if (reactions.statuses.size)
      for (const e of sim.adventure.state.enemies) {
        const status = reactions.statuses.get(`enemy-${e.id}`);
        if (status && e.hp > 0) drawStatus(ctx, e.x, e.y - e.radius * 0.6, e.radius, status, time);
      }
    drawFields(
      ctx,
      reactions.fields.filter((f) =>
        f.shape.kind === "lane"
          ? true
          : f.shape.x > left - f.shape.radius &&
            f.shape.x < right + f.shape.radius &&
            f.shape.y > top - f.shape.radius &&
            f.shape.y < bottom + f.shape.radius,
      ),
      time,
    );
    this.combat.effects(ctx, sim, localId, this.zoom);
    if (this.grabHint && this.zoom > 0.8) {
      const { x, y, text } = this.grabHint;
      ctx.font = "7px monospace";
      ctx.textAlign = "center";
      const width = ctx.measureText(text).width + 12;
      ctx.fillStyle = "#182a21e8";
      ctx.fillRect(x - width / 2, y - 40, width, 14);
      ctx.fillStyle = "#e8dcae";
      ctx.fillText(text, x, y - 30);
    }
    for (const event of sim.events) {
      const age = (sim.tick - event.tick) / 60;
      if (event.type === "pulse" && age < 0.65) {
        ctx.strokeStyle = `rgba(225,239,163,${(1 - age / 0.65) * 0.8})`;
        ctx.lineWidth = 2 * (1 - age / 0.65);
        ctx.beginPath();
        ctx.ellipse(event.x, event.y, age * 170, age * 145, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      if ((event.type === "shard" || event.type === "beacon") && age < 2) {
        ctx.fillStyle = `rgba(241,214,144,${1 - age / 2})`;
        for (let i = 0; i < 12; i++)
          ctx.fillRect(
            event.x + Math.sin(i * 2.4 + age) * age * 30,
            event.y - age * 35 + Math.cos(i * 1.7) * age * 15,
            2,
            2,
          );
      }
    }
    if (this.waypoint) {
      ctx.strokeStyle = "#e1d49a";
      ctx.setLineDash([3 / this.zoom, 5 / this.zoom]);
      ctx.lineWidth = 1 / this.zoom;
      ctx.beginPath();
      ctx.arc(this.waypoint.x, this.waypoint.y, 12 / this.zoom, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (this.debug) this.drawDebug(sim, left, right, top, bottom);
    // Deterministic drifting motes and ambient shading are presentation-only.
    if (this.zoom > 0.5)
      for (let i = 0; i < 32; i++) {
        const x = this.x + Math.sin(i * 72.1 + time * 0.04) * 390,
          y = this.y + Math.cos(i * 93.2 + time * 0.05) * 240;
        ctx.fillStyle = `rgba(228,222,160,${0.12 + (1 + Math.sin(time * 0.6 + i)) * 0.16})`;
        ctx.fillRect(x, y, 1, 1);
      }
    ctx.restore();
    if (fog) {
      const haze = ctx.createRadialGradient(
        this.x,
        this.y,
        this.drawDistance * 0.82,
        this.x,
        this.y,
        this.drawDistance,
      );
      haze.addColorStop(0, "#233b3000");
      haze.addColorStop(1, "#233b30");
      ctx.fillStyle = haze;
      ctx.fillRect(
        this.x - this.drawDistance,
        this.y - this.drawDistance,
        this.drawDistance * 2,
        this.drawDistance * 2,
      );
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (feedback.flash > 0) {
      ctx.fillStyle = feedback.color;
      ctx.globalAlpha = feedback.flash;
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.globalAlpha = 1;
    }
    const vignette = ctx.createRadialGradient(
      this.width / 2,
      this.height / 2,
      this.width * 0.15,
      this.width / 2,
      this.height / 2,
      this.width * 0.7,
    );
    vignette.addColorStop(0, "#071d1600");
    vignette.addColorStop(1, "#071d1670");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, this.width, this.height);
    if (this.daytime > 0.65) {
      ctx.fillStyle = `rgba(18,25,52,${(this.daytime - 0.65) * 0.8})`;
      ctx.fillRect(0, 0, this.width, this.height);
    }
    if (this.frame++ % 15 === 0) this.drawMinimap(sim, localId);
    this.metrics.terrainCanvases = this.terrainCache.size;
    this.metrics.renderMs = performance.now() - start;
  }
  /**
   * M09 screen feedback from recent events near the camera: heavy falls, knockdowns, blasts and
   * blows to the local traveler shake the view and big ones flash. Presentation only, scaled by
   * this device's preferences and never part of the simulation.
   */
  private screenFeedback(sim: Simulation, localId: string, tick: number) {
    let shake = 0,
      flash = 0,
      color = "#fff4d6";
    for (const e of sim.adventure.state.events) {
      const age = (tick - e.tick) / 60;
      if (age < 0 || age > 0.5) continue;
      if (Math.hypot(e.x - this.x, e.y - this.y) > 520) continue;
      let amplitude = 0,
        bright = 0;
      if (e.type === "rig")
        amplitude = e.text.startsWith("fall:")
          ? 1.4 * e.amount
          : e.text.startsWith("topple:")
            ? 1.2 * e.amount
            : e.text.startsWith("shed:")
              ? 0.8
              : 0;
      else if (e.type === "reaction" && e.text === "blast") {
        amplitude = 4.5;
        bright = 0.32;
      } else if (e.type === "hurt" && e.owner === localId) {
        amplitude = 2.2;
        if (age < 0.2 && 0.22 * (1 - age / 0.2) > flash) color = "#e3725f";
        bright = 0.22;
      } else if (e.type === "kill" && e.amount >= 3) {
        amplitude = 5;
        bright = 0.25;
      } else if (e.type === "impact") amplitude = 0.7;
      shake += amplitude * Math.max(0, 1 - age / 0.4);
      if (bright > 0 && age < 0.2) flash = Math.max(flash, bright * (1 - age / 0.2));
    }
    shake = Math.min(7, shake) * this.shake;
    this.feedback = { shake, flash: this.flash ? flash : 0 };
    return {
      dx: shake ? Math.sin(tick * 1.7) * shake : 0,
      dy: shake ? Math.cos(tick * 2.3) * shake * 0.7 : 0,
      flash: this.flash ? flash : 0,
      color,
    };
  }
  private drawDecor(item: DrawItem, player: Player | undefined, time: number): void {
    const ctx = this.ctx,
      { x, y, type, variant } = item;
    const tree = type === Decor.Pine || type === Decor.Oak;
    if (tree) {
      ctx.fillStyle = "#112e2955";
      ctx.beginPath();
      ctx.ellipse(x + 7, y + 1, type === Decor.Oak ? 23 : 16, 7, -0.4, 0, Math.PI * 2);
      ctx.fill();
      if (player && Math.abs(player.x - x) < 25 && player.y < y && player.y > y - 50)
        ctx.globalAlpha = 0.43;
      ctx.drawImage(this.sprite(type === Decor.Pine ? "pine" : "oak", variant), x - 32, y - 56);
      ctx.globalAlpha = 1;
    } else if (type === Decor.Rock || type === Decor.Crystal) {
      ctx.drawImage(this.sprite(type === Decor.Rock ? "rock" : "crystal"), x - 32, y - 56);
      if (type === Decor.Crystal) {
        ctx.fillStyle = `rgba(179,234,190,${0.2 + Math.sin(time * 2 + variant) * 0.15})`;
        ctx.fillRect(x - 1, y - 19, 2, 2);
      }
    } else if (type === Decor.Flower) {
      ctx.fillStyle = "#669355";
      ctx.fillRect(x, y - 4, 1, 4);
      ctx.fillRect(x + 3, y - 2, 1, 3);
      ctx.fillStyle = variant % 2 ? "#d2c286" : "#b2b7a4";
      ctx.fillRect(x - 1, y - 5, 3, 2);
      ctx.fillRect(x + 2, y - 3, 3, 2);
    } else if (type === Decor.Mushroom) {
      ctx.fillStyle = "#c2ad89";
      ctx.fillRect(x, y - 3, 1, 3);
      ctx.fillStyle = "#ce987c";
      ctx.fillRect(x - 2, y - 5, 5, 2);
      ctx.fillStyle = "#ddc4a0";
      ctx.fillRect(x - 1, y - 5, 1, 1);
    } else if (type === Decor.Reeds) {
      ctx.fillStyle = "#6e8956";
      ctx.fillRect(x, y - 9, 1, 9);
      ctx.fillRect(x - 3, y - 7, 1, 7);
      ctx.fillRect(x + 3, y - 12, 1, 12);
      ctx.fillStyle = "#a8a271";
      ctx.fillRect(x + 2, y - 13, 2, 4);
    }
  }
  private drawLandmark(item: DrawItem, sim: Simulation, time: number): void {
    const ctx = this.ctx,
      { x, y } = item;
    if (this.zoom < 0.4) {
      ctx.fillStyle = sim.beacons.has(item.id!) ? "#dcf0a1" : "#d6bd8b";
      ctx.fillRect(x - 3 / this.zoom, y - 3 / this.zoom, 6 / this.zoom, 6 / this.zoom);
      return;
    }
    const lit = !item.type || sim.beacons.has(item.id!);
    ctx.fillStyle = "#223c2d77";
    ctx.beginPath();
    ctx.ellipse(x + 3, y + 3, 33, 15, 0, 0, Math.PI * 2);
    ctx.fill();
    if (!item.type) {
      // Ruined stone circle, canvas shelter and a small fire.
      for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI) / 4,
          bx = Math.round(x + Math.cos(angle) * 36),
          by = Math.round(y + Math.sin(angle) * 27);
        ctx.fillStyle = "#475c4c";
        ctx.fillRect(bx - 5, by - 8, 11, 13);
        ctx.fillStyle = "#8d9679";
        ctx.fillRect(bx - 6, by - 10, 12, 4);
        ctx.fillStyle = "#6c7e60";
        ctx.fillRect(bx - 4, by - 5, 4, 8);
      }
      ctx.fillStyle = "#544c32";
      ctx.fillRect(x - 70, y - 5, 37, 18);
      ctx.fillStyle = "#8f8d60";
      ctx.beginPath();
      ctx.moveTo(x - 73, y - 6);
      ctx.lineTo(x - 54, y - 34);
      ctx.lineTo(x - 31, y - 5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#bcb582";
      ctx.beginPath();
      ctx.moveTo(x - 54, y - 34);
      ctx.lineTo(x - 34, y - 30);
      ctx.lineTo(x - 16, y - 2);
      ctx.lineTo(x - 31, y - 5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#354636";
      ctx.fillRect(x - 58, y - 7, 9, 19);
      ctx.fillStyle = "#c7b77a";
      ctx.fillRect(x - 55, y - 30, 2, 31);
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = "#899078";
        ctx.fillRect(
          x + Math.round(Math.cos(i * 1.25) * 10),
          y + Math.round(Math.sin(i * 1.25) * 6),
          5,
          4,
        );
      }
      ctx.fillStyle = "#b27947";
      ctx.fillRect(x - 6, y - 1, 15, 3);
      ctx.fillStyle = "#eab56f";
      ctx.fillRect(x - 4, y - 8, 9, 9);
      ctx.fillStyle = "#f8d895";
      ctx.fillRect(x - 2, y - 12 + Math.floor(Math.sin(time * 12) * 2), 5, 10);
      ctx.fillStyle = "#fff0b7";
      ctx.fillRect(x, y - 7, 2, 6);
      for (let i = 0; i < 4; i++) {
        const a = (time * 0.4 + i / 4) % 1;
        ctx.fillStyle = `rgba(207,212,177,${(1 - a) * 0.2})`;
        ctx.fillRect(x + Math.sin(time + i) * 4, y - 15 - a * 35, 3 + a * 5, 3);
      }
    } else {
      ctx.fillStyle = "#5d715d";
      ctx.fillRect(x - 18, y - 2, 36, 8);
      ctx.fillStyle = "#8e9b7e";
      ctx.fillRect(x - 14, y - 6, 28, 5);
      ctx.fillStyle = "#586952";
      ctx.fillRect(x - 8, y - 37, 16, 32);
      ctx.fillStyle = "#92a084";
      ctx.fillRect(x - 8, y - 39, 5, 32);
      ctx.fillStyle = lit ? "#dcefa8" : "#658b7a";
      ctx.fillRect(x - 2, y - 31, 5, 17);
      ctx.fillRect(x - 5, y - 28, 11, 3);
      if (lit) {
        ctx.fillStyle = "#e4f0b5";
        ctx.fillRect(x - 2, y - 50 + Math.sin(time * 2) * 2, 5, 7);
      }
    }
    if (lit) {
      const glow = ctx.createRadialGradient(x, y - 5, 0, x, y - 5, 60);
      glow.addColorStop(0, "#f7d58324");
      glow.addColorStop(1, "#f7d58300");
      ctx.fillStyle = glow;
      ctx.fillRect(x - 60, y - 65, 120, 120);
    }
  }
  private drawDebug(
    sim: Simulation,
    left: number,
    right: number,
    top: number,
    bottom: number,
  ): void {
    const ctx = this.ctx;
    ctx.strokeStyle = "#d4e99250";
    ctx.lineWidth = 1 / this.zoom;
    for (let x = Math.floor(left / CHUNK_SIZE) * CHUNK_SIZE; x < right; x += CHUNK_SIZE) {
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }
    for (let y = Math.floor(top / CHUNK_SIZE) * CHUNK_SIZE; y < bottom; y += CHUNK_SIZE) {
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }
    for (const p of sim.players.values()) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  drawMinimap(sim: Simulation, localId: string): void {
    const p = sim.players.get(localId);
    if (!p) return;
    const ctx = this.mini.getContext("2d")!,
      size = this.mini.width,
      scale = 5;
    for (let y = 0; y < size; y += 4)
      for (let x = 0; x < size; x += 4) {
        const wx = p.x + (x - size / 2) * scale,
          wy = p.y + (y - size / 2) * scale;
        ctx.fillStyle =
          this.ground[sim.world.sample(Math.floor(wx / TILE), Math.floor(wy / TILE)).terrain];
        ctx.fillRect(x, y, 4, 4);
      }
    ctx.strokeStyle = "#d5dfa154";
    ctx.strokeRect(size / 2 - 18, size / 2 - 12, 36, 24);
    for (const enemy of sim.adventure.state.enemies)
      if (enemy.hp > 0) {
        ctx.fillStyle = enemy.boss ? "#f3d292" : "#e89783";
        ctx.fillRect(
          size / 2 + (enemy.x - p.x) / scale - 1,
          size / 2 + (enemy.y - p.y) / scale - 1,
          enemy.boss ? 4 : 2,
          enemy.boss ? 4 : 2,
        );
      }
    const s = sim.adventure.state,
      gate = s.mode === "town" ? { x: 218, y: 36 } : { x: s.recipe.x + 275, y: s.recipe.y };
    ctx.fillStyle = "#d9eaa8";
    ctx.fillRect(
      size / 2 + (gate.x - p.x) / scale - 2,
      size / 2 + (gate.y - p.y) / scale - 2,
      4,
      4,
    );
    ctx.fillStyle = "#eef3cf";
    ctx.beginPath();
    ctx.moveTo(size / 2, size / 2 - 4);
    ctx.lineTo(size / 2 - 3, size / 2 + 3);
    ctx.lineTo(size / 2 + 3, size / 2 + 3);
    ctx.fill();
  }
  atlas(canvas: HTMLCanvasElement, world: World, sim: Simulation, centerX = 0, centerY = 0): void {
    const ctx = canvas.getContext("2d")!,
      width = canvas.width,
      height = canvas.height,
      scale = 6;
    for (let y = 0; y < height; y += 3)
      for (let x = 0; x < width; x += 3) {
        const t = world.sample(
          Math.floor((centerX + (x - width / 2) * scale) / TILE),
          Math.floor((centerY + (y - height / 2) * scale) / TILE),
        );
        ctx.fillStyle = this.ground[t.terrain];
        ctx.fillRect(x, y, 3, 3);
      }
    ctx.strokeStyle = "#d5dfa126";
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += 64) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    this.combat.atlas(ctx, sim, width, height, centerX, centerY);
    for (const p of sim.players.values()) {
      const x = width / 2 + (p.x - centerX) / scale,
        y = height / 2 + (p.y - centerY) / scale;
      ctx.fillStyle = "#f5f1cf";
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
