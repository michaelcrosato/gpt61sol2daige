import { hash, random } from "../engine/math.ts";

export const THEMES = [
  {
    id: "verdant",
    name: "The Verdant March",
    town: "Mosslight Hollow",
    colors: ["#173f34", "#3f7853", "#7fba77", "#dceda6", "#e6b578"],
    ground: ["#304f39", "#486747", "#818164", "#34666a", "#294f59", "#8a8766", "#6a7662"],
  },
  {
    id: "cinder",
    name: "The Cinderwild",
    town: "Emberrest",
    colors: ["#382e38", "#77474a", "#be7453", "#ffd298", "#e89c62"],
    ground: ["#453f38", "#5c5040", "#9a7d54", "#65534d", "#483e49", "#9a815a", "#786b57"],
  },
  {
    id: "glass",
    name: "The Glasswater Reach",
    town: "Tideglass Haven",
    colors: ["#223d52", "#436d88", "#79b3bf", "#c4f3e0", "#dac69a"],
    ground: ["#304e4b", "#456b5e", "#8e9d8a", "#397d85", "#2d566c", "#a5ab87", "#768e87"],
  },
  {
    id: "dusk",
    name: "The Violet Fallow",
    town: "Duskmere",
    colors: ["#362f4a", "#675174", "#a281b0", "#e4bee0", "#dfb786"],
    ground: ["#404044", "#56564f", "#8b8277", "#555b77", "#373b5c", "#969076", "#787b75"],
  },
  {
    id: "frost",
    name: "The Pale Orchard",
    town: "Frostwake",
    colors: ["#324753", "#688b91", "#aac9bf", "#eff3d6", "#c9b687"],
    ground: ["#52695c", "#6c8270", "#a7b2a0", "#527887", "#3c5f76", "#a9ad8c", "#879f92"],
  },
] as const;
export type ThemeId = (typeof THEMES)[number]["id"];
export const themeOf = (id: ThemeId) => THEMES.find((theme) => theme.id === id) ?? THEMES[0];
export const MECHANICS = [
  {
    id: "bramble",
    name: "Brambleburst",
    icon: "✹",
    color: "#c1df83",
    description: "Strike a seedpod to burst thorns through a pack and root survivors.",
    advantage: "Group enemies around pods for fast chain clears.",
  },
  {
    id: "wind",
    name: "Slipstream",
    icon: "➶",
    color: "#aae2c9",
    description: "Cross the wind lanes to gain haste and recover spirit.",
    advantage: "Link lanes and dashes to race between packs.",
  },
  {
    id: "glass",
    name: "Stormglass",
    icon: "ϟ",
    color: "#9cd9e9",
    description: "Strike a glass pylon to arc lightning between nearby enemies.",
    advantage: "Dense packs multiply every activation's damage.",
  },
  {
    id: "echo",
    name: "Echo Wells",
    icon: "◎",
    color: "#b2b6eb",
    description: "Cast near a well to repeat your ability a moment later at no spirit cost.",
    advantage: "Time a double cast as enemies enter the well.",
  },
  {
    id: "cinder",
    name: "Cinderwake",
    icon: "♨",
    color: "#f3b67d",
    description: "Cross a warm vent for burning strikes. Stay too long and it burns you too.",
    advantage: "Take the buff, dash out, and spread fire through a pack.",
  },
  {
    id: "blood",
    name: "Bloodbloom",
    icon: "✧",
    color: "#e29aab",
    description: "Interact with a bloom: trade a little life for greater damage and experience.",
    advantage: "Convert spare healing into faster levels.",
  },
  {
    id: "gravity",
    name: "Gravity Knots",
    icon: "⊙",
    color: "#ba9fe3",
    description: "Strike a knot to pull monsters together before an area attack.",
    advantage: "Gather scattered archers and finish them with one combo.",
  },
  {
    id: "rift",
    name: "Riftstep",
    icon: "◇",
    color: "#8fe6c7",
    description: "Interact with an arch to blink to its partner and release an arrival shockwave.",
    advantage: "Skip the long route and hit the next pack immediately.",
  },
] as const;
export type MechanicId = (typeof MECHANICS)[number]["id"];
export const mechanicOf = (id: MechanicId) => MECHANICS.find((mechanic) => mechanic.id === id)!;
export const RIGS = ["crawler", "stalker", "brute", "wraith", "totem", "warden"] as const;
export type RigKind = (typeof RIGS)[number];
export const BEHAVIORS = [
  "hunter",
  "charger",
  "spitter",
  "orbiter",
  "summoner",
  "sentinel",
] as const;
export type BehaviorId = (typeof BEHAVIORS)[number];
export const ARCHETYPES: Record<
  BehaviorId,
  {
    name: string;
    hp: number;
    damage: number;
    speed: number;
    range: number;
    windup: number;
    cooldown: number;
    rig: RigKind;
  }
