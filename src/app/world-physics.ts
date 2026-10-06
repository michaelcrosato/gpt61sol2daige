import type { Command } from "../engine/agent.ts";
import type { Simulation } from "../engine/simulation.ts";
import { COMBINATIONS, type CombinationId } from "../game/encounters.ts";
import {
  POLICY_DEFAULTS,
  POLICY_PRESETS,
  type PolicyEdit,
  type PolicyOverride,
  type PolicyScope,
  type PolicyState,
  type PolicyValues,
  type PresetName,
  type RegionProfile,
  type RegionShape,
} from "../physics/policies.ts";

/**
 * M12 in-game physics controls: the pause menu's World physics panel. Everything goes through
 * the agent API (`actors policies|policy|body|configure|apply`), so a guest sees the same
 * values read-only and an agent can reproduce every click.
 */
type Key = keyof typeof POLICY_DEFAULTS;
type Field = {
  key: Key;
  label: string;
  help: string;
  range?: { min: number; max: number; step: number };
};
export const FEATURE_GROUPS: { title: string; fields: Field[] }[] = [
  {
    title: "World",
    fields: [
      {
        key: "worldReactions",
        label: "World reactions",
        help: "Every optional reaction below. Off keeps movement, base combat and essential collision.",
      },
      {
        key: "dynamicProps",
        label: "Loose props move",
        help: "Off freezes loose props where they stand and discards their motion.",
      },
      {
        key: "propBlocking",
        label: "Props block travelers",
        help: "Off lets travelers pass through optional scenery; terrain stays solid.",
      },
      {
        key: "crowdContacts",
        label: "Crowd contacts",
        help: "Off lets players and monsters pass through each other.",
      },
      {
        key: "ambientPhysics",
        label: "Ambient creature bodies",
        help: "On turns ambient creatures here into physical actors (each area's creature circle).",
      },
      {
        key: "sweptCollision",
        label: "Swept collision",
        help: "Off uses discrete checks for fast optional props.",
      },
      {
        key: "impulseStrength",
        label: "Shove strength ×",
        help: "Scales shoves and throws. 0 adds none.",
        range: { min: 0, max: 10, step: 0.05 },
      },
    ],
  },
  {
    title: "Scenery",
    fields: [
      {
        key: "destruction",
        label: "Destruction",
        help: "Off keeps every crack and wreck as it is; nothing new breaks.",
      },
      {
        key: "materialDurability",
        label: "Material toughness ×",
        help: "2 is twice as tough, 0.5 half as tough.",
        range: { min: 0.05, max: 20, step: 0.05 },
      },
      {
        key: "debrisLifetime",
        label: "Debris lifetime (s)",
        help: "0 keeps debris for the scene.",
        range: { min: 0, max: 3600, step: 1 },
      },
    ],
  },
  {
    title: "Impacts and loot",
    fields: [
      {
        key: "impactDamage",
        label: "Impact damage",
        help: "Off: launched props still fly and push but hurt nothing.",
      },
      {
        key: "impactStrength",
        label: "Impact strength ×",
        help: "0 behaves like impact damage off.",
        range: { min: 0, max: 10, step: 0.05 },
      },
      {
        key: "projectileWorld",
        label: "Projectiles meet scenery",
        help: "Off: shots ignore props and keep every base hit.",
      },
      {
        key: "physicalLoot",
        label: "Physical loot",
        help: "Off: drops appear without bouncing and stay collectible.",
      },
    ],
  },
  {
    title: "Mechanisms",
    fields: [
      {
        key: "mechanisms",
        label: "Jointed mechanisms",
        help: "Off freezes gates, chains, launchers and tethers in place; breaks stay broken.",
      },
      {
        key: "jointBreakage",
        label: "Joint breakage",
        help: "Off absorbs overloads and blows; existing breaks are kept.",
      },
      {
        key: "jointStrength",
        label: "Joint strength ×",
        help: "Multiplies every joint's break load.",
        range: { min: 0.05, max: 20, step: 0.05 },
      },
    ],
  },
  {
    title: "Materials and fields",
    fields: [
      {
        key: "materialReactions",
        label: "Material reactions",
        help: "Fire, water, oil and electricity. Off pauses their timers where they stand.",
      },
      {
        key: "chainReactions",
        label: "Chain reactions",
        help: "Off keeps each direct effect but stops it spreading.",
      },
      {
        key: "environmentalForces",
        label: "Environmental forces",
        help: "Wind, vortices, pulls and blast pressure. Off adds no field force.",
      },
      {
        key: "fieldStrength",
        label: "Field strength ×",
        help: "0 behaves like forces off.",
        range: { min: 0, max: 10, step: 0.05 },
      },
    ],
  },
  {
    title: "Bodies",
    fields: [
      {
        key: "ragdolls",
        label: "Physical ragdolls",
        help: "Off plays the authored death pose; existing ragdolls freeze.",
      },
      {
        key: "foliage",
        label: "Foliage response",
        help: "Off returns plants to rest.",
      },
      {
        key: "reactionStrength",
        label: "Recoil and stagger ×",
        help: "0: rigs only flash when hit.",
        range: { min: 0, max: 10, step: 0.05 },
      },
    ],
  },
];
export const PRESET_TEXT: Record<PresetName, string> = {
  Quiet:
    "Compare against a restrained world: every optional reaction off. Movement, combat and interaction stay usable.",
  Reactive: "The authored adventure: every implemented system on at its normal strength.",
  Wild: "Exaggerated: 2.5× shoves, easier breakage (0.6× toughness), double impacts, fields and recoil, half-strength joints.",
  Sanctuary:
    "Town values: harmless movable props and gentle fields and recoil. Nothing breaks, burns or hurts.",
};
const PRESETS = Object.keys(POLICY_PRESETS) as PresetName[];
const esc = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
const fmt = (v: unknown) =>
  typeof v === "boolean" ? (v ? "on" : "off") : typeof v === "number" ? String(+v.toFixed(2)) : "";
