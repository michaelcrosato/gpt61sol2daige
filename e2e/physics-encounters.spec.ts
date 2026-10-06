import { expect, type Page, test } from "@playwright/test";

// M11 generated encounters through real keyboard and mouse input. Captures are written to
// artifacts/physics-m11-*.png (the selected ones are kept in docs/evidence).

type Pose = { id: string; x: number; y: number; angle: number; vx: number; vy: number };
type Cluster = { combo: string; region: string; heading: number; x: number; y: number };
type Manifest = {
  realized: {
    index: number;
    clusters: Cluster[];
    boss: { title: string; rig: string; pieces: number };
  };
  mutations?: { destroyed: { id: string; cause: string }[] };
};
const body = (page: Page, id: string) =>
  page.evaluate((id) => window.fern.command({ op: "actors", action: "body", id }) as Pose, id);
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
  try {
    while (Date.now() < end) {
      const p = await page.evaluate(() => window.fern.observe().players[0]);
      const dx = x - p.x,
        dy = y - p.y;
      if (Math.hypot(dx, dy) <= near) return true;
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
/**
 * The first generated area (seed 142) whose encounter realized a combination, entered with its
 * wave sent away (QA): returns its live manifest and the cluster's index.
 */
async function generated(page: Page, combo: string, zoom = 2) {
  return page.evaluate(
    ([combo, zoom]) => {
      const f = window.fern;
      f.pause(true);
      f.command({ op: "reset", seed: 142, count: 0 });
      let index = 9;
      for (; index < 40; index++) {
        const m = f.command({ op: "encounters", action: "preview", seed: 142, index }) as {
          realized: { clusters: { combo: string }[] };
        };
        if (m.realized.clusters.some((c) => c.combo === combo)) break;
      }
      f.command({ op: "encounter", index });
      f.command({ op: "step", ticks: 1 });
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
      f.command({ op: "step", ticks: 2 });
      f.zoom(zoom);
      f.pause(false);
      const live = f.command({ op: "encounters", action: "export" }) as {
        realized: { index: number; clusters: { combo: string; region: string }[] };
      };
      // Piece ids carry the planned cluster number (the region's last part).
      const found = live.realized.clusters.find((c) => c.combo === combo);
      const k = found ? Number(found.region.split("-")[2]) : -1;
      return { index, k, recipe: s.recipe, manifest: live };
    },
    [combo, zoom] as const,
  );
}
const exported = (page: Page) =>
  page.evaluate(() => window.fern.command({ op: "encounters", action: "export" }) as Manifest);

test("desktop: a generated area's Burning palisade by real input — V grabs the oil jar, walking it into the coals bursts it alight and the fire runs the fuse into the stockade", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => !!window.fern);
  const g = await generated(page, "fire-stockade");
  expect(g.k).toBeGreaterThanOrEqual(0);
  const piece = (n: number, family: string, tag: string) =>
    `prop-${family}-${g.index}-c${g.k}-${n}-${tag}`;
  const jarId = piece(0, "jar", "0"),
    brazier = await body(page, piece(0, "brazier", "0")),
    jar = await body(page, jarId),
    front = piece(2, "barricade", "front");
  // The cluster's ring and label read on the ground.
  await page.evaluate(([x, y]) => window.fern.command({ op: "teleport", x, y }), [
    jar.x - 14,
    jar.y,
  ] as const);
  await page.waitForTimeout(500);
  const canvas = page.locator("#world-canvas");
  await canvas.screenshot({ path: "artifacts/physics-m11-cluster.png" });
  await walkTo(page, jar.x - 12, jar.y, 10);
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
    .toEqual([jarId]);
  // Aim at the brazier and keep walking the held jar into its coals (as the M08 yard does)
  // until the heat lights it and it bursts into a burning slick.
  const reactionTexts = () =>
    page.evaluate(() =>
      (
        window.fern.command({ op: "actors", action: "reactions" }) as {
          state: { history: { text: string }[] };
        }
      ).state.history.map((e) => e.text),
    );
  // Step the jar toward the coals in short key pulses, then stand still while their heat builds,
  // as a player would. Holding the keys between samples (a page round trip can take 0.4 s while
  // the page renders) overshoots at walking speed, circles the coals and swings the held jar
  // through the fuse, smashing brushes before any fire comes.
  const box = (await canvas.boundingBox())!;
  const state = () =>
    page.evaluate(
      ([id, bx, by]) => {
        const f = window.fern,
          o = f.observe(),
          p = o.players[0];
        let at: { x: number; y: number } | null = null;
        try {
          at = f.command({ op: "actors", action: "body", id }) as { x: number; y: number };
        } catch {}
        return {
          hero: { x: p.x, y: p.y },
          jar: at && { x: at.x, y: at.y, touch: Math.hypot(at.x - bx, at.y - by) },
          view: { cx: o.render.cameraX, cy: o.render.cameraY, zoom: o.render.zoom },
          holding: (
            f.command({ op: "actors", action: "inspect" }) as {
              combat: { holds: { id: string }[] };
            }
          ).combat.holds.some((h) => h.id === id),
          flare: (
            f.command({ op: "actors", action: "reactions" }) as {
              state: { history: { text: string }[] };
            }
          ).state.history.some((e) => e.text === "flare"),
        };
      },
      [jarId, brazier.x, brazier.y] as const,
    );
  const held = new Set<string>();
  const press = async (want: Set<string>) => {
    for (const key of [...held])
      if (!want.has(key)) {
        await page.keyboard.up(key);
        held.delete(key);
      }
    for (const key of want)
      if (!held.has(key)) {
        await page.keyboard.down(key);
        held.add(key);
      }
  };
  const end = Date.now() + 25_000;
  // When a fixed obstacle stops the traveler, step around it at 45° for a moment.
  let last = { x: 0, y: 0, t: Date.now() },
    side = false;
  try {
    for (let s = await state(); Date.now() < end && !s.flare; s = await state()) {
      // Gone: it burst against the coals and its slick flares there.
      if (!s.jar) break;
      // A bump can knock the jar loose: pick it up again, as a player would.
      if (!s.holding) {
        await press(new Set());
        await walkTo(page, s.jar.x - 12, s.jar.y, 10);
        await page.keyboard.press("v");
        await page.waitForTimeout(100);
        continue;
      }
      await page.mouse.move(
        box.x + box.width / 2 + (brazier.x - s.view.cx) * s.view.zoom,
        box.y + box.height / 2 + (brazier.y - s.view.cy) * s.view.zoom,
      );
      const want = new Set<string>();
      // Brazier radius 8 + jar radius 6.5 + 4.5: within the coals' heat reach (6) edge to edge.
      if (s.jar.touch > 19) {
        const p = s.hero;
        if (Math.hypot(p.x - last.x, p.y - last.y) > 3) last = { x: p.x, y: p.y, t: Date.now() };
        else if (Date.now() - last.t > 700) {
          side = !side;
          last = { x: p.x, y: p.y, t: Date.now() };
        }
        let dx = brazier.x - p.x,
          dy = brazier.y - p.y;
        if (side && Math.hypot(dx, dy) > 40) [dx, dy] = [dx - dy, dy + dx];
        if (dx > 3) want.add("d");
        if (dx < -3) want.add("a");
        if (dy > 3) want.add("s");
        if (dy < -3) want.add("w");
      }
      if (want.size) {
        await press(want);
        await page.waitForTimeout(90);
        await press(new Set());
      }
      await page.waitForTimeout(60);
    }
  } finally {
    await press(new Set());
  }
  if (!(await reactionTexts()).includes("flare")) {
    await page.screenshot({ path: "artifacts/physics-m11-palisade-noflare.png" });
    console.log(
      "palisade: no flare",
      JSON.stringify(
        await page.evaluate(
          ([id, bx, by]) => {
            const f = window.fern,
              p = f.observe().players[0];
            let j: unknown = null;
            try {
              const b = f.command({ op: "actors", action: "body", id }) as { x: number; y: number };
              j = [Math.round(b.x), Math.round(b.y)];
            } catch {}
            return {
              hero: [Math.round(p.x), Math.round(p.y), Math.round(p.vx), Math.round(p.vy)],
              jar: j,
              brazier: [Math.round(bx), Math.round(by)],
              holds: (
                f.command({ op: "actors", action: "inspect" }) as {
                  combat: { holds: { id: string }[] };
                }
              ).combat.holds.map((h) => h.id),
            };
          },
          [jarId, brazier.x, brazier.y] as const,
        ),
      ),
    );
  }
  await expect
    .poll(reactionTexts, { timeout: 5000 })
    .toEqual(expect.arrayContaining(["heat", "flare"]));
  // Step back out of the burning slick and watch the fire run the fuse.
  await walkTo(page, jar.x - 60, jar.y, 12, 6000);
  // The jar bursts into a burning slick, the fuse burns and the weakened stockade burns through.
  await expect
    .poll(
      async () =>
        ((await exported(page)).mutations?.destroyed ?? []).filter((d) => d.id === front).length,
      { timeout: 60_000, intervals: [500] },
    )
    .toBe(1);
  const rules = await page.evaluate(
    () =>
      [
        ...new Set(
          (
            window.fern.command({ op: "actors", action: "reactions" }) as {
              state: { chains: { owner: string; rules: string[] }[] };
            }
          ).state.chains
            .filter((c) => c.owner === "local")
            .flatMap((c) => c.rules),
        ),
      ] as string[],
  );
  for (const rule of ["ignite", "spread"]) expect(rules).toContain(rule);
  await canvas.screenshot({ path: "artifacts/physics-m11-palisade.png" });
  expect(errors).toEqual([]);
});

