import { expect, type Page, test } from '@playwright/test';

const ORIGIN = process.env.MINIMED_LIVE_URL ?? 'http://127.0.0.1:4173';

/** A core that never arrives keeps the download line on screen for the whole tour. */
async function holdCore(page: Page): Promise<void> {
  await page.route('**/core.db', () => new Promise(() => {}));
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]) {
  test(`the first run plays the intro, tours the app and returns to search at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await holdCore(page);
    await page.goto(`${ORIGIN}/#/search`, { waitUntil: 'domcontentloaded' });

    // Intro: greeting, welcome, then the core explanation with the thin progress line.
    const intro = page.getByRole('dialog', { name: 'Добро пожаловать в MiniMed' });
    await expect(intro).toBeAttached();
    await expect(page.getByText('Привет', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(intro.getByRole('heading', { name: 'Добро пожаловать в MiniMed' })).toBeVisible();
    await expect(intro.getByText('Твой персональный помощник по медицине')).toBeVisible();
    await expect(
      intro.getByText('Сейчас нам надо скачать ядро знаний — прогресс загрузки ты увидишь внизу'),
    ).toBeVisible();
    await expect(
      intro.getByText('Нажми «Далее», чтобы продолжить изучать приложение, пока идёт загрузка'),
    ).toBeVisible();
    await expect(page.locator('.core-progress-line__track')).toBeVisible();
    await expect(page.locator('.core-progress-line__track')).toHaveAttribute('role', 'progressbar');
    await page.screenshot({ path: testInfo.outputPath('intro.png') });
    await intro.getByRole('button', { name: 'Далее', exact: true }).click();

    // Tour: the card, the counter and the step dots advance one step at a time.
    const card = page.locator('.onboarding-hint');
    const counter = card.locator('.onboarding-hint__counter');
    await expect(counter).toContainText('2 / 10');
    await expect(card.getByRole('heading', { name: 'Поиск', exact: true })).toBeVisible();
    await expect(card.locator('.onboarding-hint__back')).toBeDisabled();
    // The first step spotlights the bottom navigation and explains it; no glow or particles.
    await expect(page.locator('.onboarding-ring--spotlight')).toBeVisible();
    await expect(card).toContainText('Нижняя панель переключает разделы');
    await expect(page.locator('.onboarding__particles, .onboarding__edge-light')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('step-2.png') });

    await card.getByRole('button', { name: 'Далее', exact: true }).click();
    await expect(counter).toContainText('3 / 10');
    await expect(card.getByRole('heading', { name: 'Разделы поиска' })).toBeVisible();
    // The control the step explains is ringed and an arrow is drawn to it.
    await expect(page.locator('.onboarding-ring')).toBeVisible();
    await expect(page.locator('.onboarding-arrow__shaft')).toBeAttached();
    await expect(card.locator('.onboarding-hint__dot--active')).toHaveCount(1);

    // Specialty: whole sections, each with its contents before anything is downloaded.
    await card.getByRole('button', { name: 'Далее', exact: true }).click();
    await expect(counter).toContainText('4 / 10');
    await expect(card.getByRole('heading', { name: 'Скачать по специальности' })).toBeVisible();
    await expect(card.locator('.section-downloads__item').first()).toBeVisible({ timeout: 30_000 });
    await expect(card.getByRole('button', { name: /Выберите раздел/u })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath('step-4.png') });

    await card.getByRole('button', { name: 'Далее', exact: true }).click();
    await expect(counter).toContainText('5 / 10');
    await expect(
      card.getByRole('button', { name: /Скачать препараты|Считаем размер/u }),
    ).toBeVisible();

    await card.getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(counter).toContainText('4 / 10');
    await card.getByRole('button', { name: 'Далее', exact: true }).click();
    await card.getByRole('button', { name: 'Далее', exact: true }).click();
    await expect(counter).toContainText('6 / 10');
    await card.getByRole('button', { name: 'Далее', exact: true }).click();

    // Files: the real sample slices cycle with their attribution.
    await expect(counter).toContainText('7 / 10');
    await expect(card.getByRole('heading', { name: 'Мои файлы' })).toBeVisible();
    await expect(card.locator('.onboarding-mri__slice--active')).toBeVisible();
    await expect(card.locator('.onboarding-mri__source')).toContainText('OpenNeuro');
    await page.screenshot({ path: testInfo.outputPath('step-6.png') });

    await card.getByRole('button', { name: 'Далее', exact: true }).click();
    await expect(counter).toContainText('8 / 10');
    await expect(card.getByRole('heading', { name: 'ЭКГ по фото' })).toBeVisible();

    await card.getByRole('button', { name: 'Далее', exact: true }).click();
    await expect(counter).toContainText('9 / 10');
    await expect(card.getByRole('button', { name: 'Скачать модель (в фоне)' })).toBeVisible();
    await expect(card).toContainText('только с согласия пациента');

    await card.getByRole('button', { name: 'Далее', exact: true }).click();
    await expect(counter).toContainText('10 / 10');
    await expect(card).toContainText('Всё хранится только на твоём устройстве');
    await page.screenshot({ path: testInfo.outputPath('step-9.png') });
    await card.getByRole('button', { name: 'Начать работу' }).click();

    // Finish: the tour is gone, search is on screen, the core download line keeps going.
    await expect(page.locator('.onboarding')).toHaveCount(0);
    await expect(page.locator('.search-home')).toBeVisible();
    await expect(page.locator('.app-nav-button--active')).toHaveAttribute('aria-label', 'Поиск');
    await expect(page.locator('.core-progress-line')).toBeVisible();
    // Without the core the tour hides for this session only and returns on the next launch.
    expect(
      await page.evaluate(() => localStorage.getItem('minimed:package-setup-dismissed:v1')),
    ).toBeNull();
    expect(await page.evaluate(() => document.getElementById('root')?.hasAttribute('inert'))).toBe(
      false,
    );
  });
}

