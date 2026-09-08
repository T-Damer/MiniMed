import { expect, test } from '@playwright/test';
import { mountBuiltApp } from './mount-built-app';

for (const width of [375, 1280]) {
  test(`all-source tool subgroups use actual content kinds at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await mountBuiltApp(page, {
      skipLargeCompanionPacks: true,
      ...(process.env.MINIMED_LIVE_URL ? { origin: process.env.MINIMED_LIVE_URL } : {}),
    });
    await expect(page.locator('.document-library-card').first()).toBeVisible();
    await page.getByRole('button', { name: 'Раздел поиска', exact: true }).click();
    const menu = page.getByRole('dialog', { name: 'Разделы поиска' });
    await expect(
      menu.getByRole('button', { name: /^Загрузка: Клинический разбор\./u }),
    ).toHaveCount(0);
    await menu.getByRole('button', { name: 'Подразделы: Калькуляторы', exact: true }).click();
    await expect(
      menu.getByRole('button', { name: /^Загрузка: Преобразование единиц\./u }),
    ).toHaveCount(0);
    await menu.getByRole('button', { name: 'Подразделы: Все источники', exact: true }).click();
    const anthropometry = menu.getByRole('button', { name: /^Антропометрия \(/u });
    await expect(anthropometry.locator('[title="Калькулятор"]')).toHaveCount(1);
    await expect(anthropometry.locator('.search-section-menu__kind')).toHaveCount(1);
    const gynecology = menu.getByRole('button', { name: /^Акушерство и гинекология \(/u });
    await expect(gynecology.locator('[title="Опросник"]')).toHaveCount(1);
    await expect(gynecology.locator('[title="Калькулятор"]')).toHaveCount(1);
    expect(await gynecology.locator('.search-section-menu__kind').count()).toBeGreaterThan(2);
    const gastroLabel = menu
      .getByRole('button', { name: /^Гастроэнтерология \(/u })
      .locator('.search-section-menu__label');
    expect(
      await gastroLabel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
    await anthropometry.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath('subgroup-kinds.png') });
    await anthropometry.click();
    await expect(page.locator('.unified-catalog__tool').first()).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Документы не найдены', exact: true }),
    ).toHaveCount(0);
    await expect(page.locator('.document-library-card')).toHaveCount(0);
    await page.getByTestId('search-input').fill('несуществующийкалькулятор');
    await expect(
      page.getByText('Инструменты не найдены. Уточните запрос или раздел.', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Документы не найдены', exact: true }),
    ).toHaveCount(0);
  });
}
