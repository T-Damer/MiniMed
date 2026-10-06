import { expect, test } from '@playwright/test';

import {
  ANDROID_CHROME,
  addReading,
  DIARY_PAGE,
  expectRecordCount,
  IPAD_SAFARI,
  IPHONE_MESSENGER,
  IPHONE_SAFARI,
  invitationIdInAddress,
  isBuiltDiary,
  localInput,
  testInvitation,
  testInvitationLink,
} from './diary-fixtures';

test.use({ viewport: { width: 390, height: 844 } });

test.describe('patient diary: keeping it one tap away', () => {
  test('iPhone Safari gets share-sheet steps, and a warning once entries exist', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      userAgent: IPHONE_SAFARI,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto(await testInvitationLink(testInvitation()));
    const card = page.getByRole('region', { name: 'Добавить дневник на экран «Домой»' });
    await expect(card).toContainText('«Поделиться»');
    // Safari on iOS 26 keeps «Поделиться» inside the «⋯» menu at the bottom.
    await expect(card).toContainText('«⋯»');
    await expect(card).toContainText('«Ещё»');
    await expect(card).toContainText('На экран Домой');
    await expect(card).toContainText('«Добавить»');
    await expect(card).toContainText('до первой записи');
    await expect(card).toContainText('на iPhone значок хранит записи отдельно от Safari');

    await addReading(page, { systolic: 130, diastolic: 80, at: localInput(0, 8) });
    await expect(card).toContainText('без записей, сделанных сейчас в Safari');
    await expect(card).toContainText('Отправить файлом');
    await expect(card).toContainText('Восстановить записи');

    await card.getByRole('button', { name: /Понятно/u }).click();
    await expect(card).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(card).toHaveCount(0);
    await context.close();
  });

  test('iPad Safari is told the share button is in the top toolbar', async ({ browser }) => {
    const context = await browser.newContext({
      userAgent: IPAD_SAFARI,
      viewport: { width: 744, height: 1133 },
    });
    // iPadOS Safari calls itself a Mac and is recognised by its touch screen alone.
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
      Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });
    });
    const page = await context.newPage();
    await page.goto(await testInvitationLink(testInvitation()));
    const card = page.getByRole('region', { name: 'Добавить дневник на экран «Домой»' });
    await expect(card).toContainText('«Поделиться»');
    await expect(card).toContainText('в верхней панели');
    await expect(card).toContainText('«Ещё»');
    await expect(card).toContainText('На экран Домой');
    await expect(card).toContainText('на iPad значок');
    await expect(card).not.toContainText('«⋯»');
    await expect(card).not.toContainText('телефон');
    await context.close();
  });

  test('Android without a native prompt is told where the menu entry is', async ({ browser }) => {
    const context = await browser.newContext({
      userAgent: ANDROID_CHROME,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto(await testInvitationLink(testInvitation()));
    await expect(
      page.getByRole('region', { name: 'Добавить дневник на экран «Домой»' }),
    ).toContainText('Добавить на главный экран');
    await context.close();
  });

  test('the browser install prompt is offered as one big button and used', async ({ browser }) => {
    const context = await browser.newContext({
      userAgent: ANDROID_CHROME,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto(await testInvitationLink(testInvitation()));
    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      Object.assign(event, {
        prompt: () => {
          (window as unknown as { __prompted?: boolean }).__prompted = true;
          return Promise.resolve();
        },
        userChoice: Promise.resolve({ outcome: 'accepted' }),
      });
      window.dispatchEvent(event);
    });
    const install = page.getByRole('button', { name: 'Добавить на экран', exact: true });
    await expect(install).toBeVisible();
    const box = await install.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
    await install.click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __prompted?: boolean }).__prompted === true),
      )
      .toBe(true);
    await expect(
      page.getByRole('region', { name: 'Добавить дневник на экран «Домой»' }),
    ).toHaveCount(0);
    await context.close();
  });

  test('a diary already on the home screen does not ask again', async ({ browser }) => {
    const context = await browser.newContext({
      userAgent: IPHONE_SAFARI,
      viewport: { width: 390, height: 844 },
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'standalone', { value: true });
    });
    const page = await context.newPage();
    await page.goto(await testInvitationLink(testInvitation()));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Добавить дневник на экран «Домой»' }),
    ).toHaveCount(0);
    await context.close();
  });

  test('inside a messenger the patient is told to open a real browser', async ({ browser }) => {
    const context = await browser.newContext({
      userAgent: IPHONE_MESSENGER,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto(await testInvitationLink(testInvitation()));
    const warning = page.getByRole('region', { name: 'Откройте в браузере' });
    await expect(warning).toContainText('Открыть в Safari');
    await expect(
      page.getByRole('region', { name: 'Добавить дневник на экран «Домой»' }),
    ).toHaveCount(0);
    await context.close();
  });

  test('the page is installable: manifest scope, start URL and icons stay inside the diary', async ({
    page,
    request,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'webkit-ios',
      'iOS Safari deliberately gets no manifest (see the next tests)',
    );
    await page.goto(DIARY_PAGE);
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBeTruthy();
    const manifestUrl = new URL(href ?? '', page.url());
    const response = await request.get(manifestUrl.href);
    expect(response.ok()).toBe(true);
    const manifest = (await response.json()) as {
      start_url: string;
      scope: string;
      display: string;
      icons: { src: string; sizes: string }[];
    };
    expect(manifest.display).toBe('standalone');
    const start = new URL(manifest.start_url, manifestUrl);
    const scope = new URL(manifest.scope, manifestUrl);
    expect(start.href).toBe(new URL(DIARY_PAGE).href);
    expect(scope.href).toBe(new URL(DIARY_PAGE).href);
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(
      expect.arrayContaining(['192x192', '512x512']),
    );
    for (const icon of manifest.icons) {
      expect((await request.get(new URL(icon.src, manifestUrl).href)).ok()).toBe(true);
    }
  });

  test('iOS Safari gets no manifest, so the saved icon keeps the invitation in its address', async ({
    browser,
  }) => {
    // iOS reads the manifest once at load and would use its start_url (no room for #i=...).
    for (const device of [
      { userAgent: IPHONE_SAFARI, ipad: false },
      { userAgent: IPAD_SAFARI, ipad: true },
    ]) {
      const context = await browser.newContext({ userAgent: device.userAgent });
      if (device.ipad) {
        await context.addInitScript(() => {
          Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
          Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });
        });
      }
      const page = await context.newPage();
      const invitation = testInvitation();
      await page.goto(await testInvitationLink(invitation));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
      // What «Add to Home Screen» takes is the address: it must hold the whole invitation.
      await expect.poll(() => invitationIdInAddress(page.url())).toBe(invitation.id);
      await context.close();
    }
  });

  test('Android and desktop browsers still get the manifest', async ({ browser }) => {
    const context = await browser.newContext({ userAgent: ANDROID_CHROME });
    const page = await context.newPage();
    await page.goto(await testInvitationLink(testInvitation()));
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
    await context.close();
  });

  test('after one visit the diary opens offline from the icon, and entries still save', async ({
    context,
    page,
    browserName,
  }) => {
    test.skip(
      browserName === 'webkit',
      'Playwright WebKit fails every navigation while offline; check it in Safari',
    );
    await page.goto(await testInvitationLink(testInvitation()));
    test.skip(!(await isBuiltDiary(page)), 'the service worker only runs in the built page');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
      .toBe(true);
    const scope = await page.evaluate(
      async () => (await navigator.serviceWorker.getRegistration())?.scope,
    );
    expect(scope).toBe(new URL(DIARY_PAGE).href);

    await context.setOffline(true);
    await page.goto(DIARY_PAGE);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('давления');
    await addReading(page, { systolic: 126, diastolic: 82, at: localInput(0, 7, 30) });
    await context.setOffline(false);
    await page.reload();
    await expectRecordCount(page, 1);
  });
});
