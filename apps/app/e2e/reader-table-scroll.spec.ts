import { expect, type Locator, test } from '@playwright/test';

import { installClinicalModule, routeClinicalModule } from './clinical-module-fixture';
import { mountBuiltApp } from './mount-built-app';

/** A table can be taller than the screen: bring its top into view, where a touch lands on it. */
async function showTableTop(table: Locator): Promise<void> {
  await table.evaluate((element) => {
    element.scrollIntoView({ block: 'start', behavior: 'instant' });
    window.scrollBy({ top: -120, behavior: 'instant' });
  });
  await expect
    .poll(() => table.evaluate((element) => Math.round(element.getBoundingClientRect().top)))
    .toBeGreaterThan(0);
}

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

// «Острая ишемия конечностей» (kr.rf.1006_1) has 22 tables, most of them wider than a phone.
test('a wide table scrolls sideways under a finger, in the page and in its full-screen preview', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await routeClinicalModule(page);
  await mountBuiltApp(page);
  await installClinicalModule(page);
  await page.locator('.document-overlay-section__title').first().waitFor();
  const table = page.locator('.document-rich-table').first();
  await showTableTop(table);
  const scroller = table.locator('.document-rich-table__scroller');
  const overflow = await scroller.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeGreaterThan(40);

  const cdp = await page.context().newCDPSession(page);
  const swipeLeft = async (x: number, y: number): Promise<void> => {
    await cdp.send('Input.synthesizeScrollGesture', {
      x,
      y,
      xDistance: -200,
      yDistance: 0,
      gestureSourceType: 'touch',
      speed: 800,
    });
  };

  // In the page: the table's own scroller moves, the zoom wrapper does not swallow the swipe.
  const box = await scroller.boundingBox();
  if (!box) throw new Error('The table has no box.');
  await swipeLeft(box.x + box.width / 2, box.y + Math.min(80, box.height / 2));
  await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(40);

  // In the preview, zoomed in: the preview scrolls sideways too.
  await table.getByRole('button', { name: 'Открыть таблицу на весь экран' }).click();
  const content = page.locator('.media-viewer__content');
  await content.waitFor();
  await page.getByRole('button', { name: 'Увеличить' }).click();
  await page.getByRole('button', { name: 'Увеличить' }).click();
  await content.evaluate((element) => {
    element.scrollLeft = 0;
  });
  const viewerBox = await content.boundingBox();
  if (!viewerBox) throw new Error('The preview has no box.');
  await swipeLeft(viewerBox.x + viewerBox.width / 2, viewerBox.y + 120);
  await expect.poll(() => content.evaluate((element) => element.scrollLeft)).toBeGreaterThan(40);
});

test('a two-finger pinch still zooms a table in the page', async ({ page }) => {
  test.setTimeout(180_000);
  await routeClinicalModule(page);
  await mountBuiltApp(page);
  await installClinicalModule(page);
  await page.locator('.document-overlay-section__title').first().waitFor();
  const table = page.locator('.document-rich-table').first();
  await showTableTop(table);
  const box = await table.locator('.document-rich-table__scroller').boundingBox();
  if (!box) throw new Error('The table has no box.');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.synthesizePinchGesture', {
    x: box.x + box.width / 2,
    y: box.y + Math.min(80, box.height / 2),
    scaleFactor: 1.8,
    relativeSpeed: 400,
    gestureSourceType: 'touch',
  });
  await expect(table.locator('.pinch-zoom-surface--zoomed')).toHaveCount(1);
});

test('a wide table keeps its header row and first column in view while it scrolls in its box', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await routeClinicalModule(page);
  await mountBuiltApp(page);
  await installClinicalModule(page);
  await page.locator('.document-overlay-section__title').first().waitFor();
  const scroller = page.locator('.document-rich-table__scroller--wide').first();
  await scroller.scrollIntoViewIfNeeded();
  const geometry = () =>
    scroller.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const head = element.querySelector('.document-rich-table__cell--pin-row');
      const lead = element.querySelector('.document-rich-table__cell--pin-column');
      const rows = element.querySelectorAll('tr');
      const body = rows[Math.min(rows.length - 1, 3)]?.querySelector(
        '.document-rich-table__cell--pin-column',
      );
      return {
        scrollerLeft: box.left,
        scrollerTop: box.top,
        headTop: head?.getBoundingClientRect().top ?? Number.NaN,
        leadLeft: lead?.getBoundingClientRect().left ?? Number.NaN,
        bodyLeft: body?.getBoundingClientRect().left ?? Number.NaN,
        scrollable: element.scrollWidth - element.clientWidth,
        tall: element.scrollHeight - element.clientHeight,
      };
    });
  expect((await geometry()).scrollable).toBeGreaterThan(40);

  await scroller.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
    element.scrollTop = element.scrollHeight;
  });
  const after = await geometry();
  // The pinned cells stay at the box's edges whichever way the table is scrolled.
  expect(after.leadLeft).toBeCloseTo(after.scrollerLeft, 0);
  expect(after.bodyLeft).toBeCloseTo(after.scrollerLeft, 0);
  if (after.tall > 0) expect(after.headTop).toBeCloseTo(after.scrollerTop, 0);
});
