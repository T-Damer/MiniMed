import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

import { expect, type Page, test } from '@playwright/test';

import { buildSkinPackZip } from '../src/features/skin/skin-pack-fixture';
import { mountBuiltApp } from './mount-built-app';

// «Кожа по фото»: the TV, the upload door, the scan, the ranking, the details that re-rank it, the
// gallery, and the page with the model missing. The weights are not in the repository, so the
// specs put a model of their own on `window` (skin-model-test-hook.ts); the camera is faked with a
// canvas stream whose track reports zoom and torch.
// Screenshots: SKIN_SHOTS=<directory>.
const SHOTS = process.env['SKIN_SHOTS'];

const classes = (
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../src/features/skin/skin-classes.json'), 'utf8'),
  ) as { classes: { id: string; ru: string; icd10: string[]; malignant: boolean }[] }
).classes;
const [first, second, third] = classes;
if (!first || !second || !third) throw new Error('The class list is too short.');

/** Chooses one value in a dropdown field: opens it, taps the value, closes it. */
async function pick(page: Page, fieldTestId: string, label: string): Promise<void> {
  await page.getByTestId(fieldTestId).getByRole('button').click();
  await page.getByRole('dialog').getByRole('button', { name: label, exact: true }).click();
  await page.keyboard.press('Escape');
}

/** Runs a header action that lives in the «⋯» menu (the menu takes the keyboard, as a user's tap). */
async function menuAction(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: 'Ещё' }).click();
  await page.getByRole('menuitem', { name: label, exact: true }).press('Enter');
}

const PREFERENCES = {
  'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
};

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

/** A 240 × 160 skin-toned gradient with a darker spot: non-square on purpose (the TV crops it). */
function testPhoto(): Buffer {
  const width = 240;
  const height = 160;
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) {
      const distance = Math.hypot(x - 120, y - 80);
      const spot = distance < 24 ? 0.55 : 1;
      row[1 + x * 3] = Math.round((205 - y * 0.2) * spot);
      row[2 + x * 3] = Math.round((150 - x * 0.1) * spot);
      row[3 + x * 3] = Math.round(125 * spot);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The model the page runs against: ready or missing; a foot shifts the order of the first two. */
async function installModel(page: Page, status: 'ready' | 'missing'): Promise<void> {
  await page.addInitScript(
    ({ ids, modelStatus }) => {
      const model = {
        status: async () => modelStatus,
        analyze: async (_photo: Blob, details: { sites?: string[] }) => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          const order = details.sites?.includes('foot')
            ? [ids[1], ids[0], ids[2]]
            : ids.slice(0, 3);
          const rest = ids.filter((id: string) => !order.includes(id));
          const head = [0.52, 0.27, 0.12];
          const predictions = [
            ...order.map((classId: string, index: number) => ({
              classId,
              probability: head[index] ?? 0.05,
            })),
            ...rest.map((classId: string) => ({ classId, probability: 0.09 / rest.length })),
          ];
          return { predictions, malignantScore: 0.03, malignantFlag: false, uncertain: false };
        },
      };
      (window as unknown as Record<string, unknown>)['__minimedSkinTestModel'] = model;
    },
    { ids: classes.map((entry) => entry.id), modelStatus: status },
  );
}

/** No camera at all: the TV shows its snow. */
async function withoutCamera(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: () => Promise.reject(new DOMException('no camera', 'NotFoundError')),
        enumerateDevices: async () => [],
      },
    });
  });
}

/** Uncaught errors of the page: none may happen while the tool is used. */
function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function openTool(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true, localStorage: PREFERENCES });
  await page.evaluate(() => {
    window.location.hash = '#/notes/skin-photo';
  });
  await expect(page.getByRole('heading', { name: 'Кожа по фото', level: 1 })).toBeVisible();
}

async function shoot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  // Let sheets finish rising and the TV finish shrinking.
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function upload(page: Page): Promise<void> {
  await page
    .getByTestId('skin-file')
    .setInputFiles({ name: 'skin.png', mimeType: 'image/png', buffer: testPhoto() });
  await expect(page.getByTestId('skin-photo')).toBeVisible();
}