test('Escape skips the tour from the intro and the keyboard moves between steps', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await holdCore(page);
  await page.goto(`${ORIGIN}/#/search`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('dialog', { name: 'Добро пожаловать в MiniMed' })).toBeAttached();
  // Arrow keys fast-forward the intro phases, then start the tour.
  await expect(page.getByText('Привет', { exact: true })).toBeVisible({ timeout: 30_000 });
  for (let press = 0; press < 4; press += 1) await page.keyboard.press('ArrowRight');
  const counter = page.locator('.onboarding-hint__counter');
  await expect(counter).toContainText('2 / 10');
  await page.keyboard.press('ArrowRight');
  await expect(counter).toContainText('3 / 10');
  await page.keyboard.press('ArrowLeft');
  await expect(counter).toContainText('2 / 10');
  await page.keyboard.press('Escape');
  await expect(page.locator('.onboarding')).toHaveCount(0);
  await expect(page.locator('.search-home')).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the splash hands over to the intro without a frame of search in between (${scheme})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: scheme });
    await holdCore(page);
    // Every frame records what is on screen: the splash, the blurred intro, or bare search.
    await page.addInitScript(() => {
      const frames: Array<{ surface: boolean; leaving: boolean; veil: boolean; search: boolean }> =
        [];
      (window as unknown as { __frames: typeof frames }).__frames = frames;
      const tick = (): void => {
        const surface = document.getElementById('boot-surface');
        const search = document.querySelector('.search-home')?.getBoundingClientRect();
        frames.push({
          surface: surface !== null,
          leaving: surface?.classList.contains('boot-surface--leaving') ?? false,
          veil: document.querySelector('.onboarding__veil--full') !== null,
          search: (search?.width ?? 0) > 0,
        });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.goto(`${ORIGIN}/#/search`, { waitUntil: 'commit' });
    await expect(
      page.locator('.onboarding-intro__scene--hello.onboarding-intro__scene--shown'),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#boot-surface')).toHaveCount(0);
    const frames = await page.evaluate(
      () => (window as unknown as { __frames: Array<Record<string, boolean>> }).__frames,
    );
    // Search only ever shows under the splash or under the blur, never bare.
    expect(frames.filter((frame) => frame.search && !frame.surface && !frame.veil)).toEqual([]);
    // The splash is taken over, not faded out: it never starts its own exit.
    expect(frames.some((frame) => frame.leaving)).toBe(false);
    await expect(page.locator('.onboarding-intro__mark')).toBeVisible();
  });
}
