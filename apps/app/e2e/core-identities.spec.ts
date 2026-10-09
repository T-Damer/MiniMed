import {
  cleanupCoreIdentityFixture,
  prepareCoreIdentityFixture,
  routeCoreIdentityFixture,
} from '@localmed/app/e2e/core-identities-fixture';
import { mountBuiltApp, waitForSearchEditable } from '@localmed/app/e2e/mount-built-app';
import { selectSearchSection, setClinicalAnalysis } from '@localmed/app/e2e/select-search-section';
import { expect, test } from '@playwright/test';

let fixture: Awaited<ReturnType<typeof prepareCoreIdentityFixture>>;
test.beforeAll(async () => {
  fixture = await prepareCoreIdentityFixture();
});
test.afterAll(cleanupCoreIdentityFixture);

test('exact stopword meanings fold into one preview: the likeliest sense first, the others one tap away', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await routeCoreIdentityFixture(page, fixture);
  await page.route('**/content/regulatory.db', (route) => route.abort());
  await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
  const input = page.getByTestId('search-input');
  const identities = page.locator('section[aria-label="Определение термина"]');
  const cards = identities.getByTestId('definition-preview');
  await waitForSearchEditable(page);
  await input.fill('НА');
  await page.getByTestId('search-submit').click();
  // Two dictionary entries of one name are one preview.
  await expect(cards).toHaveCount(1);
  await expect(page.locator('.error-card')).toHaveCount(0);
  await cards.getByRole('button', { name: 'Подробнее', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'НА', exact: true });
  // The dictionary is not installed yet: the dialog offers the download right away.
  const packageRow = dialog.locator('[data-module-id="minimed.definition.reference.ru"]');
  await expect(packageRow).toContainText(fixture.module.title);
  await packageRow.getByRole('button', { name: /^Скачать/u }).click();
  const paragraph = dialog.locator('.reference-term__paragraph').first();
  await expect(paragraph).toBeVisible({ timeout: 90_000 });
  expect(fixture.expected.map((entry) => entry.text)).toContain(await paragraph.innerText());
  // Neither pipeline notes nor raw metadata reach the doctor.
  await expect(dialog).not.toContainText('sectionTitle');
  await expect(dialog).not.toContainText('Черновая редакция, не проверено');
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  // With the dictionary installed the card quotes the widely used sense (psychiatry), not the
  // rare one the core lists first, and offers the other sense as a field-labelled chip.
  const snippet = (index: number) =>
    (fixture.expected[index]?.text ?? '').replace(/\s+/gu, ' ').trim().slice(0, 30);
  const text = cards.locator('.definition-preview__text');
  await expect(text).toContainText(snippet(1));
  await expect(cards.locator('.definition-preview__source-row')).toBeVisible();
  const chip = cards.getByRole('button', { name: 'травматология', exact: true });
  await expect(chip).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('sense-card.png'),
    animations: 'disabled',
  });
  await chip.click();
  await expect(text).toContainText(snippet(0));
  await expect(cards.getByRole('button', { name: 'психиатрия', exact: true })).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('exact-source-card.png'),
    animations: 'disabled',
  });

  await selectSearchSection(page, 'Препараты');
  await page.getByTestId('search-submit').click();
  await expect(cards).toHaveCount(0);
  await selectSearchSection(page, 'Все источники');
  await page.getByTestId('search-submit').click();
  await expect(cards).toHaveCount(1);
  await setClinicalAnalysis(page, true);
  await page.getByTestId('search-submit').click();
  await expect(cards).toHaveCount(0);
});

test('«Депрессия» opens with the mood disorder, the fracture pattern is one tap away', async ({
  page,
}) => {
  test.skip(
    !fixture.expected.some((entry) => entry.title === 'Депрессия'),
    'needs the local candidate dictionary edition (data/build/definitions-ux13)',
  );
  test.setTimeout(180_000);
  await routeCoreIdentityFixture(page, fixture);
  await page.route('**/content/regulatory.db', (route) => route.abort());
  await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
  const input = page.getByTestId('search-input');
  await waitForSearchEditable(page);
  const cards = page
    .locator('section[aria-label="Определение термина"]')
    .getByTestId('definition-preview');
  await input.fill('Депрессия');
  await page.getByTestId('search-submit').click();
  await expect(cards).toHaveCount(1);
  await cards.getByRole('button', { name: 'Подробнее', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Депрессия', exact: true });
  await dialog
    .locator('[data-module-id="minimed.definition.reference.ru"]')
    .getByRole('button', { name: /^Скачать/u })
    .click();
  await expect(dialog.locator('.reference-term__paragraph').first()).toBeVisible({
    timeout: 90_000,
  });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  const text = cards.locator('.definition-preview__text');
  await expect(text).toContainText('психическое расстройство');
  await expect(text).not.toContainText('перелома');
  await expect(cards.locator('.definition-preview__source-row')).toContainText(
    'Красота и медицина',
  );
  const chip = cards.getByRole('button', { name: 'травматология', exact: true });
  await page.screenshot({
    path: test.info().outputPath('depression-card.png'),
    animations: 'disabled',
  });
  await chip.click();
  await expect(text).toContainText('перелома');
  await expect(cards.locator('.definition-preview__source-row')).toContainText(
    'КР: Переломы бедренной кости',
  );
  await expect(cards.getByRole('button', { name: 'психиатрия', exact: true })).toBeVisible();
  // The doctor's own tap is remembered on this device only and resets completely.
  expect(
    await page.evaluate(() => window.localStorage.getItem('minimed.doctor-profile.v1')),
  ).toContain('traumatology');
});

test('an exact document identity rejects a local copy with the wrong raw-source checksum', async ({
  page,
}) => {
  await routeCoreIdentityFixture(page, fixture);
  await page.route('**/content/regulatory.db', (route) => route.abort());
  await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
  const input = page.getByTestId('search-input');
  await waitForSearchEditable(page);
  await input.fill(fixture.document.title);
  await page.getByTestId('search-submit').click();
  const identities = page.locator('section[aria-label="Определение термина"]');
  await expect(identities.getByTestId('definition-preview')).toHaveCount(1);
  await identities.getByRole('button', { name: 'Подробнее', exact: true }).click();
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
  await waitForSearchEditable(page);
  await input.fill(fixture.document.title);
  await page.getByTestId('search-submit').click();
  const identities = page.locator('section[aria-label="Определение термина"]');
  await expect(identities.getByTestId('definition-preview')).toHaveCount(1);
  await identities.getByRole('button', { name: 'Подробнее', exact: true }).click();
  await expect(page).toHaveURL(/\?exact=/u);
  const exactUrl = page.url();
  const pointer = page.locator('.document-module-pointer');
  await expect(pointer).toContainText(fixture.documentModule.title);
  await pointer.getByRole('button', { name: /^Скачать набор/u }).click();
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
    await expect(copied.getByTestId('search-input')).toHaveAttribute('data-search-ready', 'true', {
      timeout: 60_000,
    });
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
