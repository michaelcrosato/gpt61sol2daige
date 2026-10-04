import type { SaveState } from "../engine/simulation.ts";

/** Large world checkpoints need more space than localStorage's small string quota. */
function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("fern-worlds", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("checkpoints");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new Error(
          "Local saves are unavailable in this browser. You can still export a Snapshot JSON from Agent lab.",
        ),
      );
  });
}
export async function saveCheckpoint(state: SaveState): Promise<void> {
  const db = await openStore();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("checkpoints", "readwrite");
      transaction.objectStore("checkpoints").put(state, "trail");
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () =>
        reject(new Error("The trail could not be saved. Your previous save is unchanged."));
    });
  } finally {
    db.close();
  }
}
export async function loadCheckpoint(): Promise<SaveState | null> {
  try {
    const db = await openStore();
    try {
      const state = await new Promise<SaveState | undefined>((resolve, reject) => {
        const request = db.transaction("checkpoints").objectStore("checkpoints").get("trail");
        request.onsuccess = () => resolve(request.result as SaveState | undefined);
        request.onerror = () => reject(request.error);
      });
      if (state) return state;
    } finally {
      db.close();
    }
  } catch {
    /* Existing version-1 localStorage saves remain readable. */
  }
  const legacy = localStorage.getItem("fern:save:v1");
  return legacy ? (JSON.parse(legacy) as SaveState) : null;
}
export async function hasCheckpoint(): Promise<boolean> {
  try {
    const db = await openStore();
    try {
      const count = await new Promise<number>((resolve, reject) => {
        const request = db.transaction("checkpoints").objectStore("checkpoints").count("trail");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (count) return true;
    } finally {
      db.close();
    }
  } catch {
    /* Check legacy storage next. */
  }
  try {
    return !!localStorage.getItem("fern:save:v1");
  } catch {
    return false;
  }
}
