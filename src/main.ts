import "./style.css";
import { icon, mountUI } from "./app/ui.ts";
import { AudioEngine } from "./audio/audio.ts";
import { AgentRuntime, type Command } from "./engine/agent.ts";
import { clamp } from "./engine/math.ts";
import { type Input, idleInput, type SaveState, Simulation, STEP } from "./engine/simulation.ts";
import { LANDMARKS } from "./engine/world.ts";
import { Coop } from "./net/coop.ts";
import { Renderer } from "./render/renderer.ts";

mountUI();
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = el<HTMLCanvasElement>("world-canvas");
const params = new URLSearchParams(location.search);
const seed =
  params.has("seed") && /^\d{1,10}$/.test(params.get("seed")!)
    ? Number(params.get("seed")) >>> 0
    : 142;
const runtime = new AgentRuntime(new Simulation(seed, 2400));
const renderer = new Renderer(canvas, el<HTMLCanvasElement>("minimap"));
const audio = new AudioEngine();
let started = false,
  paused = false,
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
let fps = 60,
  frameMs = 16.67,
  accumulator = 0,
  lastFrame = performance.now(),
  lastUI = 0,
  stepMs = 0,
  renderMs = 0;
const net = new Coop(
  () => runtime.sim,
  (sim) => {
    runtime.sim = sim;
    runtime.localId = net.localId;
  },
  updateNetwork,
);

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
  if (!["observe", "describe", "inspect", "save"].includes(command.op)) ensureAuthority();
  if (
    net.status.role !== "solo" &&
    ["reset", "restore", "join", "leave", "step", "teleport"].includes(command.op)
  )
    throw new Error("Leave the expedition before using this lab command.");
  if (command.op === "restore") {
    const restored = Simulation.restore(command.state as SaveState);
    const me = restored.players.get("local") ?? restored.players.values().next().value;
    restored.players.clear();
    if (me) {
      me.id = "local";
      restored.players.set("local", me);
    } else restored.addPlayer("local");
    command = { ...command, state: restored.save() };
  }
  const result = runtime.execute(command);
  if (["reset", "restore"].includes(command.op)) {
    runtime.localId = net.localId;
    latestEvent = -1;
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
  view = next;
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
  const p = runtime.sim.players.get(net.localId);
  atlasCenter = { x: p?.x ?? 0, y: p?.y ?? 0 };
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
  for (const id of ["pause", "step", "load", "replay"]) el<HTMLButtonElement>(id).disabled = online;
  runtime.localId = net.localId;
  if (online && paused) setPaused(false);
}
function setPaused(value: boolean): void {
  if (net.status.role !== "solo" && value)
    throw new Error("Leave the expedition to pause the simulation.");
  paused = value;
  accumulator = 0;
  el("pause-label").hidden = !paused;
  el("pause").innerHTML = `${icon(paused ? "play" : "pause", 15)}${paused ? "Resume" : "Pause"}`;
}
function saveTrail(): void {
  ensureAuthority();
  localStorage.setItem("fern:save:v1", JSON.stringify(runtime.sim.save()));
  toast("Trail saved on this device.");
}
function loadTrail(): void {
  const data = localStorage.getItem("fern:save:v1");
  if (!data) throw new Error("No saved trail yet. Save one in Agent lab.");
  execute({ op: "restore", state: JSON.parse(data) as SaveState });
  runtime.beginRecording();
  renderer.follow = true;
  toast("Welcome back to your trail.");
  begin();
}
el("begin").addEventListener("click", begin);
el("continue").addEventListener("click", safe(loadTrail));
try {
  el("continue").hidden = !localStorage.getItem("fern:save:v1");
} catch {
  /* Storage can be unavailable in private contexts. */
}
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
el("help").addEventListener("click", () => el<HTMLDialogElement>("help-dialog").showModal());
el("help-done").addEventListener("click", () => el<HTMLDialogElement>("help-dialog").close());
for (const dialog of document.querySelectorAll<HTMLDialogElement>("dialog")) {
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
  el<HTMLDialogElement>("session-dialog").showModal();
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
  if (event.button === 2) {
    dragging = true;
    renderer.follow = false;
    dragX = event.clientX;
    dragY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  }
});
canvas.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  renderer.x -= (event.clientX - dragX) / renderer.zoom;
  renderer.y -= (event.clientY - dragY) / renderer.zoom;
  dragX = event.clientX;
  dragY = event.clientY;
});
canvas.addEventListener("pointerup", () => {
  dragging = false;
});
canvas.addEventListener("pointercancel", () => {
  dragging = false;
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
  if (key === "1" && !event.repeat) el("lantern").click();
  if (key === "f") renderer.follow = true;
  if (key === "+" || key === "=") renderer.setZoom(renderer.targetZoom * 1.2);
  if (key === "-") renderer.setZoom(renderer.targetZoom / 1.2);
});
document.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));
window.addEventListener("blur", () => {
  keys.clear();
  inputOverride = null;
  touchInput = { x: 0, y: 0 };
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
    dash: keys.has("shift") || keys.has("3") || now < dashUntil,
    pulse: keys.has(" ") || keys.has("2") || now < pulseUntil,
    interact: keys.has("e") || now < interactUntil,
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
  if (player) {
    el("location").textContent = sim.world.biome(player.x, player.y);
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
}
function processEvents(): void {
  for (let i = 0; i < runtime.sim.events.length; i++) {
    const event = runtime.sim.events[i];
    if (event.tick <= latestEvent) continue;
    if (event.type !== "rest") audio.play(event.type);
    if (event.player === net.localId && event.message) toast(event.message);
  }
  if (runtime.sim.events.length) latestEvent = runtime.sim.events.at(-1)!.tick;
}
function loop(now: number): void {
  const delta = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  frameMs = frameMs * 0.94 + delta * 1000 * 0.06;
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
      accumulator += delta;
      const ticks = Math.min(Math.floor(accumulator / STEP), 5);
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
  net.update(delta, input, Math.hypot(renderer.width, renderer.height) / (2 * renderer.zoom) + 160);
  const alpha =
    net.status.role === "guest"
      ? clamp((now - net.lastSnapshot) / 100, 0, 1)
      : paused
        ? 1
        : clamp(accumulator / STEP, 0, 1);
  if (view === "world") {
    renderer.draw(runtime.sim, net.localId, alpha, now / 1000, delta);
    renderMs = renderMs * 0.9 + renderer.metrics.renderMs * 0.1;
  }
  if (now - lastUI > 250) {
    updateUI();
    processEvents();
    lastUI = now;
  }
  requestAnimationFrame(loop);
}

/** Deliberate public automation API. All state-changing commands pass through the same engine protocol. */
const api = {
  describe: () => runtime.execute({ op: "describe" }),
  observe: () => ({
    ...runtime.sim.observe(),
    render: { ...renderer.metrics, renderMs, fps, frameMs, zoom: renderer.zoom },
    network: { ...net.status },
    paused,
    view,
  }),
  command: (command: Command) => execute(command),
  batch: (commands: Command[]) => {
    if (!Array.isArray(commands) || commands.length > 1000)
      throw new Error("Batch must contain at most 1000 commands");
    return commands.map(execute);
  },
  pause: (value = true) => setPaused(value),
  start: begin,
  view: changeView,
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
  },
};
declare global {
  interface Window {
    fern: typeof api;
  }
}
window.fern = api;
updateUI();
requestAnimationFrame(loop);