test('a photo uploaded through the screen is scanned, ranked, re-ranked by details and kept in the gallery', async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  await installModel(page, 'ready');
  await withoutCamera(page);
  await openTool(page);

  // «?»: what the model was trained on and the classes it knows, stated plainly.
  await page.getByRole('button', { name: 'Как это работает' }).click();
  const help = page.locator('.page__help-body');
  await expect(help).toContainText('SCIN');
  await expect(help).toContainText('PAD-UFES-20');
  await expect(help).toContainText(first.ru);
  await expect(help).not.toContainText('не заменяет');
  await shoot(page, 'help');
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);

  // No camera: snow with the invitation; tapping the screen offers the file picker.
  const screen = page.getByTestId('skin-screen');
  await expect(screen).toHaveAttribute('data-feed', 'static');
  await expect(page.getByTestId('skin-pick')).toContainText('Нажмите, чтобы загрузить фото');
  await shoot(page, 'tv-static');
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('skin-pick').click();
  expect((await chooser).isMultiple()).toBe(false);

  await upload(page);
  await expect(page.getByTestId('skin-retake')).toBeVisible();
  await shoot(page, 'tv-captured');

  // The details appear one group after another; the place is a dropdown field.
  const details = page.getByTestId('skin-details');
  await expect(details.getByRole('group')).toHaveCount(1);
  await pick(page, 'skin-pick-sites', 'Рука');
  await expect(details.getByRole('group')).toHaveCount(2);

  await page.getByTestId('skin-analyze').click();
  await expect(page.getByTestId('skin-scan')).toBeVisible();
  await shoot(page, 'tv-scanning');
  const cards = page.getByTestId('skin-result');
  await expect(cards.first()).toBeVisible();
  const count = await cards.count();
  expect(count).toBeGreaterThanOrEqual(1);
  expect(count).toBeLessThanOrEqual(3);
  await expect(cards.first()).toContainText(first.ru);
  await expect(cards.first()).toContainText('52%');
  if (first.icd10.length > 0) await expect(cards.first()).toContainText(first.icd10[0] ?? '');
  await expect(cards.first().getByTestId('skin-search-link')).toHaveAttribute(
    'href',
    `#/search?q=${encodeURIComponent(first.ru)}`,
  );
  // The TV shrank to make room.
  await expect(page.locator('.skin-tv--compact')).toHaveCount(1);
  await shoot(page, 'results');

  // A foot changes the order in place; the same cards move rather than being replaced.
  const firstCard = cards.first();
  await firstCard.evaluate((element) => {
    element.setAttribute('data-marked', 'yes');
  });
  await pick(page, 'skin-pick-sites', 'Стопа');
  await expect(cards.first()).toContainText(second.ru, { timeout: 10_000 });
  await expect(page.locator('[data-marked="yes"]')).toHaveCount(1);
  await expect(page.locator('[data-marked="yes"]')).toContainText(first.ru);

  // One entry in the gallery, with the note typed into it saved as a draft.
  await menuAction(page, 'История снимков');
  const thumbs = page.getByTestId('skin-history-thumb');
  await expect(thumbs).toHaveCount(1);
  await shoot(page, 'history');
  await thumbs.first().click();
  const item = page.getByTestId('skin-history-item');
  await expect(item).toBeVisible();
  await expect(item.getByTestId('skin-result').first()).toContainText(second.ru);
  await item.getByTestId('skin-note').fill('контроль через месяц');
  await page.waitForTimeout(900);
  await page.keyboard.press('Escape');
  await expect(item).toHaveCount(0);
  await thumbs.first().click();
  await expect(page.getByTestId('skin-note')).toHaveValue('контроль через месяц');
  await shoot(page, 'history-item');

  // Deleting asks first, in place.
  await page.getByTestId('skin-delete').click();
  await expect(page.getByText('Удалить снимок?')).toBeVisible();
  await page.getByTestId('skin-delete-confirm').click();
  await expect(page.getByTestId('skin-history-empty')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the page works with the model missing: the photo is kept and the state is said in place', async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  await installModel(page, 'missing');
  await withoutCamera(page);
  await openTool(page);
  await upload(page);
  await page.getByTestId('skin-analyze').click();
  await expect(page.getByTestId('skin-model-missing')).toContainText('Модель не найдена');
  // The published pack is offered right there (installing it is the next test's subject).
  await expect(page.getByTestId('skin-model-missing').getByTestId('skin-pack-offer')).toBeVisible();
  await expect(page.getByTestId('skin-scan')).toHaveCount(0);
  await expect(page.getByTestId('skin-result')).toHaveCount(0);
  await shoot(page, 'model-missing');

  // The gallery still holds the shot, without a ranking.
  await menuAction(page, 'История снимков');
  await expect(page.getByTestId('skin-history-thumb')).toHaveCount(1);
  await page.getByTestId('skin-history-thumb').first().click();
  await expect(page.getByTestId('skin-history-item')).toContainText('Без анализа');

  // Retaking returns to the TV.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('skin-history-item')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('skin-history-grid')).toHaveCount(0);
  await page.getByTestId('skin-retake').click();
  await expect(page.getByTestId('skin-pick')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a camera that reports zoom and torch gets exactly those controls, and the shutter freezes the frame', async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  await installModel(page, 'ready');
  await page.addInitScript(() => {
    const applied: unknown[] = [];
    (window as unknown as Record<string, unknown>)['__applied'] = applied;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: async () => [{ kind: 'videoinput' }],
        getUserMedia: async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 320;
          canvas.height = 240;
          const context = canvas.getContext('2d');
          let tick = 0;
          const paint = (): void => {
            if (!context) return;
            context.fillStyle = `hsl(${(tick * 3) % 360} 40% 55%)`;
            context.fillRect(0, 0, 320, 240);
            tick += 1;
          };
          paint();
          window.setInterval(paint, 50);
          const stream = canvas.captureStream(15);
          const track = stream.getVideoTracks()[0];
          if (!track) throw new Error('no track');
          track.getCapabilities = () =>
            ({ zoom: { min: 0.5, max: 4, step: 0.1 }, torch: true }) as MediaTrackCapabilities;
          track.applyConstraints = async (constraints) => {
            applied.push(constraints);
          };
          return stream;
        },
      },
    });
  });
  await openTool(page);

  await expect(page.getByTestId('skin-screen')).toHaveAttribute('data-feed', 'live');
  const zoom = page.getByRole('group', { name: 'Масштаб' });
  await expect(zoom.getByRole('button')).toHaveText(['0.5×', '1×', '2×', '3×']);
  await expect(page.getByTestId('skin-torch')).toBeVisible();
  // The device reports no focus distance: no close-focus knob.
  await expect(page.getByTestId('skin-macro')).toHaveCount(0);
  await shoot(page, 'tv-live');

  await zoom.getByRole('button', { name: '2×' }).click();
  await expect(zoom.getByRole('button', { name: '2×' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('skin-torch').click();
  await expect(page.getByTestId('skin-torch')).toHaveAttribute('aria-pressed', 'true');
  const applied = await page.evaluate(
    () => (window as unknown as { __applied: unknown[] }).__applied,
  );
  expect(applied).toEqual([{ advanced: [{ zoom: 2 }] }, { advanced: [{ torch: true }] }]);

  // The shutter freezes the frame; the camera stops and the retake button returns to the feed.
  await page.getByTestId('skin-shutter').click();
  await expect(page.getByTestId('skin-photo')).toBeVisible();
  await expect(page.getByTestId('skin-analyze')).toBeVisible();
  await page.getByTestId('skin-retake').click();
  await expect(page.getByTestId('skin-screen')).toHaveAttribute('data-feed', 'live');
  expect(errors).toEqual([]);
});

test('the home carousel and the tool list offer the tool only with experimental modules on', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true, localStorage: PREFERENCES });
  const card = page.locator('.home-feature', { hasText: 'Кожа по фото' });
  await expect(card.getByRole('link', { name: 'Открыть камеру' })).toHaveAttribute(
    'href',
    '#/notes/skin-photo',
  );
  await page.getByRole('button', { name: 'Все инструменты', exact: true }).click();
  await expect(
    page
      .getByRole('dialog', { name: 'Все инструменты' })
      .locator('.quick-tool-row__open', { hasText: 'Кожа по фото' }),
  ).toBeVisible();
});

