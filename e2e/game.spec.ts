import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import { type Replay, replay } from "../src/engine/agent.ts";
import type { SaveState } from "../src/engine/simulation.ts";
import { initializePhysics } from "../src/physics/bootstrap.ts";
import { instrumentRtc, rtcDiagnostics } from "./rtc-diagnostics.ts";

test.beforeAll(() => initializePhysics());

test("documentation and generated assets are served from the deployed package", async ({
  request,
}) => {
  for (const [file, title] of [
    ["agent-protocol", "Agent protocol"],
    ["architecture", "Architecture"],
    ["report", "Design report"],
    ["verification", "Verification"],
  ]) {
    const response = await request.get(`/docs/${file}.html`);
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain(`<title>${title} — Fern</title>`);
  }
  expect((await request.get("/docs/docs.css")).status()).toBe(200);
  const manifest = await request.get("/generated/manifest.json");
  expect(manifest.status()).toBe(200);
  const assets = await manifest.json();
  expect(assets.version).toBe(1);
  expect(assets.sprites).toHaveLength(8);
  expect(assets.audio).toHaveLength(10);
});

test("exploration, abilities, atlas, audio, lab commands, saving and deterministic browser replay", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => !!window.fern);
  await expect(page.getByRole("heading", { name: "A quiet town. A hungry wild." })).toBeVisible();
  await page.screenshot({ path: "artifacts/desktop.png" });
  await page.evaluate(() => window.fern.start());
  const start = await page.evaluate(() => window.fern.observe().players[0]);
  await page.keyboard.down("d");
  await expect
    .poll(async () => (await page.evaluate(() => window.fern.observe().players[0])).x)
    .toBeGreaterThan(start.x + 25);
  await page.keyboard.up("d");
  await page.getByRole("button", { name: "Whorl", exact: true }).click();
  await expect
    .poll(async () =>
      (await page.evaluate(() => window.fern.observe())).events.some((e) => e.type === "pulse"),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Dash", exact: true }).click();
  await expect
    .poll(async () =>
      (await page.evaluate(() => window.fern.observe())).events.some((e) => e.type === "dash"),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Enable sound", exact: true }).click();
  await expect(page.getByRole("button", { name: "Disable sound", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Atlas", exact: true }).click();
  await expect(page.getByRole("heading", { name: "The world is wider." })).toBeVisible();
  await page.locator("#atlas-canvas").click({ position: { x: 260, y: 170 } });
  await expect(page.locator("#waypoint-label")).toContainText("Trail marker:");
  await page.screenshot({ path: "artifacts/atlas.png" });
  await page.getByRole("button", { name: "Agent lab", exact: true }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const originalRecording = (await page.evaluate(() => window.fern.recording())) as Replay;
  expect(replay(originalRecording).stateHash()).toBe(originalRecording.hash);
  const tick = await page.evaluate(() => window.fern.observe().tick);
  await page.getByRole("button", { name: "Step 60 ticks", exact: true }).click();
  expect(await page.evaluate(() => window.fern.observe().tick)).toBe(tick + 60);
  await page.locator("#command-input").fill('{"op":"population","count":6000}');
  await page.getByRole("button", { name: "Run command", exact: true }).click();
  expect(await page.evaluate(() => window.fern.observe().population)).toBe(6000);
  await page.getByRole("button", { name: "Save trail", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Trail saved on this device.");
  const saved = await page.evaluate(() => window.fern.observe().hash);
  await page.getByRole("button", { name: "Step 60 ticks", exact: true }).click();
  await page.getByRole("button", { name: "Load trail", exact: true }).click();
  await expect.poll(async () => page.evaluate(() => window.fern.observe().hash)).toBe(saved);
  await page.screenshot({ path: "artifacts/agent-lab.png" });
  const recording = (await page.evaluate(() => window.fern.recording())) as Replay;
  expect(replay(recording).stateHash()).toBe(recording.hash);
  await page.getByRole("button", { name: "World", exact: true }).click();
  await page.evaluate(() => {
    window.fern.zoom(0.18);
    window.fern.pause(false);
  });
  await expect
    .poll(async () => (await page.evaluate(() => window.fern.observe())).render.drawn)
    .toBeGreaterThan(5000);
  await page.screenshot({ path: "artifacts/swarm-6000.png" });
  const telemetry = await page.evaluate(() => window.fern.observe());
  await test.info().attach("6000-creature telemetry", {
    body: JSON.stringify(telemetry, null, 2),
    contentType: "application/json",
  });
  // FPS is informational; entity coverage and real interactions remain acceptance checks.
  expect(errors).toEqual([]);
});

test("mobile layout, touch movement and journal work without horizontal overflow", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.waitForFunction(() => !!window.fern);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "artifacts/mobile.png" });
  await page.evaluate(() => window.fern.start());
  const before = await page.evaluate(() => window.fern.observe().players[0].x);
  const move = await page.getByRole("button", { name: "Move east", exact: true }).boundingBox();
  await page.mouse.move(move!.x + move!.width / 2, move!.y + move!.height / 2);
  await page.mouse.down();
  await expect
    .poll(async () => (await page.evaluate(() => window.fern.observe())).players[0].x)
    .toBeGreaterThan(before + 8);
  await page.mouse.up();
  await page.getByRole("button", { name: "Toggle expedition journal" }).click();
  await expect(page.getByRole("heading", { name: "Roots beneath. Wilds ahead." })).toBeVisible();
  await page.getByRole("button", { name: "Atlas", exact: true }).click();
  await expect(page.getByRole("heading", { name: "The world is wider." })).toBeVisible();
  await page.getByRole("button", { name: "Controls and help" }).click();
  await expect(page.getByRole("heading", { name: "Take the long way." })).toBeVisible();
  expect(errors).toEqual([]);
});

async function traveler(
  browser: Browser,
  baseURL: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 800, height: 640 } });
  const page = await context.newPage();
  await instrumentRtc(page);
  await page.goto(baseURL);
  await page.waitForFunction(() => !!window.fern);
  // Hidden lab avoids eight renderers competing with the network test; simulations still run.
  await page.evaluate(() => {
    window.fern.command({ op: "population", count: 64 });
    window.fern.view("lab");
  });
  return { context, page };
}

