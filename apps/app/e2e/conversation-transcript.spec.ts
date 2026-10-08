import { expect, type Page, test } from '@playwright/test';
import { installDeviceKeyAndSpeech, installFakeSpeech } from './fake-speech';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

const chromiumPath = process.env.CHROMIUM_PATH;

test.use({
  permissions: ['microphone'],
  viewport: { width: 375, height: 812 },
  launchOptions: {
    ...(chromiumPath ? { executablePath: chromiumPath } : {}),
    args: ['--mute-audio', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
});

async function openLiveWindow(page: Page) {
  await page.getByRole('button', { name: 'Все инструменты', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Все инструменты' });
  await sheet.locator('.quick-tool-row__open', { hasText: 'Запись беседы' }).click();
  await page
    .locator('.conversation-bar')
    .getByRole('button', { name: /Открыть окно с текстом/u })
    .click();
  const live = page.getByTestId('conversation-live');
  await expect(live).toBeVisible();
  return live;
}

test('the model installs in place mid-recording, the text is saved encrypted and survives a crash', async ({
  page,
}) => {
  await installDeviceKeyAndSpeech(page);
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  const live = await openLiveWindow(page);

  // No model yet: the install card stands where the text will be, with the size on the button.
  const card = live.locator('.asr-model-card');
  await expect(
    card.getByText('Загрузите модель, чтобы голос автоматически превращался в текст'),
  ).toBeVisible();
  const download = card.getByRole('button', { name: /Скачать · \d+ МБ/u });
  await expect(download).toBeVisible();
  await expect(live.getByText('модель можно загрузить в настройках')).toHaveCount(0);
  await expect(live.getByText('нигде не сохраняется')).toHaveCount(0);

  const timeBefore = await live.locator('.conversation-live__time').textContent();
  await download.click();
  // Progress lives inside the same button; the recording keeps running and nothing is blocked.
  await expect(card.locator('.asr-model-card__action--busy')).toBeVisible();
  await expect(live.locator('.conversation-live__time')).not.toHaveText(timeBefore ?? '');

  // The model becomes ready: the card gives way to the text area.
  await expect(card).toBeHidden({ timeout: 15_000 });
  await expect(live.getByRole('status', { name: 'Слушаем' })).toBeVisible();

  // Audio recorded before and after the model arrived is recognised from the beginning.
  const lines = live.locator('.conversation-live__line');
  await expect(lines.first()).toHaveText('Фраза номер 1', { timeout: 30_000 });

  // The autosave wrote the text into the encrypted vault, not into any plain store.
  await expect(live.locator('.conversation-save--saved')).toBeVisible({ timeout: 15_000 });
  const stored = await page.evaluate(
    () =>
      new Promise<{ readonly encrypted: boolean; readonly leaks: boolean; readonly ids: string[] }>(
        (resolve, reject) => {
          const open = indexedDB.open('minimed-patient-vault-v3');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const database = open.result;
            const request = database.transaction('blobs').objectStore('blobs').getAll();
            request.onsuccess = () => {
              const blobs = request.result as { id: string; storage: string }[];
              const transcript = blobs.find((blob) =>
                blob.id.startsWith('conversation-transcript-'),
              );
              resolve({
                encrypted: transcript?.storage === 'encrypted',
                leaks: JSON.stringify(blobs).includes('Фраза'),
                ids: blobs.map((blob) => blob.id),
              });
              database.close();
            };
          };
        },
      ),
  );
  expect(stored.ids.some((id) => id.startsWith('conversation-transcript-'))).toBe(true);
  expect(stored.encrypted).toBe(true);
  expect(stored.leaks).toBe(false);

  // A crash: the page goes away mid-recording and the next start finds the recording interrupted.
  await page.goto(`${E2E_ASSET_ORIGIN}/#/notes`);
  await page.reload();
  const inbox = page.locator('.conversation-inbox');
  await expect(inbox.getByText('Прервана')).toBeVisible({ timeout: 30_000 });
  await inbox.getByRole('button', { name: 'Добавить' }).click();
  const dialog = page.getByRole('dialog', { name: 'Запись прервалась' });
  await expect(dialog.getByRole('region', { name: 'Текст беседы' })).toContainText('Фраза номер 1');
});

test('stopping hands the finished text to the attach dialog', async ({ page }) => {
  await installDeviceKeyAndSpeech(page);
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  const live = await openLiveWindow(page);
  await live
    .locator('.asr-model-card')
    .getByRole('button', { name: /Скачать/u })
    .click();
  await expect(live.locator('.conversation-live__line').first()).toBeVisible({ timeout: 40_000 });

  await live.getByRole('button', { name: 'Стоп' }).click();
  const dialog = page.getByRole('dialog', { name: 'Запись сохранена' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'Текст беседы' })).toContainText('Фраза номер 1');
});

interface StoredVaultFacts {
  readonly mode: string | undefined;
  readonly keyExtractable: boolean | undefined;
  readonly blobs: readonly { readonly id: string; readonly storage: string }[];
  readonly leaks: boolean;
}

/** What the vault database holds, read straight from IndexedDB like a copy taken off the device. */
function readVaultFacts(page: Page): Promise<StoredVaultFacts> {
  return page.evaluate(
    () =>
      new Promise<StoredVaultFacts>((resolve, reject) => {
        const open = indexedDB.open('minimed-patient-vault-v3');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const transaction = database.transaction(['vault', 'blobs']);
          const vault = transaction.objectStore('vault').get('current');
          const blobs = transaction.objectStore('blobs').getAll();
          transaction.oncomplete = () => {
            const record = vault.result as
              | { mode?: string; key?: { extractable?: boolean }; snapshot?: unknown }
              | undefined;
            const files = blobs.result as { id: string; storage: string }[];
            database.close();
            resolve({
              mode: record?.mode,
              keyExtractable: record?.key?.extractable,
              blobs: files.map(({ id, storage }) => ({ id, storage })),
              leaks: JSON.stringify([record?.snapshot, files]).includes('Фраза'),
            });
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
  );
}

async function recordUntilTextAppears(page: Page) {
  const live = await openLiveWindow(page);
  await live
    .locator('.asr-model-card')
    .getByRole('button', { name: /Скачать/u })
    .click();
  await expect(live.locator('.conversation-live__line').first()).toHaveText('Фраза номер 1', {
    timeout: 40_000,
  });
  return live;
}

test('a browser without a vault offers to create one and saves the pending text on one tap', async ({
  page,
}, testInfo) => {
  await installFakeSpeech(page);
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  const live = await recordUntilTextAppears(page);

  // No keychain and no vault: the text is on screen only, and the window says so in place.
  const offer = live.getByRole('button', { name: /Текст не сохранится/u });
  await expect(live.locator('.conversation-offer')).toHaveClass(/conversation-offer--open/u, {
    timeout: 15_000,
  });
  await expect(offer).toBeVisible();
  await expect(offer).toContainText('Создать хранилище');
  await expect(live.locator('.conversation-save')).toHaveCount(0);
  expect((await readVaultFacts(page)).mode).toBeUndefined();
  await page.screenshot({ path: testInfo.outputPath('offer-small.png') });

  const timeBefore = await live.locator('.conversation-live__time').textContent();
  await offer.click();

  // The recording never paused; the text was written at once and the offer folds away.
  await expect(live.locator('.conversation-save--saved')).toBeVisible({ timeout: 15_000 });
  await expect(live.locator('.conversation-offer')).not.toHaveClass(/conversation-offer--open/u);
  await expect(live.locator('.conversation-live__time')).not.toHaveText(timeBefore ?? '');
  const facts = await readVaultFacts(page);
  expect(facts.mode).toBe('browser-device-key');
  expect(facts.keyExtractable).toBe(false);
  expect(facts.blobs.find((blob) => blob.id.startsWith('conversation-transcript-'))?.storage).toBe(
    'encrypted',
  );
  expect(facts.leaks).toBe(false);

  // A closed tab: the next start opens the vault by its stored key and shows the text.
  await page.goto(`${E2E_ASSET_ORIGIN}/#/notes`);
  await page.reload();
  const inbox = page.locator('.conversation-inbox');
  await expect(inbox.getByText('Прервана')).toBeVisible({ timeout: 30_000 });
  await inbox.getByRole('button', { name: 'Добавить' }).click();
  const dialog = page.getByRole('dialog', { name: 'Запись прервалась' });
  await expect(dialog.getByRole('region', { name: 'Текст беседы' })).toContainText('Фраза номер 1');
});

test('the full-screen window explains the offer, and a plaintext vault is encrypted in place', async ({
  page,
}, testInfo) => {
  await installFakeSpeech(page);
  // A vault left in the old plaintext mode, with one file in it.
  await page.addInitScript(() => {
    const open = indexedDB.open('minimed-patient-vault-v3', 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore('vault');
      open.result.createObjectStore('blobs', { keyPath: 'id' });
    };
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction(['vault', 'blobs'], 'readwrite');
      transaction.objectStore('vault').put(
        {
          schemaVersion: 3,
          mode: 'unencrypted',
          snapshot: {
            type: 'patient-snapshot',
            id: 'current',
            version: 3,
            data: {
              schemaVersion: 2,
              profiles: [],
              episodes: [],
              events: [],
              observations: [],
              metricDefinitions: [],
            },
          },
        },
        'current',
      );
      transaction.objectStore('blobs').put({
        type: 'patient-file',
        id: 'seed-file',
        version: 3,
        mimeType: 'text/plain',
        storage: 'plaintext',
        bytes: new TextEncoder().encode('Фраза из старого хранилища'),
      });
      transaction.oncomplete = () => database.close();
    };
  });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  const live = await recordUntilTextAppears(page);

  await live.getByRole('button', { name: 'Открыть на весь экран' }).click();
  const offer = live.getByRole('button', { name: /Текст не сохранится/u });
  await expect(live.locator('.conversation-offer')).toHaveClass(/conversation-offer--open/u, {
    timeout: 15_000,
  });
  await expect(offer).toBeVisible();
  await expect(offer).toContainText('Зашифровать хранилище');
  await page.screenshot({ path: testInfo.outputPath('offer-fullscreen.png') });

  await offer.click();
  await expect(live.locator('.conversation-save--saved')).toBeVisible({ timeout: 15_000 });
  const facts = await readVaultFacts(page);
  expect(facts.mode).toBe('browser-device-key');
  expect(facts.blobs.map((blob) => blob.storage)).toEqual(['encrypted', 'encrypted']);
  expect(facts.blobs.map((blob) => blob.id)).toContain('seed-file');
  expect(facts.leaks).toBe(false);
});
