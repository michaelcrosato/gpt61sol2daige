import { clamp } from "../engine/math.ts";
import { type RigKind, type ThemeId, themeOf } from "../game/content.ts";
import {
  type ArtOp,
  detachables,
  enemyPose,
  fallAngle,
  fallPivot,
  freshReaction,
  type PartPose,
  RIG_BLUEPRINTS,
  rigArt,
  rigGeometry,
  rigPose,
  rigScale,
} from "../game/rigs.ts";
import type { Enemy } from "../game/types.ts";
import type { RemainsTag } from "../physics/blueprints.ts";
import type { BodyPose } from "../physics/types.ts";
import type { Pixel } from "./sprites.ts";

export type RigPose = "idle" | "walk" | "windup" | "attack" | "hurt";
export interface RigRecipe {
  version: 1;
  rig: RigKind;
  theme: ThemeId;
  seed: number;
}
const HURT = ["#5c6965", "#bdcbb0", "#e5eed0", "#fbffe9", "#eddda8"] as const;
/** Pixel rasterization of rig art: rectangles, stepped limbs and row-filled blobs. */
export function rasterize(
  ops: readonly ArtOp[],
  palette: readonly string[],
  ox = 0,
  oy = 0,
): Pixel[] {
  const out: Pixel[] = [];
  const color = (c: number | string) => (typeof c === "number" ? palette[c] : c);
  const rect = (x: number, y: number, w: number, h: number, c: string) => {
    if (w > 0 && h > 0)
      out.push({
        x: Math.round(x - ox),
        y: Math.round(y - oy),
        w: Math.ceil(w),
        h: Math.ceil(h),
        color: c,
      });
  };
  for (const op of ops)
    if (op[0] === "r") rect(op[1], op[2], op[3], op[4], color(op[5]));
    else if (op[0] === "l") {
      const [, x1, y1, x2, y2, width] = op,
        steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 2));
      for (let i = 0; i <= steps; i++)
        rect(
          x1 + ((x2 - x1) * i) / steps - width / 2,
          y1 + ((y2 - y1) * i) / steps - width / 2,
          width,
          width,
          color(op[6]),
        );
    } else {
      const [, x, y, rx, ry] = op;
      for (let row = -ry; row <= ry; row += 2) {
        const width = Math.sqrt(Math.max(0, 1 - (row / ry) ** 2)) * rx;
        rect(x - width, y + row, width * 2, 2, color(op[5]));
      }
    }
  return out;
}
/** One part's art in its own frame (origin at its pivot). */
export function partPixels(
  kind: RigKind,
  part: string,
  theme: ThemeId,
  variant: number,
  hurt = false,
): Pixel[] {
  const p = RIG_BLUEPRINTS[kind].parts.find((q) => q.id === part);
  if (!p) return [];
  const ops = rigArt(kind, variant, variant)[part] ?? [];
  return rasterize(ops, hurt ? HURT : themeOf(theme).colors, p.pivot[0], p.pivot[1]);
}
/** Authored poses for atlases and documentation (the game draws live poses). */
function atlasPose(recipe: RigRecipe, pose: RigPose, frame: number) {
  const reaction = freshReaction();
  if (pose === "hurt") {
    reaction.lean = 0.28;
    reaction.leanRate = -2;
  }
  return rigPose(RIG_BLUEPRINTS[recipe.rig], {
    phase: pose === "windup" ? "windup" : pose === "attack" ? "charge" : "walk",
    moving: pose === "walk" || pose === "hurt",
    frame,
    windup: pose === "windup" ? Math.min(1, frame / 15) : 0,
    reaction,
    tick: 0,
    flip: false,
  });
}
const ordered = (kind: RigKind) =>
  [...RIG_BLUEPRINTS[kind].parts].sort((a, b) => a.layer - b.layer);
