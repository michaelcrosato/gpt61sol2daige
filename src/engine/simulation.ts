import { checksum, clamp, distance, hash, random } from "./math.ts";
import { type Body, collideCircles, moveBody, SpatialHash } from "./physics.ts";
import {
  Decor,
  LANDMARKS,
  Terrain,
  type TerrainPatch,
  TILE,
  validatePatches,
  WORLD_LIMIT,
  World,
} from "./world.ts";

export const ENGINE_VERSION = "1.0.0";
export const STEP = 1 / 60;
export const MAX_NPCS = 8192;
export const MAX_PLAYERS = 8;
export type Input = { x: number; y: number; dash: boolean; pulse: boolean; interact: boolean };
export const idleInput = (): Input => ({ x: 0, y: 0, dash: false, pulse: false, interact: false });
export interface Player extends Body {
  id: string;
  name: string;
  color: number;
  px: number;
  py: number;
  facing: number;
  energy: number;
  pulseCooldown: number;
  dashCooldown: number;
  input: Input;
  lastInteract: boolean;
  steps: number;
}
export interface GameEvent {
  tick: number;
  type: "pulse" | "dash" | "shard" | "beacon" | "rest";
  x: number;
  y: number;
  player: string;
  message: string;
}
export interface SaveState {
  version: 1;
  seed: number;
  tick: number;
  count: number;
  shards: number;
  beacons: string[];
  collected: string[];
  patches: TerrainPatch[];
  players: Player[];
  npcs: {
    x: number[];
    y: number[];
    vx: number[];
    vy: number[];
    kind: number[];
    attuned: number[];
    generation: number[];
  };
}
export class Simulation {
  world: World;
  tick = 0;
  count = 0;
  shards = 0;
  readonly beacons = new Set<string>();
  readonly collected = new Set<string>();
  readonly players = new Map<string, Player>();
  readonly events: GameEvent[] = [];
  readonly x = new Float64Array(MAX_NPCS);
  readonly y = new Float64Array(MAX_NPCS);
  readonly px = new Float64Array(MAX_NPCS);
  readonly py = new Float64Array(MAX_NPCS);
  readonly vx = new Float32Array(MAX_NPCS);
  readonly vy = new Float32Array(MAX_NPCS);
  readonly kind = new Uint8Array(MAX_NPCS);
  readonly attuned = new Uint8Array(MAX_NPCS);
  readonly generation = new Uint32Array(MAX_NPCS);
  readonly grid = new SpatialHash(MAX_NPCS);
  metrics = { contacts: 0, near: 0, far: 0, stepMs: 0 };
  private readonly a: Body = { x: 0, y: 0, vx: 0, vy: 0, radius: 3 };
  private readonly b: Body = { x: 0, y: 0, vx: 0, vy: 0, radius: 3 };

