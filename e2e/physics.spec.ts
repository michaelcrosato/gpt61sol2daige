import { expect, test } from "@playwright/test";
import { type Replay, replay } from "../src/engine/agent.ts";
import { initializePhysics } from "../src/physics/bootstrap.ts";

test.beforeAll(() => initializePhysics());

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
