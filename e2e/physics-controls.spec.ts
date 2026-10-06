import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { instrumentRtc } from "./rtc-diagnostics.ts";

// M12 in-game physics controls through real keyboard, mouse and touch input: the World physics
// panel (O, the HUD button, the pause menu), its scopes, presets, region editing, inspector and
// resets. Captures are written to artifacts/physics-m12-*.png.

type Pose = { id: string; x: number; y: number; vx: number; vy: number; frozen: boolean };
type Region = { id: string; priority: number; shape: { kind: string; radius: number } };
const body = (page: Page, id: string) =>
  page.evaluate((id) => window.fern.command({ op: "actors", action: "body", id }) as Pose, id);
const region = (page: Page, id: string) =>
  page.evaluate(
    (id) =>
      (
        window.fern.command({ op: "actors", action: "policies" }) as {
          state: { profiles: { regions: Region[] } };
        }
      ).state.profiles.regions.find((r) => r.id === id) ?? null,
    id,
  );
const policyAt = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([x, y]) =>
      (
        window.fern.command({ op: "actors", action: "policy", x, y }) as {
          effective: Record<string, boolean | number>;
        }
      ).effective,
    [x, y] as const,
  );
/** Area 1 with no creatures, the traveler beside `id`; the welcome card dismissed by a click. */
async function beside(page: Page, id: string, dx: number, dy: number) {
  await page.goto("/");
  await page.waitForFunction(() => !!window.fern);
  const part = await page.evaluate(
    ([id, dx, dy]) => {
      window.fern.pause(true);
      window.fern.command({ op: "reset", seed: 142, count: 0 });
      window.fern.command({ op: "encounter", index: 1 });
      window.fern.command({ op: "step", ticks: 1 });
      const part = window.fern.command({ op: "actors", action: "body", id }) as Pose;
      window.fern.command({ op: "teleport", x: part.x + dx, y: part.y + dy });
      window.fern.command({ op: "step", ticks: 2 });
      window.fern.zoom(2);
      window.fern.pause(false);
      return part;
    },
    [id, dx, dy] as const,
  );
  await page.getByRole("button", { name: "Begin the hunt", exact: true }).click();
  await expect(page.locator("#welcome")).toBeHidden();
  return part;
}
async function screen(page: Page, x: number, y: number) {
  const box = (await page.locator("#world-canvas").boundingBox())!;
  const view = await page.evaluate(() => {
    const r = window.fern.observe().render;
    return { cx: r.cameraX, cy: r.cameraY, zoom: r.zoom };
  });
  return {
    x: box.x + box.width / 2 + (x - view.cx) * view.zoom,
    y: box.y + box.height / 2 + (y - view.cy) * view.zoom,
  };
}
async function slashAt(page: Page, x: number, y: number) {
  const aim = await screen(page, x, y);
  await page.mouse.move(aim.x, aim.y);
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();
}
/** True when eight animation frames pass without a simulation tick. */
const paused = (page: Page) =>
  page.evaluate(async () => {
    const tick = window.fern.observe().tick;
    for (let frame = 0; frame < 8; frame++) await new Promise(requestAnimationFrame);
    return window.fern.observe().tick === tick;
  });
const panel = (page: Page) => page.locator("#adventure-dialog.panel-physics");
const toggle = (page: Page, key: string, value: "default" | "true" | "false") =>
  page.locator(`[data-wp="set"][data-key="${key}"][data-value="${value}"]`);

