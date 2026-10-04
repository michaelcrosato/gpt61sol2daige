import { expect, test } from "@playwright/test";

test("quality settings change real draw budgets, increase population, and persist across reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => !!window.fern);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Draw distance value" }).fill("16384");
  await page.getByRole("spinbutton", { name: "Visible creatures value" }).fill("500");
  await page.getByRole("spinbutton", { name: "World population value" }).fill("16384");
  await page.getByRole("button", { name: "Apply settings", exact: true }).click();
  await page.evaluate(() => {
    window.fern.start();
    window.fern.zoom(0.12);
  });
  await expect
    .poll(async () => (await page.evaluate(() => window.fern.observe())).render.drawn)
    .toBe(500);
  expect((await page.evaluate(() => window.fern.observe())).population).toBe(16384);
  expect((await page.evaluate(() => window.fern.observe())).render.limited).toBeGreaterThan(10000);
  await page.reload();
  await page.waitForFunction(() => !!window.fern);
  expect(await page.evaluate(() => window.fern.settings.get())).toMatchObject({
    drawDistance: 16384,
    entityLimit: 500,
    population: 16384,
  });
  await page.evaluate(() => {
    window.fern.start();
    window.fern.zoom(0.12);
    window.fern.settings.set({ drawDistance: 256, entityLimit: 65536 });
  });
  await expect
    .poll(async () => (await page.evaluate(() => window.fern.observe())).render.drawn)
    .toBeLessThan(600);
  await page.evaluate(() => window.fern.settings.set({ drawDistance: 16384 }));
  await expect
    .poll(async () => (await page.evaluate(() => window.fern.observe())).render.drawn)
    .toBe(16384);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.screenshot({ path: "artifacts/quality-settings.png" });
  await page.getByRole("button", { name: "Restore defaults", exact: true }).click();
  await page.getByRole("button", { name: "Apply settings", exact: true }).click();
  expect(await page.evaluate(() => window.fern.settings.get())).toMatchObject({
    drawDistance: 4096,
    entityLimit: 8192,
    population: 2400,
  });
  expect(errors).toEqual([]);
});

test("native fullscreen fills the screen, retains controls and dialogs, and restores the workspace", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => !!window.fern);
  await page.getByRole("button", { name: "Enter fullscreen game mode", exact: true }).click();
  await expect.poll(async () => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await expect(page.getByRole("navigation", { name: "Workspace" })).toBeHidden();
  await expect(page.locator(".engine-strip")).toBeHidden();
  await expect(page.locator("#sidebar")).toBeHidden();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const r = document.getElementById("world-canvas")!.getBoundingClientRect();
        return [r.x, r.y, r.width === innerWidth, r.height === innerHeight];
      }),
    )
    .toEqual([0, 0, true, true]);
  await page.getByRole("button", { name: "Whorl", exact: true }).click();
  await expect
    .poll(async () =>
      (await page.evaluate(() => window.fern.observe())).events.some((e) => e.type === "pulse"),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Game journal", exact: true }).click();
  await expect(page.locator("#sidebar")).toBeVisible();
  await page.getByRole("button", { name: "Game journal", exact: true }).click();
  await page.getByRole("button", { name: "Game atlas", exact: true }).click();
  await expect(page.getByRole("heading", { name: "The world is wider." })).toBeVisible();
  await page.getByRole("button", { name: "Back to the trail", exact: false }).click();
  await page.getByRole("button", { name: "Game settings", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Your kind of wild." })).toBeVisible();
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.getByRole("checkbox", { name: "Show live performance in game mode" }).uncheck();
  await page.getByRole("button", { name: "Apply settings", exact: true }).click();
  await expect(page.locator("#game-performance")).toBeHidden();
  await page.screenshot({ path: "artifacts/game-mode.png" });
  await page.getByRole("button", { name: "Exit fullscreen game mode", exact: true }).click();
  await expect
    .poll(async () => page.evaluate(() => window.fern.display.get()))
    .toEqual({ gameMode: false, fullscreen: false });
  await expect(page.getByRole("navigation", { name: "Workspace" })).toBeVisible();
  await page.keyboard.press("g");
  await expect
    .poll(async () => page.evaluate(() => window.fern.display.get().fullscreen))
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => page.evaluate(() => window.fern.display.get().gameMode))
    .toBe(false);
  // Browser-initiated exits also restore the interface (e.g. its native fullscreen control).
  await page.getByRole("button", { name: "Enter fullscreen game mode", exact: true }).click();
  await page.evaluate(() => document.exitFullscreen());
  await expect
    .poll(async () => page.evaluate(() => window.fern.display.get().gameMode))
    .toBe(false);
  expect(errors).toEqual([]);
});

