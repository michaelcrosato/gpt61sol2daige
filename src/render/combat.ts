import { clamp, hash, lerp } from "../engine/math.ts";
import type { Player, Simulation } from "../engine/simulation.ts";
import {
  areaRecipe,
  mechanicOf,
  npcPosition,
  THEMES,
  TOWN_NPCS,
  themeOf,
  townName,
} from "../game/content.ts";
import { RARITY_COLORS } from "../game/loot.ts";
import type { Drop, Enemy } from "../game/types.ts";
import { drawMaterialEvent } from "./props.ts";
import { monsterPixels, type RigPose } from "./rigs.ts";
import { spritePixels } from "./sprites.ts";

export type AdventureActor =
  | { type: "enemy"; enemy: Enemy; x: number; y: number }
  | { type: "drop"; drop: Drop; x: number; y: number }
  | { type: "npc"; index: number; x: number; y: number }
  | { type: "building"; index: number; x: number; y: number };
export class CombatRenderer {
  tick = 0;
  interpolation = 1;
  private readonly cache = new Map<string, HTMLCanvasElement>();
  light(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    color: string,
    strength = 0.28,
  ): void {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = strength;
    const glow = ctx.createRadialGradient(x, y, 1, x, y, radius);
    glow.addColorStop(0, color);
    glow.addColorStop(0.4, `${color}65`);
    glow.addColorStop(1, `${color}00`);
    ctx.fillStyle = glow;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    ctx.restore();
  }
  ground(ctx: CanvasRenderingContext2D, sim: Simulation, time: number, zoom: number): void {
    const s = sim.adventure.state;
    if (s.mode === "town") {
      ctx.strokeStyle = "#bbbd7940";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(0, 30, 79, 50, 0, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        ctx.fillStyle = "#a4b78a";
        ctx.fillRect(Math.cos(angle) * 78 - 2, 30 + Math.sin(angle) * 50 - 2, 4, 4);
      }
      this.portal(ctx, 218, 36, time, "#b5e2b1", true, zoom);
      ctx.font = "8px monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "#dce6c1";
      ctx.fillText("OUTWARD GATE", 218, -24);
      for (const [x, y] of [
        [-145, 48],
        [126, 52],
        [-44, -130],
        [54, 104],
      ]) {
        ctx.fillStyle = "#5f543b";
        ctx.fillRect(x, y - 22, 2, 25);
        ctx.fillStyle = "#f2ce8c";
        ctx.fillRect(x - 2, y - 24, 6, 6);
        this.light(ctx, x + 1, y - 20, 48, "#e9bf7e", 0.15);
      }
    } else {
      this.portal(ctx, s.recipe.x - 265, s.recipe.y + 95, time, "#9fc8c2", true, zoom);
      this.portal(
        ctx,
        s.recipe.x + 275,
        s.recipe.y,
        time,
        s.area % 4 === 0 ? "#e9cfa0" : "#bbe5a5",
        s.cleared,
        zoom,
      );
      for (const m of s.mechanics) {
        const data = mechanicOf(m.kind),
          active = m.readyAt <= this.tick;
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.globalAlpha = active ? 1 : 0.5;
        ctx.fillStyle = "#142e2670";
        ctx.beginPath();
        ctx.ellipse(0, 3, m.radius, m.radius * 0.58, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `${data.color}75`;
        ctx.lineWidth = 1;
        ctx.setLineDash(m.kind === "wind" ? [8, 9] : [2, 4]);
        ctx.beginPath();
        ctx.ellipse(0, 0, m.radius, m.radius * 0.68, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        if (m.kind === "bramble" || m.kind === "blood") {
          for (let i = 0; i < 7; i++) {
            const a = i * 0.9;
            ctx.fillStyle = i % 2 ? "#607644" : "#49673a";
            ctx.fillRect(Math.cos(a) * 10 - 3, Math.sin(a) * 5 - 5, 6, 5);
          }
          ctx.fillStyle = data.color;
          ctx.fillRect(-5, -15 + Math.sin(time * 2) * 1.2, 11, 10);
          ctx.fillStyle = "#eef4c5";
          ctx.fillRect(-2, -14, 3, 5);
          if (m.kind === "bramble")
            for (let i = 0; i < 4; i++) {
              ctx.fillStyle = "#98b66c";
              ctx.fillRect(-11 + i * 7, -18 - (i % 2) * 3, 2, 7);
            }
        } else if (m.kind === "glass") {
          ctx.fillStyle = "#41656b";
          ctx.fillRect(-8, -22, 16, 26);
          ctx.fillStyle = data.color;
          ctx.beginPath();
          ctx.moveTo(0, -37);
          ctx.lineTo(8, -19);
          ctx.lineTo(0, -4);
          ctx.lineTo(-7, -20);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = "#e7fbeb";
          ctx.fillRect(-2, -26, 3, 18);
        } else if (m.kind === "wind") {
          ctx.strokeStyle = data.color;
          for (let i = 0; i < 3; i++) {
            const x = ((time * 22 + i * 21) % 60) - 30;
            ctx.beginPath();
            ctx.moveTo(x - 9, -8 + i * 7);
            ctx.lineTo(x, -11 + i * 7);
            ctx.lineTo(x + 8, -8 + i * 7);
            ctx.stroke();
          }
        } else if (m.kind === "rift") {
          ctx.fillStyle = "#73887d";
          ctx.fillRect(-18, -28, 6, 31);
          ctx.fillRect(12, -28, 6, 31);
          ctx.fillRect(-18, -33, 36, 7);
          ctx.strokeStyle = data.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.ellipse(0, -13, 9, 18, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.fillStyle = "#6d7d69";
          ctx.fillRect(-15, -2, 30, 5);
          ctx.fillStyle = "#365246";
          ctx.fillRect(-10, -5, 20, 6);
          ctx.strokeStyle = data.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.ellipse(0, -3, 11 + Math.sin(time * 2) * 2, 5, 0, 0, Math.PI * 2);
          ctx.stroke();
          for (let i = 0; i < 5; i++) {
            const a = time * 1.5 + i * 1.256;
            ctx.fillStyle = data.color;
            ctx.fillRect(Math.cos(a) * 12, -10 + Math.sin(a) * 6, 2, 2);
          }
        }
        ctx.font = "8px monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = data.color;
        ctx.fillText(data.icon, 0, 17);
        ctx.restore();
        if (active || m.activeUntil > this.tick)
          this.light(
            ctx,
            m.x,
            m.y - 7,
            m.activeUntil > this.tick ? 78 : 40,
            data.color,
            m.activeUntil > this.tick ? 0.24 : 0.1,
          );
      }
      for (const e of s.enemies)
        if (e.hp > 0 && e.phase === "windup") {
          const progress = clamp(1 - e.timer / (e.boss ? 46 : 70), 0, 1);
          const charge =
            (!e.boss && e.behavior === "charger") || (e.boss && (e.attacks + 1) % 3 === 0);
          ctx.save();
          ctx.translate(e.x, e.y);
          ctx.rotate(charge ? e.facing : 0);
          ctx.strokeStyle = "#f3a17f";
          ctx.fillStyle = `rgba(195,76,59,${0.12 + progress * 0.16})`;
          ctx.lineWidth = 1.5;
          if (charge) {
            ctx.fillRect(0, -15, 155, 30);
            ctx.strokeRect(0, -15, 155 * progress, 30);
          } else {
            const radius = e.boss
              ? 125
              : e.behavior === "sentinel"
                ? 66
                : e.behavior === "hunter"
                  ? 30
                  : 42;
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(0, 0, radius * progress, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.restore();
        }
    }
  }
  private portal(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    time: number,
    color: string,
    active: boolean,
    zoom: number,
  ): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "#253d3477";
    ctx.beginPath();
    ctx.ellipse(0, 3, 29, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#556957";
    ctx.fillRect(-23, -40, 7, 45);
    ctx.fillRect(16, -40, 7, 45);
    ctx.fillStyle = "#8b9c7d";
    ctx.fillRect(-26, -42, 13, 5);
    ctx.fillRect(13, -42, 13, 5);
    ctx.fillRect(-22, -45, 44, 5);
    if (active) {
      ctx.fillStyle = "#123d39";
      ctx.beginPath();
      ctx.ellipse(0, -19, 16, 26, 0, 0, Math.PI * 2);
      ctx.fill();
      for (let row = 0; row < 21; row++) {
        ctx.fillStyle = row % 3 ? `${color}40` : `${color}88`;
        const width = Math.sqrt(Math.max(0, 1 - ((row - 10) / 11) ** 2)) * 14;
        ctx.fillRect(-width + Math.sin(time * 2 + row) * 2, -42 + row * 2, width * 2, 1);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, -19, 17, 26, 0, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = time * 0.7 + (i * Math.PI) / 4;
        ctx.fillStyle = color;
        ctx.fillRect(Math.cos(a) * 23, -19 + Math.sin(a) * 31, 2, 2);
      }
    } else {
      ctx.strokeStyle = "#81917455";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, -19, 16, 26, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (zoom > 0.65) {
      ctx.font = "8px monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = active ? color : "#8b9c7d";
      ctx.fillText(active ? "[E]" : "SEALED", 0, 19);
    }
    ctx.restore();
    if (active) this.light(ctx, x, y - 15, 90, color, 0.15);
  }
  actors(sim: Simulation, alpha: number): AdventureActor[] {
    const s = sim.adventure.state,
      actors: AdventureActor[] = s.enemies.map((enemy) => ({
        type: "enemy",
        enemy,
        x: lerp(enemy.px, enemy.x, alpha),
        y: lerp(enemy.py, enemy.y, alpha),
      }));
    for (const drop of s.drops) actors.push({ type: "drop", drop, x: drop.x, y: drop.y });
    if (s.mode === "town")
      TOWN_NPCS.forEach((npc, index) => {
        const point = npcPosition(npc, this.tick);
        actors.push(
          { type: "building", index, x: npc.x, y: npc.y - 9 },
          { type: "npc", index, ...point },
        );
      });
    return actors;
  }
  actor(
    ctx: CanvasRenderingContext2D,
    actor: AdventureActor,
    _sim: Simulation,
    _alpha: number,
    time: number,
    zoom: number,
  ): void {
    const { x, y } = actor;
    if (actor.type === "enemy") {
      const e = actor.enemy,
        age = clamp((this.tick - e.deadAt) / 40, 0, 1),
        scale = e.boss
          ? 1.65
          : e.elite
            ? 0.9
            : e.rig === "brute" || e.rig === "warden"
              ? 0.6
              : 0.74;
      if (zoom < 0.55) {
        ctx.fillStyle = e.boss ? "#f4c188" : "#ec9b8b";
        ctx.fillRect(x - 2 / zoom, y - 2 / zoom, 4 / zoom, 4 / zoom);
        return;
      }
      ctx.save();
      ctx.translate(x, y);
      if (e.phase === "dead") {
        ctx.globalAlpha = Math.max(0, 1 - age);
        ctx.translate(0, age * 5);
        ctx.scale(1, 1 - age * 0.4);
      }
      ctx.fillStyle = "#11251c88";
      ctx.beginPath();
      ctx.ellipse(2, 2, e.radius * 1.4, e.radius * 0.55, -0.2, 0, Math.PI * 2);
      ctx.fill();
      let pose: RigPose =
        e.hurtUntil > this.tick
          ? "hurt"
          : e.phase === "windup"
            ? "windup"
            : e.phase === "charge"
              ? "attack"
              : Math.hypot(e.vx, e.vy) > 3
                ? "walk"
                : "idle";
      if (e.phase === "dead") pose = "hurt";
      const frame =
        pose === "windup"
          ? Math.max(0, Math.min(15, Math.floor((1 - e.timer / 70) * 16)))
          : Math.floor(time * 16 + (e.id % 16)) % 16;
      const key = `${e.rig}:${e.theme}:${e.id % 4}:${pose}:${frame}`;
      let canvas = this.cache.get(key);
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.width = canvas.height = 88;
        const sprite = canvas.getContext("2d")!;
        for (const pixel of monsterPixels(
          { version: 1, rig: e.rig, theme: e.theme, seed: e.id % 4 },
          pose,
          frame,
        )) {
          sprite.fillStyle = pixel.color;
          sprite.fillRect(pixel.x + 44, pixel.y + 76, pixel.w, pixel.h);
        }
        this.cache.set(key, canvas);
        if (this.cache.size > 512) this.cache.delete(this.cache.keys().next().value!);
      }
      ctx.scale(Math.cos(e.facing) < 0 ? -scale : scale, scale);
      ctx.drawImage(canvas, -44, -76);
      ctx.restore();
      if (e.hp > 0) {
        const width = e.boss ? 48 : e.elite ? 27 : 20;
        ctx.fillStyle = "#16241d";
        ctx.fillRect(x - width / 2 - 1, y - (e.boss ? 120 : 44), width + 2, 4);
        ctx.fillStyle = e.boss ? "#dba378" : e.elite ? "#d7bc86" : "#c6816e";
        ctx.fillRect(
          x - width / 2,
          y - (e.boss ? 119 : 43),
          width * Math.max(0, e.hp / e.maxHp),
          2,
        );
        if (e.elite) {
          ctx.fillStyle = "#f0d69b";
          ctx.fillRect(x - 1, y - 49, 3, 3);
        }
        if (e.boss || e.phase === "windup")
          this.light(
            ctx,
            x,
            y - e.radius * 2,
            e.boss ? 85 : 30,
            themeOf(e.theme).colors[3],
            e.boss ? 0.12 : 0.07,
          );
      }
    } else if (actor.type === "drop") {
      const d = actor.drop,
        bob = Math.sin(time * 3 + d.id) * 1.5;
      const color =
        d.kind === "gold" ? "#e9c87d" : d.kind === "xp" ? "#a8dbe5" : RARITY_COLORS[d.item!.rarity];
      if (d.kind === "item") {
        const gradient = ctx.createLinearGradient(x, y, x, y - 55);
        gradient.addColorStop(0, `${color}90`);
        gradient.addColorStop(1, `${color}00`);
        ctx.fillStyle = gradient;
        ctx.fillRect(x - 3, y - 55, 6, 55);
        this.light(ctx, x, y - 2, 24, color, 0.14);
        ctx.save();
        ctx.translate(x, y - 5 + bob);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = color;
        ctx.fillRect(-3, -3, 6, 6);
        ctx.restore();
      } else {
        ctx.fillStyle = color;
        ctx.fillRect(x - 2, y - 4 + bob, d.kind === "gold" ? 4 : 3, 3);
        ctx.fillStyle = "#f0edc2";
        ctx.fillRect(x - 1, y - 4 + bob, 1, 2);
      }
    } else if (actor.type === "npc") {
      const npc = TOWN_NPCS[actor.index];
      ctx.fillStyle = "#192f246f";
      ctx.beginPath();
      ctx.ellipse(x, y + 1, 9, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      const palette = ["#273e35", npc.color, npc.color, "#ddbd8d", "#f1e8b0"];
      for (const p of spritePixels(
        { version: 1, kind: "player", seed: actor.index, palette },
        Math.floor(time * 7 + actor.index),
      )) {
        ctx.fillStyle = p.color;
        ctx.fillRect(x + p.x, y + p.y + Math.sin(time * 1.5 + actor.index) * 0.5, p.w, p.h);
      }
      if (actor.index === 0) {
        ctx.strokeStyle = "#a1aa83";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + 9, y - 10);
        ctx.lineTo(x + 15, y - 13 - Math.sin(time * 2) * 5);
        ctx.stroke();
        ctx.fillStyle = "#adbc9b";
        ctx.fillRect(x + 12, y - 16 - Math.sin(time * 2) * 5, 7, 4);
      }
      if (actor.index === 1) {
        this.light(ctx, x + 9, y - 10, 23, "#aadfcc", 0.12);
        ctx.fillStyle = "#b0d9c7";
        ctx.fillRect(x + 8, y - 14, 4, 6);
      }
      if (actor.index === 2) {
        ctx.fillStyle = "#6f6746";
        ctx.fillRect(x + 13, y - 30, 2, 34);
        ctx.fillStyle = "#e1e6b0";
        ctx.fillRect(x + 10, y - 32 + Math.sin(time) * 1.5, 7, 5);
        this.light(ctx, x + 13, y - 28, 35, "#d5e4a3", 0.1);
      }
      if (zoom > 1) {
        ctx.font = "7px monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = "#e1e3c3";
        ctx.fillText(npc.name, x, y - 31);
        ctx.font = "5px monospace";
        ctx.fillStyle = "#b1bd91";
        ctx.fillText(npc.role, x, y + 13);
      }
    } else this.building(ctx, actor.index, x, y, time);
  }
  private building(
    ctx: CanvasRenderingContext2D,
    index: number,
    x: number,
    y: number,
    time: number,
  ): void {
    ctx.save();
    ctx.translate(x, y);
    if (index === 0) {
      ctx.fillStyle = "#2c372b55";
      ctx.fillRect(-41, -16, 90, 29);
      ctx.fillStyle = "#66543d";
      ctx.fillRect(-30, -29, 3, 33);
      ctx.fillRect(29, -29, 3, 33);
      ctx.fillRect(-33, -7, 67, 8);
      for (let i = 0; i < 7; i++) {
        ctx.fillStyle = i % 2 ? "#989264" : "#c4b682";
        ctx.beginPath();
        ctx.moveTo(-37 + i * 11, -34);
        ctx.lineTo(-28 + i * 11, -47);
        ctx.lineTo(-17 + i * 11, -47);
        ctx.lineTo(-26 + i * 11, -34);
        ctx.fill();
        ctx.fillRect(-37 + i * 11, -34, 11, 6);
      }
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = ["#ad9b6a", "#78957b", "#879faf"][i % 3];
        ctx.fillRect(-24 + i * 9, -13, 6, 5 + (i % 3));
      }
      ctx.fillStyle = "#816842";
      ctx.fillRect(-44, -9, 13, 12);
      ctx.strokeStyle = "#b19562";
      ctx.strokeRect(-43, -8, 11, 10);
      ctx.fillRect(34, -4, 12, 10);
    } else if (index === 1) {
      ctx.fillStyle = "#35463877";
      ctx.fillRect(-36, -10, 80, 20);
      ctx.fillStyle = "#78806a";
      ctx.fillRect(-29, -37, 60, 37);
      ctx.fillStyle = "#596c54";
      ctx.fillRect(-25, -32, 52, 30);
      for (let row = 0; row < 6; row++) {
        const width = 76 - row * 8;
        ctx.fillStyle = row % 2 ? "#556d57" : "#728365";
        ctx.fillRect(-width / 2, -41 - row * 4, width, 5);
        ctx.fillStyle = "#8e9b73";
        ctx.fillRect(-width / 2, -41 - row * 4, width, 1);
      }
      ctx.fillStyle = "#253c34";
      ctx.fillRect(-7, -23, 15, 25);
      ctx.fillStyle = "#d4d59b";
      ctx.fillRect(-21, -28, 8, 9);
      ctx.fillRect(15, -28, 8, 9);
      ctx.fillStyle = "#78866b";
      ctx.fillRect(-18, -28, 2, 9);
      ctx.fillRect(18, -28, 2, 9);
      ctx.fillStyle = "#8c8c76";
      ctx.fillRect(17, -65, 10, 15);
      ctx.fillStyle = "#b8b59a";
      ctx.fillRect(16, -66, 12, 3);
      for (let i = 0; i < 4; i++) {
        const f = (time * 0.2 + i / 4) % 1;
        ctx.fillStyle = `rgba(187,205,174,${(1 - f) * 0.24})`;
        ctx.fillRect(20 + Math.sin(time + i) * 4, -71 - f * 25, 4 + f * 5, 4);
      }
      this.light(ctx, 0, -20, 55, "#ddd7a1", 0.1);
    } else {
      ctx.fillStyle = "#536953";
      ctx.fillRect(-17, -9, 36, 10);
      ctx.fillStyle = "#8c9d7b";
      ctx.fillRect(-19, -12, 40, 5);
      ctx.fillStyle = "#655f43";
      ctx.fillRect(-21, -58, 3, 57);
      ctx.fillRect(24, -56, 3, 57);
      ctx.fillStyle = "#677f55";
      ctx.beginPath();
      ctx.moveTo(-18, -55);
      ctx.lineTo(21, -52);
      ctx.lineTo(17 + Math.sin(time * 1.5) * 2, -26);
      ctx.lineTo(1, -33);
      ctx.lineTo(-18, -28);
      ctx.fill();
      ctx.strokeStyle = "#d5d99d";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-4, -34);
      ctx.lineTo(8, -46);
      ctx.moveTo(1, -42);
      ctx.lineTo(6, -42);
      ctx.stroke();
    }
    ctx.restore();
  }
  player(
    ctx: CanvasRenderingContext2D,
    sim: Simulation,
    player: Player,
    x: number,
    y: number,
  ): void {
    const h = sim.adventure.hero(player.id),
      stats = sim.adventure.stats(player.id, this.tick);
    if (h.dead) {
      ctx.fillStyle = "#efc59b";
      ctx.font = "8px monospace";
      ctx.textAlign = "center";
      ctx.fillText("LANTERN FALLEN", x, y - 38);
      return;
    }
    const attacking = h.attackUntil > this.tick,
      progress = clamp((this.tick - h.attackAt) / 16, 0, 1);
    const angle = attacking
      ? h.attackAngle + (h.combo % 2 ? 1 : -1) * (progress - 0.5) * 2.7
      : player.facing + 0.65;
    ctx.save();
    ctx.translate(x, y - 9);
    ctx.rotate(angle);
    ctx.fillStyle = "#514b35";
    ctx.fillRect(4, -2, 8, 4);
    ctx.fillStyle = "#d8c38a";
    ctx.fillRect(10, -5, 3, 10);
    ctx.fillStyle = "#9bac9c";
    ctx.fillRect(13, -2, attacking ? 25 : 19, 4);
    ctx.fillStyle = "#eff0c9";
    ctx.fillRect(13, -2, attacking ? 23 : 18, 1);
    ctx.fillStyle = "#d9e1bd";
    ctx.fillRect(attacking ? 36 : 30, -1, 3, 2);
    ctx.restore();
    if (h.hurtUntil > this.tick) this.light(ctx, x, y - 11, 30, "#ed9586", 0.24);
    if (h.dashUntil > this.tick)
      for (let i = 1; i <= 3; i++) {
        ctx.fillStyle = `rgba(183,222,178,${0.14 - i * 0.025})`;
        ctx.fillRect(
          x - Math.cos(h.dashAngle) * i * 13 - 5,
          y - Math.sin(h.dashAngle) * i * 13 - 15,
          10,
          15,
        );
      }
    if (h.hp < stats.health && !h.dead) {
      ctx.fillStyle = "#192c23";
      ctx.fillRect(x - 12, y + 6, 24, 3);
      ctx.fillStyle = "#ceab7c";
      ctx.fillRect(x - 12, y + 6, (24 * h.hp) / stats.health, 2);
    }
    if (h.recallUntil > this.tick) {
      ctx.strokeStyle = "#b7d5c5";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(
        x,
        y,
        22,
        -Math.PI / 2,
        -Math.PI / 2 + (1 - (h.recallUntil - this.tick) / 150) * Math.PI * 2,
      );
      ctx.stroke();
    }
  }
  effects(ctx: CanvasRenderingContext2D, sim: Simulation, localId: string, zoom: number): void {
    for (const p of sim.adventure.state.projectiles) {
      const x = lerp(p.px, p.x, this.interpolation),
        y = lerp(p.py, p.y, this.interpolation);
      const color = p.enemy ? "#efa189" : "#b8eee1";
      ctx.strokeStyle = color;
      ctx.lineWidth = p.enemy ? 2 : 3;
      ctx.beginPath();
      ctx.moveTo(x - p.vx / 22, y - p.vy / 22);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.fillStyle = "#fff1c7";
      ctx.fillRect(x - 2, y - 2, 4, 4);
      this.light(ctx, x, y, p.enemy ? 17 : 29, color, 0.2);
    }
    for (const e of sim.adventure.state.events) {
      const age = (this.tick - e.tick) / 60;
      if (age > 1.25 || age < 0) continue;
      if (e.type === "slash" && age < 0.28) {
        const radius = 34 + age * 80,
          start = e.angle - 1.2 + age * 4;
        ctx.save();
        ctx.strokeStyle = e.color;
        ctx.globalAlpha = 1 - age / 0.28;
        ctx.lineWidth = 5 * (1 - age / 0.28) + 1;
        ctx.beginPath();
        ctx.arc(e.x, e.y - 7, radius, start, start + 1.75);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.strokeStyle = "#fff5d1";
        ctx.beginPath();
        ctx.arc(e.x, e.y - 7, radius + 3, start + 0.1, start + 1.45);
        ctx.stroke();
        ctx.restore();
        this.light(ctx, e.x, e.y, 58, e.color, (1 - age / 0.28) * 0.15);
      } else if (e.type === "lance" && e.text === "chain" && age < 0.24) {
        ctx.save();
        ctx.globalAlpha = 1 - age / 0.24;
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(e.x, e.y - 8);
        for (let i = 1; i <= 7; i++) {
          const d = (e.amount * i) / 7,
            shake = i === 7 ? 0 : (hash(i, e.id) % 13) - 6;
          ctx.lineTo(
            e.x + Math.cos(e.angle) * d + Math.sin(e.angle) * shake,
            e.y - 8 + Math.sin(e.angle) * d - Math.cos(e.angle) * shake,
          );
        }
        ctx.stroke();
        ctx.restore();
      } else if (["whorl", "nova", "mechanic", "level", "potion", "kill"].includes(e.type)) {
        const duration = e.type === "kill" ? 0.5 : 0.75;
        if (age > duration) continue;
        const radius =
          e.type === "mechanic"
            ? Math.max(30, e.amount)
            : e.type === "nova"
              ? 155
              : e.type === "whorl"
                ? 102
                : e.type === "kill"
                  ? 28
                  : 55;
        ctx.save();
        ctx.globalAlpha = 1 - age / duration;
        ctx.strokeStyle = e.color;
        ctx.lineWidth = e.type === "whorl" ? 3 : 1.5;
        ctx.beginPath();
        ctx.ellipse(
          e.x,
          e.y,
          radius * Math.min(1, age * 3),
          radius * Math.min(1, age * 3) * 0.8,
          0,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
        for (let i = 0; i < 12; i++) {
          const angle = (hash(i, e.id) / 0xffffffff) * Math.PI * 2;
          ctx.fillStyle = i % 3 ? e.color : "#f9edc6";
          ctx.fillRect(
            e.x + Math.cos(angle) * radius * age * 1.2,
            e.y + Math.sin(angle) * radius * age - age * 14,
            2,
            2,
          );
        }
        ctx.restore();
        this.light(ctx, e.x, e.y, radius * 0.9, e.color, (1 - age / duration) * 0.16);
      }
      if (e.type === "impact" || e.type === "break") drawMaterialEvent(ctx, e, age, zoom);
      if (e.type === "assembly" && zoom > 0.6 && age < 1.1) {
        // Mechanism feedback: a short floating label where the change happened.
        const label =
          {
            "gate:latched": "Latched",
            "gate:closed": "Shut",
            "launcher:cocked": "Cocked",
            "launcher:fired": "Launch!",
            "bridge:span-lost": "Causeway adrift",
          }[e.text] ??
          (e.text.endsWith(":cut") ? "Cut" : e.text.endsWith(":snapped") ? "Snap!" : "");
        if (label) {
          ctx.save();
          ctx.globalAlpha = 1 - age / 1.1;
          ctx.font = "bold 7px monospace";
          ctx.textAlign = "center";
          ctx.fillStyle = "#1b3028";
          ctx.fillText(label, e.x + 0.6, e.y - 14 - age * 18 + 0.6);
          ctx.fillStyle = e.color;
          ctx.fillText(label, e.x, e.y - 14 - age * 18);
          ctx.restore();
        }
      }
      if ((e.type === "hit" || e.type === "hurt") && zoom > 0.65 && age < 0.8) {
        ctx.save();
        ctx.globalAlpha = 1 - age / 0.8;
        ctx.font = `${e.text === "crit" ? "bold 11" : "8"}px monospace`;
        ctx.textAlign = "center";
        ctx.fillStyle = "#1b3028";
        ctx.fillText(String(Math.round(e.amount)), e.x + 1, e.y - 18 - age * 30 + 1);
        ctx.fillStyle = e.color;
        ctx.fillText(String(Math.round(e.amount)), e.x, e.y - 18 - age * 30);
        ctx.restore();
      }
    }
    const p = sim.players.get(localId);
    if (!p) return;
    const drop = sim.adventure.state.drops.find(
      (d) => d.kind === "item" && Math.hypot(d.x - p.x, d.y - p.y) < 52,
    );
    if (drop?.item && zoom > 0.8) {
      ctx.font = "7px monospace";
      ctx.textAlign = "center";
      const text = `[E] ${drop.item.name}`;
      const width = ctx.measureText(text).width + 12;
      ctx.fillStyle = "#182a21e8";
      ctx.fillRect(drop.x - width / 2, drop.y - 38, width, 14);
      ctx.fillStyle = RARITY_COLORS[drop.item.rarity];
      ctx.fillText(text, drop.x, drop.y - 28);
    }
  }
  atlas(
    ctx: CanvasRenderingContext2D,
    sim: Simulation,
    width: number,
    height: number,
    centerX: number,
    centerY: number,
  ): void {
    const land = sim.adventure.state.townLand,
      scale = 6;
    const points = [
      { x: 0, y: 0, name: townName(land), ready: true },
      ...Array.from({ length: 4 }, (_, i) => {
        const r = areaRecipe(sim.adventure.state.seed, land * 4 + i + 1);
        return { x: r.x, y: r.y, name: r.name, ready: r.index <= sim.adventure.state.highest + 1 };
      }),
    ];
    ctx.strokeStyle = "#d4d89988";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = width / 2 + (p.x - centerX) / scale,
        y = height / 2 + (p.y - centerY) / scale;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    for (const p of points) {
      const x = width / 2 + (p.x - centerX) / scale,
        y = height / 2 + (p.y - centerY) / scale;
      ctx.fillStyle = p.ready ? "#dce5a6" : "#88937b";
      ctx.fillRect(x - 4, y - 4, 8, 8);
      ctx.font = "11px monospace";
      ctx.textAlign = "center";
      ctx.fillText(p.name, x, y - 14);
    }
    ctx.fillStyle = "#d8c793";
    ctx.font = "11px monospace";
    ctx.textAlign = "right";
    ctx.fillText(
      `LAND ${land + 1} · ${THEMES[land % THEMES.length].name}`,
      width - 18,
      height - 18,
    );
  }
}
