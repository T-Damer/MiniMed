// Raises every CSS font size below the 13 px floor of the UI to 0.8125rem (VIS1, owner 2026-10-14).
//
// Idempotent: run it again after a rebase to catch sizes other work added. Canvas-like surfaces keep
// their sizes (print sheets, image viewers, the ECG and drawing editors, the PDF viewer, the diary
// app). Navigation counters are the one deliberate exception, set in styles/readability.css.
//
//   bun scripts/css-font-floor.mjs           rewrite
//   bun scripts/css-font-floor.mjs --check   list what would change, exit 1 if anything
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../apps/app/src');
const FLOOR_REM = 0.8125;
const SKIP =
  /(^|\/)(diary\/|.*medical-image-print|.*dicom-viewer|.*ecg-editor|.*ecg-photo-caliper|.*note-drawing|.*pdf-viewer|.*print|.*readability)/u;
const REM = /(font-size:\s*)(\d*\.?\d+)rem(\s*;)/gu;
const PX = /(font-size:\s*)(\d+(?:\.\d+)?)px(\s*;)/gu;

function* cssFiles(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) yield* cssFiles(path);
    else if (name.endsWith('.css')) yield path;
  }
}

export function raiseFontSizes(text) {
  return text
    .replace(REM, (whole, head, value, tail) =>
      Number(value) >= FLOOR_REM ? whole : `${head}${FLOOR_REM}rem${tail}`,
    )
    .replace(PX, (whole, head, value, tail) =>
      Number(value) >= 13 ? whole : `${head}${FLOOR_REM}rem${tail}`,
    );
}

if (import.meta.main) {
  const check = process.argv.includes('--check');
  const changed = [];
  for (const path of cssFiles(ROOT)) {
    const name = relative(ROOT, path).split('\\').join('/');
    if (SKIP.test(name)) continue;
    const original = readFileSync(path, 'utf8');
    const updated = raiseFontSizes(original);
    if (updated === original) continue;
    changed.push(name);
    if (!check) writeFileSync(path, updated);
  }
  for (const name of changed) console.log(name);
  process.exit(check && changed.length > 0 ? 1 : 0);
}
