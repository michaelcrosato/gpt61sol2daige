import Peer, { type DataConnection, type PeerOptions } from "peerjs";
import { MAX_DRAW_DISTANCE, MAX_NPCS, MIN_DRAW_DISTANCE } from "../engine/limits.ts";
import { type Input, idleInput, type Simulation } from "../engine/simulation.ts";
import { WORLD_LIMIT } from "../engine/world.ts";
import type { AdventureAction } from "../game/types.ts";
import { interactPhysics, type PhysicalInteraction } from "../physics/interaction.ts";
import {
  type BaselineChunk,
  BaselineReceiver,
  type BaselineStart,
  type BuiltFrame,
  frameChoice,
  frameTransfer,
  type LifecycleEvent,
  physicalScene,
} from "./physical.ts";
import { PROTOCOL_VERSION, type SnapshotView } from "./protocol.ts";

export type NetworkStatus = {
  role: "solo" | "host" | "guest";
  state: "offline" | "connecting" | "connected" | "error";
  room: string;
  message: string;
  peers: number;
  received: number;
  sent: number;
  population: number;
  physicalRevision: number;
  baselineReady: boolean;
};
class RetryableJoinError extends Error {}
type Transfer = Awaited<ReturnType<typeof frameTransfer>>;
interface PendingTransfer {
  sequence: number;
  sentAt: number;
  cursor: number;
  /** The guest reported every chunk held; only its decode/validation remains. */
  staged?: boolean;
  transfer?: Transfer;
}
/** Native DataChannel pacing for complete-scene chunks. Larger refills (1 MiB) measurably
 * starved a loaded host's admission of new connections at 32,768 creatures. */
const HIGH_WATER = 262_144,
  LOW_WATER = 65_536,
  /** Resend an unstaged transfer only after this long without sending; never resend a staged one. */
  RETRY_MS = 10_000,
  /** Host liveness is independent of frame acknowledgements, which a loaded host may process late. */
  HEARTBEAT_MS = 1_000,
  /** A connected guest continues solo after this long without any host frame, chunk or heartbeat. */
  HOST_SILENCE_MS = 10_000;
