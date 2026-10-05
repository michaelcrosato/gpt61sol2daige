import { hash } from "../engine/math.ts";

export type Pixel = { x: number; y: number; w: number; h: number; color: string };
export interface SpriteRecipe {
  version: 1;
  kind: "pine" | "oak" | "deer" | "wisp" | "beetle" | "player" | "rock" | "crystal";
  seed: number;
  palette?: string[];
}
export const PALETTE = {
  pine: ["#193c33", "#225341", "#306449", "#427c53", "#6a985d"],
  oak: ["#24462e", "#365c36", "#4c7240", "#6e8c4b", "#96a360"],
  player: ["#233d3b", "#567b70", "#b9cec0", "#e4b981", "#e9d6a0"],
};

/** A sprite is a recipe plus a frame number, shared by browser rendering and the CLI SVG atlas. */
export function spritePixels(
  recipe: SpriteRecipe,
  frame = 0,
  /** M09: the wayfarer's lantern can be drawn separately, as a swinging part. */
  options: { lantern?: boolean } = {},
): Pixel[] {
  const out: Pixel[] = [];
  const rect = (x: number, y: number, w: number, h: number, color: string) =>
    out.push({ x, y, w, h, color });
  const palette = recipe.palette;
  if (recipe.kind === "pine") {
    const c = palette ?? PALETTE.pine;
    rect(-2, -12, 4, 15, "#63533d");
    rect(1, -8, 2, 10, "#84724d");
    for (let layer = 0; layer < 4; layer++) {
      const width = 15 - layer * 3,
        y = -12 - layer * 9;
      for (let row = 0; row < 7; row++) {
        const half = Math.round(width * (1 - row / 9));
        rect(-half, y - row * 2, half * 2 + 1, 2, c[(row + layer) % 3]);
        rect(-half, y - row * 2, Math.max(2, half - 2), 1, c[3]);
        if (row % 3 === 0) rect(-half + 2, y - row * 2, 4, 1, c[4]);
      }
    }
  } else if (recipe.kind === "oak") {
    const c = palette ?? PALETTE.oak;
    rect(-3, -20, 6, 22, "#544b37");
    rect(-1, -14, 2, 15, "#8c7950");
    rect(-6, -22, 4, 11, "#63583b");
    const clusters = [
      [-12, -28, 13],
      [9, -27, 14],
      [0, -39, 14],
      [-3, -26, 14],
    ];
    for (let k = 0; k < clusters.length; k++) {
      const [cx, cy, r] = clusters[k];
      for (let y = -r; y <= r; y += 2) {
        const w = Math.floor(Math.sqrt(r * r - y * y));
        rect(cx - w, cy + y, w * 2, 2, c[y < -3 ? 2 : 1]);
        if (w > 4) rect(cx - w + 2, cy + y, w, 1, c[y < 1 ? 3 : 2]);
      }
      for (let i = 0; i < 24; i++) {
        const h = hash(i, k, recipe.seed);
        const x = (h & 31) - 16,
          y = ((h >>> 5) & 31) - 16;
        if (x * x + y * y < r * r) rect(cx + x, cy + y, 2 + (h & 1), 1, c[(h >>> 10) % c.length]);
      }
    }
  } else if (recipe.kind === "player") {
    const c = palette ?? PALETTE.player,
      walk = Math.round(Math.sin((frame * Math.PI) / 4) * 2);
    rect(-4, -3 + walk, 3, 5, "#24352f");
    rect(2, -3 - walk, 3, 5, "#24352f");
    rect(-6, -13, 12, 12, c[0]);
    rect(-7, -9, 14, 7, c[1]);
    rect(-5, -14, 9, 8, c[2]);
    rect(-5, -9, 3, 9, c[1]);
    rect(-3, -20, 8, 9, c[1]);
    rect(-1, -17, 6, 5, c[3]);
    rect(4, -17, 1, 2, "#36483e");
    rect(-4, -22, 10, 5, c[2]);
    rect(-5, -20, 12, 2, c[2]);
    rect(6, -9, 3, 5, c[3]);
    if (options.lantern !== false) {
      rect(8, -7, 4, 5, "#6e6349");
      rect(9, -6, 2, 3, c[4]);
    }
  } else if (recipe.kind === "deer") {
    const walk = Math.round(Math.sin((frame * Math.PI) / 4) * 2);
    rect(-6, -7, 12, 7, "#987f57");
    rect(-5, -8, 10, 3, "#c1a974");
    rect(-5, -1, 2, 4 + walk, "#62533e");
    rect(3, -1, 2, 4 - walk, "#62533e");
    rect(3, -13, 5, 8, "#c1a974");
    rect(4, -14, 5, 3, "#d3bc82");
    rect(7, -12, 1, 1, "#283f32");
    rect(2, -17, 1, 5, "#d8cda5");
    rect(6, -18, 1, 5, "#d8cda5");
    rect(0, -17, 3, 1, "#d8cda5");
    rect(-7, -9, 2, 4, "#dfd4a0");
  } else if (recipe.kind === "wisp") {
    const bob = Math.round(Math.sin((frame * Math.PI) / 4) * 2);
    rect(-3, -8 + bob, 6, 4, "#68b9a5");
    rect(-2, -9 + bob, 4, 6, "#b4e1ba");
    rect(-1, -8 + bob, 2, 3, "#f0f1c9");
    rect(-1, -3 + bob, 2, 2, "#6aaf98");
  } else if (recipe.kind === "beetle") {
    rect(-4, -4, 8, 4, "#325b5c");
    rect(-3, -5, 6, 3, "#79a39a");
    rect(-1, -5, 1, 5, "#385757");
    rect(-5, -1, 2, 1, "#233b33");
    rect(3, -1, 2, 1, "#233b33");
  } else if (recipe.kind === "rock") {
    rect(-7, -4, 14, 6, "#394e43");
    rect(-5, -8, 10, 9, "#667465");
    rect(-4, -9, 7, 4, "#8b9780");
    rect(-3, -8, 6, 1, "#a7ad8c");
    rect(-7, -1, 7, 3, "#527344");
  } else {
    rect(-3, -12, 6, 13, "#5ca795");
    rect(-2, -15, 3, 15, "#a4dac3");
    rect(-1, -12, 2, 11, "#d0edcf");
    rect(3, -7, 3, 8, "#78baa2");
    rect(-6, -5, 3, 6, "#78baa2");
  }
  return out;
}
export function validateRecipe(value: unknown): SpriteRecipe {
  if (!value || typeof value !== "object") throw new Error("Expected a sprite recipe");
  const r = value as SpriteRecipe;
  if (
    r.version !== 1 ||
    !["pine", "oak", "deer", "wisp", "beetle", "player", "rock", "crystal"].includes(r.kind) ||
    !Number.isInteger(r.seed)
  )
    throw new Error("Invalid sprite recipe");
  if (
    r.palette &&
    (r.palette.length < 5 ||
      r.palette.length > 16 ||
      r.palette.some((c) => !/^#[0-9a-f]{6}$/i.test(c)))
  )
    throw new Error("Palette must contain 5–16 hex colors");
  return r;
}
export function spriteSvg(recipe: SpriteRecipe, frame = 0): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="-32 -56 64 64" shape-rendering="crispEdges">${spritePixels(
    recipe,
    frame,
  )
    .map((p) => `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="${p.color}"/>`)
    .join("")}</svg>`;
}
