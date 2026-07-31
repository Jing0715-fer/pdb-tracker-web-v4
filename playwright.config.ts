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
        // Fall back to Playwright's bundled chromium when no explicit override
        // is set. The previous value hard-coded a Windows path
        // (C:\\Users\\lijin\\...) which only worked on one developer's machine
        // and broke on macOS/Linux/CI. Set PW_CHROMIUM_EXECUTABLE_PATH to pin
        // a specific binary; leave unset to use the auto-installed browser.
        ...(process.env.PW_CHROMIUM_EXECUTABLE_PATH
          ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_EXECUTABLE_PATH } }
          : {}),
      },
    },
  ],
});