export class Coop {
  readonly status: NetworkStatus = {
    role: "solo",
    state: "offline",
    room: "",
    message: "A little solitude",
    peers: 0,
    received: 0,
    sent: 0,
    population: 0,
    physicalRevision: 0,
    baselineReady: false,
  };
  localId = "local";
  lastSnapshot = 0;
  private peer?: Peer;
  private readonly connections = new Map<string, DataConnection>();
  private readonly lastInput = new Map<string, number>();
  private readonly lastSequence = new Map<string, number>();
  private readonly lastAction = new Map<string, number>();
  private actionSequence = 0;
  private readonly pendingActions = new Map<
    number,
    { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly interest = new Map<string, SnapshotView>();
  private readonly getSim: () => Simulation;
  private readonly replaceSim: (sim: Simulation) => void;
  private readonly changed: () => void;
  private elapsed = 0;
  private sequence = 0;
  private lastSent = 0;
  private generation = 0;
  private joinRequest = 0;
  private readonly receiver = new BaselineReceiver();
  private readonly transfers = new Map<string, PendingTransfer>();
  private lastReceive = 0;
  /** Host: last heartbeat sent. Guest: last heartbeat received. */
  private heartbeatAt = 0;
  private readonly ready = new Set<string>();
  private frameSequence = 0;
  private revision = 0;
  private scene = "";
  private bodyIds = new Set<string>();
  private policySignature = "";
  /** Last complete frame; any guest that has not acknowledged it can receive it unchanged. */
  private latest?: BuiltFrame & { transfer: Transfer };
  private building?: Promise<Transfer>;
  private buildStartedAt = -Infinity;
  private buildMs = 0;
  /** An accepted guest action must reach that guest in a frame built after the action. */
  private stale = false;
  private readonly acked = new Map<string, number>();
  private readonly paced = new WeakSet<RTCDataChannel>();
  private async sendPhysical(conn: DataConnection): Promise<void> {
    if (!conn.open || this.transfers.has(conn.peer)) return;
    const pending: PendingTransfer = { sequence: -1, sentAt: performance.now(), cursor: 0 };
    this.transfers.set(conn.peer, pending);
    try {
      const transfer = await this.nextTransfer(conn.peer);
      const current = this.transfers.get(conn.peer) === pending;
      if (!transfer || !current || this.connections.get(conn.peer) !== conn || !conn.open) {
        // Nothing newer exists yet, or the connection changed during a shared build.
        if (current) this.transfers.delete(conn.peer);
        return;
      }
      pending.transfer = transfer;
      pending.sequence = transfer.start.sequence;
      conn.send(transfer.start);
      this.pumpTransfer(conn);
    } catch (error) {
      if (this.transfers.get(conn.peer) !== pending) return;
      this.transfers.delete(conn.peer);
      if (conn.open)
        conn.send({
          type: "error",
          message: error instanceof Error ? error.message : "Physical transfer failed",
        });
      this.status.message = error instanceof Error ? error.message : "Physical transfer failed";
      this.changed();
    }
  }
  /** Shared frame scheduling; see `frameChoice`. At most one build is in flight. */
  private async nextTransfer(peer: string): Promise<Transfer | undefined> {
    const floor = () => this.acked.get(peer) ?? Number.MAX_SAFE_INTEGER;
    while (this.building) {
      await this.building.catch(() => undefined);
      if (this.latest && this.latest.sequence > floor()) return this.latest.transfer;
    }
    const sim = this.getSim(),
      key = `${sim.tick}:${sim.world.revision}:${[...sim.players.keys()].join(",")}`;
    const choice = frameChoice({
      latest: this.latest,
      floor: floor(),
      key,
      stale: this.stale,
      now: performance.now(),
      buildStartedAt: this.buildStartedAt,
      buildMs: this.buildMs,
    });
    return choice === "build"
      ? this.build(key)
      : choice === "latest"
        ? this.latest!.transfer
        : undefined;
  }
  private build(key: string): Promise<Transfer> {
    const started = performance.now();
    this.buildStartedAt = started;
    this.stale = false;
    const state = this.getSim().save(true);
    if (!state.actorPhysics) throw new Error("Host has no authoritative physical scene");
    const scene = physicalScene(state),
      ids = new Set(state.actorPhysics.world.bodies.map((b) => b.recipe.id));
    const policy = JSON.stringify(state.actorPhysics.world.policies);
    const events: LifecycleEvent[] = [];
    if (scene !== this.scene) events.push({ type: "scene", id: state.actorPhysics.landId });
    for (const id of ids) if (!this.bodyIds.has(id)) events.push({ type: "spawn", id });
    for (const id of this.bodyIds) if (!ids.has(id)) events.push({ type: "remove", id });
    if (policy !== this.policySignature)
      events.push({ type: "policy", id: state.actorPhysics.landId });
    if (events.length) this.revision++;
    this.status.physicalRevision = this.revision;
    this.scene = scene;
    this.bodyIds = ids;
    this.policySignature = policy;
    const sequence = this.frameSequence++,
      generation = this.generation;
    const build: Promise<Transfer> = frameTransfer({
      version: 2,
      sequence,
      revision: this.revision,
      scene,
      events,
      state,
    }).then(
      (transfer) => {
        if (this.building === build) this.building = undefined;
        this.buildMs = performance.now() - started;
        if (generation === this.generation)
          this.latest = { sequence, key, builtAt: performance.now(), transfer };
        return transfer;
      },
      (error) => {
        if (this.building === build) this.building = undefined;
        throw error;
      },
    );
    this.building = build;
    return build;
  }
  private pumpTransfer(conn: DataConnection): void {
    const pending = this.transfers.get(conn.peer),
      transfer = pending?.transfer,
      channel = conn.dataChannel;
    if (!pending || !transfer || !conn.open || !channel) return;
    if (!this.paced.has(channel)) {
      // Refill as soon as the native channel drains instead of once per rendered frame.
      this.paced.add(channel);
      channel.bufferedAmountLowThreshold = LOW_WATER;
      channel.addEventListener("bufferedamountlow", () => this.pumpTransfer(conn));
    }
    if (
      !pending.staged &&
      pending.cursor === transfer.chunks.length &&
      performance.now() - pending.sentAt > RETRY_MS
    ) {
      // Retry the identical scene/sequence. Replacing staging every timeout can starve large joins;
      // resending to a guest that is still decoding a staged population-sized frame doubles its load.
      pending.cursor = 0;
      conn.send(transfer.start);
    }
    while (
      pending.cursor < transfer.chunks.length &&
      channel.bufferedAmount < HIGH_WATER &&
      (!("bufferSize" in conn) || Number(conn.bufferSize) < 8)
    ) {
      const chunk = transfer.chunks[pending.cursor++];
      conn.send(chunk);
      pending.sentAt = performance.now();
      this.status.sent += chunk.bytes.byteLength;
    }
  }
  constructor(
    getSim: () => Simulation,
    replaceSim: (sim: Simulation) => void,
    changed: () => void,
  ) {
    this.getSim = getSim;
    this.replaceSim = replaceSim;
    this.changed = changed;
  }
  private options(): PeerOptions {
    const env = import.meta.env;
    const options: PeerOptions = { debug: 0 };
    if (env.VITE_SIGNAL_HOST) {
      options.host = env.VITE_SIGNAL_HOST;
      options.port = Number(env.VITE_SIGNAL_PORT ?? 9000);
      options.path = env.VITE_SIGNAL_PATH ?? "/fern";
      options.secure = env.VITE_SIGNAL_SECURE === "true";
    }
    if (env.VITE_ICE_SERVERS) options.config = { iceServers: JSON.parse(env.VITE_ICE_SERVERS) };
    return options;
  }
  private async open(id?: string): Promise<Peer> {
    this.status.state = "connecting";
    this.status.message = "Finding a path through the trees…";
    this.changed();
    const peer = id ? new Peer(id, this.options()) : new Peer(this.options());
    this.peer = peer;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        peer.destroy();
        reject(new Error("Signaling timed out. Check your connection and try again."));
      }, 15000);
      peer.once("open", () => {
        clearTimeout(timer);
        resolve();
      });
      peer.once("error", (error) => {
        clearTimeout(timer);
        reject(new Error(error.message));
      });
    });
    peer.on("error", (error) => {
      if (this.peer !== peer) return;
      this.status.message =
        error.type === "peer-unavailable"
          ? "That expedition has ended or the room code is incorrect."
          : error.message;
      this.changed();
    });
    peer.on("disconnected", () => {
      if (this.peer === peer && !peer.destroyed) {
        this.status.message = "Signaling interrupted. Existing travelers remain connected.";
        this.changed();
        peer.reconnect();
      }
    });
    return peer;
  }
  async host(): Promise<string> {
    if (this.getSim().playground)
      throw new Error("Close the solo physics playground before hosting an expedition");
    this.disconnect();
    this.getSim().resumeSoloPhysics();
    const generation = this.generation;
    try {
      const room = `fern-${crypto.randomUUID()}`,
        peer = await this.open(room);
      if (generation !== this.generation) throw new Error("Connection canceled");
      this.status.role = "host";
      this.status.state = "connected";
      this.status.room = room;
      this.status.message = "Your expedition is open";
      this.status.baselineReady = true;
      peer.on("connection", (conn) => this.accept(conn));
      this.changed();
      return room;
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }
  private accept(conn: DataConnection): void {
    conn.on("error", () => conn.close());
    let welcomeAt = -Infinity;
    const welcome = (admitted: boolean) => {
      const now = performance.now();
      if (!admitted && now - welcomeAt < 250) return;
      welcomeAt = now;
      conn.send({ type: "welcome", id: conn.peer, version: PROTOCOL_VERSION });
      // Bind the new traveler's body once. Repeated hellos only repeat the cheap welcome;
      // a population-sized begin() per hello starved every channel during late joins.
      if (admitted) this.getSim().physical?.begin(this.getSim());
      void this.sendPhysical(conn);
    };
    const admit = () => {
      if (!this.channelOpen(conn) || this.connections.get(conn.peer) === conn) return;
      if (
        this.status.role !== "host" ||
        conn.metadata?.version !== PROTOCOL_VERSION ||
        this.getSim().players.size >= 8
      ) {
        conn.send({
          type: "error",
          message:
            this.getSim().players.size >= 8
              ? "This expedition is full (8 players)."
              : "Incompatible physics protocol. Refresh all travelers to the same engine version.",
        });
        setTimeout(() => conn.close(), 200);
        return;
      }
      if (this.connections.has(conn.peer)) {
        conn.close();
        return;
      }
      this.connections.set(conn.peer, conn);
      this.getSim().addPlayer(conn.peer, `Wayfarer ${this.getSim().players.size + 1}`);
      // Frames already built or building cannot contain this traveler.
      this.acked.set(conn.peer, this.frameSequence - 1);
      this.lastInput.set(conn.peer, performance.now());
      this.status.peers = this.connections.size;
      welcome(true);
      this.changed();
    };
    conn.on("open", admit);
    // The channel may already be open when PeerJS exposes the incoming connection.
    conn.peerConnection?.addEventListener("datachannel", () => queueMicrotask(admit));
    conn.on("data", (raw) => {
      if (!raw || typeof raw !== "object") return;
      const data = raw as Record<string, unknown>;
      if (data.type === "hello" && data.version === PROTOCOL_VERSION) {
        admit();
        if (this.connections.get(conn.peer) === conn && conn.open) welcome(false);
        return;
      }
      if (this.connections.get(conn.peer) !== conn) return;
      if (data.type === "physical-staged") {
        const pending = this.transfers.get(conn.peer);
        if (pending?.transfer && data.sequence === pending.sequence) pending.staged = true;
        return;
      }
      if (data.type === "physical-ack") {
        const pending = this.transfers.get(conn.peer);
        if (
          pending?.transfer &&
          pending.cursor === pending.transfer.chunks.length &&
          Number.isSafeInteger(data.sequence) &&
          Number(data.sequence) >= 0 &&
          data.sequence === pending.sequence
        ) {
          this.transfers.delete(conn.peer);
          this.ready.add(conn.peer);
          this.acked.set(conn.peer, pending.sequence);
          void this.sendPhysical(conn);
        }
        return;
      }
      if (
        ["action", "physical-interaction"].includes(String(data.type)) &&
        Number.isSafeInteger(data.seq) &&
        Number(data.seq) > (this.lastAction.get(conn.peer) ?? -1)
      ) {
        this.lastAction.set(conn.peer, Number(data.seq));
        try {
          if (!this.ready.has(conn.peer))
            throw new Error("Wait for the complete physical baseline before interacting");
          if (data.type === "physical-interaction")
            interactPhysics(this.getSim(), conn.peer, data.interaction as PhysicalInteraction);
          else {
            const action = data.action as AdventureAction;
            if (!action || ["tuning", "new-run"].includes(action.type))
              throw new Error("Only the host can change the shared run or tuning");
            this.getSim().adventure.action(this.getSim(), conn.peer, action);
          }
          conn.send({ type: "action-result", seq: data.seq, ok: true });
          this.stale = true;
          void this.sendPhysical(conn);
        } catch (error) {
          conn.send({
            type: "action-result",
            seq: data.seq,
            ok: false,
            message: error instanceof Error ? error.message : "Action rejected",
          });
        }
        return;
      }
      if (
        data.type !== "input" ||
        typeof data.seq !== "number" ||
        !Number.isSafeInteger(data.seq) ||
        data.seq <= (this.lastSequence.get(conn.peer) ?? -1)
      )
        return;
      const now = performance.now();
      if (now - (this.lastInput.get(conn.peer) ?? 0) < 12) return;
      if (
        typeof data.x !== "number" ||
        typeof data.y !== "number" ||
        !Number.isFinite(data.x) ||
        !Number.isFinite(data.y)
      )
        return;
      this.getSim().setInput(conn.peer, {
        x: data.x,
        y: data.y,
        dash: data.dash === true,
        pulse: data.pulse === true,
        interact: data.interact === true,
        attack: data.attack === true,
        lance: data.lance === true,
        nova: data.nova === true,
        potion: data.potion === true,
        aimX: typeof data.aimX === "number" ? data.aimX : 0,
        aimY: typeof data.aimY === "number" ? data.aimY : 0,
      });
      this.lastInput.set(conn.peer, now);
      this.lastSequence.set(conn.peer, data.seq);
      if (
        [data.radius, data.viewX, data.viewY, data.entityLimit].every(
          (v) => typeof v === "number" && Number.isFinite(v),
        )
      ) {
        this.interest.set(conn.peer, {
          x: Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, data.viewX as number)),
          y: Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, data.viewY as number)),
          radius: Math.max(MIN_DRAW_DISTANCE, Math.min(MAX_DRAW_DISTANCE, data.radius as number)),
          entityLimit: Math.max(0, Math.min(MAX_NPCS, Math.floor(data.entityLimit as number))),
        });
      }
    });
    conn.on("close", () => {
      if (this.connections.get(conn.peer) !== conn) return;
      this.connections.delete(conn.peer);
      this.lastInput.delete(conn.peer);
      this.lastSequence.delete(conn.peer);
      this.lastAction.delete(conn.peer);
      this.interest.delete(conn.peer);
      this.transfers.delete(conn.peer);
      this.ready.delete(conn.peer);
      this.acked.delete(conn.peer);
      this.getSim().removePlayer(conn.peer);
      this.status.peers = this.connections.size;
      this.changed();
    });
    admit();
  }
  private channelOpen(conn: DataConnection): boolean {
    // Reconcile PeerJS with an already-open native channel if its initial notification raced setup.
    if (!conn.open && conn.dataChannel?.readyState === "open")
      conn.dataChannel.dispatchEvent(new Event("open"));
    return conn.open;
  }
  async join(rawRoom: string): Promise<void> {
    if (this.getSim().playground)
      throw new Error("Close the solo physics playground before joining an expedition");
    let room = rawRoom.trim();
    if (room.startsWith("http")) {
      try {
        room = new URL(room).searchParams.get("room") ?? "";
      } catch {
        throw new Error("Enter a room code or invite link");
      }
    }
    if (!/^fern-[a-f0-9-]{36}$/.test(room))
      throw new Error("Enter the full room code or invite link");
    const request = ++this.joinRequest;
    for (const [attempt, timeout] of [6000, 10000, 22000].entries()) {
      try {
        await this.joinOnce(room, timeout);
        return;
      } catch (error) {
        if (request !== this.joinRequest) throw new Error("Connection canceled");
        if (!(error instanceof RetryableJoinError) || attempt === 2) throw error;
        this.status.state = "connecting";
        this.status.message = `Retrying the connection (${attempt + 2}/3)…`;
        this.changed();
        await new Promise<void>((resolve) => setTimeout(resolve, 300));
        if (request !== this.joinRequest) throw new Error("Connection canceled");
      }
    }
  }
  private async joinOnce(room: string, timeout: number): Promise<void> {
    this.disconnect(false);
    const generation = this.generation;
    try {
      const peer = await this.open();
      if (generation !== this.generation) throw new Error("Connection canceled");
      this.status.role = "guest";
      this.status.room = room;
      const conn = peer.connect(room, {
        reliable: true,
        serialization: "binary",
        metadata: { version: PROTOCOL_VERSION },
      });
      this.connections.set(room, conn);
      await new Promise<void>((resolve, reject) => {
        let welcomed = false,
          completed = false,
          stagedReceipt = -1;
        const hello = () => {
          if (generation !== this.generation) {
            clearTimers();
            reject(new Error("Connection canceled"));
            return;
          }
          // Once welcomed, the host owns progress; repeated hellos only add host work.
          if (this.channelOpen(conn) && !completed && !welcomed)
            conn.send({ type: "hello", version: PROTOCOL_VERSION });
        };
        const welcomeTimer = setInterval(hello, 500);
        const clearTimers = () => {
          clearTimeout(timer);
          clearInterval(welcomeTimer);
        };
        this.lastReceive = performance.now();
        this.heartbeatAt = 0;
        let timer: ReturnType<typeof setTimeout>;
        const checkTimeout = () => {
          // Baseline traffic, or an admitted guest's in-order host heartbeat, is join progress.
          const progress = Math.max(this.lastReceive, this.heartbeatAt),
            remaining = timeout - (performance.now() - progress);
          if (remaining > 0) {
            timer = setTimeout(checkTimeout, remaining);
            return;
          }
          clearTimers();
          reject(
            new RetryableJoinError(
              "Could not reach the host. They must keep their expedition open. Some networks require a TURN relay.",
            ),
          );
        };
        timer = setTimeout(checkTimeout, timeout);
        const done = () => {
          if (completed) return;
          completed = true;
          clearTimers();
          resolve();
        };
        conn.on("data", async (raw) => {
          if (generation !== this.generation) return;
          try {
            if (raw && typeof raw === "object") {
              const data = raw as Record<string, unknown>;
              if (data.type === "alive") {
                if (welcomed) this.heartbeatAt = performance.now();
                return;
              }
              if (data.type === "physical-start" && welcomed) {
                this.receiver.begin(data as unknown as BaselineStart);
                this.lastReceive = performance.now();
                return;
              }
              if (data.type === "physical-chunk" && welcomed) {
                this.lastReceive = performance.now();
                const sequence = Number(data.sequence),
                  decoding = this.receiver.chunk(data as unknown as BaselineChunk);
                // Report a fully held frame before the population-sized decode so the host waits
                // for its acknowledgement instead of resending the same chunks.
                if (stagedReceipt !== sequence && this.receiver.isStaged(sequence)) {
                  stagedReceipt = sequence;
                  conn.send({ type: "physical-staged", sequence });
                }
                const frame = await decoding;
                if (generation !== this.generation) return;
                this.status.received += (data.bytes as Uint8Array)?.byteLength ?? 0;
                if (!frame) {
                  if (this.receiver.isComplete(Number(data.sequence)))
                    conn.send({ type: "physical-ack", sequence: data.sequence });
                  return;
                }
                if (!frame.state.players.some((p) => p.id === this.localId))
                  throw new Error("Host removed this traveler");
                const sim = this.getSim();
                sim.applyReplica(frame.state);
                this.status.population = frame.state.count;
                this.status.physicalRevision = frame.revision;
                this.status.baselineReady = true;
                this.status.peers = sim.players.size - 1;
                this.lastSnapshot = performance.now();
                this.status.state = "connected";
                this.status.message = "Wandering together";
                conn.send({ type: "physical-ack", sequence: frame.sequence });
                this.replaceSim(sim);
                this.changed();
                done();
                return;
              }
              if (data.type === "action-result" && typeof data.seq === "number") {
                const pending = this.pendingActions.get(data.seq);
                if (pending) {
                  clearTimeout(pending.timer);
                  this.pendingActions.delete(data.seq);
                  if (data.ok === true) pending.resolve();
                  else pending.reject(new Error(String(data.message).slice(0, 200)));
                }
                return;
              }
              if (
                data.type === "welcome" &&
                data.version === PROTOCOL_VERSION &&
                data.id === peer.id
              ) {
                this.localId = peer.id;
                welcomed = true;
              } else if (data.type === "error") {
                throw new Error(String(data.message).slice(0, 200));
              }
            }
          } catch (error) {
            if (generation !== this.generation) return;
            clearTimers();
            reject(error);
            if (completed) {
              this.disconnect(false);
              this.fail(error);
            }
          }
        });
        conn.on("error", (error) => {
          clearTimers();
          reject(completed ? error : new RetryableJoinError(error.message));
        });
        conn.on("close", () => {
          clearTimers();
          if (!completed) {
            reject(
              new RetryableJoinError("The host closed the connection before joining completed."),
            );
            return;
          }
          if (generation === this.generation) {
            this.disconnect(false);
            this.status.message = "The host left. You can keep exploring solo.";
            this.changed();
          }
        });
        peer.once("error", (error) => {
          clearTimers();
          reject(error);
        });
        conn.on("open", hello);
        hello();
      });
    } catch (error) {
      if (generation === this.generation) {
        this.disconnect(false);
        this.fail(error);
      }
      throw error;
    }
  }
  private fail(error: unknown): void {
    this.status.state = "error";
    this.status.message = error instanceof Error ? error.message : "Connection failed";
    this.changed();
  }
  action(action: AdventureAction): Promise<void> {
    return this.request("action", { action });
  }
  interact(interaction: PhysicalInteraction): Promise<void> {
    if (this.status.role === "host" || this.status.role === "solo") {
      try {
        interactPhysics(this.getSim(), this.localId, interaction);
        return Promise.resolve();
      } catch (error) {
        return Promise.reject(error);
      }
    }
    return this.request("physical-interaction", { interaction });
  }
  private request(type: string, payload: Record<string, unknown>): Promise<void> {
    if (this.status.role !== "guest" || this.status.state !== "connected")
      return Promise.reject(new Error("No active guest connection"));
    if (this.pendingActions.size >= 8)
      return Promise.reject(new Error("Wait for the previous actions to finish"));
    const conn = this.connections.values().next().value;
    if (!conn?.open) return Promise.reject(new Error("Connection unavailable"));
    const seq = this.actionSequence++;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingActions.delete(seq);
        reject(new Error("The host did not respond to that action"));
      }, 5000);
      this.pendingActions.set(seq, { resolve, reject, timer });
      conn.send({ type, seq, ...payload });
    });
  }
  update(dt: number, input: Input, view: SnapshotView): void {
    const now = performance.now();
    if (this.status.role === "guest" && this.status.state === "connected") {
      const conn = this.connections.values().next().value;
      if (conn?.open && now - this.lastSent > 30) {
        conn.send({
          type: "input",
          seq: this.sequence++,
          radius: view.radius,
          viewX: view.x,
          viewY: view.y,
          entityLimit: view.entityLimit,
          ...input,
        });
        this.lastSent = now;
      }
      if (now - Math.max(this.lastSnapshot, this.lastReceive, this.heartbeatAt) > HOST_SILENCE_MS) {
        this.disconnect();
        this.status.message = "Host stopped responding. Continuing solo.";
        this.changed();
      }
      return;
    }
    if (this.status.role !== "host") return;
    for (const [id, time] of this.lastInput)
      if (now - time > 300) this.getSim().setInput(id, idleInput());
    for (const conn of this.connections.values()) this.pumpTransfer(conn);
    if (now - this.heartbeatAt >= HEARTBEAT_MS) {
      this.heartbeatAt = now;
      for (const conn of this.connections.values()) if (conn.open) conn.send({ type: "alive" });
    }
    this.elapsed += dt;
    if (this.elapsed < 0.1) return;
    this.elapsed = 0;
    for (const conn of this.connections.values())
      if (
        conn.open &&
        conn.dataChannel.bufferedAmount < HIGH_WATER &&
        (!("bufferSize" in conn) || Number(conn.bufferSize) < 8)
      )
        void this.sendPhysical(conn);
  }

  disconnect(cancelJoin = true, recover = true): void {
    if (cancelJoin) this.joinRequest++;
    this.generation++;
    for (const conn of this.connections.values()) conn.close();
    this.connections.clear();
    this.lastInput.clear();
    this.lastSequence.clear();
    this.lastAction.clear();
    for (const pending of this.pendingActions.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Expedition disconnected"));
    }
    this.pendingActions.clear();
    this.interest.clear();
    this.transfers.clear();
    this.ready.clear();
    this.receiver.clear();
    this.latest = undefined;
    this.building = undefined;
    this.buildStartedAt = -Infinity;
    this.buildMs = 0;
    this.stale = false;
    this.acked.clear();
    this.peer?.destroy();
    this.peer = undefined;
    const sim = this.getSim();
    const recovered = recover ? sim.continueSolo(this.localId) : null;
    this.localId = "local";
    if (recovered) this.replaceSim(recovered);
    Object.assign(this.status, {
      role: "solo",
      state: "offline",
      room: "",
      peers: 0,
      message: "A little solitude",
      received: 0,
      sent: 0,
      baselineReady: false,
    });
    this.changed();
  }
}
