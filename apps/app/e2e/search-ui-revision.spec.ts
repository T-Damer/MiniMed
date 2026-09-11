import { expect, test } from '@playwright/test';
import { mountBuiltApp } from './mount-built-app';
import { selectSearchSection } from './select-search-section';

for (const width of [375, 1280]) {
  test(`unified selector, tool history, folders and long catalog at ${width}px`, async ({
    page,
  }) => {
    const height = width === 375 ? 684 : 844;
    await page.setViewportSize({ width, height });
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    const picker = page.getByRole('button', { name: 'Раздел поиска', exact: true });
    const input = page.getByTestId('search-input');
    const nav = page.locator('.app-bottom-nav');
    await expect(page.getByRole('button', { name: 'Выбрать калькулятор' })).toHaveCount(0);
    await expect(page.locator('.unified-catalog__count')).toHaveCount(0);
    await expect(page.locator('.document-library-card').first()).toBeVisible();
    await picker.click();
    await expect(
      page.locator('.search-section-menu__row .search-section-menu__option'),
    ).toHaveCount(8);
    const menuBox = await page.locator('.search-section-menu').boundingBox();
    expect(menuBox).not.toBeNull();
    if (menuBox) expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(height);
    await page.screenshot({ path: test.info().outputPath('section-menu.png') });
    const menuSearch = page.getByRole('searchbox', { name: 'Найти раздел или подраздел' });
    await menuSearch.fill('фармакология');
    const pharmacology = page.getByRole('button', { name: /^Фармакология \(/u }).first();
    await expect(pharmacology).toHaveAccessibleName(/Фармакология \(\d+\)/u);
    await page.screenshot({ path: test.info().outputPath('searchable-selector.png') });
    await pharmacology.click();
    await expect(picker).toContainText('Фармакология');
    await input.fill('препарат');
    await page.getByTestId('search-submit').click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem('localmed.search-history.v4') ?? '[]')[0]?.specialty,
        ),
      )
      .toBe('pharmacology');
    await selectSearchSection(page, 'Опросники');
    const create = page.getByRole('link', { name: /^Создать свой опросник/u });
    await expect(create).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('assessment-catalog.png') });
    await input.fill('создать свое');
    await expect(create).toBeVisible();
    await page.getByTestId('search-submit').click();
    await expect
      .poll(() =>
        page.evaluate(
          () => JSON.parse(localStorage.getItem('localmed.search-history.v4') ?? '[]')[0]?.scope,
        ),
      )
      .toBe('assessments');
    await create.click();
    await expect(page).toHaveURL(/#\/assessments\/mine\/new/u);
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(page).toHaveURL(/#\/search$/u);
    await expect(input).toHaveValue('создать свое');
    await input.fill('Командные роли');
    await page
      .locator('.unified-catalog__tool')
      .filter({ hasText: 'Командные роли' })
      .first()
      .click();
    await expect(page).toHaveURL(/#\/assessments\//u);
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(page).toHaveURL(/#\/search$/u);

    await selectSearchSection(page, 'Все источники');
    await page.getByRole('button', { name: 'Показать историю поиска', exact: true }).click();
    await expect(
      page.locator('.search-history-panel-replay').filter({ hasText: 'препарат' }),
    ).toContainText('Фармакология');
    await page.locator('.search-history-panel-replay').filter({ hasText: 'создать свое' }).click();
    await expect(picker).toContainText('Опросники');
    await expect(input).toHaveValue('создать свое');
    await expect(create).toBeVisible();
    await page.getByRole('button', { name: 'Показать историю поиска', exact: true }).click();
    await page.locator('.search-history-panel-replay').filter({ hasText: 'препарат' }).click();
    await expect(picker).toContainText('Фармакология');
    await expect(input).toHaveValue('препарат');
    await selectSearchSection(page, 'Все источники');
    await input.fill('');
    await expect(page.locator('.document-library-card').first()).toBeVisible();
    await page.evaluate(() => window.scrollTo({ top: 1_400_000, behavior: 'instant' }));
    await expect
      .poll(() => page.locator('.catalog-card__index').first().textContent())
      .toMatch(/\d{4,}/u);
    const geometry = await page
      .locator('.document-library-card')
      .first()
      .evaluate((card) => {
        const index = card.querySelector('.catalog-card__index')?.getBoundingClientRect();
        const title = card.querySelector('.catalog-card__title')?.getBoundingClientRect();
        if (!index || !title) throw new Error('Catalog card is missing its number or title');
        return { indexBottom: index.bottom, titleTop: title.top };
      });
    expect(geometry.titleTop).toBeGreaterThan(geometry.indexBottom);
    await page.screenshot({ path: test.info().outputPath('long-catalog.png') });
    await page.getByRole('button', { name: 'Вернуться наверх' }).click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(2);
    await expect(input).toBeInViewport();

    await nav.getByRole('button', { name: 'Мои файлы', exact: true }).click();
    for (const name of [
      'Исследования',
      'Книги',
      'Пациенты',
      'Мои опросники',
      'Мои шаблоны',
      'Заметки',
    ]) {
      await expect(
        page.getByRole('button', { name: `Открыть папку «${name}»`, exact: true }),
      ).toBeVisible();
    }
    await page.screenshot({ path: test.info().outputPath('personal-folders.png') });
    await page.getByRole('button', { name: 'Открыть папку «Исследования»', exact: true }).click();
    await expect(page.locator('.user-library-example-card').first()).toBeVisible();
    await page.getByRole('button', { name: 'Ваши файлы', exact: true }).click();
    await page.getByRole('button', { name: 'Открыть папку «Книги»', exact: true }).click();
    await expect(page.locator('.user-library-example-card').first()).toBeVisible();
    await page.getByRole('button', { name: 'Ваши файлы', exact: true }).click();
    await expect(page.locator('.user-library-folder-card__lock')).toHaveCount(0);
    await page.getByRole('button', { name: 'Открыть папку «Пациенты»', exact: true }).click();
    await expect(page).toHaveURL(/#\/notes\/patients/u);
    await nav.getByRole('button', { name: /^Настройки/u }).click();
    await expect(
      page
        .locator('.settings-row')
        .filter({ hasText: 'Разбивать навигацию на разделы' })
        .locator('.settings-row__label-icon'),
    ).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('settings.png') });
  });
}

