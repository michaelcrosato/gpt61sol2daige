export type StatId =
  | "damage"
  | "life"
  | "speed"
  | "haste"
  | "crit"
  | "critPower"
  | "armor"
  | "regen"
  | "leech"
  | "reach"
  | "cooldown"
  | "gold"
  | "xp"
  | "luck"
  | "burn"
  | "chain"
  | "execute"
  | "spirit";
export type PathId = "blade" | "ember" | "root" | "gale";
export interface SkillNode {
  id: string;
  path: PathId;
  tier: number;
  lane: number;
  name: string;
  description: string;
  max: number;
  stat: StatId;
  value: number;
  unlock?: "lance" | "nova";
  power?: "cleave" | "inferno" | "bloom" | "thunder";
  requires: string | null;
}
export const PATHS = [
  {
    id: "blade",
    name: "The Wayblade",
    subtitle: "Combos · critical strikes · execution",
    color: "#e2c18c",
    icon: "sword",
  },
  {
    id: "ember",
    name: "The Emberwake",
    subtitle: "Burning · spell echoes · nova",
    color: "#e9a37e",
    icon: "fire",
  },
  {
    id: "root",
    name: "The Living Root",
    subtitle: "Recovery · armor · life on hit",
    color: "#b8d494",
    icon: "leaf",
  },
  {
    id: "gale",
    name: "The Stormstep",
    subtitle: "Speed · chained bolts · spirit",
    color: "#9dcfd8",
    icon: "bolt",
  },
] as const;
type SeedNode = [name: string, stat: StatId, value: number, description: string];
const definitions: Record<PathId, SeedNode[]> = {
  blade: [
    ["Keen Edge", "damage", 0.08, "+8% attack damage per rank."],
    ["Hunter's Eye", "crit", 0.025, "+2.5% critical chance per rank."],
    ["Long Reach", "reach", 4, "+4 units of slash reach per rank."],
    ["Quicksteel", "haste", 0.07, "+7% attack speed per rank."],
    ["Deep Cut", "critPower", 0.12, "+12% critical damage per rank."],
    [
      "Cull the Weak",
      "execute",
      0.04,
      "Slashes execute enemies below an additional 4% health per rank.",
    ],
    ["Edgecraft", "damage", 0.11, "+11% attack damage per rank."],
    ["Red Harvest", "leech", 0.8, "Recover 0.8 life per enemy hit, per rank."],
    ["Spoils of War", "gold", 0.1, "+10% gold from kills per rank."],
    ["Endless Cleave", "reach", 8, "Keystone: the third combo hit becomes a full-circle cleave."],
    ["Perfect Form", "crit", 0.1, "+10% critical chance."],
    ["Blade Mastery", "damage", 0.02, "Repeatable mastery: +2% damage per rank."],
  ],
  ember: [
    ["Kindling", "burn", 0.12, "Hits ignite for 12% extra damage over time per rank."],
    ["Brightblood", "damage", 0.07, "+7% attack and ability damage per rank."],
    ["Hot Pursuit", "speed", 0.035, "+3.5% movement speed per rank."],
    [
      "Bloom Nova",
      "damage",
      0.06,
      "Unlock Bloom Nova (F / 4): a wide blast that burns clustered enemies.",
    ],
    ["Afterglow", "cooldown", 0.04, "Abilities recover 4% faster per rank."],
    ["Ash Collector", "xp", 0.09, "+9% experience from kills per rank."],
    ["Wildfire", "burn", 0.18, "Add 18% burning damage per rank."],
    ["Flashpoint", "critPower", 0.15, "+15% critical damage per rank."],
    ["Cinderheart", "life", 18, "+18 maximum life per rank."],
    ["Inferno", "burn", 0.2, "Keystone: slain burning enemies explode, spreading fire nearby."],
    ["Second Sun", "cooldown", 0.12, "Abilities recover 12% faster."],
    ["Ember Mastery", "burn", 0.02, "Repeatable mastery: +2% burning damage per rank."],
  ],
  root: [
    ["Deep Roots", "life", 18, "+18 maximum life per rank."],
    ["Barkskin", "armor", 9, "+9 armor per rank."],
    ["New Growth", "regen", 0.35, "+0.35 life regenerated each second per rank."],
    ["Sap Siphon", "leech", 1, "Recover 1 life per enemy hit, per rank."],
    ["Steady Hands", "crit", 0.02, "+2% critical chance per rank."],
    ["Patient Hunter", "xp", 0.08, "+8% experience per rank."],
    ["Old Growth", "life", 25, "+25 maximum life per rank."],
    ["Ironwood", "armor", 14, "+14 armor per rank."],
    ["Rootwell", "spirit", 2, "+2 spirit regeneration per second, per rank."],
    [
      "Living Bastion",
      "regen",
      1,
      "Keystone: potion use releases a healing, damaging bloom around you.",
    ],
    ["Unbroken", "armor", 28, "+28 armor."],
    ["Root Mastery", "life", 5, "Repeatable mastery: +5 maximum life per rank."],
  ],
  gale: [
    ["Fleetfoot", "speed", 0.05, "+5% movement speed per rank."],
    ["Quickening", "haste", 0.06, "+6% attack speed per rank."],
    ["Clear Skies", "spirit", 2, "+2 spirit regeneration per second, per rank."],
    ["Thornlance", "damage", 0.05, "Unlock Thornlance (R / 3): a fast piercing projectile."],
    ["Static Charge", "chain", 0.15, "Hits have +15% chance per rank to arc to a second enemy."],
    ["Tailwind", "cooldown", 0.05, "Abilities recover 5% faster per rank."],
    ["Lightning Steps", "speed", 0.06, "+6% movement speed per rank."],
    ["Fortune's Favor", "luck", 0.05, "+5% chance per rank to improve loot rarity."],
    ["Second Wind", "regen", 0.5, "+0.5 life regeneration per rank."],
    ["Stormwake", "chain", 0.2, "Keystone: dashes release a damaging shockwave on arrival."],
    ["Eye of the Storm", "crit", 0.08, "+8% critical chance."],
    ["Gale Mastery", "haste", 0.01, "Repeatable mastery: +1% attack speed per rank."],
  ],
};
export const SKILLS: SkillNode[] = PATHS.flatMap((path) =>
  definitions[path.id].map(([name, stat, value, description], index) => {
    const tier = Math.floor(index / 3),
      lane = index % 3;
    return {
      id: `${path.id}-${index}`,
      path: path.id,
      tier,
      lane,
      name,
      stat,
      value,
      description,
      max: tier === 3 ? (lane === 2 ? 999999 : 1) : 3,
      requires: tier === 0 ? null : `${path.id}-${index - 3}`,
      unlock:
        path.id === "gale" && index === 3
          ? "lance"
          : path.id === "ember" && index === 3
            ? "nova"
            : undefined,
      power:
        index === 9
          ? ({ blade: "cleave", ember: "inferno", root: "bloom", gale: "thunder" } as const)[
              path.id
            ]
          : undefined,
    };
  }),
);
export function skillReason(
  id: string,
  ranks: Record<string, number>,
  points: number,
  level: number,
): string | null {
  const skill = SKILLS.find((node) => node.id === id);
  if (!skill) return "Unknown skill";
  if ((ranks[id] ?? 0) >= skill.max) return "Fully learned";
  if (points < 1) return "Earn a skill point by leveling up";
  const minimumLevel = [1, 3, 6, 10][skill.tier];
  if (level < minimumLevel) return `Requires level ${minimumLevel}`;
  if (skill.requires && !ranks[skill.requires])
    return `Requires ${SKILLS.find((node) => node.id === skill.requires)!.name}`;
  const spent = SKILLS.filter((node) => node.path === skill.path).reduce(
    (sum, node) => sum + (ranks[node.id] ?? 0),
    0,
  );
  if (spent < skill.tier * 3) return `Invest ${skill.tier * 3} points in this path first`;
  return null;
}
export const STAT_LABELS: Record<StatId, string> = {
  damage: "damage",
  life: "life",
  speed: "move speed",
  haste: "attack speed",
  crit: "critical chance",
  critPower: "critical damage",
  armor: "armor",
  regen: "life / second",
  leech: "life on hit",
  reach: "reach",
  cooldown: "cooldown recovery",
  gold: "gold find",
  xp: "experience",
  luck: "rarity find",
  burn: "burn damage",
  chain: "chain chance",
  execute: "execute threshold",
  spirit: "spirit / second",
};
export const PERCENT_STATS: readonly StatId[] = [
  "damage",
  "speed",
  "haste",
  "crit",
  "critPower",
  "cooldown",
  "gold",
  "xp",
  "luck",
  "burn",
  "chain",
  "execute",
];