/** Shared procedural skeleton: jointed, weighted parts with layered armor and emissive detail. */
export function monsterPixels(recipe: RigRecipe, pose: RigPose = "walk", frame = 0): Pixel[] {
  const variant = recipe.seed % 4,
    composed = atlasPose(recipe, pose, frame),
    poses = new Map(composed.parts.map((p) => [p.id, p])),
    out: Pixel[] = [];
  for (const part of ordered(recipe.rig)) {
    const at = poses.get(part.id)!,
      cos = Math.cos(at.angle),
      sin = Math.sin(at.angle);
    for (const p of partPixels(recipe.rig, part.id, recipe.theme, variant, pose === "hurt")) {
      const cx = p.x + p.w / 2,
        cy = p.y + p.h / 2;
      out.push({
        ...p,
        x: Math.round(at.x + cos * cx - sin * cy - p.w / 2),
        y: Math.round(at.y + composed.lift + sin * cx + cos * cy - p.h / 2),
      });
    }
  }
  return out;
}
export function rigSvg(recipe: RigRecipe, pose: RigPose = "walk", frame = 0): string {
  const variant = recipe.seed % 4,
    composed = atlasPose(recipe, pose, frame),
    poses = new Map(composed.parts.map((p) => [p.id, p]));
  const groups = ordered(recipe.rig).map((part) => {
    const at = poses.get(part.id)!,
      rects = partPixels(recipe.rig, part.id, recipe.theme, variant, pose === "hurt")
        .map(
          (p) => `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="${p.color}"/>`,
        )
        .join("");
    return `<g transform="translate(${at.x.toFixed(2)} ${(at.y + composed.lift).toFixed(2)}) rotate(${((at.angle * 180) / Math.PI).toFixed(2)})">${rects}</g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-44 -76 88 88" width="176" height="176" shape-rendering="crispEdges">${groups.join("")}</svg>`;
}

type Light = (x: number, y: number, radius: number, color: string, strength: number) => void;
interface PartImage {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
}
const rotate = (x: number, y: number, a: number): [number, number] => [
  Math.cos(a) * x - Math.sin(a) * y,
  Math.sin(a) * x + Math.cos(a) * y,
];
const ease = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
/**
 * Draws rigs part by part from cached part images: living monsters in their authored and
 * secondary pose, the authored death pose where ragdolls are off, and physical remains, whose
 * bodies are drawn exactly where they are (only the first moments of a fall are presented as a
 * rigid rotation about the fall pivot, which lands on the bodies' solved pose).
 */
export class RigRenderer {
  private readonly cache = new Map<string, PartImage>();
  private image(kind: RigKind, theme: ThemeId, variant: number, part: string, hurt: boolean) {
    const key = `${kind}:${theme}:${variant}:${part}:${hurt ? 1 : 0}`;
    let image = this.cache.get(key);
    if (!image) {
      const pixels = partPixels(kind, part, theme, variant, hurt);
      let minX = 0,
        minY = 0,
        maxX = 1,
        maxY = 1;
      if (pixels.length) {
        minX = Math.min(...pixels.map((p) => p.x));
        minY = Math.min(...pixels.map((p) => p.y));
        maxX = Math.max(...pixels.map((p) => p.x + p.w));
        maxY = Math.max(...pixels.map((p) => p.y + p.h));
      }
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, maxX - minX);
      canvas.height = Math.max(1, maxY - minY);
      const ctx = canvas.getContext("2d")!;
      for (const p of pixels) {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - minX, p.y - minY, p.w, p.h);
      }
      image = { canvas, x: minX, y: minY };
      this.cache.set(key, image);
      if (this.cache.size > 1536) this.cache.delete(this.cache.keys().next().value!);
    }
    return image;
  }
  /** Parts in sprite space; the caller's transform puts the origin at the feet (scaled, mirrored). */
  private figure(
    ctx: CanvasRenderingContext2D,
    kind: RigKind,
    theme: ThemeId,
    variant: number,
    parts: PartPose[],
    hurt: boolean,
    skip: (id: string) => boolean,
  ): void {
    const poses = new Map(parts.map((p) => [p.id, p]));
    for (const part of ordered(kind)) {
      if (skip(part.id)) continue;
      const at = poses.get(part.id);
      if (!at) continue;
      const image = this.image(kind, theme, variant, part.id, hurt);
      ctx.save();
      ctx.translate(at.x, at.y);
      ctx.rotate(at.angle);
      ctx.drawImage(image.canvas, image.x, image.y);
      ctx.restore();
    }
  }
  private shed(kind: RigKind, mask: number): Set<string> {
    return new Set(
      detachables(kind)
        .filter((_, i) => mask & (1 << i))
        .map((p) => p.id),
    );
  }
  /** World position of a part's collider centre in a drawn pose. */
  private centre(
    kind: RigKind,
    variant: number,
    at: PartPose,
    x: number,
    y: number,
    f: number,
    scale: number,
    lift: number,
  ): [number, number] {
    const g = rigGeometry(kind, variant)[at.id],
      [ox, oy] = rotate(g.cx, g.cy, at.angle);
    return [x + f * (at.x + ox) * scale, y + (at.y + oy + lift) * scale];
  }
  /** A living monster: shadow, figure, its emissive parts' light and a knockdown's dust. */
  living(
    ctx: CanvasRenderingContext2D,
    e: Enemy,
    x: number,
    y: number,
    tick: number,
    light: Light,
  ) {
    const bp = RIG_BLUEPRINTS[e.rig],
      scale = rigScale(e),
      f = Math.cos(e.facing) < 0 ? -1 : 1,
      variant = e.id % 4,
      pose = enemyPose(e, tick),
      hurt = e.hurtUntil > tick,
      shed = this.shed(e.rig, e.reaction.shed);
    // The shadow stays on the ground; it stretches along a fallen body and shrinks under a hover.
    const floating = bp.locomotion === "floating",
      down = pose.down * (floating ? 0 : 1);
    ctx.fillStyle = floating ? "#11251c55" : "#11251c88";
    ctx.beginPath();
    ctx.ellipse(
      x + 2 + e.reaction.side * down * e.radius * 1.4,
      y + 2,
      e.radius * (floating ? 1.1 : 1.4) * (1 + down * 1.1),
      e.radius * 0.55,
      -0.2,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(f * scale, scale * (1 + pose.squash * 0.7));
    ctx.translate(0, pose.lift);
    this.figure(ctx, e.rig, e.theme, variant, pose.parts, hurt, (id) => shed.has(id));
    ctx.restore();
    const theme = themeOf(e.theme).colors;
    for (const part of bp.parts)
      if (part.glow && !shed.has(part.id)) {
        const at = pose.parts.find((p) => p.id === part.id)!,
          [gx, gy] = this.centre(e.rig, variant, at, x, y, f, scale, pose.lift);
        light(gx, gy, 26 * scale + 6, theme[3], 0.13 + Math.sin(tick * 0.09 + e.id) * 0.04);
      }
  }
  /**
   * The authored death pose (ragdolls off, or before a guest receives the remains): the figure
   * falls about its fall pivot exactly as the remains would, then fades with the enemy record.
   */
  dying(ctx: CanvasRenderingContext2D, e: Enemy, x: number, y: number, tick: number) {
    const bp = RIG_BLUEPRINTS[e.rig],
      scale = rigScale(e),
      f = Math.cos(e.facing) < 0 ? -1 : 1,
      variant = e.id % 4,
      age = tick - e.deadAt,
      progress = ease(age / bp.fallTicks),
      fall = fallAngle(bp, e.reaction, e.facing, e.id) * progress,
      [kx, ky] = fallPivot(bp),
      pose = enemyPose({ ...e, phase: "dead" }, e.deadAt),
      shed = this.shed(e.rig, e.reaction.shed),
      root = bp.parts[0].id;
    ctx.save();
    ctx.globalAlpha = clamp((40 - age) / 12, 0, 1);
    ctx.fillStyle = "#11251c66";
    ctx.beginPath();
    ctx.ellipse(x + 2, y + 2, e.radius * 1.6, e.radius * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    const lift = bp.death === "collapse" ? pose.lift * (1 - progress) : 0;
    const draw = (rotated: boolean) => {
      ctx.save();
      ctx.translate(x, y);
      if (rotated) {
        ctx.translate(f * kx * scale, ky * scale);
        ctx.rotate(fall);
        ctx.translate(-f * kx * scale, -ky * scale);
      }
      ctx.scale(f * scale, scale);
      ctx.translate(0, lift);
      this.figure(
        ctx,
        e.rig,
        e.theme,
        variant,
        pose.parts,
        false,
        (id) => shed.has(id) || (bp.death === "fell" ? (id === root) === rotated : !rotated),
      );
      ctx.restore();
    };
    if (bp.death === "fell") draw(false);
    draw(true);
    ctx.restore();
  }
  /**
   * One dead monster's remains: its jointed part bodies and loose pieces. Each part is drawn at
   * its own body; during the fall the assembled parts are shown rotated back about the fall
   * pivot by the part of the fall still to come (a rigid rotation, so nothing separates).
   */
  remains(ctx: CanvasRenderingContext2D, bodies: BodyPose[], tick: number, light: Light): void {
    const first = bodies[0].blueprint!.rig!,
      kind = first.kind,
      bp = RIG_BLUEPRINTS[kind],
      rootPart = bp.parts[0].id,
      f = first.flip ? -1 : 1,
      progress = ease((tick - first.born) / bp.fallTicks),
      remaining = first.fall * (1 - progress),
      geometry = rigGeometry(kind, first.variant);
    const root = bodies.find((b) => {
      const tag = b.blueprint!.rig!;
      return !tag.loose && tag.part === rootPart;
    });
    let pivot: [number, number] | null = null;
    if (root) {
      const [px, py] = rotate(first.px, first.py, root.angle);
      pivot = [root.x + px, root.y + py];
    }
    const placed = bodies
      .map((body) => {
        const tag = body.blueprint!.rig! as RemainsTag;
        let x = body.x,
          y = body.y,
          angle = body.angle;
        const turns = !tag.loose && !(bp.death === "fell" && tag.part === rootPart);
        if (pivot && turns && remaining !== 0) {
          const [dx, dy] = rotate(x - pivot[0], y - pivot[1], -remaining);
          x = pivot[0] + dx;
          y = pivot[1] + dy;
          angle -= remaining;
        }
        if (bp.death === "collapse" && !tag.loose) y += bp.hover * -tag.scale * (1 - progress);
        const layer = bp.parts.find((p) => p.id === tag.part)?.layer ?? 0;
        return { body, tag, x, y, angle, layer };
      })
      .sort((a, b) => a.layer - b.layer || (a.body.id < b.body.id ? -1 : 1));
    const expires = bodies[0].blueprint!.expiresAt ?? Infinity;
    ctx.save();
    ctx.globalAlpha = clamp((expires - tick) / 90, 0, 1);
    // Ground shadows along each part, softer once the body lies flat.
    ctx.fillStyle = "#10201933";
    for (const p of placed) {
      const g = geometry[p.tag.part];
      if (!g) continue;
      const c = Math.abs(Math.cos(p.angle)),
        s = Math.abs(Math.sin(p.angle)),
        w = (g.w * c + g.h * s) * p.tag.scale,
        h = (g.w * s + g.h * c) * p.tag.scale;
      ctx.beginPath();
      ctx.ellipse(p.body.x + 1, p.body.y + 2, w / 2 + 1, h * 0.3 + 1, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of placed) {
      const g = geometry[p.tag.part];
      if (!g) continue;
      const image = this.image(kind, p.tag.theme, p.tag.variant, p.tag.part, false);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.scale(f * p.tag.scale, p.tag.scale);
      ctx.translate(-g.cx, -g.cy);
      ctx.drawImage(image.canvas, image.x, image.y);
      ctx.restore();
    }
    if (bodies.some((b) => b.frozen)) {
      // Settled where ragdolls are off: a still marker, like a frozen prop.
      ctx.globalAlpha *= 0.3;
      ctx.strokeStyle = "#cfe6f2";
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      const cx = placed.reduce((sum, p) => sum + p.x, 0) / placed.length,
        cy = placed.reduce((sum, p) => sum + p.y, 0) / placed.length;
      ctx.arc(cx, cy, 10 + 18 * first.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
    // Emissive cores dim over the first seconds after death.
    const glow = clamp(1 - (tick - first.born) / 240, 0, 1);
    if (glow > 0)
      for (const p of placed)
        if (bp.parts.find((q) => q.id === p.tag.part)?.glow)
          light(p.x, p.y, 22 * p.tag.scale + 4, themeOf(p.tag.theme).colors[3], 0.16 * glow);
  }
}
/** Group remains bodies (and loose pieces) per dead monster, sorted by enemy id. */
export function remainsGroups(props: BodyPose[]): Map<number, BodyPose[]> {
  const groups = new Map<number, BodyPose[]>();
  for (const prop of props) {
    const tag = prop.blueprint?.rig;
    if (!tag) continue;
    const list = groups.get(tag.enemy) ?? [];
    list.push(prop);
    groups.set(tag.enemy, list);
  }
  return groups;
}
