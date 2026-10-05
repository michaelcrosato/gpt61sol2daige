import { hash } from "../engine/math.ts";
import type { CombatEvent } from "../game/types.ts";
import { damageStage, FAMILIES, type PropFamily } from "../physics/blueprints.ts";
import { isMaterial, MATERIALS, type MaterialId } from "../physics/materials.ts";
import type { BodyPose } from "../physics/types.ts";

/**
 * M05 prop presentation. Each family draws its own silhouette over its collider in the body's
 * frame; land palettes change construction details, not just the fill. Sway, shake, cracks and
 * particles are presentation-only and never feed simulation, saves or replay hashes.
 */
const TINTS = ["#6f9a5a", "#b8613f", "#5fa2b0", "#9a76b4", "#dde9e4"] as const;
const FOLIAGE = [
  ["#3f6b3c", "#6f9a55", "#a6c779"],
  ["#2f4a35", "#58704a", "#d98a4e"],
  ["#4e7f74", "#7fb3a4", "#c0e2d0"],
  ["#5a4a78", "#8a6fa6", "#c6a6d6"],
  ["#8fa99a", "#c3d8c6", "#eef5ea"],
] as const;
const mixed = new Map<string, string>();
function mix(a: string, b: string, t: number): string {
  const key = `${a}${b}${t}`;
  let value = mixed.get(key);
  if (value) return value;
  const channel = (hex: string, offset: number) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16);
  value = `#${[1, 3, 5]
    .map((offset) =>
      Math.round(channel(a, offset) + (channel(b, offset) - channel(a, offset)) * t)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
  mixed.set(key, value);
  return value;
}
interface Tone {
  base: string;
  light: string;
  dark: string;
}
function tone(material: MaterialId, palette: number, amount = 0.22): Tone {
  const [base, light, dark] = MATERIALS[material].colors,
    tint = TINTS[palette % TINTS.length];
  return {
    base: mix(base, tint, amount),
    light: mix(light, tint, amount * 0.7),
    dark: mix(dark, tint, amount),
  };
}
const seedOf = (id: string) => [...id].reduce((h, c) => hash(h, c.charCodeAt(0)), 0x2f11);
const noise = (seed: number, n: number) => (hash(seed, n) % 1000) / 1000;
type Ctx = CanvasRenderingContext2D;
interface Look {
  prop: BodyPose;
  family: PropFamily;
  material: MaterialId;
  palette: number;
  stage: number;
  seed: number;
  time: number;
  shake: number;
  sway: number;
}
export class PropRenderer {
  private readonly seen = new Map<string, { durability: number; shakeAt: number; frame: number }>();
  private frame = 0;
  /** Durability drops start a short shake; replicas get the same response from received state. */
  private response(prop: BodyPose, time: number): number {
    const durability = prop.consequences?.durability ?? 100;
    let entry = this.seen.get(prop.id);
    if (!entry) {
      entry = { durability, shakeAt: -Infinity, frame: this.frame };
      this.seen.set(prop.id, entry);
    }
    if (durability < entry.durability) entry.shakeAt = time;
    entry.durability = durability;
    entry.frame = this.frame;
    return Math.max(0, 1 - (time - entry.shakeAt) / 0.55);
  }
  beginFrame(): void {
    this.frame++;
    if (this.seen.size > 1024)
      for (const [id, entry] of this.seen) if (this.frame - entry.frame > 300) this.seen.delete(id);
  }
  draw(ctx: Ctx, prop: BodyPose, time: number, tick: number): void {
    const blueprint = prop.blueprint,
      family = blueprint?.family ?? (prop.shape.kind === "circle" ? "wheel" : "crate"),
      material = prop.material ?? FAMILIES[family].material,
      // Foliage/cloth response follows the body's effective world reactions: off rests in place.
      reactive = prop.policy?.effective.worldReactions ?? true,
      shake = reactive ? this.response(prop, time) : 0,
      seed = seedOf(prop.id);
    const look: Look = {
      prop,
      family,
      material,
      palette: blueprint?.palette ?? 0,
      stage: damageStage(prop.consequences?.durability ?? 100),
      seed,
      time,
      shake,
      sway: reactive
        ? Math.sin(time * 1.4 + (seed % 628) / 100) + Math.max(-1, Math.min(1, prop.vx / 120))
        : 0,
    };
    const fade =
      blueprint?.expiresAt === undefined
        ? 1
        : Math.max(0.15, Math.min(1, (blueprint.expiresAt - tick) / 90));
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(prop.x + (shake > 0 ? Math.sin(time * 70) * shake * 1.6 : 0), prop.y);
    this.shadow(ctx, prop, family);
    if (family === "tree" || family === "pylon" || family === "lantern") this.upright(ctx, look);
    else {
      ctx.rotate(prop.angle);
      this.body(ctx, look);
      this.damage(ctx, look);
    }
    if (prop.frozen) {
      ctx.globalAlpha = fade * 0.35;
      ctx.strokeStyle = "#cfe6f2";
      ctx.setLineDash([2, 3]);
      ctx.lineWidth = 1;
      const r = extent(prop) + 2;
      ctx.strokeRect(-r, -r, r * 2, r * 2);
      ctx.setLineDash([]);
    }
    ctx.restore();
  }
  private shadow(ctx: Ctx, prop: BodyPose, family: PropFamily): void {
    ctx.fillStyle = "#10201944";
    ctx.beginPath();
    if (family === "tree") ctx.ellipse(0, 2, 24, 10, 0, 0, Math.PI * 2);
    else if (prop.shape.kind === "circle")
      ctx.ellipse(1, 3, prop.shape.radius + 1, prop.shape.radius * 0.55 + 1, 0, 0, Math.PI * 2);
    else {
      // Box shadows follow the body's long axis so rails and logs do not cast round blobs.
      const c = Math.abs(Math.cos(prop.angle)),
        s = Math.abs(Math.sin(prop.angle)),
        w = prop.shape.width * c + prop.shape.height * s,
        h = prop.shape.width * s + prop.shape.height * c;
      ctx.ellipse(1, 3, w / 2 + 1, h * 0.35 + 2, 0, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  private body(ctx: Ctx, look: Look): void {
    const { family } = look;
    if (family === "crate") crate(ctx, look);
    else if (family === "barrel") barrel(ctx, look);
    else if (family === "pot") pot(ctx, look);
    else if (family === "log") log(ctx, look);
    else if (family === "stone") stone(ctx, look);
    else if (family === "wheel") wheel(ctx, look);
    else if (family === "wagon") wagon(ctx, look);
    else if (family === "fence") fence(ctx, look);
    else if (family === "stump") stump(ctx, look);
    else debris(ctx, look);
  }
  private upright(ctx: Ctx, look: Look): void {
    if (look.family === "tree") tree(ctx, look);
    else if (look.family === "pylon") pylon(ctx, look);
    else lantern(ctx, look);
  }
  /** Seeded cracks; more and darker as durability falls. */
  private damage(ctx: Ctx, look: Look): void {
    if (look.stage === 0 || FAMILIES[look.family].toughness === 0) return;
    const r = extent(look.prop) * 0.85;
    ctx.strokeStyle = look.material === "glass" ? "#ffffffcc" : "#1d1712bb";
    ctx.lineWidth = look.stage > 1 ? 1.4 : 1;
    for (let c = 0; c < look.stage * 2; c++) {
      let x = (noise(look.seed, c * 7) - 0.5) * r,
        y = (noise(look.seed, c * 7 + 1) - 0.5) * r;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 2; k < 5; k++) {
        x += (noise(look.seed, c * 7 + k) - 0.5) * r * 0.8;
        y += (noise(look.seed, c * 7 + k + 9) - 0.5) * r * 0.8;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    if (look.stage > 1) {
      ctx.fillStyle = "#0000001f";
      fillShape(ctx, look.prop);
    }
  }
}
function extent(prop: BodyPose): number {
  return prop.shape.kind === "circle"
    ? prop.shape.radius
    : Math.max(prop.shape.width, prop.shape.height) / 2;
}
function fillShape(ctx: Ctx, prop: BodyPose): void {
  if (prop.shape.kind === "circle") {
    ctx.beginPath();
    ctx.arc(0, 0, prop.shape.radius, 0, Math.PI * 2);
    ctx.fill();
  } else
    ctx.fillRect(
      -prop.shape.width / 2,
      -prop.shape.height / 2,
      prop.shape.width,
      prop.shape.height,
    );
}
const size = (prop: BodyPose) =>
  prop.shape.kind === "box"
    ? { w: prop.shape.width, h: prop.shape.height }
    : { w: prop.shape.radius * 2, h: prop.shape.radius * 2 };
const radius = (prop: BodyPose) =>
  prop.shape.kind === "circle"
    ? prop.shape.radius
    : Math.min(prop.shape.width, prop.shape.height) / 2;
function crate(ctx: Ctx, { prop, material, palette }: Look): void {
  const { w, h } = size(prop),
    t = tone(material, palette, palette === 3 ? 0.45 : 0.22);
  ctx.fillStyle = palette === 2 ? mix(t.base, "#d8d2c0", 0.3) : t.base;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.strokeStyle = t.dark;
  ctx.lineWidth = 1;
  for (let k = 1; k < 3; k++) {
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2 + (h * k) / 3);
    ctx.lineTo(w / 2, -h / 2 + (h * k) / 3);
    ctx.stroke();
  }
  ctx.strokeStyle = t.light;
  ctx.lineWidth = 2;
  ctx.strokeRect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2);
  ctx.beginPath();
  ctx.moveTo(-w / 2 + 3, h / 2 - 3);
  ctx.lineTo(w / 2 - 3, -h / 2 + 3);
  ctx.stroke();
  if (palette === 1) {
    ctx.fillStyle = MATERIALS.metal.colors[2];
    for (const [x, y] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ])
      ctx.fillRect((x * w) / 2 - (x > 0 ? 5 : 0), (y * h) / 2 - (y > 0 ? 5 : 0), 5, 5);
  }
  if (palette === 4) {
    ctx.fillStyle = "#f2fbff";
    ctx.fillRect(-w / 2, -h / 2, w, 2);
  }
}
function barrel(ctx: Ctx, { prop, material, palette }: Look): void {
  const r = radius(prop),
    t = tone(material, palette),
    metal = tone("metal", palette, 0.1);
  ctx.fillStyle = t.base;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = t.dark;
  ctx.lineWidth = 1;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5);
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    ctx.stroke();
  }
  ctx.fillStyle = t.light;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.48, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = metal.light;
  ctx.lineWidth = 1.5;
  for (const k of [0.97, 0.5]) {
    ctx.beginPath();
    ctx.arc(0, 0, r * k, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (material === "volatile") {
    ctx.fillStyle = "#f6d35b";
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.38);
    ctx.lineTo(r * 0.34, r * 0.26);
    ctx.lineTo(-r * 0.34, r * 0.26);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#3e2019";
    ctx.fillRect(-0.6, -r * 0.18, 1.2, r * 0.25);
  }
}
function pot(ctx: Ctx, { prop, material, palette }: Look): void {
  const r = radius(prop),
    t = tone(material, palette, 0.35);
  ctx.fillStyle = t.base;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = t.light;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.78, 0.3, Math.PI * 1.6);
  ctx.stroke();
  ctx.fillStyle = t.dark;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = palette === 2 ? "#c4f3e0" : TINTS[palette];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    ctx.fillRect(Math.cos(a) * r * 0.66 - 0.6, Math.sin(a) * r * 0.66 - 0.6, 1.2, 1.2);
  }
}
function log(ctx: Ctx, { prop, material, palette, seed }: Look): void {
  const { w, h } = size(prop),
    t = tone(material, palette);
  ctx.fillStyle = palette === 4 ? "#d9d6c8" : palette === 1 ? mix(t.base, "#2a211c", 0.45) : t.base;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, h / 2.5);
  ctx.fill();
  ctx.strokeStyle = palette === 4 ? "#3b3b38" : t.dark;
  ctx.lineWidth = 1;
  for (let k = 0; k < 4; k++) {
    const y = -h / 2 + 2 + noise(seed, k) * (h - 4),
      x = -w / 2 + 4 + noise(seed, k + 4) * (w * 0.5);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w * 0.35, y + (noise(seed, k + 8) - 0.5) * 2);
    ctx.stroke();
  }
  for (const end of [-1, 1]) {
    ctx.fillStyle = t.light;
    ctx.beginPath();
    ctx.ellipse((end * w) / 2 - end * 2, 0, 2.5, h / 2 - 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = t.dark;
    ctx.beginPath();
    ctx.ellipse((end * w) / 2 - end * 2, 0, 1.2, h / 4, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (palette === 0) {
    ctx.fillStyle = "#6f9a55";
    ctx.fillRect(-w * 0.1, -h / 2, w * 0.22, 2.5);
  }
}
function stone(ctx: Ctx, { prop, material, palette, seed }: Look): void {
  const r = radius(prop),
    t = tone(material, palette, 0.3);
  ctx.fillStyle = t.base;
  ctx.beginPath();
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2,
      d = r * (0.84 + noise(seed, k) * 0.24);
    if (k) ctx.lineTo(Math.cos(a) * d, Math.sin(a) * d);
    else ctx.moveTo(Math.cos(a) * d, Math.sin(a) * d);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = t.dark;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = t.light;
  ctx.beginPath();
  ctx.ellipse(-r * 0.25, -r * 0.3, r * 0.4, r * 0.22, -0.4, 0, Math.PI * 2);
  ctx.fill();
  const fleck = ["#6f9a55", "#e07a43", "#d7efe6", "#b28ad0", "#f4fbff"][palette % 5];
  ctx.fillStyle = fleck;
  for (let k = 0; k < 3; k++)
    ctx.fillRect((noise(seed, k + 20) - 0.5) * r, (noise(seed, k + 30) - 0.3) * r * 0.8, 2, 1.5);
}
function wheel(ctx: Ctx, { prop, material, palette }: Look): void {
  const r = radius(prop),
    t = tone(material, palette),
    metal = tone("metal", palette, 0.1);
  ctx.strokeStyle = t.base;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, r - 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = palette === 1 ? metal.dark : metal.light;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(0, 0, r - 0.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = t.light;
  ctx.lineWidth = 1.5;
  const spokes = palette === 2 ? 8 : 6;
  for (let k = 0; k < spokes; k++) {
    const a = (k / spokes) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * (r - 2), Math.sin(a) * (r - 2));
    ctx.stroke();
  }
  ctx.fillStyle = metal.base;
  ctx.beginPath();
  ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
  ctx.fill();
}
function wagon(ctx: Ctx, { prop, material, palette, sway, shake, time }: Look): void {
  const { w, h } = size(prop),
    t = tone(material, palette),
    cloth = tone("cloth", palette, 0.45);
  ctx.fillStyle = "#2a2420";
  for (const [x, y] of [
    [-w * 0.32, -h / 2 - 2],
    [w * 0.32, -h / 2 - 2],
    [-w * 0.32, h / 2 + 2],
    [w * 0.32, h / 2 + 2],
  ]) {
    ctx.beginPath();
    ctx.ellipse(x, y, 6, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = t.base;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.strokeStyle = t.dark;
  ctx.lineWidth = 1;
  for (let k = 1; k < 5; k++) {
    ctx.beginPath();
    ctx.moveTo(-w / 2 + (w * k) / 5, -h / 2);
    ctx.lineTo(-w / 2 + (w * k) / 5, h / 2);
    ctx.stroke();
  }
  ctx.strokeStyle = t.light;
  ctx.lineWidth = 2;
  ctx.strokeRect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2);
  ctx.strokeStyle = t.dark;
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2 + 10, 0);
  ctx.stroke();
  // Cloth canopy responds to motion, breeze and hits.
  const billow = sway * 1.4 + Math.sin(time * 31) * shake * 2.5;
  ctx.fillStyle = cloth.base;
  ctx.beginPath();
  ctx.moveTo(-w * 0.45, -h / 2 + 2);
  ctx.quadraticCurveTo(-w * 0.2 + billow, -h / 2 - 6, w * 0.05, -h / 2 + 2);
  ctx.lineTo(w * 0.05, h / 2 - 2);
  ctx.quadraticCurveTo(-w * 0.2 + billow, h / 2 + 4, -w * 0.45, h / 2 - 2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = cloth.dark;
  ctx.lineWidth = 1;
  for (let k = 0; k < 3; k++) {
    const x = -w * 0.4 + k * w * 0.2 + billow * 0.3;
    ctx.beginPath();
    ctx.moveTo(x, -h / 2 + 1);
    ctx.lineTo(x, h / 2 - 1);
    ctx.stroke();
  }
}
function fence(ctx: Ctx, { prop, material, palette }: Look): void {
  const { w, h } = size(prop),
    t = tone(material, palette, palette === 4 ? 0.5 : 0.22);
  ctx.strokeStyle = t.base;
  ctx.lineWidth = 1.8;
  for (const y of [-h / 4, h / 4]) {
    ctx.beginPath();
    ctx.moveTo(-w / 2, y);
    ctx.lineTo(w / 2, y);
    ctx.stroke();
  }
  ctx.fillStyle = t.light;
  for (const x of [-w / 2, 0, w / 2]) ctx.fillRect(x - 2, -h / 2 - 1, 4, h + 2);
  if (palette === 1 || palette === 3) {
    ctx.strokeStyle = palette === 1 ? MATERIALS.metal.colors[1] : "#6b4a73";
    ctx.lineWidth = 1;
    for (let x = -w / 2 + 3; x < w / 2; x += 5) {
      ctx.beginPath();
      ctx.moveTo(x, -h / 2);
      ctx.lineTo(x + 1.5, -h / 2 - 3);
      ctx.stroke();
    }
  }
}
function stump(ctx: Ctx, { prop, material, palette }: Look): void {
  const r = radius(prop),
    t = tone(material, palette);
  ctx.fillStyle = palette === 4 ? "#d9d6c8" : t.dark;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = t.light;
  ctx.beginPath();
  ctx.arc(0, -1, r * 0.78, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = t.dark;
  ctx.lineWidth = 0.8;
  for (const k of [0.25, 0.5]) {
    ctx.beginPath();
    ctx.arc(0, -1, r * k, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = t.base;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-r * 0.6, -r * 0.5);
  ctx.lineTo(r * 0.2, r * 0.1);
  ctx.stroke();
}
function debris(ctx: Ctx, { prop, material, palette, seed }: Look): void {
  const piece = prop.blueprint?.piece ?? "",
    t = tone(material, palette),
    { w, h } = size(prop);
  if (piece.startsWith("shard") || piece === "pane") {
    ctx.fillStyle = material === "glass" ? `${t.light}cc` : t.base;
    ctx.strokeStyle = material === "glass" ? "#ffffff" : t.dark;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-w / 2, h / 2);
    ctx.lineTo((w / 2) * (noise(seed, 1) * 0.6 + 0.4), -h / 2);
    ctx.lineTo(w / 2, (h / 2) * noise(seed, 2));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (piece.startsWith("chunk")) stone(ctx, { prop, material, palette, seed } as Look);
  else if (piece === "hub" || piece === "frame" || piece === "hoop") {
    ctx.fillStyle = t.base;
    fillShape(ctx, prop);
    ctx.strokeStyle = t.light;
    ctx.lineWidth = 1;
    ctx.strokeRect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2);
  } else if (piece === "canopy") {
    ctx.fillStyle = t.base;
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2);
    ctx.quadraticCurveTo(0, -h / 2 + 3, w / 2, -h / 2 + 1);
    ctx.lineTo(w / 2 - 2, h / 2);
    ctx.quadraticCurveTo(0, h / 2 - 3, -w / 2 + 1, h / 2 - 1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = t.dark;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  } else if (piece.startsWith("half")) {
    ctx.fillStyle = t.base;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = t.light;
    const end = piece === "half0" ? w / 2 : -w / 2;
    ctx.beginPath();
    for (let k = 0; k <= 4; k++)
      ctx.lineTo(end + (k % 2 ? -2 : 1) * Math.sign(end), -h / 2 + (h * k) / 4);
    ctx.lineTo(end - 3 * Math.sign(end), h / 2);
    ctx.lineTo(end - 3 * Math.sign(end), -h / 2);
    ctx.fill();
  } else {
    // Planks, rails and spokes.
    ctx.fillStyle = t.base;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeStyle = t.dark;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 1, 0);
    ctx.lineTo(w / 2 - 1, (noise(seed, 3) - 0.5) * h);
    ctx.stroke();
    ctx.strokeStyle = t.light;
    ctx.strokeRect(-w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1);
  }
}
function tree(ctx: Ctx, look: Look): void {
  const { prop, palette, material, stage, seed, sway, shake, time } = look,
    r = radius(prop),
    t = tone(material, palette),
    leaves = FOLIAGE[palette % FOLIAGE.length],
    birch = palette === 4;
  ctx.fillStyle = birch ? "#e7e4d8" : t.dark;
  ctx.fillRect(-r * 0.55, -26, r * 1.1, 28);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.75, 0, Math.PI);
  ctx.fill();
  ctx.strokeStyle = birch ? "#2b2b2b" : t.base;
  ctx.lineWidth = 1;
  for (let k = 0; k < 4; k++) {
    const y = -22 + k * 6;
    ctx.beginPath();
    ctx.moveTo(-r * 0.4, y);
    ctx.lineTo(-r * 0.4 + (birch ? 3 : r * 0.6), y + (birch ? 0 : 2));
    ctx.stroke();
  }
  if (stage > 0) {
    ctx.strokeStyle = "#1a120ccc";
    ctx.beginPath();
    ctx.moveTo(r * 0.5, -6);
    ctx.lineTo(-r * 0.1, -2 - stage * 3);
    ctx.lineTo(r * 0.3, 1);
    ctx.stroke();
  }
  // Foliage sways with the breeze and shudders when the trunk is struck; damage thins it.
  const lean = sway * 1.6 + Math.sin(time * 38) * shake * 4,
    cx = lean,
    cy = -38;
  const blobs = 6 - stage * 2;
  if (palette === 1) {
    for (let k = 0; k < 3; k++) {
      ctx.fillStyle = leaves[k % 2];
      const y = cy - 10 + k * 9,
        half = 10 + k * 5;
      ctx.beginPath();
      ctx.moveTo(cx * (1 - k * 0.3), y - 12);
      ctx.lineTo(cx * (1 - k * 0.3) + half, y + 6);
      ctx.lineTo(cx * (1 - k * 0.3) - half, y + 6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = leaves[2];
    for (let k = 0; k < blobs; k++)
      ctx.fillRect(cx + (noise(seed, k) - 0.5) * 24, cy + noise(seed, k + 9) * 20 - 8, 2, 2);
    return;
  }
  for (let k = 0; k < blobs; k++) {
    const a = (k / 6) * Math.PI * 2 + noise(seed, k),
      d = 9 + noise(seed, k + 6) * 6;
    ctx.fillStyle = leaves[k % 2];
    ctx.beginPath();
    ctx.arc(
      cx + Math.cos(a) * d,
      cy + Math.sin(a) * d * 0.7,
      11 + noise(seed, k + 12) * 4,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.fillStyle = leaves[1];
  ctx.beginPath();
  ctx.arc(cx, cy - 2, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = leaves[2];
  for (let k = 0; k < 7; k++)
    ctx.fillRect(
      cx + (noise(seed, k + 40) - 0.5) * 30,
      cy + (noise(seed, k + 50) - 0.6) * 22,
      2,
      2,
    );
  if (palette === 2) {
    ctx.strokeStyle = leaves[0];
    ctx.lineWidth = 1;
    for (let k = 0; k < 6; k++) {
      const x = cx - 15 + k * 6;
      ctx.beginPath();
      ctx.moveTo(x, cy + 4);
      ctx.quadraticCurveTo(x + lean * 0.6, cy + 16, x + lean, cy + 24);
      ctx.stroke();
    }
  }
}
function pylon(ctx: Ctx, { prop, material, palette, stage, time, seed, shake }: Look): void {
  const r = radius(prop),
    t = tone(material, palette, 0.55),
    height = r * 4,
    pulse = 0.5 + Math.sin(time * 2.4 + (seed % 100)) * 0.5;
  const glow = ctx.createRadialGradient(0, -height * 0.5, 0, 0, -height * 0.5, height * 1.2);
  glow.addColorStop(0, `${t.light}${Math.round(40 + pulse * 40).toString(16)}`);
  glow.addColorStop(1, `${t.light}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(-height * 1.2, -height * 1.7, height * 2.4, height * 2.4);
  ctx.fillStyle = `${t.base}dd`;
  ctx.strokeStyle = t.light;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-r, 0);
  ctx.lineTo(-r * 0.75, -height * 0.75);
  ctx.lineTo(0, -height - shake * 2);
  ctx.lineTo(r * 0.75, -height * 0.75);
  ctx.lineTo(r, 0);
  ctx.lineTo(0, r * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "#ffffffaa";
  ctx.beginPath();
  ctx.moveTo(-r * 0.3, -height * 0.15);
  ctx.lineTo(-r * 0.15, -height * 0.7);
  ctx.stroke();
  if (stage > 0) {
    ctx.strokeStyle = "#ffffffee";
    ctx.lineWidth = 1;
    for (let k = 0; k < stage * 2; k++) {
      ctx.beginPath();
      ctx.moveTo((noise(seed, k) - 0.5) * r, -height * noise(seed, k + 3));
      ctx.lineTo((noise(seed, k + 6) - 0.5) * r * 1.6, -height * noise(seed, k + 9));
      ctx.stroke();
    }
  }
}
function lantern(ctx: Ctx, { prop, palette, stage, time, seed, shake }: Look): void {
  const metal = tone("metal", palette, 0.25),
    glass = tone("glass", palette, 0.5),
    flicker = 0.75 + Math.sin(time * 9 + (seed % 50)) * 0.15 + Math.sin(time * 23) * 0.1,
    swing = Math.sin(time * 2 + seed) * 0.6 + Math.sin(time * 40) * shake * 2;
  const r = radius(prop);
  ctx.fillStyle = metal.dark;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(-1.2, -26, 2.4, 26);
  ctx.fillRect(-1.2, -26, 9, 2);
  const lx = 7 + swing,
    ly = -18;
  if (stage < 2) {
    const light = ctx.createRadialGradient(lx, ly, 0, lx, ly, 34);
    light.addColorStop(
      0,
      `#ffd98a${Math.round(flicker * 60)
        .toString(16)
        .padStart(2, "0")}`,
    );
    light.addColorStop(1, "#ffd98a00");
    ctx.fillStyle = light;
    ctx.fillRect(lx - 34, ly - 34, 68, 68);
  }
  ctx.fillStyle = stage < 2 ? mix(glass.light, "#ffd98a", 0.6) : glass.dark;
  ctx.fillRect(lx - 3, ly - 4, 6, 7);
  ctx.strokeStyle = metal.light;
  ctx.lineWidth = 1;
  ctx.strokeRect(lx - 3, ly - 4, 6, 7);
  ctx.beginPath();
  ctx.moveTo(lx, -24);
  ctx.lineTo(lx, ly - 4);
  ctx.stroke();
}
/**
 * Material impact/break particles from replicated combat events. Purely visual: no bodies,
 * no saved state; the gameplay fragments are the fracture pieces the simulation spawned.
 */
