import { mkdir, writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import { chromium } from "@playwright/test";

const counts = (process.env.FERN_BENCH_COUNTS ?? "6000,16384,32768,65536").split(",").map(Number);
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
  args: [
    "--no-sandbox",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
  ],
});
const results = [];
try {
  await mkdir("artifacts", { recursive: true });
  for (const count of counts) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      const page = await context.newPage();
      await page.goto(process.env.BASE_URL ?? "http://localhost:5173");
      await page.waitForFunction(() => !!window.fern);
      await page.evaluate(async (population) => {
        window.fern.settings.set({ population, entityLimit: population, drawDistance: 16384 });
        await window.fern.display.enterGame(false);
        window.fern.zoom(0.12);
      }, count);
      await page.waitForFunction(
        (population) =>
          window.fern.observe().render.drawn === population &&
          window.fern.observe().render.zoom < 0.121,
        count,
      );
      const result = await page.evaluate(async () => {
        const samples: number[] = [],
          firstTick = window.fern.observe().tick;
        const begin = performance.now();
        let previous = begin;
        await new Promise<void>((resolve) => {
          function frame(now: number) {
            samples.push(now - previous);
            previous = now;
            if (samples.length < 300) requestAnimationFrame(frame);
            else resolve();
          }
          requestAnimationFrame(frame);
        });
        const elapsed = (performance.now() - begin) / 1000;
        samples.sort((a, b) => a - b);
        const state = window.fern.observe();
        return {
          count: state.population,
          frames: samples.length,
          meanFps: 300 / elapsed,
          p50FrameMs: samples[150],
          p95FrameMs: samples[285],
          simulationTicksPerSecond: (state.tick - firstTick) / elapsed,
          drawn: state.render.drawn,
          simulationMs: state.physics.stepMs,
          renderMs: state.render.renderMs,
          state,
        };
      });
      results.push(result);
      await page.screenshot({ path: `artifacts/quality-${count}.png` });
      const { state: _state, ...summary } = result;
      console.log(JSON.stringify(summary));
    } finally {
      await context.close();
    }
  }
  await writeFile(
    "artifacts/quality-benchmark.json",
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        cpu: cpus()[0]?.model,
        node: process.version,
        browser: browser.version(),
        method:
          "300 animation frames per fresh browser context, 1440×1000 game mode, 0.12× zoom, draw distance 16384, visible cap equal to active population. Both rendered FPS and actual fixed simulation ticks/second are measured; overloaded simulation never invents variable timesteps.",
        results,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
