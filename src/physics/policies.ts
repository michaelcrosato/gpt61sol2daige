// Register controls only with their working simulation capability.
export const POLICY_DEFAULTS = {
  worldReactions: true,
  dynamicProps: true,
  propBlocking: true,
  impulseStrength: 1,
  crowdContacts: true,
  ambientPhysics: false,
  sweptCollision: true,
  destruction: true,
  materialDurability: 1,
  debrisLifetime: 0,
};
export type PolicyValues = Partial<typeof POLICY_DEFAULTS>;
export type PolicyScope = "land" | "area" | "region";
export type RegionShape =
  | { kind: "circle"; x: number; y: number; radius: number }
  | { kind: "rectangle"; x: number; y: number; width: number; height: number }
  | { kind: "polygon"; points: { x: number; y: number }[] };
export interface LandProfile {
  id: string;
  values: PolicyValues;
}
export interface AreaProfile extends LandProfile {
  landId: string;
}
export interface RegionProfile extends LandProfile {
  areaId: string;
  priority: number;
  shape: RegionShape;
}
export interface PolicyLayout {
  lands: LandProfile[];
  areas: AreaProfile[];
  regions: RegionProfile[];
}
export interface PolicyOverride {
  scope: PolicyScope;
  id: string;
  values: PolicyValues;
}
export interface PolicyState {
  version: 1;
  revision: number;
  masterWorldReactions: boolean;
  boundaryMargin: number;
  authored: PolicyLayout;
  profiles: PolicyLayout;
  overrides: PolicyOverride[];
}
export type PolicyEdit =
  | { type: "master"; enabled: boolean }
  | { type: "margin"; value: number }
  | { type: "land"; profile: LandProfile }
  | { type: "area"; profile: AreaProfile }
  | { type: "region"; profile: RegionProfile }
  | { type: "remove"; scope: PolicyScope; id: string }
  | { type: "override"; scope: PolicyScope; id: string; values: PolicyValues }
  | { type: "preset"; scope: PolicyScope; id: string; preset: PresetName }
  | { type: "reset"; scope: PolicyScope; id: string; to: "inherited" | "authored" };
export interface PolicyTransaction {
  expectedRevision: number;
  edits: PolicyEdit[];
}
export interface PolicyCheckpoint {
  state: PolicyState;
  pending: PolicyTransaction[];
}
export interface ResolvedPolicy {
  values: typeof POLICY_DEFAULTS;
  effective: typeof POLICY_DEFAULTS;
  provenance: Record<keyof typeof POLICY_DEFAULTS, string>;
  landId: string;
  areaId: string;
  regions: string[];
}
export const POLICY_PRESETS = {
  Quiet: {
    ...POLICY_DEFAULTS,
    worldReactions: false,
    dynamicProps: false,
    propBlocking: false,
    crowdContacts: false,
    destruction: false,
  },
  Reactive: { ...POLICY_DEFAULTS },
  Wild: { ...POLICY_DEFAULTS, impulseStrength: 2.5, materialDurability: 0.6 },
  Sanctuary: {
    ...POLICY_DEFAULTS,
    propBlocking: false,
    crowdContacts: false,
    impulseStrength: 0.35,
    destruction: false,
  },
};
export type PresetName = keyof typeof POLICY_PRESETS;
export const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const listKey = (scope: PolicyScope) =>
  (({ land: "lands", area: "areas", region: "regions" }) as const)[scope];
