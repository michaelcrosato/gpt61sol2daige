import "./style.css";
import "./adventure.css";
import { AdventureUI } from "./app/adventure-ui.ts";
import { GameDisplay } from "./app/display.ts";
import { mountPhysicsUI } from "./app/physics-ui.ts";
import {
  DEFAULT_SETTINGS,
  PRESETS,
  parseSettings,
  SETTINGS_KEY,
  type Settings,
  updateSettings,
} from "./app/preferences.ts";
import { hasCheckpoint, loadCheckpoint, saveCheckpoint } from "./app/save-store.ts";
import { mountSettingsUI } from "./app/settings-ui.ts";
import { icon, mountUI } from "./app/ui.ts";
import { AudioEngine } from "./audio/audio.ts";
import { AgentRuntime, type Command } from "./engine/agent.ts";
import { clamp } from "./engine/math.ts";
import { type Input, idleInput, type SaveState, Simulation, STEP } from "./engine/simulation.ts";
import { LANDMARKS } from "./engine/world.ts";
import type { AdventureAction } from "./game/types.ts";
import { Coop } from "./net/coop.ts";
import { initializePhysics } from "./physics/bootstrap.ts";
import { Renderer } from "./render/renderer.ts";

mountUI();
mountSettingsUI();
const bootMessage = document.createElement("p");
bootMessage.id = "physics-boot";
bootMessage.setAttribute("role", "status");
bootMessage.textContent = "Preparing the world…";
document.getElementById("viewport")!.append(bootMessage);
const bootController = new AbortController();
window.addEventListener("pagehide", () => bootController.abort(), { once: true });
try {
  await initializePhysics(bootController.signal);
  bootController.signal.throwIfAborted();
  bootMessage.remove();
} catch (error) {
  bootMessage.setAttribute("role", "alert");
  bootMessage.textContent = `${error instanceof Error ? error.message : String(error)}. Reload to retry.`;
  throw error;
}
let preferences: Settings;
try {
  preferences = parseSettings(localStorage.getItem(SETTINGS_KEY));
} catch {
  preferences = { ...DEFAULT_SETTINGS };
}
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = el<HTMLCanvasElement>("world-canvas");
const params = new URLSearchParams(location.search);
const seed =
  params.has("seed") && /^\d{1,10}$/.test(params.get("seed")!)
    ? Number(params.get("seed")) >>> 0
    : 142;
const runtime = new AgentRuntime(new Simulation(seed, preferences.population));
let physicsEventSource = runtime.sim.playground;
let latestPhysicsTick = 0;
let frameHandle = 0;
let activePage = true;
const renderer = new Renderer(canvas, el<HTMLCanvasElement>("minimap"));
renderer.drawDistance = preferences.drawDistance;
renderer.entityLimit = preferences.entityLimit;
const audio = new AudioEngine();
let started = false,
  paused = false,
  manuallyPaused = false,
  view = "world",
  lastInput = "",
  latestEvent = -1,
  toastTimer: ReturnType<typeof setTimeout>;
let atlasCenter = { x: 0, y: 0 };
let inputOverride: Input | null = null;
let previousNetworkRole = "solo";
const keys = new Set<string>();
let touchInput = { x: 0, y: 0 },
  pulseUntil = 0,
  dashUntil = 0,
  interactUntil = 0;
let attackUntil = 0,
  lanceUntil = 0,
  novaUntil = 0,
  potionUntil = 0,
  attacking = false,
  pointerAim = false;
let pointerWorld = { x: 0, y: 0 },
  latestCombatEvent = 0;
let pointerScreen = { x: 0, y: 0 },
  combatSession = "";
let fps = 60,
  frameMs = 16.67,
  accumulator = 0,
  lastFrame = performance.now(),
  lastUI = 0,
  stepMs = 0,
  renderMs = 0;
let tickRate = 60,
  lastRateTime = performance.now(),
  lastRateTick = runtime.sim.tick;
const net = new Coop(
  () => runtime.sim,
  (sim) => {
    if (runtime.sim !== sim) runtime.sim.dispose();
    runtime.sim = sim;
    runtime.localId = net.localId;
  },
  updateNetwork,
);
const physicsUI = mountPhysicsUI({
  world: () => runtime.sim.playground,
  adventure: () => runtime.sim.physical,
  solo: () => net.status.role === "solo" && net.status.state !== "connecting",
  host: () => net.status.role === "host",
  execute,
  pause: setPaused,
  paused: () => paused,
});
const display = new GameDisplay(
  updateDisplay,
  () => {
    for (const dialog of document.querySelectorAll<HTMLDialogElement>("dialog[open]"))
      dialog.close();
    el("sidebar").classList.remove("open");
    changeView("world");
    if (paused) setPaused(false);
    begin();
  },
  toast,
);
const adventureUI = new AdventureUI({
  sim: () => runtime.sim,
  player: () => net.localId,
  role: () => net.status.role,
  action: gameAction,
  showDialog: openDialog,
  closeDialog: closeDialog,
  notify: toast,
  clearInput: () => {
    keys.clear();
    touchInput = { x: 0, y: 0 };
    inputOverride = null;
    attacking = false;
  },
  preview: (index) => {
    execute({ op: "encounter", index });
    renderer.follow = true;
    latestCombatEvent = 0;
  },
});
async function gameAction(action: AdventureAction): Promise<unknown> {
  if (net.status.role === "guest") return net.action(action);
  const result = execute({ op: "adventure", action });
  if (action.type === "new-run") latestCombatEvent = 0;
  return result;
}

