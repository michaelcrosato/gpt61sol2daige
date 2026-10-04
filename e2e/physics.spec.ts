import { expect, test } from "@playwright/test";
import { AgentRuntime, type Replay, replay } from "../src/engine/agent.ts";
import { type SaveState, Simulation } from "../src/engine/simulation.ts";
import { initializePhysics } from "../src/physics/bootstrap.ts";

test.beforeAll(() => initializePhysics());

test("policy UI matches agent transactions, master-off wins, paused region edits and device overlays survive reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.waitForFunction(() => !!window.fern);
  await page.evaluate(() => {
    window.fern.pause(true);
    window.fern.view("lab");
  });
  await page.locator("#physics-open").click();
  const initial = await page.evaluate(() => window.fern.command({ op: "save" }) as SaveState);
  const expected = new AgentRuntime(Simulation.restore(initial));
  try {
    await page.getByLabel("Dynamic props override", { exact: true }).selectOption("false");
    await page.getByRole("button", { name: "Queue policy edit", exact: true }).click();
    expected.execute({
      op: "physics",
      action: "configure",
      expectedRevision: 0,
      edits: [
        { type: "reset", scope: "area", id: "playground", to: "inherited" },
        { type: "override", scope: "area", id: "playground", values: { dynamicProps: false } },
      ],
    });
    expect(
      await page.evaluate(
        () => window.fern.observe().playground!.bodies.find((b) => b.id === "wheel")!.frozen,
      ),
    ).toBe(false);
    expect(await page.evaluate(() => window.fern.observe().hash)).toBe(expected.sim.stateHash());
    await page.getByRole("button", { name: "Apply queued policies", exact: true }).click();
    expected.execute({ op: "physics", action: "apply", expectedRevision: 1 });
    expect(await page.evaluate(() => window.fern.observe().hash)).toBe(expected.sim.stateHash());
    expect(await page.evaluate(() => window.fern.observe().playground!.tick)).toBe(0);
    await page.getByRole("button", { name: "Queue master off", exact: true }).click();
    await page.locator("#physics-apply").click();
    await page.getByLabel("Physics policy scope", { exact: true }).selectOption("region");
    await page.getByLabel("World reactions override", { exact: true }).selectOption("true");
    await page.getByLabel("Dynamic props override", { exact: true }).selectOption("true");
    await page.locator("#physics-queue").click();
    await page.locator("#physics-apply").click();
    await page.getByLabel("Physics body", { exact: true }).selectOption("crate-0");
    await page.getByLabel("Physics body placement X", { exact: true }).fill("-210");
    await page.getByLabel("Physics body placement Y", { exact: true }).fill("-70");
    await page.locator("#physics-place").click();
    expect(
      await page.evaluate(
        () => window.fern.observe().playground!.bodies.find((b) => b.id === "crate-0")!.frozen,
      ),
    ).toBe(true);
    await expect(page.locator("#physics-body-inspector")).toContainText("session-master-off");
    await page.getByRole("button", { name: "Queue master on", exact: true }).click();
    await page.locator("#physics-apply").click();
    expect(
      await page.evaluate(
        () => window.fern.observe().playground!.bodies.find((b) => b.id === "crate-0")!.frozen,
      ),
    ).toBe(false);
    await expect(page.locator("#physics-body-inspector")).toContainText(
      "region:quiet-garden/override",
    );
    const region = {
      id: "quiet-garden",
      areaId: "playground",
      priority: 10,
      shape: {
        kind: "polygon",
        points: [
          { x: -240, y: -100 },
          { x: -180, y: -100 },
          { x: -180, y: -30 },
          { x: -240, y: -30 },
        ],
      },
      values: { worldReactions: false },
    };
    await page.getByText("Author region bounds and profile", { exact: true }).click();
    await page.getByLabel("Physics region recipe", { exact: true }).fill(JSON.stringify(region));
    await page.getByRole("button", { name: "Queue region recipe", exact: true }).click();
    await page.locator("#physics-apply").click();
    await page.getByRole("button", { name: "Reset this scope", exact: true }).click();
    await page.locator("#physics-apply").click();
    expect(
      await page.evaluate(
        () => window.fern.observe().playground!.bodies.find((b) => b.id === "crate-0")!.frozen,
      ),
    ).toBe(true);
    expect(await page.evaluate(() => window.fern.observe().playground!.tick)).toBe(0);
    const beforeOverlay = await page.evaluate(() => window.fern.observe().hash);
    await page.getByLabel("Collider overlay", { exact: true }).uncheck();
    await page.getByLabel("Region overlay", { exact: true }).uncheck();
    expect(await page.evaluate(() => window.fern.observe().hash)).toBe(beforeOverlay);
    await page.getByRole("button", { name: "Save trail", exact: true }).click();
    await expect(page.locator("#toast")).toHaveText("Trail saved on this device.");
    const saved = await page.evaluate(() => window.fern.observe().playground);
    const recording = (await page.evaluate(() => window.fern.recording())) as Replay;
    const played = replay(recording);
    expect(played.stateHash()).toBe(recording.hash);
    played.dispose();
    await page.reload();
    await page.waitForFunction(() => !!window.fern);
    await page.evaluate(() => window.fern.pause(true));
    await page.getByRole("button", { name: "Continue your saved trail" }).click();
    await expect.poll(() => page.evaluate(() => window.fern.observe().playground)).toEqual(saved);
    await page.evaluate(() => window.fern.view("lab"));
    await expect(page.getByLabel("Collider overlay", { exact: true })).not.toBeChecked();
    await expect(page.getByLabel("Region overlay", { exact: true })).not.toBeChecked();
    await page.getByLabel("Region overlay", { exact: true }).check();
    await page.locator("#physics-canvas").screenshot({ path: "artifacts/physics-m02-regions.png" });
    await expect(page.locator("#physics-policy-status")).toContainText("0 queued transactions");
    expect(errors).toEqual([]);
  } finally {
    expected.sim.dispose();
  }
});

