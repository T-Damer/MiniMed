import { expect, test } from '@playwright/test';
import { mountBuiltApp } from './mount-built-app';

for (const width of [375, 1280]) {
  test(`a notice about an added file opens that file from a link at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    await page.getByRole('button', { name: 'Мои файлы', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Ваши документы' })).toBeVisible();
    await page.getByLabel('Загрузить документы').setInputFiles({
      name: 'выписка.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Выписка для проверки уведомления.'),
    });

    const notice = page.locator('.app-notification').filter({ hasText: 'Добавлен документ' });
    await expect(notice).toBeVisible();
    const open = notice.getByRole('button', { name: 'Открыть', exact: true });
    // Styled as a link: underlined link colour on no fill.
    const look = await open.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        underline: style.textDecorationLine,
        background: style.backgroundColor,
        border: style.borderTopWidth,
      };
    });
    expect(look).toEqual({ underline: 'underline', background: 'rgba(0, 0, 0, 0)', border: '0px' });
    await expect(notice).toHaveAttribute('data-mounted', 'true');
    await expect
      .poll(() => notice.evaluate((element) => getComputedStyle(element).opacity))
      .toBe('1');
    await page.screenshot({ path: testInfo.outputPath(`notice-${width}.png`) });

    await open.click();
    await expect(page.locator('.user-document-reader')).toContainText(
      'Выписка для проверки уведомления.',
    );
  });
}
