import { mkdir, writeFile } from "node:fs/promises";
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
  await page.evaluate(() => {
    window.fern.start();
    window.fern.command({ op: "population", count: 6000 });
    window.fern.zoom(0.18);
  });
  await page.waitForFunction(() => window.fern.observe().render.zoom < 0.19);
  const result = await page.evaluate(async () => {
    const times: number[] = [];
    let previous = performance.now();
    await new Promise<void>((resolve) => {
      function sample(now: number) {
        times.push(now - previous);
        previous = now;
        if (times.length < 300) requestAnimationFrame(sample);
        else resolve();
      }
      requestAnimationFrame(sample);
    });
    times.sort((a, b) => a - b);
    return {
      frames: times.length,
      meanFps: 1000 / (times.reduce((a, b) => a + b, 0) / times.length),
      p50FrameMs: times[150],
      p95FrameMs: times[285],
      state: window.fern.observe(),
    };
  });
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/browser-benchmark.json",
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        browser: browser.version(),
        viewport: [1440, 1000],
        method:
          "300 consecutive animation frames, 6000 NPCs, 0.18x zoom, headless Chrome, full simulation and Canvas 2D renderer.",
        ...result,
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: "artifacts/benchmark-6000.png" });
  console.log(
    JSON.stringify({
      frames: result.frames,
      fps: result.meanFps,
      p95FrameMs: result.p95FrameMs,
      visibleNpcs: result.state.render.drawn,
      simulationMs: result.state.physics.stepMs,
    }),
  );
} finally {
  await browser.close();
}
