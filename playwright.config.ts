import { existsSync } from 'node:fs';

import { defineConfig, devices } from '@playwright/test';

const chromiumExecutable =
  process.env.CHROMIUM_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const localModelSmokeOrigin = process.env.LOCAL_MODEL_SMOKE_ORIGIN;

export default defineConfig({
  testDir: './apps/app/e2e',
  // Full discovery-core startup/search is slower than the former small pilot fixture.
  timeout: 90_000,
  expect: { timeout: 25_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    trace: 'on-first-retry',
  },
  // Serve large SQLite assets over HTTP, not a base64 CDP message (100 MiB channel limit).
  webServer: process.env.MINIMED_LIVE_URL
    ? undefined
    : {
        command: 'bun run --cwd apps/app preview -- --host 127.0.0.1 --port 4173 --strictPort',
        url: localModelSmokeOrigin ?? 'http://127.0.0.1:4173',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: chromiumExecutable ? { executablePath: chromiumExecutable } : undefined,
      },
    },
  ],
});