function quality(): Settings {
  return {
    ...preferences,
    population: net.status.role === "guest" ? net.status.population : runtime.sim.count,
  };
}
function setQuality(patch: Partial<Settings>): Settings {
  const next = updateSettings(quality(), patch);
  if (patch.population !== undefined && net.status.role === "guest")
    throw new Error(
      "Only the host can change the world population. Your view settings are independent.",
    );
  if (net.status.role !== "guest" && next.population !== runtime.sim.count)
    execute({ op: "population", count: next.population });
  preferences = {
    ...next,
    population: net.status.role === "guest" ? preferences.population : next.population,
  };
  renderer.drawDistance = next.drawDistance;
  renderer.entityLimit = next.entityLimit;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(preferences));
  } catch {
    toast("Settings applied for this session. Browser storage is unavailable.");
  }
  updateDisplay();
  updateUI();
  return quality();
}
function updateDisplay(): void {
  el("game-performance").hidden = !preferences.showPerformance;
  el("settings-game-mode").innerHTML =
    `${icon(display.gameMode ? "collapse" : "expand", 16)}${display.gameMode ? "Exit game mode" : "Game mode"}`;
  if (!display.gameMode) el("sidebar").classList.remove("open");
  el("game-journal").setAttribute(
    "aria-expanded",
    String(el("sidebar").classList.contains("open")),
  );
  requestAnimationFrame(() => renderer.resize());
}
const settingFields = [
  ["distance", "drawDistance"],
  ["entities", "entityLimit"],
  ["population", "population"],
] as const;
function fillSettings(values: Settings): void {
  for (const [field, key] of settingFields) {
    el<HTMLInputElement>(`setting-${field}`).value = String(values[key]);
    el<HTMLInputElement>(`setting-${field}-value`).value = String(values[key]);
  }
  el<HTMLInputElement>("setting-performance").checked = values.showPerformance;
  el("settings-error").hidden = true;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-quality]"))
    button.setAttribute("aria-pressed", "false");
}
function showSettings(): void {
  keys.clear();
  touchInput = { x: 0, y: 0 };
  inputOverride = null;
  fillSettings(quality());
  updateNetwork();
  openDialog(el<HTMLDialogElement>("settings-dialog"));
}
for (const id of ["settings-open", "game-settings"]) el(id).addEventListener("click", showSettings);
for (const [field] of settingFields) {
  const slider = el<HTMLInputElement>(`setting-${field}`),
    number = el<HTMLInputElement>(`setting-${field}-value`);
  slider.addEventListener("input", () => {
    number.value = slider.value;
  });
  number.addEventListener("input", () => {
    if (number.validity.valid && number.value !== "") slider.value = number.value;
  });
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-quality]"))
  button.addEventListener("click", () => {
    const preset = PRESETS[button.dataset.quality as keyof typeof PRESETS];
    fillSettings({
      ...quality(),
      ...preset,
      population: net.status.role === "guest" ? quality().population : preset.population,
    });
    button.setAttribute("aria-pressed", "true");
  });
el("settings-reset").addEventListener("click", () =>
  fillSettings({
    ...DEFAULT_SETTINGS,
    population: net.status.role === "guest" ? quality().population : DEFAULT_SETTINGS.population,
  }),
);
el("settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const patch: Partial<Settings> = {
      drawDistance: Number(el<HTMLInputElement>("setting-distance-value").value),
      entityLimit: Number(el<HTMLInputElement>("setting-entities-value").value),
      showPerformance: el<HTMLInputElement>("setting-performance").checked,
    };
    if (net.status.role !== "guest")
      patch.population = Number(el<HTMLInputElement>("setting-population-value").value);
    setQuality(patch);
    el<HTMLDialogElement>("settings-dialog").close();
    canvas.focus({ preventScroll: true });
    toast("Settings applied. Your world has a little more room to grow.");
  } catch (error) {
    el("settings-error").hidden = false;
    el("settings-error").textContent = error instanceof Error ? error.message : String(error);
  }
});
el("fullscreen-open").addEventListener(
  "click",
  safe(() => display.enter()),
);
el("fullscreen-exit").addEventListener(
  "click",
  safe(() => display.exit()),
);
el("settings-game-mode").addEventListener(
  "click",
  safe(() => {
    el<HTMLDialogElement>("settings-dialog").close();
    return display.toggle();
  }),
);
el("game-map").addEventListener("click", () => changeView(view === "atlas" ? "world" : "atlas"));
el("game-journal").addEventListener("click", () => {
  el("sidebar").classList.toggle("open");
  el("game-journal").setAttribute(
    "aria-expanded",
    String(el("sidebar").classList.contains("open")),
  );
});
el("game-sound").addEventListener("click", () => el("sound").click());

