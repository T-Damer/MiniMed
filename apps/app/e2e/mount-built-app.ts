import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page } from '@playwright/test';

export const E2E_ASSET_ORIGIN = 'http://127.0.0.1:4173';
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
  const initialStorage = options.localStorage ?? {};
  await page.addInitScript((initialValues) => {
    for (const [key, value] of Object.entries(initialValues)) {
      window.localStorage.setItem(key, value);
    }
  }, initialStorage);
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
  await waitForWorkspace(page);
}
