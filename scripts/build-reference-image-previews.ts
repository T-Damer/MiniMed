/**
 * Copies a handful of reference illustrations into the app as bundled previews, so the
 * «Справочные изображения» settings page can show real examples before the set is downloaded.
 *
 *   bun scripts/build-reference-image-previews.ts [--check]
 *
 * Input: `apps/app/public/content/reference-images/manifest.json` and its `assets/` (local, kept
 * out of git). Output: `apps/app/public/content/reference-images-preview/`, the originals byte for
 * byte (no recompression) plus `index.json` with each file's article id, alt text, source URL and
 * sha256 from the manifest. The picks are fixed by sha256 below; the script refuses a file whose
 * checksum differs from the manifest. `--check` verifies the committed output without writing.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const SOURCE = 'apps/app/public/content/reference-images';
const OUTPUT = 'apps/app/public/content/reference-images-preview';

/** Hand-picked: varied modalities (ECG, imaging, anatomy, ultrasound, skin), no identifiable faces. */
const PICKS = [
  '728df57dc02a',
  '8a90e8ebc3b3',
  'b7edaf2414e8',
  'afcd0aa4adf4',
  'd0a1dd5956c1',
  '4719297070c2',
] as const;

interface ManifestRecord {
  readonly alt: string;
  readonly contentType: string;
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
  readonly sourceUrl: string;
}

const { values } = parseArgs({ options: { check: { type: 'boolean', default: false } } });

const manifest = JSON.parse(readFileSync(join(SOURCE, 'manifest.json'), 'utf8')) as {
  readonly images: Readonly<Record<string, readonly ManifestRecord[]>>;
};

const previews = PICKS.map((prefix) => {
  for (const [documentId, records] of Object.entries(manifest.images)) {
    const record = records.find((candidate) => candidate.path.startsWith(`assets/${prefix}`));
    if (record) return { documentId, ...record };
  }
  throw new Error(`Нет изображения ${prefix} в манифесте.`);
});

const index = {
  schemaVersion: 1,
  note: 'Originals of the reference illustrations, unchanged; see the manifest for provenance.',
  images: previews.map((preview) => ({
    documentId: preview.documentId,
    alt: preview.alt,
    contentType: preview.contentType,
    path: preview.path,
    sha256: preview.sha256,
    size: preview.size,
    sourceUrl: preview.sourceUrl,
  })),
};
const indexText = `${JSON.stringify(index, null, 2)}\n`;

if (values.check) {
  const committed = join(OUTPUT, 'index.json');
  if (!existsSync(committed) || readFileSync(committed, 'utf8') !== indexText) {
    throw new Error('Превью справочных изображений устарели: запустите скрипт без --check.');
  }
  for (const preview of previews) {
    const file = join(OUTPUT, preview.path);
    if (!existsSync(file)) throw new Error(`Нет файла ${preview.path}.`);
    const hash = `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`;
    if (hash !== preview.sha256) throw new Error(`Контрольная сумма ${preview.path} не совпала.`);
  }
  console.log(`Превью справочных изображений актуальны: ${previews.length}.`);
} else {
  mkdirSync(join(OUTPUT, 'assets'), { recursive: true });
  for (const preview of previews) {
    const source = join(SOURCE, preview.path);
    const hash = `sha256:${createHash('sha256').update(readFileSync(source)).digest('hex')}`;
    if (hash !== preview.sha256) throw new Error(`Контрольная сумма ${preview.path} не совпала.`);
    copyFileSync(source, join(OUTPUT, preview.path));
  }
  writeFileSync(join(OUTPUT, 'index.json'), indexText);
  console.log(`Записано ${previews.length} превью в ${OUTPUT}.`);
}
