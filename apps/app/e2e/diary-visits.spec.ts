import { expect, test } from '@playwright/test';

import { parseDiaryInvitation } from '../src/features/diary/diary-model';
import { testInvitation, testInvitationLink } from './diary-fixtures';

test.use({ viewport: { width: 390, height: 844 } });

function localDay(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A care diary with a visit tomorrow and a lab test the doctor asks for (DIARY27). */
function visitInvitation() {
  const base = testInvitation({
    template: 'care',
    doctor: 'Иванова А. А.',
    plan: [{ id: 'p1', name: 'Рисперидон', dose: '2 мг', times: [{ time: '20:00' }] }],
    contacts: [{ kind: 'phone', value: '+7 900 000-00-00', label: 'Регистратура' }],
  });
  return parseDiaryInvitation({
    ...base,
    fields: [
      ...base.fields,
      { id: 'lab-l1', type: 'number', label: 'Пролактин', unit: 'мМЕ/л', min: 0, max: 1_000_000 },
    ],
    appointments: [{ id: 'v1', day: localDay(1), time: '14:30', place: 'Кабинет 214' }],
    labs: [
      {
        id: 'l1',
        name: 'Пролактин',
        field: 'lab-l1',
        by: localDay(10),
        why: 'Рисперидон может повышать пролактин',
      },
    ],
  });
}

test('the next visit is above the day with a call, and a lab result is typed in', async ({
  page,
}) => {
  await page.goto(await testInvitationLink(visitInvitation()));
  const visit = page.getByRole('region', { name: 'Приём у врача' });
  await expect(visit).toContainText('Завтра у вас приём в 14:30');
  await expect(visit).toContainText('Кабинет 214');
  await expect(visit.getByRole('link', { name: /Позвонить/u })).toHaveAttribute(
    'href',
    'tel:+79000000000',
  );

  const lab = page.locator('.care-row').filter({ hasText: 'Пролактин' });
  await expect(lab).toContainText('Сдать до');
  await lab.getByRole('button', { name: 'Пролактин: вписать результат' }).click();
  const sheet = page.getByRole('dialog', { name: 'Пролактин' });
  await expect(sheet).toContainText('Рисперидон может повышать пролактин');
  await sheet.getByRole('textbox').first().fill('420');
  await sheet.getByRole('button', { name: 'Сохранить' }).click();
  await expect(lab).toContainText('420 мМЕ/л');
  await expect(lab).toHaveClass(/care-row--done/u);
});
