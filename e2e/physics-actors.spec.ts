import { expect, test } from "@playwright/test";
import { AgentRuntime, type Replay } from "../src/engine/agent.ts";
import { type SaveState, Simulation } from "../src/engine/simulation.ts";
import { initializePhysics } from "../src/physics/bootstrap.ts";
import type { BodyPose } from "../src/physics/types.ts";

test.beforeAll(() => initializePhysics());
test("playable adventure physics controls match agent edits, retain policies and ownership across saved reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => !!window.fern);
  await page.evaluate(() => {
    window.fern.pause(true);
    window.fern.command({ op: "reset", seed: 142, count: 32 });
    window.fern.command({ op: "encounter", index: 1 });
    window.fern.command({ op: "step", ticks: 1 });
    window.fern.view("lab");
  });
  await page.getByLabel("Physics scene", { exact: true }).selectOption("adventure");
  await page.getByLabel("Physics policy scope", { exact: true }).selectOption("land");
  const initial = await page.evaluate(() => window.fern.command({ op: "save" }) as SaveState),
    expected = new AgentRuntime(Simulation.restore(initial));
  try {
    await page.getByLabel("Ambient physics override", { exact: true }).selectOption("true");
    await page.getByLabel("Crowd contacts override", { exact: true }).selectOption("false");
    await page.getByLabel("Swept collision override", { exact: true }).selectOption("false");
    await page.locator("#physics-queue").click();
    expected.execute({
      op: "actors",
      action: "configure",
      expectedRevision: 0,
      edits: [
        { type: "reset", scope: "land", id: initial.actorPhysics!.landId, to: "inherited" },
        {
          type: "override",
          scope: "land",
          id: initial.actorPhysics!.landId,
          values: { crowdContacts: false, ambientPhysics: true, sweptCollision: false },
        },
      ],
    });
    expect(await page.evaluate(() => window.fern.observe().hash)).toBe(expected.sim.stateHash());
    await page.locator("#physics-apply").click();
    expected.execute({ op: "actors", action: "apply", expectedRevision: 1 });
    expect(await page.evaluate(() => window.fern.observe().hash)).toBe(expected.sim.stateHash());
    const physical = await page.evaluate(
      () =>
        window.fern.command({ op: "actors" }) as {
          movementOwners: { rapierAmbient: number; ambient: number };
        },
    );
    expect(physical.movementOwners.rapierAmbient).toBe(32);
    expect(physical.movementOwners.ambient).toBe(0);
    await page.getByLabel("Physics body", { exact: true }).selectOption("crate-1-0");
    await expect(page.locator("#physics-body-inspector")).toContainText("land:land-1-0/override");
    await page.locator("#physics-master").click();
    await page.locator("#physics-apply").click();
    await expect(page.locator("#physics-body-inspector")).toContainText("FROZEN");
    const off = await page.evaluate(
      () => window.fern.command({ op: "actors", action: "body", id: "crate-1-0" }) as BodyPose,
    );
    await page.locator("#physics-push").click();
    await page.locator("#physics-one-tick").click();
    expect(
      (
        await page.evaluate(
          () => window.fern.command({ op: "actors", action: "body", id: "crate-1-0" }) as BodyPose,
        )
      ).x,
    ).toBe(off.x);
    await page.getByRole("button", { name: "Save trail", exact: true }).click();
    await expect(page.locator("#toast")).toHaveText("Trail saved on this device.");
    const saved = await page.evaluate(() => window.fern.observe().hash),
      recording = (await page.evaluate(() => window.fern.recording())) as Replay;
    const replayedHash = await page.evaluate((recording) => {
      window.fern.command({ op: "restore", state: recording.initial });
      window.fern.batch(recording.commands);
      return window.fern.observe().hash;
    }, recording);
    expect(replayedHash).toBe(recording.hash);
    await page.reload();
    await page.waitForFunction(() => !!window.fern);
    await page.evaluate(() => window.fern.pause(true));
    await page.getByRole("button", { name: "Continue your saved trail" }).click();
    await page.mouse.move(640, 450);
    await page.evaluate(async () => {
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    });
    expect(await page.evaluate(() => window.fern.observe().hash)).toBe(saved);
    await page.evaluate(() => window.fern.view("lab"));
    await page.getByLabel("Physics scene", { exact: true }).selectOption("adventure");
    await page.getByRole("button", { name: "Queue master on", exact: true }).click();
    await page.locator("#physics-apply").click();
    expect(
      (
        await page.evaluate(
          () => window.fern.command({ op: "actors", action: "body", id: "crate-1-0" }) as BodyPose,
        )
      ).vx,
    ).toBe(0);
    await page.locator("#physics-push").click();
    await page.getByRole("button", { name: "Step 60 ticks", exact: true }).click();
    expect(
      (
        await page.evaluate(
          () => window.fern.command({ op: "actors", action: "body", id: "crate-1-0" }) as BodyPose,
        )
      ).x,
    ).toBeGreaterThan(off.x + 10);
    await page.locator(".physics-panel").screenshot({ path: "artifacts/physics-m03-controls.png" });
    expect(errors).toEqual([]);
  } finally {
    expected.sim.dispose();
  }
});