test("desktop: O inspects the hovered crate; loose props and destruction off for the area leave it untouched by real slashes; Default and Clear restore it", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const crate = await beside(page, "crate-1-0", -26, 0);
  // Hover the crate and press O: the panel opens on it, the game paused.
  const at = await screen(page, crate.x, crate.y);
  await page.mouse.move(at.x, at.y);
  await page.keyboard.press("o");
  await expect(panel(page)).toBeVisible();
  await expect(page.locator(".wp-body")).toContainText("crate-1-0");
  await expect(page.locator(".wp-body")).toContainText("crate · wood");
  expect(await paused(page)).toBe(true);
  // The area scope is selected; turn loose props off with the keyboard.
  await toggle(page, "dynamicProps", "false").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".wp-notice")).toContainText(
    "Loose props move off at area-1. Applied.",
  );
  await expect(page.locator(".wp-body")).toContainText("frozen");
  await expect(toggle(page, "dynamicProps", "false")).toBeFocused();
  // Frozen is not protected: turn destruction off too, so slashes neither move nor crack it.
  await toggle(page, "destruction", "false").click();
  await expect(page.locator(".wp-notice")).toContainText("Destruction off at area-1. Applied.");
  await expect(page.locator(".wp-body")).toContainText("Destruction off");
  await page.locator(".world-physics").screenshot({ path: "artifacts/physics-m12-panel.png" });
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  const frozen = await body(page, "crate-1-0");
  for (let n = 0; n < 3; n++) await slashAt(page, frozen.x, frozen.y);
  await page.waitForTimeout(400);
  const still = await body(page, "crate-1-0");
  expect(Math.hypot(still.x - frozen.x, still.y - frozen.y)).toBeLessThan(0.01);
  expect(
    await page.evaluate(
      () =>
        (
          window.fern.command({ op: "actors", action: "body", id: "crate-1-0" }) as {
            consequences: { durability: number };
          }
        ).consequences.durability,
    ),
  ).toBe(100);
  // Back to Default (inherited Reactive): the same slashes move it.
  await page.keyboard.press("o");
  await expect(panel(page)).toBeVisible();
  await toggle(page, "dynamicProps", "default").click();
  await expect(page.locator(".wp-notice")).toContainText("back to its default at area-1");
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  await expect
    .poll(
      async () => {
        await slashAt(page, still.x, still.y);
        const now = await body(page, "crate-1-0");
        return Math.hypot(now.x - still.x, now.y - still.y);
      },
      { timeout: 10_000 },
    )
    .toBeGreaterThan(3);
  // Clear the area's remaining live change (destruction) from the panel.
  await page.keyboard.press("o");
  await page.locator('[data-wp="reset"][data-to="inherited"]').click();
  await expect(page.locator(".wp-notice")).toContainText("area-1 live changes cleared");
  await expect(toggle(page, "destruction", "default")).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("touch: the HUD button opens World physics; a region takes a preset, moves, grows and resets to authored; a new region comes and goes", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await beside(page, "crate-1-2", 0, 30);
    const authored = (await region(page, "wild-1"))!;
    await page.locator("#quick-physics").tap();
    await expect(panel(page)).toBeVisible();
    await page.locator('[data-wp="scope"][data-scope="region"]').tap();
    await page.locator('[data-wp="region"][data-id="wild-1"]').tap();
    await expect(page.locator(".wp-region-tools")).toContainText("Authored with Wild values");
    await page.locator('[data-wp="preset"][data-preset="Quiet"]').tap();
    await expect(page.locator(".wp-notice")).toContainText("Quiet at wild-1");
    const center = authored.shape as unknown as { x: number; y: number; radius: number };
    expect((await policyAt(page, center.x, center.y)).dynamicProps).toBe(false);
    await page.locator('[data-wp="region-grow"]').tap();
    await expect
      .poll(async () => (await region(page, "wild-1"))!.shape.radius)
      .toBeCloseTo(center.radius * 1.25, 1);
    await page.locator('[data-wp="region-raise"]').tap();
    await expect
      .poll(async () => (await region(page, "wild-1"))!.priority)
      .toBe(authored.priority + 5);
    await page.screenshot({ path: "artifacts/physics-m12-touch.png" });
    await page.locator('[data-wp="reset"][data-to="authored"]').tap();
    await expect
      .poll(async () => JSON.stringify(await region(page, "wild-1")))
      .toBe(JSON.stringify(authored));
    expect((await policyAt(page, center.x, center.y)).impulseStrength).toBe(2.5);
    await page.locator('[data-wp="region-new"]').tap();
    await expect.poll(async () => (await region(page, "custom-1"))?.shape.radius).toBe(80);
    await expect(page.locator('[data-wp="region"][data-id="custom-1"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.locator('[data-wp="region-remove"]').tap();
    await expect.poll(async () => region(page, "custom-1")).toBeNull();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("mouse: the pause menu leads to World physics; Pick on the map chooses the wheel; master off and Undo every live change", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await beside(page, "wheel-1", -40, 0);
  await page.keyboard.press("p");
  await page.getByRole("button", { name: "World physics · O" }).click();
  await expect(panel(page)).toBeVisible();
  await page.locator('[data-wp="pick"]').click();
  await expect(panel(page)).toBeHidden();
  // Still paused while choosing: the wheel stays where the click lands.
  expect(await paused(page)).toBe(true);
  const wheel = await body(page, "wheel-1");
  const at = await screen(page, wheel.x, wheel.y);
  await page.mouse.click(at.x, at.y);
  await expect(panel(page)).toBeVisible();
  await expect(page.locator(".wp-body")).toContainText("wheel-1");
  await page.locator('[data-wp="master"]').click();
  await expect(page.locator(".wp-notice")).toContainText("Every optional world reaction off");
  await expect(page.locator(".wp-here")).toContainText("Session master: off");
  expect((await policyAt(page, wheel.x, wheel.y)).worldReactions).toBe(false);
  await page.locator('[data-wp="reset-all"]').click();
  await expect(page.locator(".wp-here")).toContainText("Session master: on");
  expect((await policyAt(page, wheel.x, wheel.y)).worldReactions).toBe(true);
  expect(errors).toEqual([]);
});

test("over real WebRTC a guest sees the host's World physics edit read-only; a late joiner and a guest's disconnect keep it", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(150_000);
  const contexts: BrowserContext[] = [];
  const errors: string[] = [];
  const open = async () => {
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    contexts.push(context);
    const page = await context.newPage();
    await instrumentRtc(page);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(baseURL!);
    await page.waitForFunction(() => !!window.fern);
    await page.evaluate(() => window.fern.command({ op: "population", count: 0 }));
    return page;
  };
  try {
    const host = await open(),
      guest = await open();
    const room = await host.evaluate(() => window.fern.network.host());
    await guest.evaluate((code) => window.fern.network.join(code), room);
    await host.evaluate(() => window.fern.command({ op: "encounter", index: 1 }));
    const calm = (await region(host, "calm-1"))!.shape as unknown as { x: number; y: number };
    // The host turns the calm ring Wild with the panel; co-op keeps running, so it applies at
    // the next tick.
    await host.keyboard.press("o");
    await expect(panel(host)).toBeVisible();
    await expect(host.locator("#adventure-eyebrow")).toHaveText("WORLD PHYSICS · CO-OP CONTINUES");
    await host.locator('[data-wp="scope"][data-scope="region"]').click();
    await host.locator('[data-wp="region"][data-id="calm-1"]').click();
    await host.locator('[data-wp="preset"][data-preset="Wild"]').click();
    await expect(host.locator(".wp-notice")).toContainText("Applies next tick");
    await host.keyboard.press("Escape");
    await expect.poll(async () => (await policyAt(host, calm.x, calm.y)).impulseStrength).toBe(2.5);
    // The guest receives it and sees the same values, read-only.
    await expect
      .poll(async () => (await policyAt(guest, calm.x, calm.y)).impulseStrength, {
        timeout: 30_000,
      })
      .toBe(2.5);
    await guest.keyboard.press("o");
    await expect(panel(guest)).toBeVisible();
    await expect(guest.locator("#adventure-eyebrow")).toHaveText(
      "WORLD PHYSICS · THE HOST'S SETTINGS",
    );
    await expect(guest.locator(".wp-guest")).toContainText("The host controls shared physics");
    await expect(guest.locator('[data-wp="preset"][data-preset="Quiet"]')).toBeDisabled();
    await expect(guest.locator('[data-wp="master"]')).toBeDisabled();
    await guest.screenshot({ path: "artifacts/physics-m12-guest.png" });
    await guest.keyboard.press("Escape");
    // A late joiner gets it with the scene; the guest's disconnect changes nothing for the rest.
    const late = await open();
    await late.evaluate((code) => window.fern.network.join(code), room);
    await expect
      .poll(async () => (await policyAt(late, calm.x, calm.y)).impulseStrength, { timeout: 30_000 })
      .toBe(2.5);
    await guest.evaluate(() => window.fern.network.leave());
    await expect
      .poll(async () => (await guest.evaluate(() => window.fern.network.status())).role)
      .toBe("solo");
    await late.waitForTimeout(1000);
    expect((await policyAt(late, calm.x, calm.y)).impulseStrength).toBe(2.5);
    expect((await policyAt(host, calm.x, calm.y)).impulseStrength).toBe(2.5);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
