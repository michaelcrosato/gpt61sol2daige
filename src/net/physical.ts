import { checksum } from "../engine/math.ts";
import type { SaveState } from "../engine/simulation.ts";

export const PHYSICAL_WIRE_VERSION = 2;
export const BASELINE_CHUNK_BYTES = 48_000;
export const MAX_BASELINE_BYTES = 256_000_000;
/** Minimum spacing between complete frame builds (nominal 10 Hz). */
export const MIN_FRAME_MS = 100;
export interface BuiltFrame {
  sequence: number;
  /** Authoritative tick, world revision and membership when the frame was built. */
  key: string;
  builtAt: number;
}
/** Host frame selection shared by every guest; one population-sized build serves them all.
 * `floor` is the newest sequence a guest has acknowledged or, after admission, cannot use
 * because it predates that traveler. `stale` means an accepted action needs a newer build.
 * Builds are spaced by twice their measured cost, so frame cadence (never participation) follows load.
 */
export function frameChoice(input: {
  latest?: BuiltFrame;
  floor: number;
  key: string;
  stale: boolean;
  now: number;
  buildStartedAt: number;
  buildMs: number;
}): "latest" | "build" | "wait" {
  const { latest, stale, now } = input,
    unsent = !!latest && latest.sequence > input.floor;
  if (!stale && latest?.key === input.key) return unsent ? "latest" : "wait";
  const due = stale || now - input.buildStartedAt >= Math.max(MIN_FRAME_MS, 2 * input.buildMs);
  if (!due || (unsent && !stale && now - latest!.builtAt < MIN_FRAME_MS))
    return unsent ? "latest" : "wait";
  return "build";
}
export interface LifecycleEvent {
  type: "scene" | "spawn" | "remove" | "policy";
  id: string;
}
export interface PhysicalFrame {
  version: 2;
  sequence: number;
  revision: number;
  scene: string;
  events: LifecycleEvent[];
  state: SaveState;
}
export interface BaselineStart {
  type: "physical-start";
  version: 2;
  sequence: number;
  revision: number;
  length: number;
  chunks: number;
  checksum: number;
  encoding: "gzip";
  expandedLength: number;
}
export interface BaselineChunk {
  type: "physical-chunk";
  sequence: number;
  index: number;
  bytes: Uint8Array | ArrayBuffer;
}
const encoder = new TextEncoder(),
  decoder = new TextDecoder("utf-8", { fatal: true });
export function physicalScene(state: SaveState): string {
  return `${state.seed}:${state.adventure?.run}:${state.adventure?.transition}:${state.actorPhysics?.landId}`;
}
/** Lossless standard streams; count output before allocation to reject gzip bombs. */
async function codec(bytes: Uint8Array, compress: boolean, limit: number): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(bytes.slice());
      controller.close();
    },
  });
  const reader = source
    .pipeThrough(compress ? new CompressionStream("gzip") : new DecompressionStream("gzip"))
    .getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new Error("Expanded physical baseline exceeds its declared bound");
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/** Complete semantic channel, separate from the bounded observational JSON header.
 * Reliable chunks carry lifecycle and motion together. No interest filter omits physical bodies.
 */
