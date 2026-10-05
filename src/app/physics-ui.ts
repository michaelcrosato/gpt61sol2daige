import type { Command } from "../engine/agent.ts";
import type { AdventurePhysics } from "../physics/adventure.ts";
import {
  POLICY_PRESETS,
  type PolicyEdit,
  type PolicyScope,
  type PolicyValues,
  type PresetName,
  type RegionProfile,
} from "../physics/policies.ts";
import type { PhysicsWorld } from "../physics/runtime.ts";

export function mountPhysicsUI(options: {
  world: () => PhysicsWorld | null;
  adventure: () => AdventurePhysics | null;
  solo: () => boolean;
  host: () => boolean;
  execute: (command: Command) => unknown;
  pause: (paused: boolean) => void;
  paused: () => boolean;
}) {
  const panel = document.createElement("section");
  panel.className = "physics-panel lab-panel";
  panel.setAttribute("aria-label", "Solo physics playground");
  panel.innerHTML = `<div class="panel-heading">Physics playground <span>SOLO · EXPERIMENTAL</span></div>
    <p class="field-help">Push the crate pile, spin the wheel, or launch a fast body at the wall. This scene is separate from your adventure.</p>
    <div class="physics-controls">
      <label>Physics scene <select id="physics-scene" aria-label="Physics scene"><option value="playground">Playground</option><option value="adventure">Playable adventure</option></select></label>
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
      <label class="check-row"><input id="physics-regions-overlay" type="checkbox" checked> Region overlay</label>
    </div>
    <details class="physics-policy-editor" open>
      <summary>Regional physics policies</summary>
      <p class="field-help">Queued edits apply together at the next tick. While paused, use Apply queued policies. Freezing keeps the current pose and discards motion; waking corrects overlaps and starts at zero velocity.</p>
      <div class="physics-controls">
        <label>Scope <select id="physics-scope" aria-label="Physics policy scope"><option value="land">Land</option><option value="area" selected>Area</option><option value="region">Region</option></select></label>
        <label>Profile <select id="physics-scope-id" aria-label="Physics policy profile"></select></label>
        <label>World reactions <select id="physics-worldReactions" aria-label="World reactions override"><option value="inherit">Inherited</option><option value="true">On</option><option value="false">Off</option></select></label>
        <label>Dynamic props <select id="physics-dynamicProps" aria-label="Dynamic props override"><option value="inherit">Inherited</option><option value="true">On</option><option value="false">Off</option></select></label>
        <label>Prop blocking <select id="physics-propBlocking" aria-label="Prop blocking override"><option value="inherit">Inherited</option><option value="true">On</option><option value="false">Off</option></select></label>
        <label>Crowd contacts <select id="physics-crowdContacts" aria-label="Crowd contacts override"><option value="inherit">Inherited</option><option value="true">On</option><option value="false">Off</option></select></label>
        <label>Ambient physics (adventure) <select id="physics-ambientPhysics" aria-label="Ambient physics override"><option value="inherit">Inherited</option><option value="true">On</option><option value="false">Off</option></select></label>
        <label>Swept collision <select id="physics-sweptCollision" aria-label="Swept collision override"><option value="inherit">Inherited</option><option value="true">On</option><option value="false">Off</option></select></label>
        <label>Impulse multiplier <input id="physics-impulseStrength" aria-label="Impulse multiplier override" type="number" min="0" max="10" step="0.05" placeholder="Inherited"></label>
        <label>Destruction <select id="physics-destruction" aria-label="Destruction override"><option value="inherit">Inherited</option><option value="true">On</option><option value="false">Off</option></select></label>
        <label>Material toughness × <input id="physics-materialDurability" aria-label="Material durability override" type="number" min="0.05" max="20" step="0.05" placeholder="Inherited"></label>
        <label>Debris lifetime (s, 0 = scene) <input id="physics-debrisLifetime" aria-label="Debris lifetime override" type="number" min="0" max="3600" step="1" placeholder="Inherited"></label>
        <label>Impact damage <select id="physics-impactDamage" aria-label="Impact damage override"><option value="inherit">Inherited</option><option value="true">On</option><option value="false">Off</option></select></label>
        <label>Impact strength × <input id="physics-impactStrength" aria-label="Impact strength override" type="number" min="0" max="10" step="0.05" placeholder="Inherited"></label>
        <label>Projectile world collision <select id="physics-projectileWorld" aria-label="Projectile world collision override"><option value="inherit">Inherited</option><option value="true">On</option><option value="false">Off</option></select></label>
        <label>Physical loot <select id="physics-physicalLoot" aria-label="Physical loot override"><option value="inherit">Inherited</option><option value="true">On</option><option value="false">Off</option></select></label>
        <label>Jointed mechanisms <select id="physics-mechanisms" aria-label="Jointed mechanisms override"><option value="inherit">Inherited</option><option value="true">On</option><option value="false">Off</option></select></label>
        <label>Joint breakage <select id="physics-jointBreakage" aria-label="Joint breakage override"><option value="inherit">Inherited</option><option value="true">On</option><option value="false">Off</option></select></label>
        <label>Joint strength × <input id="physics-jointStrength" aria-label="Joint strength override" type="number" min="0.05" max="20" step="0.05" placeholder="Inherited"></label>
        <label>Material reactions <select id="physics-materialReactions" aria-label="Material reactions override"><option value="inherit">Inherited</option><option value="true">On</option><option value="false">Off</option></select></label>
        <label>Chain reactions <select id="physics-chainReactions" aria-label="Chain reactions override"><option value="inherit">Inherited</option><option value="true">On</option><option value="false">Off</option></select></label>
        <label>Environmental forces <select id="physics-environmentalForces" aria-label="Environmental forces override"><option value="inherit">Inherited</option><option value="true">On</option><option value="false">Off</option></select></label>
        <label>Field strength × <input id="physics-fieldStrength" aria-label="Field strength override" type="number" min="0" max="10" step="0.05" placeholder="Inherited"></label>
        <label>Physical ragdolls <select id="physics-ragdolls" aria-label="Physical ragdolls override"><option value="inherit">Inherited</option><option value="true">On</option><option value="false">Off</option></select></label>
        <label>Foliage response <select id="physics-foliage" aria-label="Foliage response override"><option value="inherit">Inherited</option><option value="true">On</option><option value="false">Off</option></select></label>
        <label>Reaction strength × <input id="physics-reactionStrength" aria-label="Reaction strength override" type="number" min="0" max="10" step="0.05" placeholder="Inherited"></label>
        <button class="secondary-button" id="physics-queue">Queue policy edit</button>
        <button class="secondary-button" id="physics-reset-scope">Reset this scope</button>
        <button class="secondary-button" id="physics-reset-authored">Reset to authored</button>
        <label>Preset <select id="physics-preset" aria-label="Physics policy preset">${Object.keys(
          POLICY_PRESETS,
        )
          .map((name) => `<option>${name}</option>`)
          .join("")}</select></label>
        <button class="secondary-button" id="physics-queue-preset">Queue preset</button>
        <button class="secondary-button" id="physics-master">Queue master off</button>
        <button class="secondary-button" id="physics-apply">Apply queued policies</button>
      </div>
      <p id="physics-preset-preview" class="field-help"></p>
      <p id="physics-policy-status" role="status"></p>
      <p id="physics-scope-inspector" class="field-help"></p>
      <details><summary>Author region bounds and profile</summary>
        <p class="field-help">Edit or add a named region in an existing area. Shapes: circle (center/radius), rectangle (top-left/width/height), polygon (3–64 points). Priority breaks overlaps; smaller ID wins ties. Bounds use canvas world coordinates.</p>
        <label>Region recipe <textarea id="physics-region-recipe" aria-label="Physics region recipe" rows="5"></textarea></label>
        <button class="secondary-button" id="physics-region-queue">Queue region recipe</button>
      </details>
    </details>
    <div class="physics-controls">
      <label>Place X <input id="physics-place-x" aria-label="Physics body placement X" type="number" min="-10000" max="10000" value="-210"></label>
      <label>Place Y <input id="physics-place-y" aria-label="Physics body placement Y" type="number" min="-10000" max="10000" value="-70"></label>
      <button class="secondary-button" id="physics-place">Place selected body</button>
      <button class="secondary-button" id="physics-traveler">Spawn contact traveler</button>
      <button class="secondary-button" id="physics-drive-left">Traveler left</button>
      <button class="secondary-button" id="physics-drive-right">Traveler right</button>
      <button class="secondary-button" id="physics-drive-stop">Stop traveler</button>
    </div>
    <p id="physics-body-inspector" class="field-help"></p>
    <p id="physics-status">Open the playground to begin. Save trail also saves this scene.</p>
    <canvas id="physics-canvas" width="960" height="580" aria-label="Physical crate pile, wheel and collision wall"></canvas>`;
  document.querySelector("#lab-view .lab-grid")!.before(panel);
  const get = <T extends HTMLElement>(id: string) => panel.querySelector<T>(`#${id}`)!;
  const scene = get<HTMLSelectElement>("physics-scene");
  const selectedWorld = () =>
    scene.value === "adventure" ? (options.adventure()?.world ?? null) : options.world();
  const operation = () => (scene.value === "adventure" ? "actors" : "physics");
  scene.addEventListener("change", () => {
    policySignature = "";
    profileIds = "";
    shownIds = "";
    draw();
  });
  const canvas = get<HTMLCanvasElement>("physics-canvas"),
    ctx = canvas.getContext("2d")!;
  const selector = get<HTMLSelectElement>("physics-body"),
    status = get<HTMLElement>("physics-status");
  let shownIds = "",
    lastSweep = "",
    error = "";
  const scope = get<HTMLSelectElement>("physics-scope"),
    scopeId = get<HTMLSelectElement>("physics-scope-id");
  let policySignature = "",
    profileIds = "";
  const preferencesKey = "fern:physics-overlays:v1";
  try {
    const saved = JSON.parse(localStorage.getItem(preferencesKey) ?? "null");
    for (const key of ["overlay", "regions-overlay"])
      if (typeof saved?.[key] === "boolean")
        get<HTMLInputElement>(`physics-${key}`).checked = saved[key];
  } catch {
    /* Local preferences never affect authoritative state. */
  }
  for (const key of ["overlay", "regions-overlay"])
    get<HTMLInputElement>(`physics-${key}`).addEventListener("change", () => {
      try {
        localStorage.setItem(
          preferencesKey,
          JSON.stringify({
            overlay: get<HTMLInputElement>("physics-overlay").checked,
            "regions-overlay": get<HTMLInputElement>("physics-regions-overlay").checked,
          }),
        );
      } catch {
        /* Storage can be unavailable. */
      }
    });
  const selectedScope = () => ({ scope: scope.value as PolicyScope, id: scopeId.value });
  const queue = (edits: PolicyEdit[]) =>
    options.execute({
      op: operation(),
      action: "configure",
      expectedRevision: selectedWorld()!.inspect().policies.nextRevision,
      edits,
    });
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
    options.execute({ op: operation(), action: "reset" });
    lastSweep = "";
    policySignature = "";
  });
  act("physics-close", () => {
    options.execute({ op: operation(), action: "close" });
    lastSweep = "";
  });
  const impulse = (spin: boolean) => {
    const pose = selectedWorld()
      ?.poses()
      .find((body) => body.id === selector.value);
    if (!pose) throw new Error("Select a dynamic body first");
    const x = Number(get<HTMLInputElement>("physics-strength").value);
    if (!Number.isFinite(x) || x < 1 || x > 1000)
      throw new Error("Impulse must be between 1 and 1000");
    options.execute({
      op: operation(),
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
    const result = options.execute({ op: operation(), action: "sweep" }) as {
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
  act("physics-queue", () => {
    const values: PolicyValues = {};
    for (const key of [
      "worldReactions",
      "dynamicProps",
      "propBlocking",
      "crowdContacts",
      "ambientPhysics",
      "sweptCollision",
      "destruction",
      "impactDamage",
      "projectileWorld",
      "physicalLoot",
      "mechanisms",
      "jointBreakage",
      "materialReactions",
      "chainReactions",
      "environmentalForces",
      "ragdolls",
      "foliage",
    ] as const) {
      const value = get<HTMLSelectElement>(`physics-${key}`).value;
      if (value !== "inherit") values[key] = value === "true";
    }
    for (const key of [
      "impulseStrength",
      "materialDurability",
      "debrisLifetime",
      "impactStrength",
      "jointStrength",
      "fieldStrength",
      "reactionStrength",
    ] as const) {
      const value = get<HTMLInputElement>(`physics-${key}`).value;
      if (value !== "") values[key] = Number(value);
    }
    queue([
      { type: "reset", ...selectedScope(), to: "inherited" },
      { type: "override", ...selectedScope(), values },
    ]);
  });
  act("physics-reset-scope", () => queue([{ type: "reset", ...selectedScope(), to: "inherited" }]));
  act("physics-reset-authored", () =>
    queue([{ type: "reset", ...selectedScope(), to: "authored" }]),
  );
  act("physics-queue-preset", () =>
    queue([
      {
        type: "preset",
        ...selectedScope(),
        preset: get<HTMLSelectElement>("physics-preset").value as PresetName,
      },
    ]),
  );
  act("physics-master", () =>
    queue([
      {
        type: "master",
        enabled: !selectedWorld()!.inspect().policies.preview.masterWorldReactions,
      },
    ]),
  );
  act("physics-apply", () =>
    options.execute({
      op: operation(),
      action: "apply",
      expectedRevision: selectedWorld()!.inspect().policies.nextRevision,
    }),
  );
  act("physics-region-queue", () =>
    queue([
      {
        type: "region",
        profile: JSON.parse(
          get<HTMLTextAreaElement>("physics-region-recipe").value,
        ) as RegionProfile,
      },
    ]),
  );
  act("physics-place", () =>
    options.execute({
      op: operation(),
      action: "place",
      id: selector.value,
      x: Number(get<HTMLInputElement>("physics-place-x").value),
      y: Number(get<HTMLInputElement>("physics-place-y").value),
    }),
  );
  act("physics-traveler", () =>
    options.execute({
      op: operation(),
      action: "spawn",
      body: {
        id: "traveler",
        motion: "dynamic",
        role: "actor",
        shape: { kind: "circle", radius: 10 },
        x: -210,
        y: 45,
        mass: 8,
        damping: 0,
        restitution: 0,
      },
    }),
  );
  for (const [id, x] of [
    ["left", -100],
    ["right", 100],
    ["stop", 0],
  ] as const)
    act(`physics-drive-${id}`, () =>
      options.execute({ op: operation(), action: "drive", id: "traveler", x, y: 0 }),
    );
  scope.addEventListener("change", () => {
    profileIds = "";
    policySignature = "";
    draw();
  });
  scopeId.addEventListener("change", () => {
    policySignature = "";
    draw();
  });

  function policyControls(world: PhysicsWorld | null) {
    const policy = world?.inspect().policies;
    get<HTMLButtonElement>("physics-apply").disabled =
      !options.solo() || !world || !options.paused() || !policy?.pending.length;
    if (!policy) return;
    const profileList =
      policy.preview.profiles[
        scope.value === "land" ? "lands" : scope.value === "area" ? "areas" : "regions"
      ];
    const ids = profileList.map((p) => p.id).join("|");
    if (ids !== profileIds) {
      const old = scopeId.value;
      scopeId.replaceChildren(...profileList.map((p) => new Option(p.id, p.id)));
      if (profileList.some((p) => p.id === old)) scopeId.value = old;
      profileIds = ids;
    }
    const signature = `${scope.value}:${scopeId.value}:${policy.nextRevision}`;
    if (signature !== policySignature) {
      const override = policy.preview.overrides.find(
        (p) => p.scope === scope.value && p.id === scopeId.value,
      )?.values;
      for (const key of [
        "worldReactions",
        "dynamicProps",
        "propBlocking",
        "crowdContacts",
        "ambientPhysics",
        "sweptCollision",
        "destruction",
        "impactDamage",
        "projectileWorld",
        "physicalLoot",
        "mechanisms",
        "jointBreakage",
        "materialReactions",
        "chainReactions",
        "environmentalForces",
        "ragdolls",
        "foliage",
      ] as const)
        get<HTMLSelectElement>(`physics-${key}`).value =
          override?.[key] === undefined ? "inherit" : String(override[key]);
      for (const key of [
        "impulseStrength",
        "materialDurability",
        "debrisLifetime",
        "impactStrength",
        "jointStrength",
        "fieldStrength",
        "reactionStrength",
      ] as const)
        get<HTMLInputElement>(`physics-${key}`).value =
          override?.[key] === undefined ? "" : String(override[key]);
      const profile = profileList.find((p) => p.id === scopeId.value);
      get("physics-scope-inspector").textContent =
        `Authored/current profile values: ${JSON.stringify(profile?.values ?? {})}. Live override: ${JSON.stringify(override ?? {})}. Inherited fields follow the profiles and broader overrides.`;
      const region =
        policy.preview.profiles.regions.find((r) => r.id === scopeId.value) ??
        policy.preview.profiles.regions[0];
      if (region)
        get<HTMLTextAreaElement>("physics-region-recipe").value = JSON.stringify(region, null, 2);
      policySignature = signature;
    }
    const preset = get<HTMLSelectElement>("physics-preset").value as PresetName;
    get("physics-preset-preview").textContent =
      `Preset preview: ${JSON.stringify(POLICY_PRESETS[preset])}. Applies the implemented physics controls at this scope. Editing individual values creates a custom override.`;
    get("physics-policy-status").textContent =
      `Applied revision ${policy.state.revision} · ${policy.pending.length} queued transactions · next revision ${policy.nextRevision} · master ${policy.state.masterWorldReactions ? "on" : "OFF"}${policy.pending.length ? " · Preview changes await a boundary/apply." : ""}`;
    get<HTMLButtonElement>("physics-master").textContent = policy.preview.masterWorldReactions
      ? "Queue master off"
      : "Queue master on";
  }

  function draw() {
    const world = selectedWorld(),
      solo = options.solo() || (scene.value === "adventure" && options.host()),
      poses = world?.poses() ?? [];
    for (const button of panel.querySelectorAll<HTMLButtonElement>("button"))
      button.disabled = !solo || (button.id !== "physics-open" && !world);
    selector.disabled = !solo || !world;
    for (const control of panel.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >("input,select,textarea")) {
      if (["physics-overlay", "physics-regions-overlay", "physics-scene"].includes(control.id))
        continue;
      control.disabled = !solo || !world;
    }
    policyControls(world);
    const ids = poses.map((body) => body.id).join("|");
    if (ids !== shownIds) {
      const previous = selector.value;
      selector.replaceChildren(...poses.map((body) => new Option(body.id, body.id)));
      if (poses.some((body) => body.id === previous)) selector.value = previous;
      else
        selector.value = poses.find((body) => body.motion === "dynamic")?.id ?? poses[0]?.id ?? "";
      shownIds = ids;
    }
    for (const id of [
      "physics-open",
      "physics-close",
      "physics-sweep",
      "physics-traveler",
      "physics-drive-left",
      "physics-drive-right",
      "physics-drive-stop",
    ])
      if (scene.value === "adventure") get<HTMLButtonElement>(id).disabled = true;
    const selected = poses.find((body) => body.id === selector.value);
    for (const id of ["physics-push", "physics-spin"])
      get<HTMLButtonElement>(id).disabled = !solo || !selected || selected.motion !== "dynamic";
    get("physics-body-inspector").textContent = selected
      ? `${selected.id} · (${selected.x.toFixed(1)}, ${selected.y.toFixed(1)}) · ${selected.reactivationBlocked ? "Overlap unresolved: place this body in free space." : selected.frozen ? "FROZEN, motion discarded" : "active"} · regions: ${selected.policy.regions.join(", ") || "none"} · Effective: ${JSON.stringify(selected.policy.effective)} · Sources: ${JSON.stringify(selected.policy.provenance)} · Consequences: ${JSON.stringify(selected.consequences ?? {})}`
      : "Select a body to inspect its effective policy and provenance.";
    get<HTMLButtonElement>("physics-traveler").disabled =
      !solo ||
      !world ||
      scene.value === "adventure" ||
      poses.some((body) => body.id === "traveler");
    for (const id of ["left", "right", "stop"])
      get<HTMLButtonElement>(`physics-drive-${id}`).disabled =
        !solo || scene.value === "adventure" || !poses.some((body) => body.id === "traveler");
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
    if (scene.value === "adventure") {
      const selected = poses.find((p) => p.id === selector.value);
      if (selected) ctx.translate(-selected.x, -selected.y);
    }
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
    if (world && get<HTMLInputElement>("physics-regions-overlay").checked) {
      for (const region of world.inspect().policies.state.profiles.regions) {
        const shape = region.shape;
        ctx.fillStyle = "#507e7933";
        ctx.strokeStyle = "#8fbdb1";
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (shape.kind === "circle") ctx.arc(shape.x, shape.y, shape.radius, 0, Math.PI * 2);
        else if (shape.kind === "rectangle") ctx.rect(shape.x, shape.y, shape.width, shape.height);
        else {
          ctx.moveTo(shape.points[0].x, shape.points[0].y);
          for (const p of shape.points.slice(1)) ctx.lineTo(p.x, p.y);
          ctx.closePath();
        }
        ctx.fill();
        ctx.stroke();
        const p = shape.kind === "polygon" ? shape.points[0] : shape;
        ctx.fillStyle = "#b2d5c8";
        ctx.font = "8px monospace";
        ctx.fillText(region.id, p.x + 3, p.y - 4);
      }
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
        body.motion === "fixed"
          ? "#56665b"
          : body.role === "actor"
            ? "#9db8ee"
            : body.frozen
              ? "#88aaa4"
              : body.id === "sweep"
                ? "#9cdded"
                : "#c79954";
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
