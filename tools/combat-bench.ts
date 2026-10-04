import { mkdir, writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import { chromium } from "@playwright/test";

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
  args: [
    "--no-sandbox",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
  ],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(process.env.BASE_URL ?? "http://localhost:5173");
  await page.waitForFunction(() => !!window.fern);
  await page.evaluate(async () => {
    window.fern.settings.set({ population: 2400 });
    await window.fern.display.enterGame(false);
    await window.fern.game.action({
      type: "tuning",
      values: { playerHealth: 5, enemyDamage: 0.1 },
    });
    window.fern.command({ op: "encounter", index: 9 });
  });
  const result = await page.evaluate(async () => {
    const controller = setInterval(() => {
      const state = window.fern.observe(),
        game = state.adventure,
        player = state.players[0];
      const enemy = game.enemies.sort(
        (a, b) =>
          Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y),
      )[0];
      if (!enemy || game.hero!.dead) return;
      const dx = enemy.x - player.x,
        dy = enemy.y - player.y,
        distance = Math.hypot(dx, dy);
      window.fern.command({
        op: "input",
        x: distance > 30 ? dx / Math.max(1, distance) : 0,
        y: distance > 30 ? dy / Math.max(1, distance) : 0,
        attack: true,
        pulse: distance < 100,
        dash: distance > 150,
        potion: game.hero!.hp < game.stats!.health * 0.5,
        aimX: dx / Math.max(1, distance),
        aimY: dy / Math.max(1, distance),
      });
    }, 80);
    try {
      for (let i = 0; i < 60; i++) await new Promise(requestAnimationFrame);
      const first = window.fern.observe(),
        start = performance.now(),
        intervals: number[] = [];
      let previous = start,
        peakEnemies = first.adventure.enemies.length;
      for (let i = 0; i < 300; i++) {
        const now = await new Promise<number>(requestAnimationFrame);
        intervals.push(now - previous);
        previous = now;
        if (i % 30 === 0)
          peakEnemies = Math.max(peakEnemies, window.fern.game.observe().enemies.length);
      }
      const elapsed = (performance.now() - start) / 1000,
        state = window.fern.observe();
      intervals.sort((a, b) => a - b);
      return {
        frames: 300,
        meanFps: 300 / elapsed,
        p95FrameMs: intervals[285],
        simulationTicksPerSecond: (state.tick - first.tick) / elapsed,
        peakEnemies,
        kills: state.adventure.kills - first.adventure.kills,
        state,
      };
    } finally {
      clearInterval(controller);
      window.fern.command({ op: "input" });
    }
  });
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/combat-benchmark.json",
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        cpu: cpus()[0]?.model,
        node: process.version,
        browser: browser.version(),
        viewport: [1440, 1000],
        method:
          "60 warmup frames then 300 measured frames in generated area 9, 2400 ambient NPCs, 1.8× zoom, game mode, ordinary attack/Whorl/dash inputs. Player health 5× and enemy damage 0.1× keep combat active; damage and movement remain at defaults.",
        ...result,
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: "artifacts/combat-benchmark.png" });
  const { state: _state, ...summary } = result;
  console.log(JSON.stringify(summary));
} finally {
  await browser.close();
}
