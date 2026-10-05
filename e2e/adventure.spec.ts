import { expect, test } from "@playwright/test";

test("solo menus and atlas pause time while preserving an explicit lab pause", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => !!window.fern);
  await page.evaluate(() => window.fern.start());
  await page.getByRole("button", { name: "Open equipment", exact: true }).click();
  const pausedTick = await page.evaluate(() => window.fern.observe().tick);
  await page.evaluate(async () => {
    for (let frame = 0; frame < 8; frame++) await new Promise(requestAnimationFrame);
  });
  expect(await page.evaluate(() => window.fern.observe().tick)).toBe(pausedTick);
  await page.getByRole("button", { name: "Close adventure panel" }).click();
  await expect
    .poll(async () => page.evaluate(() => window.fern.observe().tick))
    .toBeGreaterThan(pausedTick);
  await page.evaluate(() => {
    window.fern.pause(true);
    window.fern.game.panel("skills");
  });
  await page.getByRole("button", { name: "Close adventure panel" }).click();
  const manualTick = await page.evaluate(() => window.fern.observe().tick);
  await page.getByRole("button", { name: "Atlas", exact: true }).click();
  await page.getByRole("button", { name: "World", exact: true }).click();
  await page.evaluate(async () => {
    for (let frame = 0; frame < 8; frame++) await new Promise(requestAnimationFrame);
  });
  expect(await page.evaluate(() => window.fern.observe().tick)).toBe(manualTick);
  await page.evaluate(() => window.fern.pause(false));
  await expect
    .poll(async () => page.evaluate(() => window.fern.observe().tick))
    .toBeGreaterThan(manualTick);
});

