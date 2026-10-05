import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import type { SaveState } from "../src/engine/simulation.ts";
import type { BodyPose } from "../src/physics/types.ts";
import { instrumentRtc } from "./rtc-diagnostics.ts";

type Combat = {
  holds: { player: string; id: string }[];
  instigators: { id: string; owner: string }[];
};
const combat = (page: Page) =>
  page.evaluate(
    () => (window.fern.command({ op: "actors", action: "inspect" }) as { combat: Combat }).combat,
  );
const body = (page: Page, id: string) =>
  page.evaluate((id) => window.fern.command({ op: "actors", action: "body", id }) as BodyPose, id);
/** A known loose prop beside the local traveler in area 1. */
async function standBeside(page: Page, id: string) {
  return page.evaluate((id) => {
    window.fern.pause(true);
    window.fern.command({ op: "reset", seed: 142, count: 0 });
    window.fern.command({ op: "encounter", index: 1 });
    window.fern.command({ op: "step", ticks: 1 });
    const r = window.fern.observe().adventure.recipe;
    window.fern.command({ op: "actors", action: "place", id, x: r.x + 190, y: r.y + 20 });
    window.fern.command({ op: "teleport", x: r.x + 168, y: r.y + 20 });
    window.fern.command({ op: "step", ticks: 2 });
    window.fern.pause(false);
    return { x: r.x + 190, y: r.y + 20 };
  }, id);
}

test("desktop: V grabs, the mouse throws with ownership, held attacks stay immediate and loot settles and saves", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => !!window.fern);
  await standBeside(page, "crate-1-3");
  // The discoverable prompt names the nearest loose prop; V grabs it through the action path.
  await expect.poll(async () => (await combat(page)).holds.length).toBe(0);
  await page.locator("#world-canvas").focus();
  await page.keyboard.press("v");
  await expect.poll(async () => (await combat(page)).holds.map((h) => h.player)).toEqual(["local"]);
  await expect(page.locator("#grab-label")).toHaveText("Set down");
  const held = (await combat(page)).holds[0].id;
  // Throw by clicking to the right of the traveler.
  const canvas = page.locator("#world-canvas");
  const box = (await canvas.boundingBox())!;
  const view = await page.evaluate(() => {
    const p = window.fern.observe().players[0],
      r = window.fern.observe().render;
    return { x: p.x, y: p.y, cx: r.cameraX, cy: r.cameraY, zoom: r.zoom };
  });
  const sx = box.x + box.width / 2 + (view.x - view.cx) * view.zoom,
    sy = box.y + box.height / 2 + (view.y - view.cy) * view.zoom;
  await page.mouse.move(sx + 90, sy);
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(async () => (await combat(page)).holds.length).toBe(0);
  await expect
    .poll(async () => (await combat(page)).instigators.find((i) => i.id === held)?.owner)
    .toBe("local");
  const thrown = await body(page, held);
  expect(Math.hypot(thrown.vx, thrown.vy) > 60 || thrown.x > view.x + 40).toBe(true);
  // Held mouse attacks still respond at once: slash events within a few frames.
  const before = await page.evaluate(() => window.fern.command({ op: "save" }) as SaveState);
  const slashes = before.adventure!.events.filter((e) => e.type === "slash").length;
  await page.mouse.down();
  await expect
    .poll(
      async () =>
        (
          await page.evaluate(() => window.fern.command({ op: "save" }) as SaveState)
        ).adventure!.events.filter((e) => e.type === "slash").length,
      { timeout: 2000 },
    )
    .toBeGreaterThan(slashes);
  await page.mouse.up();
  // Physical loot: a kill launches drops as loot bodies; they settle and survive save/restore.
  const loot = await page.evaluate(() => {
    window.fern.pause(true);
    const enemy = window.fern.game.observe().enemies[0];
    window.fern.command({ op: "teleport", x: enemy.x - 26, y: enemy.y });
    for (let n = 0; n < 240 && window.fern.game.observe().kills === 0; n++) {
      const e = window.fern.game.observe().enemies.find((en) => en.hp > 0);
      if (!e) break;
      const p = window.fern.observe().players[0];
      if (Math.hypot(e.x - p.x, e.y - p.y) > 40)
        window.fern.command({ op: "teleport", x: e.x - 26, y: e.y });
      window.fern.command({ op: "input", attack: true, aimX: 1, aimY: 0 });
      window.fern.command({ op: "step", ticks: 6 });
    }
    window.fern.command({ op: "input" });
    window.fern.command({ op: "step", ticks: 2 });
    const ids = (
      window.fern.command({ op: "actors", action: "inspect" }) as { bodies: { id: string }[] }
    ).bodies.map((b) => b.id);
    const state = window.fern.command({ op: "save" }) as SaveState;
    return {
      kills: window.fern.game.observe().kills,
      bodies: state.actorPhysics!.world.bodies.filter((b) => b.recipe.id.startsWith("loot-"))
        .length,
      drops: state.adventure!.drops.length,
      preview: ids.length,
    };
  });
  expect(loot.kills).toBeGreaterThan(0);
  expect(loot.drops).toBeGreaterThan(0);
  expect(loot.bodies).toBeGreaterThan(0);
  const restored = await page.evaluate(() => {
    const state = window.fern.command({ op: "save" }) as SaveState;
    window.fern.command({ op: "reset", seed: 142, count: 0 });
    window.fern.command({ op: "restore", state: JSON.parse(JSON.stringify(state)) });
    const again = window.fern.command({ op: "save" }) as SaveState;
    return {
      drops: again.adventure!.drops.map((d) => d.id),
      bodies: again
        .actorPhysics!.world.bodies.filter((b) => b.recipe.id.startsWith("loot-"))
        .map((b) => b.recipe.id),
      original: state.adventure!.drops.map((d) => d.id),
    };
  });
  expect(restored.drops).toEqual(restored.original);
  expect(restored.bodies.length).toBeGreaterThan(0);
  await page.evaluate(() => window.fern.pause(false));
  await page.locator("#world-canvas").screenshot({ path: "artifacts/physics-m06-loot.png" });
  expect(errors).toEqual([]);
});