test('without experimental modules the card is gone and the address leads back to the files', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    localStorage: {
      'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: false }),
    },
  });
  await expect(page.locator('.home-feature', { hasText: 'Кожа по фото' })).toHaveCount(0);
  await page.evaluate(() => {
    window.location.hash = '#/notes/skin-photo';
  });
  await expect(page.getByRole('heading', { name: 'Кожа по фото' })).toHaveCount(0);
});

test('the atlas says how dangerous the variants are and shows drawn references', async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  // A benign first guess with melanoma close behind: the danger follows the melanoma.
  await page.addInitScript(
    ({ ids }) => {
      (window as unknown as Record<string, unknown>)['__minimedSkinTestModel'] = {
        status: async () => 'ready',
        analyze: async () => {
          const head: Record<string, number> = { nevus: 0.6, melanoma: 0.25 };
          const rest = 0.15 / (ids.length - 2);
          return {
            predictions: ids
              .map((classId: string) => ({ classId, probability: head[classId] ?? rest }))
              .toSorted((left, right) => right.probability - left.probability),
            malignantScore: 0.26,
            malignantFlag: false,
            uncertain: false,
          };
        },
      };
    },
    { ids: classes.map((entry) => entry.id) },
  );
  await withoutCamera(page);
  await openTool(page);
  await upload(page);
  await page.getByTestId('skin-analyze').click();

  const banner = page.getByTestId('skin-danger');
  await expect(banner).toHaveAttribute('data-level', 'high');
  await expect(banner).toContainText('Меланома среди вариантов');
  await expect(page.getByTestId('skin-result').first().getByTestId('skin-art-strip')).toBeVisible();
  await shoot(page, 'atlas-danger');

  // The banner opens the atlas on the condition that set the level.
  await banner.click();
  const entry = page.getByTestId('skin-atlas-entry');
  await expect(entry).toHaveAttribute('data-condition', 'melanoma');
  await expect(entry.locator('.skin-atlas__art')).toHaveCount(3);
  await expect(entry).toContainText('Тревожные признаки');
  await shoot(page, 'atlas-entry');
  await page.getByRole('button', { name: 'Все состояния' }).click();
  await expect(page.getByTestId('skin-atlas-index')).toBeVisible();
  await page.keyboard.press('Escape');

  // A description alone reaches what the photo model does not know: Koplik spots are urgent.
  const findings = page.getByTestId('skin-findings');
  await pick(page, 'skin-findings-elements', 'Папула');
  await pick(page, 'skin-findings-colors', 'Белый');
  await findings.getByRole('button', { name: 'На слизистой', exact: true }).click();
  await findings.getByRole('button', { name: 'Лихорадка', exact: true }).click();
  await expect(page.getByTestId('skin-described-item').first()).toHaveAttribute(
    'data-condition',
    'measles_koplik',
  );
  await expect(page.getByTestId('skin-danger')).toHaveAttribute('data-level', 'urgent');
  await shoot(page, 'atlas-described');
  expect(errors).toEqual([]);
});

