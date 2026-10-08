import { expect, type Page, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

/** Records whether the vault choice dialog was ever attached, even for a single frame. */
async function watchVaultDialog(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = window as unknown as { __vaultDialogSeen?: boolean };
    state.__vaultDialogSeen = false;
    new MutationObserver(() => {
      if (document.querySelector('.patient-vault-dialog')) state.__vaultDialogSeen = true;
    }).observe(document, { childList: true, subtree: true });
  });
}

const vaultDialogSeen = (page: Page): Promise<boolean> =>
  page.evaluate(() => (window as unknown as { __vaultDialogSeen?: boolean }).__vaultDialogSeen);

for (const width of [375, 1280]) {
  test(`a device-key vault opens without flashing a dialog at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await watchVaultDialog(page);
    // Android bridge with a Keystore that wraps the data key; the rest of the native surface
    // answers "nothing installed" so the patients route can open.
    await page.addInitScript(() => {
      Object.assign(window, {
        CapacitorCustomPlatform: { name: 'android' },
        Capacitor: {
          PluginHeaders: [
            {
              name: 'LocalMedPatientVault',
              methods: ['isAvailable', 'wrapKey', 'unwrapKey', 'deleteKey'].map((name) => ({
                name,
                rtype: 'promise',
              })),
            },
          ],
          nativePromise: async (
            plugin: string,
            method: string,
            options: Record<string, string> = {},
          ) => {
            if (plugin !== 'LocalMedPatientVault') throw new Error(`Not mocked: ${plugin}`);
            if (method === 'isAvailable') return { available: true };
            // A 12-byte IV and key + 16-byte tag, the shape a real Keystore wrap has.
            if (method === 'wrapKey')
              return {
                ivBase64: btoa('\0'.repeat(12)),
                ciphertextBase64: btoa(atob(options.keyBase64 ?? '') + '\0'.repeat(16)),
              };
            if (method === 'unwrapKey')
              return { keyBase64: btoa(atob(options.ciphertextBase64 ?? '').slice(0, 32)) };
            return {};
          },
        },
      });
    });
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    await page.goto(`${E2E_ASSET_ORIGIN}/#/notes/patients`);

    await expect(page.getByRole('button', { name: 'Новый пациент', exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('.patient-workspace__empty')).toContainText('Карточек пока нет.');
    expect(await vaultDialogSeen(page)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`patients-native-${width}.png`) });
  });

  test(`the browser explains its device key before storing patients at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    await page.goto(`${E2E_ASSET_ORIGIN}/#/notes/patients`);

    const dialog = page.getByRole('dialog', { name: 'Пациенты' });
    await expect(dialog.getByText(/шифруются ключом этого браузера/u)).toBeVisible({
      timeout: 30_000,
    });
    await dialog.getByRole('button', { name: 'Понятно, продолжить', exact: true }).click();
    await expect(dialog).toBeHidden();
    const add = page.getByRole('button', { name: 'Новый пациент', exact: true });
    await expect(add).toBeVisible();

    // Stuck header: its blur layer paints behind every control, «+» included.
    const header = page.locator('.patient-workspace__search-chrome');
    await page.evaluate(() => {
      const workspace = document.querySelector<HTMLElement>('.patient-workspace');
      if (workspace) workspace.style.minHeight = '120rem';
      window.scrollTo(0, 400);
    });
    await expect(header).toHaveClass(/sticky-surface--stuck/u);
    const blurLayerZ = await header.evaluate((element) =>
      Number(getComputedStyle(element, '::before').zIndex),
    );
    expect(blurLayerZ).toBeLessThan(0);
    await expect
      .poll(
        async () =>
          await header.evaluate((element) => getComputedStyle(element, '::before').opacity),
      )
      .toBe('1');
    await expect(add).toBeInViewport();
    await add.screenshot({ path: testInfo.outputPath(`patients-add-stuck-${width}.png`) });
  });
}