test("touch: the Grab button lifts a prop and the attack button throws it", async ({
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
    await page.goto(baseURL!);
    await page.waitForFunction(() => !!window.fern);
    await standBeside(page, "crate-1-3");
    const grab = page.getByRole("button", { name: "Grab a nearby loose prop", exact: true });
    await expect(grab).toBeVisible();
    await grab.tap();
    await expect.poll(async () => (await combat(page)).holds.length).toBe(1);
    await page.screenshot({ path: "artifacts/physics-m06-touch-hold.png" });
    await page.locator("#attack-button").tap();
    await expect.poll(async () => (await combat(page)).holds.length).toBe(0);
    await expect
      .poll(async () => (await combat(page)).instigators.some((i) => i.owner === "local"))
      .toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("a WebRTC guest grabs and throws through acknowledged host actions", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(120000);
  const contexts: BrowserContext[] = [];
  const errors: string[] = [];
  const open = async () => {
    const context = await browser.newContext({ viewport: { width: 1000, height: 760 } });
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
    await expect
      .poll(async () => guest.evaluate(() => window.fern.network.status().baselineReady))
      .toBe(true);
    const guestId = await host.evaluate(
      () => window.fern.observe().players.find((p) => p.id !== "local")!.id,
    );
    // The host spawns a crate beside the guest's traveler.
    await host.evaluate((id) => {
      const g = window.fern.observe().players.find((p) => p.id === id)!;
      const areaId = (
        window.fern.command({ op: "actors", action: "policy", x: g.x + 26, y: g.y }) as {
          areaId: string;
        }
      ).areaId;
      window.fern.command({
        op: "actors",
        action: "spawn",
        body: {
          id: "prop-guest-crate",
          role: "prop",
          areaId,
          motion: "dynamic",
          shape: { kind: "box", width: 18, height: 18 },
          x: g.x + 26,
          y: g.y,
          mass: 1,
          damping: 2,
        },
      });
    }, guestId);
    await expect
      .poll(async () =>
        guest.evaluate(() =>
          (
            window.fern.command({ op: "actors", action: "props" }) as { props: { id: string }[] }
          ).props.some((p) => p.id === "prop-guest-crate"),
        ),
      )
      .toBe(true);
    // A far grab is rejected by the host; a near one is acknowledged.
    expect(
      await guest.evaluate(async () => {
        try {
          await window.fern.game.action({ type: "grab", id: "crate-1-0" });
          return "accepted";
        } catch (error) {
          return String(error);
        }
      }),
    ).toContain("within");
    await guest.evaluate(() => window.fern.game.action({ type: "grab", id: "prop-guest-crate" }));
    await expect
      .poll(async () => (await combat(host)).holds.map((h) => [h.player, h.id]))
      .toEqual([[guestId, "prop-guest-crate"]]);
    await expect.poll(async () => (await combat(guest)).holds.length, { timeout: 30000 }).toBe(1);
    await guest.evaluate(() => window.fern.game.action({ type: "release", throw: true }));
    await expect.poll(async () => (await combat(host)).holds.length).toBe(0);
    expect((await combat(host)).instigators.find((i) => i.id === "prop-guest-crate")?.owner).toBe(
      guestId,
    );
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
