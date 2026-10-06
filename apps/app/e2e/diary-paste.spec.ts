import { expect, test } from '@playwright/test';

import { diaryInvitationLink } from '../src/features/diary/diary-codec';
import {
  addReading,
  DIARY_PAGE,
  expectRecordCount,
  invitationIdInAddress,
  localInput,
  openDiaryList,
  testInvitation,
  testInvitationLink,
} from './diary-fixtures';

test.use({ viewport: { width: 390, height: 844 } });

// The empty diary of the home-screen icon (iOS keeps it apart from Safari): the doctor's link
// is pasted in, not opened.
test.describe('patient diary: pasting the doctor link', () => {
  test('an empty diary page takes the doctor link pasted as text, and refuses other text', async ({
    page,
  }) => {
    const invitation = testInvitation({ doctor: 'Петрова Е. В.', note: 'Утром и вечером' });
    const link = await testInvitationLink(invitation);
    await page.goto(DIARY_PAGE);
    await expect(page.locator('main')).toContainText('пока нет дневников');
    const paste = page.getByRole('region', { name: 'Вставьте ссылку от врача' });
    const field = paste.getByLabel('Ссылка от врача');
    const open = paste.getByRole('button', { name: 'Открыть дневник' });
    await expect(open).toBeDisabled();

    await field.fill('привет');
    await open.click();
    await expect(paste).toContainText('нет ссылки на дневник');
    await field.fill(`${DIARY_PAGE}#i=zAAAA`);
    await open.click();
    await expect(paste.getByRole('alert')).toBeVisible();

    // The doctor's message with a caption around the link.
    await field.fill(`Здравствуйте! Ваш дневник: ${link}\nСпасибо.`);
    await open.click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('давления');
    await expect(page.locator('.diary-notice')).toContainText('Дневник добавлен');
    await expect(page.getByText('Врач: Петрова Е. В.')).toBeVisible();
    await expect.poll(() => invitationIdInAddress(page.url())).toBe(invitation.id);

    // It was stored: a visit without a link lands on the same diary.
    await page.goto(DIARY_PAGE);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('давления');
  });

  test('a diary list takes a second doctor link, and an older link changes nothing', async ({
    page,
  }) => {
    const first = testInvitation({ issuedAt: new Date(Date.now() - 7_200_000).toISOString() });
    await page.goto(await testInvitationLink(first));
    await addReading(page, { systolic: 130, diastolic: 80, at: localInput(0, 8) });
    await openDiaryList(page);
    await page.getByText('Добавить дневник по ссылке врача').click();
    const older = await diaryInvitationLink(
      { ...first, issuedAt: new Date(Date.now() - 10_800_000).toISOString() },
      DIARY_PAGE,
    );
    await page.getByLabel('Ссылка от врача').fill(older);
    await page.getByRole('button', { name: 'Открыть дневник' }).click();
    await expect(page.locator('.diary-notice')).toContainText('старее');
    await expectRecordCount(page, 1);
  });

  test('saved entries pasted as a doctor link are sent to «Восстановить записи»', async ({
    page,
  }) => {
    await page.goto(DIARY_PAGE);
    await page.getByLabel('Ссылка от врача').fill('MMD1.AAAAAAAA.1.1.abcdefabcdefabcdef');
    await page.getByRole('button', { name: 'Открыть дневник' }).click();
    await expect(page.getByRole('alert')).toContainText('Восстановить записи');
  });
});