test("lab traveler has real prop blocking and a running policy edit commits on the next tick", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => !!window.fern);
  await page.evaluate(() => {
    window.fern.pause(true);
    window.fern.view("lab");
  });
  await page.locator("#physics-open").click();
  await page.getByLabel("Dynamic props override", { exact: true }).selectOption("false");
  await page.locator("#physics-queue").click();
  await page.locator("#physics-apply").click();
  await page.getByRole("button", { name: "Spawn contact traveler", exact: true }).click();
  await page.getByRole("button", { name: "Traveler right", exact: true }).click();
  await page.getByRole("button", { name: "Step 60 ticks", exact: true }).click();
  const blocked = await page.evaluate(
    () => window.fern.observe().playground!.bodies.find((b) => b.id === "traveler")!.x,
  );
  expect(blocked).toBeLessThan(-163);
  await page.getByLabel("Prop blocking override", { exact: true }).selectOption("false");
  await page.locator("#physics-queue").click();
  await page.locator("#physics-apply").click();
  await page.getByRole("button", { name: "Step 60 ticks", exact: true }).click();
  expect(
    await page.evaluate(
      () => window.fern.observe().playground!.bodies.find((b) => b.id === "traveler")!.x,
    ),
  ).toBeGreaterThan(blocked + 90);
  await page.getByRole("button", { name: "Stop traveler", exact: true }).click();
  await page.getByLabel("Physics policy preset", { exact: true }).selectOption("Wild");
  await expect(page.locator("#physics-preset-preview")).toContainText("2.5");
  await page.getByRole("button", { name: "Run playground", exact: true }).click();
  await page.getByRole("button", { name: "Queue preset", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.fern.observe().playground!.policies.state.revision))
    .toBe(3);
  expect(
    await page.evaluate(
      () =>
        window.fern.observe().playground!.bodies.find((b) => b.id === "wheel")!.policy.effective
          .impulseStrength,
    ),
  ).toBe(2.5);
  await expect(page.locator("#physics-apply")).toBeDisabled();
  const refusal = await page.evaluate(() => {
    try {
      window.fern.command({ op: "physics", action: "apply", expectedRevision: 3 });
      return "unexpected";
    } catch (error) {
      return String(error);
    }
  });
  expect(refusal).toContain("Pause the playground");
  await page.locator("#physics-pause").click();
});

