import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    headless: true,
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Pin to locally-installed chromium 1223 (Playwright 1.60 wants 1228 but
        // the codeload download times out on this network — fall back to whatever
        // is on disk). Set PW_CHROMIUM_EXECUTABLE_PATH env to override.
        launchOptions: {
          executablePath: process.env.PW_CHROMIUM_EXECUTABLE_PATH
            ?? 'C:\\Users\\lijin\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1223\\chrome-headless-shell-win64\\chrome-headless-shell.exe',
        },
      },
    },
  ],
});
