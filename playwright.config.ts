import { existsSync } from 'node:fs';

import { defineConfig, devices } from '@playwright/test';

const chromiumExecutable =
  process.env.CHROMIUM_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const localModelSmokeOrigin = process.env.LOCAL_MODEL_SMOKE_ORIGIN;
// Parallel checkouts (release worktrees, agents) each pick their own port: `E2E_PORT=4183`. Workers
// inherit E2E_ORIGIN, which mount-built-app and the specs use as the app's address.
const e2ePort = process.env.E2E_PORT ?? '4173';
process.env.E2E_ORIGIN ??= `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: './apps/app/e2e',
  outputDir: './playwright/test-results',
  // Full discovery-core startup/search is slower than the former small pilot fixture. Opening the
  // core can take a minute on a busy machine, so specs that need it wait through
  // `waitForSearchReady` (e2e/mount-built-app.ts, its own bound); the default `expect` bound covers
  // what follows on a loaded machine and costs a passing run nothing.
  timeout: 150_000,
  expect: { timeout: 45_000 },
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
        command: `bun run --cwd apps/app preview -- --host 127.0.0.1 --port ${e2ePort} --strictPort`,
        url: localModelSmokeOrigin ?? process.env.E2E_ORIGIN,
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
    // Opt-in (`PLAYWRIGHT_WEBKIT=1 bunx playwright test --project=webkit-ios`, after
    // `bunx playwright install webkit`): the engine of Safari and of the iOS app's web view, on
    // iPad mini. Headless WebKit paints no backdrop-filter blur, so blur is judged in the
    // simulator; these specs cover layout, the first-run veil and the patient diary on iOS.
    ...(process.env['PLAYWRIGHT_WEBKIT']
      ? [
          {
            name: 'webkit-ios',
            testMatch: [
              '**/ios-layout.spec.ts',
              '**/diary-install.spec.ts',
              '**/diary-paste.spec.ts',
              '**/diary-patient.spec.ts',
              '**/diary-screens.spec.ts',
            ],
            use: { ...devices['iPad Mini'], viewport: { width: 744, height: 1133 } },
          },
        ]
      : []),
  ],
});
