import {
  cleanupCoreIdentityFixture,
  prepareCoreIdentityFixture,
  routeCoreIdentityFixture,
} from '@localmed/app/e2e/core-identities-fixture';
import { mountBuiltApp } from '@localmed/app/e2e/mount-built-app';
import { selectSearchSection, setClinicalAnalysis } from '@localmed/app/e2e/select-search-section';
import { expect, test } from '@playwright/test';

let fixture: Awaited<ReturnType<typeof prepareCoreIdentityFixture>>;
test.beforeAll(async () => {
  fixture = await prepareCoreIdentityFixture();
});
test.afterAll(cleanupCoreIdentityFixture);

test('exact stopword meanings offer the verified package and open their own source card', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await routeCoreIdentityFixture(page, fixture);
  await page.route('**/content/regulatory.db', (route) => route.abort());
  await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
  const input = page.getByTestId('search-input');
  const identities = page.locator('section[aria-label="Точные названия в источниках"]');
  const cards = identities.locator('.core-identity-matches__card');
  await expect
    .poll(
      async () => {
        const error = page.locator('.search-core-status--error');
        if (await error.isVisible()) return await error.innerText();
        return (await input.isEnabled()) ? 'ready' : 'waiting';
      },
      { timeout: 60_000 },
    )
    .toBe('ready');
  await input.fill('НА');
  await page.getByTestId('search-submit').click();
  await expect(cards).toHaveCount(2);
  await expect(page.locator('.error-card')).toHaveCount(0);
  await cards.first().getByRole('button', { name: 'Открыть запись' }).click();
  const dialog = page.getByRole('dialog', { name: 'НА', exact: true });
  await expect(dialog).toContainText('Новый справочник пока не подключён');
  await dialog.getByText('Пакеты справочника', { exact: true }).click();
  const packageRow = dialog.locator('[data-module-id="minimed.definition.reference.ru"]');
  await expect(packageRow).toContainText(fixture.module.title);
  await packageRow.getByRole('button', { name: /^Скачать/u }).click();
  await expect(dialog.locator('.reference-card__text')).toHaveText(
    fixture.expected[0]?.text ?? '',
    { timeout: 90_000 },
  );
  await dialog.getByText('Источник и точное расположение', { exact: true }).click();
  await expect(dialog.locator('.reference-card__metadata')).toContainText(
    fixture.expected[0]?.locator ?? '',
  );
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await cards.nth(1).getByRole('button', { name: 'Открыть запись' }).click();
  await expect(dialog.locator('.reference-card__text')).toHaveText(fixture.expected[1]?.text ?? '');
  await expect(dialog.locator('.reference-card__text')).not.toHaveText(
    fixture.expected[0]?.text ?? '',
  );
  await page.screenshot({
    path: test.info().outputPath('exact-source-card.png'),
    animations: 'disabled',
  });
  await page.keyboard.press('Escape');

  await selectSearchSection(page, 'Препараты');
  await page.getByTestId('search-submit').click();
  await expect(cards).toHaveCount(0);
  await selectSearchSection(page, 'Все источники');
  await page.getByTestId('search-submit').click();
  await expect(cards).toHaveCount(2);
  await setClinicalAnalysis(page, true);
  await page.getByTestId('search-submit').click();
  await expect(cards).toHaveCount(0);
});

test('an exact document identity rejects a local copy with the wrong raw-source checksum', async ({
  page,
}) => {
  await routeCoreIdentityFixture(page, fixture);
  await page.route('**/content/regulatory.db', (route) => route.abort());
  await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
  const input = page.getByTestId('search-input');
  await expect
    .poll(
      async () => {
        const error = page.locator('.search-core-status--error');
        if (await error.isVisible()) return await error.innerText();
        return (await input.isEnabled()) ? 'ready' : 'waiting';
      },
      { timeout: 60_000 },
    )
    .toBe('ready');
  await input.fill(fixture.document.title);
  await page.getByTestId('search-submit').click();
  const identities = page.locator('section[aria-label="Точные названия в источниках"]');
  await expect(identities.locator('.core-identity-matches__card')).toHaveCount(1);
  await identities.getByRole('button', { name: 'Открыть запись' }).click();
  await expect(identities.getByRole('alert')).toContainText(
    'Установленный документ другой редакции',
  );
  await expect(page.locator('.document-text-chunk')).toHaveCount(0);
  await expect(page).not.toHaveURL(/\/documents\//u);
  await page.screenshot({
    path: test.info().outputPath('wrong-source-checksum.png'),
    animations: 'disabled',
  });
});

test('a fresh exact document route installs its source and rejects a wrong edition on copied reload', async ({
  page,
  browser,
}) => {
  await routeCoreIdentityFixture(page, fixture, true);
  await page.route('**/content/regulatory.db', (route) => route.abort());
  await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
  const input = page.getByTestId('search-input');
  await expect(input).toBeEnabled({ timeout: 60_000 });
  await input.fill(fixture.document.title);
  await page.getByTestId('search-submit').click();
  const identities = page.locator('section[aria-label="Точные названия в источниках"]');
  await expect(identities.locator('.core-identity-matches__card')).toHaveCount(1);
  await identities.getByRole('button', { name: 'Открыть запись' }).click();
  await expect(page).toHaveURL(/\?exact=/u);
  const exactUrl = page.url();
  const pointer = page.locator('.document-module-pointer');
  await expect(pointer).toContainText(fixture.documentModule.title);
  await pointer.getByRole('button', { name: 'Скачать набор', exact: true }).click();
  await expect(page.locator('.document-text-chunk').first()).toBeVisible({ timeout: 60_000 });
  await expect(pointer).toBeHidden();
  expect(page.url()).toBe(exactUrl);
  await page.screenshot({
    path: test.info().outputPath('fresh-exact-document.png'),
    animations: 'disabled',
  });

  // A second device has a different local source copy; only the copied URL preserves the
  // source expectation. This does not depend on session state or overlapping mounted IDs.
  const otherDevice = await browser.newContext();
  try {
    const copied = await otherDevice.newPage();
    await routeCoreIdentityFixture(copied, fixture);
    await copied.route('**/content/regulatory.db', (route) => route.abort());
    await mountBuiltApp(copied, { splitNavigation: false, skipLargeCompanionPacks: true });
    await expect(copied.getByTestId('search-input')).toBeEnabled({ timeout: 60_000 });
    await copied.evaluate((url) => {
      window.location.hash = new URL(url).hash;
    }, exactUrl);
    const wrongSource = copied.getByText(
      'Установленный документ другой редакции. Обновите набор в базе знаний.',
      { exact: true },
    );
    await expect(wrongSource).toBeVisible({ timeout: 60_000 });
    await copied.reload();
    await expect(wrongSource).toBeVisible({ timeout: 60_000 });
    await expect(copied.locator('.document-text-chunk')).toHaveCount(0);
    expect(copied.url()).toBe(exactUrl);
    await copied.screenshot({
      path: test.info().outputPath('late-wrong-source-checksum.png'),
      animations: 'disabled',
    });
  } finally {
    await otherDevice.close();
  }
});