  constructor(seed = 142, population = 2400) {
    this.world = new World(seed);
    this.setPopulation(population);
  }
  addPlayer(id: string, name = "Wayfarer"): Player {
    const existing = this.players.get(id);
    if (existing) return existing;
    if (this.players.size >= MAX_PLAYERS) throw new Error("This expedition is full (8 players).");
    if (!/^[\w-]{1,80}$/.test(id)) throw new Error("Invalid player id");
    const color = [...Array(MAX_PLAYERS).keys()].find(
      (i) => ![...this.players.values()].some((p) => p.color === i),
    )!;
    const x = color * 15 - 20,
      y = 34;
    const p: Player = {
      id,
      name: name.slice(0, 24),
      color,
      x,
      y,
      px: x,
      py: y,
      vx: 0,
      vy: 0,
      radius: 6,
      facing: Math.PI / 2,
      energy: 100,
      pulseCooldown: 0,
      dashCooldown: 0,
      input: idleInput(),
      lastInteract: false,
      steps: 0,
    };
    this.players.set(id, p);
    return p;
  }
  removePlayer(id: string): void {
    this.players.delete(id);
  }
  setInput(id: string, input: Partial<Input>): void {
    const p = this.players.get(id);
    if (!p) throw new Error("Unknown player");
    p.input = {
      x: typeof input.x === "number" && Number.isFinite(input.x) ? clamp(input.x, -1, 1) : 0,
      y: typeof input.y === "number" && Number.isFinite(input.y) ? clamp(input.y, -1, 1) : 0,
      dash: input.dash === true,
      pulse: input.pulse === true,
      interact: input.interact === true,
    };
  }
  setPopulation(count: number): void {
    if (!Number.isInteger(count) || count < 0 || count > MAX_NPCS)
      throw new Error(`Population must be an integer from 0 to ${MAX_NPCS}`);
    const center = this.players.values().next().value;
    for (let i = this.count; i < count; i++) this.spawn(i, center?.x ?? 0, center?.y ?? 0);
    this.count = count;
  }
  private spawn(i: number, x: number, y: number): void {
    const point = this.world.spawnPoint(hash(i, this.generation[i], this.world.seed), x, y);
    this.x[i] = this.px[i] = point.x;
    this.y[i] = this.py[i] = point.y;
    this.vx[i] = this.vy[i] = 0;
    this.kind[i] = hash(i, this.generation[i], 32) % 3;
    this.attuned[i] = 0;
  }
  teleport(id: string, x: number, y: number): void {
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      Math.abs(x) > WORLD_LIMIT - 32 ||
      Math.abs(y) > WORLD_LIMIT - 32
    )
      throw new Error("Position is outside the world bounds");
    const p = this.players.get(id);
    if (!p) throw new Error("Unknown player");
    if (!this.world.walkable(x, y))
      throw new Error("Destination is blocked; choose walkable terrain");
    p.x = p.px = x;
    p.y = p.py = y;
    p.vx = p.vy = 0;
  }
  private emit(type: GameEvent["type"], p: Player, message: string): void {
    this.events.push({ tick: this.tick, type, x: p.x, y: p.y, player: p.id, message });
    if (this.events.length > 128) this.events.shift();
  }
  private interact(p: Player): void {
    for (const l of LANDMARKS) {
      if (distance(p.x, p.y, l.x, l.y) > 58) continue;
      if (l.kind === "camp") {
        p.energy = 100;
        this.emit("rest", p, "A moment of rest. Energy restored.");
        return;
      }
      if (this.beacons.has(l.id)) {
        this.emit("rest", p, "This beacon is already shining.");
        return;
      }
      if (this.shards < 3) {
        this.emit("rest", p, "Gather 3 light shards to kindle this beacon.");
        return;
      }
      this.shards -= 3;
      this.beacons.add(l.id);
      this.emit(
        "beacon",
        p,
        this.beacons.size === 3
          ? "Every beacon is alight. The forest remembers you."
          : `${l.name} is alight.`,
      );
      return;
    }
    const tx = Math.floor(p.x / TILE),
      ty = Math.floor(p.y / TILE);
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const key = `${tx + dx},${ty + dy}`;
        if (this.world.tile(tx + dx, ty + dy).decor === Decor.Crystal && !this.collected.has(key)) {
          this.collected.add(key);
          this.shards++;
          this.emit("shard", p, "A light shard, tucked into your satchel.");
          return;
        }
      }
    this.emit("rest", p, "No beacon or crystal nearby. Pulse near wisps to gather light.");
  }
  private pulse(p: Player): void {
    if (p.pulseCooldown > 0) return;
    p.pulseCooldown = 1.2;
    let found = 0;
    for (let i = 0; i < this.count; i++) {
      const dx = this.x[i] - p.x,
        dy = this.y[i] - p.y,
        d = Math.hypot(dx, dy);
      if (d > 100) continue;
      const force = (1 - d / 110) * 200;
      this.vx[i] += (dx / Math.max(d, 1)) * force;
      this.vy[i] += (dy / Math.max(d, 1)) * force;
      if (this.kind[i] === 0 && !this.attuned[i]) {
        this.attuned[i] = 1;
        found++;
      }
    }
    this.shards += found;
    this.emit(
      "pulse",
      p,
      found
        ? `The wisps share ${found} light shard${found === 1 ? "" : "s"}.`
        : "A ripple of light through the trees.",
    );
  }
  step(steps = 1): void {
    if (!Number.isInteger(steps) || steps < 0 || steps > 36000)
      throw new Error("Step count must be 0–36000");
    const start = performance.now();
    for (let n = 0; n < steps; n++) this.fixedStep();
    this.metrics.stepMs = steps ? (performance.now() - start) / steps : 0;
  }
  private fixedStep(): void {
    this.tick++;
    this.metrics.contacts = 0;
    this.metrics.near = 0;
    this.metrics.far = 0;
    const players = [...this.players.values()];
    for (const p of players) {
      p.px = p.x;
      p.py = p.y;
      p.pulseCooldown = Math.max(0, p.pulseCooldown - STEP);
      p.dashCooldown = Math.max(0, p.dashCooldown - STEP);
      p.energy = Math.min(100, p.energy + STEP * 17);
      let ix = p.input.x,
        iy = p.input.y;
      const length = Math.hypot(ix, iy);
      if (length > 1) {
        ix /= length;
        iy /= length;
      }
      if (length > 0) p.facing = Math.atan2(iy, ix);
      const wading = this.world.at(p.x, p.y).terrain === Terrain.Water;
      const speed = wading ? 58 : 115;
      p.vx += (ix * speed - p.vx) * 0.18;
      p.vy += (iy * speed - p.vy) * 0.18;
      if (p.input.dash && p.dashCooldown === 0 && p.energy >= 28) {
        p.vx = Math.cos(p.facing) * 520;
        p.vy = Math.sin(p.facing) * 520;
        p.energy -= 28;
        p.dashCooldown = 0.55;
        this.emit("dash", p, "");
      }
      if (p.input.pulse) this.pulse(p);
      if (p.input.interact && !p.lastInteract) this.interact(p);
      p.lastInteract = p.input.interact;
      this.metrics.contacts += moveBody(this.world, p, STEP);
      p.steps += distance(p.px, p.py, p.x, p.y);
    }
    for (let i = 0; i < this.count; i++) {
      this.px[i] = this.x[i];
      this.py[i] = this.y[i];
      let nearest = Infinity;
      let focus: Player | undefined;
      for (const p of players) {
        const d = (p.x - this.x[i]) ** 2 + (p.y - this.y[i]) ** 2;
        if (d < nearest) {
          nearest = d;
          focus = p;
        }
      }
      // Recycle dormant population around every party member, regardless of their separation.
      if (nearest > 2200 ** 2 && players.length && this.tick % 60 === i % 60) {
        const anchor = players[i % players.length];
        this.generation[i]++;
        this.spawn(i, anchor.x, anchor.y);
        continue;
      }
      const near = nearest < 420 ** 2;
      if (near) this.metrics.near++;
      else this.metrics.far++;
      // Expensive steering and static contacts use 15 Hz outside player interest. Bodies still integrate at 60 Hz.
      if (near || (this.tick + i) % 4 === 0) {
        const interval = near ? 1 : 4;
        const angle =
          random(i, this.generation[i], this.world.seed) * 6.283 +
          Math.sin(this.tick / 210 + i * 0.72) * 1.8;
        const speed = this.kind[i] === 1 ? 13 : 8;
        let targetX = Math.cos(angle) * speed,
          targetY = Math.sin(angle) * speed;
        if (focus && nearest < 40 ** 2 && this.kind[i] === 1) {
          const inv = 50 / Math.max(Math.sqrt(nearest), 1);
          targetX += (this.x[i] - focus.x) * inv;
          targetY += (this.y[i] - focus.y) * inv;
        }
        this.vx[i] += (targetX - this.vx[i]) * 0.035 * interval;
        this.vy[i] += (targetY - this.vy[i]) * 0.035 * interval;
      }
      this.a.x = this.x[i];
      this.a.y = this.y[i];
      this.a.vx = this.vx[i];
      this.a.vy = this.vy[i];
      this.a.radius = this.kind[i] === 1 ? 4 : 2.5;
      if (near || (this.tick + i) % 4 === 0)
        this.metrics.contacts += moveBody(this.world, this.a, STEP);
      else {
        this.a.x += this.a.vx * STEP;
        this.a.y += this.a.vy * STEP;
      }
      this.x[i] = this.a.x;
      this.y[i] = this.a.y;
      this.vx[i] = this.a.vx;
      this.vy[i] = this.a.vy;
    }
    this.grid.build(this.x, this.y, this.count);
    // Impulse collisions are applied in stable id order, preserving deterministic replays.
    for (let i = 0; i < this.count; i++) {
      this.grid.query(this.x[i], this.y[i], 9, (j) => {
        if (j <= i) return;
        if (Math.abs(this.x[i] - this.x[j]) > 9 || Math.abs(this.y[i] - this.y[j]) > 9) return;
        this.a.x = this.x[i];
        this.a.y = this.y[i];
        this.a.vx = this.vx[i];
        this.a.vy = this.vy[i];
        this.a.radius = this.kind[i] === 1 ? 4 : 2.5;
        this.b.x = this.x[j];
        this.b.y = this.y[j];
        this.b.vx = this.vx[j];
        this.b.vy = this.vy[j];
        this.b.radius = this.kind[j] === 1 ? 4 : 2.5;
        if (collideCircles(this.a, this.b)) {
          this.x[i] = this.a.x;
          this.y[i] = this.a.y;
          this.vx[i] = this.a.vx;
          this.vy[i] = this.a.vy;
          this.x[j] = this.b.x;
          this.y[j] = this.b.y;
          this.vx[j] = this.b.vx;
          this.vy[j] = this.b.vy;
          this.metrics.contacts++;
        }
      });
    }
    for (let a = 0; a < players.length; a++) {
      for (let b = a + 1; b < players.length; b++)
        if (collideCircles(players[a], players[b], 3, 3)) this.metrics.contacts++;
    }
  }
  stateHash(): string {
    let h = checksum([this.world.seed, this.tick, this.count, this.shards]);
    for (const array of [
      this.x,
      this.y,
      this.vx,
      this.vy,
      this.kind,
      this.attuned,
      this.generation,
    ])
      h = checksum(array.subarray(0, this.count), h);
    for (const p of this.players.values()) {
      h = checksum(
        [
          p.x,
          p.y,
          p.vx,
          p.vy,
          p.energy,
          p.facing,
          p.pulseCooldown,
          p.dashCooldown,
          p.lastInteract ? 1 : 0,
          p.input.x,
          p.input.y,
          +p.input.dash,
          +p.input.pulse,
          +p.input.interact,
          p.steps,
          p.color,
        ],
        h,
      );
      h = checksum(
        Array.from(p.id + p.name, (c) => c.charCodeAt(0)),
        h,
      );
    }
    h = checksum(
      Array.from([...this.beacons].sort().join("|") + [...this.collected].sort().join("|"), (c) =>
        c.charCodeAt(0),
      ),
      h,
    );
    for (const patch of [...this.world.patches.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]))
      h = checksum(patch, h);
    return h.toString(16).padStart(8, "0");
  }
  observe() {
    return {
      version: ENGINE_VERSION,
      seed: this.world.seed,
      tick: this.tick,
      hash: this.stateHash(),
      population: this.count,
      players: [...this.players.values()].map(({ id, name, x, y, vx, vy, energy }) => ({
        id,
        name,
        x,
        y,
        vx,
        vy,
        energy,
        biome: this.world.biome(x, y),
      })),
      quest: {
        shards: this.shards,
        lit: [...this.beacons],
        total: 3,
        complete: this.beacons.size === 3,
      },
      streaming: {
        resident: this.world.chunks.size,
        limit: this.world.maxChunks,
        generated: this.world.generated,
        evicted: this.world.evicted,
        editedTiles: this.world.patches.size,
      },
      physics: { ...this.metrics },
      events: this.events.slice(-8),
    };
  }
  save(): SaveState {
    return {
      version: 1,
      seed: this.world.seed,
      tick: this.tick,
      count: this.count,
      shards: this.shards,
      beacons: [...this.beacons],
      collected: [...this.collected],
      patches: [...this.world.patches.values()].map((p) => [...p]),
      players: structuredClone([...this.players.values()]),
      npcs: {
        x: Array.from(this.x.subarray(0, this.count)),
        y: Array.from(this.y.subarray(0, this.count)),
        vx: Array.from(this.vx.subarray(0, this.count)),
        vy: Array.from(this.vy.subarray(0, this.count)),
        kind: Array.from(this.kind.subarray(0, this.count)),
        attuned: Array.from(this.attuned.subarray(0, this.count)),
        generation: Array.from(this.generation.subarray(0, this.count)),
      },
    };
  }
  static restore(state: SaveState): Simulation {
    validateSave(state);
    const sim = new Simulation(state.seed, 0);
    if (state.patches?.length) sim.world.setPatches(state.patches);
    sim.tick = state.tick;
    sim.count = state.count;
    sim.shards = state.shards;
    for (const id of state.beacons) sim.beacons.add(id);
    for (const key of state.collected) sim.collected.add(key);
    for (const p of state.players) sim.players.set(p.id, structuredClone(p));
    for (const key of ["x", "y", "vx", "vy", "kind", "attuned", "generation"] as const)
      sim[key].set(state.npcs[key]);
    sim.px.set(sim.x);
    sim.py.set(sim.y);
    return sim;
  }
}

