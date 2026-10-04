import { random } from "../engine/math.ts";

export type SoundName =
  | "pulse"
  | "shard"
  | "beacon"
  | "dash"
  | "step"
  | "ambient"
  | "slash"
  | "hit"
  | "hurt"
  | "level";
export const SAMPLE_RATE = 22050;
export function synthesize(name: SoundName, seed = 142): Float32Array {
  const duration =
    name === "ambient"
      ? 8
      : name === "beacon"
        ? 2.8
        : name === "pulse"
          ? 0.75
          : name === "shard"
            ? 0.65
            : 0.2;
  const data = new Float32Array(Math.floor(duration * SAMPLE_RATE));
  const frequencies = [130.81, 164.81, 196, 261.63, 329.63, 392, 523.25, 659.25];
  for (let i = 0; i < data.length; i++) {
    const t = i / SAMPLE_RATE,
      u = t / duration,
      envelope = Math.min(1, t * 50) * (1 - u) ** 2;
    let sample = 0;
    if (name === "ambient") {
      const attack = Math.min(1, t / 0.7, (duration - t) / 0.7);
      for (let v = 0; v < 3; v++)
        sample +=
          Math.sin(t * frequencies[v * 2] * Math.PI * 2 + Math.sin(t * 0.8 + v) * 0.2) *
          0.024 *
          attack;
      const beat = Math.floor(t * 2),
        note = frequencies[Math.floor(random(beat, 1, seed) * frequencies.length)];
      sample += Math.sin(t * note * 2 * Math.PI) * Math.exp(-(t * 2 - beat) * 5) * 0.055 * attack;
    } else if (name === "pulse")
      sample =
        (Math.sin(2 * Math.PI * (240 * t - 90 * t * t)) * 0.24 +
          Math.sin(t * 2 * Math.PI * 660) * 0.04) *
        envelope;
    else if (name === "shard")
      sample = Math.sin(t * 2 * Math.PI * (t < 0.15 ? 659.25 : 987.77)) * 0.19 * envelope;
    else if (name === "beacon") {
      for (let v = 0; v < 4; v++)
        sample +=
          Math.sin(t * frequencies[v + 3] * 2 * Math.PI) *
          0.08 *
          envelope *
          Math.min(1, Math.max(0, t - v * 0.15) * 8);
    } else if (name === "dash") sample = (random(i, 3, seed) - 0.5) * 0.28 * envelope;
    else if (name === "slash")
      sample =
        ((random(i, 8, seed) - 0.5) * 0.32 + Math.sin(t * 2 * Math.PI * (450 - t * 900)) * 0.06) *
        envelope;
    else if (name === "hit")
      sample =
        (Math.sin(t * 2 * Math.PI * (115 - t * 220)) * 0.22 + (random(i, 17, seed) - 0.5) * 0.19) *
        envelope;
    else if (name === "hurt") sample = Math.sin(t * 2 * Math.PI * 85) * 0.27 * envelope;
    else if (name === "level")
      sample =
        (Math.sin(t * 2 * Math.PI * 659.25) + Math.sin(t * 2 * Math.PI * 987.77)) * 0.13 * envelope;
    else sample = (random(i, 8, seed) - 0.5) * 0.08 * envelope;
    data[i] = sample;
  }
  return data;
}
export function wav(data: Float32Array): Uint8Array {
  const out = new Uint8Array(44 + data.length * 2),
    view = new DataView(out.buffer);
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[offset + i] = s.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, out.length - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i++)
    view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, data[i])) * 32767), true);
  return out;
}