export function drawMaterialEvent(ctx: Ctx, e: CombatEvent, age: number, zoom: number): void {
  const parts = e.text.split(":"),
    material = (e.type === "break" ? parts[1] : parts[0]) as MaterialId;
  if (!isMaterial(material)) return;
  const breaking = e.type === "break",
    duration = breaking ? 0.95 : 0.45;
  if (age > duration) return;
  const recipe = MATERIALS[material],
    feedback = recipe.feedback,
    [base, light, dark] = recipe.colors,
    life = age / duration,
    resisted = parts[1] === "resisted" || parts[1] === "protected";
  ctx.save();
  ctx.globalAlpha = 1 - life;
  const count = breaking ? 16 + e.amount * 2 : resisted ? 5 : 8;
  for (let i = 0; i < count; i++) {
    const spread = breaking ? Math.PI * 2 : 1.6,
      angle = (breaking ? 0 : e.angle - spread / 2) + (hash(i, e.id, 7) / 4294967296) * spread,
      speed = (breaking ? 40 : 26) + (hash(i, e.id, 11) % 60) * (breaking ? 1.1 : 0.6),
      d = speed * age,
      x = e.x + Math.cos(angle) * d,
      fall = feedback === "leaves" ? age * 10 : feedback === "dust" ? -age * 12 : age * age * 70,
      y = e.y - 8 + Math.sin(angle) * d * 0.7 + fall;
    const pick = i % 3 === 0 ? light : i % 3 === 1 ? base : dark;
    if (feedback === "splinters" || feedback === "fibres") {
      ctx.strokeStyle = pick;
      ctx.lineWidth = feedback === "fibres" ? 0.7 : 1.3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(angle + age * 9) * 4, y + Math.sin(angle + age * 9) * 4);
      ctx.stroke();
    } else if (feedback === "shards") {
      ctx.fillStyle = material === "glass" ? (i % 2 ? "#ffffff" : light) : pick;
      ctx.beginPath();
      ctx.moveTo(x, y - 2);
      ctx.lineTo(x + 2.5, y + 1.5);
      ctx.lineTo(x - 1.5, y + 1);
      ctx.closePath();
      ctx.fill();
    } else if (feedback === "sparks") {
      ctx.strokeStyle = i % 2 ? "#ffe7a3" : "#ffb35c";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - Math.cos(angle) * 5, y - Math.sin(angle) * 3.5);
      ctx.stroke();
    } else if (feedback === "leaves") {
      ctx.fillStyle = i % 2 ? "#8fbb73" : "#4f7a45";
      ctx.beginPath();
      ctx.ellipse(x + Math.sin(age * 8 + i) * 4, y, 2.2, 1.2, angle + age * 4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = `${light}88`;
      ctx.beginPath();
      ctx.arc(x, y, 1.5 + age * 9, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (breaking && age < 0.3) {
    ctx.globalAlpha = 1 - age / 0.3;
    ctx.strokeStyle = light;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(e.x, e.y - 4, 10 + age * 90, (10 + age * 90) * 0.6, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (resisted && zoom > 0.65) {
    ctx.globalAlpha = 1 - life;
    ctx.font = "7px monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "#1b3028";
    ctx.fillText(parts[1] === "resisted" ? "RESIST" : "KEPT", e.x + 1, e.y - 21 - age * 24);
    ctx.fillStyle = light;
    ctx.fillText(parts[1] === "resisted" ? "RESIST" : "KEPT", e.x, e.y - 22 - age * 24);
  }
  ctx.restore();
}
