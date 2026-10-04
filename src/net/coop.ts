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
  private readonly transfers = new Map<string, { sequence: number; sentAt: number }>();
  private readonly ready = new Set<string>();
  private frameSequence = 0;
  private revision = 0;
  private scene = "";
  private bodyIds = new Set<string>();
  private policySignature = "";
  private cachedTransfer?: ReturnType<typeof frameTransfer>;
  private transferKey = "";
  private sendPhysical(conn: DataConnection): void {
    if (!conn.open || this.transfers.has(conn.peer)) return;
    const sim = this.getSim();
    const key = `${sim.tick}:${sim.world.revision}:${[...sim.players.keys()].join(",")}`;
    if (this.transferKey === key && this.cachedTransfer) {
      this.sendTransfer(conn, this.cachedTransfer);
      return;
    }
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
    const sequence = this.frameSequence++;
    const transfer = frameTransfer({
      version: 1,
      sequence,
      revision: this.revision,
      scene,
      events,
      state,
    });
    this.cachedTransfer = transfer;
    this.transferKey = key;
    this.sendTransfer(conn, transfer);
  }
  private sendTransfer(conn: DataConnection, transfer: ReturnType<typeof frameTransfer>): void {
    this.transfers.set(conn.peer, { sequence: transfer.start.sequence, sentAt: performance.now() });
    conn.send(transfer.start);
    for (const chunk of transfer.chunks) {
      conn.send(chunk);
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
    const welcome = () => {
      const now = performance.now();
      if (now - welcomeAt < 250) return;
      welcomeAt = now;
      conn.send({ type: "welcome", id: conn.peer, version: PROTOCOL_VERSION });
      this.getSim().physical?.begin(this.getSim());
      try {
        this.sendPhysical(conn);
      } catch (error) {
        conn.send({
          type: "error",
          message: error instanceof Error ? error.message : "Physical baseline unavailable",
        });
      }
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
      this.lastInput.set(conn.peer, performance.now());
      this.status.peers = this.connections.size;
      welcome();
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
        if (this.connections.get(conn.peer) === conn && conn.open) welcome();
        return;
      }
      if (this.connections.get(conn.peer) !== conn) return;
      if (data.type === "physical-ack") {
        if (data.sequence === this.transfers.get(conn.peer)?.sequence) {
          this.transfers.delete(conn.peer);
          this.ready.add(conn.peer);
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
          this.sendPhysical(conn);
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
          completed = false;
        const hello = () => {
          if (generation !== this.generation) {
            clearTimers();
            reject(new Error("Connection canceled"));
            return;
          }
          if (this.channelOpen(conn) && !completed)
            conn.send({ type: "hello", version: PROTOCOL_VERSION });
        };
        const welcomeTimer = setInterval(hello, 500);
        const clearTimers = () => {
          clearTimeout(timer);
          clearInterval(welcomeTimer);
        };
        const timer = setTimeout(() => {
          clearTimers();
          reject(
            new RetryableJoinError(
              "Could not reach the host. They must keep their expedition open. Some networks require a TURN relay.",
            ),
          );
        }, timeout);
        const done = () => {
          if (completed) return;
          completed = true;
          clearTimers();
          resolve();
        };
        conn.on("data", (raw) => {
          if (generation !== this.generation) return;
          try {
            if (raw && typeof raw === "object") {
              const data = raw as Record<string, unknown>;
              if (data.type === "physical-start" && welcomed) {
                this.receiver.begin(data as unknown as BaselineStart);
                return;
              }
              if (data.type === "physical-chunk" && welcomed) {
                const frame = this.receiver.chunk(data as unknown as BaselineChunk);
                this.status.received += (data.bytes as Uint8Array)?.byteLength ?? 0;
                if (!frame) return;
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
      if (now - this.lastSnapshot > 10000) {
        this.disconnect();
        this.status.message = "Host stopped responding. Continuing solo.";
        this.changed();
      }
      return;
    }
    if (this.status.role !== "host") return;
    for (const [id, time] of this.lastInput)
      if (now - time > 300) this.getSim().setInput(id, idleInput());
    this.elapsed += dt;
    if (this.elapsed < 0.1) return;
    this.elapsed = 0;
    for (const [id, conn] of this.connections)
      if (conn.open && conn.dataChannel.bufferedAmount < 262144) {
        const pending = this.transfers.get(id);
        if (pending && now - pending.sentAt > 5000) this.transfers.delete(id);
        try {
          this.sendPhysical(conn);
        } catch (error) {
          this.status.message = error instanceof Error ? error.message : "Physical transfer failed";
          conn.send({ type: "error", message: this.status.message });
          this.changed();
        }
      }
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
    this.cachedTransfer = undefined;
    this.transferKey = "";
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