test("lab controls push/spin real bodies, sweep the wall, save/reload and reset cleanly", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.waitForFunction(() => !!window.fern);
  await page.evaluate(() => {
    window.fern.pause(true);
    window.fern.view("lab");
  });
  await page.getByRole("button", { name: "Open / reset playground", exact: true }).click();
  await expect(page.locator("#physics-status")).toContainText("10 bodies");
  await page.getByLabel("Physics body", { exact: true }).selectOption("wheel");
  const initial = await page.evaluate(
    () => window.fern.observe().playground!.bodies.find((body) => body.id === "wheel")!,
  );
  await page.getByRole("button", { name: "Push off center", exact: true }).click();
  await page.getByRole("button", { name: "Step 60 ticks", exact: true }).click();
  const wheel = await page.evaluate(
    () => window.fern.observe().playground!.bodies.find((body) => body.id === "wheel")!,
  );
  expect(wheel.x).toBeGreaterThan(initial.x + 50);
  expect(Math.abs(wheel.angle)).toBeGreaterThan(0.1);
  await page.getByRole("button", { name: "Launch swept body", exact: true }).click();
  await expect(page.locator("#physics-status")).toContainText("Sweep predicts wall");
  await page.getByRole("button", { name: "Step 60 ticks", exact: true }).click();
  const physical = await page.evaluate(() => window.fern.observe().playground!);
  expect(
    physical.events.some((event) => event.started && [event.a, event.b].includes("wall")),
  ).toBe(true);
  expect(physical.bodies.find((body) => body.id === "sweep")!.x).toBeLessThan(119);
  await page.locator("#physics-canvas").screenshot({ path: "artifacts/physics-playground.png" });
  const recording = (await page.evaluate(() => window.fern.recording())) as Replay;
  const played = replay(recording);
  expect(played.stateHash()).toBe(recording.hash);
  played.dispose();
  await page.getByRole("button", { name: "Save trail", exact: true }).click();
  await expect(page.locator("#toast")).toHaveText("Trail saved on this device.");
  const saved = await page.evaluate(() => window.fern.observe().playground);
  await page.reload();
  await page.waitForFunction(() => !!window.fern);
  await page.evaluate(() => window.fern.pause(true));
  await page.getByRole("button", { name: "Continue your saved trail" }).click();
  await expect.poll(() => page.evaluate(() => window.fern.observe().playground)).toEqual(saved);
  await page.evaluate(() => window.fern.view("lab"));
  await page.getByRole("button", { name: "Step one tick", exact: true }).click();
  expect(await page.evaluate(() => window.fern.observe().playground!.tick)).toBe(saved!.tick + 1);
  for (let n = 0; n < 8; n++)
    await page.getByRole("button", { name: "Open / reset playground", exact: true }).click();
  expect(await page.evaluate(() => window.fern.observe().playground!.bodies.length)).toBe(10);
  const hostError = await page.evaluate(async () => {
    try {
      await window.fern.network.host();
      return "unexpected success";
    } catch (error) {
      return String(error);
    }
  });
  expect(hostError).toContain("Close the solo physics playground");
  expect(await page.evaluate(() => window.fern.network.status().role)).toBe("solo");
  await page.getByRole("button", { name: "Close playground", exact: true }).click();
  expect(await page.evaluate(() => window.fern.observe().playground)).toBeNull();
  expect(errors).toEqual([]);
});

test("failed Rapier module loading presents an error and reload recovers", async ({ page }) => {
  await page.route("**/*rapier*", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator("#physics-boot")).toHaveAttribute("role", "alert");
  await expect(page.locator("#physics-boot")).toContainText("Physics initialization failed");
  expect(await page.evaluate(() => !!window.fern)).toBe(false);
  await page.unroute("**/*rapier*");
  await page.reload();
  await page.waitForFunction(() => !!window.fern);
  await expect(page.locator("#physics-boot")).toHaveCount(0);
  await page.evaluate(() => {
    window.fern.pause(true);
    window.fern.command({ op: "physics", action: "reset" });
    window.fern.command({ op: "step", ticks: 1 });
  });
  expect(await page.evaluate(() => window.fern.observe().playground!.tick)).toBe(1);
});

test("page disposal cancels queued animation before releasing the physics world", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.waitForFunction(() => !!window.fern);
  const before = await page.evaluate(async () => {
    window.fern.command({ op: "physics", action: "reset" });
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
    const tick = window.fern.observe().tick;
    for (let n = 0; n < 5; n++) await new Promise(requestAnimationFrame);
    return { tick, after: window.fern.observe().tick, scene: window.fern.observe().playground };
  });
  expect(before.after).toBe(before.tick);
  expect(before.scene).toBeNull();
  expect(errors).toEqual([]);
});
