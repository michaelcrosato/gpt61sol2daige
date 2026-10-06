import { expect, type Page, test } from "@playwright/test";
import type { RigKind } from "../src/game/content.ts";

// FERN_VIDEO=1 records the desktop scenario: its video is the moving capture of all six rigs
// (docs/evidence/physics-m09-rigs.webm). Recording needs Playwright's ffmpeg (`npx playwright
// install ffmpeg`); without the variable the scenarios run unrecorded against any Chrome.
if (process.env.FERN_VIDEO) test.use({ video: { mode: "on", size: { width: 960, height: 660 } } });

interface Remains {
  enemy: number;
  rig: RigKind;
  fall: number;
  born: number;
  bodies: { id: string; x: number; y: number; frozen: boolean; part?: string; loose: boolean }[];
}
interface Living {
  id: number;
  rig: RigKind;
  hp: number;
  phase: string;
  reaction: { lean: number; leanRate: number; staggerUntil: number; toppleUntil: number };
}
const rigs = (page: Page) =>
  page.evaluate(
    () =>
      window.fern.command({ op: "actors", action: "rigs" }) as {
        living: Living[];
        remains: Remains[];
        townsfolk: { x: number; y: number; pushX: number }[];
      },
  );
const remainsOf = async (page: Page, enemy: number) =>
  (await rigs(page)).remains.find((r) => r.enemy === enemy);
