import { expect, test } from '@playwright/test';
import { mountBuiltApp } from './mount-built-app';

test('a notice sits at the top edge as a rounded, shadowed paper card', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
  await page.getByRole('button', { name: 'Мои файлы', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Ваши документы' })).toBeVisible();
  await page.getByLabel('Загрузить документы').setInputFiles({
    name: 'выписка.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Выписка для проверки вида уведомления.'),
  });

  const notice = page.locator('.app-notification').filter({ hasText: 'Добавлен документ' });
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute('data-mounted', 'true');
  await expect
    .poll(() => notice.evaluate((element) => getComputedStyle(element).opacity))
    .toBe('1');
  const look = await notice.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      top: element.getBoundingClientRect().top,
      radius: Number.parseFloat(style.borderTopLeftRadius),
      shadow: style.boxShadow,
      background: style.backgroundImage,
      duration: style.transitionDuration,
    };
  });
  // Far higher than the old 4.5 rem under the safe area: level with the route controls.
  expect(look.top).toBeLessThan(40);
  expect(look.radius).toBeGreaterThanOrEqual(16);
  expect(look.shadow).not.toBe('none');
  // The paper texture of `.paper-card`.
  expect(look.background).toContain('repeating-linear-gradient');
  // Motion tokens: nothing longer than 300 ms.
  for (const duration of look.duration.split(',')) {
    expect(Number.parseFloat(duration)).toBeLessThanOrEqual(0.3);
  }
  await page.screenshot({ path: testInfo.outputPath('notice-paper-375.png') });
});
