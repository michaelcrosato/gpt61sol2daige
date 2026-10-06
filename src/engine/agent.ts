import {
  ARCHETYPES,
  type AreaRecipe,
  areaRecipe,
  MECHANICS,
  type RigKind,
  THEMES,
} from "../game/content.ts";
import { attackExport } from "../game/interactions.ts";
import { enemyPose, rigExport } from "../game/rigs.ts";
import { SKILLS } from "../game/skills.ts";
import type { AdventureAction } from "../game/types.ts";
import { adventureAreaAt } from "../physics/adventure.ts";
import { blueprintExport } from "../physics/blueprints.ts";
import { interactPhysics } from "../physics/interaction.ts";
import { linkViews, mechanismExport } from "../physics/mechanisms.ts";
import type { PolicyEdit } from "../physics/policies.ts";
import { PolicyController } from "../physics/policies.ts";
import {
  FIELD_KINDS,
  type FieldRecipe,
  reactionExport,
  STIMULI,
  type Stimulus,
} from "../physics/reactions.ts";
import { createPlayground } from "../physics/runtime.ts";
import type { AssemblyRecipe, BodyRecipe, JointMotor, JointRecipe } from "../physics/types.ts";
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
    assembly:
      "assembly: recipe {id,kind:lab,areaId,root,members,event:none} for already spawned bodies whose recipe names it in `assembly`, plus joints [{id,kind:hinge|fixed|rope|spring|slider,assembly,a,b,anchorA,anchorB,frame?,length?,stiffness?,damping?,limits?,axis?,motor?,breakLoad,toughness}]; cut: id, damage; motor: id, motor {mode:position|velocity,target,stiffness,damping} or null",
  },
  actors: {
    action:
      "inspect (default), body, props, recipes, attacks, mechanisms, reactions, rigs, damage, hit, monster, cut, motor, transport, stimulate, field, configure, apply, policy, impulse, place, spawn",
    description:
      "Host/solo adventure physical world; guests inspect received bodies, props, destroyed records, assemblies, joints, reactions and policies. Shared tuning, damage, cuts, stimuli and fields are host-only.",
    values:
      "worldReactions, dynamicProps, propBlocking, crowdContacts, ambientPhysics, sweptCollision, destruction, impactDamage, projectileWorld, physicalLoot, mechanisms, jointBreakage, materialReactions, chainReactions, environmentalForces, ragdolls, foliage: booleans; impulseStrength, impactStrength, fieldStrength, reactionStrength: 0..10; materialDurability, jointStrength: 0.05..20 (x toughness / break thresholds); debrisLifetime: 0..3600 s (0 = scene lifetime)",
    reactions:
      "reactions: the M08 registry (stimuli, rules with every parameter, material reactivity, containers, releases, field kinds, yard layout) plus statuses, surfaces, fields, delayed reactions, chains (owner, rules fired, visited targets) and recent events",
    stimulate:
      "stimulate: stimulus fire|water|oil|shock|blast at x,y with optional radius 0..400, id (one body: its prop- or enemy- id; shock and blast start there) and strength 0.1..4; starts a chain owned by the caller; honors materialReactions/chainReactions",
    field:
      "field: {kind wind|pressure|attract|repel|vortex, shape {kind:circle,x,y,radius} or {kind:lane,x,y,angle,length,width}, strength 0..20000 units/s², ticks (-1 permanent), optional id, gust 0..1, actors} or remove: field id",
    rigs: "rigs: the M09 rig registry (parts, sockets, masses, limits, materials, detachables, geometry, reaction and death rules) plus every living monster's reaction state and drawn part pose, ragdoll remains records with their bodies' poses, and foliage bend",
    hit: "hit: id enemy-<id>, damage 0..100000, optional angle (direction of the blow); the ordinary hit path with the caller's credit: recoil, poise, stagger, knockdown, shed armor, death and remains",
    monster:
      "monster: rig crawler|stalker|brute|wraith|totem|warden at x,y with optional hp, passive (planted and never attacking), boss, and clear (other live monsters leave without reward and the area spawns no more waves or boss); uncounted toward the area goal (QA)",
    mechanisms:
      "mechanisms: the M07 registry (kinds, joint types, strain/cut/motor/policy rules) plus every assembly, joint (intact or broken, load, damage, motor), drawable link and gate/launcher/causeway state",
    cut: "cut: id <assembly>:<joint> (gate-1:hinge, chain-1:anchor, vine-1:pod, bridge-1:south…), optional damage (default: enough to sever); honors jointBreakage",
    motor: "motor: hinge/slider id and motor {mode,target,stiffness,damping} or null",
    transport:
      "transport: id of a member, dx, dy; moves its whole connected part (refused while anchored to a post)",
    id: "body/impulse/place/damage: player-<player id>, enemy-<id>, ambient-<slot>-<generation>, crate-<area>-<ordinal>, wheel-<area>, prop-<family>-<area>-<n>, <parent id>-<piece>; mechanism parts prop-gate-<area>-leaf, prop-chain-<area>-ball, prop-vine-<area>-pod, prop-launcher-<area>-sled, prop-vane-<area>-rotor, prop-bridge-<area>-plank<k>",
    props:
      "props: every scenery body with material, blueprint {family, palette, piece?, parent?, expiresAt?} and durability %, plus destroyed-parent records",
    recipes: "recipes: reproducible material/blueprint/fracture/layout export",
    attacks:
      "attacks: the shared attack interaction spec (impulse, torque, material, cover/pierce/ricochet, impact and ownership rules)",
    damage:
      "damage: id, damage 0..10000, optional angle; the attack path's material resistance, stages, fracture, one-time reward and feedback",
    body: "spawn: prop BodyRecipe with id prefixed prop- and a current areaId; optional material+blueprint",
  },
  "interact-physics": {
    description:
      "Validated nearby prop impulse: id,x,y (±120), optional atX/atY within 32 of prop. Player identity comes from the host connection online.",
  },
  adventure: {
    action:
      "A game action: depart, advance, return, rest, respawn, skill, equip, buy, sell, sell-spares, respec, tuning, new-run, grab {id} (a loose prop within 72 units, mass up to 8) or release {throw: boolean} (throw along the traveler's aim)",
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
  restore: {
    state: "a validated version 1 or 2 checkpoint; CLI also accepts file via restore-file",
  },
  "restore-file": {
    file: "CLI only: checkpoint JSON file, including saves larger than the 8 MB JSONL command bound",
  },
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
  /** M09 rig registry, living reaction states and poses, remains and foliage (host or guest). */
  private rigs() {
    const sim = this.sim,
      props = sim.physicalProps(),
      state = sim.physical ? sim.physical.rigs.save() : sim.replicaPhysics?.rigs;
    return {
      registry: rigExport(),
      living: sim.adventure.state.enemies.map((e) => ({
        id: e.id,
        rig: e.rig,
        phase: e.phase,
        hp: e.hp,
        reaction: structuredClone(e.reaction),
        pose: enemyPose(e, sim.tick).parts,
      })),
      remains: (state?.remains ?? []).map((record) => ({
        ...record,
        bodies: props
          .filter((p) => record.bodies.includes(p.id))
          .map((p) => ({
            id: p.id,
            x: p.x,
            y: p.y,
            angle: p.angle,
            vx: p.vx,
            vy: p.vy,
            frozen: p.frozen,
            material: p.material,
            part: p.blueprint?.rig?.part,
            loose: p.blueprint?.rig?.loose ?? false,
          })),
      })),
      loose: props
        .filter((p) => p.blueprint?.rig?.loose)
        .map((p) => ({
          id: p.id,
          part: p.blueprint!.rig!.part,
          x: p.x,
          y: p.y,
          material: p.material,
        })),
      foliage: state?.foliage ?? [],
      townsfolk: sim.townsfolk(),
    };
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
      case "interact-physics":
        interactPhysics(this.sim, player, {
          id: String(command.id),
          x: num("x", 0),
          y: num("y", 0),
          ...(command.atX === undefined ? {} : { atX: num("atX"), atY: num("atY") }),
        });
        result = this.sim.observe();
        break;
      case "actors": {
        const physical = this.sim.physical;
        if (!physical) {
          const snapshot = this.sim.replicaPhysics;
          if (!snapshot) throw new Error("No received physical scene");
          const action = command.action ?? "inspect";
          if (action === "inspect")
            return {
              active: true,
              replica: true,
              landId: snapshot.landId,
              backend: snapshot.backend,
              bodyCount: snapshot.world.bodies.length,
              bodies: snapshot.world.bodies.slice(0, 100).map((b) => b.state),
              props: this.sim.physicalProps(),
              destroyed: snapshot.destroyed ?? [],
              combat: snapshot.combat ?? null,
              mechanisms: snapshot.mechanisms ?? null,
              reactions: snapshot.reactions ?? null,
              assemblies: snapshot.world.assemblies ?? [],
              joints: snapshot.world.joints ?? [],
              policies: new PolicyController(snapshot.world.policies).inspect(),
            };
          if (action === "mechanisms") {
            const states = new Map(snapshot.world.bodies.map((b) => [b.recipe.id, b.state]));
            return {
              registry: mechanismExport(),
              assemblies: snapshot.world.assemblies ?? [],
              joints: snapshot.world.joints ?? [],
              links: linkViews(snapshot.world.joints ?? [], (id) => states.get(id)),
              state: snapshot.mechanisms ?? null,
            };
          }
          if (action === "reactions")
            return { registry: reactionExport(), state: snapshot.reactions ?? null };
          if (action === "rigs") return this.rigs();
          if (action === "props")
            return { props: this.sim.physicalProps(), destroyed: snapshot.destroyed ?? [] };
          if (action === "recipes") return blueprintExport();
          if (action === "attacks") return attackExport();
          if (action === "body") {
            const entry = snapshot.world.bodies.find((b) => b.recipe.id === command.id);
            if (!entry) throw new Error("Unknown physical body");
            return {
              ...entry.state,
              reaction: snapshot.reactions?.statuses.find((r) => r.id === command.id) ?? null,
            };
          }
          if (action === "policy")
            return new PolicyController(snapshot.world.policies).resolve(
              String(
                command.areaId ??
                  adventureAreaAt(this.sim.adventure.state, num("x", 0), num("y", 0)),
              ),
              num("x", 0),
              num("y", 0),
            );
          throw new Error("Only the host can change shared physics policies or bodies");
        }
        const action = command.action ?? "inspect",
          world = physical.world;
        if (action === "inspect") return physical.inspect();
        if (action === "props")
          return { props: physical.props(), destroyed: physical.destroyedRecords() };
        if (action === "recipes") return blueprintExport();
        if (action === "attacks") return attackExport();
        if (action === "mechanisms")
          return {
            registry: mechanismExport(),
            assemblies: world.assemblyList(),
            joints: world.jointList(),
            links: linkViews(world.jointList(), (id) =>
              world.has(id) ? world.pose(id) : undefined,
            ),
            state: physical.mechanisms.save(),
          };
        if (action === "reactions")
          return { registry: reactionExport(), state: physical.reactions.save() };
        if (action === "rigs") return this.rigs();
        if (action === "body") {
          if (typeof command.id !== "string") throw new Error("Body id required");
          return { ...world.pose(command.id), reaction: physical.reactions.status(command.id) };
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
        } else if (action === "damage") {
          if (typeof command.id !== "string") throw new Error("Body id required");
          const damage = num("damage");
          if (damage < 0 || damage > 10_000) throw new Error("damage must be 0..10000");
          result = this.sim.adventure.strikeProp(
            this.sim,
            player,
            command.id,
            damage,
            num("angle", 0),
          );
        } else if (action === "hit") {
          const id = typeof command.id === "string" ? /^enemy-(\d+)$/.exec(command.id) : null;
          if (!id) throw new Error("hit needs an enemy-<id>");
          const damage = num("damage");
          if (damage < 0 || damage > 100_000) throw new Error("damage must be 0..100000");
          const e = this.sim.adventure.strikeEnemy(
            this.sim,
            player,
            Number(id[1]),
            damage,
            num("angle", 0),
          );
          result = { id: e.id, hp: e.hp, phase: e.phase, reaction: structuredClone(e.reaction) };
        } else if (action === "monster") {
          const rig = command.rig as RigKind;
          const hp = command.hp === undefined ? undefined : num("hp");
          if (hp !== undefined && (hp < 1 || hp > 1e9)) throw new Error("hp must be 1..1e9");
          const e = this.sim.adventure.spawnMonster(this.sim, rig, num("x"), num("y"), {
            ...(hp === undefined ? {} : { hp }),
            passive: command.passive === true,
            boss: command.boss === true,
            clear: command.clear === true,
          });
          result = { id: e.id, body: `enemy-${e.id}`, rig: e.rig, hp: e.hp };
        } else if (action === "cut") {
          if (typeof command.id !== "string") throw new Error("Joint id required");
          const damage = command.damage === undefined ? undefined : num("damage");
          if (damage !== undefined && (damage < 0 || damage > 1_000_000))
            throw new Error("damage must be 0..1000000");
          result = physical.cut(this.sim, player, command.id, damage);
        } else if (action === "motor") {
          if (typeof command.id !== "string") throw new Error("Joint id required");
          world.setMotor(command.id, (command.motor ?? null) as JointMotor | null);
        } else if (action === "transport") {
          if (typeof command.id !== "string") throw new Error("Body id required");
          world.transport(world.partMembers(command.id), num("dx"), num("dy"));
        } else if (action === "stimulate") {
          const stimulus = command.stimulus as Stimulus;
          if (!(STIMULI as readonly string[]).includes(stimulus))
            throw new Error("stimulus must be fire, water, oil, shock or blast");
          const radius = num("radius", 0),
            strength = num("strength", 1);
          if (radius < 0 || radius > 400) throw new Error("radius must be 0..400");
          if (strength < 0.1 || strength > 4) throw new Error("strength must be 0.1..4");
          if (command.id !== undefined && typeof command.id !== "string")
            throw new Error("id must be a body id");
          const target = command.id as string | undefined,
            at = target ? world.motionOf(target) : { x: num("x"), y: num("y") };
          const chain = physical.stimulate(this.sim, stimulus, {
            x: at.x,
            y: at.y,
            radius,
            strength,
            ...(target ? { target } : {}),
            owner: player,
            team: "party",
            cause: "agent",
          });
          result = { chain: physical.reactions.chain(chain) };
        } else if (action === "field") {
          if (typeof command.remove === "string") physical.reactions.removeField(command.remove);
          else {
            const field = command.field as Partial<FieldRecipe>;
            if (!field || !(FIELD_KINDS as readonly string[]).includes(String(field.kind)))
              throw new Error("field.kind must be wind, pressure, attract, repel or vortex");
            const shape = field.shape as FieldRecipe["shape"];
            if (!shape || typeof shape !== "object") throw new Error("field.shape required");
            physical.reactions.addField({
              id: field.id ?? `agent:${this.sim.tick}:${physical.reactions.fieldList().length}`,
              kind: field.kind as FieldRecipe["kind"],
              areaId: physical.areaAt(this.sim, shape.x, shape.y),
              shape,
              strength: field.strength ?? 0,
              ticks: field.ticks ?? -1,
              gust: field.gust ?? 0,
              actors: field.actors ?? true,
              owner: player,
              team: "party",
              source: "agent",
            });
          }
          result = { fields: physical.reactions.fieldList() };
        } else if (action === "spawn") {
          const body = command.body as BodyRecipe;
          if (body?.role !== "prop" || !body.id?.startsWith("prop-"))
            throw new Error("Adventure spawns require prop- identity and prop role");
          if (physical.isDestroyed(body.id))
            throw new Error("A destroyed parent's ID stays retired; spawn a new prop ID");
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
        if (this.sim.players.size > 1)
          throw new Error("The standalone physics playground is solo-only");
        if (action === "reset" || action === "close") {
          const next = action === "reset" ? createPlayground() : null;
          this.sim.playground?.dispose();
          this.sim.playground = next;
        } else {
          const world = this.sim.playground;
          if (!world) throw new Error("Open the physics playground with physics/reset first");
          if (action === "spawn") world.spawn(command.body as BodyRecipe);
          else if (action === "assembly")
            world.addAssembly(command.recipe as AssemblyRecipe, command.joints as JointRecipe[]);
          else if (action === "cut") {
            if (typeof command.id !== "string") throw new Error("Joint id required");
            result = world.damageJoint(command.id, num("damage"), "cut");
          } else if (action === "motor") {
            if (typeof command.id !== "string") throw new Error("Joint id required");
            world.setMotor(command.id, (command.motor ?? null) as JointMotor | null);
          } else if (action === "configure")
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
