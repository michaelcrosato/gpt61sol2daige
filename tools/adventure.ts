import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Simulation } from "../src/engine/simulation.ts";
import { areaRecipe, BEHAVIORS, LAYOUTS, MECHANICS, RIGS, THEMES } from "../src/game/content.ts";
import { SKILLS } from "../src/game/skills.ts";
import { validateArea } from "../src/game/validation.ts";
import { initializePhysics } from "../src/physics/bootstrap.ts";
import { type RigRecipe, rigSvg } from "../src/render/rigs.ts";
import { fightArea } from "./lib/expedition-bot.ts";

await initializePhysics();

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out"),
  output = resolve(outIndex >= 0 ? args[outIndex + 1] : "artifacts/adventure");
await mkdir(output, { recursive: true });
if (args[0] === "area") {
  const recipe = areaRecipe(Number(args[2] ?? 142), Number(args[1] ?? 1));
  await writeFile(resolve(output, `area-${recipe.index}.json`), JSON.stringify(recipe, null, 2));
  console.log(JSON.stringify(recipe));
} else if (args[0] === "rig") {
  const recipe = JSON.parse(await readFile(args[1], "utf8")) as RigRecipe;
  if (
    recipe.version !== 1 ||
    !RIGS.includes(recipe.rig) ||
    !THEMES.some((theme) => theme.id === recipe.theme) ||
    !Number.isInteger(recipe.seed)
  )
    throw new Error("Invalid rig recipe");
  for (const pose of ["idle", "walk", "windup", "attack", "hurt"] as const)
    for (let frame = 0; frame < 16; frame++)
      await writeFile(
        resolve(output, `${recipe.rig}-${pose}-${frame}.svg`),
        rigSvg(recipe, pose, frame),
      );
  console.log(JSON.stringify({ ok: true, frames: 80, output }));
} else if (args[0] === "validate") {
  const recipe = JSON.parse(await readFile(args[1], "utf8"));
  validateArea(recipe);
  console.log(JSON.stringify({ ok: true, name: recipe.name }));
} else if (args[0] === "playthrough") {
  const sim = new Simulation(142, 0);
  sim.addPlayer("local");
  sim.adventure.action(sim, "local", {
    type: "tuning",
    values: { playerDamage: 2, playerHealth: 2 },
  });
  // `--reactions off`: the session master switch off for the whole run (M10 route check).
  const reactionsIndex = args.indexOf("--reactions"),
    reactions = reactionsIndex >= 0 ? args[reactionsIndex + 1] !== "off" : true;
  if (!reactions) {
    const physical = sim.physical!;
    physical.configure({
      expectedRevision: physical.world.policyState().nextRevision,
      edits: [{ type: "master", enabled: false }],
    });
    physical.world.applyPolicies(physical.world.policyState().nextRevision);
    physical.begin(sim);
  }
  const areas = Number(args[1] ?? 9),
    results: Record<string, unknown>[] = [],
    towns: Record<string, unknown>[] = [];
  if (!Number.isInteger(areas) || areas < 1 || areas > 64)
    throw new Error("Playthrough count must be an integer from 1 to 64");
  for (let index = 1; index <= areas; index++) {
    if (sim.adventure.state.mode === "town") sim.adventure.action(sim, "local", { type: "depart" });
    const result = fightArea(sim);
    const hero = sim.adventure.hero("local");
    results.push({
      area: sim.adventure.state.area,
      name: sim.adventure.state.recipe.name,
      land: sim.adventure.state.townLand,
      ...result,
      level: hero.level,
      gold: hero.gold,
      items: hero.inventory.length,
      mechanicUses: sim.adventure.state.mechanicUses,
    });
    console.log(JSON.stringify(results.at(-1)));
    if (!result.cleared) {
      process.exitCode = 1;
      break;
    }
    sim.adventure.action(sim, "local", { type: "advance" });
    if (sim.adventure.state.mode === "town") {
      // The build/loot loop through the town's services: sell spares, rest, buy what pays.
      const hero = sim.adventure.hero("local"),
        before = { gold: hero.gold, items: hero.inventory.length };
      sim.adventure.action(sim, "local", { type: "sell-spares" });
      hero.hp = 1;
      sim.adventure.action(sim, "local", { type: "rest" });
      const shop = sim.adventure.shop("local"),
        affordable = shop.findIndex((item) => item.value * 2 <= hero.gold);
      if (affordable >= 0) sim.adventure.action(sim, "local", { type: "buy", index: affordable });
      const town = {
        town: sim.adventure.state.townLand,
        name: sim.adventure.observe("local", sim.tick).town,
        rested: hero.hp === sim.adventure.stats("local").health,
        sold: before.items - hero.inventory.length + (affordable >= 0 ? 1 : 0),
        bought: affordable >= 0 ? shop[affordable].name : null,
        gold: { before: before.gold, after: hero.gold },
        fixtures: sim.physical
          ? sim.physical.world.ids().filter((id) => id.includes("-town")).length
          : 0,
      };
      towns.push(town);
      console.log(JSON.stringify(town));
    }
  }
  await writeFile(
    resolve(output, reactions ? "playthrough.json" : "playthrough-reactions-off.json"),
    JSON.stringify(
      {
        version: 1,
        seed: 142,
        reactions,
        tuning: sim.adventure.state.tuning,
        results,
        towns,
        final: sim.adventure.observe("local", sim.tick),
      },
      null,
      2,
    ),
  );
} else {
  console.log(
    JSON.stringify({
      mechanics: MECHANICS,
      themes: THEMES,
      rigs: RIGS,
      behaviors: BEHAVIORS,
      layouts: LAYOUTS,
      skills: SKILLS,
    }),
  );
}
