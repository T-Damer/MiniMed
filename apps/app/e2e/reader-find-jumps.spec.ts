import { expect, type Page, test } from '@playwright/test';

import {
  CLINICAL_DOCUMENT_ROUTE,
  installClinicalModule,
  routeClinicalModule,
} from './clinical-module-fixture';
import { mountBuiltApp } from './mount-built-app';

// «Острая ишемия конечностей» (kr.rf.1006_1): 63 sections, nested headings, tables, long text. The
// reader mounts its sections in idle batches, so the document is far longer than what is rendered
// when it opens.

async function openLongDocument(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 844 });
  await routeClinicalModule(page);
  await mountBuiltApp(page);
  await installClinicalModule(page);
  await expect(page).toHaveURL(CLINICAL_DOCUMENT_ROUTE);
  await page.locator('.document-overlay-section__title').first().waitFor();
}

/** Resolves once the page has stopped moving: a jump ends only after the target stood still. */
async function waitForScrollToSettle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let last = Number.NaN;
        let stableSince = performance.now();
        const tick = (): void => {
          const y = window.scrollY;
          if (y !== last) {
            last = y;
            stableSince = performance.now();
          }
          if (performance.now() - stableSince > 450) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

interface MarkPlacement {
  readonly found: boolean;
  readonly top: number;
  readonly bottom: number;
  readonly chromeBottom: number;
  readonly viewportBottom: number;
}

async function currentMarkPlacement(page: Page): Promise<MarkPlacement> {
  return page.evaluate(() => {
    const mark = document.querySelector('.document-overlay-match--current');
    const chrome = document.querySelector('.document-page__chrome');
    const nav = document.querySelector<HTMLElement>('.app-bottom-nav');
    const rect = mark?.getBoundingClientRect();
    return {
      found: Boolean(mark),
      top: rect?.top ?? Number.NaN,
      bottom: rect?.bottom ?? Number.NaN,
      chromeBottom: chrome?.getBoundingClientRect().bottom ?? 0,
      viewportBottom: window.innerHeight - (nav?.offsetHeight ?? 0),
    };
  });
}

async function expectCurrentMarkOnScreen(page: Page, label: string): Promise<void> {
  await waitForScrollToSettle(page);
  const placement = await currentMarkPlacement(page);
  expect(placement.found, `${label}: the active match is highlighted`).toBe(true);
  expect(placement.top, `${label}: below the sticky chrome`).toBeGreaterThanOrEqual(
    placement.chromeBottom - 1,
  );
  expect(placement.bottom, `${label}: above the bottom edge`).toBeLessThanOrEqual(
    placement.viewportBottom + 1,
  );
}

async function reportedCount(page: Page): Promise<{ current: number; total: number }> {
  const label = await page.locator('.document-find__count').innerText();
  const [current, total] = label.split('/').map(Number);
  return { current: current ?? 0, total: total ?? 0 };
}

test.describe('long official document on a phone', () => {
  test('find: every reported match is highlighted, reached and below the chrome', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openLongDocument(page, 390);
    await page.getByRole('button', { name: 'Поиск в документе' }).click();
    const box = page.getByRole('searchbox', { name: 'Поиск в документе' });

    // Searching straight away: most sections are not mounted yet. The last match is far below.
    await box.fill('ишеми');
    await expect(page.locator('.document-find__count')).toHaveText(/^1\/\d+$/u);
    const { total } = await reportedCount(page);
    expect(total).toBeGreaterThan(150);
    await expectCurrentMarkOnScreen(page, 'first match');
    await box.press('Shift+Enter');
    await expect(page.locator('.document-find__count')).toHaveText(`${total}/${total}`);
    await expectCurrentMarkOnScreen(page, 'last match, reached through unmounted sections');

    // The first matches include table cells and the title; step through a good part of the list.
    await box.press('Enter');
    await expect(page.locator('.document-find__count')).toHaveText(`1/${total}`);
    for (let step = 1; step <= 36; step += 1) {
      await expectCurrentMarkOnScreen(page, `match ${step}`);
      await box.press('Enter');
    }
    // The reader controls (and the find bar in them) stay visible while stepping on a phone.
    await expect(page.locator('.document-find--open')).toBeInViewport();

    // Once every section is mounted, each reported match has exactly one highlighted word.
    await expect(page.locator('.document-overlay-paper__pending')).toHaveCount(0, {
      timeout: 60_000,
    });
    const sections = await page.locator('.document-overlay-section').count();
    expect(sections).toBe(await page.locator('.document-overlay-outline-section-button').count());
    await expect(page.locator('mark[data-document-find-unit]')).toHaveCount(total);

    // A short query, completely: every one of its matches.
    await box.fill('ЭКГ');
    await expect(page.locator('.document-find__count')).toHaveText(/^1\/\d+$/u);
    const ecg = await reportedCount(page);
    for (let step = 1; step <= ecg.total; step += 1) {
      await expect(page.locator('.document-find__count')).toHaveText(`${step}/${ecg.total}`);
      await expectCurrentMarkOnScreen(page, `ЭКГ ${step}`);
      await box.press('Enter');
    }
  });

  test('find bar: the counter sits in the box at a fixed width; a spinner cycles while searching', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openLongDocument(page, 390);
    await page.getByRole('button', { name: 'Поиск в документе' }).click();
    const box = page.getByRole('searchbox', { name: 'Поиск в документе' });
    const control = page.locator('.document-find .archive-search__control');
    const status = page.locator('.document-find__status');

    await box.fill('пациент');
    await expect(page.locator('.document-find__count')).toHaveText(/^1\/\d+$/u);
    const first = {
      input: await box.boundingBox(),
      status: await status.boundingBox(),
      control: await control.boundingBox(),
    };
    await box.press('Enter');
    await expect(page.locator('.document-find__count')).toHaveText(/^2\/\d+$/u);
    const second = { input: await box.boundingBox(), status: await status.boundingBox() };
    for (const sample of [first, second]) {
      expect(sample.input).not.toBeNull();
      expect(sample.status).not.toBeNull();
    }
    // The text box does not move or resize when the counter changes.
    expect(second.input).toEqual(first.input);
    expect(second.status).toEqual(first.status);
    // The counter is inside the field, to the right of the typed text.
    const controlBox = first.control;
    const statusBox = first.status;
    const inputBox = first.input;
    if (!controlBox || !statusBox || !inputBox) throw new Error('Find bar boxes are missing.');
    expect(statusBox.x).toBeGreaterThanOrEqual(inputBox.x + inputBox.width - 1);
    expect(statusBox.x + statusBox.width).toBeLessThanOrEqual(controlBox.x + controlBox.width + 1);
    await expect(page.locator('.document-find__count')).toHaveCSS(
      'font-variant-numeric',
      /tabular-nums/u,
    );

    // A slow search: hold the worker's answer back and watch the spinner.
    await page.evaluate(() => {
      const original = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function delayedPostMessage(
        this: Worker,
        message: unknown,
        ...rest: unknown[]
      ): void {
        const type = (message as { type?: string } | null)?.type;
        if (type === 'find') {
          window.setTimeout(() => original.call(this, message, ...(rest as [])), 2500);
          return;
        }
        original.call(this, message, ...(rest as []));
      };
      (window as unknown as { __restoreWorker: () => void }).__restoreWorker = () => {
        Worker.prototype.postMessage = original;
      };
    });
    await box.fill('ишеми');
    const spinner = page.locator('.ascii-spinner');
    await expect(spinner).toBeVisible();
    const seen = new Set<string>();
    for (let sample = 0; sample < 24; sample += 1) {
      seen.add((await spinner.textContent()) ?? '');
      await page.waitForTimeout(60);
    }
    for (const frame of seen) expect(['|', '/', '–', '\\']).toContain(frame);
    expect(seen.size).toBeGreaterThanOrEqual(3);
    // The slot is as wide while searching as with a count: the text does not jump.
    expect(await status.boundingBox()).toEqual(first.status);
    expect(await box.boundingBox()).toEqual(first.input);
    await expect(page.locator('.document-find__count')).toHaveText(/^1\/\d+$/u, {
      timeout: 15_000,
    });
    await expect(spinner).toHaveCount(0);
    await page.evaluate(() =>
      (window as unknown as { __restoreWorker: () => void }).__restoreWorker(),
    );

    // Reduced motion: the mark stands still.
    await page.evaluate(() => {
      const original = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function delayedPostMessage(
        this: Worker,
        message: unknown,
        ...rest: unknown[]
      ): void {
        const type = (message as { type?: string } | null)?.type;
        if (type === 'find') {
          window.setTimeout(() => original.call(this, message, ...(rest as [])), 2500);
          return;
        }
        original.call(this, message, ...(rest as []));
      };
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await box.fill('ишемия');
    await expect(spinner).toBeVisible();
    const still = new Set<string>();
    for (let sample = 0; sample < 12; sample += 1) {
      still.add((await spinner.textContent()) ?? '');
      await page.waitForTimeout(60);
    }
    expect(still.size).toBe(1);
  });

  test('table of contents: a far heading is reached with one tap, even while sections mount', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openLongDocument(page, 390);
    await assertOneTapJumps(page, 390);
  });
});

