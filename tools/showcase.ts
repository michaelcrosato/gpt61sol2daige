// M12 showcase route, headless: `npm run showcase [recipe.json]` plays a scene recipe
// (default examples/showcase.json) and prints a receipt with each beat's inputs and measured
// checks. The browser scenario e2e/showcase.spec.ts plays the same recipe with real input.
import { readFile } from "node:fs/promises";
import { initializePhysics } from "../src/physics/bootstrap.ts";
import { type BeatResult, type ShowcaseRecipe, ShowcaseRun } from "./lib/showcase.ts";

await initializePhysics();
const path = process.argv[2] ?? "examples/showcase.json";
const recipe = JSON.parse(await readFile(path, "utf8")) as ShowcaseRecipe;
const run = new ShowcaseRun(recipe);
const beats: BeatResult[] = [];
for (const beat of recipe.beats) beats.push(run.play(beat));
const ok = beats.every((b) => b.ok);
console.log(
  JSON.stringify(
    {
      milestone: "M12",
      recipe: path,
      name: recipe.name,
      seed: recipe.seed,
      area: recipe.area,
      ok,
      ticks: run.sim.tick,
      stateHash: run.sim.stateHash(),
      beats,
    },
    null,
    2,
  ),
);
run.sim.dispose();
if (!ok) process.exitCode = 1;
