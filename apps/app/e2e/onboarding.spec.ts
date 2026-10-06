import { expect, type Page, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN } from './mount-built-app';

const ORIGIN = process.env.MINIMED_LIVE_URL ?? E2E_ASSET_ORIGIN;

/**
 * A core that never arrives keeps the download line on screen for the whole tour. The returned
 * counter holds the number of real downloads (GET) started; the start-up probe is a HEAD.
 */
async function holdCore(page: Page): Promise<{ readonly downloads: () => number }> {
  let downloads = 0;
  await page.route('**/core.db', (route) => {
    // The start-up probe (HEAD) goes through, so the app asks to download; the download hangs.
    if (route.request().method() !== 'GET') return route.fallback();
    downloads += 1;
    return new Promise(() => {});
  });
  return { downloads: () => downloads };
}

type Box = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]) {
  test(`the first run plays the intro, tours the app and returns to search at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const core = await holdCore(page);
    await page.goto(`${ORIGIN}/#/search`, { waitUntil: 'domcontentloaded' });

    // Intro: the greeting waits for the user; «Далее» brings the welcome, then the core download.
    const intro = page.getByRole('dialog', { name: 'Добро пожаловать в MiniMed' });
    await expect(intro).toBeAttached();
    await expect(page.getByText('Привет', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.core-progress-line')).toHaveClass(/core-progress-line--waiting/u);
    await page.screenshot({ path: testInfo.outputPath('intro-hello.png') });
    // Nothing moves on by itself, and nothing is downloaded yet.
    await page.waitForTimeout(6_000);
    await expect(page.getByText('Привет', { exact: true })).toBeVisible();
    await expect(intro.getByRole('heading', { name: 'Добро пожаловать в MiniMed' })).toBeHidden();
    expect(core.downloads()).toBe(0);
    const next = intro.getByRole('button', { name: 'Далее', exact: true });
    await expect(next).toBeVisible();
    await next.click();

    await expect(intro.getByRole('heading', { name: 'Добро пожаловать в MiniMed' })).toBeVisible();
    await expect(intro.getByText('Твой персональный помощник по медицине')).toBeVisible();
    await expect(intro.getByText('без интернета', { exact: false })).toBeVisible();
    await page.waitForTimeout(5_000);
    await expect(intro.getByRole('heading', { name: 'Добро пожаловать в MiniMed' })).toBeVisible();
    expect(core.downloads()).toBe(0);
    await page.screenshot({ path: testInfo.outputPath('intro-welcome.png') });
    await next.click();

    // The core download begins now; the icon opens and three documents float, the middle higher.
    await expect(
      intro.getByText('Сейчас нам надо скачать ядро знаний — прогресс загрузки ты увидишь внизу'),
    ).toBeVisible();
    await expect(
      intro.getByText('Нажми «Далее», чтобы продолжить изучать приложение, пока идёт загрузка'),
    ).toBeVisible();
    await expect.poll(core.downloads).toBe(1);
    await expect(page.locator('.core-progress-line__track')).toBeVisible();
    await expect(page.locator('.core-progress-line__track')).toHaveAttribute('role', 'progressbar');
    await expect(page.locator('.core-progress-line')).not.toHaveClass(
      /core-progress-line--waiting/u,
    );
    await expect(page.locator('.onboarding-docs__sheet--out')).toHaveCount(3);
    await expect(page.locator('.onboarding-intro__mark')).toHaveCSS('opacity', '0', {
      timeout: 5_000,
    });
    const sheets = await page
      .locator('.onboarding-docs__sheet--out')
      .evaluateAll((elements) =>
        elements.map((element) => Math.round(element.getBoundingClientRect().top)),
      );
    // Left, middle, right: the middle sheet is the highest of the three.
    expect(sheets[1]).toBeLessThan(Math.min(sheets[0] ?? 0, sheets[2] ?? 0));
    await page.screenshot({ path: testInfo.outputPath('intro.png') });
    // «Пропустить обучение» keeps a clear gap below «Далее».
    const nextBox = await next.boundingBox();
    const skipBox = await intro.getByRole('button', { name: 'Пропустить обучение' }).boundingBox();
    expect(nextBox && skipBox && skipBox.y - (nextBox.y + nextBox.height) >= 12).toBe(true);
    await next.click();

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

    // Files: the feature list is a collapsed accordion; the real sample slices cycle and their
    // source sits behind a «?» on the picture.
    await expect(counter).toContainText('7 / 10');
    await expect(card.getByRole('heading', { name: 'Мои файлы' })).toBeVisible();
    await expect(card.locator('.onboarding-mri__slice--active')).toBeVisible();
    const accordion = card.locator('.onboarding-hint__more');
    await expect(accordion).toBeVisible();
    await expect(accordion).not.toHaveAttribute('open', '');
    await expect(card.locator('.onboarding-hint__more-summary')).toContainText('МРТ и КТ');
    await expect(card.getByText('храни свои книги и ищи по ним;')).toBeHidden();
    await expect(card.locator('.onboarding-mri__source')).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath('step-6.png') });
    await card.locator('.onboarding-hint__more-summary').click();
    await expect(card.getByText('храни свои книги и ищи по ним;')).toBeVisible();
    await card.locator('.onboarding-hint__more-summary').click();
    await expect(card.getByText('храни свои книги и ищи по ним;')).toBeHidden();
    const help = card.getByRole('button', { name: 'Об изображении и источнике' });
    await expect(help).toHaveAttribute('aria-expanded', 'false');
    await help.click();
    await expect(help).toHaveAttribute('aria-expanded', 'true');
    await expect(card.locator('.onboarding-mri__source')).toBeVisible();
    await expect(card.locator('.onboarding-mri__source')).toContainText('3D Slicer');
    // Escape closes the popover and does not skip the tour.
    await page.keyboard.press('Escape');
    await expect(help).toHaveAttribute('aria-expanded', 'false');
    await expect(card.locator('.onboarding-mri__source')).toBeHidden();
    await expect(page.locator('.onboarding')).toHaveCount(1);

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
  // Arrow keys move the intro on one phase each (greeting, welcome, core), then start the tour.
  await expect(page.getByText('Привет', { exact: true })).toBeVisible({ timeout: 30_000 });
  for (let press = 0; press < 3; press += 1) await page.keyboard.press('ArrowRight');
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

/** Takes the intro and the first tour steps by keyboard: greeting, welcome, core, then step 2. */
async function enterTour(page: Page): Promise<void> {
  await expect(page.getByText('Привет', { exact: true })).toBeVisible({ timeout: 30_000 });
  for (let press = 0; press < 3; press += 1) await page.keyboard.press('ArrowRight');
  await expect(page.locator('.onboarding-hint__counter')).toContainText('2 / 10');
}

for (const size of [
  { width: 390, height: 844 },
  { width: 360, height: 800 },
]) {
  test(`on a metered connection no notice covers a button of the intro or the tour at ${size.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'connection', { value: { type: 'cellular' } });
    });
    await page.goto(`${ORIGIN}/#/search`, { waitUntil: 'domcontentloaded' });
    const caption = page.locator('.core-progress-line__caption');
    const buttonsOf = (scope: string) =>
      page.locator(scope).evaluate((root) =>
        Array.from(root.querySelectorAll('button'))
          .filter((element) => getComputedStyle(element).visibility === 'visible')
          .map((element) => {
            const box = element.getBoundingClientRect();
            return { x: box.x, y: box.y, width: box.width, height: box.height };
          }),
      );
    const covered = async (scope: string): Promise<number> => {
      const pill = await caption.boundingBox();
      if (!pill) throw new Error('The progress caption is not on screen.');
      return (await buttonsOf(scope)).filter((box) => intersects(box, pill)).length;
    };
    const cardCovered = async (): Promise<boolean> => {
      const pill = await caption.boundingBox();
      const card = await page.locator('.onboarding-hint').boundingBox();
      if (!pill || !card) throw new Error('The caption or the card is not on screen.');
      return intersects(card, pill);
    };

    // The intro: on a metered connection the caption is a small pill in the corner, not a wide
    // message across the middle of the screen.
    await expect(page.getByText('Привет', { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(caption).toContainText('Мобильная сеть', { timeout: 30_000 });
    await expect(caption).not.toContainText('загрузка ядра около');
    expect(await covered('.onboarding-intro')).toBe(0);
    await expect(caption.getByRole('button', { name: 'Скачать' })).toBeVisible();

    // The tour: on every step the card, with «Пропустить», «Назад» and «Далее», keeps clear of it.
    await page.keyboard.press('ArrowRight');
    const counter = page.locator('.onboarding-hint__counter');
    for (let step = 2; step <= 10; step += 1) {
      await expect(counter).toContainText(`${step} / 10`);
      await page.waitForTimeout(700);
      expect(await cardCovered(), `step ${step}`).toBe(false);
      if (step < 10) await page.keyboard.press('ArrowRight');
    }
  });
}

test('the tour card keeps below the status bar and above the gesture bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await holdCore(page);
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.setProperty('--safe-area-inset-top', '40px');
      document.documentElement.style.setProperty('--safe-area-inset-bottom', '24px');
    });
  });
  await page.goto(`${ORIGIN}/#/search`, { waitUntil: 'domcontentloaded' });
  await enterTour(page);
  const counter = page.locator('.onboarding-hint__counter');
  for (let step = 2; step <= 10; step += 1) {
    await expect(counter).toContainText(`${step} / 10`);
    await page.waitForTimeout(700);
    const box = await page.locator('.onboarding-hint').boundingBox();
    expect(box && box.y >= 40, `step ${step}: card top`).toBe(true);
    expect(box && box.y + box.height <= 844 - 24, `step ${step}: card bottom`).toBe(true);
    if (step < 10) await page.keyboard.press('ArrowRight');
  }
});