test("full-size distant worlds save through the game menu and survive reload", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => !!window.fern);
  await page.evaluate(() => {
    window.fern.pause(true);
    window.fern.settings.set({ population: 65536, entityLimit: 65536 });
    window.fern.command({ op: "step", ticks: 60 });
    const state = window.fern.command({
      op: "save",
    }) as import("../src/engine/simulation.ts").SaveState;
    state.npcs.x = state.npcs.x.map((x) => x + 8_000_000);
    state.npcs.y = state.npcs.y.map((y) => y + 8_000_000);
    state.players[0].x = state.players[0].px = 8_000_000;
    state.players[0].y = state.players[0].py = 8_000_000;
    window.fern.command({ op: "restore", state });
    window.fern.command({ op: "paint", tx: 500000, ty: 500000, width: 32, height: 64, terrain: 6 });
  });
  const hash = await page.evaluate(() => window.fern.observe().hash);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Save game", exact: true }).click();
  await expect(page.locator("#toast")).toHaveText("Trail saved on this device.");
  await page.reload();
  await page.waitForFunction(() => !!window.fern);
  await page.evaluate(() => window.fern.pause(true));
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Load game", exact: true }).click();
  await expect.poll(async () => page.evaluate(() => window.fern.observe().hash)).toBe(hash);
  expect((await page.evaluate(() => window.fern.observe())).population).toBe(65536);
});

test("existing localStorage trails remain available after the storage upgrade", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => !!window.fern);
  await page.evaluate(() => {
    window.fern.pause(true);
    const state = window.fern.command({
      op: "save",
    }) as import("../src/engine/simulation.ts").SaveState;
    state.shards = 19;
    localStorage.setItem("fern:save:v1", JSON.stringify(state));
  });
  await page.reload();
  await page.waitForFunction(() => !!window.fern);
  await page.getByRole("button", { name: "Continue your saved trail", exact: false }).click();
  await expect
    .poll(async () => (await page.evaluate(() => window.fern.observe())).quest.shards)
    .toBe(19);
});

test("a denied fullscreen request leaves usable game mode; touch and rotated layouts remain reachable", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.addInitScript(() => {
      Element.prototype.requestFullscreen = () => Promise.reject(new Error("Denied for test"));
    });
    await page.goto(baseURL!);
    await page.waitForFunction(() => !!window.fern);
    await page.getByRole("button", { name: "Enter fullscreen game mode", exact: true }).click();
    await expect
      .poll(async () => page.evaluate(() => window.fern.display.get()))
      .toEqual({ gameMode: true, fullscreen: false });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.screenshot({ path: "artifacts/game-mode-mobile.png" });
    await page.getByRole("button", { name: "Game settings", exact: true }).click();
    await expect(page.getByRole("button", { name: "Apply settings", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Close settings", exact: true }).click();
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.getByRole("button", { name: "Move east", exact: true })).toBeVisible();
    const before = await page.evaluate(() => window.fern.observe().players[0].x);
    const move = await page.getByRole("button", { name: "Move east", exact: true }).boundingBox();
    await page.mouse.move(move!.x + move!.width / 2, move!.y + move!.height / 2);
    await page.mouse.down();
    await expect
      .poll(async () => page.evaluate(() => window.fern.observe().players[0].x))
      .toBeGreaterThan(before + 8);
    await page.mouse.up();
    await page.screenshot({ path: "artifacts/game-mode-landscape.png" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      844,
    );
    await page.getByRole("button", { name: "Exit fullscreen game mode", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Workspace" })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
