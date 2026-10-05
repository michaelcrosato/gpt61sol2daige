import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MATERIAL_SOUNDS, type SoundName, synthesize, wav } from "../src/audio/synth.ts";
import { CHUNK_TILES, World } from "../src/engine/world.ts";
import { type SpriteRecipe, spriteSvg, validateRecipe } from "../src/render/sprites.ts";

const args = process.argv.slice(2),
  output = resolve(args[args.indexOf("--out") + 1] ?? "public/generated");
const out = args.includes("--out") ? output : resolve("public/generated");
await mkdir(out, { recursive: true });
if (args[0] === "sprite") {
  const recipe = validateRecipe(JSON.parse(await readFile(args[1], "utf8")));
  for (let frame = 0; frame < 8; frame++)
    await writeFile(resolve(out, `${recipe.kind}-${frame}.svg`), spriteSvg(recipe, frame));
} else if (args[0] === "level") {
  const recipe = JSON.parse(await readFile(args[1], "utf8")) as {
    version: number;
    seed: number;
    brushes: {
      tx: number;
      ty: number;
      width: number;
      height: number;
      terrain: number;
      decor?: number;
    }[];
  };
  if (
    recipe.version !== 1 ||
    !Number.isInteger(recipe.seed) ||
    !Array.isArray(recipe.brushes) ||
    recipe.brushes.length > 100
  )
    throw new Error("Invalid level recipe");
  const world = new World(recipe.seed);
  for (const b of recipe.brushes)
    world.paint(b.tx, b.ty, b.width, b.height, b.terrain, b.decor ?? 0);
  await writeFile(
    resolve(out, "level.json"),
    JSON.stringify({ version: 1, seed: world.seed, patches: [...world.patches.values()] }, null, 2),
  );
  const palette = ["#304f39", "#486747", "#818164", "#34666a", "#294f59", "#8a8766", "#6a7662"];
  let shapes = "";
  for (let y = -24; y < 24; y++)
    for (let x = -24; x < 24; x++)
      shapes += `<rect x="${(x + 24) * 8}" y="${(y + 24) * 8}" width="8" height="8" fill="${palette[world.sample(x, y).terrain]}"/>`;
  await writeFile(
    resolve(out, "level-preview.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" width="384" height="384" shape-rendering="crispEdges">${shapes}</svg>`,
  );
} else if (args[0] === "chunk") {
  const world = new World(Number(args[3] ?? 142)),
    cx = Number(args[1] ?? 0),
    cy = Number(args[2] ?? 0);
  if (![cx, cy].every(Number.isInteger)) throw new Error("Chunk coordinates must be integers");
  const chunk = world.getChunk(cx, cy);
  await writeFile(
    resolve(out, `chunk-${cx}-${cy}.json`),
    JSON.stringify(
      {
        version: 1,
        seed: world.seed,
        cx,
        cy,
        size: CHUNK_TILES,
        tiles: [...chunk.tiles],
        decor: [...chunk.decor],
        variants: [...chunk.variants],
      },
      null,
      2,
    ),
  );
} else {
  const kinds: SpriteRecipe["kind"][] = [
    "pine",
    "oak",
    "player",
    "deer",
    "wisp",
    "beetle",
    "rock",
    "crystal",
  ];
  for (const kind of kinds)
    for (let frame = 0; frame < 8; frame++)
      await writeFile(
        resolve(out, `${kind}-${frame}.svg`),
        spriteSvg({ version: 1, kind, seed: 142 }, frame),
      );
  const sounds: SoundName[] = [
    "pulse",
    "shard",
    "beacon",
    "dash",
    "step",
    "ambient",
    "slash",
    "hit",
    "hurt",
    "level",
    ...MATERIAL_SOUNDS,
    "crumble",
  ];
  for (const sound of sounds) await writeFile(resolve(out, `${sound}.wav`), wav(synthesize(sound)));
  await writeFile(
    resolve(out, "manifest.json"),
    JSON.stringify(
      {
        version: 1,
        seed: 142,
        sprites: kinds.map((kind) => ({
          kind,
          frames: 8,
          files: Array.from({ length: 8 }, (_, i) => `${kind}-${i}.svg`),
        })),
        audio: sounds.map((s) => `${s}.wav`),
      },
      null,
      2,
    ),
  );
}
console.log(JSON.stringify({ ok: true, output: out }));
