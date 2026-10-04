import type RAPIER from "@dimforge/rapier2d-compat";

export type RapierAPI = typeof RAPIER;

/** One shared module load; cancellation belongs to the caller, never to another waiter. */
export function createPhysicsInitializer(load: () => Promise<RapierAPI>) {
  let api: RapierAPI | undefined;
  let pending: Promise<void> | undefined;
  let error: string | undefined;
  return {
    async initialize(signal?: AbortSignal): Promise<void> {
      signal?.throwIfAborted();
      if (!api && !pending) {
        error = undefined;
        pending = Promise.resolve()
          .then(load)
          .then((loaded) => {
            api = loaded;
          })
          .catch((cause: unknown) => {
            error = cause instanceof Error ? cause.message : String(cause);
            throw new Error(`Physics initialization failed: ${error}`);
          })
          .finally(() => {
            pending = undefined;
          });
      }
      if (api) return;
      const ready = pending!;
      if (!signal) return ready;
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(signal.reason ?? new Error("Physics initialization canceled"));
        signal.addEventListener("abort", abort, { once: true });
        ready.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
      });
    },
    get(): RapierAPI {
      if (!api)
        throw new Error(
          error ?? "Call and await initializePhysics() before constructing a simulation",
        );
      return api;
    },
    status: () => ({ ready: !!api, loading: !!pending, error }),
  };
}

const backend = createPhysicsInitializer(async () => {
  const { default: api } = await import("@dimforge/rapier2d-compat");
  await api.init();
  return api;
});
export const initializePhysics = backend.initialize;
export const physicsStatus = backend.status;
export const rapier = backend.get;
