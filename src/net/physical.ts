import { checksum } from "../engine/math.ts";
import { type SaveState, validateSave } from "../engine/simulation.ts";

export const PHYSICAL_WIRE_VERSION = 1;
export const BASELINE_CHUNK_BYTES = 48_000;
export const MAX_BASELINE_BYTES = 256_000_000;
export interface LifecycleEvent {
  type: "scene" | "spawn" | "remove" | "policy";
  id: string;
}
export interface PhysicalFrame {
  version: 1;
  sequence: number;
  revision: number;
  scene: string;
  events: LifecycleEvent[];
  state: SaveState;
}
export interface BaselineStart {
  type: "physical-start";
  version: 1;
  sequence: number;
  revision: number;
  length: number;
  chunks: number;
  checksum: number;
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
/** Complete semantic channel, separate from the bounded observational JSON header.
 * Reliable chunks carry lifecycle and motion together. No interest filter omits physical bodies.
 */
export function frameTransfer(frame: PhysicalFrame): {
  start: BaselineStart;
  chunks: BaselineChunk[];
} {
  const bytes = encoder.encode(JSON.stringify(frame));
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
  begin(start: BaselineStart): void {
    if (
      !start ||
      start.version !== PHYSICAL_WIRE_VERSION ||
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
  chunk(chunk: BaselineChunk): PhysicalFrame | null {
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
    const frame = JSON.parse(decoder.decode(bytes)) as PhysicalFrame;
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
    validateSave(frame.state);
    this.completed = frame.sequence;
    this.active = undefined;
    return frame;
  }
  clear(): void {
    this.active = undefined;
    this.completed = -1;
  }
}