/** Centre of a ragdoll's jointed bodies (loose armor is a separate prop). */
const centre = (r: Remains) => {
  const jointed = r.bodies.filter((b) => !b.loose);
  return {
    x: jointed.reduce((sum, b) => sum + b.x, 0) / jointed.length,
    y: jointed.reduce((sum, b) => sum + b.y, 0) / jointed.length,
  };
};
/** Every rig event still in the run's event ring (not only the latest observation). */
const rigEvents = (page: Page) =>
  page.evaluate(() =>
    (
      window.fern.command({ op: "save" }) as {
        adventure: { events: { type: string; text: string }[] };
      }
    ).adventure.events
      .filter((e) => e.type === "rig")
      .map((e) => e.text),
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
/**
 * Real input until a monster dies: the mouse stays on the monster with the button held (slash
 * combo), and the traveler steps toward it with WASD whenever blows have driven it out of reach.
 */
async function fight(page: Page, id: number, timeout = 20000) {
  const held = new Set<string>();
  const hold = async (key: string, on: boolean) => {
    if (on && !held.has(key)) await page.keyboard.down(key);
    if (!on && held.has(key)) await page.keyboard.up(key);
    if (on) held.add(key);
    else held.delete(key);
  };
  const end = Date.now() + timeout;
  let pressed = false;
  try {
    while (Date.now() < end) {
      if (await remainsOf(page, id)) return;
      const at = await page.evaluate((id) => {
        const f = window.fern;
        const p = f.observe().players[0];
        const e = (
          f.command({ op: "actors", action: "rigs" }) as { living: { id: number; hp: number }[] }
        ).living.find((l) => l.id === id);
        if (!e || e.hp <= 0) return null;
        try {
          const body = f.command({ op: "actors", action: "body", id: `enemy-${id}` }) as {
            x: number;
            y: number;
          };
          return { px: p.x, py: p.y, x: body.x, y: body.y };
        } catch {
          return null; // Retired between the two reads: it just died.
        }
      }, id);
      if (at) {
        const aim = await screen(page, at.x, at.y - 8);
        await page.mouse.move(aim.x, aim.y);
        if (!pressed) {
          await page.mouse.down();
          pressed = true;
        }
        const dx = at.x - at.px,
          dy = at.y - at.py;
        // Navigation only (QA): if blows drove the body behind scenery, stand beside it again.
        if (Math.hypot(dx, dy) > 60)
          await page.evaluate(([x, y]) => window.fern.command({ op: "teleport", x: x - 22, y }), [
            at.x,
            at.y,
          ] as const);
        await hold("d", dx > 26);
        await hold("a", dx < -26);
        await hold("s", dy > 14);
        await hold("w", dy < -14);
      }
      await page.waitForTimeout(100);
    }
  } finally {
    if (pressed) await page.mouse.up();
    for (const key of [...held]) await page.keyboard.up(key);
  }
}
/**
 * Area 1, the traveler beside one planted monster of a rig (other monsters leave): east of them
 * by default, or west (`side` -1), where blows drive it into open ground. M10 authored a calm
 * region north-east of the trailhead, and a body that comes to rest inside it is frozen by
 * design (calm values turn ragdolls off).
 */
async function arena(page: Page, rig: RigKind, hp: number, zoom = 2.4, side = 1) {
  return page.evaluate(
    ([rig, hp, zoom, side]) => {
      const f = window.fern;
      f.pause(true);
      f.command({ op: "reset", seed: 142, count: 0 });
      f.command({ op: "encounter", index: 1 });
      f.command({ op: "step", ticks: 1 });
      f.zoom(zoom as number);
      const p = f.command({ op: "actors", action: "body", id: "player-local" }) as {
        x: number;
        y: number;
      };
      const m = f.command({
        op: "actors",
        action: "monster",
        rig,
        x: p.x + 26 * (side as number),
        y: p.y,
        hp,
        passive: true,
        clear: true,
      }) as { id: number };
      f.command({ op: "step", ticks: 2 });
      f.pause(false);
      return { id: m.id, x: p.x + 26 * (side as number), y: p.y };
    },
    [rig, hp, zoom, side] as const,
  );
}

test("desktop: real slashes recoil, stagger and fell all six rigs into ragdolls; Whorl throws one; ragdolls off settles it", async ({
  page,
}) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => !!window.fern);
  await page.evaluate(() => window.fern.display.enterGame(false));
  const canvas = page.locator("#world-canvas");
  const styles: Record<RigKind, (r: Remains) => boolean> = {
    stalker: (r) => Math.abs(Math.abs(r.fall) - Math.PI / 2) < 0.5,
    brute: (r) => Math.abs(Math.abs(r.fall) - Math.PI / 2) < 0.5,
    warden: (r) => Math.abs(Math.abs(r.fall) - Math.PI / 2) < 0.5,
    crawler: (r) => Math.abs(Math.abs(r.fall) - Math.PI) < 0.4,
    wraith: (r) => Math.abs(r.fall) < 1.1,
    totem: (r) => r.bodies.some((b) => b.part === "roots"),
  };
  let last: Remains | undefined;
  for (const rig of ["stalker", "crawler", "brute", "wraith", "totem", "warden"] as const) {
    const m = await arena(page, rig, 110, 2.4, -1);
    await canvas.focus();
    const aim = await screen(page, m.x + 4, m.y - 8);
    await page.mouse.move(aim.x, aim.y);
    // One real slash: the rig recoils away from it.
    await page.mouse.down();
    await page.waitForTimeout(70);
    await page.mouse.up();
    await expect
      .poll(
        async () => {
          const e = (await rigs(page)).living.find((l) => l.id === m.id);
          return e ? Math.abs(e.reaction.lean) + Math.abs(e.reaction.leanRate) : 0;
        },
        { timeout: 4000 },
      )
      .toBeGreaterThan(0.01);
    await canvas.screenshot({ path: `artifacts/physics-m09-${rig}-hit.png` });
    // Held slashes, aimed at the body and stepping after it as blows drive it back, until it dies.
    await fight(page, m.id);
    for (const [i, wait] of [0, 120, 260, 600].entries()) {
      await page.waitForTimeout(wait);
      await canvas.screenshot({ path: `artifacts/physics-m09-${rig}-death-${i}.png` });
    }
    const remains = (await remainsOf(page, m.id))!;
    expect(remains.rig).toBe(rig);
    expect(styles[rig](remains), `${rig} falls in its own way`).toBe(true);
    expect(remains.bodies.length).toBeGreaterThan(3);
    await expect
      .poll(async () => (await rigEvents(page)).some((t) => t.startsWith(`fall:${rig}:`)))
      .toBe(true);
    last = remains;
  }
  // Whorl (real key) throws the last body across the grass.
  const before = centre(last!);
  await page.evaluate(([x, y]) => window.fern.command({ op: "teleport", x: x - 22, y }), [
    before.x,
    before.y,
  ] as const);
  await page.waitForTimeout(200);
  await page.keyboard.down("q");
  await page.waitForTimeout(120);
  await page.keyboard.up("q");
  await expect
    .poll(async () => {
      const r = (await remainsOf(page, last!.enemy))!;
      const c = centre(r);
      return Math.hypot(c.x - before.x, c.y - before.y);
    })
    .toBeGreaterThan(15);
  await canvas.screenshot({ path: "artifacts/physics-m09-whorl.png" });
  // Ragdolls off through the Agent lab controls: the body settles where it lies.
  await page.evaluate(() => {
    window.fern.display.exitGame();
    window.fern.pause(true);
    window.fern.view("lab");
  });
  await page.getByLabel("Physics scene", { exact: true }).selectOption("adventure");
  await page.getByLabel("Physics policy scope", { exact: true }).selectOption("land");
  await page.getByLabel("Physical ragdolls override", { exact: true }).selectOption("false");
  await page.locator("#physics-queue").click();
  await page.locator("#physics-apply").click();
  await page.evaluate(() => {
    window.fern.view("world");
    window.fern.pause(false);
  });
  await expect
    .poll(async () =>
      (await remainsOf(page, last!.enemy))!.bodies.filter((b) => !b.loose).every((b) => b.frozen),
    )
    .toBe(true);
  const settled = centre((await remainsOf(page, last!.enemy))!);
  await page.evaluate(([x, y]) => window.fern.command({ op: "teleport", x: x - 22, y }), [
    settled.x,
    settled.y,
  ] as const);
  await page.waitForTimeout(200);
  await page.keyboard.down("q");
  await page.waitForTimeout(120);
  await page.keyboard.up("q");
  await page.waitForTimeout(600);
  const still = centre((await remainsOf(page, last!.enemy))!);
  expect(Math.hypot(still.x - settled.x, still.y - settled.y)).toBeLessThan(0.001);
  await canvas.screenshot({ path: "artifacts/physics-m09-settled.png" });
  // A page save/restore keeps every body dead and every reward single.
  const facts = await page.evaluate(() => {
    const before = window.fern.game.observe();
    const state = window.fern.command({ op: "save" });
    window.fern.command({ op: "restore", state: JSON.parse(JSON.stringify(state)) });
    window.fern.command({ op: "step", ticks: 120 });
    const after = window.fern.game.observe();
    return { before: before.hero!.kills, after: after.hero!.kills };
  });
  expect(facts.after).toBe(facts.before);
  expect(
    (await remainsOf(page, last!.enemy))!.bodies.filter((b) => !b.loose).every((b) => b.frozen),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.close();
  await page.video()?.saveAs("artifacts/physics-m09-rigs.webm");
});

