import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  timeout: 90000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://127.0.0.1:5187",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: {
      executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
      args: [
        "--no-sandbox",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--autoplay-policy=no-user-gesture-required",
        // Local CI sessions use direct host candidates; production keeps browser defaults.
        ...(process.env.CI && !process.env.BASE_URL
          ? ["--disable-features=WebRtcHideLocalIpsWithMdns"]
          : []),
      ],
    },
  },
  webServer: process.env.BASE_URL
    ? undefined
    : [
        {
          command:
            "VITE_SIGNAL_HOST=127.0.0.1 VITE_SIGNAL_PORT=9018 VITE_SIGNAL_PATH=/fern VITE_SIGNAL_SECURE=false VITE_ICE_SERVERS='[]' npm run dev -- --port 5187",
          port: 5187,
          reuseExistingServer: false,
        },
        { command: "SIGNAL_PORT=9018 npm run signal", port: 9018, reuseExistingServer: false },
      ],
});