export async function frameTransfer(frame: PhysicalFrame): Promise<{
  start: BaselineStart;
  chunks: BaselineChunk[];
}> {
  const raw = encoder.encode(JSON.stringify(frame));
  if (raw.length > MAX_BASELINE_BYTES)
    throw new Error(
      "Physical scene exceeds the 256 MB transfer bound. Export a checkpoint file before continuing.",
    );
  const bytes = await codec(raw, true, MAX_BASELINE_BYTES);
  if (bytes.length > MAX_BASELINE_BYTES)
    throw new Error(
      "Physical scene exceeds the 256 MB transfer bound. Export a checkpoint file before continuing.",
    );
  const start: BaselineStart = {
    type: "physical-start",
    version: PHYSICAL_WIRE_VERSION,
    sequence: frame.sequence,
    revision: frame.revision,
    length: bytes.length,
    chunks: Math.ceil(bytes.length / BASELINE_CHUNK_BYTES),
    checksum: checksum(bytes),
    encoding: "gzip",
    expandedLength: raw.length,
  };
  return {
    start,
    chunks: Array.from({ length: start.chunks }, (_, index) => ({
      type: "physical-chunk",
      sequence: frame.sequence,
      index,
      bytes: bytes.slice(index * BASELINE_CHUNK_BYTES, (index + 1) * BASELINE_CHUNK_BYTES),
    })),
  };
}
/** One staging scene. A duplicate may agree, but it never advances completion twice. */
export class BaselineReceiver {
  private active?: { start: BaselineStart; chunks: Map<number, Uint8Array>; received: number };
  private completed = -1;
  isComplete(sequence: number): boolean {
    return Number.isSafeInteger(sequence) && sequence >= 0 && sequence <= this.completed;
  }
  /** Every chunk of this sequence is held; only verification/decoding remains. */
  isStaged(sequence: number): boolean {
    const active = this.active;
    return (
      !!active && active.start.sequence === sequence && active.chunks.size === active.start.chunks
    );
  }
  begin(start: BaselineStart): void {
    if (
      !start ||
      start.version !== PHYSICAL_WIRE_VERSION ||
      start.encoding !== "gzip" ||
      !Number.isInteger(start.expandedLength) ||
      start.expandedLength < 1 ||
      start.expandedLength > MAX_BASELINE_BYTES ||
      !Number.isSafeInteger(start.sequence) ||
      start.sequence < 0 ||
      !Number.isSafeInteger(start.revision) ||
      start.revision < 0 ||
      !Number.isInteger(start.length) ||
      start.length < 1 ||
      start.length > MAX_BASELINE_BYTES ||
      start.chunks !== Math.ceil(start.length / BASELINE_CHUNK_BYTES) ||
      !Number.isInteger(start.checksum) ||
      start.checksum < 0 ||
      start.checksum > 0xffffffff
    )
      throw new Error("Invalid physical baseline framing");
    if (start.sequence <= this.completed || start.sequence < (this.active?.start.sequence ?? -1))
      return;
    if (start.sequence === this.active?.start.sequence) {
      if (JSON.stringify(start) !== JSON.stringify(this.active.start))
        throw new Error("Conflicting physical baseline manifest");
      return;
    }
    this.active = { start, chunks: new Map(), received: 0 };
  }
  async chunk(chunk: BaselineChunk): Promise<PhysicalFrame | null> {
    const active = this.active;
    if (!active || chunk.sequence !== active.start.sequence || chunk.sequence <= this.completed)
      return null;
    const { start, chunks } = active;
    const partBytes =
      chunk.bytes instanceof ArrayBuffer ? new Uint8Array(chunk.bytes) : chunk.bytes;
    if (
      !Number.isInteger(chunk.index) ||
      chunk.index < 0 ||
      chunk.index >= start.chunks ||
      !(partBytes instanceof Uint8Array) ||
      partBytes.length !==
        Math.min(BASELINE_CHUNK_BYTES, start.length - chunk.index * BASELINE_CHUNK_BYTES)
    )
      throw new Error("Invalid physical baseline chunk");
    const old = chunks.get(chunk.index);
    if (old) {
      if (old.some((byte, i) => byte !== partBytes[i]))
        throw new Error("Conflicting duplicate baseline chunk");
      return null;
    }
    chunks.set(chunk.index, partBytes.slice());
    active.received += partBytes.length;
    if (chunks.size !== start.chunks || active.received !== start.length) return null;
    const bytes = new Uint8Array(start.length);
    for (const [index, part] of chunks) bytes.set(part, index * BASELINE_CHUNK_BYTES);
    if (checksum(bytes) !== start.checksum) throw new Error("Physical baseline checksum mismatch");
    const decoded = await codec(bytes, false, start.expandedLength);
    if (decoded.length !== start.expandedLength)
      throw new Error("Invalid expanded physical baseline length");
    if (this.active !== active) return null;
    const frame = JSON.parse(decoder.decode(decoded)) as PhysicalFrame;
    if (
      frame.version !== PHYSICAL_WIRE_VERSION ||
      frame.sequence !== start.sequence ||
      frame.revision !== start.revision ||
      frame.scene !== physicalScene(frame.state) ||
      !Array.isArray(frame.events) ||
      frame.events.length > 1_000_000 ||
      frame.events.some(
        (e) =>
          !e ||
          !["scene", "spawn", "remove", "policy"].includes(e.type) ||
          typeof e.id !== "string" ||
          e.id.length > 160,
      ) ||
      !frame.state.actorPhysics ||
      frame.state.actorPhysics.world.continuation !== "rebuild"
    )
      throw new Error("Invalid physical frame");
    // Simulation.applyReplica validates semantics before publication. Do not run that
    // full policy/ownership pass twice for every received population-sized frame.
    this.completed = frame.sequence;
    this.active = undefined;
    return frame;
  }
  clear(): void {
    this.active = undefined;
    this.completed = -1;
  }
}
