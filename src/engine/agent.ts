import { ENGINE_VERSION, idleInput, MAX_NPCS, type SaveState, Simulation } from "./simulation.ts";
import { LANDMARKS, WORLD_LIMIT } from "./world.ts";

export const COMMANDS = {
  observe: { description: "Compact world state, quest, performance, hash and recent events" },
  step: { ticks: "integer 0..36000; advances the exact fixed simulation" },
  input: {
    player: "player id (default local)",
    x: "-1..1",
    y: "-1..1",
    dash: "boolean",
    pulse: "boolean",
    interact: "boolean",
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
    switch (command.op) {
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
        });
        break;
      case "population":
        this.sim.setPopulation(num("count"));
        break;
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
      case "restore":
        this.sim = Simulation.restore(command.state as SaveState);
        this.localId = this.sim.players.keys().next().value ?? "local";
        if (!this.sim.players.size) this.sim.addPlayer(this.localId);
        break;
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
    return this.sim.observe();
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
  for (const command of recording.commands) agent.execute(command, false);
  if (agent.sim.stateHash() !== recording.hash)
    throw new Error(`Replay diverged: expected ${recording.hash}, got ${agent.sim.stateHash()}`);
  return agent.sim;
}