const PACK_TAG = 'skin-pack-e2e';
const PACK_FILE = 'minimed-skin-pack-e2e.zip';

interface ServedPack {
  readonly photoClasses: readonly string[];
}

/**
 * Serves a pack of the spec's own as the release asset and points the catalog at it (the checksum of
 * a pack built here is not the catalog's, so the spec declares the catalog entry). The model inside
 * is a stub: it installs, but is not a graph the runtime can run.
 */
async function servePack(page: Page, served: ServedPack): Promise<{ readonly bytes: number }> {
  const zip = Buffer.from(
    await buildSkinPackZip({
      classIds: classes.map((entry) => entry.id),
      photoClasses: served.photoClasses,
      perClass: 3,
    }),
  );
  const item = {
    id: 'skin-pack-e2e',
    name: 'Кожа по фото',
    description: 'e2e',
    version: '2026.10.30',
    bundleUrl: `https://github.com/T-Damer/MiniMed/releases/download/${PACK_TAG}/${PACK_FILE}`,
    bundleSha256: createHash('sha256').update(zip).digest('hex'),
    downloadBytes: zip.byteLength,
  };
  await page.addInitScript((catalog) => {
    (window as unknown as Record<string, unknown>)['__minimedSkinPackCatalog'] = catalog;
  }, item);
  // A developer's own `public/models/skin/` must not stand in for the pack under test.
  await page.route('**/models/skin/**', (route) => route.fulfill({ status: 404 }));
  await page.route(`**/content/releases/${PACK_TAG}/${PACK_FILE}*`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/zip', body: zip }),
  );
  return { bytes: zip.byteLength };
}

test('with the model missing the download is offered in place, installs, and the photo is ranked', async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  const { bytes } = await servePack(page, { photoClasses: ['melanoma'] });
  await withoutCamera(page);
  await openTool(page);

  // The offer sits under the TV before anything is photographed: icon, text and the size.
  const offer = page.getByTestId('skin-pack-offer');
  await expect(offer).toBeVisible();
  await expect(offer).toContainText('Скачать модель');
  await expect(offer).toContainText(/\d+(?:,\d)? (?:КБ|МБ)/u);
  expect(bytes).toBeGreaterThan(0);
  await shoot(page, 'pack-offer');

  // A photo taken meanwhile is kept; the result area says the model is missing and offers it too.
  await upload(page);
  await page.getByTestId('skin-analyze').click();
  await expect(page.getByTestId('skin-model-missing').getByTestId('skin-pack-offer')).toBeVisible();
  await expect(page.getByTestId('skin-pack-offer')).toHaveCount(1);

  // The tap is the consent; the pack installs and the same photo is run against its model. The
  // stub graph cannot be run, so the run ends in the failed state, not in «Модель не найдена».
  await page.getByTestId('skin-pack-offer').click();
  await expect(page.getByTestId('skin-pack-offer')).toHaveCount(0);
  await expect(page.getByTestId('skin-failed')).toBeVisible();
  await expect(page.getByTestId('skin-model-missing')).toHaveCount(0);
  const stored = await page.evaluate(() => localStorage.getItem('minimed.skin-pack'));
  expect(stored).toContain('"photoCount":3');
  expect(errors).toEqual([]);
});

