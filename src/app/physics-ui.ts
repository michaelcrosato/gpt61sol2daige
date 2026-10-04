import type { Command } from "../engine/agent.ts";
import type { PhysicsWorld } from "../physics/runtime.ts";

export function mountPhysicsUI(options: {
  world: () => PhysicsWorld | null;
  solo: () => boolean;
  execute: (command: Command) => unknown;
  pause: (paused: boolean) => void;
}) {
  const panel = document.createElement("section");
  panel.className = "physics-panel lab-panel";
  panel.setAttribute("aria-label", "Solo physics playground");
  panel.innerHTML = `<div class="panel-heading">Physics playground <span>SOLO · EXPERIMENTAL</span></div>
    <p class="field-help">Push the crate pile, spin the wheel, or launch a fast body at the wall. This scene is separate from your adventure.</p>
    <div class="physics-controls">
      <button class="secondary-button" id="physics-open">Open / reset playground</button>
      <button class="secondary-button" id="physics-close">Close playground</button>
      <label>Body <select id="physics-body" aria-label="Physics body"></select></label>
      <label>Impulse <input id="physics-strength" aria-label="Physics impulse strength" type="number" min="1" max="1000" value="240"></label>
      <button class="secondary-button" id="physics-push">Push right</button>
      <button class="secondary-button" id="physics-spin">Push off center</button>
      <button class="secondary-button" id="physics-sweep">Launch swept body</button>
      <button class="secondary-button" id="physics-one-tick">Step one tick</button>
      <button class="secondary-button" id="physics-run">Run playground</button>
      <button class="secondary-button" id="physics-pause">Pause playground</button>
      <label class="check-row"><input id="physics-overlay" type="checkbox" checked> Collider overlay</label>
    </div>
    <p id="physics-status">Open the playground to begin. Save trail also saves this scene.</p>
    <canvas id="physics-canvas" width="960" height="580" aria-label="Physical crate pile, wheel and collision wall"></canvas>`;
  document.querySelector("#lab-view .lab-grid")!.before(panel);
  const get = <T extends HTMLElement>(id: string) => panel.querySelector<T>(`#${id}`)!;
  const canvas = get<HTMLCanvasElement>("physics-canvas"),
    ctx = canvas.getContext("2d")!;
  const selector = get<HTMLSelectElement>("physics-body"),
    status = get<HTMLElement>("physics-status");
  let shownIds = "",
    lastSweep = "",
    error = "";
  const act = (id: string, action: () => void) =>
    get<HTMLButtonElement>(id).addEventListener("click", () => {
      try {
        error = "";
        action();
        draw();
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
        status.textContent = error;
      }
    });
  act("physics-open", () => {
    options.execute({ op: "physics", action: "reset" });
    lastSweep = "";
  });
  act("physics-close", () => {
    options.execute({ op: "physics", action: "close" });
    lastSweep = "";
  });
  const impulse = (spin: boolean) => {
    const pose = options
      .world()
      ?.poses()
      .find((body) => body.id === selector.value);
    if (!pose) throw new Error("Select a dynamic body first");
    const x = Number(get<HTMLInputElement>("physics-strength").value);
    if (!Number.isFinite(x) || x < 1 || x > 1000)
      throw new Error("Impulse must be between 1 and 1000");
    options.execute({
      op: "physics",
      action: "impulse",
      id: pose.id,
      x,
      y: 0,
      ...(spin ? { atX: pose.x, atY: pose.y + 9 } : {}),
    });
  };
  act("physics-push", () => impulse(false));
  act("physics-spin", () => impulse(true));
  act("physics-sweep", () => {
    const result = options.execute({ op: "physics", action: "sweep" }) as {
      hit: { id: string; fraction: number } | null;
    };
    lastSweep = result.hit
      ? `Sweep predicts ${result.hit.id} at ${(result.hit.fraction * 100).toFixed(1)}% of the path.`
      : "Sweep finds no obstacle.";
  });
  act("physics-one-tick", () => {
    options.pause(true);
    options.execute({ op: "step", ticks: 1 });
  });
  act("physics-run", () => options.pause(false));
  act("physics-pause", () => options.pause(true));

  function draw() {
    const world = options.world(),
      solo = options.solo(),
      poses = world?.poses() ?? [];
    for (const button of panel.querySelectorAll<HTMLButtonElement>("button"))
      button.disabled = !solo || (button.id !== "physics-open" && !world);
    selector.disabled = !solo || !world;
    const dynamic = poses.filter((body) => body.motion === "dynamic");
    const ids = dynamic.map((body) => body.id).join("|");
    if (ids !== shownIds) {
      const previous = selector.value;
      selector.replaceChildren(...dynamic.map((body) => new Option(body.id, body.id)));
      if (dynamic.some((body) => body.id === previous)) selector.value = previous;
      shownIds = ids;
    }
    status.textContent =
      error ||
      (!solo
        ? "Leave the expedition to use this solo playground."
        : world
          ? `Tick ${world.tick} · ${poses.length} bodies · ${world.contacts} contact starts. ${lastSweep}`
          : "Open the playground to begin. Save trail also saves this scene.");
    ctx.fillStyle = "#14241d";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(1.65, 1.65);
    ctx.strokeStyle = "#243d2f";
    ctx.lineWidth = 0.5;
    for (let n = -280; n <= 280; n += 20) {
      ctx.beginPath();
      ctx.moveTo(n, -170);
      ctx.lineTo(n, 170);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-280, n);
      ctx.lineTo(280, n);
      ctx.stroke();
    }
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = "#679caa";
    ctx.beginPath();
    ctx.moveTo(-180, 110);
    ctx.lineTo(220, 110);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#8eaa9a";
    ctx.font = "8px monospace";
    ctx.fillText("SWEPT MOTION →", -175, 97);
    for (const body of poses) {
      ctx.save();
      ctx.translate(body.x, body.y);
      ctx.rotate(body.angle);
      ctx.fillStyle =
        body.motion === "fixed" ? "#56665b" : body.id === "sweep" ? "#9cdded" : "#c79954";
      ctx.strokeStyle = body.id === selector.value ? "#ffe3a3" : "#5d402c";
      ctx.lineWidth = 1.5;
      if (body.shape.kind === "box") {
        const { width: w, height: h } = body.shape;
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.strokeRect(-w / 2, -h / 2, w, h);
        if (body.motion === "dynamic") {
          ctx.beginPath();
          ctx.moveTo(-w / 2 + 3, -h / 2 + 3);
          ctx.lineTo(w / 2 - 3, h / 2 - 3);
          ctx.moveTo(w / 2 - 3, -h / 2 + 3);
          ctx.lineTo(-w / 2 + 3, h / 2 - 3);
          ctx.stroke();
        }
      } else {
        const r = body.shape.radius;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-r, 0);
        ctx.lineTo(r, 0);
        ctx.moveTo(0, -r);
        ctx.lineTo(0, r);
        ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = "#c4d6c5";
      if (!body.id.startsWith("crate-") || body.id === selector.value)
        ctx.fillText(body.id, body.x - 12, body.y - 20);
    }
    if (world && get<HTMLInputElement>("physics-overlay").checked) {
      const vertices = world.overlay();
      ctx.strokeStyle = "#89f3c4";
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      for (let i = 0; i < vertices.length; i += 4) {
        ctx.moveTo(vertices[i], vertices[i + 1]);
        ctx.lineTo(vertices[i + 2], vertices[i + 3]);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  return { draw };
}
