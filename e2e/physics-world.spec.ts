import { expect, type Page, test } from "@playwright/test";

// M10 reactive towns and authored areas, through real keyboard and mouse input. Each area's
// capture is written to artifacts/physics-m10-*.png (the selected ones are kept in docs/evidence).

type Pose = { id: string; x: number; y: number; angle: number; vx: number; vy: number };
const body = (page: Page, id: string) =>
  page.evaluate((id) => window.fern.command({ op: "actors", action: "body", id }) as Pose, id);
const has = (page: Page, id: string) =>
  page.evaluate((id) => {
    try {
      window.fern.command({ op: "actors", action: "body", id });
      return true;
    } catch {
      return false;
    }
  }, id);
const showcase = (page: Page) =>
  page.evaluate(
    () =>
      window.fern.command({ op: "actors", action: "showcase" }) as {
        restraints: { body: string; kind: string; owner: string }[];
        living: { id: number; warden: { move: string; exposedUntil: number; exposedBy: string } }[];
      },
  );
const events = (page: Page) =>
  page.evaluate(() =>
    (
      window.fern.command({ op: "save" }) as {
        adventure: { events: { type: string; text: string; owner: string; amount: number }[] };
      }
    ).adventure.events.map((e) => ({ type: e.type, text: e.text, owner: e.owner })),
  );
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
/** A real mouse slash at a world point. */
async function slashAt(page: Page, x: number, y: number) {
  const aim = await screen(page, x, y);
  await page.mouse.move(aim.x, aim.y);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
}
/** A short real key press (held long enough for a tick to read it). */
async function tap(page: Page, key: string, ms = 90) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}
/** Walk with WASD toward a world point until within `near`, re-reading the position. */
async function walkTo(page: Page, x: number, y: number, near = 12, timeout = 25000) {
  const held = new Set<string>();
  const hold = async (key: string, on: boolean) => {
    if (on && !held.has(key)) await page.keyboard.down(key);
    if (!on && held.has(key)) await page.keyboard.up(key);
    if (on) held.add(key);
    else held.delete(key);
  };
  const end = Date.now() + timeout;
  // A stall, a crate or a passing townsperson can pin a straight walk: when the traveler makes
  // no progress for a moment, it steps around at 90° (alternating sides) before trying again.
  let last = { x: Number.NaN, y: Number.NaN, t: Date.now() },
    around = 0,
    until = 0;
  try {
    while (Date.now() < end) {
      const p = await page.evaluate(() => window.fern.observe().players[0]);
      let dx = x - p.x,
        dy = y - p.y;
      if (Math.hypot(dx, dy) <= near) return true;
      if (!(Math.hypot(p.x - last.x, p.y - last.y) < 2)) last = { x: p.x, y: p.y, t: Date.now() };
      else if (Date.now() - last.t > 600 && Date.now() > until) {
        around = around === 1 ? -1 : 1;
        until = Date.now() + 500;
        last = { x: p.x, y: p.y, t: Date.now() };
      }
      if (Date.now() < until) [dx, dy] = [-dy * around, dx * around];
      await hold("d", dx > 4);
      await hold("a", dx < -4);
      await hold("s", dy > 4);
      await hold("w", dy < -4);
      await page.waitForTimeout(40);
    }
    return false;
  } finally {
    for (const key of [...held]) await page.keyboard.up(key);
  }
}
/** A full-speed walk slides on after the keys come up: wait until the traveler is at rest. */
async function settle(page: Page) {
  await page
    .waitForFunction(
      () => {
        const q = window.fern.observe().players[0];
        return Math.hypot(q.vx, q.vy) < 8;
      },
      null,
      { timeout: 1500 },
    )
    .catch(() => {});
  return page.evaluate(() => window.fern.observe().players[0]);
}
/** An authored area with no waves (QA): the traveler stands at the entry. */
async function area(page: Page, index: number, zoom = 2) {
  return page.evaluate(
    ([index, zoom]) => {
      const f = window.fern;
      f.pause(true);
      f.command({ op: "reset", seed: 142, count: 0 });
      f.command({ op: "encounter", index });
      f.command({ op: "step", ticks: 1 });
      const s = (
        f.command({ op: "save" }) as {
          adventure: {
            recipe: { x: number; y: number };
            mechanics: { id: number; kind: string; x: number; y: number; pair: number | null }[];
          };
        }
      ).adventure;
      // A planted monster with `clear` sends the wave away and stops further waves.
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
      f.command({ op: "step", ticks: 2 });
      f.zoom(zoom);
      f.pause(false);
      return { recipe: s.recipe, mechanics: s.mechanics };
    },
    [index, zoom] as const,
  );
}
const teleport = (page: Page, x: number, y: number) =>
  page.evaluate(([x, y]) => window.fern.command({ op: "teleport", x, y }), [x, y] as const);
