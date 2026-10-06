import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import type { BodyPose, JointEntry } from "../src/physics/types.ts";
import { instrumentRtc } from "./rtc-diagnostics.ts";

type Mechanisms = {
  joints: JointEntry[];
  links: unknown[];
  state: { gates: { id: string; latched: number }[] } | null;
};
const mechanisms = (page: Page) =>
  page.evaluate(() => window.fern.command({ op: "actors", action: "mechanisms" }) as Mechanisms);
const body = (page: Page, id: string) =>
  page.evaluate((id) => window.fern.command({ op: "actors", action: "body", id }) as BodyPose, id);
const assemblyEvents = (page: Page) =>
  page.evaluate(() =>
    (
      window.fern.command({ op: "save" }) as {
        adventure: { events: { type: string; text: string; owner: string }[] };
      }
    ).adventure.events
      .filter((e) => e.type === "assembly")
      .map((e) => `${e.text}/${e.owner}`),
  );
/** Area 1 without monsters or area mechanics, the traveler beside one mechanism part. */
async function beside(page: Page, id: string, dx: number, dy: number) {
  return page.evaluate(
    ([id, dx, dy]) => {
      window.fern.pause(true);
      window.fern.command({ op: "reset", seed: 142, count: 0 });
      window.fern.command({ op: "encounter", index: 1 });
      window.fern.command({ op: "step", ticks: 1 });
      const part = window.fern.command({ op: "actors", action: "body", id }) as BodyPose;
      window.fern.command({
        op: "teleport",
        x: part.x + (dx as number),
        y: part.y + (dy as number),
      });
      window.fern.command({ op: "step", ticks: 2 });
      window.fern.pause(false);
      return part;
    },
    [id, dx, dy] as const,
  );
}

test("desktop: V pulls the gate open, Whorl swings the chained ball and a slash cuts the vine", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => !!window.fern);
  // Pull: grab the leaf with the real V key and walk south holding S.
  const leaf = await beside(page, "prop-gate-1-leaf", 6, 16);
  await page.locator("#world-canvas").focus();
  await page.keyboard.press("v");
  await expect
    .poll(async () =>
      page.evaluate(() =>
        (
          window.fern.command({ op: "actors", action: "inspect" }) as {
            combat: { holds: { id: string }[] };
          }
        ).combat.holds.map((h) => h.id),
      ),
    )
    .toEqual(["prop-gate-1-leaf"]);
  await page.keyboard.down("s");
  await expect
    .poll(async () => (await body(page, leaf.id)).angle, { timeout: 5000 })
    .toBeGreaterThan(0.6);
  await page.keyboard.up("s");
  await page.keyboard.press("v");
  const swung = await body(page, leaf.id);
  const pins = (await mechanisms(page)).joints.find((j) => j.recipe.id === "gate-1:hinge")!;
  expect(pins.broken).toBe(false);
  expect(Math.hypot(swung.x - leaf.x, swung.y - leaf.y)).toBeGreaterThan(5);
  // Whorl (Q) beside the iron ball sets it swinging on its chain, owned by the traveler.
  const ball = await beside(page, "prop-chain-1-ball", -20, 14);
  await page.locator("#world-canvas").focus();
  await page.keyboard.press("q");
  await expect
    .poll(async () => {
      const b = await body(page, ball.id);
      return Math.hypot(b.x - ball.x, b.y - ball.y);
    })
    .toBeGreaterThan(8);
  const post = await body(page, "prop-chain-1-post");
  const moved = await body(page, ball.id);
  expect(Math.hypot(moved.x - post.x, moved.y - post.y)).toBeLessThanOrEqual(58.7);
  // A slash at a vine segment cuts it: the pod and its tail come loose.
  const seg = await beside(page, "prop-vine-1-seg2", -4, 14);
  const canvas = page.locator("#world-canvas");
  const box = (await canvas.boundingBox())!;
  const view = await page.evaluate(() => {
    const p = window.fern.observe().players[0],
      r = window.fern.observe().render;
    return { x: p.x, y: p.y, cx: r.cameraX, cy: r.cameraY, zoom: r.zoom };
  });
  const screen = (x: number, y: number) => ({
    x: box.x + box.width / 2 + (x - view.cx) * view.zoom,
    y: box.y + box.height / 2 + (y - view.cy) * view.zoom,
  });
  const target = screen(seg.x, seg.y);
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await expect
    .poll(
      async () =>
        (await mechanisms(page)).joints.filter((j) => j.recipe.assembly === "vine-1" && j.broken)
          .length,
      {
        timeout: 5000,
      },
    )
    .toBeGreaterThan(0);
  await page.mouse.up();
  await expect
    .poll(async () => assemblyEvents(page))
    .toContainEqual(expect.stringMatching(/^vine:\w+:cut\/local$/));
  // The broken link survives a save/restore through the page.
  const kept = await page.evaluate(() => {
    const state = window.fern.command({ op: "save" });
    window.fern.command({ op: "restore", state: JSON.parse(JSON.stringify(state)) });
    return (window.fern.command({ op: "actors", action: "mechanisms" }) as Mechanisms).joints
      .filter((j) => j.broken)
      .map((j) => j.recipe.id);
  });
  expect(kept.some((id) => id.startsWith("vine-1:"))).toBe(true);
  await page.evaluate(() => {
    const r = window.fern.observe().adventure.recipe;
    window.fern.command({ op: "teleport", x: r.x - 40, y: r.y - 240 });
  });
  await page.waitForTimeout(800);
  await canvas.screenshot({ path: "artifacts/physics-m07-meadow.png" });
  expect(errors).toEqual([]);
});

