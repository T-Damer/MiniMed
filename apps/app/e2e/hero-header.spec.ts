import { mountBuiltApp } from '@localmed/app/e2e/mount-built-app';
import { expect, test } from '@playwright/test';

// The hero header (components/PageHero.tsx): on every page that has one, the header stays above the
// page's content while it scrolls (it shrinks into a bar), and the title block under its row is
// gone before the row slides over it, however little the page can scroll. The diaries are not here:
// signed out they are only the sign-in card, with no header (diary-signin.spec.ts).
const ROUTES = [
  '#/news',
  '#/settings',
  '#/settings/general',
  '#/settings/appearance',
  '#/calculators',
  '#/assessments',
  '#/notes',
  '#/modules/documents/user',
] as const;

test.use({ viewport: { width: 390, height: 844 } });

test('hero headers stay above the page and never overlap their own title block', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  const problems: string[] = [];
  for (const route of ROUTES) {
    await page.evaluate((hash) => {
      window.location.hash = hash;
    }, route);
    // A tab switch is a view transition: the new page is in place once it has run.
    // biome-ignore lint/performance/noAwaitInLoops: the routes are visited one after another.
    await page.waitForTimeout(150);
    await expect(page.locator('html')).not.toHaveClass(/using-root-view-transition/u);
    const header = page.locator('.app-view.active .page--hero').first();
    await expect(header, route).toBeVisible({ timeout: 30_000 });
    const found = await page.evaluate(async (hash) => {
      const found: string[] = [];
      const view = document.querySelector('.app-view.active');
      const hero = view?.querySelector<HTMLElement>('.page--hero');
      if (!view || !hero) return [`${hash}: no hero`];
      // Content long enough to scroll the whole shrink, placed like the route's own cards (a raised
      // direct child of the surface): it must pass under the header, never over it.
      const surface = hero.closest('.page-grain') ?? hero.parentElement;
      const filler = document.createElement('div');
      filler.className = 'paper-card hero-header-spec__filler';
      filler.style.cssText = 'height: 300vh; position: relative;';
      surface?.append(filler);
      const frame = (): Promise<void> =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      const max = document.scrollingElement
        ? document.scrollingElement.scrollHeight - window.innerHeight
        : 0;
      for (const y of [0, 10, 30, 60, 120, 240, 600]) {
        if (y > max) break;
        window.scrollTo({ top: y, behavior: 'instant' });
        await frame();
        const box = hero.getBoundingClientRect();
        for (const pointY of [6, 24, 44]) {
          if (box.bottom <= pointY || box.top > pointY) continue;
          const top = document.elementFromPoint(window.innerWidth / 2, pointY);
          if (top && view.contains(top) && !hero.contains(top) && top !== view) {
            found.push(`${hash} at ${y}px: ${top.className} paints over the header`);
          }
        }
        const row = hero.querySelector('.page__above-header');
        // A stuck header keeps its row (back, title, actions) whole at the top, never above it.
        if (row && hero.classList.contains('page--hero-sticky')) {
          const rowTop = row.getBoundingClientRect().top;
          if (rowTop < -1) found.push(`${hash} at ${y}px: the row is ${-rowTop}px above the top`);
        }
        const block = hero.querySelector('.page__header');
        if (row && block) {
          const rowBox = row.getBoundingClientRect();
          const blockBox = block.getBoundingClientRect();
          const opacity = Number(getComputedStyle(block).opacity);
          if (rowBox.bottom > blockBox.top + 2 && opacity > 0.05) {
            found.push(`${hash} at ${y}px: the row overlaps the title block (opacity ${opacity})`);
          }
        }
      }
      window.scrollTo({ top: 0, behavior: 'instant' });
      filler.remove();
      return found;
    }, route);
    problems.push(...found);
  }
  expect(problems).toEqual([]);
});
