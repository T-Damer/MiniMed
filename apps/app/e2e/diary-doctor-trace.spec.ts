import { expect, type Page, test } from '@playwright/test';

import { testInvitation, testInvitationLink } from './diary-fixtures';

// DIARY19: the doctor's edits leave a trace the patient sees — a mark keeps the dose it was made
// at after the plan changes, a mark the doctor deleted stays in «Записи» struck out, and a new plan
// says what changed until the patient closes it. The connected sync that fills these in is
// unit-tested (`doctor-trace.test.ts`); here the phone's stored state is seeded the way it leaves it.

test.use({ viewport: { width: 390, height: 844 } });

const TABS = (page: Page) => page.getByRole('navigation', { name: 'Дневник' });
const ID = 'doctortrace01';

function careInvitation(dose: string, issuedAt: string) {
  return testInvitation({
    id: ID,
    template: 'care',
    issuedAt,
    plan: [{ id: 'p1', name: 'Эналаприл', dose, times: [{ time: '08:00' }, { time: '20:00' }] }],
  });
}

test('a mark keeps its dose, a deleted mark and a plan change stay visible', async ({
  page,
}, testInfo) => {
  const issued = new Date(Date.now() - 7_200_000).toISOString();
  await page.goto(await testInvitationLink(careInvitation('5 мг', issued)));
  const rows = page.locator('.care-row').filter({ hasText: 'Эналаприл' });
  await rows
    .first()
    .getByRole('button', { name: /отметить приём/u })
    .click();
  await expect(rows.first()).toHaveClass(/care-row--done/u);

  // The doctor raises the dose: a newer link (the same as a synced plan) replaces the plan.
  await page.goto(
    await testInvitationLink(careInvitation('10 мг', new Date(Date.now() - 60_000).toISOString())),
  );
  await expect(rows.first()).toContainText('Эналаприл 5 мг');
  await expect(rows.nth(1)).toContainText('Эналаприл 10 мг');

  // What the connected sync stores when the doctor deletes a mark and changes the plan.
  await page.evaluate((id) => {
    const evening = new Date();
    evening.setHours(20, 3, 0, 0);
    window.localStorage.setItem(
      `minimed.diary.meta.v1.${id}`,
      JSON.stringify({
        ...JSON.parse(window.localStorage.getItem(`minimed.diary.meta.v1.${id}`) ?? '{}'),
        removedByDoctor: [
          {
            id: 'gone00000001',
            at: evening.toISOString(),
            line: 'Эналаприл 5 мг — выполнено · по плану 20:00',
            item: 'p1',
            slot: '20:00',
            removedAt: new Date().toISOString(),
          },
        ],
        planChange: { at: new Date().toISOString(), lines: ['Эналаприл: 5 мг → 10 мг'] },
      }),
    );
  }, ID);
  await page.reload();

  const change = page.getByRole('region', { name: 'Врач изменил план' });
  await expect(change).toContainText('Эналаприл: 5 мг → 10 мг');
  await expect(rows.nth(1)).toContainText('Отметку удалил врач');
  await page.screenshot({ path: testInfo.outputPath('today-trace.png') });

  await change.getByRole('button', { name: 'Понятно' }).click();
  await expect(change).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Врач изменил план' })).toHaveCount(0);

  await TABS(page).getByRole('button', { name: 'Записи', exact: true }).click();
  const records = page.locator('.diary-record');
  await expect(records).toHaveCount(2);
  await expect(records.filter({ hasText: 'Удалено врачом' })).toContainText(
    'Эналаприл 5 мг — выполнено · по плану 20:00',
  );
  await expect(page.locator('.diary-record:not(.diary-record--removed)')).toContainText(
    'Эналаприл 5 мг — выполнено',
  );
  await page.screenshot({ path: testInfo.outputPath('records-trace.png') });
});