test("desktop: a composed warden wears tethered armor that real slashes strip, and its HUD names it", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => !!window.fern);
  const g = await generated(page, "storm-pool");
  const warden = await page.evaluate(
    ([x, y]) => {
      const f = window.fern;
      f.command({
        op: "adventure",
        action: { type: "tuning", values: { playerDamage: 6, playerHealth: 4 } },
      });
      const plan = f.command({ op: "encounters", action: "export" }) as {
        realized: { boss: { rig: string; pieces: number; title: string } };
      };
      const e = f.command({
        op: "actors",
        action: "monster",
        rig: plan.realized.boss.rig,
        x: x + 130,
        y,
        hp: 20000,
        passive: true,
        boss: true,
      }) as { id: number };
      f.command({ op: "teleport", x: x + 70, y });
      return { id: e.id, ...plan.realized.boss };
    },
    [g.recipe.x, g.recipe.y] as const,
  );
  const mounts = () =>
    page.evaluate(
      (id) =>
        (
          window.fern.command({ op: "actors", action: "showcase" }) as {
            restraints: { kind: string; anchor: string; body: string }[];
          }
        ).restraints.filter((r) => r.kind === "mount" && r.anchor === `enemy-${id}`).length,
      warden.id,
    );
  await expect.poll(mounts).toBe(warden.pieces);
  // The player's first click dismisses the run's welcome card, which would cover the arena.
  await page.getByRole("button", { name: "Begin the hunt", exact: true }).click();
  await expect(page.locator("#welcome")).toBeHidden();
  await expect(page.locator("#boss-name")).toHaveText(warden.title);
  await expect(page.locator("#boss-phase")).toContainText(`ARMORED ×${warden.pieces}`);
  const canvas = page.locator("#world-canvas");
  await canvas.screenshot({ path: "artifacts/physics-m11-warden.png" });
  // Real slashes at the warden's armor: pieces break or tear loose until the warden is bare.
  const deadline = Date.now() + 60_000;
  await canvas.focus();
  while ((await mounts()) === warden.pieces && Date.now() < deadline) {
    const pieces = await page.evaluate(
      (id) =>
        (
          window.fern.command({ op: "actors", action: "showcase" }) as {
            restraints: { kind: string; anchor: string; body: string }[];
          }
        ).restraints
          .filter((r) => r.kind === "mount" && r.anchor === `enemy-${id}`)
          .map((r) => r.body),
      warden.id,
    );
    if (!pieces.length) break;
    const p = await body(page, pieces[0]);
    await walkTo(page, p.x - 16, p.y, 10, 4000);
    const aim = await screen(page, p.x, p.y);
    await page.mouse.move(aim.x, aim.y);
    await page.mouse.down();
    await page.waitForTimeout(400);
    await page.mouse.up();
  }
  expect(await mounts()).toBeLessThan(warden.pieces);
  await canvas.screenshot({ path: "artifacts/physics-m11-warden-stripped.png" });
  expect(errors).toEqual([]);
});