const scopes: PolicyScope[] = ["land", "area", "region"];
function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected policy object");
}
function keys(value: object, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error("Unknown policy field/capability");
}
export function policyId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[\w-]{1,80}$/.test(value))
    throw new Error("Invalid policy ID");
}
function number(value: unknown, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`Policy number must be finite within ${min}..${max}`);
}
export function validateValues(values: PolicyValues) {
  object(values);
  keys(values, Object.keys(POLICY_DEFAULTS));
  for (const key of [
    "worldReactions",
    "dynamicProps",
    "propBlocking",
    "crowdContacts",
    "ambientPhysics",
    "sweptCollision",
    "destruction",
  ] as const)
    if (key in values && typeof values[key] !== "boolean")
      throw new Error(`${key} must be boolean`);
  if ("impulseStrength" in values) number(values.impulseStrength, 0, 10);
  if ("materialDurability" in values) number(values.materialDurability, 0.05, 20);
  if ("debrisLifetime" in values) number(values.debrisLifetime, 0, 3600);
}
const cross = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function segmentDistance(
  x: number,
  y: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
}
function intersects(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
) {
  const p = cross(a, b, c),
    q = cross(a, b, d),
    r = cross(c, d, a),
    s = cross(c, d, b);
  return (
    (p * q < 0 && r * s < 0) ||
    (p === 0 && segmentDistance(c.x, c.y, a, b) < 1e-9) ||
    (q === 0 && segmentDistance(d.x, d.y, a, b) < 1e-9) ||
    (r === 0 && segmentDistance(a.x, a.y, c, d) < 1e-9) ||
    (s === 0 && segmentDistance(b.x, b.y, c, d) < 1e-9)
  );
}
export function validateShape(shape: RegionShape) {
  object(shape);
  const point = (p: { x: number; y: number }) => {
    object(p);
    keys(p, ["x", "y"]);
    number(p.x, -10_000, 10_000);
    number(p.y, -10_000, 10_000);
  };
  if (shape.kind === "circle" || shape.kind === "rectangle") {
    keys(
      shape,
      shape.kind === "circle"
        ? ["kind", "x", "y", "radius"]
        : ["kind", "x", "y", "width", "height"],
    );
    number(shape.x, -10_000, 10_000);
    number(shape.y, -10_000, 10_000);
    if (shape.kind === "circle") number(shape.radius, 0.01, 10_000);
    else {
      number(shape.width, 0.01, 20_000);
      number(shape.height, 0.01, 20_000);
    }
  } else if (shape.kind === "polygon") {
    keys(shape, ["kind", "points"]);
    if (!Array.isArray(shape.points) || shape.points.length < 3 || shape.points.length > 64)
      throw new Error("Polygon needs 3..64 vertices");
    shape.points.forEach(point);
    let area = 0;
    for (let i = 0; i < shape.points.length; i++) {
      const a = shape.points[i],
        b = shape.points[(i + 1) % shape.points.length];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 0.01) throw new Error("Duplicate polygon vertices");
      area += a.x * b.y - b.x * a.y;
      for (let j = i + 1; j < shape.points.length; j++) {
        if (j === i + 1 || (i === 0 && j === shape.points.length - 1)) continue;
        if (intersects(a, b, shape.points[j], shape.points[(j + 1) % shape.points.length]))
          throw new Error("Self-intersecting polygon");
      }
    }
    if (Math.abs(area) < 0.01) throw new Error("Degenerate polygon");
  } else throw new Error("Unknown region shape");
}
/** Signed distance >= 0 inside, including the authored boundary. Margin provides hysteresis. */
export function containsRegion(shape: RegionShape, x: number, y: number, margin = 0): boolean {
  let distance: number;
  if (shape.kind === "circle") distance = shape.radius - Math.hypot(x - shape.x, y - shape.y);
  else if (shape.kind === "rectangle") {
    const dx = Math.max(shape.x - x, 0, x - shape.x - shape.width),
      dy = Math.max(shape.y - y, 0, y - shape.y - shape.height);
    distance =
      dx || dy
        ? -Math.hypot(dx, dy)
        : Math.min(x - shape.x, shape.x + shape.width - x, y - shape.y, shape.y + shape.height - y);
  } else {
    let inside = false,
      nearest = Infinity;
    for (let i = 0, j = shape.points.length - 1; i < shape.points.length; j = i++) {
      const a = shape.points[i],
        b = shape.points[j];
      nearest = Math.min(nearest, segmentDistance(x, y, a, b));
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x)
        inside = !inside;
    }
    distance = (inside ? 1 : -1) * nearest;
  }
  return distance >= -margin;
}
export function defaultPolicyState(): PolicyState {
  const layout: PolicyLayout = {
    lands: [{ id: "lab-land", values: { worldReactions: true } }],
    areas: [
      { id: "playground", landId: "lab-land", values: { dynamicProps: true, propBlocking: true } },
    ],
    regions: [
      {
        id: "quiet-garden",
        areaId: "playground",
        priority: 10,
        shape: { kind: "rectangle", x: -260, y: -120, width: 90, height: 100 },
        values: { worldReactions: false },
      },
    ],
  };
  return {
    version: 1,
    revision: 0,
    masterWorldReactions: true,
    boundaryMargin: 1,
    authored: structuredClone(layout),
    profiles: layout,
    overrides: [],
  };
}
function validateLayout(layout: PolicyLayout) {
  object(layout);
  keys(layout, ["lands", "areas", "regions"]);
  for (const scope of scopes) {
    const list = layout[listKey(scope)];
    if (!Array.isArray(list) || list.length > 256)
      throw new Error("Policy profile count exceeds 256");
    const ids = new Set<string>();
    for (const profile of list) {
      object(profile);
      policyId(profile.id);
      validateValues(profile.values);
      if (ids.has(profile.id)) throw new Error("Duplicate policy profile ID");
      ids.add(profile.id);
      keys(
        profile,
        scope === "land"
          ? ["id", "values"]
          : scope === "area"
            ? ["id", "values", "landId"]
            : ["id", "values", "areaId", "priority", "shape"],
      );
      if (scope === "area") {
        const p = profile as AreaProfile;
        if (!layout.lands.some((land) => land.id === p.landId))
          throw new Error("Unknown area land");
      } else if (scope === "region") {
        const p = profile as RegionProfile;
        if (!layout.areas.some((area) => area.id === p.areaId))
          throw new Error("Unknown region area");
        number(p.priority, -1000, 1000);
        if (!Number.isInteger(p.priority)) throw new Error("Priority must be integer");
        validateShape(p.shape);
      }
    }
  }
}
export function validatePolicyState(state: PolicyState) {
  object(state);
  keys(state, [
    "version",
    "revision",
    "masterWorldReactions",
    "boundaryMargin",
    "authored",
    "profiles",
    "overrides",
  ]);
  if (
    state.version !== 1 ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 0 ||
    typeof state.masterWorldReactions !== "boolean"
  )
    throw new Error("Invalid policy version/revision/master");
  number(state.boundaryMargin, 0, 16);
  validateLayout(state.authored);
  validateLayout(state.profiles);
  if (!Array.isArray(state.overrides) || state.overrides.length > 768)
    throw new Error("Invalid overrides");
  const ids = new Set<string>();
  for (const entry of state.overrides) {
    object(entry);
    keys(entry, ["scope", "id", "values"]);
    validateValues(entry.values);
    if (
      !scopes.includes(entry.scope) ||
      !state.profiles[listKey(entry.scope)].some((p) => p.id === entry.id) ||
      ids.has(`${entry.scope}:${entry.id}`)
    )
      throw new Error("Invalid override scope/ID");
    ids.add(`${entry.scope}:${entry.id}`);
  }
}
function canonical(state: PolicyState) {
  for (const layout of [state.authored, state.profiles])
    for (const scope of scopes) layout[listKey(scope)].sort((a, b) => compareIds(a.id, b.id));
  state.overrides.sort(
    (a, b) => scopes.indexOf(a.scope) - scopes.indexOf(b.scope) || compareIds(a.id, b.id),
  );
  return state;
}
export function editPolicies(current: PolicyState, transaction: PolicyTransaction): PolicyState {
  object(transaction);
  keys(transaction, ["expectedRevision", "edits"]);
  if (transaction.expectedRevision !== current.revision)
    throw new Error(`Stale policy revision: expected ${current.revision}`);
  if (
    !Array.isArray(transaction.edits) ||
    transaction.edits.length < 1 ||
    transaction.edits.length > 256
  )
    throw new Error("Expected 1..256 policy edits");
  const next = structuredClone(current);
  for (const edit of transaction.edits) {
    object(edit);
    if (edit.type === "master") {
      keys(edit, ["type", "enabled"]);
      next.masterWorldReactions = edit.enabled;
    } else if (edit.type === "margin") {
      keys(edit, ["type", "value"]);
      next.boundaryMargin = edit.value;
    } else if (edit.type === "land" || edit.type === "area" || edit.type === "region") {
      keys(edit, ["type", "profile"]);
      const list: LandProfile[] = next.profiles[listKey(edit.type)];
      const index = list.findIndex((p) => p.id === edit.profile?.id);
      if (index < 0) list.push(structuredClone(edit.profile));
      else list[index] = structuredClone(edit.profile);
    } else {
      if (!scopes.includes(edit.scope)) throw new Error("Invalid policy edit scope");
      policyId(edit.id);
      const list = next.profiles[listKey(edit.scope)];
      const index = list.findIndex((p) => p.id === edit.id);
      if (index < 0) throw new Error("Unknown policy scope ID");
      const overrides = next.overrides.filter((p) => p.scope !== edit.scope || p.id !== edit.id);
      if (edit.type === "override" || edit.type === "preset") {
        keys(
          edit,
          edit.type === "override"
            ? ["type", "scope", "id", "values"]
            : ["type", "scope", "id", "preset"],
        );
        const values = edit.type === "preset" ? POLICY_PRESETS[edit.preset] : edit.values;
        if (!values) throw new Error("Unknown policy preset");
        validateValues(values);
        const existing = next.overrides.find(
          (p) => p.scope === edit.scope && p.id === edit.id,
        )?.values;
        next.overrides = [
          ...overrides,
          {
            scope: edit.scope,
            id: edit.id,
            values: { ...(edit.type === "override" ? existing : {}), ...values },
          },
        ];
      } else if (edit.type === "reset") {
        keys(edit, ["type", "scope", "id", "to"]);
        if (!["inherited", "authored"].includes(edit.to)) throw new Error("Unknown reset target");
        next.overrides = overrides;
        if (edit.to === "authored") {
          const authored = next.authored[listKey(edit.scope)].find((p) => p.id === edit.id);
          if (authored) list[index] = structuredClone(authored);
          else list[index] = { ...list[index], values: {} };
        }
      } else if (edit.type === "remove") {
        keys(edit, ["type", "scope", "id"]);
        list.splice(index, 1);
        next.overrides = overrides;
      } else throw new Error("Unknown policy edit");
    }
  }
  next.revision++;
  validatePolicyState(next);
  return canonical(next);
}
function areaProfiles(state: PolicyState, areaId: string) {
  const area = state.profiles.areas.find((p) => p.id === areaId);
  if (!area) throw new Error(`Unknown body area: ${areaId}`);
  const land = state.profiles.lands.find((p) => p.id === area.landId)!;
  return { area, land, regions: state.profiles.regions.filter((r) => r.areaId === areaId) };
}
function containingRegions(
  state: PolicyState,
  candidates: RegionProfile[],
  x: number,
  y: number,
  previous: readonly string[],
): RegionProfile[] {
  return candidates
    .filter((region) =>
      containsRegion(
        region.shape,
        x,
        y,
        previous.includes(region.id) ? state.boundaryMargin : -state.boundaryMargin,
      ),
    )
    .sort((a, b) => a.priority - b.priority || compareIds(b.id, a.id));
}
export function resolvePolicy(
  state: PolicyState,
  areaId: string,
  x: number,
  y: number,
  previous: readonly string[] = [],
): ResolvedPolicy {
  const { area, land, regions } = areaProfiles(state, areaId);
  return composePolicy(state, area, land, containingRegions(state, regions, x, y, previous));
}
/** Values depend only on the state, the area and its ordered containing regions. */
function composePolicy(
  state: PolicyState,
  area: AreaProfile,
  land: LandProfile,
  regions: RegionProfile[],
): ResolvedPolicy {
  const values = { ...POLICY_DEFAULTS },
    provenance = {} as ResolvedPolicy["provenance"];
  for (const key of Object.keys(POLICY_DEFAULTS) as (keyof typeof POLICY_DEFAULTS)[])
    provenance[key] = "engine-default";
  const apply = (patch: PolicyValues, source: string) => {
    for (const key of [
      "worldReactions",
      "dynamicProps",
      "propBlocking",
      "crowdContacts",
      "ambientPhysics",
      "sweptCollision",
      "destruction",
    ] as const)
      if (patch[key] !== undefined) {
        values[key] = patch[key];
        provenance[key] = source;
      }
    for (const key of ["impulseStrength", "materialDurability", "debrisLifetime"] as const)
      if (patch[key] !== undefined) {
        values[key] = patch[key];
        provenance[key] = source;
      }
  };
  apply(land.values, `land:${land.id}/profile`);
  apply(area.values, `area:${area.id}/profile`);
  for (const region of regions) apply(region.values, `region:${region.id}/profile`);
  for (const [scope, id] of [
    ["land", land.id],
    ["area", area.id],
    ...regions.map((r) => ["region", r.id]),
  ] as [PolicyScope, string][]) {
    const override = state.overrides.find((p) => p.scope === scope && p.id === id);
    if (override) apply(override.values, `${scope}:${id}/override`);
  }
  if (!state.masterWorldReactions) {
    values.worldReactions = false;
    provenance.worldReactions = "session-master-off";
  }
  return {
    values,
    effective: {
      ...values,
      dynamicProps: values.worldReactions && values.dynamicProps,
      propBlocking: values.worldReactions && values.propBlocking,
      crowdContacts: values.worldReactions && values.crowdContacts,
      ambientPhysics: values.worldReactions && values.ambientPhysics,
      sweptCollision: values.worldReactions && values.sweptCollision,
      destruction: values.worldReactions && values.destruction,
    },
    provenance,
    landId: land.id,
    areaId: area.id,
    regions: regions.map((p) => p.id),
  };
}
function freezeResolved(policy: ResolvedPolicy): ResolvedPolicy {
  Object.freeze(policy.values);
  Object.freeze(policy.effective);
  Object.freeze(policy.provenance);
  Object.freeze(policy.regions);
  return Object.freeze(policy);
}
export class PolicyController {
  private state: PolicyState;
  private pending: PolicyTransaction[] = [];
  private projected: PolicyState;
  constructor(checkpoint?: PolicyCheckpoint) {
    if (checkpoint) {
      object(checkpoint);
      keys(checkpoint, ["state", "pending"]);
      if (!checkpoint.state) throw new Error("Missing policy state");
    }
    this.state = structuredClone(checkpoint?.state ?? defaultPolicyState());
    validatePolicyState(this.state);
    this.projected = this.state;
    if (checkpoint) {
      if (!Array.isArray(checkpoint.pending) || checkpoint.pending.length > 256)
        throw new Error("Invalid pending policy queue");
      for (const transaction of checkpoint.pending) this.configure(transaction);
    }
  }
  configure(transaction: PolicyTransaction) {
    if (this.pending.length >= 256) throw new Error("Policy queue limit reached");
    const next = editPolicies(this.projected, transaction);
    this.pending.push(structuredClone(transaction));
    this.projected = next;
    return { queued: true, revision: this.state.revision, nextRevision: next.revision };
  }
  apply(expectedRevision = this.projected.revision) {
    if (expectedRevision !== this.projected.revision)
      throw new Error(`Stale apply revision: expected ${this.projected.revision}`);
    const changed = this.pending.length > 0;
    this.state = this.projected;
    this.pending = [];
    return changed;
  }
  /** Per-state memo of `resolvePolicy`. States are replaced, never mutated, so identity
   * invalidates it. Only region containment is position-dependent; every creature in the same
   * area and region set shares one frozen result. */
  private memo?: {
    state: PolicyState;
    areas: Map<string, ReturnType<typeof areaProfiles>>;
    results: Map<string, ResolvedPolicy>;
  };
  resolve(areaId: string, x: number, y: number, previous: readonly string[] = []) {
    let memo = this.memo;
    if (memo?.state !== this.state)
      memo = this.memo = { state: this.state, areas: new Map(), results: new Map() };
    let profiles = memo.areas.get(areaId);
    if (!profiles) {
      profiles = areaProfiles(this.state, areaId);
      memo.areas.set(areaId, profiles);
    }
    const regions = profiles.regions.length
      ? containingRegions(this.state, profiles.regions, x, y, previous)
      : profiles.regions;
    const key = regions.length
      ? `${areaId}\u0000${regions.map((r) => r.id).join("\u0000")}`
      : areaId;
    let resolved = memo.results.get(key);
    if (!resolved) {
      resolved = freezeResolved(composePolicy(this.state, profiles.area, profiles.land, regions));
      memo.results.set(key, resolved);
    }
    return resolved;
  }
  inspect() {
    return {
      ...this.save(),
      nextRevision: this.projected.revision,
      preview: structuredClone(this.projected),
      capabilities: Object.keys(POLICY_DEFAULTS),
      presets: structuredClone(POLICY_PRESETS),
    };
  }
  save(): PolicyCheckpoint {
    return { state: structuredClone(this.state), pending: structuredClone(this.pending) };
  }
}