/** Values of a preset that differ from the Reactive defaults, as readable text. */
export function presetDifferences(name: PresetName): string {
  const preset = POLICY_PRESETS[name] as typeof POLICY_DEFAULTS;
  const changed = (Object.keys(POLICY_DEFAULTS) as Key[]).filter(
    (k) => preset[k] !== POLICY_DEFAULTS[k],
  );
  if (!changed.length) return "Exactly the defaults.";
  return changed.map((k) => `${label(k)} ${fmt(preset[k])}`).join(" · ");
}
const ALL_FIELDS = FEATURE_GROUPS.flatMap((g) => g.fields);
function label(key: Key): string {
  return ALL_FIELDS.find((f) => f.key === key)?.label ?? key;
}
/** A region's readable name and what it is for. */
export function regionLabel(
  region: Pick<RegionProfile, "id">,
  combos: ReadonlyMap<string, CombinationId>,
): { name: string; note: string } {
  const id = region.id;
  const combo = combos.get(id);
  if (combo)
    return {
      name: COMBINATIONS[combo].name,
      note: `Encounter cluster, authored to strengthen ${COMBINATIONS[combo].profile} reactions`,
    };
  if (id === "market")
    return { name: "Market", note: "Town stalls, authored so props block travelers here" };
  if (id.startsWith("calm-"))
    return {
      name: "Calm ring",
      note: "Authored with Quiet values; world reactions stay on for creatures",
    };
  if (id.startsWith("wild-")) return { name: "Wild ring", note: "Authored with Wild values" };
  if (id.startsWith("quiet-"))
    return {
      name: "Pass-through patch",
      note: "Authored so crowds and ambient creatures pass through (a comparison patch)",
    };
  if (id.startsWith("reactive-"))
    return {
      name: "Creature circle",
      note: "Authored so ambient creatures here are physical actors",
    };
  if (id.startsWith("custom-")) return { name: "Your region", note: "Added in this run" };
  return { name: id, note: "Authored region" };
}