const monster = (page: Page, x: number, y: number, extra: Record<string, unknown> = {}) =>
  page.evaluate(
    ([x, y, extra]) =>
      window.fern.command({
        op: "actors",
        action: "monster",
        rig: "stalker",
        x,
        y,
        hp: 5000,
        passive: true,
        ...(extra as object),
      }) as { id: number; body: string },
    [x, y, extra] as const,
  );

test("desktop: the Sanctuary town's lamps swing and settle, bunting flutters, nothing breaks, and real input reaches every service", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => !!window.fern);
  await page.evaluate(() => {
    window.fern.display.enterGame(false);
    window.fern.command({ op: "reset", seed: 142, count: 0 });
    window.fern.zoom(2.2);
  });
  const canvas = page.locator("#world-canvas");
  await canvas.focus();
  expect(await page.evaluate(() => window.fern.game.observe().mode)).toBe("town");
  // Walk to the lamp by the apothecary and slash across its bracket arm.
  const post = await body(page, "prop-post-town-lamp1"),
    rest = (await body(page, "prop-lamp-town-1")).angle;
  expect(await walkTo(page, post.x + 10, post.y - 22, 8)).toBe(true);
  await slashAt(page, post.x + 10, post.y);
  await expect
    .poll(async () => Math.abs((await body(page, "prop-lamp-town-1")).angle - rest), {
      timeout: 4000,
    })
    .toBeGreaterThan(0.12);
  await canvas.screenshot({ path: "artifacts/physics-m10-town-lamp.png" });
  await expect
    .poll(async () => Math.abs((await body(page, "prop-lamp-town-1")).angle - rest), {
      timeout: 12000,
    })
    .toBeLessThan(0.06);
  // The bunting keeps fluttering in the breeze.
  const a = await body(page, "prop-pennant-town-5");
  await page.waitForTimeout(700);
  const b = await body(page, "prop-pennant-town-5");
  expect(Math.hypot(b.x - a.x, b.y - a.y) + Math.abs(b.angle - a.angle)).toBeGreaterThan(0.05);
  // Real slashes on the market's goods move them; Sanctuary breaks nothing.
  const basket = await body(page, "prop-basket-town-1");
  expect(await walkTo(page, basket.x - 20, basket.y, 8)).toBe(true);
  await slashAt(page, basket.x, basket.y);
  await page.waitForTimeout(400);
  expect(
    await page.evaluate(
      () =>
        (window.fern.command({ op: "actors", action: "props" }) as { destroyed: unknown[] })
          .destroyed.length,
    ),
  ).toBe(0);
  await page.evaluate(() => window.fern.zoom(1.4));
  await canvas.screenshot({ path: "artifacts/physics-m10-town.png" });
  // The hearth: walk there clear of Rowan's post (a traveler walking into a townsperson carries
  // them along, and E then offers their service instead). A full-speed walk slides on after the
  // keys come up, so let the traveler come to rest within the hearth's reach (58) with no
  // townsperson within service reach, then press E; if it did not rest, step back and press again.
  expect(await walkTo(page, -60, -70, 14)).toBe(true);
  const nearestFolk = () =>
    page.evaluate(() => {
      const p = window.fern.observe().players[0],
        folk = (
          window.fern.command({ op: "actors", action: "rigs" }) as {
            townsfolk: { x: number; y: number }[];
          }
        ).townsfolk;
      return Math.min(...folk.map((f) => Math.hypot(f.x - p.x, f.y - p.y)));
    });
  const rested = async () => (await events(page)).some((e) => e.text.startsWith("Life, spirit"));
  for (const end = Date.now() + 40000; !(await rested()) && Date.now() < end; ) {
    await walkTo(page, 0, 28, 16, 8000);
    const p = await settle(page);
    if (Math.hypot(p.x, p.y) < 50 && (await nearestFolk()) > 50) {
      await tap(page, "e");
      await expect
        .poll(rested, { timeout: 2000 })
        .toBe(true)
        .catch(() => {});
    } else await page.waitForTimeout(250);
  }
  expect(
    await rested(),
    `rest at the hearth (nearest townsperson ${(await nearestFolk()).toFixed(0)}; recent ${JSON.stringify((await events(page)).slice(-4))})`,
  ).toBe(true);
  // The quartermaster, wherever a shove has left him. Walking into a townsperson shoves him (M09),
  // and a full-speed walk can overshoot into Rowan just as E is pressed. So stop short of him, let
  // the traveler settle, and press E once the prompt names him; if a bump carried him out of
  // reach, follow and press again, as a player would.
  const prompt = page.locator("#interaction-prompt");
  const shop = async () => (await events(page)).some((e) => e.text === "service:shop");
  for (const end = Date.now() + 40000; !(await shop()) && Date.now() < end; ) {
    const rowan = await page.evaluate(
      () =>
        (
          window.fern.command({ op: "actors", action: "rigs" }) as {
            townsfolk: { x: number; y: number }[];
          }
        ).townsfolk[0],
    );
    await walkTo(page, rowan.x, rowan.y, 32, 4000);
    await settle(page);
    if ((await prompt.isVisible()) && (await prompt.textContent())?.includes("Rowan")) {
      await tap(page, "e");
      await expect
        .poll(shop, { timeout: 2000 })
        .toBe(true)
        .catch(() => {});
    }
  }
  expect(
    await shop(),
    `Rowan's shop (recent ${JSON.stringify((await events(page)).slice(-4))})`,
  ).toBe(true);
  // Rowan's provisions are open; close them and head for the outward gate.
  await page.screenshot({ path: "artifacts/physics-m10-town-service.png" });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  await canvas.focus();
  expect(await walkTo(page, 210, 36, 20)).toBe(true);
  await tap(page, "e");
  await expect.poll(() => page.evaluate(() => window.fern.game.observe().mode)).toBe("area");
  expect(errors).toEqual([]);
});