test('the arrow stops clear of the ring around the control it points at', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await holdCore(page);
  await page.goto(`${ORIGIN}/#/search`, { waitUntil: 'domcontentloaded' });
  await enterTour(page);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.onboarding-hint__counter')).toContainText('3 / 10');
  await expect(page.locator('.onboarding__marks .onboarding-arrow__head')).toBeAttached();
  await page.waitForTimeout(1_200);
  const gap = await page.evaluate(() => {
    const ring = document.querySelector('.onboarding-ring')?.getBoundingClientRect();
    const head = document
      .querySelector('.onboarding__marks .onboarding-arrow__head')
      ?.getBoundingClientRect();
    const shaft = document
      .querySelector('.onboarding__marks .onboarding-arrow__shaft')
      ?.getBoundingClientRect();
    if (!ring || !head || !shaft) return undefined;
    const arrow = {
      left: Math.min(head.left, shaft.left),
      right: Math.max(head.right, shaft.right),
      top: Math.min(head.top, shaft.top),
      bottom: Math.max(head.bottom, shaft.bottom),
    };
    // The arrow comes from the card to the ring: it ends clear of the ring on one axis.
    return Math.max(
      ring.top - arrow.bottom,
      arrow.top - ring.bottom,
      ring.left - arrow.right,
      arrow.left - ring.right,
    );
  });
  expect(gap).toBeDefined();
  expect(gap ?? -1).toBeGreaterThanOrEqual(8);
});

test('the home carousel holds still while the tour points at one of its cards', async ({
  page,
}) => {
  await page.clock.install();
  await page.setViewportSize({ width: 390, height: 844 });
  await holdCore(page);
  await page.goto(`${ORIGIN}/#/search`, { waitUntil: 'domcontentloaded' });
  await enterTour(page);
  const counter = page.locator('.onboarding-hint__counter');
  for (let press = 0; press < 6; press += 1) await page.keyboard.press('ArrowRight');
  await expect(counter).toContainText('8 / 10');
  const visibleSlide = () =>
    page.evaluate(() => {
      const ecg = document.querySelector('[data-tour="ecg-entry"]')?.getBoundingClientRect();
      return ecg ? ecg.left >= 0 && ecg.right <= window.innerWidth : false;
    });
  // The tour brings the ECG card into view …
  await expect.poll(visibleSlide, { timeout: 15_000 }).toBe(true);
  // … and the carousel's autoplay (7 s) does not take it away again.
  await page.clock.runFor(30_000);
  expect(await visibleSlide()).toBe(true);
});