interface Options {
  sim: () => Simulation;
  player: () => string;
  execute: (command: Command) => unknown;
  /** Solo or host: may edit shared policy. Guests see a read-only view. */
  authority: () => boolean;
  paused: () => boolean;
  /** Close the menu and let the next click or tap on the map choose an object. */
  pick: () => void;
  /** Local presentation: what the renderer highlights. */
  highlight: (selection: { body: string | null; region: string | null }) => void;
}
interface PolicyView {
  state: PolicyState;
  preview: PolicyState;
  pending: unknown[];
  nextRevision: number;
}
interface BodyView {
  id: string;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  role?: string;
  motion?: string;
  frozen?: boolean;
  reactivationBlocked?: boolean;
  material?: string;
  mass?: number;
  assembly?: string;
  areaId?: string;
  blueprint?: { family?: string };
  consequences?: { durability?: number; destroyed?: boolean };
  policy?: {
    effective: typeof POLICY_DEFAULTS;
    provenance: Record<Key, string>;
    regions: string[];
  };
  reaction?: Record<string, unknown> | null;
  lastReaction?: { rule: string; owner: string; tick: number; text: string } | null;
  instigator?: { owner: string; cause: string } | null;
}
type Resolved = {
  values: typeof POLICY_DEFAULTS;
  effective: typeof POLICY_DEFAULTS;
  provenance: Record<Key, string>;
  landId: string;
  areaId: string;
  regions: string[];
};