> = {
  hunter: {
    name: "Briarling",
    hp: 32,
    damage: 9,
    speed: 65,
    range: 23,
    windup: 24,
    cooldown: 70,
    rig: "stalker",
  },
  charger: {
    name: "Barkmaw",
    hp: 54,
    damage: 15,
    speed: 46,
    range: 145,
    windup: 44,
    cooldown: 145,
    rig: "brute",
  },
  spitter: {
    name: "Sporecaster",
    hp: 27,
    damage: 11,
    speed: 38,
    range: 230,
    windup: 38,
    cooldown: 105,
    rig: "crawler",
  },
  orbiter: {
    name: "Lantern Wraith",
    hp: 24,
    damage: 8,
    speed: 82,
    range: 155,
    windup: 28,
    cooldown: 92,
    rig: "wraith",
  },
  summoner: {
    name: "Rootcaller",
    hp: 65,
    damage: 10,
    speed: 25,
    range: 240,
    windup: 70,
    cooldown: 300,
    rig: "totem",
  },
  sentinel: {
    name: "Thorn Guard",
    hp: 80,
    damage: 18,
    speed: 33,
    range: 46,
    windup: 55,
    cooldown: 130,
    rig: "warden",
  },
};
export const LAYOUTS = ["grove", "crossroads", "rings", "terraces", "causeway", "orchard"] as const;
export type LayoutId = (typeof LAYOUTS)[number];
export interface AreaRecipe {
  version: 1;
  index: number;
  land: number;
  seed: number;
  landSeed: number;
  name: string;
  theme: ThemeId;
  layout: LayoutId;
  x: number;
  y: number;
  radius: number;
  signature: MechanicId;
  mechanics: MechanicId[];
  combination: { from: MechanicId; into: MechanicId } | null;
  behaviors: BehaviorId[];
  rigs: RigKind[];
  killGoal: number;
  boss: string;
  bossBehavior: BehaviorId;
  power: number;
  procedural: boolean;
}
const BOSSES = [
  "Brambleheart",
  "The Gale Stag",
  "Vyr, Glasskeeper",
  "The Echo Matron",
  "Cinderjaw",
  "The Bloom Tyrant",
  "The Hollow Atlas",
  "The Riftbound King",
];
export function areaRecipe(seed: number, index: number): AreaRecipe {
  if (!Number.isSafeInteger(index) || index < 1)
    throw new Error("Area must be a positive safe integer");
  const land = Math.floor((index - 1) / 4),
    local = (index - 1) % 4;
  const areaSeed = hash(index, Math.floor(index / 4294967296), seed);
  const landSeed = land === 0 ? seed >>> 0 : hash(land, Math.floor(land / 4294967296), seed + 927);
  const theme = THEMES[land % THEMES.length].id;
  const primary = MECHANICS[index <= 8 ? index - 1 : areaSeed % MECHANICS.length].id;
  const mechanics: MechanicId[] = [primary];
  if (index > 1) mechanics.push(MECHANICS[index <= 8 ? index - 2 : (areaSeed + 3) % 8].id);
  if (index > 5) mechanics.push(MECHANICS[(areaSeed + 5) % 8].id);
  const unique = [...new Set(mechanics)];
  const prefixes = ["Resonant", "Surging", "Wild", "Shattered", "Overgrown", "Ravenous"];
  return {
    version: 1,
    index,
    land,
    seed: areaSeed,
    landSeed,
    name:
      index <= 8
        ? mechanicOf(primary).name
        : `${prefixes[(areaSeed >>> 8) % prefixes.length]} ${mechanicOf(primary).name}`,
    theme,
    layout: LAYOUTS[(index - 1) % LAYOUTS.length],
    x: 720 + local * 730,
    y: [0, -260, 180, -180][local],
    radius: 350,
    signature: primary,
    mechanics: unique,
    combination: index > 8 && unique.length > 1 ? { from: primary, into: unique[1] } : null,
    behaviors: [
      ...new Set<BehaviorId>([
        "hunter",
        BEHAVIORS[(index + 1) % 6],
        BEHAVIORS[(areaSeed >>> 5) % 6],
      ]),
    ],
    rigs:
      index <= 8
        ? ["stalker", "crawler", "brute"]
        : [
            ...new Set<RigKind>([
              RIGS[areaSeed % 6],
              RIGS[(areaSeed + 3) % 6],
              RIGS[(areaSeed + 5) % 6],
            ]),
          ],
    killGoal: Math.min(48, 12 + index * 3),
    boss:
      index <= 8
        ? BOSSES[index - 1]
        : `${themeOf(theme).name.replace("The ", "").split(" ")[0]} ${["Harbinger", "Colossus", "Usurper", "Sovereign"][(areaSeed >>> 10) % 4]}`,
    bossBehavior: BEHAVIORS[(index + 4) % 6],
    power: 1 + Math.min(index - 1, 100) * 0.17 + Math.log2(Math.max(1, index - 99)) * 1.6,
    procedural: index > 8,
  };
}
export function townName(land: number): string {
  const name = THEMES[land % THEMES.length].town;
  return land < THEMES.length ? name : `${name} ${Math.floor(land / THEMES.length) + 1}`;
}
export const TOWN_NPCS = [
  {
    id: "rowan",
    name: "Rowan",
    role: "Quartermaster",
    service: "shop",
    x: -106,
    y: -28,
    color: "#ddbb82",
    rig: "merchant",
  },
  {
    id: "iona",
    name: "Iona",
    role: "Apothecary",
    service: "rest",
    x: 92,
    y: -42,
    color: "#a6c6c4",
    rig: "healer",
  },
  {
    id: "orin",
    name: "Orin",
    role: "Waykeeper",
    service: "gate",
    x: 165,
    y: 24,
    color: "#bacb8d",
    rig: "keeper",
  },
] as const;
export const npcPosition = (npc: (typeof TOWN_NPCS)[number], tick: number) => ({
  x: npc.x + Math.sin(tick / 160 + npc.x) * 5,
  y: npc.y + Math.sin(tick / 220 + npc.y) * 3,
});
/**
 * Where an area's mechanics stand: three of each kind on a ring around the clearing (the k-th
 * kind on a wider ring, turned a little further). Gameplay creates its mechanics here and the
 * M10 physical set pieces are authored around the same points.
 */
export function mechanicLayout(
  recipe: Pick<AreaRecipe, "x" | "y" | "mechanics">,
): { kind: MechanicId; k: number; n: number; x: number; y: number; radius: number }[] {
  const out: { kind: MechanicId; k: number; n: number; x: number; y: number; radius: number }[] =
    [];
  for (let k = 0; k < recipe.mechanics.length; k++)
    for (let n = 0; n < 3; n++) {
      const angle = (n / 3 + k * 0.18) * Math.PI * 2;
      out.push({
        kind: recipe.mechanics[k],
        k,
        n,
        x: recipe.x + Math.cos(angle) * (125 + k * 42),
        y: recipe.y + Math.sin(angle) * (125 + k * 42),
        radius: recipe.mechanics[k] === "wind" ? 38 : 25,
      });
    }
  return out;
}
export function encounterPosition(recipe: AreaRecipe, ordinal: number): { x: number; y: number } {
  const angle = random(ordinal, 47, recipe.seed) * Math.PI * 2;
  const radius = 100 + Math.sqrt(random(ordinal, 65, recipe.seed)) * 205;
  return { x: recipe.x + Math.cos(angle) * radius, y: recipe.y + Math.sin(angle) * radius };
}