function toast(message: string, duration = 4200): void {
  if (!message) return;
  const target = el("toast");
  target.textContent = message;
  target.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    target.hidden = true;
  }, duration);
}
function begin(): void {
  started = true;
  el("welcome").hidden = true;
  el("trail-note").hidden = false;
  renderer.follow = true;
  canvas.focus({ preventScroll: true });
  setTimeout(() => {
    el("trail-note").hidden = true;
  }, 11000);
}
function download(name: string, value: unknown): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function ensureAuthority(): void {
  if (net.status.role === "guest")
    throw new Error(
      "World changes belong to the host. Leave the expedition to edit your solo world.",
    );
}
function execute(command: Command): unknown {
  if (!command || typeof command !== "object" || typeof command.op !== "string")
    throw new Error("Expected a command object");
  if (["physics", "actors"].includes(command.op) && net.status.state === "connecting")
    throw new Error(
      "Wait for the expedition connection to finish before using the solo playground",
    );
  if (["physics", "actors"].includes(command.op) && command.action === "apply" && !paused)
    throw new Error(
      "Pause the playground before deliberately applying policies; running edits apply on the next tick.",
    );
  if (
    !["observe", "describe", "inspect", "save", "catalog"].includes(command.op) &&
    !(
      command.op === "actors" &&
      ["inspect", "body", "policy"].includes(String(command.action ?? "inspect"))
    ) &&
    !(command.op === "adventure" && !command.action)
  )
    ensureAuthority();
  if (
    net.status.role !== "solo" &&
    ["reset", "restore", "join", "leave", "step", "teleport", "physics"].includes(command.op)
  )
    throw new Error("Leave the expedition before using this lab command.");
  if (command.op === "restore") {
    const restored = Simulation.restore(command.state as SaveState);
    try {
      if (!restored.players.size) restored.addPlayer("local");
      if (restored.players.size === 1 && restored.players.has("local"))
        command = { ...command, state: restored.save() };
      else {
        const local = restored.continueSolo(
          restored.players.has("local") ? "local" : restored.players.keys().next().value!,
        );
        try {
          command = { ...command, state: local.save() };
        } finally {
          local.dispose();
        }
      }
    } finally {
      restored.dispose();
    }
  }
  const result = runtime.execute(command);
  if (
    ["restore", "reset"].includes(command.op) ||
    (command.op === "physics" && ["reset", "close"].includes(String(command.action)))
  ) {
    physicsEventSource = runtime.sim.playground;
    latestPhysicsTick = physicsEventSource?.tick ?? 0;
  }
  if (["reset", "restore"].includes(command.op)) {
    runtime.localId = net.localId;
    latestEvent = -1;
    latestCombatEvent = 0;
    lastInput = "";
    accumulator = 0;
    updateUI();
  }
  if (command.op === "input")
    inputOverride =
      runtime.sim.players.get(typeof command.player === "string" ? command.player : runtime.localId)
        ?.input ?? null;
  return result;
}
function safe(action: () => unknown) {
  return () => {
    try {
      const result = action();
      if (result instanceof Promise)
        void result.catch((e: unknown) => toast(e instanceof Error ? e.message : String(e)));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };
}
function changeView(next: string): void {
  el("sidebar").classList.remove("open");
  el("game-journal").setAttribute("aria-expanded", "false");
  view = next;
  refreshPause();
  keys.clear();
  touchInput = { x: 0, y: 0 };
  inputOverride = null;
  el("atlas-view").hidden = next !== "atlas";
  el("lab-view").hidden = next !== "lab";
  for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-view]")) {
    const active = tab.dataset.view === next;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-pressed", String(active));
  }
  if (next === "atlas") drawAtlas();
  if (next === "world") canvas.focus({ preventScroll: true });
  updateUI();
}
function drawAtlas(): void {
  atlasCenter = { x: 1400, y: 0 };
  renderer.atlas(
    el<HTMLCanvasElement>("atlas-canvas"),
    runtime.sim.world,
    runtime.sim,
    atlasCenter.x,
    atlasCenter.y,
  );
}
function setWaypoint(x: number, y: number, name?: string): void {
  renderer.waypoint = { x, y };
  el("waypoint-label").textContent = `Trail marker: ${Math.round(x)}, ${Math.round(y)}`;
  toast(
    name
      ? `Trail marked: ${name}. Open the atlas to find your way.`
      : "A new trail marker. The journey is yours.",
  );
}
function updateNetwork(): void {
  // Constructor does not call this; all callbacks run after net is initialized.
  if (previousNetworkRole !== "solo" && net.status.role === "solo") {
    runtime.beginRecording();
    lastInput = "";
    latestEvent = -1;
    inputOverride = null;
  }
  previousNetworkRole = net.status.role;
  el("party-count").textContent = `${runtime.sim.players.size} / 8`;
  el("session-status").textContent = net.status.message;
  el("network-message").textContent = net.status.message;
  el("room-share").hidden = net.status.role === "solo";
  el("session-create").hidden = net.status.role !== "solo";
  el("join-form").hidden = net.status.role !== "solo";
  el<HTMLButtonElement>("host-room").disabled = net.status.state === "connecting";
  el<HTMLButtonElement>("join-room").disabled = net.status.state === "connecting";
  if (net.status.room) {
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set("room", net.status.room);
    el<HTMLInputElement>("invite-link").value = url.toString();
  }
  const guest = net.status.role === "guest",
    online = net.status.role !== "solo";
  for (const id of ["population", "apply-seed", "world-seed"])
    el<HTMLInputElement>(id).disabled = guest;
  for (const id of ["setting-population", "setting-population-value"])
    el<HTMLInputElement>(id).disabled = guest;
  el("population-help").textContent = guest
    ? "The host sets ambient wildlife. Your view limit is independent; encounter enemies always stay visible."
    : "Ambient wildlife around the combat areas. Encounters generate their own enemies; the host controls population in co-op.";
  for (const id of ["pause", "step", "load", "game-load", "replay"])
    el<HTMLButtonElement>(id).disabled = online;
  el<HTMLButtonElement>("game-save").disabled = guest;
  runtime.localId = net.localId;
  if (online && paused) setPaused(false);
  refreshPause();
}
function setPaused(value: boolean): void {
  if (net.status.role !== "solo" && value)
    throw new Error("Leave the expedition to pause the simulation.");
  manuallyPaused = value;
  refreshPause();
}
function refreshPause(): void {
  const next =
    manuallyPaused ||
    (net.status.role === "solo" && (view === "atlas" || !!document.querySelector("dialog[open]")));
  if (next !== paused) accumulator = 0;
  paused = next;
  el("pause-label").hidden = !paused;
  el("pause").innerHTML = `${icon(paused ? "play" : "pause", 15)}${paused ? "Resume" : "Pause"}`;
}
function openDialog(dialog: HTMLDialogElement): void {
  keys.clear();
  touchInput = { x: 0, y: 0 };
  inputOverride = null;
  attacking = false;
  if (!dialog.open) dialog.showModal();
  refreshPause();
}
function closeDialog(dialog: HTMLDialogElement): void {
  dialog.close();
  refreshPause();
}
async function saveTrail(): Promise<void> {
  ensureAuthority();
  await saveCheckpoint(runtime.sim.save());
  el("continue").hidden = false;
  toast("Trail saved on this device.");
}
async function loadTrail(): Promise<void> {
  const data = await loadCheckpoint();
  if (!data) throw new Error("No saved trail yet. Save one in Agent lab.");
  execute({ op: "restore", state: data });
  runtime.beginRecording();
  renderer.follow = true;
  toast("Welcome back to your trail.");
  begin();
}
el("begin").addEventListener(
  "click",
  safe(async () => {
    begin();
    if (runtime.sim.adventure.state.mode === "town") await gameAction({ type: "depart" });
  }),
);
el("continue").addEventListener("click", safe(loadTrail));
void hasCheckpoint().then((saved) => {
  el("continue").hidden = !saved;
});
el("game-save").addEventListener(
  "click",
  safe(async () => {
    el<HTMLDialogElement>("settings-dialog").close();
    await saveTrail();
  }),
);
el("game-load").addEventListener(
  "click",
  safe(async () => {
    el<HTMLDialogElement>("settings-dialog").close();
    await loadTrail();
  }),
);
for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-view]"))
  tab.addEventListener("click", () => changeView(tab.dataset.view!));
