import { hash } from "../engine/math.ts";
import type { CombatEvent } from "../game/types.ts";
import type { FieldRecipe, ReactionStatus, ReactionSurface } from "../physics/reactions.ts";

/**
 * M08 reaction presentation: status overlays on props and monsters, puddles and slicks on the
 * ground, field streaks, and the short effects and labels of reaction events. Everything here
 * reads saved or received state and never feeds the simulation, saves or replay hashes.
 */
type Ctx = CanvasRenderingContext2D;
const flick = (seed: number, time: number, k: number) =>
  Math.sin(time * (9 + (seed % 5)) + k * 2.1 + (seed % 97)) * 0.5 + 0.5;

/** Burning, wet, oiled, charged, lit-fuse and charred looks around a body of reach `r`. */
export function drawStatus(
  ctx: Ctx,
  x: number,
  y: number,
  r: number,
  status: ReactionStatus,
  time: number,
): void {
  const seed = [...status.id].reduce((h, c) => hash(h, c.charCodeAt(0)), 0x51a7);
  ctx.save();
  if (status.charred && !status.burning) {
    ctx.fillStyle = "#1c15104d";
    ctx.beginPath();
    ctx.ellipse(x, y, r + 1, (r + 1) * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (status.wet) {
    ctx.fillStyle = "#4f9fd633";
    ctx.beginPath();
    ctx.ellipse(x, y, r + 1.5, (r + 1.5) * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#cdeefc";
    for (let k = 0; k < 3; k++) {
      const phase = (time * 0.9 + k / 3 + (seed % 7) / 7) % 1;
      ctx.globalAlpha = 1 - phase;
      ctx.fillRect(x - r * 0.6 + k * r * 0.6, y + r * 0.2 + phase * 6, 1, 1.6);
    }
    ctx.globalAlpha = 1;
  }
  if (status.oiled) {
    ctx.strokeStyle = `hsla(${(time * 60 + (seed % 360)) % 360}, 45%, 55%, 0.45)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.75, 0.4, 2.4);
    ctx.stroke();
  }
  if (status.charged) {
    ctx.strokeStyle = "#c9f4ff";
    ctx.lineWidth = 1;
    for (let k = 0; k < 3; k++) {
      if (flick(seed, time * 3, k) < 0.4) continue;
      const a = (hash(seed, k, Math.floor(time * 20)) % 628) / 100;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r * 0.4, y + Math.sin(a) * r * 0.4);
      ctx.lineTo(x + Math.cos(a + 0.4) * (r + 4), y + Math.sin(a + 0.4) * (r + 4));
      ctx.lineTo(x + Math.cos(a - 0.2) * (r + 7), y + Math.sin(a - 0.2) * (r + 7));
      ctx.stroke();
    }
  }
  if (status.fuse) {
    // A lit fuse: a spitting spark on top and a quickening blink.
    const blink = Math.sin(time * (14 + 40 / Math.max(1, status.fuse))) > 0;
    ctx.fillStyle = blink ? "#fff3b0" : "#ff8a3a";
    ctx.beginPath();
    ctx.arc(x, y - r - 2, 1.8, 0, Math.PI * 2);
    ctx.fill();
    for (let k = 0; k < 4; k++) {
      const a = (hash(seed, k, Math.floor(time * 30)) % 628) / 100;
      ctx.fillStyle = k % 2 ? "#ffd36a" : "#ff7a3a";
      ctx.fillRect(x + Math.cos(a) * 4, y - r - 2 + Math.sin(a) * 3, 1, 1);
    }
  }
  if (status.burning && !status.fuse) drawFlames(ctx, x, y, r, seed, time, 1);
  ctx.restore();
}
/** One cached warm-glow sprite, scaled per flame: a gradient per body per frame was the
 * largest cost of a burning scene. */
let glowSprite: HTMLCanvasElement | null = null;
function glow(): HTMLCanvasElement {
  if (glowSprite) return glowSprite;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const g = canvas.getContext("2d")!,
    gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "#ffb45c40");
  gradient.addColorStop(1, "#ffb45c00");
  g.fillStyle = gradient;
  g.fillRect(0, 0, 64, 64);
  glowSprite = canvas;
  return canvas;
}
/** Animated flame tongues (two batched paths) and a warm glow. */
export function drawFlames(
  ctx: Ctx,
  x: number,
  y: number,
  r: number,
  seed: number,
  time: number,
  scale: number,
): void {
  const reach = r * 2.6 + 8;
  ctx.drawImage(glow(), x - reach, y - r * 0.4 - reach, reach * 2, reach * 2);
  const tongues = Math.max(3, Math.round(r / 2.5));
  for (const odd of [1, 0]) {
    ctx.fillStyle = odd ? "#ff8a3acc" : "#ffcf5acc";
    ctx.beginPath();
    for (let k = odd; k < tongues; k += 2) {
      const dx = ((k + 0.5) / tongues - 0.5) * r * 1.6,
        h = (r * 0.9 + 5) * scale * (0.6 + flick(seed, time, k) * 0.6);
      ctx.moveTo(x + dx - 2.4, y);
      ctx.quadraticCurveTo(x + dx + Math.sin(time * 7 + k) * 2, y - h * 0.6, x + dx, y - h);
      ctx.quadraticCurveTo(x + dx + 1.5, y - h * 0.5, x + dx + 2.4, y);
    }
    ctx.fill();
  }
}
/** Puddles and slicks under everything else; a burning slick carries a sheet of flame. */
export function drawSurfaces(ctx: Ctx, surfaces: readonly ReactionSurface[], time: number): void {
  for (const s of surfaces) {
    const seed = [...s.id].reduce((h, c) => hash(h, c.charCodeAt(0)), 0x9e1);
    const fade = Math.min(1, s.ticks / 240);
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.5 * fade;
    ctx.fillStyle = s.kind === "water" ? "#4d98c855" : "#2a1f3070";
    ctx.beginPath();
    // An uneven, seeded outline so spills do not read as perfect circles.
    for (let k = 0; k <= 12; k++) {
      const a = (k / 12) * Math.PI * 2,
        rr = s.radius * (0.82 + ((hash(seed, k % 12) % 100) / 100) * 0.22);
      const px = s.x + Math.cos(a) * rr,
        py = s.y + Math.sin(a) * rr * 0.72;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.fill();
    if (s.kind === "water") {
      ctx.strokeStyle = "#cdeefc55";
      ctx.lineWidth = 0.8;
      const ring = (time * 0.6 + (seed % 10) / 10) % 1;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, s.radius * 0.7 * ring, s.radius * 0.5 * ring, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.strokeStyle = `hsla(${(time * 40 + (seed % 360)) % 360}, 50%, 60%, 0.35)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(s.x - 3, s.y - 2, s.radius * 0.45, s.radius * 0.25, 0.3, 0.2, 2.6);
      ctx.stroke();
    }
    ctx.restore();
    if (s.burning) {
      ctx.save();
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + (seed % 7),
          d = s.radius * 0.45;
        drawFlames(ctx, s.x + Math.cos(a) * d, s.y + Math.sin(a) * d * 0.7, 5, seed + k, time, 0.9);
      }
      ctx.restore();
    }
  }
}
/** Wind streaks along lanes, swirls, gathering and expanding rings for circular fields. */
export function drawFields(ctx: Ctx, fields: readonly FieldRecipe[], time: number): void {
  for (const f of fields) {
    const seed = [...f.id].reduce((h, c) => hash(h, c.charCodeAt(0)), 0x77);
    ctx.save();
    if (f.shape.kind === "lane") {
      const { x, y, angle, length, width } = f.shape,
        cos = Math.cos(angle),
        sin = Math.sin(angle);
      ctx.strokeStyle = f.source === "authored" ? "#e9f6ee59" : "#f2fbf68c";
      ctx.lineWidth = 1;
      const streaks = Math.max(4, Math.round((length * width) / 1400));
      for (let k = 0; k < streaks; k++) {
        const across = ((hash(seed, k) % 1000) / 1000 - 0.5) * width,
          speed = 0.35 + ((hash(seed, k, 3) % 100) / 100) * 0.4,
          along = ((time * speed + (hash(seed, k, 5) % 100) / 100) % 1) * length,
          sx = x + cos * along - sin * across,
          sy = y + sin * along + cos * across,
          tail = 10 + (f.strength / 120) * 3;
        ctx.globalAlpha = Math.sin((along / length) * Math.PI);
        ctx.beginPath();
        ctx.moveTo(sx - cos * tail, sy - sin * tail);
        ctx.lineTo(sx, sy);
        ctx.stroke();
      }
    } else {
      const { x, y, radius } = f.shape;
      ctx.lineWidth = 1.2;
      if (f.kind === "vortex") {
        ctx.strokeStyle = "#cfeee08c";
        for (let k = 0; k < 3; k++) {
          const a = time * 3 + (k / 3) * Math.PI * 2;
          ctx.beginPath();
          ctx.ellipse(x, y, radius * (0.4 + k * 0.2), radius * (0.3 + k * 0.15), 0, a, a + 1.4);
          ctx.stroke();
        }
      } else if (f.kind === "attract") {
        ctx.strokeStyle = "#c7a8ef99";
        for (let k = 0; k < 3; k++) {
          const phase = 1 - ((time * 0.8 + k / 3) % 1);
          ctx.globalAlpha = 1 - phase;
          ctx.beginPath();
          ctx.ellipse(x, y, radius * phase, radius * phase * 0.8, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else {
        ctx.strokeStyle = f.kind === "pressure" ? "#ffd99acc" : "#9ff0d2aa";
        const phase = (time * 2.5) % 1;
        ctx.globalAlpha = 1 - phase;
        ctx.beginPath();
        ctx.ellipse(x, y, radius * phase, radius * phase * 0.8, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}
const LABELS: Record<string, string> = {
  "ignite:oil": "Oil alight!",
  "detonate:fuse": "Fuse lit",
  "detonate:spark": "Spark!",
  "detonate:sympathetic": "Fuse lit",
  blast: "BOOM",
  "spill:water": "Splash",
  "spill:oil": "Oil spill",
  flare: "Flare!",
  extinguish: "Doused",
  "extinguish:slick": "Doused",
  discharge: "Discharge",
  "release:fire": "Flame spills",
  "release:shock": "Stored charge!",
  "burnout:ash": "Ash",
  "field:fan": "Gust",
};
/** Reaction event effects: arcs, blasts, splashes, puffs and short labels. */
export function drawReactionEvent(ctx: Ctx, e: CombatEvent, age: number, zoom: number): void {
  const [rule] = e.text.split(":");
  ctx.save();
  if ((e.text === "conduct:arc" || e.text === "conduct:source") && age < 0.3 && e.amount > 1) {
    // A jagged bolt from the previous conductor.
    ctx.globalAlpha = 1 - age / 0.3;
    ctx.strokeStyle = "#dff8ff";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(e.x, e.y - 6);
    for (let i = 1; i <= 6; i++) {
      const d = (e.amount * i) / 6,
        shake = i === 6 ? 0 : (hash(i, e.id) % 11) - 5;
      ctx.lineTo(
        e.x + Math.cos(e.angle) * d + Math.sin(e.angle) * shake,
        e.y - 6 + Math.sin(e.angle) * d - Math.cos(e.angle) * shake,
      );
    }
    ctx.stroke();
    ctx.strokeStyle = "#7fd3ef";
    ctx.lineWidth = 0.6;
    ctx.stroke();
  } else if (e.text === "blast" && age < 0.9) {
    const t = age / 0.9;
    ctx.globalAlpha = 1 - t;
    const flash = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, 30 + t * 90);
    flash.addColorStop(0, "#fff4c8");
    flash.addColorStop(0.4, "#ffb04acc");
    flash.addColorStop(1, "#ff6a2a00");
    ctx.fillStyle = flash;
    ctx.beginPath();
    ctx.arc(e.x, e.y, 30 + t * 90, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffe2a6";
    ctx.lineWidth = 3 * (1 - t) + 1;
    ctx.beginPath();
    ctx.ellipse(e.x, e.y, 20 + t * 100, (20 + t * 100) * 0.8, 0, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 16; i++) {
      const a = (hash(i, e.id) / 0xffffffff) * Math.PI * 2,
        d = t * (60 + (hash(i, e.id, 2) % 50));
      ctx.fillStyle = i % 3 ? "#ffb04a" : "#5a4636";
      ctx.fillRect(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d * 0.8 - t * 10, 2, 2);
    }
  } else if (rule === "spill" && age < 0.6) {
    const t = age / 0.6;
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = e.text === "spill:water" ? "#b8e6fb" : "#5e4a6a";
    for (let i = 0; i < 10; i++) {
      const a = (hash(i, e.id) / 0xffffffff) * Math.PI * 2,
        d = t * 30;
      ctx.fillRect(
        e.x + Math.cos(a) * d,
        e.y + Math.sin(a) * d * 0.7 - Math.sin(t * Math.PI) * 10,
        2,
        2,
      );
    }
  } else if ((rule === "extinguish" || rule === "steam") && age < 0.9) {
    const t = age / 0.9;
    ctx.globalAlpha = (1 - t) * 0.7;
    ctx.fillStyle = "#e8f2f2";
    for (let i = 0; i < 5; i++) {
      const dx = ((hash(i, e.id) % 13) - 6) * 1.2;
      ctx.beginPath();
      ctx.arc(e.x + dx, e.y - 6 - t * 18 - i * 2, 2 + t * 4, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if ((rule === "ignite" || rule === "spread" || rule === "flare") && age < 0.5) {
    const t = age / 0.5;
    ctx.globalAlpha = 1 - t;
    ctx.strokeStyle = "#ffcf6a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(e.x, e.y - 3, 4 + t * 14, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  const label = LABELS[e.text];
  if (label && zoom > 0.6 && age < 1.1) {
    ctx.save();
    ctx.globalAlpha = 1 - age / 1.1;
    ctx.font = "bold 7px monospace";
    ctx.textAlign = "center";
    const lx = e.amount > 1 ? e.x + Math.cos(e.angle) * e.amount : e.x,
      ly = e.amount > 1 ? e.y + Math.sin(e.angle) * e.amount : e.y;
    ctx.fillStyle = "#1b3028";
    ctx.fillText(label, lx + 0.6, ly - 16 - age * 18 + 0.6);
    ctx.fillStyle = e.color;
    ctx.fillText(label, lx, ly - 16 - age * 18);
    ctx.restore();
  }
}
