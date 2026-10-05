import { expect, type Page, test } from "@playwright/test";
import type { ReactionState } from "../src/physics/reactions.ts";
import type { BodyPose } from "../src/physics/types.ts";

const reactions = (page: Page) =>
  page.evaluate(
    () =>
      (window.fern.command({ op: "actors", action: "reactions" }) as { state: ReactionState })
        .state,
  );
const texts = async (page: Page) => (await reactions(page)).history.map((e) => e.text);
const body = (page: Page, id: string) =>
  page.evaluate((id) => window.fern.command({ op: "actors", action: "body", id }) as BodyPose, id);
const destroyed = (page: Page) =>
  page.evaluate(() =>
    (
      window.fern.command({ op: "actors", action: "props" }) as {
        destroyed: { id: string; owner: string; cause: string }[];
      }
    ).destroyed.map((d) => `${d.id}/${d.owner}/${d.cause}`),
  );
/** Area 1 without monsters or area mechanics, the traveler beside one yard prop. */
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
/** Screen point of a world position on the main canvas. */
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

test("desktop: a carried oil jar bursts on the brazier, a slash on the coil sets off the keg, and saves keep the fire", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => !!window.fern);
  // V grabs the oil jar; aiming at the brazier and walking up to it presses the jar against it.
  const jar = await beside(page, "prop-jar-1-0", -14, 8);
  const brazier = await body(page, "prop-brazier-1-0");
  const canvas = page.locator("#world-canvas");
  await page.waitForTimeout(400);
  await canvas.screenshot({ path: "artifacts/physics-m08-yard.png" });
  await canvas.focus();
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
    .toEqual([jar.id]);
  const aim = await screen(page, brazier.x, brazier.y);
  await page.mouse.move(aim.x, aim.y);
  await page.keyboard.down("w");
  await page.keyboard.down("d");
  await expect
    .poll(
      async () =>
        page.evaluate(
          ([x, y]) => {
            const p = window.fern.observe().players[0];
            return Math.hypot(p.x - x, p.y - y);
          },
          [brazier.x, brazier.y],
        ),
      { timeout: 5000 },
    )
    .toBeLessThan(34);
  await page.keyboard.up("w");
  await page.keyboard.up("d");
  await expect
    .poll(async () => texts(page), { timeout: 6000 })
    .toEqual(expect.arrayContaining(["heat", "ignite:oil", "spill:oil", "flare"]));
  const slick = (await reactions(page)).surfaces.find((s) => s.id === `oil-${jar.id}`)!;
  expect(slick.burning).toBeGreaterThan(0);
  expect((await destroyed(page)).some((d) => d.startsWith(`${jar.id}/local/`))).toBe(true);
  // The burning slick survives a save/restore through the page and keeps burning down.
  const kept = await page.evaluate((id) => {
    const state = window.fern.command({ op: "save" });
    window.fern.command({ op: "restore", state: JSON.parse(JSON.stringify(state)) });
    return (
      window.fern.command({ op: "actors", action: "reactions" }) as { state: ReactionState }
    ).state.surfaces.find((s) => s.id === id)!;
  }, slick.id);
  expect(kept.burning).toBeGreaterThan(0);
  await expect
    .poll(async () => (await reactions(page)).surfaces.find((s) => s.id === slick.id)?.burning ?? 0)
    .toBeLessThan(kept.burning);
  await canvas.screenshot({ path: "artifacts/physics-m08-flare.png" });
  // A real mouse slash on the storm coil: the discharge runs down the rods into the keg.
  const coil = await beside(page, "prop-coil-1-0", -18, 2);
  await canvas.focus();
  const target = await screen(page, coil.x, coil.y);
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await expect
    .poll(async () => texts(page), { timeout: 6000 })
    .toEqual(expect.arrayContaining(["discharge", "conduct:arc", "detonate:spark"]));
  await page.mouse.up();
  await expect.poll(async () => texts(page), { timeout: 6000 }).toContain("blast");
  await page.waitForTimeout(250);
  await canvas.screenshot({ path: "artifacts/physics-m08-blast.png" });
  await expect.poll(async () => destroyed(page)).toContain("prop-barrel-1-2/local/blast");
  const chain = (await reactions(page)).chains.find((c) => c.origin === "coil")!;
  expect(chain.owner).toBe("local");
  expect(chain.rules).toEqual(expect.arrayContaining(["conduct", "detonate"]));
  expect(errors).toEqual([]);
});

test("touch: the Slash button strikes the fan and its gust drives the casks downwind", async ({
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
    // Stand east of the fan and turn toward it with the touch pad, so a slash lands on its hub.
    const fan = await beside(page, "prop-fan-1-0", 22, 0);
    const cask = await body(page, "prop-cask-1-0");
    const west = (await page
      .getByRole("button", { name: "Move west", exact: true })
      .boundingBox())!;
    await page.mouse.move(west.x + west.width / 2, west.y + west.height / 2);
    await page.mouse.down();
    await expect
      .poll(async () => page.evaluate(() => window.fern.observe().players[0].vx))
      .toBeLessThan(-5);
    await page.mouse.up();
    await page.getByRole("button", { name: "Slash attack", exact: true }).tap();
    await expect
      .poll(async () => (await reactions(page)).fields.map((f) => f.id), { timeout: 5000 })
      .toContain(`fan:${fan.id}`);
    await expect
      .poll(async () => (await body(page, cask.id)).x - cask.x, { timeout: 5000 })
      .toBeGreaterThan(25);
    await page.screenshot({ path: "artifacts/physics-m08-touch-gust.png" });
    expect(await texts(page)).toContain("field:fan");
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