export function validateSave(state: SaveState): void {
  if (
    !state ||
    state.version !== 1 ||
    !Number.isInteger(state.seed) ||
    state.seed < 0 ||
    state.seed > 0xffffffff ||
    !Number.isInteger(state.tick) ||
    state.tick < 0 ||
    !Number.isInteger(state.count) ||
    state.count < 0 ||
    state.count > MAX_NPCS ||
    !Number.isSafeInteger(state.shards) ||
    state.shards < 0 ||
    !Array.isArray(state.players) ||
    state.players.length > MAX_PLAYERS ||
    !Array.isArray(state.beacons) ||
    state.beacons.some((b) => !["north", "west", "south"].includes(b)) ||
    !Array.isArray(state.collected) ||
    state.collected.length > 100000 ||
    state.collected.some((s) => typeof s !== "string" || !/^-?\d+,-?\d+$/.test(s)) ||
    !state.npcs
  )
    throw new Error("Invalid save header");
  validatePatches(state.patches ?? []);
  const ids = new Set<string>();
  for (const p of state.players) {
    if (
      !p ||
      !/^[\w-]{1,80}$/.test(p.id) ||
      ids.has(p.id) ||
      typeof p.name !== "string" ||
      p.name.length > 24 ||
      [
        p.x,
        p.y,
        p.px,
        p.py,
        p.vx,
        p.vy,
        p.radius,
        p.facing,
        p.energy,
        p.pulseCooldown,
        p.dashCooldown,
        p.steps,
        p.color,
      ].some((n) => !Number.isFinite(n)) ||
      Math.abs(p.x) > WORLD_LIMIT ||
      Math.abs(p.y) > WORLD_LIMIT ||
      p.radius !== 6 ||
      Math.abs(p.vx) > 8000 ||
      Math.abs(p.vy) > 8000 ||
      p.energy < 0 ||
      p.energy > 100 ||
      !Number.isInteger(p.color) ||
      p.color < 0 ||
      p.color >= MAX_PLAYERS ||
      !p.input ||
      [p.input.x, p.input.y].some((n) => !Number.isFinite(n) || Math.abs(n) > 1) ||
      [p.input.dash, p.input.pulse, p.input.interact, p.lastInteract].some(
        (b) => typeof b !== "boolean",
      )
    )
      throw new Error("Invalid saved player");
    ids.add(p.id);
  }
  for (const key of ["x", "y", "vx", "vy", "kind", "attuned", "generation"] as const) {
    const values = state.npcs[key];
    if (
      !Array.isArray(values) ||
      values.length !== state.count ||
      values.some((v) => !Number.isFinite(v))
    )
      throw new Error(`Invalid NPC ${key}`);
    if ((key === "vx" || key === "vy") && values.some((v) => Math.abs(v) > 2047))
      throw new Error("NPC velocity out of bounds");
    if ((key === "x" || key === "y") && values.some((v) => Math.abs(v) > WORLD_LIMIT + 4096))
      throw new Error("NPC outside world bounds");
    if (
      (key === "kind" || key === "attuned" || key === "generation") &&
      values.some(
        (v) =>
          !Number.isInteger(v) ||
          v < 0 ||
          v > (key === "kind" ? 2 : key === "attuned" ? 1 : 0xffffffff),
      )
    )
      throw new Error("Invalid NPC attributes");
  }
}
