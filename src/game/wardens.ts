import type { MechanicId } from "./content.ts";

/**
 * M10 warden identities. Each authored warden turns its slam into a signature physical move
 * built from its area's mechanic, with a longer, readable telegraph, and has one physical
 * weakness: the area's own rules used against it expose the warden (it staggers, its telegraph
 * breaks and it takes more damage for a moment). Procedural wardens share these by signature.
 */
export type WardenMove =
  | "thornburst"
  | "gale"
  | "discharge"
  | "echo"
  | "breath"
  | "lash"
  | "collapse"
  | "blink";
export type WardenWeakness =
  | "bramble"
  | "crash"
  | "shock"
  | "echo"
  | "water"
  | "lash"
  | "impact"
  | "rift";
export interface WardenRecipe {
  move: WardenMove;
  name: string;
  /** How the telegraph reads: a ring around the warden, a lane or a line, or a far marker. */
  telegraph: "ring" | "lane" | "line" | "marker";
  summary: string;
  weakness: WardenWeakness;
  exposedBy: string;
}
export const WARDENS: Record<MechanicId, WardenRecipe> = {
  bramble: {
    move: "thornburst",
    name: "Briar burst",
    telegraph: "ring",
    summary:
      "Brambleheart bursts like a seedpod: thorn splinters fly out, nearby props are shoved and fragile hedges break.",
    weakness: "bramble",
    exposedBy: "a seedpod bursting beside it",
  },
  wind: {
    move: "gale",
    name: "Gale charge",
    telegraph: "lane",
    summary:
      "The Gale Stag charges down a locked lane with a gale at its back that drives props and travelers along it.",
    weakness: "crash",
    exposedBy: "charging into a solid prop, fence or tree",
  },
  glass: {
    move: "discharge",
    name: "Glass discharge",
    telegraph: "ring",
    summary:
      "Vyr slams and discharges through the conductors, pools and glass around it, cracking pylons.",
    weakness: "shock",
    exposedBy: "a shock reaching it while it is wet",
  },
  echo: {
    move: "echo",
    name: "Echo slam",
    telegraph: "ring",
    summary:
      "The Echo Matron slams, and the same spot slams again a moment later with a shove that scatters props.",
    weakness: "echo",
    exposedBy: "an Echo Well's repeat striking her",
  },
  cinder: {
    move: "breath",
    name: "Cinder breath",
    telegraph: "line",
    summary:
      "Cinderjaw breathes fire down a locked line: travelers caught are burnt, and brush, wood and oil along it ignite.",
    weakness: "water",
    exposedBy: "being doused (a cask's splash, a pool or wading)",
  },
  blood: {
    move: "lash",
    name: "Vine lash",
    telegraph: "line",
    summary:
      "The Bloom Tyrant lashes a vine down a locked line: a traveler caught is reeled in by an elastic vine until a dash tears it.",
    weakness: "lash",
    exposedBy: "a traveler dashing free of its lash",
  },
  gravity: {
    move: "collapse",
    name: "Collapse",
    telegraph: "ring",
    summary:
      "The Hollow Atlas pulls props, loot and travelers toward itself, then slams and flings what it gathered outward.",
    weakness: "impact",
    exposedBy: "a prop a traveler launched striking it",
  },
  rift: {
    move: "blink",
    name: "Rift blink",
    telegraph: "marker",
    summary:
      "The Riftbound King blinks to a marked arch and arrives with a shockwave that throws props and travelers.",
    weakness: "rift",
    exposedBy: "a traveler's rift arrival beside it",
  },
};
/** Signature telegraph length (ticks at enemy speed 1): longer than the ordinary slam. */
export const WARDEN_WINDUP = 64;
/** Exposure: damage multiplier, length, and the time before the weakness can expose again. */
export const EXPOSED = { ticks: 180, damage: 1.5, cooldown: 300, stagger: 40 } as const;
export const ECHO_DELAY = 36;
export interface WardenState {
  /** The signature move being telegraphed or resolving ("" when none). */
  move: WardenMove | "";
  /** Locked target of the move: a lane or line's end, a blink destination, an echo's spot. */
  tx: number;
  ty: number;
  /** Echo Matron: the tick her echo slam lands (0 when none pending). */
  echoAt: number;
  exposedUntil: number;
  exposedBy: WardenWeakness | "";
  lastExposed: number;
}
export const freshWarden = (): WardenState => ({
  move: "",
  tx: 0,
  ty: 0,
  echoAt: 0,
  exposedUntil: 0,
  exposedBy: "",
  lastExposed: -EXPOSED.cooldown,
});
export const WARDEN_MOVES = Object.values(WARDENS).map((w) => w.move);
export const WARDEN_WEAKNESSES = Object.values(WARDENS).map((w) => w.weakness);
export function wardenExport() {
  return {
    version: 1,
    wardens: structuredClone(WARDENS),
    windup: WARDEN_WINDUP,
    exposed: { ...EXPOSED },
    echoDelay: ECHO_DELAY,
    rules:
      "the signature replaces the warden's slam in its attack cycle; its telegraph is longer and locked (lanes, lines and markers do not follow the target); an exposed warden staggers, loses its current telegraph and takes 1.5× damage",
  };
}