test("desktop: every authored area's physical interaction answers real input, captured area by area", async ({
  page,
}) => {
  test.setTimeout(360000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => !!window.fern);
  await page.evaluate(() => window.fern.display.enterGame(false));
  const canvas = page.locator("#world-canvas");
  const shot = (index: number) =>
    canvas.screenshot({ path: `artifacts/physics-m10-area-${index}.png` });
  const of = (mechanics: { id: number; kind: string; x: number; y: number }[], kind: string) =>
    mechanics.filter((m) => m.kind === kind)[0];
  const local = () => page.evaluate(() => window.fern.observe().players[0].id as string);

  // 1 Brambleburst: a real slash bursts a pod: thorn splinters fly and its hedges open.
  {
    const { mechanics } = await area(page, 1);
    const pod = of(mechanics, "bramble");
    await monster(page, pod.x + 24, pod.y + 12);
    await teleport(page, pod.x - 36, pod.y - 10);
    await canvas.focus();
    await page.waitForTimeout(150);
    await slashAt(page, pod.x, pod.y);
    await expect.poll(() => has(page, "prop-hedge-1-bramble-0-1"), { timeout: 5000 }).toBe(false);
    // Owned thorn splinters are in flight.
    expect(
      await page.evaluate(
        () =>
          (
            window.fern.command({ op: "actors", action: "props" }) as { props: { id: string }[] }
          ).props.filter((p) => p.id.startsWith("prop-thorn-")).length,
      ),
    ).toBeGreaterThan(0);
    await shot(1);
  }
  // 2 Slipstream: the lane carries its barrel; walking across the lane's mechanic gusts it.
  {
    const { mechanics } = await area(page, 2);
    const lane = of(mechanics, "wind");
    const barrel = await body(page, "prop-barrel-2-wind-0-0");
    await teleport(page, lane.x - 70, lane.y);
    await canvas.focus();
    expect(await walkTo(page, lane.x, lane.y, 20)).toBe(true);
    const me = await local();
    await expect
      .poll(async () =>
        page.evaluate(
          (me) =>
            (
              window.fern.command({ op: "actors", action: "reactions" }) as {
                state: { fields: { id: string; owner: string }[] };
              }
            ).state.fields.some((f) => f.id.startsWith("gust:") && f.owner === me),
          me,
        ),
      )
      .toBe(true);
    await walkTo(page, lane.x - 90, lane.y + 40, 14);
    const moved = await body(page, "prop-barrel-2-wind-0-0");
    expect(Math.hypot(moved.x - barrel.x, moved.y - barrel.y)).toBeGreaterThan(20);
    await shot(2);
  }
  // 3 Stormglass: monsters wading the pool get wet; a real slash on one arcs through them.
  {
    await area(page, 3);
    const pool = await page.evaluate(
      () =>
        (
          window.fern.command({ op: "actors", action: "reactions" }) as {
            state: { surfaces: { id: string; x: number; y: number }[] };
          }
        ).state.surfaces.find((s) => s.id === "pool-3-0")!,
    );
    const a = await monster(page, pool.x - 10, pool.y);
    await monster(page, pool.x + 16, pool.y + 8);
    await page.waitForTimeout(500);
    const target = await body(page, a.body);
    await teleport(page, target.x - 18, target.y - 20);
    await canvas.focus();
    await page.waitForTimeout(150);
    await slashAt(page, target.x, target.y);
    await expect
      .poll(
        async () =>
          (await events(page)).filter((e) => e.type === "reaction" && e.text.startsWith("conduct"))
            .length,
        { timeout: 5000 },
      )
      .toBeGreaterThan(0);
    await shot(3);
  }
  // 4 Echo Wells: Whorl (Q) beside a well; the echo launches the resonance stones again.
  {
    const { mechanics } = await area(page, 4);
    const well = of(mechanics, "echo");
    await teleport(page, well.x - 50, well.y);
    await canvas.focus();
    await page.waitForTimeout(150);
    await tap(page, "q");
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (
                window.fern.command({ op: "save" }) as {
                  actorPhysics: { combat: { instigators: { id: string; cause: string }[] } };
                }
              ).actorPhysics.combat.instigators.find((i) => i.id === "prop-stone-4-echo-0-0")
                ?.cause,
          ),
        { timeout: 5000 },
      )
      .toBe("echo:whorl");
    await shot(4);
  }
  // 5 Cinderwake: walking over a vent erupts it; its fuse burns into the stockade.
  {
    const { mechanics } = await area(page, 5);
    const vent = of(mechanics, "cinder");
    await teleport(page, vent.x - 40, vent.y);
    await canvas.focus();
    expect(await walkTo(page, vent.x, vent.y, 8)).toBe(true);
    await walkTo(page, vent.x - 60, vent.y, 12);
    await expect
      .poll(() => has(page, "prop-barricade-5-cinder-0-front"), { timeout: 15000 })
      .toBe(false);
    await shot(5);
  }
  // 6 Bloodbloom: E at a bloom grows vines to the pack.
  {
    const { mechanics } = await area(page, 6);
    const bloom = of(mechanics, "blood");
    for (let k = 0; k < 4; k++)
      await monster(
        page,
        bloom.x + Math.cos(k) * (70 + k * 12),
        bloom.y + Math.sin(k) * (70 + k * 12),
      );
    await teleport(page, bloom.x - 30, bloom.y);
    await canvas.focus();
    await page.waitForTimeout(150);
    await tap(page, "e");
    await expect
      .poll(async () => (await showcase(page)).restraints.length, { timeout: 5000 })
      .toBeGreaterThan(2);
    await page.waitForTimeout(700);
    await shot(6);
  }
  // 7 Gravity Knots: a real slash knocks the knot away and its cluster travels with it.
  {
    const { mechanics } = await area(page, 7);
    const knot = of(mechanics, "gravity");
    for (let k = 0; k < 3; k++)
      await monster(page, knot.x + 60 * Math.cos(k * 2), knot.y + 60 * Math.sin(k * 2), {
        rig: "crawler",
      });
    const stone = await body(page, "prop-stone-7-gravity-0-0");
    await teleport(page, knot.x - 40, knot.y);
    await canvas.focus();
    await page.waitForTimeout(150);
    await slashAt(page, knot.x + 20, knot.y);
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (
                window.fern.command({ op: "actors", action: "reactions" }) as {
                  state: { fields: { id: string; drift?: { x: number } }[] };
                }
              ).state.fields.find((f) => f.id.startsWith("mechanic:") && f.drift)?.drift?.x ?? 0,
          ),
        { timeout: 3000 },
      )
      .toBeGreaterThan(20);
    await page.waitForTimeout(1800);
    const moved = await body(page, "prop-stone-7-gravity-0-0");
    expect(moved.x - stone.x).toBeGreaterThan(20);
    await shot(7);
  }
  // 8 Riftstep: E at the first arch carries its freight through to the partner arch.
  {
    const { mechanics } = await area(page, 8);
    const arch = mechanics.filter((m) => m.kind === "rift")[0] as (typeof mechanics)[number],
      before = await body(page, "prop-crate-8-rift-0-0");
    await teleport(page, arch.x - 20, arch.y);
    await canvas.focus();
    await page.waitForTimeout(150);
    await tap(page, "e");
    await expect
      .poll(async () => (await events(page)).some((e) => e.text === "freight:carried"), {
        timeout: 4000,
      })
      .toBe(true);
    const after = await body(page, "prop-crate-8-rift-0-0");
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(150);
    await page.waitForTimeout(150);
    await shot(8);
  }
  expect(errors).toEqual([]);
});

