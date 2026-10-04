import { mkdir, writeFile } from "node:fs/promises";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import type { SaveState } from "../src/engine/simulation.ts";
import type { BodyPose } from "../src/physics/types.ts";
import { instrumentRtc, rtcDiagnostics } from "./rtc-diagnostics.ts";

test("eight real WebRTC travelers share props/policies, late join atomically and recover each build after host loss", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(180000);
  const travelers: { context: BrowserContext; page: Page }[] = [];
  const errors: string[] = [];
  const create = async () => {
    const context = await browser.newContext({ viewport: { width: 1000, height: 760 } });
    const page = await context.newPage();
    await instrumentRtc(page);
    page.on("pageerror", (e) => errors.push(e.message));
    travelers.push({ context, page });
    await page.goto(baseURL!);
    await page.waitForFunction(() => !!window.fern);
    await page.evaluate(() => {
      window.fern.command({ op: "population", count: 64 });
      window.fern.view("lab");
    });
    return page;
  };
  const body = (page: Page) =>
    page.evaluate(
      () => window.fern.command({ op: "actors", action: "body", id: "prop-shared" }) as BodyPose,
    );
  try {
    const host = await create();
    await host.evaluate(() => {
      window.fern.command({
        op: "actors",
        action: "spawn",
        body: {
          id: "prop-shared",
          role: "prop",
          areaId: "town",
          motion: "dynamic",
          shape: { kind: "box", width: 20, height: 20 },
          x: 35,
          y: 34,
          mass: 1,
          damping: 3,
          consequences: { destroyed: false, claimed: true, durability: 73 },
        },
      });
      window.fern.command({
        op: "actors",
        action: "configure",
        expectedRevision: 0,
        edits: [
          {
            type: "region",
            profile: {
              id: "shared-town",
              areaId: "town",
              priority: 50,
              shape: { kind: "rectangle", x: -200, y: -150, width: 400, height: 400 },
              values: {},
            },
          },
        ],
      });
    });
    const room = await host.evaluate(() => window.fern.network.host());
    for (let i = 0; i < 6; i++) {
      const page = await create();
      await page.evaluate((code) => window.fern.network.join(code), room);
      await page.evaluate(() => window.fern.game.action({ type: "skill", id: "blade-0" }));
    }
    const guest = travelers[1].page;
    const before = (await body(host)).x;
    await guest.evaluate(() => window.fern.network.interact({ id: "prop-shared", x: 80, y: 0 }));
    for (const traveler of travelers)
      await expect.poll(async () => (await body(traveler.page)).x).toBeGreaterThan(before + 3);
    await host.evaluate(() =>
      window.fern.command({
        op: "actors",
        action: "configure",
        expectedRevision: 1,
        edits: [
          {
            type: "override",
            scope: "region",
            id: "shared-town",
            values: { worldReactions: false },
          },
        ],
      }),
    );
    for (const traveler of travelers)
      await expect.poll(async () => (await body(traveler.page)).frozen).toBe(true);
    const frozen = await body(host);
    const pointPolicy = await guest.evaluate(
      () =>
        window.fern.command({ op: "actors", action: "policy", x: 35, y: 34 }) as {
          areaId: string;
          effective: { worldReactions: boolean };
        },
    );
    expect(pointPolicy.areaId).toBe("town");
    expect(pointPolicy.effective.worldReactions).toBe(false);
    const denied = await guest.evaluate(() => {
      try {
        window.fern.command({
          op: "actors",
          action: "configure",
          expectedRevision: 2,
          edits: [{ type: "master", enabled: true }],
        });
        return false;
      } catch {
        return true;
      }
    });
    expect(denied).toBe(true);
    // A real older client's signaling metadata reaches the host's compatibility check.
    const oldContext = await browser.newContext();
    const oldPage = await oldContext.newPage();
    try {
      await oldPage.addInitScript(() => {
        const send = WebSocket.prototype.send;
        WebSocket.prototype.send = function (data) {
          if (typeof data === "string") {
            const message = JSON.parse(data);
            if (message.type === "OFFER" && message.payload?.metadata) {
              message.payload.metadata.version = 3;
              data = JSON.stringify(message);
            }
          }
          return send.call(this, data);
        };
      });
      await oldPage.goto(baseURL!);
      await oldPage.waitForFunction(() => !!window.fern);
      const message = await oldPage.evaluate(async (code) => {
        try {
          await window.fern.network.join(code);
          return "unexpected success";
        } catch (error) {
          return String(error);
        }
      }, room);
      expect(message).toContain("Incompatible physics protocol");
    } finally {
      await oldContext.close();
    }
    const late = await create();
    await late.evaluate((code) => window.fern.network.join(code), room);
    expect(await late.evaluate(() => window.fern.network.status().baselineReady)).toBe(true);
    expect((await body(late)).frozen).toBe(true);
    expect(Math.abs((await body(late)).x - frozen.x)).toBeLessThan(0.01);
    expect((await body(late)).consequences).toEqual(frozen.consequences);
    await late.evaluate(() => window.fern.game.action({ type: "skill", id: "blade-0" }));
    await late.evaluate(() => window.fern.network.interact({ id: "prop-shared", x: 100, y: 0 }));
    expect((await body(host)).vx).toBe(0);
    for (const traveler of travelers)
      await expect
        .poll(async () => traveler.page.evaluate(() => window.fern.observe().players.length))
        .toBe(8);
    await host.evaluate(() =>
      window.fern.command({
        op: "actors",
        action: "configure",
        expectedRevision: 2,
        edits: [
          {
            type: "override",
            scope: "region",
            id: "shared-town",
            values: { worldReactions: true },
          },
        ],
      }),
    );
    await expect.poll(async () => (await body(late)).frozen).toBe(false);
    await late.evaluate(() => window.fern.network.interact({ id: "prop-shared", x: -40, y: 10 }));
    await expect.poll(async () => (await body(guest)).vx).toBeLessThan(0);
    await guest.evaluate(() => {
      window.fern.view("world");
      window.fern.start();
    });
    await guest.screenshot({ path: "artifacts/physics-m04-guest.png" });
    const builds = await Promise.all(
      travelers.slice(1).map(({ page }) => page.evaluate(() => window.fern.game.observe().hero!)),
    );
    const receipt = await Promise.all(travelers.map(({ page }) => rtcDiagnostics(page)));
    await mkdir("artifacts", { recursive: true });
    await writeFile(
      "artifacts/physics-m04-network.json",
      JSON.stringify(
        {
          isolatedBrowsers: travelers.length,
          transport: "PeerJS/WebRTC reliable data channels",
          guestImpulse: { beforeX: before, frozenX: frozen.x },
          hostRegion: "shared-town",
          lateJoinReady: true,
          incompatibleProtocolRejected: true,
          clients: receipt,
        },
        null,
        2,
      ),
    );
    await test.info().attach("physical eight-player transport", {
      body: JSON.stringify(receipt, null, 2),
      contentType: "application/json",
    });
    await host.evaluate(() => window.fern.network.leave());
    for (const [index, traveler] of travelers.slice(1).entries()) {
      await expect
        .poll(async () => traveler.page.evaluate(() => window.fern.network.status().role))
        .toBe("solo");
      const saved = await traveler.page.evaluate(
        () => window.fern.command({ op: "save" }) as SaveState,
      );
      expect(saved.adventure!.heroes.local.skills).toEqual(builds[index].skills);
      expect(saved.adventure!.heroes.local.gold).toBe(builds[index].gold);
      expect(saved.actorPhysics!.world.bodies.some((e) => e.recipe.id === "prop-shared")).toBe(
        true,
      );
      expect(saved.actorPhysics!.world.bodies.some((e) => e.recipe.id === "player-local")).toBe(
        true,
      );
      const x = await traveler.page.evaluate(() => window.fern.observe().players[0].x);
      await traveler.page.evaluate(() => {
        window.fern.command({ op: "input", x: -1 });
        window.fern.command({ op: "step", ticks: 12 });
        window.fern.command({ op: "input" });
      });
      expect(await traveler.page.evaluate(() => window.fern.observe().players[0].x)).toBeLessThan(
        x - 1,
      );
    }
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(travelers.map((t) => t.context.close()));
  }
});

