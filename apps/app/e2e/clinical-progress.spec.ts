import { expect, test } from '@playwright/test';

import { mountBuiltApp, waitForSearchReady } from './mount-built-app';
import { setClinicalAnalysis } from './select-search-section';

// Owner 2026-10-31: «if thinking search is enabled, show some progress». The «Клинический разбор»
// row names the running stage and a thin bar moves along it; both clear once the results are in.
test('the clinical search shows its stage in place while it runs', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await waitForSearchReady(page);
  await setClinicalAnalysis(page, true);
  // Every stage label the row shows, recorded as it appears (the pass can be quick).
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __stages: string[] }).__stages = seen;
    new MutationObserver(() => {
      const text = document.querySelector('.clinical-analysis-note__stage')?.textContent ?? '';
      if (text && seen.at(-1) !== text) seen.push(text);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await page.getByTestId('search-input').fill('Ребёнок часто дышит и температурит второй день');
  await page.getByTestId('search-submit').click();
  await expect(page.locator('.result-group').first()).toBeVisible({ timeout: 90_000 });
  const note = page.locator('.clinical-analysis-note');
  await expect(note.locator('.clinical-analysis-note__stage')).toHaveText('');
  await expect(note).toHaveAttribute('aria-busy', 'false');
  await expect(note.locator('.clinical-analysis-note__progress--running')).toHaveCount(0);
  const stages = await page.evaluate(() => (window as unknown as { __stages: string[] }).__stages);
  expect(stages.length).toBeGreaterThan(0);
  for (const stage of stages) {
    expect(['Разбираем запрос…', 'Ищем в источниках…', 'Обновляем выдачу…']).toContain(stage);
  }
});
