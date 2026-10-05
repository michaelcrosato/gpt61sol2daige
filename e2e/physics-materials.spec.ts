import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import type { SaveState } from "../src/engine/simulation.ts";
import type { DestroyedRecord } from "../src/physics/adventure.ts";
import type { BodyPose } from "../src/physics/types.ts";
import { instrumentRtc } from "./rtc-diagnostics.ts";

type Scenery = { props: BodyPose[]; destroyed: DestroyedRecord[] };
const scenery = (page: Page) =>
  page.evaluate(() => window.fern.command({ op: "actors", action: "props" }) as Scenery);

test("real attacks break material scenery in the renderer, with feedback, reward and save/restore", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => !!window.fern);
  const pylon = await page.evaluate(() => {
    window.fern.pause(true);
    window.fern.command({ op: "reset", seed: 142, count: 0 });
    window.fern.command({ op: "encounter", index: 1 });
    window.fern.command({ op: "step", ticks: 1 });
    const target = window.fern.command({
      op: "actors",
      action: "body",
      id: "prop-pylon-1-0",
    }) as BodyPose;
    window.fern.command({ op: "teleport", x: target.x - 26, y: target.y });
    window.fern.pause(false);
    return target;
  });
  expect(pylon.material).toBe("glass");
  expect(pylon.blueprint?.family).toBe("pylon");
  // Let the camera settle on the player, then aim right of them and swing with the mouse.
  await page.waitForTimeout(1200);
  const canvas = page.locator("#world-canvas");
  const box = (await canvas.boundingBox())!;
  const player = await page.evaluate(() => {
    const p = window.fern.observe().players[0];
    const r = window.fern.observe().render;
    return { x: p.x, y: p.y, cameraX: r.cameraX, cameraY: r.cameraY, zoom: r.zoom };
  });
  const sx = box.x + box.width / 2 + (player.x - player.cameraX) * player.zoom,
    sy = box.y + box.height / 2 + (player.y - player.cameraY) * player.zoom;
  await page.mouse.move(sx + 70, sy);
  await page.mouse.down();
  await expect
    .poll(async () => (await scenery(page)).destroyed.map((d) => d.id), { timeout: 10000 })
    .toContain("prop-pylon-1-0");
  await page.mouse.up();
  const broken = await scenery(page);
  const shards = broken.props.filter((p) => p.blueprint?.parent === "prop-pylon-1-0");
  expect(shards.length).toBe(5);
  expect(shards.every((p) => p.material === "glass")).toBe(true);
  // The full 96-event ring: a Stormglass pylon now also releases its charge (M08), whose arcs
  // follow the break inside the 12-event observation window.
  const events = await page.evaluate(
    () =>
      (
        window.fern.command({ op: "save" }) as {
          adventure: { events: { type: string; text: string }[] };
        }
      ).adventure.events,
  );
  expect(events.some((e) => e.type === "break" && e.text === "pylon:glass")).toBe(true);
  // The agent damage path breaks a tree (140 toughness: four 40-point hits) into a fixed stump
  // and pushable log, and a wagon (120 toughness: two 60-point hits) into planks and wheels.
  await page.evaluate(() => {
    window.fern.pause(true);
    for (let n = 0; n < 4; n++)
      window.fern.command({
        op: "actors",
        action: "damage",
        id: "prop-tree-1-0",
        damage: 40,
        angle: 0.4,
      });
    for (let n = 0; n < 2; n++)
      window.fern.command({ op: "actors", action: "damage", id: "prop-wagon-1-0", damage: 60 });
    window.fern.command({ op: "actors", action: "damage", id: "prop-stone-1-0", damage: 12 });
    window.fern.command({ op: "step", ticks: 20 });
  });
  const after = await scenery(page);
  expect(after.destroyed.map((d) => d.id)).toEqual([
    "prop-pylon-1-0",
    "prop-tree-1-0",
    "prop-wagon-1-0",
  ]);
  const ids = after.props.map((p) => p.id);
  expect(ids).toContain("prop-tree-1-0-stump");
  expect(ids).toContain("prop-tree-1-0-log");
  expect(ids).toContain("prop-wagon-1-0-wheel0");
  expect(after.props.find((p) => p.id === "prop-stone-1-0")!.consequences?.durability).toBe(100);
  expect(after.destroyed.find((d) => d.id === "prop-wagon-1-0")!.reward).toBeGreaterThan(0);
  // Save/restore in the page keeps the same destruction state.
  const restored = await page.evaluate(() => {
    const state = window.fern.command({ op: "save" }) as SaveState;
    window.fern.command({ op: "reset", seed: 142, count: 0 });
    window.fern.command({ op: "restore", state: JSON.parse(JSON.stringify(state)) });
    return window.fern.command({ op: "actors", action: "props" }) as Scenery;
  });
  expect(restored.destroyed).toEqual(after.destroyed);
  expect(restored.props.map((p) => p.id).sort()).toEqual([...ids].sort());
  // Frame the broken clearing for review: stump, log, wheels, planks and glass shards.
  await page.evaluate(
    ([x, y]) => {
      window.fern.command({ op: "teleport", x, y });
      window.fern.pause(false);
    },
    [pylon.x - 90, pylon.y + 470],
  );
  await page.waitForTimeout(900);
  await canvas.screenshot({ path: "artifacts/physics-m05-destruction.png" });
  expect(errors).toEqual([]);
});