el("open-map").addEventListener("click", () => changeView("atlas"));
el("atlas-back").addEventListener("click", () => changeView("world"));
el("journal-toggle").addEventListener("click", () => el("sidebar").classList.toggle("open"));
el("zoom-in").addEventListener("click", () => renderer.setZoom(renderer.targetZoom * 1.4));
el("zoom-out").addEventListener("click", () => renderer.setZoom(renderer.targetZoom / 1.4));
el("recenter").addEventListener("click", () => {
  renderer.follow = true;
  toast("Back on your trail.");
});
el("lantern").addEventListener("click", () => {
  renderer.lantern = !renderer.lantern;
  el("lantern").classList.toggle("active", renderer.lantern);
  el("lantern").setAttribute("aria-pressed", String(renderer.lantern));
});
el("pulse").addEventListener("click", () => {
  if (!started) begin();
  pulseUntil = performance.now() + 180;
});
el("attack-button").addEventListener("pointerdown", (event) => {
  event.preventDefault();
  if (!started) begin();
  inputOverride = null;
  pointerAim = false;
  attacking = true;
  el("attack-button").setPointerCapture(event.pointerId);
});
for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
  el("attack-button").addEventListener(name, () => {
    attacking = false;
  });
el("attack-button").addEventListener("click", () => {
  attackUntil = performance.now() + 200;
});
el("lance-button").addEventListener("click", () => {
  if (!started) begin();
  if (!runtime.sim.adventure.stats(net.localId).lance) {
    toast("Unlock Thornlance in the Stormstep skill path (K).");
    return;
  }
  lanceUntil = performance.now() + 180;
});
el("nova-button").addEventListener("click", () => {
  if (!started) begin();
  if (!runtime.sim.adventure.stats(net.localId).nova) {
    toast("Unlock Bloom Nova in the Emberwake skill path (K).");
    return;
  }
  novaUntil = performance.now() + 180;
});
el("potion-button").addEventListener("click", () => {
  if (!started) begin();
  potionUntil = performance.now() + 180;
});
el("dash").addEventListener("click", () => {
  if (!started) begin();
  dashUntil = performance.now() + 180;
});
el("touch-interact").addEventListener("click", () => {
  if (!started) begin();
  interactUntil = performance.now() + 180;
});
el("sound").addEventListener(
  "click",
  safe(async () => {
    const enabled = await audio.toggle();
    el("sound").innerHTML =
      `${icon(enabled ? "sound" : "mute", 17)}<span>Sound ${enabled ? "on" : "off"}</span>`;
    el("sound").setAttribute("aria-pressed", String(enabled));
    el("sound").setAttribute("aria-label", enabled ? "Disable sound" : "Enable sound");
  }),
);
el("help").addEventListener("click", () => openDialog(el<HTMLDialogElement>("help-dialog")));
el("help-done").addEventListener("click", () => el<HTMLDialogElement>("help-dialog").close());
for (const dialog of document.querySelectorAll<HTMLDialogElement>("dialog")) {
  dialog.addEventListener("close", refreshPause);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        dialog.close();
    }
  });
}
function showSession(): void {
  keys.clear();
  openDialog(el<HTMLDialogElement>("session-dialog"));
  updateNetwork();
}
el("invite").addEventListener("click", showSession);
el("join-open").addEventListener("click", () => {
  showSession();
  el<HTMLInputElement>("room-code").focus();
});
el("host-room").addEventListener(
  "click",
  safe(async () => {
    await net.host();
    begin();
    toast("Your expedition is open. Copy the invite for your friends.");
  }),
);
el("join-room").addEventListener(
  "click",
  safe(async () => {
    await net.join(el<HTMLInputElement>("room-code").value);
    begin();
    el<HTMLDialogElement>("session-dialog").close();
    toast("Another traveler. Another story. Welcome to the expedition.");
  }),
);
el("leave-room").addEventListener("click", () => {
  net.disconnect();
  runtime.beginRecording();
  latestEvent = -1;
  toast("You are exploring solo again.");
});
el("copy-link").addEventListener(
  "click",
  safe(async () => {
    const field = el<HTMLInputElement>("invite-link");
    try {
      await navigator.clipboard.writeText(field.value);
      el("copy-link").textContent = "Copied";
      setTimeout(() => {
        el("copy-link").textContent = "Copy";
      }, 2000);
    } catch {
      field.select();
      toast("Select and copy this invite link.");
    }
  }),
);
if (params.get("room")) {
  el<HTMLInputElement>("room-code").value = params.get("room")!;
  showSession();
  el("network-message").textContent = "Your friend left a trail for you. Join when you're ready.";
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-beacon]"))
  button.addEventListener("click", () => {
    const l = LANDMARKS.find((landmark) => landmark.id === button.dataset.beacon)!;
    setWaypoint(l.x, l.y, l.name);
    changeView("atlas");
    el("sidebar").classList.remove("open");
  });