test('the installed pack puts its photos in the atlas; a tap opens one with its credit; removing restores the drawings', async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  await servePack(page, { photoClasses: ['melanoma'] });
  await withoutCamera(page);
  await openTool(page);

  // Before the pack: the drawn references.
  await page.getByRole('button', { name: 'Ещё' }).click();
  await page.getByRole('menuitem', { name: 'Атлас кожи', exact: true }).press('Enter');
  await expect(page.getByTestId('skin-atlas-index')).toBeVisible();
  await page.getByRole('button', { name: 'Меланома', exact: false }).first().click();
  const entry = page.getByTestId('skin-atlas-entry');
  await expect(entry).toHaveAttribute('data-condition', 'melanoma');
  await expect(entry.locator('.skin-atlas__art')).toHaveCount(3);
  await expect(page.getByTestId('skin-atlas-photo')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(entry).toHaveCount(0);

  // Install through the settings card (the same pack the tool offers), then reopen the atlas.
  await page.evaluate(() => {
    window.location.hash = '#/settings/ai';
  });
  const card = page.locator('.skin-pack-settings');
  await expect(card).toContainText('Не скачано');
  await card.getByRole('button', { name: 'Скачать' }).click();
  await expect(card).toContainText('Готово к работе');
  await page.evaluate(() => {
    window.location.hash = '#/notes/skin-photo';
  });
  await expect(page.getByRole('heading', { name: 'Кожа по фото', level: 1 })).toBeVisible();
  await expect(page.getByTestId('skin-pack-offer')).toHaveCount(0);

  await page.getByRole('button', { name: 'Ещё' }).click();
  await page.getByRole('menuitem', { name: 'Атлас кожи', exact: true }).press('Enter');
  // Melanoma has photos; a condition the pack has none for keeps its drawing in the index.
  const photoCell = page.locator('.skin-atlas__cell', { hasText: 'Меланома' }).first();
  await expect(photoCell.locator('.skin-atlas__cell-photo')).toBeVisible();
  await photoCell.click();
  await expect(entry).toHaveAttribute('data-condition', 'melanoma');
  const photos = page.getByTestId('skin-atlas-photo');
  await expect(photos).toHaveCount(3);
  await expect(entry.locator('.skin-atlas__art')).toHaveCount(0);
  const image = photos.first().locator('img');
  await expect(image).toHaveAttribute('src', /^blob:/u);
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBeGreaterThan(0);
  // The photo keeps its proportions (64 × 48) and no credit is on the page itself.
  const box = await photos.first().boundingBox();
  expect(box ? box.width / box.height : 0).toBeCloseTo(64 / 48, 1);
  await expect(page.getByTestId('skin-photo-credit')).toHaveCount(0);
  await shoot(page, 'atlas-photos');

  await photos.first().click();
  const credit = page.getByTestId('skin-photo-credit');
  await expect(credit).toContainText('SCIN (Google)');
  await expect(credit).toContainText('SCIN Data Use License');
  await expect(credit.getByRole('link', { name: 'Источник' })).toHaveAttribute(
    'href',
    'https://example.test/photo',
  );
  await shoot(page, 'atlas-photo-open');
  await page.keyboard.press('Escape');
  await expect(credit).toHaveCount(0);
  await expect(entry).toBeVisible();
  await page.keyboard.press('Escape');

  // Removing the pack returns the drawings.
  await page.evaluate(() => {
    window.location.hash = '#/settings/ai';
  });
  await card.getByRole('button', { name: 'Удалить' }).click();
  await expect(card).toContainText('Не скачано');
  await page.evaluate(() => {
    window.location.hash = '#/notes/skin-photo';
  });
  await expect(page.getByRole('heading', { name: 'Кожа по фото', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Ещё' }).click();
  await page.getByRole('menuitem', { name: 'Атлас кожи', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Меланома', exact: false }).first().click();
  await expect(entry.locator('.skin-atlas__art')).toHaveCount(3);
  expect(errors).toEqual([]);
});
