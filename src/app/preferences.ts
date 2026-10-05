import { MAX_DRAW_DISTANCE, MAX_NPCS, MIN_DRAW_DISTANCE } from "../engine/limits.ts";

export interface Settings {
  version: 1;
  drawDistance: number;
  entityLimit: number;
  population: number;
  showPerformance: boolean;
  /** M09 local screen feedback: camera shake strength (0–1) and hit/blast flashes. */
  cameraShake: number;
  hitFlash: boolean;
}
export const SETTINGS_KEY = "fern:settings:v1";
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  version: 1,
  drawDistance: 4096,
  entityLimit: 8192,
  population: 2400,
  showPerformance: true,
  cameraShake: 1,
  hitFlash: true,
});
export const PRESETS = {
  balanced: { drawDistance: 4096, entityLimit: 8192, population: 6000 },
  expansive: { drawDistance: 8192, entityLimit: 32768, population: 32768 },
  maximum: { drawDistance: MAX_DRAW_DISTANCE, entityLimit: MAX_NPCS, population: MAX_NPCS },
} as const;

/** Strict for interactive/API changes; malformed persisted preferences fall back safely. */
export function updateSettings(current: Settings, patch: Partial<Settings>): Settings {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw new Error("Expected settings");
  for (const [key, min, max] of [
    ["drawDistance", MIN_DRAW_DISTANCE, MAX_DRAW_DISTANCE],
    ["entityLimit", 0, MAX_NPCS],
    ["population", 0, MAX_NPCS],
  ] as const) {
    const value = patch[key];
    if (value !== undefined && (!Number.isInteger(value) || value < min || value > max))
      throw new Error(`${key} must be an integer from ${min} to ${max}`);
  }
  if (patch.showPerformance !== undefined && typeof patch.showPerformance !== "boolean")
    throw new Error("showPerformance must be a boolean");
  if (
    patch.cameraShake !== undefined &&
    (typeof patch.cameraShake !== "number" ||
      !Number.isFinite(patch.cameraShake) ||
      patch.cameraShake < 0 ||
      patch.cameraShake > 1)
  )
    throw new Error("cameraShake must be a number from 0 to 1");
  if (patch.hitFlash !== undefined && typeof patch.hitFlash !== "boolean")
    throw new Error("hitFlash must be a boolean");
  return {
    version: 1,
    drawDistance: patch.drawDistance ?? current.drawDistance,
    entityLimit: patch.entityLimit ?? current.entityLimit,
    population: patch.population ?? current.population,
    showPerformance: patch.showPerformance ?? current.showPerformance,
    cameraShake: patch.cameraShake ?? current.cameraShake ?? DEFAULT_SETTINGS.cameraShake,
    hitFlash: patch.hitFlash ?? current.hitFlash ?? DEFAULT_SETTINGS.hitFlash,
  };
}
export function parseSettings(raw: string | null): Settings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const data = JSON.parse(raw) as Settings;
    if (!data || data.version !== 1) return { ...DEFAULT_SETTINGS };
    return updateSettings({ ...DEFAULT_SETTINGS }, data);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
