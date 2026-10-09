import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page } from '@playwright/test';

export const E2E_ASSET_ORIGIN = process.env['E2E_ORIGIN'] ?? 'http://127.0.0.1:4173';
const BUILT_CONTENT_ROOT = resolve(import.meta.dirname, '../dist/content');

export function hasLocalCompanionPack(name: string): boolean {
  return existsSync(join(BUILT_CONTENT_ROOT, name));
}

export interface MountBuiltAppOptions {
  readonly localStorage?: Readonly<Record<string, string>>;
  readonly origin?: string;
  readonly persistentOrigin?: boolean;
  readonly skipLargeCompanionPacks?: boolean;
  readonly includeMkbCompanionPack?: boolean;
  readonly includeMedicationCompanionPack?: boolean;
  readonly splitNavigation?: boolean;
  /** Also wait until the search core has opened (see {@link waitForSearchReady}). */
  readonly waitForCore?: boolean;
}

/**
 * Opening the 440 MB core takes up to a minute on a busy machine (parallel agents, full runs), so
 * it gets its own bound instead of the default `expect` timeout.
 */
export const CORE_READY_TIMEOUT_MS = 120_000;

async function waitForCoreCondition(
  page: Page,
  condition: () => boolean,
  timeout: number,
  what: string,
): Promise<void> {
  try {
    await page.waitForFunction(condition, undefined, { timeout, polling: 250 });
  } catch (cause) {
    const status = page.locator('.search-core-status--error');
    const detail = (await status.count()) > 0 ? ` (core status: ${await status.innerText()})` : '';
    throw new Error(`${what} did not happen within ${String(timeout)} ms${detail}`, { cause });
  }
}

/**
 * Waits until the search core has opened for the first time, on any route (the app marks it with
 * `minimed:search-ready`). Specs that need the core call this once after mounting; specs about the
 * loading state do not. A failed wait names the core's error status if one is shown.
 */
export async function waitForSearchReady(
  page: Page,
  timeout: number = CORE_READY_TIMEOUT_MS,
): Promise<void> {
  await waitForCoreCondition(
    page,
    () => performance.getEntriesByName('minimed:search-ready').length > 0,
    timeout,
    'The search core opening',
  );
}

/**
 * Waits until the search field is editable (`data-search-ready`): the core has opened and, after a
 * reload of the core, has reopened. Needs the search page on screen.
 */
export async function waitForSearchEditable(
  page: Page,
  timeout: number = CORE_READY_TIMEOUT_MS,
): Promise<void> {
  await waitForCoreCondition(
    page,
    () => document.querySelector('[data-testid="search-input"][data-search-ready="true"]') !== null,
    timeout,
    'The search field becoming editable',
  );
}

async function waitForWorkspace(page: Page): Promise<void> {
  await page.getByTestId('search-input').waitFor();

  // The knowledge-base badge deliberately extends the accessible label with an update count. Most
  // navigation tests are not testing that badge, so keep their exact-name helpers deterministic while
  // leaving the production DOM and dedicated badge behaviour untouched.
  await page.locator('.app-nav-button').evaluateAll((buttons) => {
    for (const button of buttons) {
      const label = button.getAttribute('aria-label');
      if (label?.startsWith('База знаний,')) button.setAttribute('aria-label', 'База знаний');
    }
  });
}

export async function mountBuiltApp(page: Page, options: MountBuiltAppOptions = {}): Promise<void> {
  const origin = options.origin ?? E2E_ASSET_ORIGIN;
  const skippedCompanionPacks = new Set([
    'ambulatory.db',
    ...(options.includeMkbCompanionPack ? [] : ['mkb.db']),
    ...(options.includeMedicationCompanionPack ? [] : ['medications.db']),
  ]);
  if (options.skipLargeCompanionPacks) {
    skippedCompanionPacks.add('mkb.db');
    skippedCompanionPacks.add('medications.db');
  }
  for (const databaseName of skippedCompanionPacks) {
    await page.route(`${origin}/content/${databaseName}`, (route) => route.abort());
  }
  // Existing route suites also qualify the retained six-section layout. New unified-navigation
  // cases opt out of this preference and exercise the application's actual default.
  const initialStorage = {
    // Route suites test the app behind onboarding; the setup screen has its own coverage.
    'minimed:package-setup-dismissed:v1': '1',
    ...(options.splitNavigation === false
      ? {}
      : {
          'minimed.app-preferences.v1': JSON.stringify({ splitNavigation: true }),
        }),
    ...options.localStorage,
  };
  await page.addInitScript((initialValues) => {
    for (const [key, value] of Object.entries(initialValues)) {
      window.localStorage.setItem(key, value);
    }
  }, initialStorage);
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
  await waitForWorkspace(page);
  if (options.waitForCore) await waitForSearchReady(page);
}
