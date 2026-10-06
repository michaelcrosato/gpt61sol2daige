import { type AreaRecipe, areaRecipe } from "../game/content.ts";
import {
  COMBINATIONS,
  type EncounterPlan,
  encounterExport,
  encounterPlan,
  PROFILES,
  validateEncounterPlan,
} from "../game/encounters.ts";
import { WARDENS } from "../game/wardens.ts";
import { PALETTES } from "./blueprints.ts";
import {
  ARENA_KITS,
  CLUSTERS,
  type GeneratedArea,
  generatedArea,
  KITS,
  landWorld,
  type RealizedEncounter,
  waterTerrain,
} from "./encounters.ts";
import { RULES } from "./reactions.ts";
import { solidTerrain } from "./terrain.ts";

/**
 * M11 agent operations on generated encounters: catalog, preview, validate and export. A scene
 * manifest names the selected modules, the policies its regions apply and the causal rules its
 * combinations fire, plus the two commands that rebuild it, so another agent can reproduce or
 * check it cheaply without screenshots.
 */
export interface EncounterManifest {
  version: 1;
  reproduce: { op: string; [key: string]: unknown }[];
  seed: number;
  index: number;
  theme: string;
  mechanics: string[];
  plan: EncounterPlan;
  realized: RealizedEncounter;
  policies: { id: string; profile: string; values: Record<string, unknown> }[];
  /** M08 rules (with their parameters) and M07/M10 hooks the combinations rely on. */
  rules: Record<string, unknown>;
  modules: { id: string; family: string; x: number; y: number; assembly?: string }[];
}
/** The registries, kit geometry and placement rules. */
export function encounterCatalog() {
  const kit = (k: (typeof KITS)[keyof typeof KITS]) => ({
    pieces: k.pieces.map((p) => ({ family: p.family, tag: p.tag, x: p.x, y: p.y })),
    assembly: k.assembly?.kind ?? null,
    surfaces: k.surfaces?.length ?? 0,
    fields: k.fields?.map((f) => f.kind) ?? [],
  });
  return {
    ...encounterExport(),
    kits: Object.fromEntries(Object.entries(KITS).map(([id, k]) => [id, kit(k)])),
    arenaKits: Object.fromEntries(Object.entries(ARENA_KITS).map(([id, k]) => [id, kit(k)])),
    clusterLinks: Object.fromEntries(
      Object.entries(CLUSTERS).map(([id, c]) => [id, c.links.map((l) => `${l.rule} ≤ ${l.reach}`)]),
    ),
    wardenMoves: Object.fromEntries(
      Object.values(WARDENS).map((w) => [w.move, { name: w.name, weakness: w.weakness }]),
    ),
  };
}
function rulesFor(m: RealizedEncounter): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of m.clusters)
    for (const id of COMBINATIONS[c.combo].chain)
      out[id] = Object.hasOwn(RULES, id)
        ? structuredClone(RULES[id as keyof typeof RULES])
        : { hook: id, note: "M07/M10 mechanism or showcase event" };
  return out;
}
function manifestOf(
  seed: number,
  recipe: AreaRecipe,
  plan: EncounterPlan,
  g: GeneratedArea,
): EncounterManifest {
  return {
    version: 1,
    reproduce: [
      { op: "reset", seed },
      { op: "encounter", index: recipe.index },
    ],
    seed,
    index: recipe.index,
    theme: recipe.theme,
    mechanics: [...recipe.mechanics],
    plan,
    realized: g.manifest,
    policies: g.regions.map((r) => ({
      id: r.id,
      profile: g.manifest.clusters.find((c) => c.region === r.id)?.profile ?? "",
      values: { ...r.values },
    })),
    rules: rulesFor(g.manifest),
    modules: g.content.bodies
      .filter((b) => /-\d+-(c\d+-\d+|m-|a\d+)/.test(b.id))
      .map((b) => ({
        id: b.id,
        family: b.blueprint?.family ?? "",
        x: b.x,
        y: b.y,
        ...(b.assembly ? { assembly: b.assembly } : {}),
      })),
  };
}
/** Build (without a running game) the generated area of a run seed and index. */
export function previewEncounter(seed: number, index: number, plan?: EncounterPlan) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error("seed must be an unsigned 32-bit integer");
  if (!Number.isSafeInteger(index) || index <= 8)
    throw new Error("Generated encounters start at area 9");
  const recipe = areaRecipe(seed, index);
  const chosen = plan ?? encounterPlan(recipe)!;
  const world = landWorld(seed, recipe.land),
    g = generatedArea(
      recipe,
      recipe.land % PALETTES,
      solidTerrain(world),
      chosen,
      waterTerrain(world),
    );
  return manifestOf(seed, recipe, chosen, g);
}
/**
 * Validate an edited plan or check a manifest against a fresh build. Problems are listed, never
 * thrown away: unknown references, impossible placements (overlaps, broken chain links, a
 * planned cluster that could not stand) and routes a module closed.
 */
export function validateEncounter(input: {
  seed?: number;
  index?: number;
  plan?: EncounterPlan;
  manifest?: EncounterManifest;
}): { ok: boolean; errors: string[]; warnings: string[]; manifest?: EncounterManifest } {
  const errors: string[] = [],
    warnings: string[] = [];
  const index = input.manifest?.index ?? input.plan?.index ?? input.index;
  const seed = input.manifest?.seed ?? input.seed;
  if (input.plan)
    try {
      validateEncounterPlan(input.plan);
    } catch (error) {
      errors.push((error as Error).message);
      return { ok: false, errors, warnings };
    }
  if (seed === undefined || index === undefined) {
    errors.push("seed and index (or a manifest) are required");
    return { ok: false, errors, warnings };
  }
  let manifest: EncounterManifest;
  try {
    manifest = previewEncounter(seed, index, input.plan);
  } catch (error) {
    errors.push((error as Error).message);
    return { ok: false, errors, warnings };
  }
  const r = manifest.realized;
  for (const pair of r.overlaps)
    errors.push(`impossible placement: ${pair.replace("|", " overlaps ")}`);
  for (const c of r.clusters)
    for (const l of c.links)
      if (!l.ok)
        errors.push(
          `cluster ${c.region}: ${l.rule} link ${l.from} → ${l.to} is ${l.distance} (> ${l.reach})`,
        );
  const planned = (input.plan ?? manifest.plan).clusters.length;
  if (r.clusters.length < planned)
    errors.push(
      `impossible placement: ${planned - r.clusters.length} planned cluster(s) could not stand`,
    );
  for (const route of r.routes)
    if (!route.ok) errors.push(`route to ${route.id} closed by a module`);
  for (const f of r.fallbacks) warnings.push(f);
  if (input.manifest) {
    const want = input.manifest.realized,
      got = r;
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    if (
      !same(
        want.clusters.map((c) => c.combo),
        got.clusters.map((c) => c.combo),
      )
    )
      errors.push("manifest does not reproduce: combinations differ");
    if (
      !same(
        want.clusters.map((c) => c.modules),
        got.clusters.map((c) => c.modules),
      )
    )
      errors.push("manifest does not reproduce: modules differ");
    if (!same(want.boss, got.boss)) errors.push("manifest does not reproduce: warden differs");
    if (want.bodies !== got.bodies)
      errors.push(
        `manifest does not reproduce: ${want.bodies} bodies, a fresh build has ${got.bodies}`,
      );
    for (const p of input.manifest.policies ?? [])
      if (!Object.hasOwn(PROFILES, p.profile)) errors.push(`unknown regional profile ${p.profile}`);
  }
  return { ok: errors.length === 0, errors, warnings, manifest };
}
