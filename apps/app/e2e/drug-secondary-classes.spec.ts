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
