import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

// M12 showcase route in the browser: plays examples/showcase.json with real keys, mouse and
// World physics panel clicks, and captures each beat (artifacts/showcase-<beat>.png).
// SHOWCASE_VIDEO=1 also records the run (artifacts/showcase-video/) with a caption per beat.
// tools/showcase.ts plays the same recipe headless.

type Target = string | [number, number];
type Step = Record<string, unknown>;
type Expectation = Record<string, unknown>;
interface Beat {
  id: string;
  title: string;
  say: string;
  at?: [number, number];
  steps: Step[];
  expect: Expectation[];
}
const recipe = JSON.parse(readFileSync("examples/showcase.json", "utf8")) as {
  seed: number;
  area: number;
  zoom?: number;
  setup: (Record<string, unknown> & { as?: string })[];
  beats: Beat[];
};
const vars = new Map<string, string>();
/** The current beat's staging spot. */
let stage: [number, number] | null = null;
/** Staging: place the traveler on a spot and wait until it has settled there. */
async function place(page: Page, [x, y]: [number, number]) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.evaluate(
      ([x, y]) => {
        window.fern.pause(true);
        window.fern.command({ op: "teleport", x, y });
        window.fern.pause(false);
      },
      [x, y] as const,
    );
    await waitTicks(page, 4);
    const p = await hero(page);
    if (Math.hypot(p.x - x, p.y - y) <= 4) return;
  }
}
const tick = (page: Page) => page.evaluate(() => window.fern.observe().tick);
async function waitTicks(page: Page, ticks: number) {
  const start = await tick(page);
  await expect.poll(() => tick(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(start + ticks);
}
/** A body's or a `$var` monster's position (its remains once it has fallen), or a point. */
async function where(page: Page, target: Target): Promise<{ x: number; y: number } | null> {
  if (Array.isArray(target)) return { x: target[0], y: target[1] };
  const id = vars.get(target) ?? target;
  return page.evaluate((id) => {
    const f = window.fern;
    if (id.startsWith("enemy-")) {
      const e = f.game.observe().enemies.find((en) => `enemy-${en.id}` === id && en.hp > 0);
      if (e) return { x: e.x, y: e.y };
      const m = f.command({ op: "actors", action: "mechanisms" }) as {
        assemblies: { id: string; members: string[] }[];
      };
      const remains = m.assemblies.find((a) => a.id === `remains-${id.slice(6)}`);
      if (!remains) return null;
      return f.command({ op: "actors", action: "body", id: remains.members[0] }) as {
        x: number;
        y: number;
      };
    }
    try {
      return f.command({ op: "actors", action: "body", id }) as { x: number; y: number };
    } catch {
      return null;
    }
  }, id);
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
const hero = (page: Page) =>
  page.evaluate(() => {
    const p = window.fern.observe().players[0];
    return { x: p.x, y: p.y };
  });
const held = (page: Page) =>
  page.evaluate(
    () =>
      (
        window.fern.command({ op: "actors", action: "inspect" }) as {
          combat: { holds: { id: string; player: string }[] };
        }
      ).combat.holds.find((h) => h.player === "local")?.id ?? null,
  );
const destroyed = (page: Page, id: string) =>
  page.evaluate(
    (id) =>
      (
        window.fern.command({ op: "actors", action: "props" }) as { destroyed: { id: string }[] }
      ).destroyed.some((d) => d.id === id),
    id,
  );
/** Hold WASD toward a point until within `near` (or `until` holds), re-reading positions. */
async function steer(
  page: Page,
  to: () => Promise<{ x: number; y: number } | null>,
  near: number,
  timeout: number,
  until?: () => Promise<boolean>,
) {
  const keys = new Set<string>();
  const set = async (key: string, on: boolean) => {
    if (on && !keys.has(key)) await page.keyboard.down(key);
    if (!on && keys.has(key)) await page.keyboard.up(key);
    if (on) keys.add(key);
    else keys.delete(key);
  };
  const end = Date.now() + timeout;
  try {
    while (Date.now() < end) {
      if (until && (await until())) break;
      const p = await hero(page),
        t = await to();
      if (!t) break;
      const dx = t.x - p.x,
        dy = t.y - p.y;
      if (!until && Math.hypot(dx, dy) <= near) break;
      const aim = await screen(page, t.x, t.y);
      await page.mouse.move(aim.x, aim.y);
      await set("d", dx > 3);
      await set("a", dx < -3);
      await set("s", dy > 3);
      await set("w", dy < -3);
      await page.waitForTimeout(40);
    }
  } finally {
    for (const key of [...keys]) await set(key, false);
  }
}
async function step(page: Page, s: Step) {
  if ("walk" in s) {
    const [dx, dy] = (s.offset as [number, number]) ?? [0, 0];
    await steer(
      page,
      async () => {
        const t = await where(page, s.walk as Target);
        return t ? { x: t.x + dx, y: t.y + dy } : null;
      },
      (s.near as number) ?? 10,
      20_000,
    );
  } else if ("slash" in s) {
    const id = String(s.slash);
    const end = (await tick(page)) + (s.ticks as number);
    while ((await tick(page)) < end) {
      if (s.until === "destroyed" && (await destroyed(page, id))) break;
      const t = await where(page, s.slash as Target);
      if (!t) break;
      // Follow a target the blows push away, so it stays within reach.
      const p = await hero(page);
      if (Math.hypot(t.x - p.x, t.y - p.y) > 26)
        await steer(page, () => where(page, s.slash as Target), 22, 3000);
      const aim = await screen(page, t.x, t.y);
      await page.mouse.move(aim.x, aim.y);
      await page.mouse.down();
      await page.waitForTimeout(90);
      await page.mouse.up();
      await page.waitForTimeout(60);
    }
  } else if ("grab" in s) {
    // V takes the nearest loose prop. If something else lies nearer, set it down, retry.
    for (let attempt = 0; attempt < 4; attempt++) {
      await page.keyboard.press("v");
      await expect.poll(() => held(page)).not.toBeNull();
      if ((await held(page)) === s.grab) break;
      await page.keyboard.press("v");
      await expect.poll(() => held(page)).toBeNull();
      // Back to the beat's spot (staging), where the intended prop is the nearest.
      if (stage) await place(page, stage);
      else await steer(page, () => where(page, s.grab as string), 6, 3000);
    }
    const scene = await page.evaluate((id) => {
      const f = window.fern,
        p = f.observe().players[0];
      const props = (
        f.command({ op: "actors", action: "props" }) as {
          props: { id: string; x: number; y: number }[];
        }
      ).props
        .map((b) => ({ id: b.id, d: Math.round(Math.hypot(b.x - p.x, b.y - p.y)) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 5);
      return {
        hero: [Math.round(p.x), Math.round(p.y)],
        target: props.find((b) => b.id === id) ?? null,
        near: props,
      };
    }, s.grab as string);
    await expect.poll(() => held(page), { message: JSON.stringify(scene) }).toBe(s.grab);
  } else if ("drag" in s) {
    const [x, y] = s.drag as [number, number];
    const key = y < 0 ? "w" : y > 0 ? "s" : x < 0 ? "a" : "d";
    await page.keyboard.down(key);
    await waitTicks(page, s.ticks as number);
    await page.keyboard.up(key);
  } else if ("carry" in s && s.until !== "burning") {
    // A short turn toward the target: keys held for exactly `ticks` simulation ticks.
    const t = (await where(page, s.carry as Target))!,
      p = await hero(page);
    const aim = await screen(page, t.x, t.y);
    await page.mouse.move(aim.x, aim.y);
    const keys = [
      ...(t.x - p.x > 3 ? ["d"] : t.x - p.x < -3 ? ["a"] : []),
      ...(t.y - p.y > 3 ? ["s"] : t.y - p.y < -3 ? ["w"] : []),
    ];
    const start = await tick(page);
    for (const key of keys) await page.keyboard.down(key);
    await page.waitForFunction(
      (end) => window.fern.observe().tick >= end,
      start + (s.ticks as number),
      {
        polling: "raf",
      },
    );
    for (const key of keys) await page.keyboard.up(key);
  } else if ("carry" in s) {
    const start = await tick(page);
    const target = s.carry as Target;
    await steer(
      page,
      () => where(page, target),
      0,
      15_000,
      async () => {
        if ((await tick(page)) >= start + (s.ticks as number)) return true;
        if (s.until !== "burning") return false;
        const id = await held(page);
        return page.evaluate((id) => {
          if (!id) return true;
          const b = window.fern.command({ op: "actors", action: "body", id }) as {
            reaction: { burning: number } | null;
          };
          return (b.reaction?.burning ?? 0) > 0;
        }, id);
      },
    );
  } else if ("release" in s) {
    if (await held(page)) await page.keyboard.press("v");
  } else if ("throw" in s) {
    const t = (await where(page, s.throw as Target))!;
    const aim = await screen(page, t.x, t.y);
    await page.mouse.click(aim.x, aim.y);
    await expect.poll(() => held(page)).toBeNull();
  } else if ("whorl" in s) {
    await page.keyboard.press("q");
  } else if ("wait" in s) {
    await waitTicks(page, s.wait as number);
  } else if ("region" in s) {
    await page.keyboard.press("o");
    const panel = page.locator("#adventure-dialog.panel-physics");
    await expect(panel).toBeVisible();
    await page.locator('[data-wp="scope"][data-scope="region"]').click();
    await page.locator(`[data-wp="region"][data-id="${s.region}"]`).click();
    if (s.preset) await page.locator(`[data-wp="preset"][data-preset="${s.preset}"]`).click();
    else await page.locator(`[data-wp="reset"][data-to="${s.reset}"]`).click();
    await expect(page.locator(".wp-notice")).toContainText("Applied.");
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  }
}
async function check(page: Page, e: Expectation, since: number) {
  if ("destroyed" in e) return destroyed(page, e.destroyed as string);
  if ("intact" in e) return !(await destroyed(page, e.intact as string));
  if ("dead" in e) {
    const id = vars.get(e.dead as string)!;
    return page.evaluate(
      (id) =>
        !window.fern.game.observe().enemies.some((en) => `enemy-${en.id}` === id && en.hp > 0),
      id,
    );
  }
  if ("remains" in e) return (await where(page, e.remains as string)) !== null;
  if ("rules" in e)
    return page.evaluate(
      ([rules, since]) => {
        const chains = (
          window.fern.command({ op: "actors", action: "reactions" }) as {
            state: { chains: { owner: string; tick: number; rules: string[] }[] };
          }
        ).state.chains.filter((c) => c.owner === "local" && c.tick >= since);
        const fired = new Set(chains.flatMap((c) => c.rules));
        return rules.every((r) => fired.has(r));
      },
      [e.rules as string[], since] as const,
    );
  if ("event" in e) {
    const ev = e.event as { type: string; text: string; owner?: string };
    return page.evaluate(
      ([ev, since]) =>
        (
          window.fern.command({ op: "save" }) as {
            adventure: { events: { tick: number; type: string; text: string; owner: string }[] };
          }
        ).adventure.events.some(
          (x) =>
            x.tick >= since &&
            x.type === ev.type &&
            x.text.startsWith(ev.text) &&
            (!ev.owner || x.owner === ev.owner),
        ),
      [ev, since] as const,
    );
  }
  if ("policy" in e) {
    const p = e.policy as { at: string; values: Record<string, unknown> };
    return page.evaluate((p) => {
      const region = (
        window.fern.command({ op: "actors", action: "policies" }) as {
          state: { profiles: { regions: { id: string; shape: { x: number; y: number } }[] } };
        }
      ).state.profiles.regions.find((r) => r.id === p.at)!;
      const effective = (
        window.fern.command({
          op: "actors",
          action: "policy",
          x: region.shape.x,
          y: region.shape.y,
        }) as { effective: Record<string, unknown> }
      ).effective;
      return Object.entries(p.values).every(([k, v]) => effective[k] === v);
    }, p);
  }
  return true; // `moved` is measured headless (tools/showcase.ts); here the capture shows it.
}

test("showcase route: scenery, a launched kill, a mechanism, a material chain, a ragdoll and a regional off/on, by real input", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ...(process.env.SHOWCASE_VIDEO
      ? { recordVideo: { dir: "artifacts/showcase-video", size: { width: 960, height: 600 } } }
      : {}),
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto("/");
    await page.waitForFunction(() => !!window.fern);
    await page.getByRole("button", { name: "Begin the hunt", exact: true }).click();
    await page.evaluate((zoom) => window.fern.zoom(zoom), recipe.zoom ?? 2);
    const results: { id: string; ok: boolean[] }[] = [];
    for (const [n, beat] of recipe.beats.entries()) {
      // Every beat starts from the recipe's clean scene, so one beat never changes the next.
      const ids = await page.evaluate((setup) => {
        const f = window.fern;
        f.pause(true);
        const out: Record<string, string> = {};
        for (const { as, ...command } of setup) {
          const result = f.command(command as never) as { id?: number } | undefined;
          if (as && result?.id !== undefined) out[`$${as}`] = `enemy-${result.id}`;
        }
        f.pause(false);
        return out;
      }, recipe.setup);
      vars.clear();
      for (const [k, v] of Object.entries(ids)) vars.set(k, v);
      // A caption for the capture only (not part of the game).
      await page.evaluate(
        ({ text, say }) => {
          let el = document.getElementById("showcase-caption");
          if (!el) {
            el = document.createElement("div");
            el.id = "showcase-caption";
            el.style.cssText =
              "position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:99;max-width:760px;padding:9px 16px;background:#132219e6;border:1px solid #c9d68f88;border-radius:6px;color:#eef3d6;font:13px 'DM Sans',sans-serif;text-align:center;pointer-events:none";
            document.body.append(el);
          }
          el.innerHTML = `<b style="color:#f4e3a1">${text}</b><br><span style="font-size:11px;color:#c8d8b0">${say}</span>`;
        },
        { text: `${n + 1}/${recipe.beats.length} · ${beat.title}`, say: beat.say },
      );
      stage = beat.at ?? null;
      if (stage) await place(page, stage);
      await waitTicks(page, 2);
      const since = await tick(page);
      const inline: boolean[] = [];
      for (const s of beat.steps) {
        if ("check" in s) {
          for (const e of s.check as Expectation[]) inline.push(await check(page, e, since));
          continue;
        }
        await step(page, s);
      }
      await page.screenshot({ path: `artifacts/showcase-${beat.id}.png` });
      console.log(
        `beat ${beat.id}: events`,
        JSON.stringify(
          await page.evaluate(
            ([since, target]) => {
              const f = window.fern;
              const events = (
                f.command({ op: "save" }) as {
                  adventure: {
                    events: {
                      tick: number;
                      type: string;
                      text: string;
                      amount: number;
                      owner: string;
                    }[];
                  };
                }
              ).adventure.events
                .filter((e) => e.tick >= since && /impact|hit|kill|grab/.test(e.type))
                .map((e) => `${e.tick}:${e.type}:${e.text}:${Math.round(e.amount)}`);
              const e = f.game.observe().enemies.find((en) => `enemy-${en.id}` === target);
              const p = f.observe().players[0];
              return {
                events,
                target: e ? [Math.round(e.x), Math.round(e.y), e.hp] : null,
                hero: [Math.round(p.x), Math.round(p.y)],
              };
            },
            [since, vars.get("$target") ?? ""] as const,
          ),
        ),
      );
      console.log(
        `beat ${beat.id}: destroyed`,
        JSON.stringify(
          await page.evaluate(
            (since) =>
              (
                window.fern.command({ op: "actors", action: "props" }) as {
                  destroyed: { id: string; tick: number; cause: string }[];
                }
              ).destroyed
                .filter((d) => d.tick >= since)
                .map((d) => `${d.id}:${d.cause}`),
            since,
          ),
        ),
      );
      const ok = [...inline];
      for (const e of beat.expect) ok.push(await check(page, e, since));
      results.push({ id: beat.id, ok });
    }
    expect(results.filter((r) => r.ok.includes(false))).toEqual([]);
    expect(results.map((r) => r.id)).toEqual(recipe.beats.map((b) => b.id));
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