test("the browser completes the build, combat, loot, outward travel and resupply loop", async ({
  page,
}) => {
  // Wall-clock waits are not performance gates (D53): M08's reaction yards and fires make this
  // full-population encounter heavier on slow runners, and it must still clear.
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => !!window.fern);
  await expect(page.getByRole("heading", { name: "A quiet town. A hungry wild." })).toBeVisible();
  await page.getByRole("button", { name: "Open skill tree", exact: true }).click();
  await expect(page.locator(".skill-node")).toHaveCount(48);
  await page.locator('[data-skill="blade-0"]').click();
  const baseDamage = await page.evaluate(() => window.fern.game.observe().stats!.damage);
  await page.getByRole("button", { name: "Learn · 1 point", exact: false }).click();
  await expect
    .poll(
      async () => (await page.evaluate(() => window.fern.game.observe())).hero!.skills["blade-0"],
    )
    .toBe(1);
  expect((await page.evaluate(() => window.fern.game.observe())).stats!.damage).toBeGreaterThan(
    baseDamage,
  );
  await page.screenshot({ path: "artifacts/adventure-skills.png" });
  await page.getByRole("button", { name: "Close adventure panel" }).click();
  await page.getByRole("button", { name: "Rest & resupply", exact: true }).click();
  await expect(page.locator(".shop-card")).toHaveCount(6);
  await page.locator('[data-buy="2"]').click();
  await expect
    .poll(
      async () => (await page.evaluate(() => window.fern.game.observe())).hero!.inventory.length,
    )
    .toBe(3);
  expect((await page.evaluate(() => window.fern.game.observe())).hero!.gold).toBeLessThan(80);
  await page.screenshot({ path: "artifacts/adventure-town-services.png" });
  await page.getByRole("button", { name: "Close adventure panel" }).click();
  await page.getByRole("button", { name: "Open equipment", exact: true }).click();
  const boots = await page.evaluate(
    () => window.fern.game.observe().hero!.inventory.find((item) => item.slot === "boots")!,
  );
  await page.locator(`.item-card[data-item="${boots.id}"]`).click();
  await page.getByRole("button", { name: "Equip", exact: true }).click();
  await expect
    .poll(async () => (await page.evaluate(() => window.fern.game.observe())).hero!.equipment.boots)
    .toBe(boots.id);
  await page.screenshot({ path: "artifacts/adventure-equipment.png" });
  await page.getByRole("button", { name: "Close adventure panel" }).click();
  await page.getByRole("button", { name: "Begin the hunt", exact: true }).click();
  await expect
    .poll(async () => (await page.evaluate(() => window.fern.game.observe())).area)
    .toBe(1);
  await page.keyboard.press("p");
  await expect(page.getByRole("heading", { name: "A moment to breathe." })).toBeVisible();
  await page
    .getByRole("slider", { name: "Player health multiplier", exact: true })
    .evaluate((node) => {
      const input = node as HTMLInputElement;
      input.value = "2";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  await expect
    .poll(async () => (await page.evaluate(() => window.fern.game.observe())).tuning.playerHealth)
    .toBe(2);
  await page.screenshot({ path: "artifacts/adventure-tuning.png" });
  await page.getByRole("button", { name: "Return to the wild", exact: false }).click();
  // This controller sends ordinary inputs while the actual browser animation loop runs.
  await page.evaluate(() => {
    const controller = setInterval(() => {
      const state = window.fern.observe(),
        game = state.adventure,
        player = state.players[0];
      if (!game.hero || game.hero.dead || game.cleared) {
        clearInterval(controller);
        window.fern.command({ op: "input" });
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
      window.fern.command({
        op: "input",
        x: distance > 32 ? dx / Math.max(1, distance) : 0,
        y: distance > 32 ? dy / Math.max(1, distance) : 0,
        attack: true,
        pulse: distance < 100,
        potion: game.hero.hp < game.stats!.health * 0.5,
      });
    }, 80);
  });
  await expect
    .poll(async () => (await page.evaluate(() => window.fern.game.observe())).kills, {
      timeout: 30000,
    })
    .toBeGreaterThan(3);
  await page.screenshot({ path: "artifacts/adventure-combat.png" });
  await expect
    .poll(async () => (await page.evaluate(() => window.fern.game.observe())).cleared, {
      timeout: 150000,
    })
    .toBe(true);
  const victory = await page.evaluate(() => window.fern.game.observe());
  expect(victory.hero!.level).toBeGreaterThan(1);
  expect(victory.hero!.gold).toBeGreaterThan(80);
  expect(victory.drops.some((drop) => drop.kind === "item" && drop.rarity === "rare")).toBe(true);
  await page.evaluate(() => {
    window.fern.command({ op: "input" });
    window.fern.pause(true);
  });
  const itemDrop = await page.evaluate(
    () => window.fern.game.observe().drops.find((drop) => drop.kind === "item")!,
  );
  const itemCount = (await page.evaluate(() => window.fern.game.observe())).hero!.inventory.length;
  // Reposition through the documented QA command, then use the real E interaction.
  await page.evaluate((drop) => {
    window.fern.command({ op: "teleport", x: drop.x, y: drop.y });
    window.fern.command({ op: "input", interact: true });
    window.fern.command({ op: "step", ticks: 1 });
    window.fern.command({ op: "input" });
  }, itemDrop);
  expect((await page.evaluate(() => window.fern.game.observe())).hero!.inventory.length).toBe(
    itemCount + 1,
  );
  await page.screenshot({ path: "artifacts/adventure-victory.png" });
  await page.getByRole("button", { name: "Continue outward", exact: false }).click();
  await expect
    .poll(async () => (await page.evaluate(() => window.fern.game.observe())).name)
    .toBe("Slipstream");
  await page.evaluate(() => {
    const recipe = window.fern.game.observe().recipe;
    window.fern.command({ op: "teleport", x: recipe.x - 600, y: recipe.y });
    return window.fern.game.action({ type: "return" });
  });
  await page.evaluate(() => {
    window.fern.command({ op: "input" });
    window.fern.command({ op: "step", ticks: 150 });
  });
  await expect
    .poll(async () => (await page.evaluate(() => window.fern.game.observe())).mode)
    .toBe("town");
  expect((await page.evaluate(() => window.fern.game.observe())).hero!.potions).toBe(3);
  await page.getByRole("button", { name: "Open equipment", exact: true }).click();
  await page.screenshot({ path: "artifacts/adventure-upgraded-build.png" });
  expect(errors).toEqual([]);
});

test("death returns to town with progression intact and the pause menu previews generated areas", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => !!window.fern);
  await page.evaluate(() =>
    window.fern.game.action({ type: "tuning", values: { playerHealth: 0.1, enemyDamage: 3 } }),
  );
  await page.getByRole("button", { name: "Begin the hunt", exact: true }).click();
  await expect(page.getByRole("heading", { name: "The lantern dims." })).toBeVisible({
    timeout: 20000,
  });
  const state = await page.evaluate(() => window.fern.game.observe());
  expect(state.hero!.dead).toBe(true);
  expect(state.hero!.gold).toBe(72);
  await page.getByRole("button", { name: "Return to Mosslight Hollow", exact: false }).click();
  await expect
    .poll(async () => (await page.evaluate(() => window.fern.game.observe())).mode)
    .toBe("town");
  await page.getByRole("button", { name: "Pause game", exact: true }).click();
  await page.getByText("Encounter preview & new run", { exact: true }).click();
  await page.getByRole("spinbutton", { name: "Preview area number", exact: true }).fill("10001");
  await page.getByRole("button", { name: "Preview area", exact: true }).click();
  await expect
    .poll(async () => (await page.evaluate(() => window.fern.game.observe())).area)
    .toBe(10001);
  expect((await page.evaluate(() => window.fern.game.observe())).recipe.procedural).toBe(true);
});

test("equipment, skill paths, combat buttons and pause controls fit the mobile game HUD", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.waitForFunction(() => !!window.fern);
  await page.getByRole("button", { name: "Enter fullscreen game mode", exact: true }).click();
  await page.getByRole("button", { name: "Game skill tree", exact: true }).click();
  await expect(page.locator(".skill-node")).toHaveCount(48);
  await page.locator('[data-skill="blade-0"]').click();
  await page.getByRole("button", { name: "Learn · 1 point", exact: false }).click();
  expect((await page.evaluate(() => window.fern.game.observe())).hero!.points).toBe(2);
  await page.getByRole("button", { name: "Close adventure panel" }).click();
  await page.getByRole("button", { name: "Game equipment", exact: true }).click();
  await expect(page.locator(".equipment-slot")).toHaveCount(4);
  await page.getByRole("button", { name: "Close adventure panel" }).click();
  await page.getByRole("button", { name: "Slash attack", exact: true }).click();
  await expect
    .poll(async () =>
      (await page.evaluate(() => window.fern.game.observe())).events.some(
        (event) => event.type === "slash",
      ),
    )
    .toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "artifacts/adventure-mobile.png" });
  await page.getByRole("button", { name: "Game pause menu", exact: true }).click();
  await expect(
    page.getByRole("slider", { name: "Enemy damage multiplier", exact: true }),
  ).toBeVisible();
});
