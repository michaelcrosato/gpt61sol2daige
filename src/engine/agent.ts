import { ARCHETYPES, type AreaRecipe, areaRecipe, MECHANICS, THEMES } from "../game/content.ts";
import { SKILLS } from "../game/skills.ts";
import type { AdventureAction } from "../game/types.ts";
import type { PolicyEdit } from "../physics/policies.ts";
import { createPlayground } from "../physics/runtime.ts";
import type { BodyRecipe } from "../physics/types.ts";
import { ENGINE_VERSION, idleInput, MAX_NPCS, type SaveState, Simulation } from "./simulation.ts";
import { LANDMARKS, WORLD_LIMIT } from "./world.ts";

export const COMMANDS = {
  physics: {
    action:
      "inspect (default), reset, close, spawn, impulse, sweep, configure, apply, policy, place, drive",
    body: "spawn: BodyRecipe {id,motion:dynamic|fixed,shape:{kind:circle,radius}|{kind:box,width,height},x,y,angle?,mass?,friction?,restitution?,damping?,ccd?,role?:prop|terrain|actor,areaId?,consequences?:{destroyed,claimed,durability?}}",
    id: "impulse: stable body ID",
    x: "impulse x in kg·Fern units/s; finite ±100000",
    y: "impulse y in kg·Fern units/s; finite ±100000",
    atX: "optional world-space application point; provide both atX and atY to spin",
    atY: "optional world-space application point",
    expectedRevision:
      "configure: policies.nextRevision; apply: expected final queued revision (browser must be paused)",
    edits:
      "configure: atomic PolicyEdit[]; master {enabled}, margin {value}, land/area/region {profile}, override {scope,id,values}, preset {scope,id,preset:Quiet|Reactive|Wild|Sanctuary}, reset {scope,id,to:inherited|authored}, remove {scope,id}",
    profiles:
      "land {id,values}; area {id,landId,values}; region {id,areaId,priority,shape,values}. shape: circle {x,y,radius}, rectangle {x,y,width,height} (top-left), polygon {points:[{x,y}]}",
    values:
      "worldReactions, dynamicProps, propBlocking, crowdContacts, ambientPhysics (adventure), sweptCollision: boolean; impulseStrength: finite 0..10. Omitted values inherit. More-specific debug overrides win; session master-off is absolute.",
    areaId: "policy: inspect effective values/provenance at x,y in this area (default playground)",
    placement:
      "place: id,x,y relocates the existing lab body, clears motion and corrects wake overlaps; drive: id,x,y sets contact actor velocity (±600 units/s)",
    description:
      "Separate solo Rapier playground; step/save/restore/replay include it. Use actors for the integrated adventure physical world.",
  },
  actors: {
    action: "inspect (default), body, configure, apply, policy, impulse, place, spawn",
    description:
      "Solo adventure physical world. Uses the same revisioned policies; active actors, occupied terrain, props and regional ambient handover. Actual co-op uses the supported legacy path until M04.",
    values:
      "worldReactions, dynamicProps, propBlocking, crowdContacts, ambientPhysics, sweptCollision: booleans; impulseStrength: 0..10",
    id: "body/impulse/place: player-<player id>, enemy-<id>, ambient-<slot>-<generation>, crate-<area>-<ordinal>, wheel-<area>",
    body: "spawn: prop BodyRecipe with id prefixed prop- and a current areaId",
  },
  adventure: {
    action:
      "A game action: depart, advance, return, rest, respawn, skill, equip, buy, sell, sell-spares, respec, tuning or new-run",
    description: "Omit action to observe the run and local build",
  },
  encounter: {
    index: "positive area index; agent/debug preview",
    recipe: "optional validated modular AreaRecipe",
  },
  catalog: { description: "Inspect mechanics, themes, archetypes and all 48 skill nodes" },
  observe: { description: "Compact world state, quest, performance, hash and recent events" },
  step: { ticks: "integer 0..36000; advances the exact fixed simulation" },
  input: {
    player: "player id (default local)",
    x: "-1..1",
    y: "-1..1",
    dash: "boolean",
    pulse: "boolean",
    interact: "boolean",
    attack: "boolean; primary melee combo",
    lance: "boolean; unlocked Thornlance",
    nova: "boolean; unlocked Bloom Nova",
    potion: "boolean; healing flask",
    aimX: "aim direction -1..1; (0,0) selects auto-aim",
    aimY: "aim direction -1..1; pair with aimX",
  },
  teleport: { x: "world coordinate", y: "world coordinate", player: "optional player id" },
  population: { count: `integer 0..${MAX_NPCS}` },
  paint: {
    tx: "tile x",
    ty: "tile y",
    width: "brush width in tiles",
    height: "brush height in tiles",
    terrain: "0 forest, 1 meadow, 2 sand, 3 water, 4 deep water, 5 path, 6 stone",
    decor: "0 none, 1 pine, 2 oak, 3 rock, 4 flower, 5 reeds, 6 mushroom, 7 crystal",
  },
  reset: { seed: "unsigned 32-bit integer", count: "optional NPC count" },
  join: { id: "unique player id", name: "display name; up to 8 players" },
  leave: { id: "player id" },
  inspect: {
    x: "world coordinate",
    y: "world coordinate",
    radius: "0..5000; default 100",
    limit: "0..100; default 20",
  },
  save: { description: "Complete versioned checkpoint, safe to persist as JSON" },
  restore: { state: "a valid version 1 checkpoint" },
  replay: { description: "Return initial checkpoint and executed command log" },
  describe: { description: "This command schema and engine limits" },
} as const;
export type Command = { op: string; [key: string]: unknown };
export interface Replay {
  version: 1;
  initial: SaveState;
  commands: Command[];
  hash: string;
}
export class AgentRuntime {
  sim: Simulation;
  readonly log: Command[] = [];
  initial: SaveState;
  localId = "local";
  constructor(sim = new Simulation()) {
    this.sim = sim;
    if (!sim.players.size) sim.addPlayer(this.localId);
    this.localId = sim.players.keys().next().value!;
    this.initial = sim.save();
  }
  beginRecording(): void {
    this.initial = this.sim.save();
    this.log.length = 0;
  }
  execute(command: Command, record = true): unknown {
    if (
      !command ||
      typeof command !== "object" ||
      Array.isArray(command) ||
      typeof command.op !== "string"
    )
      throw new Error("Expected a command object with an op string");
    const num = (key: string, fallback?: number) => {
      const v = command[key] ?? fallback;
      if (typeof v !== "number" || !Number.isFinite(v))
        throw new Error(`${key} must be a finite number`);
      return v;
    };
    const player = typeof command.player === "string" ? command.player : this.localId;
    let result: unknown;
    switch (command.op) {
      case "actors": {
        const physical = this.sim.physical;
        if (!physical || this.sim.players.size > 1)
          throw new Error("Adventure physical controls are solo-only until M04");
        const action = command.action ?? "inspect",
          world = physical.world;
        if (action === "inspect") return physical.inspect();
        if (action === "body") {
          if (typeof command.id !== "string") throw new Error("Body id required");
          return world.pose(command.id);
        }
        if (action === "policy")
          return world.policyAt(
            typeof command.areaId === "string"
              ? command.areaId
              : physical.areaAt(this.sim, num("x", 0), num("y", 0)),
            num("x", 0),
            num("y", 0),
          );
        if (action === "configure")
          result = physical.configure({
            expectedRevision: num("expectedRevision"),
            edits: command.edits as PolicyEdit[],
          });
        else if (action === "apply") {
          world.applyPolicies(num("expectedRevision"));
          physical.begin(this.sim);
        } else if (action === "spawn") {
          const body = command.body as BodyRecipe;
          if (body?.role !== "prop" || !body.id?.startsWith("prop-"))
            throw new Error("Adventure spawns require prop- identity and prop role");
          world.spawn(body);
        } else if (action === "impulse" || action === "place") {
          if (typeof command.id !== "string") throw new Error("Body id required");
          if (action === "impulse")
            world.impulse(
              command.id,
              num("x", 0),
              num("y", 0),
              command.atX === undefined ? undefined : num("atX"),
              command.atY === undefined ? undefined : num("atY"),
            );
          else {
            const pose = world.pose(command.id);
            if (pose.role !== "prop")
              throw new Error("Use teleport for players; place is for optional props");
            world.place(command.id, num("x"), num("y"));
          }
        } else throw new Error(`Unknown actor physics action: ${String(action)}`);
        result ??= physical.inspect();
        break;
      }
      case "physics": {
        const action = command.action ?? "inspect";
        if (action === "inspect") return this.sim.playground?.inspect() ?? { active: false };
        if (action === "policy") {
          if (!this.sim.playground) throw new Error("Open the playground first");
          return this.sim.playground.policyAt(
            typeof command.areaId === "string" ? command.areaId : "playground",
            num("x", 0),
            num("y", 0),
          );
        }
        if (this.sim.players.size > 1) throw new Error("Physics playground is solo-only until M04");
        if (action === "reset" || action === "close") {
          const next = action === "reset" ? createPlayground() : null;
          this.sim.playground?.dispose();
          this.sim.playground = next;
        } else {
          const world = this.sim.playground;
          if (!world) throw new Error("Open the physics playground with physics/reset first");
          if (action === "spawn") world.spawn(command.body as BodyRecipe);
          else if (action === "configure")
            result = world.configure({
              expectedRevision: num("expectedRevision"),
              edits: command.edits as PolicyEdit[],
            });
          else if (action === "apply") result = world.applyPolicies(num("expectedRevision"));
          else if (action === "place" || action === "drive") {
            if (typeof command.id !== "string") throw new Error("Physics body id is required");
            if (action === "place") world.place(command.id, num("x"), num("y"));
            else world.drive(command.id, num("x", 0), num("y", 0));
          } else if (action === "impulse") {
            if (typeof command.id !== "string") throw new Error("Physics body id is required");
            world.impulse(
              command.id,
              num("x", 0),
              num("y", 0),
              command.atX === undefined ? undefined : num("atX"),
              command.atY === undefined ? undefined : num("atY"),
            );
          } else if (action === "sweep") result = world.sweep();
          else throw new Error(`Unknown physics action: ${String(action)}`);
        }
        result ??= this.sim.playground?.inspect() ?? { active: false };
        break;
      }
      case "describe":
        return {
          engine: "Fern",
          version: ENGINE_VERSION,
          commands: COMMANDS,
          limits: { world: [-WORLD_LIMIT, WORLD_LIMIT], npcs: MAX_NPCS, players: 8, tickHz: 60 },
          landmarks: LANDMARKS,
        };
      case "observe":
        return this.sim.observe();
      case "save":
        return this.sim.save();
      case "replay":
        return {
          version: 1,
          initial: this.initial,
          commands: structuredClone(this.log),
          hash: this.sim.stateHash(),
        } satisfies Replay;
      case "step":
        this.sim.step(num("ticks", 1));
        break;
      case "input":
        this.sim.setInput(player, {
          ...idleInput(),
          x: num("x", 0),
          y: num("y", 0),
          dash: command.dash === true,
          pulse: command.pulse === true,
          interact: command.interact === true,
          attack: command.attack === true,
          lance: command.lance === true,
          nova: command.nova === true,
          potion: command.potion === true,
          aimX: num("aimX", 0),
          aimY: num("aimY", 0),
        });
        break;
      case "population":
        this.sim.setPopulation(num("count"));
        break;
      case "adventure":
        if (!command.action) return this.sim.adventure.observe(player, this.sim.tick);
        this.sim.adventure.action(this.sim, player, command.action as AdventureAction);
        break;
      case "encounter":
        this.sim.adventure.startArea(
          this.sim,
          num("index", 1),
          command.recipe as AreaRecipe | undefined,
        );
        break;
      case "catalog":
        return {
          mechanics: MECHANICS,
          themes: THEMES,
          archetypes: ARCHETYPES,
          skills: SKILLS,
          exampleArea: areaRecipe(this.sim.adventure.state.seed, num("index", 1)),
        };
      case "paint":
        this.sim.world.paint(
          num("tx"),
          num("ty"),
          num("width", 1),
          num("height", 1),
          num("terrain"),
          num("decor", 0),
        );
        break;
      case "teleport":
        this.sim.teleport(player, num("x"), num("y"));
        break;
      case "reset": {
        const seed = num("seed");
        if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
          throw new Error("seed must be an unsigned 32-bit integer");
        const next = new Simulation(seed, num("count", this.sim.count));
        next.addPlayer(this.localId);
        this.sim.dispose();
        this.sim = next;
        break;
      }
      case "join":
        if (typeof command.id !== "string") throw new Error("id is required");
        this.sim.addPlayer(
          command.id,
          typeof command.name === "string" ? command.name : "Wayfarer",
        );
        break;
      case "leave":
        if (typeof command.id !== "string") throw new Error("id is required");
        this.sim.removePlayer(command.id);
        break;
      case "restore": {
        const next = Simulation.restore(command.state as SaveState);
        this.sim.dispose();
        this.sim = next;
        this.localId = this.sim.players.keys().next().value ?? "local";
        if (!this.sim.players.size) this.sim.addPlayer(this.localId);
        break;
      }
      case "inspect": {
        const x = num("x"),
          y = num("y"),
          radius = num("radius", 100),
          limit = num("limit", 20);
        if (
          Math.abs(x) > WORLD_LIMIT ||
          Math.abs(y) > WORLD_LIMIT ||
          radius < 0 ||
          radius > 5000 ||
          !Number.isInteger(limit) ||
          limit < 0 ||
          limit > 100
        )
          throw new Error("Inspection bounds exceeded");
        const entities = [];
        for (let i = 0; i < this.sim.count && entities.length < limit; i++)
          if (Math.hypot(this.sim.x[i] - x, this.sim.y[i] - y) <= radius)
            entities.push({
              id: i,
              x: this.sim.x[i],
              y: this.sim.y[i],
              kind: ["wisp", "deer", "beetle"][this.sim.kind[i]],
              attuned: this.sim.attuned[i] === 1,
            });
        return { tile: this.sim.world.at(x, y), biome: this.sim.world.biome(x, y), entities };
      }
      default:
        throw new Error(`Unknown command: ${command.op}`);
    }
    if (record) this.log.push(structuredClone(command));
    return result ?? this.sim.observe();
  }
}
export function replay(recording: Replay): Simulation {
  if (
    !recording ||
    recording.version !== 1 ||
    !Array.isArray(recording.commands) ||
    recording.commands.length > 1_000_000
  )
    throw new Error("Invalid replay");
  const agent = new AgentRuntime(Simulation.restore(recording.initial));
  try {
    for (const command of recording.commands) agent.execute(command, false);
    const hash = agent.sim.stateHash();
    if (hash !== recording.hash)
      throw new Error(`Replay diverged: expected ${recording.hash}, got ${hash}`);
    return agent.sim;
  } catch (error) {
    agent.sim.dispose();
    throw error;
  }
}