el<HTMLCanvasElement>("atlas-canvas").addEventListener("click", (event) => {
  const c = el<HTMLCanvasElement>("atlas-canvas"),
    r = c.getBoundingClientRect();
  const x = ((event.clientX - r.left) * c.width) / r.width,
    y = ((event.clientY - r.top) * c.height) / r.height;
  setWaypoint(
    Math.round(atlasCenter.x + (x - c.width / 2) * 6),
    Math.round(atlasCenter.y + (y - c.height / 2) * 6),
  );
});
el("apply-seed").addEventListener(
  "click",
  safe(() => {
    execute({ op: "reset", seed: Number(el<HTMLInputElement>("world-seed").value) });
    renderer.follow = true;
    renderer.x = renderer.y = 0;
    toast("A new seed. A whole new wilderness.");
  }),
);
el<HTMLInputElement>("population").addEventListener("input", (event) => {
  el("population-label").textContent = Number(
    (event.target as HTMLInputElement).value,
  ).toLocaleString();
});
el<HTMLInputElement>("population").addEventListener(
  "change",
  safe(() => {
    execute({ op: "population", count: Number(el<HTMLInputElement>("population").value) });
    toast(`${runtime.sim.count.toLocaleString()} creatures now wander the world.`);
  }),
);
el<HTMLInputElement>("debug-overlay").addEventListener("change", (event) => {
  renderer.debug = (event.target as HTMLInputElement).checked;
});
el<HTMLInputElement>("daytime").addEventListener("input", (event) => {
  renderer.daytime = Number((event.target as HTMLInputElement).value);
});
el("pause").addEventListener(
  "click",
  safe(() => setPaused(!paused)),
);
el("step").addEventListener(
  "click",
  safe(() => {
    setPaused(true);
    execute({ op: "step", ticks: 60 });
    updateUI();
  }),
);
el("save").addEventListener("click", safe(saveTrail));
el("load").addEventListener("click", safe(loadTrail));
el("snapshot").addEventListener("click", () =>
  download(`fern-${runtime.sim.world.seed}-tick-${runtime.sim.tick}.json`, runtime.sim.save()),
);
el("replay").addEventListener(
  "click",
  safe(() => {
    if (net.status.role !== "solo") throw new Error("Replay export is available in solo mode.");
    download(`fern-replay-${runtime.sim.tick}.json`, runtime.execute({ op: "replay" }));
  }),
);
el("run-command").addEventListener("click", () => {
  try {
    const command = JSON.parse(el<HTMLTextAreaElement>("command-input").value) as Command;
    const result = execute(command);
    el("command-output").textContent = JSON.stringify(result, null, 2);
    updateUI();
  } catch (error) {
    el("command-output").textContent = JSON.stringify(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      null,
      2,
    );
  }
});
let dragging = false,
  dragX = 0,
  dragY = 0;
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("pointerdown", (event) => {
  canvas.focus({ preventScroll: true });
  const rect = canvas.getBoundingClientRect();
  pointerScreen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  pointerWorld = renderer.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
  if (event.button === 0) {
    if (!started) begin();
    inputOverride = null;
    attacking = true;
    pointerAim = true;
    canvas.setPointerCapture(event.pointerId);
  }
  if (event.button === 2) {
    if (!started) begin();
    pointerAim = true;
    lanceUntil = performance.now() + 180;
  }
  if (event.button === 1) {
    dragging = true;
    renderer.follow = false;
    dragX = event.clientX;
    dragY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  }
});
canvas.addEventListener("pointermove", (event) => {
  const rect = canvas.getBoundingClientRect();
  pointerScreen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  pointerWorld = renderer.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
  if (!dragging) return;
  renderer.x -= (event.clientX - dragX) / renderer.zoom;
  renderer.y -= (event.clientY - dragY) / renderer.zoom;
  dragX = event.clientX;
  dragY = event.clientY;
});
canvas.addEventListener("pointerup", (event) => {
  if (!(event.buttons & 4)) dragging = false;
  if (!(event.buttons & 1)) attacking = false;
});
canvas.addEventListener("pointercancel", () => {
  dragging = false;
  attacking = false;
});
canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    renderer.setZoom(renderer.targetZoom * Math.exp(-event.deltaY * 0.0015));
  },
  { passive: false },
);
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-move]")) {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (!started) begin();
    inputOverride = null;
    const [x, y] = button.dataset.move!.split(",").map(Number);
    touchInput = { x, y };
    button.setPointerCapture(event.pointerId);
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
    button.addEventListener(name, () => {
      touchInput = { x: 0, y: 0 };
    });
}
const movementKeys = [
  "w",
  "a",
  "s",
  "d",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "shift",
  " ",
  "e",
  "2",
  "3",
  "4",
  "1",
  "q",
  "r",
  "f",
  "j",
];
document.addEventListener("keydown", (event) => {
  if (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    (event.target instanceof HTMLElement && event.target.matches("input, textarea, select")) ||
    document.querySelector("dialog[open]")
  )
    return;
  const key = event.key.toLowerCase();
  if (!event.repeat && ["i", "k", "p", "t"].includes(key)) {
    event.preventDefault();
    if (key === "i") adventureUI.open("inventory");
    if (key === "k") adventureUI.open("skills");
    if (key === "p") adventureUI.open("pause");
    if (key === "t") void adventureUI.act({ type: "return" });
    return;
  }
  if (key === "escape" && !display.gameMode && !event.repeat) {
    event.preventDefault();
    adventureUI.open("pause");
    return;
  }
  if ((key === "g" || (key === "escape" && display.gameMode)) && !event.repeat) {
    event.preventDefault();
    keys.clear();
    if (key === "escape" && el("sidebar").classList.contains("open")) {
      el("sidebar").classList.remove("open");
      el("game-journal").setAttribute("aria-expanded", "false");
    } else safe(() => display.toggle())();
    return;
  }
  if (key === "m" && !event.repeat) {
    event.preventDefault();
    changeView(view === "atlas" ? "world" : "atlas");
    return;
  }
  if (view !== "world") return;
  if (movementKeys.includes(key)) {
    event.preventDefault();
    if (!started) begin();
    inputOverride = null;
    keys.add(key);
  }
  if (key === "l" && !event.repeat) el("lantern").click();
  if (key === "c") renderer.follow = true;
  if (key === "j") pointerAim = false;
  if (key === "+" || key === "=") renderer.setZoom(renderer.targetZoom * 1.2);
  if (key === "-") renderer.setZoom(renderer.targetZoom / 1.2);
});
document.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));
window.addEventListener("blur", () => {
  keys.clear();
  inputOverride = null;
  touchInput = { x: 0, y: 0 };
  attacking = false;
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    keys.clear();
    touchInput = { x: 0, y: 0 };
  }
  accumulator = 0;
  lastFrame = performance.now();
});
function getInput(now: number): Input {
  if (inputOverride) return inputOverride;
  if (!started || view !== "world" || document.querySelector("dialog[open]")) return idleInput();
  const player = runtime.sim.players.get(net.localId);
  pointerWorld = renderer.screenToWorld(pointerScreen.x, pointerScreen.y);
  const aimDistance = player ? Math.hypot(pointerWorld.x - player.x, pointerWorld.y - player.y) : 1;
  return {
    x: clamp(
      (keys.has("d") || keys.has("arrowright") ? 1 : 0) -
        (keys.has("a") || keys.has("arrowleft") ? 1 : 0) +
        touchInput.x,
      -1,
      1,
    ),
    y: clamp(
      (keys.has("s") || keys.has("arrowdown") ? 1 : 0) -
        (keys.has("w") || keys.has("arrowup") ? 1 : 0) +
        touchInput.y,
      -1,
      1,
    ),
    dash: keys.has("shift") || keys.has(" ") || now < dashUntil,
    pulse: keys.has("q") || keys.has("2") || now < pulseUntil,
    interact: keys.has("e") || now < interactUntil,
    attack: attacking || keys.has("j") || now < attackUntil,
    lance: keys.has("r") || keys.has("3") || now < lanceUntil,
    nova: keys.has("f") || keys.has("4") || now < novaUntil,
    potion: keys.has("1") || now < potionUntil,
    aimX: pointerAim && player ? (pointerWorld.x - player.x) / Math.max(1, aimDistance) : 0,
    aimY: pointerAim && player ? (pointerWorld.y - player.y) / Math.max(1, aimDistance) : 0,
  };
}
function updateUI(): void {
  const sim = runtime.sim,
    player = sim.players.get(net.localId);
  const total = net.status.role === "guest" ? net.status.population : sim.count;
  el("stat-npcs").textContent = total.toLocaleString();
  el("stat-fps").textContent = String(Math.round(fps));
  el("stat-chunks").textContent = String(sim.world.chunks.size);
  el("seed-label").textContent = `SEED ${String(sim.world.seed).padStart(4, "0")}`;
  el("zoom-value").textContent = `${renderer.zoom.toFixed(renderer.zoom < 1 ? 2 : 1)}×`;
  el("beacon-count").textContent = `${sim.beacons.size} / 3`;
  el("shard-count").textContent = String(sim.shards);
  el("party-count").textContent = `${sim.players.size} / 8`;
  el("game-fps").textContent = `${Math.round(fps)} FPS`;
  el("game-entities").textContent =
    `${renderer.metrics.drawn.toLocaleString()} visible · ${total.toLocaleString()} active`;
  const run = sim.adventure.state;
  el("game-quest").textContent =
    run.mode === "town"
      ? `Land ${run.townLand + 1} · town sanctuary`
      : `Area ${run.area} · ${run.cleared ? "outward gate open" : `${run.kills} / ${run.recipe.killGoal} defeated`}`;
  const rateTime = performance.now();
  if (rateTime - lastRateTime >= 1000 || sim.tick < lastRateTick) {
    tickRate = Math.max(
      0,
      ((sim.tick - lastRateTick) * 1000) / Math.max(1, rateTime - lastRateTime),
    );
    lastRateTime = rateTime;
    lastRateTick = sim.tick;
  }
  el("settings-live").textContent =
    `${Math.round(fps)} FPS · ${renderer.metrics.drawn.toLocaleString()} drawn · ${Math.round(tickRate)} sim Hz`;
  el("game-sound").setAttribute("aria-pressed", String(audio.enabled));
  el("game-sound").setAttribute(
    "aria-label",
    audio.enabled ? "Disable game sound" : "Enable game sound",
  );
  if (el("game-sound").dataset.enabled !== String(audio.enabled)) {
    el("game-sound").innerHTML = icon(audio.enabled ? "sound" : "mute", 18);
    el("game-sound").dataset.enabled = String(audio.enabled);
  }
  if (player) {
    const location = run.mode === "area" ? run.recipe.name : sim.world.biome(player.x, player.y);
    el("location").textContent = location;
    el("game-location").textContent = location;
    el("coordinates").textContent = `${Math.round(player.x)}, ${Math.round(player.y)}`;
    el("energy-fill").style.width = `${clamp(player.energy, 0, 100)}%`;
    for (const landmark of LANDMARKS.slice(1)) {
      const d = Math.hypot(landmark.x - player.x, landmark.y - player.y);
      el(`distance-${landmark.id}`).textContent =
        d > 999 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`;
      el(`check-${landmark.id}`).textContent = sim.beacons.has(landmark.id) ? "✓" : "↗";
      document
        .querySelector(`[data-beacon="${landmark.id}"]`)
        ?.classList.toggle("lit", sim.beacons.has(landmark.id));
    }
  }
  if (view === "lab") {
    el("lab-tick").textContent = sim.tick.toLocaleString();
    el("lab-hash").textContent = sim.stateHash();
    el("lab-physics").textContent = `${stepMs.toFixed(2)} ms`;
    el("lab-chunks").textContent = `${sim.world.chunks.size} / ${sim.world.maxChunks}`;
    if (document.activeElement !== el("world-seed"))
      el<HTMLInputElement>("world-seed").value = String(sim.world.seed);
    if (document.activeElement !== el("population")) {
      el<HTMLInputElement>("population").value = String(total);
      el("population-label").textContent = total.toLocaleString();
    }
  }
  adventureUI.update();
}
function processEvents(): void {
  const physics = runtime.sim.playground;
  if (physics !== physicsEventSource) {
    physicsEventSource = physics;
    latestPhysicsTick = 0;
  }
  for (const event of physics?.events ?? [])
    if (event.tick > latestPhysicsTick && event.started) audio.play("hit");
  latestPhysicsTick = physics?.tick ?? 0;
  const session = `${runtime.sim.adventure.state.seed}:${runtime.sim.adventure.state.run}:${net.localId}`;
  if (session !== combatSession) {
    combatSession = session;
    latestCombatEvent = 0;
  }
  for (let i = 0; i < runtime.sim.events.length; i++) {
    const event = runtime.sim.events[i];
    if (event.tick <= latestEvent) continue;
    if (event.type !== "rest") audio.play(event.type);
    if (event.player === net.localId && event.message && event.type !== "pulse")
      toast(event.message);
  }
  if (runtime.sim.events.length) latestEvent = runtime.sim.events.at(-1)!.tick;
  for (const event of runtime.sim.adventure.state.events) {
    if (event.id <= latestCombatEvent) continue;
    adventureUI.event(event);
    if (
      event.type === "slash" ||
      event.type === "hit" ||
      event.type === "hurt" ||
      event.type === "level"
    )
      audio.play(event.type);
    else if (event.type === "kill") audio.play("hit");
    else if (event.type === "whorl" || event.type === "nova") audio.play("pulse");
    else if (event.type === "loot") audio.play("shard");
    else if (event.type === "portal" || event.type === "boss") audio.play("beacon");
  }
  if (runtime.sim.adventure.state.events.length)
    latestCombatEvent = runtime.sim.adventure.state.events.at(-1)!.id;
}
function loop(now: number): void {
  if (!activePage) return;
  const elapsed = (now - lastFrame) / 1000;
  const delta = Math.min(elapsed, 0.1);
  lastFrame = now;
  frameMs = frameMs * 0.94 + elapsed * 1000 * 0.06;
  fps = 1000 / Math.max(frameMs, 1);
  const input = getInput(now),
    encoded = JSON.stringify(input);
  if (net.status.role !== "guest") {
    if (encoded !== lastInput) {
      runtime.sim.setInput(net.localId, input);
      if (net.status.role === "solo")
        runtime.log.push({ op: "input", player: net.localId, ...input });
      lastInput = encoded;
    }
    if (!paused) {
      accumulator = Math.min(accumulator + delta, STEP * 5);
      // Preserve fixed ticks without allowing an overloaded population to monopolize the UI.
      const tickBudget = Math.max(1, Math.min(5, Math.floor(12 / Math.max(stepMs, 0.1))));
      const ticks = Math.min(Math.floor(accumulator / STEP), tickBudget);
      if (ticks > 0) {
        runtime.sim.step(ticks);
        accumulator = Math.max(0, accumulator - ticks * STEP);
        stepMs = stepMs * 0.9 + runtime.sim.metrics.stepMs * 0.1;
        if (net.status.role === "solo") {
          const last = runtime.log.at(-1);
          if (last?.op === "step" && Number(last.ticks) + ticks <= 36000)
            last.ticks = Number(last.ticks) + ticks;
          else runtime.log.push({ op: "step", ticks });
        }
      }
    }
  }
  net.update(delta, input, {
    x: renderer.x,
    y: renderer.y,
    radius: Math.min(
      renderer.drawDistance,
      Math.hypot(renderer.width, renderer.height) / (2 * renderer.zoom) + 160,
    ),
    entityLimit: renderer.entityLimit,
  });
  const alpha =
    net.status.role === "guest"
      ? clamp((now - net.lastSnapshot) / 100, 0, 1)
      : paused
        ? 1
        : clamp(accumulator / STEP, 0, 1);
  if (view === "world") {
    renderer.draw(
      runtime.sim,
      net.localId,
      alpha,
      now / 1000,
      delta,
      runtime.sim.tick + (paused ? 0 : alpha * (net.status.role === "guest" ? 6 : 1)),
    );
    renderMs = renderMs * 0.9 + renderer.metrics.renderMs * 0.1;
  }
  if (view === "lab") physicsUI.draw();
  if (now - lastUI > 250) {
    updateUI();
    lastUI = now;
  }
  processEvents();
  frameHandle = requestAnimationFrame(loop);
}

/** Deliberate public automation API. All state-changing commands pass through the same engine protocol. */
const api = {
  describe: () => runtime.execute({ op: "describe" }),
  observe: () => ({
    ...runtime.sim.observe(),
    adventure: runtime.sim.adventure.observe(net.localId, runtime.sim.tick),
    render: {
      ...renderer.metrics,
      renderMs,
      fps,
      frameMs,
      zoom: renderer.zoom,
      drawDistance: renderer.drawDistance,
      entityLimit: renderer.entityLimit,
      width: renderer.width,
      height: renderer.height,
      simulationHz: tickRate,
      cameraX: renderer.x,
      cameraY: renderer.y,
    },
    settings: quality(),
    display: display.observe(),
    network: { ...net.status },
    paused,
    view,
  }),
  command: (command: Command) => execute(command),
  game: {
    action: gameAction,
    observe: () => runtime.sim.adventure.observe(net.localId, runtime.sim.tick),
    panel: (panel: "inventory" | "skills" | "town" | "pause" | "mechanics") =>
      adventureUI.open(panel),
  },
  batch: (commands: Command[]) => {
    if (!Array.isArray(commands) || commands.length > 1000)
      throw new Error("Batch must contain at most 1000 commands");
    return commands.map(execute);
  },
  pause: (value = true) => setPaused(value),
  start: begin,
  view: changeView,
  settings: {
    get: quality,
    set: setQuality,
    reset: () =>
      setQuality(
        net.status.role === "guest"
          ? {
              drawDistance: DEFAULT_SETTINGS.drawDistance,
              entityLimit: DEFAULT_SETTINGS.entityLimit,
              showPerformance: DEFAULT_SETTINGS.showPerformance,
            }
          : { ...DEFAULT_SETTINGS },
      ),
  },
  display: {
    enterGame: (fullscreen = true) => display.enter(fullscreen),
    exitGame: () => display.exit(),
    get: () => display.observe(),
  },
  zoom: (value: number) => {
    if (!Number.isFinite(value)) throw new Error("Zoom must be finite");
    renderer.setZoom(value);
  },
  recording: () => {
    if (net.status.role !== "solo") throw new Error("Replay recording is available in solo mode.");
    return runtime.execute({ op: "replay" });
  },
  network: {
    host: () => net.host(),
    join: (room: string) => net.join(room),
    leave: () => {
      net.disconnect();
      runtime.beginRecording();
      lastInput = "";
    },
    status: () => ({ ...net.status }),
    input: (input: Partial<Input>) => {
      inputOverride = { ...idleInput(), ...input };
    },
    localId: () => net.localId,
    interact: (interaction: import("./physics/interaction.ts").PhysicalInteraction) =>
      net.interact(interaction),
  },
};
declare global {
  interface Window {
    fern: typeof api;
  }
}
window.fern = api;
window.addEventListener("pagehide", (event) => {
  if (!event.persisted) {
    activePage = false;
    cancelAnimationFrame(frameHandle);
    net.disconnect(true, false);
    runtime.sim.dispose();
  }
});
updateUI();
frameHandle = requestAnimationFrame(loop);
