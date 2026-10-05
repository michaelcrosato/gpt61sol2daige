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
  | "level"
  | MaterialSound
  | "crumble"
  | ReactionSound
  | RigSound;
/** M05 material identity: one impact voice per registered material. */
export const MATERIAL_SOUNDS = [
  "wood",
  "stone",
  "metal",
  "glass",
  "cloth",
  "vegetation",
  "ceramic",
  "volatile",
] as const;
export type MaterialSound = (typeof MATERIAL_SOUNDS)[number];
/** M08 reaction voices: ignition, a hissing quench, a discharge, a blast, a spill and a gust. */
export const REACTION_SOUNDS = ["ignite", "hiss", "zap", "boom", "splash", "gust"] as const;
export type ReactionSound = (typeof REACTION_SOUNDS)[number];
/** M09 rig voices: a body hitting the ground and a shroud dissipating. */
export const RIG_SOUNDS = ["thud", "flutter"] as const;
export type RigSound = (typeof RIG_SOUNDS)[number];
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
            : name === "metal" || name === "glass" || name === "crumble"
              ? 0.55
              : name === "volatile"
                ? 0.7
                : name === "boom"
                  ? 1.1
                  : name === "gust" || name === "flutter"
                    ? 0.9
                    : name === "thud"
                      ? 0.5
                      : name === "ignite" || name === "hiss" || name === "splash"
                        ? 0.6
                        : name === "zap"
                          ? 0.38
                          : (MATERIAL_SOUNDS as readonly string[]).includes(name)
                            ? 0.32
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
    else if (name === "wood")
      sample =
        (Math.sin(t * 2 * Math.PI * (210 - t * 260)) * 0.2 * Math.exp(-t * 18) +
          (random(i, 31, seed) - 0.5) * 0.24 * Math.exp(-t * 30)) *
        Math.min(1, t * 400);
    else if (name === "stone")
      sample =
        (Math.sin(t * 2 * Math.PI * (72 - t * 40)) * 0.26 * Math.exp(-t * 14) +
          (random(Math.floor(i / 3), 37, seed) - 0.5) * 0.16 * Math.exp(-t * 9)) *
        Math.min(1, t * 400);
    else if (name === "metal")
      sample =
        (Math.sin(t * 2 * Math.PI * 523) * 0.1 +
          Math.sin(t * 2 * Math.PI * 1247) * 0.07 +
          Math.sin(t * 2 * Math.PI * 1868) * 0.04) *
        Math.exp(-t * 6) *
        Math.min(1, t * 600);
    else if (name === "glass") {
      for (let v = 0; v < 5; v++) {
        const onset = random(v, 41, seed) * 0.18;
        if (t > onset)
          sample +=
            Math.sin((t - onset) * 2 * Math.PI * (1800 + random(v, 43, seed) * 2400)) *
            0.06 *
            Math.exp(-(t - onset) * 22);
      }
    } else if (name === "cloth")
      sample = (random(i, 47, seed) - 0.5) * 0.14 * Math.sin(Math.min(1, u) * Math.PI);
    else if (name === "vegetation")
      sample =
        (random(i, 53, seed) - 0.5) *
        0.16 *
        Math.sin(Math.min(1, u) * Math.PI) *
        (0.6 + 0.4 * Math.sin(t * 2 * Math.PI * 23));
    else if (name === "ceramic")
      sample =
        (Math.sin(t * 2 * Math.PI * 940) * 0.12 * Math.exp(-t * 26) +
          (random(i, 59, seed) - 0.5) * 0.2 * Math.exp(-t * 24)) *
        Math.min(1, t * 600);
    else if (name === "volatile")
      sample =
        (Math.sin(t * 2 * Math.PI * (60 - t * 50)) * 0.3 +
          (random(Math.floor(i / 2), 61, seed) - 0.5) * 0.34) *
        Math.exp(-t * 6) *
        Math.min(1, t * 300);
    else if (name === "crumble")
      sample =
        (random(Math.floor(i / 4), 67, seed) - 0.5) *
        0.22 *
        Math.exp(-t * 5) *
        (random(Math.floor(t * 40), 71, seed) > 0.4 ? 1 : 0.3);
    else if (name === "ignite")
      // A rising whoosh with crackling pops.
      sample =
        (random(Math.floor(i / 2), 73, seed) - 0.5) *
          0.28 *
          Math.sin(Math.min(1, u * 1.4) * Math.PI) +
        (random(Math.floor(t * 90), 79, seed) > 0.86 ? (random(i, 83, seed) - 0.5) * 0.35 : 0) *
          Math.exp(-t * 3);
    else if (name === "hiss")
      // Steam: bright noise (differenced) that fades.
      sample =
        (random(i, 89, seed) - random(i + 1, 89, seed)) *
        0.16 *
        Math.min(1, t * 30) *
        Math.exp(-t * 4);
    else if (name === "zap")
      sample =
        ((((t * 118) % 1) - 0.5) * 0.22 + (random(Math.floor(i / 6), 97, seed) - 0.5) * 0.2) *
        (random(Math.floor(t * 60), 101, seed) > 0.3 ? 1 : 0.2) *
        Math.exp(-t * 7) *
        Math.min(1, t * 500);
    else if (name === "boom")
      sample =
        (Math.sin(t * 2 * Math.PI * (78 - t * 46)) * 0.36 +
          (random(Math.floor(i / 5), 103, seed) - 0.5) * 0.42 * Math.exp(-t * 9)) *
        Math.exp(-t * 3.2) *
        Math.min(1, t * 300);
    else if (name === "splash")
      sample =
        ((random(i, 107, seed) - 0.5) * 0.24 * Math.exp(-t * 9) +
          Math.sin(t * 2 * Math.PI * (300 + 500 * random(Math.floor(t * 30), 109, seed))) *
            0.05 *
            Math.exp(-t * 5)) *
        Math.min(1, t * 400);
    else if (name === "gust")
      // Low, smoothed noise swelling and falling away.
      sample =
        (random(Math.floor(i / 9), 113, seed) - 0.5) * 0.3 * Math.sin(Math.min(1, u) * Math.PI);
    else if (name === "thud")
      // A heavy body meeting the ground: a falling low tone with a short dusty burst.
      sample =
        (Math.sin(t * 2 * Math.PI * (58 - t * 34)) * 0.38 * Math.exp(-t * 9) +
          (random(Math.floor(i / 6), 127, seed) - 0.5) * 0.2 * Math.exp(-t * 16)) *
        Math.min(1, t * 500);
    else if (name === "flutter")
      // Cloth unravelling: soft noise trembling at a falling rate.
      sample =
        (random(Math.floor(i / 3), 131, seed) - 0.5) *
        0.18 *
        Math.sin(Math.min(1, u) * Math.PI) *
        (0.55 + 0.45 * Math.sin(t * 2 * Math.PI * (34 - t * 22)));
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