test("normal encounter renders solved prop pushes, held attacks and dash; patched obstacles release cleanly", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => !!window.fern);
  await page.evaluate(() => {
    window.fern.pause(true);
    window.fern.command({ op: "reset", seed: 142, count: 0 });
    window.fern.command({ op: "encounter", index: 1 });
    window.fern.command({ op: "step", ticks: 1 });
    window.fern.start();
    const r = window.fern.observe().adventure.recipe;
    window.fern.command({ op: "teleport", x: r.x - 100, y: r.y + 40 });
  });
  const start = await page.evaluate(
    () => window.fern.command({ op: "actors", action: "body", id: "crate-1-0" }) as BodyPose,
  );
  await page.evaluate(() => {
    window.fern.command({ op: "input", x: 1, attack: true, pulse: true });
    window.fern.command({ op: "step", ticks: 30 });
  });
  const moved = await page.evaluate(
    () => window.fern.command({ op: "actors", action: "body", id: "crate-1-0" }) as BodyPose,
  );
  expect(moved.x).toBeGreaterThan(start.x + 10);
  const player = await page.evaluate(
    () => window.fern.command({ op: "actors", action: "body", id: "player-local" }) as BodyPose,
  );
  expect(player.angle).toBe(0);
  expect(player.angularVelocity).toBe(0);
  expect(
    (await page.evaluate(() => window.fern.game.observe())).events.some((e) => e.type === "slash"),
  ).toBe(true);
  expect(
    (await page.evaluate(() => window.fern.game.observe())).events.some((e) => e.type === "whorl"),
  ).toBe(true);
  await page.evaluate(() => {
    const p = window.fern.observe().players[0];
    window.fern.command({
      op: "paint",
      tx: Math.floor(p.x / 16) + 3,
      ty: Math.floor(p.y / 16) - 4,
      width: 1,
      height: 9,
      terrain: 4,
    });
    window.fern.command({ op: "input", x: 1, dash: true });
    window.fern.command({ op: "step", ticks: 9 });
  });
  const before = await page.evaluate(() => window.fern.observe().players[0]);
  await page.evaluate(() => {
    const state = window.fern.command({ op: "save" }) as SaveState;
    const patch = state.patches[0];
    window.fern.command({
      op: "paint",
      tx: patch[0],
      ty: patch[1],
      width: 1,
      height: 9,
      terrain: 5,
    });
    window.fern.command({ op: "input", x: 1 });
    window.fern.command({ op: "step", ticks: 45 });
  });
  expect((await page.evaluate(() => window.fern.observe().players[0])).x).toBeGreaterThan(
    before.x + 15,
  );
  await page.locator("#world-canvas").screenshot({ path: "artifacts/physics-m03-encounter.png" });
  expect(errors).toEqual([]);
});