test("physical portal replication snaps travelers and props to the new land", async ({
  browser,
  baseURL,
}) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    const [host, guest] = await Promise.all(contexts.map((context) => context.newPage()));
    for (const page of [host, guest]) {
      await page.goto(baseURL!);
      await page.waitForFunction(() => !!window.fern);
      await page.evaluate(() => {
        window.fern.command({ op: "population", count: 0 });
        window.fern.view("lab");
      });
    }
    const room = await host.evaluate(() => window.fern.network.host());
    await guest.evaluate((code) => window.fern.network.join(code), room);
    await host.evaluate(() => window.fern.command({ op: "encounter", index: 5 }));
    await expect
      .poll(async () =>
        guest.evaluate(
          () => (window.fern.command({ op: "save" }) as SaveState).actorPhysics!.landId,
        ),
      )
      .toBe("land-1-1");
    const state = await guest.evaluate(() => window.fern.command({ op: "save" }) as SaveState);
    for (const player of state.players) {
      expect(player.px).toBeGreaterThan(400);
      expect(Math.abs(player.px - player.x)).toBeLessThan(100);
    }
    expect(state.actorPhysics!.world.bodies.some((b) => b.recipe.id === "crate-1-0")).toBe(false);
    expect(state.actorPhysics!.world.bodies.some((b) => b.recipe.id === "crate-5-0")).toBe(true);
    await host.evaluate(() => window.fern.network.leave());
    await expect
      .poll(async () => guest.evaluate(() => window.fern.network.status().role))
      .toBe("solo");
    expect(
      (await guest.evaluate(() => window.fern.command({ op: "save" }) as SaveState)).actorPhysics!
        .landId,
    ).toBe("land-1-1");
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
