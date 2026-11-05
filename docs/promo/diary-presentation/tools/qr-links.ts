/**
 * Rebuilds the slides' QR codes from `links.json`: every `<svg class="qr">` whose aria-label is
 * «QR-код: <label>» encodes that link's `qr` address, then each code is read back from the page
 * (jsQR over the drawn modules) to prove it opens what it should. The printed text is not touched:
 * it is the short domain, `text` in `links.json`, checked to appear next to its code.
 *
 *   bun docs/promo/diary-presentation/tools/qr-links.ts          # rewrite index.html
 *   bun docs/promo/diary-presentation/tools/qr-links.ts --check  # only verify
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import jsQR from 'jsqr';
import QRCode from 'qrcode';

interface Link {
  readonly label: string;
  readonly text: string;
  readonly qr: string;
}

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const PAGE = join(ROOT, 'index.html');
const { links } = JSON.parse(readFileSync(join(ROOT, 'links.json'), 'utf8')) as {
  links: readonly Link[];
};
const QUIET = 2;
const SVG = /<svg class="qr"[^>]*aria-label="QR-код: ([^"]+)"[^>]*>[\s\S]*?<\/svg>/gu;

function svgFor(link: Link): string {
  const code = QRCode.create(link.qr, { errorCorrectionLevel: 'M' });
  const size = code.modules.size;
  const side = size + 2 * QUIET;
  let path = '';
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!code.modules.get(y, x) || (x > 0 && code.modules.get(y, x - 1))) continue;
      let run = 1;
      while (x + run < size && code.modules.get(y, x + run)) run += 1;
      path += `M${x + QUIET} ${y + QUIET}h${run}v1h-${run}z`;
    }
  }
  return `<svg class="qr" viewBox="0 0 ${side} ${side}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="QR-код: ${link.label}" shape-rendering="crispEdges"><rect width="${side}" height="${side}" fill="#fff"/><path d="${path}" fill="#1f1d17"/></svg>`;
}

/** Reads a drawn code back: the path's runs painted at 8 px a module, then jsQR. */
function decode(svg: string): string | undefined {
  const side = Number(/viewBox="0 0 (\d+) \d+"/u.exec(svg)?.[1]);
  const scale = 8;
  const width = side * scale;
  const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
  for (const [, x, y, run] of svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/gu)) {
    for (let py = Number(y) * scale; py < (Number(y) + 1) * scale; py += 1) {
      for (let px = Number(x) * scale; px < (Number(x) + Number(run)) * scale; px += 1) {
        pixels.fill(0, (py * width + px) * 4, (py * width + px) * 4 + 3);
      }
    }
  }
  return jsQR(pixels, width, width)?.data;
}

const check = process.argv.includes('--check');
const source = readFileSync(PAGE, 'utf8');
const seen = new Map<string, number>();
const page = source.replace(SVG, (svg, label: string) => {
  const link = links.find((candidate) => candidate.label === label);
  if (!link) throw new Error(`no link in links.json for the QR code «${label}»`);
  seen.set(label, (seen.get(label) ?? 0) + 1);
  return check ? svg : svgFor(link);
});
const problems: string[] = [];
for (const link of links) {
  if (!seen.has(link.label)) problems.push(`«${link.label}»: no QR code on the slides`);
}
for (const [svg, label] of page.matchAll(SVG)) {
  const link = links.find((candidate) => candidate.label === label);
  const read = decode(svg);
  if (read !== link?.qr) problems.push(`«${label}» reads ${read ?? 'nothing'}, not ${link?.qr}`);
}
const visible = page.replace(/<br>/gu, '');
for (const link of links) {
  if (!visible.includes(link.text))
    problems.push(`«${link.label}»: the slides never print ${link.text}`);
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
if (!check && page !== source) writeFileSync(PAGE, page);
console.log(
  [...seen]
    .map(
      ([label, count]) =>
        `${label}: ${count} code(s) → ${links.find((l) => l.label === label)?.qr}`,
    )
    .join('\n'),
);
