/**
 * Builds a PDF from the HTML deck that looks the same in every viewer. Chromium's own PDF keeps the
 * soft shadows as blur masks, and Preview and Keynote draw those masks as grey rectangles. Here each
 * slide's graphics (shadows, screenshots, icons, QR codes) become one picture, and the text stays
 * real, selectable text in its own place on top of it.
 *
 *   bun install && bun build-pdf.mjs [../index.html] [../diary-presentation.pdf]
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium } from 'playwright';

const html = resolve(process.argv[2] ?? new URL('../index.html', import.meta.url).pathname);
const out = resolve(process.argv[3] ?? html.replace(/(\.full)?\.html$/u, '.pdf'));
const W = 1280;
const H = 720;

const browser = await chromium.launch({ args: ['--mute-audio'] });
const page = await browser.newPage({
  viewport: { width: W + 200, height: H + 200 },
  deviceScaleFactor: 2,
});
await page.goto(pathToFileURL(html).href);
await page.emulateMedia({ media: 'print' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);
await page.addStyleTag({
  content: `
    .pdf-no-text, .pdf-no-text * { color: transparent !important; text-shadow: none !important; }
    .pdf-text-only::before, .pdf-text-only::after,
    .pdf-text-only *, .pdf-text-only *::before, .pdf-text-only *::after {
      background: none !important; border-color: transparent !important; box-shadow: none !important;
      filter: none !important; outline: none !important; text-shadow: none !important;
    }
    .pdf-text-only :is(img, svg, canvas, video, picture, .pdf-covered) { visibility: hidden !important; }
    .pdf-text-only { background-size: ${W}px ${H}px !important; background-repeat: no-repeat !important; }
  `,
});

// Pictures first, all of them, while every slide still looks as designed.
const slides = page.locator('section.slide');
const count = await slides.count();
const pictures = [];
for (let index = 0; index < count; index += 1) {
  const slide = slides.nth(index);
  await slide.scrollIntoViewIfNeeded();
  await slide.evaluate((el) => {
    // Text hidden under something else (placeholders behind screenshots) would show through.
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    const covered = [];
    while (walker.nextNode()) {
      const text = walker.currentNode;
      if (!text.textContent.trim() || text.parentElement.closest('svg, style, script')) continue;
      range.selectNodeContents(text);
      const r = range.getClientRects()[0];
      if (!r) continue;
      const hit = document.elementFromPoint(
        r.left + Math.min(4, r.width / 2),
        r.top + r.height / 2,
      );
      const owner = text.parentElement;
      if (hit && !owner.contains(hit) && !hit.contains(owner)) covered.push(owner);
    }
    for (const owner of covered) owner.classList.add('pdf-covered');
    el.classList.add('pdf-no-text');
  });
  await page.waitForTimeout(100);
  pictures.push(await slide.screenshot({ type: 'jpeg', quality: 88 }));
  await slide.evaluate((el) => el.classList.remove('pdf-no-text'));
}

// Then each slide keeps only its text, laid over its picture.
for (let index = 0; index < count; index += 1) {
  await slides.nth(index).evaluate(
    (el, src) => {
      el.classList.add('pdf-text-only');
      el.style.setProperty('background', `url("${src}") 0 0 / 100% 100% no-repeat`, 'important');
    },
    `data:image/jpeg;base64,${pictures[index].toString('base64')}`,
  );
}

await page.pdf({
  path: out,
  width: `${W}px`,
  height: `${H}px`,
  printBackground: true,
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
});
await browser.close();
console.log(`${count} slides → ${out}`);