test("touch: the Slash button fells a stalker the same way, townsfolk are shoved and recover, and feedback preferences stay local", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(120000);
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
    // Town: walk into Rowan with the touch pad; Rowan staggers back and the shop stays open.
    const home = await page.evaluate(() => {
      window.fern.command({ op: "reset", seed: 142, count: 0 });
      window.fern.command({ op: "step", ticks: 2 });
      const rowan = (
        window.fern.command({ op: "actors", action: "rigs" }) as {
          townsfolk: { x: number; y: number }[];
        }
      ).townsfolk[0];
      window.fern.command({ op: "teleport", x: rowan.x - 26, y: rowan.y });
      return rowan;
    });
    const east = (await page
      .getByRole("button", { name: "Move east", exact: true })
      .boundingBox())!;
    await page.mouse.move(east.x + east.width / 2, east.y + east.height / 2);
    await page.mouse.down();
    await expect
      .poll(async () => (await rigs(page)).townsfolk[0].x - home.x, { timeout: 6000 })
      .toBeGreaterThan(6);
    await page.screenshot({ path: "artifacts/physics-m09-town-shove.png" });
    await page.mouse.up();
    expect(await rigEvents(page)).toContain("npc:bump:rowan");
    await expect
      .poll(
        async () => {
          const r = (await rigs(page)).townsfolk[0];
          return Math.hypot(r.x - home.x, r.y - home.y);
        },
        { timeout: 12000 },
      )
      .toBeLessThan(28);
    // Local preferences: no shake and no flash on this device; the world is unchanged.
    await page.evaluate(() => window.fern.settings.set({ cameraShake: 0, hitFlash: false }));
    expect(await page.evaluate(() => window.fern.settings.get().cameraShake)).toBe(0);
    // The same stalker, felled by the touch Slash button.
    const m = await arena(page, "stalker", 60, 2);
    const slash = page.getByRole("button", { name: "Slash attack", exact: true });
    await expect
      .poll(
        async () => {
          // Navigation only (QA): stand beside the stalker again if blows drove it away.
          await page.evaluate((id) => {
            const f = window.fern;
            const p = f.observe().players[0];
            try {
              const e = f.command({ op: "actors", action: "body", id: `enemy-${id}` }) as {
                x: number;
                y: number;
              };
              if (Math.hypot(e.x - p.x, e.y - p.y) > 40)
                f.command({ op: "teleport", x: e.x - 22, y: e.y });
            } catch {
              // Already fallen.
            }
          }, m.id);
          await slash.tap();
          return !!(await remainsOf(page, m.id));
        },
        { timeout: 15000, intervals: [250] },
      )
      .toBe(true);
    await page.waitForTimeout(500);
    await page.screenshot({ path: "artifacts/physics-m09-touch-stalker.png" });
    const remains = (await remainsOf(page, m.id))!;
    expect(remains.rig).toBe("stalker");
    expect(Math.abs(Math.abs(remains.fall) - Math.PI / 2)).toBeLessThan(0.5);
    const feedback = await page.evaluate(() => window.fern.observe().render.feedback);
    expect(feedback.shake).toBe(0);
    expect(feedback.flash).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("step by step: each rig's recoil, knockdown, recovery, fall and rest are captured frame by frame", async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => !!window.fern);
  await page.evaluate(() => window.fern.display.enterGame(false));
  await page.addStyleTag({
    content: "#pause-label,.area-toast,.game-hud,.game-performance{display:none!important}",
  });
  const step = (ticks: number) =>
    page.evaluate((ticks) => window.fern.command({ op: "step", ticks }), ticks);
  for (const rig of ["stalker", "crawler", "brute", "wraith", "totem", "warden"] as const) {
    const m = await page.evaluate((rig) => {
      const f = window.fern;
      f.pause(true);
      f.command({ op: "reset", seed: 142, count: 0 });
      f.command({ op: "encounter", index: 1 });
      f.command({ op: "step", ticks: 1 });
      f.zoom(2.6);
      const p = f.command({ op: "actors", action: "body", id: "player-local" }) as {
        x: number;
        y: number;
      };
      f.command({ op: "teleport", x: p.x - 30, y: p.y + 40 });
      const m = f.command({
        op: "actors",
        action: "monster",
        rig,
        x: p.x + 10,
        y: p.y + 40,
        hp: 400,
        passive: true,
        clear: true,
      }) as { id: number };
      f.command({ op: "step", ticks: 2 });
      return m;
    }, rig);
    const hit = (damage: number) =>
      page.evaluate(
        ([id, damage]) =>
          window.fern.command({ op: "actors", action: "hit", id: `enemy-${id}`, damage, angle: 0 }),
        [m.id, damage] as const,
      );
    /** Where the monster (or its ragdoll) is, framed on the canvas. */
    const shot = async (name: string) => {
      await page.waitForTimeout(140);
      const at = await page.evaluate((id) => {
        const r = window.fern.command({ op: "actors", action: "rigs" }) as {
          remains: { enemy: number; bodies: { x: number; y: number; loose: boolean }[] }[];
        };
        const rec = r.remains.find((x) => x.enemy === id);
        if (rec) {
          const b = rec.bodies.filter((q) => !q.loose);
          return {
            x: b.reduce((s, q) => s + q.x, 0) / b.length,
            y: Math.max(...b.map((q) => q.y)),
          };
        }
        return window.fern.command({ op: "actors", action: "body", id: `enemy-${id}` }) as {
          x: number;
          y: number;
        };
      }, m.id);
      const p = await screen(page, at.x, at.y);
      await page.screenshot({
        path: `artifacts/physics-m09-steps-${rig}-${name}.png`,
        clip: { x: p.x - 120, y: p.y - 170, width: 240, height: 210 },
      });
    };
    await shot("0-idle");
    await hit(30);
    await step(3);
    await shot("1-hit");
    await step(6);
    await shot("2-recoil");
    for (let i = 0; i < 4; i++) await hit(60);
    await step(12);
    await shot("3-down");
    await step(70);
    await shot("4-recovered");
    await hit(2000);
    await step(1);
    await shot("5-death");
    await step(7);
    await shot("6-falling");
    await step(30);
    await shot("7-landed");
    await step(120);
    await shot("8-rest");
    const remains = (await remainsOf(page, m.id))!;
    expect(remains.rig).toBe(rig);
  }
  expect(errors).toEqual([]);
});
