import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, type Page, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN } from './mount-built-app';

// The doctor's diaries on a phone, against the real diary service on a scratch database: the list
// is kept for the life of the page (a tab round trip shows it at once, no skeleton, no new read),
// and the QR sheet keeps one size from its first frame to the code.

const ROOT = resolve(import.meta.dirname, '../../..');
let server: ChildProcess | undefined;
let directory = '';
let service = '';

test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'minimed-diary-return-'));
  const port = 8_910 + test.info().workerIndex;
  service = `http://127.0.0.1:${port}`;
  server = spawn('bun', ['apps/diary-server/src/main.ts'], {
    cwd: ROOT,
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: process.env['HOME'] ?? '',
      DIARY_SIGNUP: 'open',
      DIARY_DB: join(directory, 'diary.db'),
      DIARY_PORT: String(port),
    },
    stdio: 'ignore',
  });
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`${service}/api/health`)).ok;
        } catch {
          return false;
        }
      },
      { timeout: 20_000 },
    )
    .toBe(true);
});

test.afterAll(() => {
  server?.kill();
  rmSync(directory, { recursive: true, force: true });
});

test.use({ viewport: { width: 390, height: 844 } });

/** Signs in to the demo account (four demo patients) and waits for the list. */
async function openDemoList(page: Page): Promise<void> {
  await page.route(`${E2E_ASSET_ORIGIN}/api/**`, (route) =>
    route.continue({ url: route.request().url().replace(E2E_ASSET_ORIGIN, service) }),
  );
  await page.goto(`${E2E_ASSET_ORIGIN}/?profile=diaries#/notes/diaries`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('button', { name: 'Демо — без регистрации' }).click();
  await expect(page.locator('.diary-dash-row')).toHaveCount(4, { timeout: 120_000 });
}

/** Animations of the sheet itself that are still playing (the finished rise is kept by its fill). */
const running = (element: Element): number =>
  element.getAnimations().filter((animation) => animation.playState === 'running').length;

const tab = (page: Page, name: string) =>
  page.locator('nav.app-bottom-nav').getByRole('button', { name });

test('a tab round trip shows the list at once: no skeleton, no new read of the patients', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openDemoList(page);
  // Opens the settings first, so that the next return is not the first visit of a tab.
  await tab(page, 'Настройки').click();
  await expect(page).toHaveURL(/#\/settings/u);
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    const seen: string[] = [];
    Object.assign(window, { __skeletons: seen });
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches('.patient-rows-skeleton, .page-skeleton')) seen.push(node.className);
          for (const inner of node.querySelectorAll('.patient-rows-skeleton, .page-skeleton')) {
            seen.push(inner.className);
          }
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
  const reads: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/patients')) reads.push(`${request.method()} ${url.pathname}`);
  });

  await tab(page, 'Пациенты').click();
  await expect(page.locator('.diary-dash-row').first()).toBeVisible({ timeout: 2_000 });
  await expect(page.locator('.diary-dash-row')).toHaveCount(4);
  await page.waitForTimeout(800);

  expect(
    await page.evaluate(() => (window as unknown as { __skeletons: string[] }).__skeletons),
  ).toEqual([]);
  // The list was read moments ago: coming back does not read it again.
  expect(reads).toEqual([]);
  await expect(page.getByTestId('diary-offline')).toHaveCount(0);

  // A patient, back, another tab and back again: still the same list, still no skeleton.
  await page.locator('.diary-dash-row__open').first().click();
  await expect(page.getByTestId('diary-overview')).toBeVisible({ timeout: 30_000 });
  await page.goBack();
  await expect(page.locator('.diary-dash-row')).toHaveCount(4);
  expect(
    await page.evaluate(() => (window as unknown as { __skeletons: string[] }).__skeletons),
  ).toEqual([]);
});