test("touch: the Grab button cocks the sprung launcher and setting it down fires it", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(90000);
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
    const sled = await beside(page, "prop-launcher-1-sled", 16, -6);
    const grab = page.getByRole("button", { name: "Grab a nearby loose prop", exact: true });
    await grab.tap();
    await expect
      .poll(async () =>
        page.evaluate(() =>
          (
            window.fern.command({ op: "actors", action: "inspect" }) as {
              combat: { holds: { id: string }[] };
            }
          ).combat.holds.map((h) => h.id),
        ),
      )
      .toEqual([sled.id]);
    // Hold "move north" to drag the sled back against its spring.
    const north = (await page
      .getByRole("button", { name: "Move north", exact: true })
      .boundingBox())!;
    await page.mouse.move(north.x + north.width / 2, north.y + north.height / 2);
    await page.mouse.down();
    await expect
      .poll(async () => (await body(page, sled.id)).y - sled.y, { timeout: 5000 })
      .toBeLessThan(-8);
    await page.mouse.up();
    await page.screenshot({ path: "artifacts/physics-m07-touch-cocked.png" });
    await grab.tap(); // Set down: the spring fires the sled.
    await expect
      .poll(async () => assemblyEvents(page), { timeout: 5000 })
      .toContain("launcher:fired/local");
    const stone = await body(page, "prop-stone-1-launch");
    expect(stone.y).toBeGreaterThan(sled.y + 14);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("a WebRTC guest throws a vine pod free and a late joiner sees every link and latch", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(150000);
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
      const f = window.fern;
      f.command({ op: "encounter", index: 1 });
      // QA isolation: Brambleburst's waves would mob the guest at the vine, and a monster in the
      // throw's path absorbs the pod (or a blow knocks it loose) before the tether is yanked.
      // One planted monster away from the mechanisms clears them and stops further waves.
      const s = (f.command({ op: "save" }) as { adventure: { recipe: { x: number; y: number } } })
        .adventure;
      f.command({
        op: "actors",
        action: "monster",
        rig: "stalker",
        x: s.recipe.x - 200,
        y: s.recipe.y + 200,
        hp: 10,
        passive: true,
        clear: true,
      });
    });
    await expect
      .poll(async () => guest.evaluate(() => window.fern.network.status().baselineReady))
      .toBe(true);
    const guestId = await host.evaluate(
      () => window.fern.observe().players.find((p) => p.id !== "local")!.id,
    );
    // The host latches the gate open and cuts the chain at its post.
    await host.evaluate(() => {
      window.fern.command({
        op: "actors",
        action: "impulse",
        id: "prop-gate-1-leaf",
        x: 0,
        y: 600,
      });
      window.fern.command({ op: "actors", action: "cut", id: "chain-1:anchor" });
    });
    await expect
      .poll(
        async () => (await mechanisms(host)).state!.gates.find((g) => g.id === "gate-1")!.latched,
      )
      .toBe(1);
    // The guest walks to the vine pod with real keys; its grab and throw are host-validated.
    const near = () =>
      host.evaluate((id) => {
        const me = window.fern.observe().players.find((p) => p.id === id)!,
          pod = window.fern.command({ op: "actors", action: "body", id: "prop-vine-1-pod" }) as {
            x: number;
            y: number;
          };
        return { dx: pod.x - me.x, dy: pod.y - me.y };
      }, guestId);
    await guest.locator("#world-canvas").focus();
    for (let step = 0; step < 40; step++) {
      const { dx, dy } = await near();
      if (Math.hypot(dx, dy) < 40) break;
      const keys = [
        ...(dx > 12 ? ["d"] : dx < -12 ? ["a"] : []),
        ...(dy > 12 ? ["s"] : dy < -12 ? ["w"] : []),
      ];
      for (const key of keys) await guest.keyboard.down(key);
      await guest.waitForTimeout(150);
      for (const key of keys) await guest.keyboard.up(key);
    }
    expect(Math.hypot(...Object.values(await near()))).toBeLessThan(60);
    await guest.evaluate(() => window.fern.game.action({ type: "grab", id: "prop-vine-1-pod" }));
    await expect
      .poll(async () =>
        host.evaluate(() =>
          (
            window.fern.command({ op: "actors", action: "inspect" }) as {
              combat: { holds: { player: string; id: string }[] };
            }
          ).combat.holds.map((h) => [h.player, h.id]),
        ),
      )
      .toEqual([[guestId, "prop-vine-1-pod"]]);
    // Face away from the vine's root (east) and throw: the tether snaps.
    await guest.locator("#world-canvas").focus();
    await guest.keyboard.down("d");
    await guest.waitForTimeout(250);
    await guest.evaluate(() => window.fern.game.action({ type: "release", throw: true }));
    await guest.keyboard.up("d");
    await expect
      .poll(
        async () =>
          (await mechanisms(host)).joints.filter((j) => j.recipe.assembly === "vine-1" && j.broken)
            .length,
        { timeout: 10000 },
      )
      .toBeGreaterThan(0);
    expect(
      await host.evaluate(
        () =>
          (
            window.fern.command({ op: "actors", action: "inspect" }) as {
              combat: { instigators: { id: string; owner: string }[] };
            }
          ).combat.instigators.find((i) => i.id === "prop-vine-1-pod")?.owner,
      ),
    ).toBe(guestId);
    const broken = (await mechanisms(host)).joints
      .filter((j) => j.broken)
      .map((j) => j.recipe.id)
      .sort();
    await expect
      .poll(
        async () =>
          (await mechanisms(guest)).joints
            .filter((j) => j.broken)
            .map((j) => j.recipe.id)
            .sort(),
        { timeout: 30000 },
      )
      .toEqual(broken);
    expect(
      await guest.evaluate(() => {
        try {
          window.fern.command({ op: "actors", action: "cut", id: "gate-1:hinge" });
          return "unexpected";
        } catch (error) {
          return String(error);
        }
      }),
    ).toContain("host");
    // Mid-interaction late join: the freed ball is still swinging when the third traveler arrives.
    await host.evaluate(() =>
      window.fern.command({
        op: "actors",
        action: "impulse",
        id: "prop-chain-1-ball",
        x: 0,
        y: 2400,
      }),
    );
    const late = await open();
    await late.evaluate((code) => window.fern.network.join(code), room);
    await expect
      .poll(
        async () =>
          (await mechanisms(late)).joints
            .filter((j) => j.broken)
            .map((j) => j.recipe.id)
            .sort(),
        { timeout: 30000 },
      )
      .toEqual(broken);
    const lateView = await mechanisms(late);
    expect(lateView.state!.gates.find((g) => g.id === "gate-1")!.latched).toBe(1);
    expect(lateView.links.length).toBe((await mechanisms(host)).links.length);
    expect(lateView.joints.find((j) => j.recipe.id === "gate-1:hinge")!.motor!.target).toBe(1.6);
    await late.locator("#world-canvas").screenshot({ path: "artifacts/physics-m07-late-join.png" });
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
