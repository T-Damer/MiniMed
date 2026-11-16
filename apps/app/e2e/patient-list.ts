import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Opens the patient list by its address. A tab tap returns to the place the tab was left at (often
 * a patient card) and a card's back steps one entry back, so neither is a way to the list.
 */
export async function openPatientList(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = '#/notes/patients';
  });
  await expect(page.getByRole('button', { name: 'Новый пациент', exact: true })).toBeVisible();
}

/**
 * A card of the patient list. Not `getByRole('button', { name })`: a kept-alive calculator screen
 * under the list can still hold the patient picker's option with the same name.
 */
export function patientCard(page: Page, name: string): Locator {
  return page.locator('.patient-workspace__patient-card').filter({ hasText: name });
}

/**
 * Opens a panel of the patient card from its actions on top («Запись, осмотр», «Данные для
 * справок», «Назначить дневник»); a panel that is already open stays open.
 */
export async function openPatientPanel(
  page: Page,
  panel: 'visit' | 'data' | 'diary',
): Promise<void> {
  const tile = page.getByTestId(`patient-action-${panel}`).filter({ visible: true });
  await expect(tile).toBeVisible();
  if ((await tile.getAttribute('aria-pressed')) !== 'true') await tile.click();
  await expect(tile).toHaveAttribute('aria-pressed', 'true');
}
