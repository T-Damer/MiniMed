import { expect, type Page, test } from '@playwright/test';

import { IPHONE_SAFARI, testInvitation, testInvitationLink } from './diary-fixtures';

test.use({ viewport: { width: 390, height: 844 } });

const sheet = (page: Page, name: string) => page.getByRole('dialog', { name, exact: true });
const openSettingsSheet = (page: Page) =>
  page.getByRole('button', { name: 'Настройки', exact: true }).click();
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

test.describe('patient diary: chat and its plan and settings sheets', () => {
  test('the plan sheet opens directly on today and closes back to the same chat', async ({
    page,
  }) => {
    await page.goto(await testInvitationLink(careInvitation()));
    await expect(page.getByRole('log', { name: 'Сообщения' })).toBeVisible();
    await page.getByRole('button', { name: 'План', exact: true }).click();
    await expect(
      sheet(page, 'План').getByRole('heading', { name: 'Сегодня', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Дневник' })).toHaveCount(0);
    await sheet(page, 'План').getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(page.getByRole('log', { name: 'Сообщения' })).toBeVisible();
  });

  test('calendar opens a previous day and returns to today without extra tabs', async ({
    page,
  }) => {
    await page.goto(await testInvitationLink(careInvitation()));
    await page.getByRole('button', { name: 'План', exact: true }).click();
    await expect(sheet(page, 'План')).toBeVisible();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const label = yesterday.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    await page.getByRole('button', { name: 'Календарь', exact: true }).click();
    const calendar = page.getByRole('region', { name: 'Календарь отметок' });
    await calendar.getByRole('button', { name: new RegExp(`^${label}(?:,|:)`, 'u') }).click();
    await expect(page.getByRole('heading', { level: 2, name: /^Вчера,/u })).toBeVisible();
    await expect(sheet(page, 'Календарь')).toBeVisible();
    await page.goBack();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Сегодня', exact: true }),
    ).toBeVisible();
    await expect(sheet(page, 'План')).toBeVisible();
  });

  test('the plan only shows a scroll cue when its list overflows', async ({ page }) => {
    await page.goto(await testInvitationLink(careInvitation()));
    await page.getByRole('button', { name: 'План', exact: true }).click();
    await expect(sheet(page, 'План')).toBeVisible();
    const scrollport = sheet(page, 'План').locator('.diary-sheet__body').first();
    const cue = sheet(page, 'План').locator('.scroll-indicator__cue');
    if (await scrollport.evaluate((element) => element.scrollHeight <= element.clientHeight)) {
      await expect(cue).not.toHaveClass(/scroll-indicator__cue--shown/u);
    }
    await page.goto(
      await testInvitationLink(
        testInvitation({
          template: 'care',
          plan: Array.from({ length: 15 }, (_, i) => ({
            id: `p${i}`,
            name: `Назначение ${i + 1}`,
            times: [{ time: '08:00' }],
          })),
        }),
      ),
    );
    await page.getByRole('button', { name: 'План', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toBeInViewport();
    await expect(cue).toHaveClass(/scroll-indicator__cue--shown/u);
    await scrollport.evaluate((element) => element.scrollTo(0, element.scrollHeight));
    await expect(cue).not.toHaveClass(/scroll-indicator__cue--shown/u);
  });

  test('an open task is an empty box, a tap ticks it, and the state is a row of its own', async ({
    page,
  }) => {
    await page.goto(await testInvitationLink(careInvitation()));
    await page.getByRole('button', { name: 'План', exact: true }).click();
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

    // «Своими словами» is a row like the others, not a button of its own.
    await expect(page.getByRole('button', { name: 'Добавить описание состояния' })).toHaveCount(0);
    const feeling = page.locator('.care-row').filter({ hasText: 'Рассказать врачу' });
    await expect(feeling.locator('.care-row__box')).toBeVisible();
    await feeling.getByRole('button', { name: 'Рассказать врачу своими словами' }).click();
    const sheet = page.getByRole('dialog', { name: 'Рассказать врачу' });
    await expect(sheet.getByRole('button', { name: 'Сказать голосом' })).toBeVisible();
    await sheet.getByLabel('Как вы себя чувствуете сейчас?').fill('Спокойно, давление в норме');
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
    await page.getByRole('button', { name: 'План', exact: true }).click();
    const feeling = page.locator('.care-row').filter({ hasText: 'Рассказать врачу' });
    await feeling.getByRole('button', { name: 'Рассказать врачу своими словами' }).click();
    const sheet = page.getByRole('dialog', { name: 'Рассказать врачу' });
    await sheet.getByRole('button', { name: 'Сказать голосом' }).click();
    await expect(sheet.getByRole('status')).toContainText('Говорите');
    await page.waitForTimeout(1200);
    await sheet.getByRole('button', { name: 'Остановить запись' }).click();
    await expect(sheet.getByRole('button', { name: 'Скачать и расшифровать' })).toBeVisible();
    await sheet.getByRole('button', { name: 'Не сейчас' }).click();
    await expect(sheet.getByRole('button', { name: 'Скачать и расшифровать' })).toHaveCount(0);
    expect(downloads).toEqual([]);
  });

  test('«Записи» in Settings: back button, no dock, and «Изменить» opens that mark on the day page', async ({
    page,
  }) => {
    await page.goto(await testInvitationLink(careInvitation()));
    await page.getByRole('button', { name: 'План', exact: true }).click();
    await page
      .locator('.care-row')
      .filter({ hasText: 'Эналаприл' })
      .first()
      .getByRole('button', { name: /отметить приём/u })
      .click();

    await sheet(page, 'План').getByRole('button', { name: 'Закрыть', exact: true }).click();
    await openSettingsSheet(page);
    await page
      .locator('.diary-settings__section')
      .getByRole('button', { name: /^Записи/u })
      .click();
    await expect(page.getByRole('dialog', { name: 'Записи', exact: true })).toBeVisible();
    await expect(page.locator('.diary-record')).toHaveCount(1);
    await expect(
      page.getByRole('button', { name: 'Настройки', exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'На главную' })).toHaveCount(0);
    // Export lives in Settings and the day page takes the marks: no duplicate dock.
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
    await expect(sheet(page, 'План')).toBeVisible();
  });

  test('manual export opens inside Settings', async ({ page }) => {
    await page.goto(await testInvitationLink(careInvitation()));
    await page.getByRole('button', { name: 'План', exact: true }).click();
    await sheet(page, 'План').getByRole('button', { name: 'Закрыть', exact: true }).click();
    await openSettingsSheet(page);
    await page
      .locator('.diary-settings__section')
      .getByRole('button', { name: /^Отправить врачу/u })
      .click();
    await expect(sheet(page, 'Отправить врачу')).toBeVisible();
    await expect(page.getByRole('button', { name: 'На главную' })).toHaveCount(0);
    await page.goBack();
    await expect(sheet(page, 'Настройки')).toBeVisible();
    await page
      .locator('.diary-settings__section')
      .getByRole('button', { name: /^Отправить врачу/u })
      .click();
    await expect(sheet(page, 'Отправить врачу')).toBeVisible();

    await sheet(page, 'Отправить врачу')
      .getByRole('button', { name: 'Настройки', exact: true })
      .click();
    await expect(sheet(page, 'Настройки')).toBeVisible();
    await expect(page.getByRole('button', { name: 'На главную' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Распечатать/u })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Звуки' })).toBeVisible();
    // Not connected to a server: nothing to withdraw, no notifications to switch on.
    await expect(page.getByRole('button', { name: /^Отозвать согласие/u })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Включить уведомления/u })).toHaveCount(0);

    await sheet(page, 'Настройки').getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page.getByRole('button', { name: 'План', exact: true }).click();
    await expect(sheet(page, 'План')).toBeVisible();
  });

  test('the install warning stays below the plan and at the top of «Настройки»', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      userAgent: IPHONE_SAFARI,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto(await testInvitationLink(careInvitation()));
    await page.getByRole('button', { name: 'План', exact: true }).click();
    const warning = page.getByRole('button', { name: ADD_TO_HOME });
    await expect(warning).toBeVisible();
    const title = await sheet(page, 'План')
      .getByRole('heading', { name: 'План', exact: true })
      .boundingBox();
    const day = await page.locator('.diary-today__checklist-header').boundingBox();
    const box = await warning.boundingBox();
    expect(box?.y ?? 0).toBeGreaterThan((title?.y ?? 0) + (title?.height ?? 0));
    expect(box?.y ?? 0).toBeGreaterThan(day?.y ?? 0);

    await sheet(page, 'План').getByRole('button', { name: 'Закрыть', exact: true }).click();
    await openSettingsSheet(page);
    await expect(sheet(page, 'Настройки')).toBeVisible();
    const settings = sheet(page, 'Настройки');
    await expect
      .poll(() =>
        settings.evaluate((panel) => {
          const top = panel.querySelector('.install-warning')?.getBoundingClientRect().y;
          const group = panel.querySelector('.settings-list__group')?.getBoundingClientRect().y;
          return top !== undefined && group !== undefined && top < group;
        }),
      )
      .toBe(true);
    await context.close();
  });
});