test('the QR sheet has its code’s size from the first frame, and the code fades in over it', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await openDemoList(page);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  // The one-time code is made by the service: hold its answer while the sheet is looked at.
  await page.route(`${E2E_ASSET_ORIGIN}/api/patients/*/pairings`, async (route) => {
    await gate;
    await route.continue({ url: route.request().url().replace(E2E_ASSET_ORIGIN, service) });
  });

  await page.locator('.diary-dash-row__open').first().dispatchEvent('contextmenu');
  await page.getByRole('menuitem', { name: 'QR-код и ссылка для пациента' }).click();
  const sheet = page.getByRole('dialog', { name: 'QR-код и ссылка для пациента' });
  const box = page.locator('.diary-pair__code-box');
  await expect(box).toBeVisible();
  await expect(page.getByTestId('pair-skeleton')).toBeVisible();
  await expect.poll(() => sheet.evaluate(running)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('qr-loading.png') });

  const loading = {
    box: await box.boundingBox(),
    sheet: await sheet.boundingBox(),
  };
  expect(Math.round(loading.box?.width ?? 0)).toBe(Math.round(loading.box?.height ?? -1));
  // The copy button is there, waiting.
  await expect(page.getByRole('button', { name: 'Копировать ссылку' })).toBeDisabled();

  release();
  const code = page.locator('img.diary-pair__code');
  await expect(code).toBeVisible();
  await expect(page.locator('.diary-pair__code--shown')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Копировать ссылку' })).toBeEnabled();
  await expect
    .poll(() => page.getByTestId('pair-skeleton').evaluate((el) => getComputedStyle(el).visibility))
    .toBe('hidden');
  await page.screenshot({ path: testInfo.outputPath('qr-loaded.png') });

  const loaded = {
    box: await box.boundingBox(),
    code: await code.boundingBox(),
    sheet: await sheet.boundingBox(),
  };
  // Nothing moved: the code sits where its placeholder was, the sheet kept its height.
  expect(loaded.box).toEqual(loading.box);
  expect(loaded.code).toEqual(loading.box);
  expect(loaded.sheet).toEqual(loading.sheet);
});

test('a sheet grows and shrinks with its content, and takes a change at once while it is pulled', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openDemoList(page);
  await page.locator('.diary-dash-row__open').first().dispatchEvent('contextmenu');
  await page.getByRole('menuitem', { name: 'QR-код и ссылка для пациента' }).click();
  const sheet = page.getByRole('dialog', { name: 'QR-код и ссылка для пациента' });
  await expect(page.locator('.diary-pair__code--shown')).toBeVisible();
  await expect.poll(() => sheet.evaluate(running)).toBe(0);

  /** The sheet's height on each frame while `change` runs on its body. */
  const heights = (change: string): Promise<number[]> =>
    sheet.evaluate(async (element, source) => {
      const body = element.querySelector<HTMLElement>('.overlay-dialog-body');
      if (!body) throw new Error('no body');
      const seen: number[] = [];
      let running = true;
      const sample = (): void => {
        seen.push(element.getBoundingClientRect().height);
        if (running) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      new Function('body', source)(body);
      await new Promise((done) => setTimeout(done, 600));
      running = false;
      return seen;
    }, change);
  /** Frames whose height lies strictly between the two (the sheet was on its way, not at either). */
  const between = (values: readonly number[], low: number, high: number): number =>
    values.filter((value) => value > Math.min(low, high) + 4 && value < Math.max(low, high) - 4)
      .length;

  const before = (await sheet.boundingBox())?.height ?? 0;
  const added =
    "const probe = document.createElement('div'); probe.id = 'probe'; probe.style.height = '120px'; body.append(probe);";
  const grew = await heights(added);
  const taller = grew.at(-1) ?? 0;
  expect(taller).toBeCloseTo(before + 120, 0);
  // Between the old and the new height there are frames in between: it moved, it did not jump.
  expect(between(grew, before, taller)).toBeGreaterThan(3);

  const shrank = await heights("document.getElementById('probe')?.remove();");
  expect(shrank.at(-1)).toBeCloseTo(before, 0);
  expect(between(shrank, before, taller)).toBeGreaterThan(3);

  // Pulled by a finger, the sheet takes a change at once: no animation works against the drag.
  const grip = await page.locator('.overlay-dialog__grip').boundingBox();
  if (!grip) throw new Error('no grip');
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 4);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 30, { steps: 4 });
  const pulled = await heights(added);
  await page.mouse.up();
  expect(between(pulled, before, taller)).toBe(0);
  expect(pulled.at(-1)).toBeCloseTo(taller, 0);
});
