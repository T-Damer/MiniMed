import { expect, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

// CLS2 (answers the CLS1 request to DRUG-UI1): a combination drug whose component brings another
// class shows one small plain line «также: … (через …)» under its ATC code. The line comes from a
// few-kB file of its own, never from the 2.1 MB interaction index. No module is installed.
// Screenshots: CLS2_SHOTS=<directory>; the theme: CLS2_THEME=dark.
const SHOTS = process.env['CLS2_SHOTS'];
const PREFERENCES = {
  'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
  'minimed.theme.v1': process.env['CLS2_THEME'] ?? 'light',
};

const pointerRoute = (id: string): string =>
  `${E2E_ASSET_ORIGIN}/#/modules/documents/d/${Buffer.from(id).toString('base64url')}`;

const KORVALOL =
  'core.catalog.pointer.medication.esklp.mnn.мяты-перечной-листьев-масло-фенобарбитал-этилбромизовалерианат-37056ab76d362587';
const COLD_REMEDY =
  'core.catalog.pointer.medication.esklp.mnn.кофеин-парацетамол-фенилэфрин-фенирамин-204e70917058e8b2';
const PHENOBARBITAL = 'core.catalog.pointer.medication.esklp.mnn.фенобарбитал-6ea8516bb1e5eba2';

test('the extra classes of a combination drug show as one small line, without the interaction index', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  await page.setViewportSize({ width: 375, height: 812 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true, localStorage: PREFERENCES });

  await page.goto(pointerRoute(KORVALOL));
  const atc = page.getByTestId('drug-index-atc');
  await expect(atc).toBeVisible({ timeout: 60_000 });
  const line = atc.getByTestId('drug-secondary-classes');
  await expect(line).toHaveText('также: барбитурат, снотворное (через фенобарбитал)', {
    timeout: 30_000,
  });
  // Plain text on the first screen, no ATC code in the words.
  const box = await line.boundingBox();
  expect(box?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(812 - 120);
  expect(await line.locator('button, a').count()).toBe(0);
  if (SHOTS)
    await page.screenshot({ path: `${SHOTS}/korvalol-${PREFERENCES['minimed.theme.v1']}.png` });

  // Three components, three classes, one line.
  await page.goto(pointerRoute(COLD_REMEDY));
  await expect(page.getByTestId('drug-secondary-classes')).toHaveText(
    'также: психостимулятор (через кофеин); деконгестант (через фенилэфрин); антигистаминное (через фенирамин)',
    { timeout: 30_000 },
  );
  if (SHOTS)
    await page.screenshot({ path: `${SHOTS}/cold-${PREFERENCES['minimed.theme.v1']}.png` });

  // A single substance has no secondary class and no line.
  await page.goto(pointerRoute(PHENOBARBITAL));
  await expect(page.getByTestId('drug-index-atc')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('drug-secondary-classes')).toHaveCount(0);

  expect(requested.some((url) => url.includes('secondary-classes'))).toBe(true);
  expect(requested.some((url) => url.includes('interaction-index'))).toBe(false);
});

// CLS3 (QA 0.6.60, item 13): a card the product holds no instruction of (Колдакт Флю Плюс) shows the
// same line as the cold remedies that have one; the primary code is named, not bare; Цитрамон, whose
// own class is already an analgesic, has the named code and no «также».
const KOLDAKT_FLU =
  'core.catalog.pointer.medication.esklp.mnn.парацетамол-фенилэфрин-хлорфенамин-8af2758c8b5d32bf';
const KOLDAKT_FORCE =
  'core.catalog.pointer.medication.esklp.mnn.парацетамол-фенилэфрин-хлорфенамин-аскорбиновая-кислота-768554af296d0a44';
const CITRAMON =
  'core.catalog.pointer.medication.esklp.mnn.ацетилсалициловая-кислота-кофеин-парацетамол-76e17c5912fffb40';

test('the cold remedies of one component set show one line, and the primary code is named', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true, localStorage: PREFERENCES });
  const classes = 'также: деконгестант (через фенилэфрин); антигистаминное (через хлорфенамин)';

  await page.goto(pointerRoute(KOLDAKT_FLU));
  const atc = page.getByTestId('drug-index-atc');
  await expect(atc.getByTestId('drug-secondary-classes')).toHaveText(classes, { timeout: 60_000 });
  // «N02BE51 · анилиды»: the code with the name of its level-4 group, one tap target.
  await expect(atc.getByRole('button', { name: /Код АТХ N02BE51/u })).toContainText('анилиды', {
    timeout: 30_000,
  });
  const box = await atc.boundingBox();
  expect(box?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(812 - 120);
  if (SHOTS)
    await page.screenshot({ path: `${SHOTS}/koldakt-flu-${PREFERENCES['minimed.theme.v1']}.png` });

  await page.goto(pointerRoute(KOLDAKT_FORCE));
  await expect(page.getByTestId('drug-secondary-classes')).toHaveText(classes, { timeout: 30_000 });

  await page.goto(pointerRoute(CITRAMON));
  await expect(page.getByTestId('drug-index-atc')).toContainText('N02BA71', { timeout: 30_000 });
  await expect(page.getByTestId('drug-index-atc')).toContainText('салициловая кислота');
  await expect(page.getByTestId('drug-secondary-classes')).toHaveCount(0);
});