test("desktop: the Bloom Tyrant telegraphs its lash down a locked line; a real dash tears free and exposes it", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => !!window.fern);
  await page.evaluate(() => window.fern.display.enterGame(false));
  const { recipe } = await area(page, 6, 1.6);
  const canvas = page.locator("#world-canvas");
  await teleport(page, recipe.x - 110, recipe.y);
  const boss = await monster(page, recipe.x, recipe.y, {
    rig: "crawler",
    boss: true,
    passive: false,
    hp: 100000,
  });
  await canvas.focus();
  // The signature now (QA), at the traveler: the telegraph locks the line for 64 ticks.
  await page.evaluate(
    (id) => window.fern.command({ op: "actors", action: "warden", id }),
    boss.body,
  );
  await expect
    .poll(async () => (await showcase(page)).living[0]?.warden.move, { timeout: 2000 })
    .toBe("lash");
  await canvas.screenshot({ path: "artifacts/physics-m10-warden-telegraph.png" });
  await expect
    .poll(async () => (await showcase(page)).restraints.filter((r) => r.kind === "lash").length, {
      timeout: 6000,
    })
    .toBe(1);
  await page.waitForTimeout(200);
  await canvas.screenshot({ path: "artifacts/physics-m10-warden-lash.png" });
  await page.keyboard.down("a");
  await tap(page, "Shift", 120);
  await page.keyboard.up("a");
  await expect
    .poll(async () => (await showcase(page)).living[0]?.warden.exposedBy, { timeout: 4000 })
    .toBe("lash");
  await canvas.screenshot({ path: "artifacts/physics-m10-warden-exposed.png" });
  expect(errors).toEqual([]);
});