test("a connected guest and a late joiner see the host's destruction over real WebRTC", async ({
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
    await host.evaluate(() => {
      window.fern.command({ op: "encounter", index: 1 });
      window.fern.command({ op: "actors", action: "damage", id: "prop-pylon-1-0", damage: 50 });
      for (let n = 0; n < 2; n++)
        window.fern.command({ op: "actors", action: "damage", id: "crate-1-0", damage: 30 });
      window.fern.command({ op: "actors", action: "damage", id: "prop-pot-1-1", damage: 4 });
    });
    const hostView = await scenery(host);
    expect(hostView.destroyed.map((d) => d.id)).toEqual(["prop-pylon-1-0", "crate-1-0"]);
    const damaged = hostView.props.find((p) => p.id === "prop-pot-1-1")!.consequences!.durability!;
    expect(damaged).toBeLessThan(100);
    expect(damaged).toBeGreaterThan(0);
    for (const page of [guest]) {
      await expect
        .poll(async () => (await scenery(page)).destroyed.map((d) => d.id), { timeout: 30000 })
        .toEqual(["prop-pylon-1-0", "crate-1-0"]);
      const seen = await scenery(page);
      expect(seen.props.some((p) => p.id === "crate-1-0")).toBe(false);
      expect(seen.props.filter((p) => p.blueprint?.parent === "crate-1-0").length).toBe(4);
      expect(seen.props.find((p) => p.id === "prop-pot-1-1")!.consequences!.durability).toBe(
        damaged,
      );
    }
    expect(
      await guest.evaluate(() => {
        try {
          window.fern.command({ op: "actors", action: "damage", id: "crate-1-1", damage: 9 });
          return "unexpected";
        } catch (error) {
          return String(error);
        }
      }),
    ).toContain("host");
    const late = await open();
    await late.evaluate((code) => window.fern.network.join(code), room);
    await expect
      .poll(async () => (await scenery(late)).destroyed.map((d) => d.id), { timeout: 30000 })
      .toEqual(["prop-pylon-1-0", "crate-1-0"]);
    const lateView = await scenery(late);
    expect(lateView.props.filter((p) => p.blueprint?.parent === "prop-pylon-1-0").length).toBe(5);
    expect(lateView.props.find((p) => p.id === "prop-pot-1-1")!.consequences!.durability).toBe(
      damaged,
    );
    await late.locator("#world-canvas").screenshot({ path: "artifacts/physics-m05-late-join.png" });
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
