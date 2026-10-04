import { hash } from "../engine/math.ts";
import { type RigKind, type ThemeId, themeOf } from "../game/content.ts";
import type { Pixel } from "./sprites.ts";

export type RigPose = "idle" | "walk" | "windup" | "attack" | "hurt";
export interface RigRecipe {
  version: 1;
  rig: RigKind;
  theme: ThemeId;
  seed: number;
}
/** Shared procedural skeleton: joints, weighted limbs, layered armor, face and emissive details. */
export function monsterPixels(recipe: RigRecipe, pose: RigPose = "walk", frame = 0): Pixel[] {
  const out: Pixel[] = [],
    palette = themeOf(recipe.theme).colors;
  const c: readonly string[] =
    pose === "hurt" ? ["#5c6965", "#bdcbb0", "#e5eed0", "#fbffe9", "#eddda8"] : palette;
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    if (w > 0 && h > 0)
      out.push({ x: Math.round(x), y: Math.round(y), w: Math.ceil(w), h: Math.ceil(h), color });
  };
  const limb = (x1: number, y1: number, x2: number, y2: number, width: number, color: string) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 2));
    for (let i = 0; i <= steps; i++)
      rect(
        x1 + ((x2 - x1) * i) / steps - width / 2,
        y1 + ((y2 - y1) * i) / steps - width / 2,
        width,
        width,
        color,
      );
  };
  const blob = (x: number, y: number, rx: number, ry: number, color: string) => {
    for (let row = -ry; row <= ry; row += 2) {
      const width = Math.sqrt(Math.max(0, 1 - (row / ry) ** 2)) * rx;
      rect(x - width, y + row, width * 2, 2, color);
    }
  };
  const phase = (frame / 16) * Math.PI * 2,
    moving = pose === "walk",
    step = moving ? Math.sin(phase) * 3 : Math.sin(phase) * 0.5;
  const lift = pose === "windup" ? 8 + frame / 3 : pose === "attack" ? -5 : 0;
  const variation = hash(recipe.seed, 45) % 4;
  if (recipe.rig === "crawler") {
    for (let side = -1; side <= 1; side += 2)
      for (let leg = 0; leg < 3; leg++) {
        const y = -5 - leg * 5,
          move = moving ? Math.sin(phase + leg * 2) * 4 : 0;
        limb(side * 7, y, side * (17 + leg), y - 3 + move, 3, c[0]);
        limb(side * (17 + leg), y - 3 + move, side * (21 - leg), y + 7, 2, c[1]);
      }
    blob(0, -13 - lift * 0.25, 14, 10, c[0]);
    blob(-1, -15 - lift * 0.25, 11, 8, c[1]);
    blob(-3, -18 - lift * 0.25, 7, 5, c[2]);
    for (let i = 0; i < 3; i++) rect(-9 + i * 6, -22, 2, 15, c[0]);
    blob(2, -6 - lift * 0.2, 7, 5, c[1]);
    rect(-2, -8, 3, 2, c[3]);
    rect(6, -8, 3, 2, c[3]);
    rect(2, -3, 4, 3, c[4]);
    limb(-6, -20, -11, -30 + step, 1, c[2]);
    limb(6, -20, 13, -29 - step, 1, c[2]);
    rect(-12, -31 + step, 3, 2, c[3]);
    rect(12, -30 - step, 3, 2, c[3]);
  } else if (recipe.rig === "stalker") {
    limb(-6, -7, -9 - step, 2, 4, c[0]);
    limb(7, -8, 10 + step, 2, 4, c[0]);
    rect(-13 - step, 1, 7, 3, c[2]);
    rect(8 + step, 1, 7, 3, c[2]);
    blob(0, -15 + step * 0.2, 11, 13, c[0]);
    blob(-2, -17 + step * 0.2, 8, 10, c[1]);
    rect(-5, -21, 8, 5, c[2]);
    limb(-9, -19, -15, -6 - lift, 4, c[1]);
    limb(9, -20, 16, -5 - lift, 4, c[1]);
    for (let i = 0; i < 3; i++) {
      rect(-18 + i * 2, -7 - lift, 1, 5, c[4]);
      rect(14 + i * 2, -7 - lift, 1, 5, c[4]);
    }
    blob(1, -30 - lift * 0.1, 8, 8, c[1]);
    rect(-5, -34, 13, 6, c[2]);
    rect(-4, -29, 4, 2, c[3]);
    rect(5, -29, 3, 2, c[3]);
    rect(0, -24, 8, 3, c[0]);
    rect(1, -24, 2, 4, c[4]);
    rect(5, -24, 1, 3, c[4]);
    limb(-5, -35, -10, -43 - variation, 3, c[1]);
    limb(5, -35, 10, -44 - variation, 3, c[2]);
    rect(-12, -44 - variation, 4, 3, c[2]);
  } else if (recipe.rig === "brute" || recipe.rig === "warden") {
    const warden = recipe.rig === "warden";
    limb(-8, -12, -10 - step, 1, 7, c[0]);
    limb(9, -12, 10 + step, 1, 7, c[1]);
    rect(-16 - step, 0, 10, 5, c[2]);
    rect(8 + step, 0, 11, 5, c[2]);
    blob(0, -26 + step * 0.3, warden ? 15 : 18, 19, c[0]);
    blob(-2, -28 + step * 0.3, warden ? 12 : 15, 16, c[1]);
    for (let i = 0; i < 4; i++) {
      rect(-12 + i * 7, -35 + (i % 2) * 2, 5, 18 - (i % 2) * 4, c[2]);
      rect(-12 + i * 7, -35, 5, 2, c[3]);
    }
    blob(-18, -34, 8, 8, c[1]);
    blob(19, -34, 8, 8, c[2]);
    limb(-18, -30, -24, -13 - lift, 8, c[0]);
    limb(19, -30, 25, -11 - lift, 8, c[1]);
    rect(-30, -16 - lift, 12, 10, c[1]);
    rect(-28, -17 - lift, 9, 3, c[2]);
    rect(20, -14 - lift, 12, 10, c[2]);
    for (let i = 0; i < 3; i++) {
      rect(-28 + i * 3, -8 - lift, 2, 4, c[4]);
      rect(22 + i * 3, -7 - lift, 2, 4, c[4]);
    }
    blob(1, -47, 10, 10, c[0]);
    rect(-7, -55, 15, 13, c[1]);
    rect(-6, -56, 7, 7, c[2]);
    rect(-5, -48, 4, 3, c[3]);
    rect(4, -48, 4, 3, c[3]);
    rect(-3, -42, 10, 3, c[0]);
    rect(-1, -42, 2, 4, c[4]);
    rect(4, -42, 2, 4, c[4]);
    for (const side of [-1, 1]) {
      limb(side * 7, -52, side * (14 + variation), -65, 3, c[2]);
      limb(side * 13, -61, side * 22, -64, 2, c[4]);
      rect(side < 0 ? -25 : 22, -66, 3, 4, c[3]);
    }
    if (warden) {
      rect(-3, -31, 7, 11, c[0]);
      rect(-1, -30, 3, 8, c[3]);
      rect(-4, -27, 9, 2, c[3]);
    }
    for (let i = 0; i < 10; i++) {
      const h = hash(i, recipe.seed);
      rect((h % 28) - 14, -37 + ((h >>> 8) % 22), 2, 3, c[(h >>> 15) % 3]);
    }
  } else if (recipe.rig === "wraith") {
    const bob = Math.sin(phase) * 2;
    for (let i = 0; i < 5; i++) {
      const dx = -9 + i * 5;
      limb(
        dx,
        -15 + bob,
        dx + Math.sin(phase + i) * 5,
        2 + Math.cos(phase + i) * 4,
        4 - (i % 2),
        c[i % 2],
      );
    }
    blob(0, -24 + bob, 12, 16, c[0]);
    blob(-2, -27 + bob, 9, 13, c[1]);
    rect(-7, -34 + bob, 15, 8, c[2]);
    rect(-6, -28 + bob, 12, 5, c[0]);
    rect(-4, -27 + bob, 3, 2, c[3]);
    rect(3, -27 + bob, 3, 2, c[3]);
    rect(-3, -21 + bob, 7, 9, c[2]);
    rect(-1, -20 + bob, 3, 7, c[3]);
    limb(-10, -22 + bob, -21, -25 - lift + Math.sin(phase) * 3, 3, c[1]);
    limb(11, -22 + bob, 23, -27 - lift - Math.sin(phase) * 3, 3, c[2]);
    rect(-24, -29 - lift, 4, 4, c[3]);
    rect(21, -31 - lift, 4, 4, c[3]);
  } else {
    for (let i = 0; i < 5; i++) limb(0, -8, -22 + i * 11, 4 + Math.sin(phase + i) * 2, 4, c[0]);
    rect(-9, -39, 19, 38, c[0]);
    rect(-7, -41, 14, 36, c[1]);
    rect(-6, -40, 4, 30, c[2]);
    rect(-10, -28, 23, 4, c[0]);
    rect(-9, -42, 20, 5, c[2]);
    rect(-6, -37, 13, 10, c[0]);
    rect(-4, -34, 3, 3, c[3]);
    rect(3, -34, 3, 3, c[3]);
    rect(-2, -24, 6, 16, c[3]);
    rect(-7, -20, 16, 3, c[2]);
    rect(0, -22, 2, 11, c[4]);
    limb(-7, -24, -22, -30 - lift, 4, c[1]);
    limb(8, -24, 23, -29 - lift, 4, c[1]);
    rect(-23, -35 - lift, 4, 7, c[3]);
    rect(21, -34 - lift, 4, 7, c[3]);
    for (let i = 0; i < 3; i++) {
      rect(-8 + i * 8, -48 - (i % 2) * 6, 3, 8, c[2]);
      rect(-8 + i * 8, -50 - (i % 2) * 6, 3, 3, c[3]);
    }
  }
  return out;
}
export function rigSvg(recipe: RigRecipe, pose: RigPose = "walk", frame = 0): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-44 -76 88 88" width="176" height="176" shape-rendering="crispEdges">${monsterPixels(
    recipe,
    pose,
    frame,
  )
    .map((p) => `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="${p.color}"/>`)
    .join("")}</svg>`;
}
