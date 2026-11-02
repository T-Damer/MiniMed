/**
 * Builds an editable PPTX from the HTML deck: every slide becomes a picture of its graphics
 * (screenshots, icons, emoji as PNG, QR codes) with the text laid over it as real text boxes at
 * the same places, so the deck can be edited and the text stays sharp.
 *
 *   bun install && bun build-pptx.mjs [../index.html] [../diary-presentation.pptx]
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium } from 'playwright';
import pptxgen from 'pptxgenjs';

const html = resolve(process.argv[2] ?? new URL('../index.html', import.meta.url).pathname);
const out = resolve(process.argv[3] ?? html.replace(/(\.full)?\.html$/u, '.pptx'));
const W = 1280;
const H = 720;
const IN = 13.333 / W;
/** Type scale against the wider text of Keynote and PowerPoint. */
const FIT = 0.95;

const browser = await chromium.launch({ args: ['--mute-audio'] });
const page = await browser.newPage({
  viewport: { width: W + 200, height: H + 200 },
  deviceScaleFactor: 2,
});
await page.goto(pathToFileURL(html).href);
await page.emulateMedia({ media: 'print' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);

const count = await page.locator('section.slide').count();
const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE';
pres.title = await page.title();

for (let index = 0; index < count; index += 1) {
  const slideEl = page.locator('section.slide').nth(index);
  await slideEl.scrollIntoViewIfNeeded();
  const boxes = await slideEl.evaluate((slide) => {
    const origin = slide.getBoundingClientRect();
    const inline = (el) =>
      getComputedStyle(el).display.startsWith('inline') &&
      getComputedStyle(el).display !== 'inline-block' &&
      getComputedStyle(el).display !== 'inline-flex';
    const blockOf = (node) => {
      let el = node.parentElement;
      while (el && el !== slide && inline(el)) el = el.parentElement;
      return el;
    };
    const visible = (el) => {
      const style = getComputedStyle(el);
      return (
        style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05
      );
    };
    const hex = (color) => {
      const m = color.match(/[\d.]+/gu)?.map(Number) ?? [0, 0, 0, 1];
      return {
        hex: m
          .slice(0, 3)
          .map((v) => Math.round(v).toString(16).padStart(2, '0'))
          .join(''),
        alpha: m[3] ?? 1,
      };
    };
    const groups = new Map();
    const walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode;
      if (!text.textContent.trim() || text.parentElement.closest('svg, style, script')) continue;
      const block = blockOf(text);
      if (!block || !visible(text.parentElement)) continue;
      if (!groups.has(block)) groups.set(block, []);
      groups.get(block).push(text);
    }
    const result = [];
    for (const [block, texts] of groups) {
      // Skip text hidden under something else (placeholders behind screenshots).
      const range = document.createRange();
      range.selectNodeContents(texts[0]);
      const first = range.getClientRects()[0];
      if (!first) continue;
      const hit = document.elementFromPoint(
        first.left + Math.min(4, first.width / 2),
        first.top + first.height / 2,
      );
      if (!hit || !(block.contains(hit) || hit.contains(block))) continue;
      const cs = getComputedStyle(block);
      const box = block.getBoundingClientRect();
      const padL = parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
      const padR = parseFloat(cs.paddingRight) + parseFloat(cs.borderRightWidth);
      let top = Infinity;
      let left = Infinity;
      let right = -Infinity;
      let bottom = -Infinity;
      for (const t of texts) {
        range.selectNodeContents(t);
        for (const r of range.getClientRects()) {
          top = Math.min(top, r.top);
          left = Math.min(left, r.left);
          right = Math.max(right, r.right);
          bottom = Math.max(bottom, r.bottom);
        }
      }
      const runs = [];
      let lastParent = null;
      for (const t of texts) {
        const el = t.parentElement;
        const s = getComputedStyle(el);
        const before = t.previousSibling;
        const breakBefore =
          runs.length > 0 &&
          (before?.nodeName === 'BR' ||
            (lastParent &&
              el !== lastParent &&
              !el.contains(lastParent) &&
              getComputedStyle(el).display === 'block'));
        let value = t.textContent.replace(/\s+/gu, ' ');
        if (s.textTransform === 'uppercase') value = value.toUpperCase();
        const color = hex(s.color);
        runs.push({
          text: value,
          breakBefore,
          size: parseFloat(s.fontSize),
          bold: Number(s.fontWeight) >= 600,
          italic: s.fontStyle === 'italic',
          font: s.fontFamily,
          color: color.hex,
          alpha: color.alpha,
          spacing: parseFloat(s.letterSpacing) || 0,
          lineHeight: parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.25,
        });
        lastParent = el;
      }
      if (runs.length) runs[0].text = runs[0].text.replace(/^\s+/u, '');
      const align =
        cs.textAlign === 'center'
          ? 'center'
          : cs.textAlign === 'right' || cs.textAlign === 'end'
            ? 'right'
            : 'left';
      const lineHeight = runs[0].lineHeight;
      const lines = Math.max(1, Math.round((bottom - top) / lineHeight));
      result.push({
        x: (lines > 1 || align !== 'left' ? box.left + padL : left) - origin.left,
        right: Math.max(box.right - padR, right) - origin.left,
        textLeft: left - origin.left,
        textRight: right - origin.left,
        y: top - (lineHeight - (bottom - top) / lines) / 2 - origin.top,
        h: lines * lineHeight,
        align,
        lines,
        runs,
      });
    }
    slide.classList.add('pptx-no-text');
    return result;
  });
  await page.addStyleTag({
    content:
      '.pptx-no-text, .pptx-no-text * { color: transparent !important; text-shadow: none !important; }',
  });
  await page.waitForTimeout(100);
  const picture = await slideEl.screenshot({ type: 'jpeg', quality: 90 });
  await slideEl.evaluate((slide) => slide.classList.remove('pptx-no-text'));

  const slide = pres.addSlide();
  slide.addImage({
    data: `image/jpeg;base64,${picture.toString('base64')}`,
    x: 0,
    y: 0,
    w: W * IN,
    h: H * IN,
  });
  for (const box of boxes) {
    const font = (family) =>
      /Georgia|serif/iu.test(family) && !/sans/iu.test(family)
        ? 'Georgia'
        : /Code|mono|Consolas/iu.test(family)
          ? 'Consolas'
          : 'Arial';
    // Keynote and PowerPoint set text a little wider than Chromium: the box keeps to its block (never
    // past a card's padding) and the type is a touch smaller, so lines neither spill nor touch edges.
    const x = box.align === 'left' ? box.textLeft : box.x;
    const w = box.right - x;
    slide.addText(
      box.runs.map((run) => ({
        text: run.text,
        options: {
          breakLine: false,
          ...(run.breakBefore ? { softBreakBefore: true } : {}),
          fontSize: Math.round(run.size * 0.75 * FIT * 10) / 10,
          fontFace: font(run.font),
          bold: run.bold,
          italic: run.italic,
          color: run.color,
          ...(run.alpha < 0.99 ? { transparency: Math.round((1 - run.alpha) * 100) } : {}),
          ...(run.spacing ? { charSpacing: run.spacing * 0.75 } : {}),
        },
      })),
      {
        x: x * IN,
        y: box.y * IN,
        w: w * IN,
        h: (box.h + 4) * IN,
        margin: 0,
        align: box.align,
        valign: 'top',
        lineSpacing: box.runs[0].lineHeight * 0.75,
        fit: 'none',
        wrap: true,
        isTextBox: true,
      },
    );
  }
}

await browser.close();
await pres.writeFile({ fileName: out });
console.log(`${count} slides → ${out}`);
