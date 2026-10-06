import { clamp, hash, lerp } from "../engine/math.ts";
import type { Simulation } from "../engine/simulation.ts";
import type { Enemy } from "../game/types.ts";
import { ECHO_DELAY, WARDEN_WINDUP } from "../game/wardens.ts";

/**
 * M10 presentation: living vines, the calm and wild regions of an area, and the wardens'
 * signature telegraphs and exposure. Read-only views of simulation state; nothing here feeds
 * saves or replay hashes.
 */
type Ctx = CanvasRenderingContext2D;

/** Where a restrained body is drawn this frame (interpolated like its actor). */
function bodyAt(sim: Simulation, id: string, alpha: number): { x: number; y: number } | null {
  if (id.startsWith("enemy-")) {
    const e = sim.adventure.state.enemies.find((en) => `enemy-${en.id}` === id);
    return e ? { x: lerp(e.px, e.x, alpha), y: lerp(e.py, e.y, alpha) } : null;
  }
  const p = sim.players.get(id.slice(7));
  return p ? { x: lerp(p.px, p.x, alpha), y: lerp(p.py, p.y, alpha) } : null;
}

/** Living vines: a curving, leafy stem from the bloom (or the Bloom Tyrant) to what it holds. */
export function drawRestraints(ctx: Ctx, sim: Simulation, alpha: number, time: number): void {
  for (const r of sim.physicalRestraints()) {
    const to = bodyAt(sim, r.body, alpha),
      from = r.anchor ? bodyAt(sim, r.anchor, alpha) : { x: r.x, y: r.y };
    if (!to || !from) continue;
    const dx = to.x - from.x,
      dy = to.y - from.y,
      length = Math.hypot(dx, dy) || 1,
      nx = -dy / length,
      ny = dx / length,
      slack = Math.max(0, r.rest - length),
      taut = clamp((length - r.rest) / 30, 0, 1),
      bow = (6 + slack * 0.4) * (1 - taut * 0.8),
      seed = [...r.id].reduce((h, c) => hash(h, c.charCodeAt(0)), 0x3b1),
      lash = r.kind === "lash";
    const point = (t: number) => {
      const wave = Math.sin(t * Math.PI) * bow + Math.sin(t * 9 + time * 4 + seed) * (1 - taut);
      return { x: from.x + dx * t + nx * wave, y: from.y + dy * t + ny * wave - 4 };
    };
    ctx.save();
    ctx.strokeStyle = lash ? "#5b2a33" : "#2f4a26";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let k = 0; k <= 16; k++) {
      const p = point(k / 16);
      if (k === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.strokeStyle = lash ? `rgb(${200 + taut * 55},96,112)` : taut > 0.6 ? "#c9e07a" : "#6f9f4a";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = lash ? "#d97b93" : "#9fd06a";
    for (let k = 1; k < 6; k++) {
      const p = point(k / 6),
        side = k % 2 ? 1 : -1;
      ctx.beginPath();
      ctx.ellipse(
        p.x + nx * side * 2.5,
        p.y + ny * side * 2.5,
        2.2,
        1.1,
        Math.atan2(dy, dx) + side,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.restore();
  }
}

/** The current area's calm and wild regions: faint rings so local control reads on the ground. */
export function drawRegionRings(ctx: Ctx, sim: Simulation, time: number, zoom: number): void {
  const s = sim.adventure.state;
  if (s.mode !== "area") return;
  const area = `area-${s.recipe.index}`;
  for (const region of sim.physicalRegions()) {
    if (region.areaId !== area || region.shape.kind !== "circle") continue;
    const calm = region.id.startsWith("calm-"),
      wild = region.id.startsWith("wild-");
    if (!calm && !wild) continue;
    const { x, y, radius } = region.shape;
    ctx.save();
    ctx.strokeStyle = calm ? "#a9cfe066" : "#f0a25e77";
    ctx.lineWidth = 1;
    ctx.setLineDash(calm ? [3, 6] : [8, 4]);
    ctx.lineDashOffset = calm ? 0 : -time * 12;
    ctx.beginPath();
    ctx.ellipse(x, y, radius, radius * 0.72, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    if (zoom > 0.75) {
      ctx.font = "7px monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = calm ? "#cfe6f0aa" : "#f6c08aaa";
      ctx.fillText(calm ? "CALM" : "WILD", x, y + radius * 0.72 + 9);
    }
    ctx.restore();
  }
}

/**
 * A warden's signature telegraph (M10): a filling ring, a locked lane or line, or a marker at
 * the arch it will arrive at. Its length is the dodge window.
 */
export function drawWardenTelegraph(ctx: Ctx, e: Enemy, time: number): void {
  const w = e.warden;
  if (!w?.move || e.phase !== "windup") return;
  const progress = clamp(1 - e.timer / WARDEN_WINDUP, 0, 1),
    pulse = 0.5 + Math.sin(time * 10) * 0.5;
  ctx.save();
  ctx.lineWidth = 1.6;
  if (w.move === "gale" || w.move === "lash" || w.move === "breath") {
    const dx = w.tx - e.x,
      dy = w.ty - e.y,
      length = Math.hypot(dx, dy) || 1,
      half = w.move === "gale" ? 18 : w.move === "lash" ? 12 : 26;
    ctx.translate(e.x, e.y);
    ctx.rotate(Math.atan2(dy, dx));
    const color =
      w.move === "gale" ? "160,214,190" : w.move === "lash" ? "217,123,147" : "243,154,98";
    ctx.fillStyle = `rgba(${color},${0.12 + progress * 0.2})`;
    if (w.move === "breath") {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(length, -half * 2);
      ctx.lineTo(length, half * 2);
      ctx.closePath();
      ctx.fill();
    } else ctx.fillRect(0, -half, length, half * 2);
    ctx.strokeStyle = `rgba(${color},0.9)`;
    ctx.strokeRect(0, -half, length * progress, half * 2);
  } else if (w.move === "blink") {
    for (const [x, y, r] of [
      [e.x, e.y, 40],
      [w.tx, w.ty, 115],
    ] as const) {
      ctx.strokeStyle = `rgba(143,230,199,${0.4 + pulse * 0.4})`;
      ctx.fillStyle = `rgba(143,230,199,${0.06 + progress * 0.12})`;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.72, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x, y, r * progress, r * progress * 0.72, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else {
    const radius = w.move === "collapse" ? 210 : 125,
      color =
        w.move === "thornburst"
          ? "193,223,131"
          : w.move === "discharge"
            ? "156,217,233"
            : w.move === "echo"
              ? "178,182,235"
              : "186,159,227";
    ctx.fillStyle = `rgba(${color},${0.1 + progress * 0.16})`;
    ctx.strokeStyle = `rgba(${color},0.95)`;
    ctx.beginPath();
    ctx.ellipse(e.x, e.y, radius, radius * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    // The collapse closes in; every other ring grows to the strike.
    const r = w.move === "collapse" ? radius * (1 - progress) + 30 : radius * progress;
    ctx.ellipse(e.x, e.y, r, r * 0.8, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** The Echo Matron's pending echo and an exposed warden's cracked glow. */
export function drawWardenState(ctx: Ctx, e: Enemy, tick: number, time: number): void {
  const w = e.warden;
  if (!w || e.hp <= 0) return;
  ctx.save();
  if (w.echoAt > tick) {
    const progress = clamp(1 - (w.echoAt - tick) / ECHO_DELAY, 0, 1);
    ctx.strokeStyle = "rgba(178,182,235,0.9)";
    ctx.fillStyle = `rgba(178,182,235,${0.08 + progress * 0.18})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(w.tx, w.ty, 110, 88, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(w.tx, w.ty, 110 * progress, 88 * progress, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (w.exposedUntil > tick) {
    const left = (w.exposedUntil - tick) / 180;
    ctx.globalAlpha = 0.45 + Math.sin(time * 14) * 0.25;
    ctx.strokeStyle = "#f6e39a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(e.x, e.y + 2, e.radius + 10, (e.radius + 10) * 0.45, 0, 0, Math.PI * 2 * left);
    ctx.stroke();
    ctx.strokeStyle = "#fff4c8";
    ctx.lineWidth = 1;
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + time * 0.5,
        r = e.radius * 0.6;
      ctx.beginPath();
      ctx.moveTo(e.x + Math.cos(a) * r * 0.3, e.y - e.radius + Math.sin(a) * r * 0.3);
      ctx.lineTo(e.x + Math.cos(a) * r, e.y - e.radius + Math.sin(a) * r);
      ctx.stroke();
    }
  }
  ctx.restore();
}