export class WorldPhysicsPanel {
  scope: PolicyScope = "area";
  region: string | null = null;
  body: string | null = null;
  private notice = "";
  private readonly options: Options;
  constructor(options: Options) {
    this.options = options;
  }
  private exec<T>(command: Command): T {
    return this.options.execute(command) as T;
  }
  private policies(): PolicyView {
    return this.exec<PolicyView>({ op: "actors", action: "policies" });
  }
  private hero() {
    return this.options.sim().players.get(this.options.player()) ?? { x: 0, y: 0 };
  }
  private here(): Resolved {
    const h = this.hero();
    return this.exec<Resolved>({ op: "actors", action: "policy", x: h.x, y: h.y });
  }
  /** Cheap state the panel depends on, for the dialog's re-render check. */
  signature(): string {
    const sim = this.options.sim();
    const live = this.options.paused() ? 0 : Math.floor(sim.tick / 30);
    return JSON.stringify([
      this.scope,
      this.region,
      this.body,
      this.notice,
      this.options.authority(),
      sim.physical?.world.policyRevision() ?? sim.replicaPhysics?.world.policies?.state.revision,
      live,
    ]);
  }
  /** Select the object nearest a world point (within `reach`), for O and map picks. */
  selectNear(x: number, y: number, reach = 60): string | null {
    let best: { id: string; d: number } | null = null;
    for (const p of this.options.sim().physicalProps()) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= reach && (!best || d < best.d)) best = { id: p.id, d };
    }
    if (best) this.body = best.id;
    this.sync();
    return best?.id ?? null;
  }
  /** The menu closed: stop highlighting (the selection is kept for the next time it opens). */
  closed(): void {
    this.options.highlight({ body: null, region: null });
  }
  selectBody(id: string | null): void {
    this.body = id;
    this.sync();
  }
  private sync(): void {
    this.options.highlight({
      body: this.body,
      region: this.scope === "region" ? this.region : null,
    });
  }
  private scopeId(here: Resolved): string {
    if (this.scope === "land") return here.landId;
    if (this.scope === "area") return here.areaId;
    return this.region ?? "";
  }
  private commit(edits: PolicyEdit[], done: string): void {
    try {
      const expectedRevision = this.policies().nextRevision;
      const queued = this.exec<{ nextRevision: number }>({
        op: "actors",
        action: "configure",
        expectedRevision,
        edits,
      });
      // Paused (solo menus pause time): apply now so the change is visible before resuming.
      // Running (a co-op host): the queue commits at the next tick boundary.
      if (this.options.paused())
        this.exec({ op: "actors", action: "apply", expectedRevision: queued.nextRevision });
      this.notice = this.options.paused() ? `${done}. Applied.` : `${done}. Applies next tick.`;
    } catch (error) {
      this.notice = error instanceof Error ? error.message : String(error);
    }
  }
  private overrideOf(view: PolicyView, scope: PolicyScope, id: string): PolicyValues {
    return (
      view.preview.overrides.find((o: PolicyOverride) => o.scope === scope && o.id === id)
        ?.values ?? {}
    );
  }
  private profileOf(view: PolicyView, scope: PolicyScope, id: string) {
    const layout = view.preview.profiles;
    return scope === "land"
      ? layout.lands.find((p) => p.id === id)
      : scope === "area"
        ? layout.areas.find((p) => p.id === id)
        : layout.regions.find((p) => p.id === id);
  }
  /** Set (or with `undefined`, drop) one field of the selected scope's live override. */
  private setField(key: Key, value: boolean | number | undefined): void {
    const view = this.policies(),
      here = this.here(),
      id = this.scopeId(here);
    if (!id) return;
    const current = { ...this.overrideOf(view, this.scope, id) } as Record<string, unknown>;
    if (value === undefined) {
      delete current[key];
      this.commit(
        [
          { type: "reset", scope: this.scope, id, to: "inherited" },
          ...(Object.keys(current).length
            ? [{ type: "override" as const, scope: this.scope, id, values: current }]
            : []),
        ],
        `${label(key)} back to its default at ${id}`,
      );
    } else
      this.commit(
        [{ type: "override", scope: this.scope, id, values: { [key]: value } }],
        `${label(key)} ${fmt(value)} at ${id}`,
      );
  }
  /** Data-attribute actions from clicks. Returns true when it handled the target. */
  click(target: HTMLElement): boolean {
    const action = target.dataset.wp;
    if (!action) return false;
    this.notice = "";
    const here = this.here(),
      h = this.hero();
    switch (action) {
      case "scope":
        this.scope = target.dataset.scope as PolicyScope;
        if (this.scope === "region" && !this.region) this.region = here.regions[0] ?? null;
        break;
      case "region":
        this.scope = "region";
        this.region = target.dataset.id ?? null;
        break;
      case "set": {
        const key = target.dataset.key as Key,
          raw = target.dataset.value;
        this.setField(key, raw === "default" ? undefined : raw === "true");
        break;
      }
      case "preset": {
        const id = this.scopeId(here),
          preset = target.dataset.preset as PresetName;
        if (id)
          this.commit(
            [{ type: "preset", scope: this.scope, id, preset }],
            `${preset} at ${id} (${presetDifferences(preset)})`,
          );
        break;
      }
      case "reset": {
        const id = this.scopeId(here);
        if (id)
          this.commit(
            [{ type: "reset", scope: this.scope, id, to: target.dataset.to as "inherited" }],
            target.dataset.to === "authored"
              ? `${id} restored to its authored values`
              : `${id} live changes cleared`,
          );
        break;
      }
      case "reset-all": {
        const view = this.policies(),
          authored = view.preview.authored;
        const edits: PolicyEdit[] = [
          { type: "master", enabled: true },
          ...view.preview.overrides.map(
            (o) => ({ type: "reset", scope: o.scope, id: o.id, to: "inherited" }) as PolicyEdit,
          ),
          ...view.preview.profiles.regions
            .filter((r) => !authored.regions.some((a) => a.id === r.id))
            .map((r) => ({ type: "remove", scope: "region", id: r.id }) as PolicyEdit),
          ...view.preview.profiles.regions
            .filter((r) => {
              const a = authored.regions.find((a) => a.id === r.id);
              return a && JSON.stringify(a) !== JSON.stringify(r);
            })
            .map(
              (r) => ({ type: "reset", scope: "region", id: r.id, to: "authored" }) as PolicyEdit,
            ),
        ];
        this.commit(edits, "Every live change undone; the land is as authored");
        if (this.region?.startsWith("custom-")) this.region = null;
        break;
      }
      case "master":
        this.commit(
          [{ type: "master", enabled: target.dataset.enabled === "true" }],
          target.dataset.enabled === "true"
            ? "World reactions back on everywhere"
            : "Every optional world reaction off for this session",
        );
        break;
      case "region-move":
      case "region-grow":
      case "region-shrink":
      case "region-raise":
      case "region-lower": {
        const view = this.policies(),
          region = view.preview.profiles.regions.find((r) => r.id === this.region);
        if (!region) break;
        const next = structuredClone(region);
        if (action === "region-move") next.shape = moveShape(next.shape, h.x, h.y);
        if (action === "region-grow") next.shape = scaleShape(next.shape, 1.25);
        if (action === "region-shrink") next.shape = scaleShape(next.shape, 0.8);
        if (action === "region-raise") next.priority = Math.min(1000, next.priority + 5);
        if (action === "region-lower") next.priority = Math.max(-1000, next.priority - 5);
        this.commit([{ type: "region", profile: next }], `${region.id} ${regionVerb(action)}`);
        break;
      }
      case "region-new": {
        const view = this.policies();
        let n = 1;
        while (view.preview.profiles.regions.some((r) => r.id === `custom-${n}`)) n++;
        const id = `custom-${n}`;
        this.commit(
          [
            {
              type: "region",
              profile: {
                id,
                areaId: here.areaId,
                priority: 30,
                shape: { kind: "circle", x: round(h.x), y: round(h.y), radius: 80 },
                values: {},
              },
            },
          ],
          `${id} added around you; choose a preset or switches for it`,
        );
        this.scope = "region";
        this.region = id;
        break;
      }
      case "region-remove":
        if (this.region?.startsWith("custom-")) {
          this.commit(
            [{ type: "remove", scope: "region", id: this.region }],
            `${this.region} removed`,
          );
          this.region = null;
        }
        break;
      case "body":
        this.body = target.dataset.id ?? null;
        break;
      case "pick":
        this.options.pick();
        break;
      case "nearest":
        this.selectNear(h.x, h.y, 400);
        break;
      default:
        return false;
    }
    this.sync();
    return true;
  }
  /** Number fields commit on change (Enter or leaving the field). Empty means default. */
  change(target: HTMLInputElement): boolean {
    if (target.dataset.wp !== "number") return false;
    const key = target.dataset.key as Key,
      field = ALL_FIELDS.find((f) => f.key === key);
    if (!field?.range) return false;
    if (target.value.trim() === "") this.setField(key, undefined);
    else {
      const value = Number(target.value);
      if (!Number.isFinite(value) || value < field.range.min || value > field.range.max) {
        this.notice = `${field.label} must be ${field.range.min}–${field.range.max}`;
        return true;
      }
      this.setField(key, value);
    }
    return true;
  }
  render(): string {
    const sim = this.options.sim(),
      authority = this.options.authority();
    this.sync();
    let view: PolicyView, here: Resolved;
    try {
      view = this.policies();
      here = this.here();
    } catch (error) {
      return `<p class="world-physics-empty">${esc(error instanceof Error ? error.message : error)}</p>`;
    }
    const combos = new Map<string, CombinationId>();
    for (const m of sim.physicalEncounters())
      for (const c of m.clusters) combos.set(c.region, c.combo);
    const areaRegions = view.preview.profiles.regions.filter((r) => r.areaId === here.areaId);
    if (this.scope === "region" && !areaRegions.some((r) => r.id === this.region))
      this.region = here.regions[0] ?? areaRegions[0]?.id ?? null;
    if (this.scope === "region" && !this.region) this.scope = "area";
    const id = this.scopeId(here),
      profile = this.profileOf(view, this.scope, id),
      override = this.overrideOf(view, this.scope, id) as Record<string, unknown>;
    const disabled = authority ? "" : " disabled";
    const master = view.preview.masterWorldReactions;
    const areaName = here.areaId.startsWith("area-")
      ? `Area ${here.areaId.slice(5)}`
      : here.areaId === "town"
        ? "Town (Sanctuary)"
        : here.areaId;
    // Where you stand: the effective switches at the hero and where each comes from.
    const hereChips = ALL_FIELDS.map((f) => {
      const value = here.effective[f.key],
        source = here.provenance[f.key] ?? "default";
      const changed = value !== POLICY_DEFAULTS[f.key];
      return `<span class="wp-chip${changed ? " changed" : ""}${value === false ? " off" : ""}" title="${esc(`${f.label}: ${fmt(value)} (from ${source})`)}">${esc(f.label)} <b>${fmt(value)}</b></span>`;
    }).join("");
    const regionChips = here.regions.length
      ? here.regions
          .map((r) => `<b>${esc(regionLabel({ id: r }, combos).name)}</b> <small>${esc(r)}</small>`)
          .join(", ")
      : "no region";
    const scopeTabs = (["land", "area", "region"] as PolicyScope[])
      .map(
        (s) =>
          `<button type="button" data-wp="scope" data-scope="${s}" aria-pressed="${this.scope === s}"${s === "region" && !areaRegions.length ? " disabled" : ""}>${s === "land" ? "Whole land" : s === "area" ? `This area · ${esc(areaName)}` : "A region"}</button>`,
      )
      .join("");
    const regionList =
      this.scope === "region"
        ? `<div class="wp-regions" role="list">${areaRegions
            .map((r) => {
              const l = regionLabel(r, combos),
                inside = here.regions.includes(r.id);
              return `<button type="button" role="listitem" data-wp="region" data-id="${esc(r.id)}" aria-pressed="${r.id === this.region}"><strong>${esc(l.name)}</strong><small>${esc(r.id)} · priority ${r.priority}${inside ? " · you are inside" : ""}</small></button>`;
            })
            .join("")}</div>`
        : "";
    const selectedRegion =
      this.scope === "region" ? areaRegions.find((r) => r.id === this.region) : undefined;
    const regionTools = selectedRegion
      ? `<div class="wp-region-tools"><p>${esc(regionLabel(selectedRegion, combos).note)}. Bounds: ${esc(shapeText(selectedRegion.shape))}, priority ${selectedRegion.priority}. Higher priority wins where regions overlap.</p><div class="wp-buttons"><button type="button" data-wp="region-move"${disabled}>Center on me</button><button type="button" data-wp="region-grow"${disabled}>Larger</button><button type="button" data-wp="region-shrink"${disabled}>Smaller</button><button type="button" data-wp="region-raise"${disabled}>Priority +5</button><button type="button" data-wp="region-lower"${disabled}>Priority −5</button>${selectedRegion.id.startsWith("custom-") ? `<button type="button" data-wp="region-remove"${disabled}>Remove region</button>` : ""}</div></div>`
      : "";
    const presets = PRESETS.map(
      (p) =>
        `<button type="button" class="wp-preset" data-wp="preset" data-preset="${p}"${disabled}><strong>${p}</strong><span>${esc(PRESET_TEXT[p])}</span><small>${esc(presetDifferences(p))}</small></button>`,
    ).join("");
    const groups = FEATURE_GROUPS.map(
      (g) =>
        `<fieldset class="wp-group"><legend>${esc(g.title)}</legend>${g.fields
          .map((f) => {
            const authoredValue = (profile?.values as Record<string, unknown> | undefined)?.[f.key],
              live = override[f.key],
              effective = here.effective[f.key];
            const state =
              live === undefined ? "default" : typeof live === "boolean" ? String(live) : "set";
            const origin =
              live !== undefined
                ? "changed here"
                : authoredValue !== undefined
                  ? `authored ${fmt(authoredValue)}`
                  : "inherited";
            const control = f.range
              ? `<input type="number" data-wp="number" data-key="${f.key}" min="${f.range.min}" max="${f.range.max}" step="${f.range.step}" value="${live === undefined ? "" : esc(live)}" placeholder="${esc(fmt(authoredValue ?? POLICY_DEFAULTS[f.key]))}" aria-label="${esc(f.label)} at the selected scope (empty: default)"${disabled}>`
              : `<span class="wp-toggle" role="group" aria-label="${esc(f.label)} at the selected scope">${(
                  [
                    ["default", "Default"],
                    ["true", "On"],
                    ["false", "Off"],
                  ] as const
                )
                  .map(
                    ([v, text]) =>
                      `<button type="button" data-wp="set" data-key="${f.key}" data-value="${v}" aria-pressed="${state === v}"${disabled}>${text}</button>`,
                  )
                  .join("")}</span>`;
            return `<div class="wp-row"><div><strong>${esc(f.label)}</strong><small>${esc(f.help)}</small></div>${control}<em title="Effective where you stand">${esc(origin)} · you: ${fmt(effective)}</em></div>`;
          })
          .join("")}</fieldset>`,
    ).join("");
    return `<div class="world-physics">
      <section class="wp-here" aria-label="Where you stand"><h3>Where you stand</h3><p>${esc(areaName)} · ${regionChips}. Session master: <b>${master ? "on" : "off"}</b>.</p><div class="wp-chips">${hereChips}</div>
        <div class="wp-buttons"><button type="button" data-wp="master" data-enabled="${!master}"${disabled}>${master ? "Turn every world reaction off" : "Turn world reactions back on"}</button><button type="button" data-wp="reset-all"${disabled}>Undo every live change</button></div>
        ${authority ? "" : '<p class="wp-guest">The host controls shared physics. You see the same values they do.</p>'}</section>
      <section class="wp-edit" aria-label="Edit a scope"><h3>Choose where a change applies</h3><div class="wp-tabs" role="group" aria-label="Policy scope">${scopeTabs}</div>${regionList}${regionTools}
        <p class="wp-scope-note">Editing <b>${esc(id || "nothing")}</b>. Narrower scopes win: a region beats its area, an area beats the land. Turning something off freezes it where it stands and discards its motion; turning it back on starts from rest, never a backlog. ${authority ? (this.options.paused() ? "Changes apply at once while paused." : "Changes apply at the next tick.") : ""}</p>
        <div class="wp-presets" role="group" aria-label="Presets">${presets}</div>
        <div class="wp-buttons"><button type="button" data-wp="reset" data-to="inherited"${disabled}>Clear live changes here</button><button type="button" data-wp="reset" data-to="authored"${disabled}>Reset to authored</button><button type="button" data-wp="region-new"${disabled}>New region around me</button></div>
        <div class="wp-groups">${groups}</div></section>
      <section class="wp-inspect" aria-label="Inspect an object"><h3>Inspect an object</h3>${this.inspector()}</section>
      ${this.notice ? `<p class="wp-notice" role="status">${esc(this.notice)}</p>` : ""}
    </div>`;
  }
  private inspector(): string {
    const sim = this.options.sim(),
      h = this.hero();
    const near = sim
      .physicalProps()
      .map((p) => ({ id: p.id, d: Math.hypot(p.x - h.x, p.y - h.y) }))
      .filter((p) => p.d < 240)
      .sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1))
      .slice(0, 10);
    const list = `<div class="wp-buttons"><button type="button" data-wp="pick">Pick on the map</button><button type="button" data-wp="nearest">Nearest to me</button></div><div class="wp-near" role="list" aria-label="Objects near you">${
      near.length
        ? near
            .map(
              (p) =>
                `<button type="button" role="listitem" data-wp="body" data-id="${esc(p.id)}" aria-pressed="${p.id === this.body}">${esc(p.id)} <small>${Math.round(p.d)} u</small></button>`,
            )
            .join("")
        : "<span>No loose objects within 240 units.</span>"
    }</div>`;
    if (!this.body)
      return `${list}<p class="wp-hint">Hover an object and press O, or pick one.</p>`;
    let b: BodyView;
    try {
      b = this.exec<BodyView>({ op: "actors", action: "body", id: this.body });
    } catch {
      return `${list}<p class="wp-hint">${esc(this.body)} is gone (broken, burnt or left behind).</p>`;
    }
    const speed = Math.hypot(b.vx ?? 0, b.vy ?? 0);
    const motion = b.frozen
      ? `frozen${b.reactivationBlocked ? " (blocked: something overlaps it)" : ""}`
      : b.motion === "fixed"
        ? "fixed in place"
        : `free, ${speed.toFixed(1)} u/s`;
    const durability = b.consequences?.durability;
    const status = b.reaction
      ? ["burning", "wet", "oiled", "charged", "fuse", "heat"]
          .filter((k) => Number(b.reaction![k] ?? 0) > 0)
          .map((k) => `${k} ${b.reaction![k]}`)
          .concat(b.reaction.charred ? ["charred"] : [])
          .join(", ")
      : "";
    const policy = b.policy
      ? ALL_FIELDS.filter((f) => b.policy!.effective[f.key] !== POLICY_DEFAULTS[f.key])
          .map(
            (f) =>
              `${f.label} ${fmt(b.policy!.effective[f.key])} <small>(${esc(b.policy!.provenance[f.key])})</small>`,
          )
          .join("; ") || "Reactive defaults"
      : "";
    const rows: [string, string][] = [
      ["Object", `${esc(b.id)}`],
      [
        "Kind",
        `${esc(b.blueprint?.family ?? b.role ?? "body")} · ${esc(b.material ?? "—")}${b.mass ? ` · ${b.mass.toFixed(1)} mass` : ""}`,
      ],
      ["Motion", esc(motion)],
      [
        "Durability",
        durability === undefined
          ? "not breakable"
          : `${Math.round(durability)}%${b.consequences?.destroyed ? " (destroyed)" : ""}`,
      ],
      ["Mechanism", b.assembly ? esc(b.assembly) : "none"],
      ["Region", esc(b.policy?.regions.join(", ") || "none")],
      ["Policy here", policy],
      ["Status", esc(status || "none")],
      [
        "Last reaction",
        b.lastReaction
          ? `${esc(b.lastReaction.rule)} by ${esc(b.lastReaction.owner || "the world")}, ${sim.tick - b.lastReaction.tick} ticks ago`
          : "none recorded",
      ],
      [
        "Last push",
        b.instigator ? `${esc(b.instigator.cause)} by ${esc(b.instigator.owner)}` : "none recent",
      ],
    ];
    return `${list}<dl class="wp-body">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
  }
}
const round = (v: number) => Math.round(v * 100) / 100;
function moveShape(shape: RegionShape, x: number, y: number): RegionShape {
  if (shape.kind === "circle") return { ...shape, x: round(x), y: round(y) };
  if (shape.kind === "rectangle")
    return { ...shape, x: round(x - shape.width / 2), y: round(y - shape.height / 2) };
  const cx = shape.points.reduce((s, p) => s + p.x, 0) / shape.points.length,
    cy = shape.points.reduce((s, p) => s + p.y, 0) / shape.points.length;
  return {
    ...shape,
    points: shape.points.map((p) => ({ x: round(p.x + x - cx), y: round(p.y + y - cy) })),
  };
}
function scaleShape(shape: RegionShape, factor: number): RegionShape {
  if (shape.kind === "circle")
    return { ...shape, radius: round(Math.min(10_000, Math.max(8, shape.radius * factor))) };
  if (shape.kind === "rectangle") {
    const width = round(Math.min(20_000, Math.max(8, shape.width * factor))),
      height = round(Math.min(20_000, Math.max(8, shape.height * factor)));
    return {
      ...shape,
      x: round(shape.x + (shape.width - width) / 2),
      y: round(shape.y + (shape.height - height) / 2),
      width,
      height,
    };
  }
  const cx = shape.points.reduce((s, p) => s + p.x, 0) / shape.points.length,
    cy = shape.points.reduce((s, p) => s + p.y, 0) / shape.points.length;
  return {
    ...shape,
    points: shape.points.map((p) => ({
      x: round(cx + (p.x - cx) * factor),
      y: round(cy + (p.y - cy) * factor),
    })),
  };
}
function shapeText(shape: RegionShape): string {
  if (shape.kind === "circle")
    return `circle at (${Math.round(shape.x)}, ${Math.round(shape.y)}), radius ${Math.round(shape.radius)}`;
  if (shape.kind === "rectangle")
    return `rectangle ${Math.round(shape.width)}×${Math.round(shape.height)} from (${Math.round(shape.x)}, ${Math.round(shape.y)})`;
  return `polygon of ${shape.points.length} points`;
}
function regionVerb(action: string): string {
  return {
    "region-move": "centered on you",
    "region-grow": "enlarged",
    "region-shrink": "reduced",
    "region-raise": "priority raised",
    "region-lower": "priority lowered",
  }[action]!;
}
