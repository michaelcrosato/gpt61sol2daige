import { hash, random } from "../engine/math.ts";
import type { StatId } from "./skills.ts";

export const SLOTS = ["weapon", "armor", "boots", "charm"] as const;
export type GearSlot = (typeof SLOTS)[number];
export const RARITIES = ["common", "magic", "rare", "legendary"] as const;
export type Rarity = (typeof RARITIES)[number];
export const RARITY_COLORS: Record<Rarity, string> = {
  common: "#c3cfb9",
  magic: "#8fc7e6",
  rare: "#e4cf84",
  legendary: "#eaa16a",
};
export interface Item {
  id: string;
  name: string;
  slot: GearSlot;
  rarity: Rarity;
  level: number;
  power: number;
  affixes: { stat: StatId; value: number }[];
  special: "none" | "thornburst" | "echo" | "ward" | "gale";
  value: number;
}
const BASE_NAMES: Record<GearSlot, string[]> = {
  weapon: ["Wayblade", "Briar Sabre", "Glassfang", "Rootcutter"],
  armor: ["Mossweave", "Thorn Mantle", "Barkplate", "Warden's Coat"],
  boots: ["Trailstrides", "Windwalkers", "Rootbound Treads", "Miststeps"],
  charm: ["Lanternseed", "Ember Tear", "Storm Acorn", "Bloom Sigil"],
};
const PREFIXES = [
  "Keen",
  "Verdant",
  "Hollow",
  "Vigorous",
  "Gilded",
  "Quick",
  "Ancient",
  "Resonant",
];
const LEGENDARY = [
  "The Last Lantern",
  "Thorn of the First Grove",
  "A Hundred Springtimes",
  "The Storm Remembers",
];
const AFFIXES: { stat: StatId; base: number }[] = [
  { stat: "damage", base: 0.055 },
  { stat: "life", base: 12 },
  { stat: "speed", base: 0.025 },
  { stat: "haste", base: 0.03 },
  { stat: "crit", base: 0.018 },
  { stat: "armor", base: 7 },
  { stat: "regen", base: 0.25 },
  { stat: "leech", base: 0.5 },
  { stat: "cooldown", base: 0.025 },
  { stat: "gold", base: 0.06 },
  { stat: "xp", base: 0.05 },
  { stat: "luck", base: 0.025 },
  { stat: "burn", base: 0.06 },
  { stat: "critPower", base: 0.08 },
];
export function rollItem(
  seed: number,
  ordinal: number,
  level: number,
  luck = 0,
  guaranteed?: Rarity,
  slot?: GearSlot,
): Item {
  level = Math.max(1, Math.min(1_000_000, Math.floor(level)));
  const value = random(ordinal, 200, seed) + Math.min(0.3, luck);
  const rarity: Rarity =
    guaranteed ??
    (value > 0.985 ? "legendary" : value > 0.79 ? "rare" : value > 0.34 ? "magic" : "common");
  const rarityIndex = RARITIES.indexOf(rarity),
    gearSlot = slot ?? SLOTS[hash(ordinal, 11, seed) % 4];
  const strength = 1 + Math.min(level, 100) * 0.08 + Math.log2(Math.max(1, level - 99)) * 0.6;
  const chosen = new Set<number>(),
    affixes: Item["affixes"] = [];
  for (let i = 0; i <= rarityIndex; i++) {
    let index = hash(ordinal, i + 22, seed) % AFFIXES.length;
    while (chosen.has(index)) index = (index + 1) % AFFIXES.length;
    chosen.add(index);
    const affix = AFFIXES[index];
    affixes.push({
      stat: affix.stat,
      value:
        Math.round(affix.base * strength * (0.85 + random(ordinal, i + 50, seed) * 0.5) * 1000) /
        1000,
    });
  }
  const power = Math.round(
    (gearSlot === "weapon" ? 12 : gearSlot === "armor" ? 8 : 3) *
      strength *
      (1 + rarityIndex * 0.17),
  );
  const special =
    rarity === "legendary"
      ? (["thornburst", "echo", "ward", "gale"] as const)[hash(ordinal, 90, seed) % 4]
      : "none";
  return {
    id: `item-${seed.toString(36)}-${ordinal.toString(36)}`,
    name:
      rarity === "legendary"
        ? LEGENDARY[hash(ordinal, 91, seed) % 4]
        : `${rarityIndex ? `${PREFIXES[hash(ordinal, 92, seed) % PREFIXES.length]} ` : ""}${BASE_NAMES[gearSlot][hash(ordinal, 93, seed) % 4]}`,
    slot: gearSlot,
    rarity,
    level,
    power,
    affixes,
    special,
    value: Math.floor(12 + level * 2 + power * (rarityIndex + 1)),
  };
}
export function starterItems(): Item[] {
  return [
    {
      id: "starter-blade",
      name: "Wayfarer's Edge",
      slot: "weapon",
      rarity: "common",
      level: 1,
      power: 15,
      affixes: [{ stat: "haste", value: 0.05 }],
      special: "none",
      value: 0,
    },
    {
      id: "starter-coat",
      name: "The Familiar Cloak",
      slot: "armor",
      rarity: "common",
      level: 1,
      power: 7,
      affixes: [{ stat: "life", value: 12 }],
      special: "none",
      value: 0,
    },
  ];
}
export const SPECIAL_TEXT: Record<Item["special"], string> = {
  none: "",
  thornburst: "Kills release a small burst of thorns.",
  echo: "Whorl repeats once after a short delay.",
  ward: "Potions restore an additional 25% life.",
  gale: "Dash cooldown is reduced by 25%.",
};