test.describe('long official document on a desktop', () => {
  test('table of contents: far headings are reached with one tap; find lands below the chrome', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openLongDocument(page, 1280);
    await assertOneTapJumps(page, 1280);

    await page.getByRole('button', { name: 'Поиск в документе' }).click();
    const box = page.getByRole('searchbox', { name: 'Поиск в документе' });
    await box.fill('ЭКГ');
    await expect(page.locator('.document-find__count')).toHaveText(/^1\/\d+$/u);
    const { total } = await reportedCount(page);
    for (let step = 1; step <= total; step += 1) {
      await expectCurrentMarkOnScreen(page, `ЭКГ ${step}`);
      await box.press('Enter');
    }
  });
});

async function assertOneTapJumps(page: Page, width: number): Promise<void> {
  const items = page.locator('.document-overlay-outline-section-button');
  const count = await items.count();
  expect(count).toBeGreaterThan(50);
  // The last heading first, while the idle batches are still mounting, then nearer and farther ones.
  for (const index of [count - 1, 40, 12, count - 5, 25, 3]) {
    if (width < 761 && (await page.locator('.document-overlay-outline--open').count()) === 0) {
      await page.locator('.document-overlay-outline-toggle').click();
      await expect(page.locator('.document-overlay-outline--open')).toBeVisible();
    }
    const item = items.nth(index);
    const anchor = await item.getAttribute('data-section-anchor');
    expect(anchor).not.toBeNull();
    await item.scrollIntoViewIfNeeded();
    await item.click();
    await waitForScrollToSettle(page);
    const landing = await page.evaluate((id) => {
      const section = id ? document.getElementById(id) : null;
      return {
        present: Boolean(section),
        // A section inside a skipped (content-visibility) ancestor reports a stale box.
        rendered: section?.checkVisibility({ contentVisibilityAuto: true } as never) ?? false,
        top: section?.getBoundingClientRect().top ?? Number.NaN,
        margin: section ? Number.parseFloat(getComputedStyle(section).scrollMarginTop) : Number.NaN,
      };
    }, anchor);
    expect(landing.present, `heading ${index} is in the page`).toBe(true);
    expect(landing.rendered, `heading ${index} is rendered, not a stale box`).toBe(true);
    expect(
      Math.abs(landing.top - landing.margin),
      `heading ${index} sits under the chrome`,
    ).toBeLessThanOrEqual(3);
    await expect(item).toHaveClass(/document-overlay-outline-section-button--active/u);
  }
}
