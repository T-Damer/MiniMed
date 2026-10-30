import { expect, type Page, test } from '@playwright/test';

import { IPHONE_SAFARI, testInvitation, testInvitationLink } from './diary-fixtures';

test.use({ viewport: { width: 390, height: 844 } });

const TABS = (page: Page) => page.getByRole('navigation', { name: 'Дневник' });
const ADD_TO_HOME = 'Добавьте дневник на экран «Домой»';

/** A day plan with one medicine at two daily times and a way to reach the doctor. */
function careInvitation() {
  return testInvitation({
    template: 'care',
    doctor: 'Иванова А. А.',
    plan: [
      {
        id: 'p1',
        name: 'Эналаприл',
        dose: '5 мг',
        times: [{ time: '08:00' }, { time: '20:00' }],
      },
    ],
    contacts: [{ kind: 'phone', value: '+7 900 000-00-00', label: 'Регистратура' }],
  });
}

test.describe('patient diary: the care diary with the tab bar', () => {
  test('the day page has the main app header, a tab bar and no old bottom bar', async ({
    page,
  }) => {
    await page.goto(await testInvitationLink(careInvitation()));
    await expect(page.getByRole('heading', { level: 1, name: 'Дневник лечения' })).toBeVisible();
    // The description line: the doctor (and, for a connected diary, the sync words).
    await expect(page.locator('.page__description')).toContainText('Иванова А. А.');

    // Header icon buttons: help in a crisis and the way to the doctor.
    await expect(page.getByRole('button', { name: 'Помощь, если очень плохо' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Связаться с врачом' })).toBeVisible();

    // The floating tab bar; «Врачу» only because this diary is not connected to the server.
    const tabs = TABS(page);
    await expect(tabs.getByRole('button')).toHaveText(['', '', '', '']);
    for (const name of ['Сегодня', 'Записи', 'Врачу', 'Настройки']) {
      await expect(tabs.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await expect(tabs.getByRole('button', { name: 'Сегодня', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // A tab is not a step back from anything: no back button, and the old bar is gone.
    await expect(page.getByRole('button', { name: 'На главную' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Мои дневники' })).toHaveCount(0);
    await expect(page.locator('.diary-today__bar')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Ещё/u })).toHaveCount(0);
  });

  test('an open task is an empty box, a tap ticks it, and the state is a row of its own', async ({
    page,
  }) => {
    await page.goto(await testInvitationLink(careInvitation()));
    const rows = page.locator('.care-row').filter({ hasText: 'Эналаприл' });
    await expect(rows).toHaveCount(2);
    await expect(rows.first().locator('.care-row__box')).toBeVisible();
    await expect(rows.first()).not.toHaveClass(/care-row--done/u);

    await rows
      .first()
      .getByRole('button', { name: /отметить приём/u })
      .click();
    await expect(rows.first()).toHaveClass(/care-row--done/u);
    await expect(rows.first().locator('.care-row__box')).toHaveCount(0);
    await expect(rows.first()).toContainText('Принято в');
    // The other intake is still open.
    await expect(rows.nth(1).locator('.care-row__box')).toBeVisible();

    // «Описание состояния» is a row like the others, not a button of its own.
    await expect(page.getByRole('button', { name: 'Добавить описание состояния' })).toHaveCount(0);
    const feeling = page.locator('.care-row').filter({ hasText: 'Как вы себя чувствуете?' });
    await expect(feeling.locator('.care-row__box')).toBeVisible();
    await feeling.getByRole('button', { name: 'Как вы себя чувствуете?' }).click();
    const sheet = page.getByRole('dialog', { name: 'Добавить описание состояния' });
    await expect(sheet.getByRole('button', { name: 'Сказать голосом' })).toBeVisible();
    await sheet.getByLabel('Что вы чувствуете').fill('Спокойно, давление в норме');
    await sheet.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.locator('.care-note')).toContainText('Спокойно, давление в норме');
    await expect(page.locator('.care-row').filter({ hasText: 'Добавить ещё' })).toBeVisible();
  });

  test('a spoken note asks before downloading the speech model and sends nothing anywhere', async ({
    page,
  }) => {
    // A tone stands in for the microphone; no speech model is on this «phone».
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        const context = new AudioContext();
        const tone = context.createOscillator();
        const sink = context.createMediaStreamDestination();
        tone.connect(sink);
        tone.start();
        return sink.stream;
      };
    });
    const downloads: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('huggingface.co')) downloads.push(request.url());
    });
    await page.goto(await testInvitationLink(careInvitation()));
    const feeling = page.locator('.care-row').filter({ hasText: 'Как вы себя чувствуете?' });
    await feeling.getByRole('button', { name: 'Как вы себя чувствуете?' }).click();
    const sheet = page.getByRole('dialog', { name: 'Добавить описание состояния' });
    await sheet.getByRole('button', { name: 'Сказать голосом' }).click();
    await expect(sheet.getByRole('status')).toContainText('Говорите');
    await page.waitForTimeout(1200);
    await sheet.getByRole('button', { name: 'Остановить запись' }).click();
    await expect(sheet.getByRole('button', { name: 'Скачать и расшифровать' })).toBeVisible();
    await sheet.getByRole('button', { name: 'Не сейчас' }).click();
    await expect(sheet.getByRole('button', { name: 'Скачать и расшифровать' })).toHaveCount(0);
    expect(downloads).toEqual([]);
  });

  test('«Записи» on a tab: no back button, no dock, and «Изменить» opens that mark on the day page', async ({
    page,
  }) => {
    await page.goto(await testInvitationLink(careInvitation()));
    await page
      .locator('.care-row')
      .filter({ hasText: 'Эналаприл' })
      .first()
      .getByRole('button', { name: /отметить приём/u })
      .click();

    await TABS(page).getByRole('button', { name: 'Записи', exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Записи', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.diary-record')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'На главную' })).toHaveCount(0);
    // The tab bar has «Врачу» and the day page takes the marks: the dock repeats neither.
    await expect(page.getByRole('button', { name: 'Записать показания' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Отправить врачу', exact: true })).toHaveCount(0);
    // A diary that is not connected still says what the doctor does not have yet.
    await expect(page.locator('.diary-record__badge')).toContainText('Не отправлена врачу');

    await page
      .locator('.diary-record')
      .first()
      .getByRole('button', { name: /^Изменить/u })
      .click();
    await expect(page.getByRole('dialog', { name: /Эналаприл/u })).toBeVisible();
    await expect(TABS(page).getByRole('button', { name: 'Сегодня', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('«Врачу» and «Настройки» are tabs too, without a back button', async ({ page }) => {
    await page.goto(await testInvitationLink(careInvitation()));
    await TABS(page).getByRole('button', { name: 'Врачу', exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Отправить врачу', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'На главную' })).toHaveCount(0);

    await TABS(page).getByRole('button', { name: 'Настройки', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Настройки' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'На главную' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Распечатать/u })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Звуки' })).toBeVisible();
    // Not connected to a server: nothing to withdraw, no notifications to switch on.
    await expect(page.getByRole('button', { name: /^Отозвать согласие/u })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Включить уведомления/u })).toHaveCount(0);

    await TABS(page).getByRole('button', { name: 'Сегодня', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Дневник лечения' })).toBeVisible();
  });

  test('the install warning sits under the day page header and at the top of «Настройки»', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      userAgent: IPHONE_SAFARI,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto(await testInvitationLink(careInvitation()));
    const warning = page.getByRole('button', { name: ADD_TO_HOME });
    await expect(warning).toBeVisible();
    const title = await page.getByRole('heading', { level: 1 }).boundingBox();
    const day = await page.locator('.diary-today__day').boundingBox();
    const box = await warning.boundingBox();
    expect(box?.y ?? 0).toBeGreaterThan((title?.y ?? 0) + (title?.height ?? 0));
    expect(box?.y ?? 0).toBeLessThan(day?.y ?? 0);

    await TABS(page).getByRole('button', { name: 'Настройки', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Настройки' })).toBeVisible();
    const top = await warning.boundingBox();
    const firstGroup = await page.locator('.settings-list__group').first().boundingBox();
    expect(top?.y ?? 0).toBeLessThan(firstGroup?.y ?? 0);
    await context.close();
  });
});