test("joining recovers after the first native data channel is interrupted", async ({
  browser,
  baseURL,
}) => {
  const host = await traveler(browser, baseURL!);
  const context = await browser.newContext({ viewport: { width: 800, height: 640 } });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      const create = RTCPeerConnection.prototype.createDataChannel;
      let interrupted = false;
      RTCPeerConnection.prototype.createDataChannel = function (...args) {
        const channel = create.apply(this, args);
        if (args[0] !== "_PEERJSTEST" && !interrupted) {
          interrupted = true;
          queueMicrotask(() => channel.close());
        }
        return channel;
      };
    });
    await page.goto(baseURL!);
    await page.waitForFunction(() => !!window.fern);
    await page.evaluate(() => {
      window.fern.command({ op: "population", count: 64 });
      window.fern.view("lab");
    });
    const room = await host.page.evaluate(() => window.fern.network.host());
    await page.evaluate((code) => window.fern.network.join(code), room);
    await expect
      .poll(async () => (await host.page.evaluate(() => window.fern.observe())).players.length)
      .toBe(2);
    await expect
      .poll(async () => (await page.evaluate(() => window.fern.observe())).network.state)
      .toBe("connected");
  } finally {
    await context.close();
    await host.context.close();
  }
});
test("real WebRTC joins eight clients, syncs builds, combat and world, rejects ninth and releases slots", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(150000);
  const participants: { context: BrowserContext; page: Page }[] = [];
  try {
    const host = await traveler(browser, baseURL!);
    participants.push(host);
    await host.page.evaluate(() => {
      const state = window.fern.command({ op: "save" }) as SaveState;
      state.shards = 9;
      state.players[0].x = state.players[0].px = 960;
      state.players[0].y = state.players[0].py = -720;
      window.fern.command({ op: "restore", state });
    });
    const room = await host.page.evaluate(() => window.fern.network.host());
    for (let i = 0; i < 7; i++) {
      const guest = await traveler(browser, baseURL!);
      participants.push(guest);
      await guest.page.evaluate((code) => window.fern.network.join(code), room);
    }
    await expect
      .poll(async () => (await host.page.evaluate(() => window.fern.observe())).players.length)
      .toBe(8);
    for (const guest of participants.slice(1))
      await expect
        .poll(async () => (await guest.page.evaluate(() => window.fern.observe())).players.length)
        .toBe(8);
    for (const participant of participants.slice(0, 2)) {
      const denied = await participant.page.evaluate(() => {
        try {
          window.fern.command({ op: "physics", action: "reset" });
          return "unexpected success";
        } catch (error) {
          return String(error);
        }
      });
      expect(denied).toMatch(/host|Leave the expedition/);
      expect(await participant.page.evaluate(() => window.fern.observe().playground)).toBeNull();
      await expect(participant.page.locator("#physics-open")).toBeDisabled();
    }
    const guest = participants[1],
      id = await guest.page.evaluate(() => window.fern.network.localId());
    await guest.page.evaluate(() => {
      window.fern.view("world");
      window.fern.start();
      window.fern.zoom(0.08);
    });
    await expect
      .poll(async () => (await guest.page.evaluate(() => window.fern.observe())).render.zoom)
      .toBeLessThan(0.1);
    const before = await host.page.evaluate(
      (id) => window.fern.observe().players.find((p) => p.id === id)!.x,
      id,
    );
    await guest.page.evaluate(() => window.fern.network.input({ x: 1, y: 0 }));
    await expect
      .poll(async () =>
        host.page.evaluate((id) => window.fern.observe().players.find((p) => p.id === id)!.x, id),
      )
      .toBeGreaterThan(before + 20);
    await guest.page.evaluate(() => window.fern.network.input({ x: 0, pulse: true }));
    await expect
      .poll(async () =>
        (await host.page.evaluate(() => window.fern.observe())).events.some(
          (e) => e.player === id && e.type === "pulse",
        ),
      )
      .toBe(true);
    await guest.page.evaluate(() => window.fern.network.input({ x: 0 }));
    await host.page.evaluate(() => window.fern.command({ op: "input", interact: true }));
    for (const participant of participants)
      await expect
        .poll(async () => (await participant.page.evaluate(() => window.fern.observe())).quest.lit)
        .toContain("north");
    // Exercises PeerJS chunk reassembly and all eight clients while one renders thousands of NPCs.
    await host.page.evaluate(() => window.fern.command({ op: "population", count: 6000 }));
    await expect
      .poll(async () => (await guest.page.evaluate(() => window.fern.observe())).network.population)
      .toBe(6000);
    await expect
      .poll(async () => (await guest.page.evaluate(() => window.fern.observe())).population)
      .toBe(6000);
    await host.page.evaluate(() =>
      window.fern.command({ op: "paint", tx: 14, ty: 14, width: 2, height: 2, terrain: 6 }),
    );
    await expect
      .poll(async () =>
        guest.page.evaluate(
          () => (window.fern.command({ op: "save" }) as SaveState).patches.length,
        ),
      )
      .toBe(4);
    // Each guest chooses its own view budget; population changes remain host-authoritative.
    await host.page.evaluate(() => window.fern.settings.set({ population: 32768 }));
    await guest.page.evaluate(() =>
      window.fern.settings.set({ drawDistance: 256, entityLimit: 512 }),
    );
    await expect
      .poll(async () => (await guest.page.evaluate(() => window.fern.observe())).network.population)
      .toBe(32768);
    await expect
      .poll(async () => (await guest.page.evaluate(() => window.fern.observe())).population)
      .toBeLessThanOrEqual(512);
    const denied = await guest.page.evaluate(() => {
      try {
        window.fern.settings.set({ population: 0 });
        return false;
      } catch {
        return true;
      }
    });
    expect(denied).toBe(true);
    expect((await host.page.evaluate(() => window.fern.observe())).population).toBe(32768);
    await guest.page.evaluate(() =>
      window.fern.settings.set({ drawDistance: 16384, entityLimit: 32768 }),
    );
    await expect
      .poll(async () => (await guest.page.evaluate(() => window.fern.observe())).population)
      .toBe(32768);
    await expect
      .poll(async () => (await guest.page.evaluate(() => window.fern.observe())).render.drawn)
      .toBeGreaterThan(25000);
    const ninth = await traveler(browser, baseURL!);
    participants.push(ninth);
    const rejection = await ninth.page.evaluate(async (code) => {
      try {
        await window.fern.network.join(code);
        return "joined";
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    }, room);
    expect(rejection).toContain("full");
    await guest.page.evaluate(() => window.fern.network.leave());
    await expect
      .poll(async () => (await host.page.evaluate(() => window.fern.observe())).players.length)
      .toBe(7);
    await ninth.page.evaluate((code) => window.fern.network.join(code), room);
    await expect
      .poll(async () => (await host.page.evaluate(() => window.fern.observe())).players.length)
      .toBe(8);
    // Exercise the same adventure actions as the UI over a real guest RPC channel.
    await host.page.evaluate(() => window.fern.command({ op: "population", count: 64 }));
    await guest.page.evaluate(() => window.fern.command({ op: "population", count: 0 }));
    const fighterId = await ninth.page.evaluate(() => window.fern.network.localId());
    const hostGold = await host.page.evaluate(() => window.fern.game.observe().hero!.gold);
    await ninth.page.evaluate(async () => {
      await window.fern.game.action({ type: "skill", id: "blade-0" });
      await window.fern.game.action({ type: "buy", index: 2 });
    });
    await expect
      .poll(async () =>
        ninth.page.evaluate(() => window.fern.game.observe().hero!.inventory.length),
      )
      .toBe(3);
    const boots = await ninth.page.evaluate(
      () => window.fern.game.observe().hero!.inventory.find((item) => item.slot === "boots")!,
    );
    await ninth.page.evaluate((id) => window.fern.game.action({ type: "equip", id }), boots.id);
    await expect
      .poll(async () =>
        host.page.evaluate((id) => {
          const save = window.fern.command({ op: "save" }) as SaveState;
          return save.adventure!.heroes[id].equipment.boots;
        }, fighterId),
      )
      .toBe(boots.id);
    expect(await host.page.evaluate(() => window.fern.game.observe().hero!.gold)).toBe(hostGold);
    expect(
      await ninth.page.evaluate(() => window.fern.game.observe().hero!.skills["blade-0"]),
    ).toBe(1);
    expect(
      await ninth.page.evaluate(async () => {
        try {
          await window.fern.game.action({ type: "tuning", values: { playerDamage: 5 } });
          return false;
        } catch {
          return true;
        }
      }),
    ).toBe(true);
    await host.page.evaluate(async () => {
      await window.fern.game.action({
        type: "tuning",
        values: {
          playerDamage: 5,
          playerHealth: 5,
          enemyDamage: 0.1,
        },
      });
      await window.fern.game.action({ type: "depart" });
    });
    for (const participant of [...participants.slice(2), host])
      await expect
        .poll(async () => participant.page.evaluate(() => window.fern.game.observe().name))
        .toBe("Brambleburst");
    await ninth.page.evaluate(() => {
      const controller = setInterval(() => {
        const game = window.fern.game.observe(),
          player = window.fern
            .observe()
            .players.find((p) => p.id === window.fern.network.localId())!;
        if (game.hero!.xp > 0 || game.hero!.level > 1 || game.hero!.dead) {
          clearInterval(controller);
          window.fern.network.input({});
          return;
        }
        const enemy = game.enemies.sort(
          (a, b) =>
            Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y),
        )[0];
        if (!enemy) return;
        const dx = enemy.x - player.x,
          dy = enemy.y - player.y,
          distance = Math.hypot(dx, dy);
        window.fern.network.input({
          x: distance > 24 ? dx / Math.max(1, distance) : 0,
          y: distance > 24 ? dy / Math.max(1, distance) : 0,
          attack: true,
          pulse: distance < 100,
          aimX: dx / Math.max(1, distance),
          aimY: dy / Math.max(1, distance),
        });
      }, 80);
    });
    await expect
      .poll(
        async () =>
          ninth.page.evaluate(() => {
            const h = window.fern.game.observe().hero!;
            return h.level > 1 || h.xp > 0;
          }),
        { timeout: 20000 },
      )
      .toBe(true);
    await expect
      .poll(async () =>
        host.page.evaluate(() => {
          const h = window.fern.game.observe().hero!;
          return h.level > 1 || h.xp > 0;
        }),
      )
      .toBe(true);
    expect(await host.page.evaluate(() => window.fern.game.observe().kills)).toBeGreaterThan(0);
    const evidence = await host.page.evaluate(() => window.fern.observe());
    await test.info().attach("eight-player host", {
      body: JSON.stringify(evidence, null, 2),
      contentType: "application/json",
    });
    await host.page.evaluate(() => window.fern.network.leave());
    await expect
      .poll(async () => (await ninth.page.evaluate(() => window.fern.network.status())).role)
      .toBe("solo");
    expect(
      await ninth.page.evaluate(() => window.fern.game.observe().hero!.skills["blade-0"]),
    ).toBe(1);
    expect(await ninth.page.evaluate(() => window.fern.game.observe().hero!.equipment.boots)).toBe(
      boots.id,
    );
  } catch (error) {
    const diagnostics = await Promise.all(
      participants.map(async (p, index) => ({
        index,
        state: await rtcDiagnostics(p.page).catch(() => "page unavailable"),
      })),
    );
    console.error("WebRTC diagnostics", JSON.stringify(diagnostics));
    await test.info().attach("WebRTC diagnostics", {
      body: JSON.stringify(diagnostics, null, 2),
      contentType: "application/json",
    });
    throw error;
  } finally {
    await Promise.all(participants.map((p) => p.context.close()));
  }
});