for (const splitNavigation of [false, true]) {
  test(`all sources includes specialty tools with split navigation ${splitNavigation}`, async ({
    page,
  }) => {
    await mountBuiltApp(page, { splitNavigation, skipLargeCompanionPacks: true });
    const input = page.getByTestId('search-input');
    await input.fill('Гинекология');
    const tools = page.locator('.unified-catalog__tool');
    await expect(page.locator('.unified-catalog__tool[href^="#/assessments/"]')).toHaveCount(4);
    await expect(
      page.locator('.unified-catalog__tool[href^="#/calculators/"]').first(),
    ).toBeVisible();
    await input.fill('');
    const picker = page.getByRole('button', { name: 'Раздел поиска', exact: true });
    await picker.click();
    await page.getByRole('searchbox', { name: 'Найти раздел или подраздел' }).fill('Гинекология');
    const allSection = page.locator('.search-section-menu__section').filter({
      has: page.getByRole('button', { name: /^Все источники/u }),
    });
    const specialty = allSection.locator('.search-section-menu__option--child');
    await expect(specialty).toHaveAccessibleName(/Акушерство и гинекология \(\d+\)/u);
    const count = Number(
      await allSection
        .locator('.search-section-menu__row--child .search-section-menu__count')
        .innerText(),
    );
    expect(count).toBeGreaterThanOrEqual(21);
    await specialty.click();
    await expect(picker).toContainText('Акушерство и гинекология');
    await expect(page.locator('.unified-catalog__tool[href^="#/assessments/"]')).toHaveCount(4);
    await expect(
      page.locator('.unified-catalog__tool[href^="#/calculators/"]').first(),
    ).toBeVisible();
    await expect.poll(() => tools.count()).toBeGreaterThanOrEqual(16);
    await page.screenshot({ path: test.info().outputPath('all-specialty-tools.png') });
    await selectSearchSection(page, 'Нормативные документы');
    await expect(tools).toHaveCount(0);
  });
}
