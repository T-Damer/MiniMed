/** Actual Web reader functions, released public chunks and existing test boundaries. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseDocumentText } from '@localmed/app/features/library/document-medication-links';
import {
  documentRenderBlockSearchText,
  readDocumentRenderBlock,
} from '@localmed/app/features/library/document-rich-block-data';
import { REPOSITORY_ROOT } from '@localmed/benchmarks/real-corpus';
import { stripKnownHtmlMarkup } from '@localmed/search-lexical';
// The standalone parser needs the same mdast data augmentation as the Web renderer.
import type {} from 'mdast-util-to-hast';
import { z } from 'zod';

const output = resolve(
  REPOSITORY_ROOT,
  'native/shared/src/commonTest/resources/native-source-text-golden.json',
);
const reportPath = resolve(REPOSITORY_ROOT, 'playwright/native-source-text-oracle-report.json');
const inputs = [
  {
    name: 'core',
    path: 'apps/app/public/content/core.db',
    expectedSha256: '13f238f7fefe1b19eefa19ac9de0ea89fabff34ed96e98d987277f15ab03025f',
  },
  {
    name: 'regulatory',
    path: 'playwright/native-verified-regulatory.db',
    expectedSha256: '61b82c9cc8a6899b24e7b6208642a35ef1a448e15c08990df3c79c7b911ca040',
  },
] as const;
const sources = [
  'apps/app/src/features/library/document-medication-links.ts',
  'apps/app/src/features/library/document-markdown-tables.ts',
  'apps/app/src/features/library/document-rich-block-data.ts',
  'apps/app/src/features/library/markdown-parser.ts',
  'packages/search-lexical/src/html-markup.ts',
  'apps/app/src/components/DocumentText.tsx',
  'apps/app/src/features/library/document-medication-links.test.ts',
  'apps/app/src/features/library/document-rich-block.test.ts',
  'node_modules/mdast-util-mark/index.js',
  'node_modules/mdast-util-mark/package.json',
];
const record = z.record(z.string(), z.unknown());
const rowSchema = z.object({
  documentId: z.string(),
  documentVersionId: z.string(),
  sourceChecksum: z.string(),
  sourceType: z.string(),
  documentMetadataJson: z.string(),
  chunkId: z.string(),
  sectionId: z.string(),
  anchor: z.string(),
  orderIndex: z.number().int(),
  originalText: z.string(),
  metadataJson: z.string(),
  pageStart: z.number().int().nullable(),
  pageEnd: z.number().int().nullable(),
  charStart: z.number().int().nullable(),
  charEnd: z.number().int().nullable(),
});
const moduleName = 'bun:sqlite';
const sqlite: {
  Database: new (
    path: string,
    options: { readonly: boolean },
  ) => {
    query(sql: string): { all(): unknown[] };
    close(): void;
  };
} = await import(moduleName);
const cases: {
  name: string;
  provenance: Readonly<Record<string, unknown>>;
  originalText: string;
  metadataJson: string;
  sourceSpans: unknown;
  strippedText: string;
  parseBlocks: ReturnType<typeof parseDocumentText>;
  displayBlocks: ReturnType<typeof parseDocumentText>;
  renderBlock: ReturnType<typeof readDocumentRenderBlock>;
  renderSearchText: string | null;
}[] = [];
function capture(
  name: string,
  originalText: string,
  metadata: Readonly<Record<string, unknown>>,
  provenance: Readonly<Record<string, unknown>>,
  exactMetadataJson = JSON.stringify(metadata),
) {
  const sourceSpans = metadata['sourceSpans'];
  const strippedText = stripKnownHtmlMarkup(originalText);
  const renderBlock = readDocumentRenderBlock(metadata);
  cases.push({
    name,
    provenance,
    originalText,
    metadataJson: exactMetadataJson,
    sourceSpans: sourceSpans ?? null,
    strippedText,
    parseBlocks: parseDocumentText(originalText, sourceSpans),
    displayBlocks: parseDocumentText(strippedText, sourceSpans),
    renderBlock,
    renderSearchText: renderBlock ? documentRenderBlockSearchText(renderBlock) : null,
  });
}
async function hashFile(path: string) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}
const sourceHashes = await Promise.all(
  sources.map(async (path) => ({ path, sha256: await hashFile(resolve(REPOSITORY_ROOT, path)) })),
);
const artifacts = [];
for (const input of inputs) {
  const path = resolve(REPOSITORY_ROOT, input.path);
  const sha256 = await hashFile(path);
  if (sha256 !== input.expectedSha256)
    throw new Error(`Released ${input.name} artifact hash mismatch`);
  const database = new sqlite.Database(path, { readonly: true });
  try {
    const rows = z.array(rowSchema).parse(
      database
        .query(`SELECT d.id AS documentId,v.id AS documentVersionId,
      v.source_checksum AS sourceChecksum,d.source_type AS sourceType,d.metadata_json AS documentMetadataJson,
      c.id AS chunkId,c.section_id AS sectionId,c.anchor,c.order_index AS orderIndex,c.original_text AS originalText,
      c.metadata_json AS metadataJson,c.page_start AS pageStart,c.page_end AS pageEnd,c.char_start AS charStart,c.char_end AS charEnd
      FROM documents d JOIN document_versions v ON v.document_id=d.id JOIN chunks c ON c.document_version_id=v.id
      WHERE d.source_type<>'core_catalog_pointer' AND json_extract(d.metadata_json,'$.publicPilot')=1
      AND json_extract(d.metadata_json,'$.syntheticFixture')=0 ORDER BY d.id,v.id,c.section_id,c.order_index,c.id`)
        .all(),
    );
    const documents = new Set<string>();
    for (const row of rows) {
      const metadata = record.parse(JSON.parse(row.metadataJson));
      const documentMetadata = record.parse(JSON.parse(row.documentMetadataJson));
      documents.add(row.documentId);
      capture(
        `${input.name}:${row.chunkId}`,
        row.originalText,
        metadata,
        {
          artifact: input.path,
          artifactSha256: sha256,
          documentId: row.documentId,
          documentVersionId: row.documentVersionId,
          sourceChecksum: row.sourceChecksum,
          sourceType: row.sourceType,
          documentMetadataJson: row.documentMetadataJson,
          contentMode: documentMetadata['contentMode'],
          chunkId: row.chunkId,
          sectionId: row.sectionId,
          anchor: row.anchor,
          orderIndex: row.orderIndex,
          pageStart: row.pageStart,
          pageEnd: row.pageEnd,
          charStart: row.charStart,
          charEnd: row.charEnd,
          originalTextSha256: createHash('sha256').update(row.originalText).digest('hex'),
          metadataSha256: createHash('sha256').update(row.metadataJson).digest('hex'),
        },
        row.metadataJson,
      );
    }
    artifacts.push({
      name: input.name,
      path: input.path,
      sha256,
      documentCount: documents.size,
      chunkCount: rows.length,
    });
  } finally {
    database.close();
  }
}

const textTest = 'apps/app/src/features/library/document-medication-links.test.ts';
const richTest = 'apps/app/src/features/library/document-rich-block.test.ts';
function boundary(
  name: string,
  originalText: string,
  metadata: Readonly<Record<string, unknown>> = {},
  source = textTest,
  variantOf: string | null = null,
) {
  capture(`boundary:${name}`, originalText, metadata, {
    kind: 'test-only-boundary',
    source,
    variantOf,
  });
}
// Literal cases from the existing Web reliability suite; results are always actual function calls.
boundary(
  'gfm-between-prose',
  'До таблицы.\n\n| Возраст | Мальчики |\n| --- | ---: |\n| 0–<1 года | 93–134 |\n\nПосле таблицы.',
);
const escapedTable = '| Название | Значение |\n| :- | -: |\n| **A** \\| B | `1 < 2` |';
boundary('gfm-escaping-code', escapedTable);
boundary('gfm-fenced-code', `\u0060\u0060\u0060\n${escapedTable}\n\u0060\u0060\u0060`);
boundary(
  'ocr-bullets',
  'Введение • Рекомендуется #дексаметазон** (H02AB)\n\nдля лечения.\n\n• Наблюдать.',
);
boundary('ordered-instructions', '1. Первый шаг\n\n2. Второй шаг');
boundary('ordinal-over-int', '2147483648. Item', {}, textTest, 'ordered-instructions');
boundary('table-nbsp', '| H |\n| --- |\n| \u00a0A\u00a0 |', {}, textTest, 'gfm-between-prose');
boundary(
  'table-image-alt',
  '| H |\n| --- |\n| ![ALT](https://example.test/a.png) |',
  {},
  textTest,
  'gfm-between-prose',
);
boundary('table-raw-html', '| H |\n| --- |\n| <b>A</b> |', {}, textTest, 'gfm-between-prose');

boundary(
  'reference-image',
  'Описание заболевания.\n\n![Иллюстрация](https://www.krasotaimedicina.ru/upload/iblock/a/a.jpg)\n\n[Источник изображения](https://www.krasotaimedicina.ru/upload/iblock/a/a.jpg)',
);
boundary(
  'implicit-list',
  'Медицинская помощь оказывается в следующих условиях:\n\nвне медицинской организации;\n\nамбулаторно;\n\nстационарно.',
);
boundary('bbox-list-end', '• Пункт начинается\n\nи продолжается.\n\nСледующий раздел', {
  sourceSpans: [{ bbox: [100, 0, 0, 0] }, { bbox: [120, 0, 0, 0] }, { bbox: [80, 0, 0, 0] }],
});
const embeddedImage = {
  kind: 'image',
  dataUrl: 'data:image/png;base64,AAAA',
  alt: 'Схема в ячейке',
};
const table = {
  kind: 'table',
  caption: 'Показатели',
  rows: [
    {
      cells: [
        { text: 'Возраст', header: true, rowSpan: 2, colSpan: 1 },
        { text: 'Значение', header: false, rowSpan: 1, colSpan: 2, images: [embeddedImage] },
      ],
    },
  ],
};
boundary('metadata-spans-image', 'Показатели', { renderBlock: table }, richTest);
boundary(
  'metadata-safe-image',
  'Схема',
  {
    renderBlock: { kind: 'image', dataUrl: 'data:image/png;base64,AAAA', alt: 'Схема', title: '' },
  },
  richTest,
);
boundary(
  'metadata-remote-image-rejected',
  'image',
  { renderBlock: { kind: 'image', dataUrl: 'https://example.test/image.png' } },
  richTest,
);
boundary(
  'metadata-zero-span-rejected',
  'bad',
  { renderBlock: { kind: 'table', rows: [{ cells: [{ text: 'bad', rowSpan: 0, colSpan: 1 }] }] } },
  richTest,
);
// Variations exercise the same authoring contracts; they are not clinical/source claims.
boundary(
  'bbox-paragraph-join',
  'Одна строка\n\nвторая строка.\n\nТретий абзац.',
  { sourceSpans: [{ bbox: [100] }, { bbox: [103] }, { bbox: [100] }] },
  textTest,
  'bbox-list-end',
);
boundary(
  'bbox-exact-list-stop',
  '• Первая строка\n\nВторая строка',
  { sourceSpans: [{ bbox: [100] }, { bbox: [104] }] },
  textTest,
  'bbox-list-end',
);
boundary(
  'bbox-continued-list',
  '• Первая строка\n\nВторая строка',
  { sourceSpans: [{ bbox: [100] }, { bbox: [104.1] }] },
  textTest,
  'bbox-list-end',
);
boundary(
  'bbox-malformed-fallback',
  '• Первая строка\n\nВторая строка',
  { sourceSpans: [{ bbox: ['100'] }, null] },
  textTest,
  'bbox-list-end',
);
boundary(
  'ocr-symbols-unicode',
  'Введение\r\n\r\n▪ первый;\r\n\r\n◦ второй;\r\n\r\n● третий;\r\n\r\n○ четвёртый. 😀',
  {},
  textTest,
  'ocr-bullets',
);
boundary('empty-text', '', {}, textTest, 'ordered-instructions');
boundary(
  'ordered-nonconsecutive',
  '7) Первый шаг\n\n10. Второй шаг',
  {},
  textTest,
  'ordered-instructions',
);
boundary(
  'gfm-align-all',
  '| Лево | Центр | Право |\n| :--- | :---: | ---: |\n| A | B | C |',
  {},
  textTest,
  'gfm-between-prose',
);
boundary(
  'gfm-missing-extra-cells',
  '| A | B |\n| --- | --- |\n| один |\n| два | три | четыре |',
  {},
  textTest,
  'gfm-between-prose',
);
boundary(
  'gfm-inline-link-emphasis',
  '| A | B |\n| --- | --- |\n| [Имя](https://example.test/) | *текст* ~~был~~ |',
  {},
  textTest,
  'gfm-escaping-code',
);
boundary('gfm-tilde-fence', `~~~\n${escapedTable}\n~~~`, {}, textTest, 'gfm-fenced-code');
boundary(
  'html-known-tags-comparison',
  '<div><strong>Заголовок</strong><br>Значение &lt;38°C &amp; ≥2.</div>',
  {},
  textTest,
  'ocr-bullets',
);
boundary(
  'gfm-with-source-spans',
  'Введение.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n• Строка\n\nпродолжение.',
  { sourceSpans: [{ bbox: [100] }, { bbox: [100] }, { bbox: [120] }, { bbox: [140] }] },
  textTest,
  'bbox-list-end',
);
boundary(
  'metadata-merged-grid',
  'Таблица',
  {
    renderBlock: {
      kind: 'table',
      caption: 'Таблица',
      rows: [
        {
          cells: [
            { text: 'A', header: true, rowSpan: 2, colSpan: 1 },
            { text: 'B', header: true, rowSpan: 1, colSpan: 2 },
          ],
        },
        {
          cells: [
            { text: 'C', header: false, rowSpan: 1, colSpan: 1 },
            { text: 'D', header: false, rowSpan: 1, colSpan: 1 },
          ],
        },
      ],
    },
  },
  richTest,
  'metadata-spans-image',
);
boundary(
  'metadata-span-upper-bound',
  'Таблица',
  {
    renderBlock: { kind: 'table', rows: [{ cells: [{ text: 'A', rowSpan: 100, colSpan: 100 }] }] },
  },
  richTest,
  'metadata-spans-image',
);
boundary(
  'metadata-span-too-large',
  'Таблица',
  { renderBlock: { kind: 'table', rows: [{ cells: [{ text: 'A', rowSpan: 101, colSpan: 1 }] }] } },
  richTest,
  'metadata-zero-span-rejected',
);
boundary(
  'metadata-empty-rows',
  'Таблица',
  { renderBlock: { kind: 'table', rows: [{ cells: [] }] } },
  richTest,
  'metadata-zero-span-rejected',
);
boundary(
  'metadata-filename-image-label',
  'image.png',
  {
    renderBlock: {
      kind: 'image',
      dataUrl: 'data:image/png;base64,AAAA',
      alt: 'image.png',
      title: 'Рис. 1. Схема',
    },
  },
  richTest,
  'metadata-safe-image',
);

boundary(
  'bbox-paragraph-exact-stop',
  'Одна строка\n\nвторая строка.',
  { sourceSpans: [{ bbox: [100] }, { bbox: [104] }] },
  textTest,
  'bbox-paragraph-join',
);
boundary(
  'implicit-fullwidth-colon',
  'Варианты：\n\nпервый;\n\nвторой.',
  {},
  textTest,
  'implicit-list',
);
boundary(
  'unicode-js-whitespace',
  '\u00a0Первый абзац.\ufeff\n\n\u0085Не пробел ECMAScript.',
  {},
  textTest,
  'ocr-bullets',
);
boundary(
  'html-entities-uppercase-and-numeric',
  'A &AMP; &amp; &#128512; &#x1f600; <38°C и <unknown>исходный тег</unknown>',
  {},
  textTest,
  'html-known-tags-comparison',
);
boundary(
  'metadata-noninteger-span-rejected',
  'Таблица',
  { renderBlock: { kind: 'table', rows: [{ cells: [{ text: 'A', rowSpan: 1.5, colSpan: 1 }] }] } },
  richTest,
  'metadata-zero-span-rejected',
);
boundary(
  'metadata-align-original-retained',
  'Таблица',
  {
    renderBlock: {
      kind: 'table',
      caption: 'Таблица',
      rows: [{ cells: [{ text: 'A', header: true, rowSpan: 1, colSpan: 1, align: 'right' }] }],
    },
  },
  richTest,
  'metadata-spans-image',
);

const fixture = {
  schemaVersion: 1,
  authority: 'actual-Web-reader-functions',
  sources: sourceHashes,
  artifacts,
  scope: {
    publicPilotOnly: true,
    privateContent: false,
    syntheticFixtures: true,
    tableAndImageCases: 'existing-Web-test-boundaries-and-explicit-variations',
    captionNeighborConsumption: 'not-part-of-this-chunk-preserving-parser-oracle',
    sourceSpansAbsentTransport: null,
  },
  cases,
};
const encoded = `${JSON.stringify(fixture, null, 2)}\n`;
await mkdir(dirname(output), { recursive: true });
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(output, encoded);
const counts: Record<string, number> = {};
for (const row of cases)
  for (const block of row.displayBlocks) counts[block.kind] = (counts[block.kind] ?? 0) + 1;
const report = {
  schemaVersion: 1,
  output: 'native/shared/src/commonTest/resources/native-source-text-golden.json',
  outputBytes: Buffer.byteLength(encoded),
  outputSha256: createHash('sha256').update(encoded).digest('hex'),
  exporterSha256: createHash('sha256')
    .update(
      await readFile(resolve(REPOSITORY_ROOT, 'tools/benchmarks/src/export-native-source-text.ts')),
    )
    .digest('hex'),
  artifacts,
  sourceHashes,
  caseCount: cases.length,
  publicChunkCount: cases.filter((row) => !row.name.startsWith('boundary:')).length,
  boundaryCount: cases.filter((row) => row.name.startsWith('boundary:')).length,
  displayBlockCounts: counts,
  sourceSpanCaseCount: cases.filter((row) => row.sourceSpans !== null).length,
  validatedRichBlockCount: cases.filter((row) => row.renderBlock !== null).length,
  limitations: [
    'Published input chunks contain no rich tables; table/image cases are explicitly test-only.',
    'Caption-neighbor row consumption, bitmap/PDF decoding and inline navigation are not qualified by this parser oracle.',
  ],
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify({
    caseCount: report.caseCount,
    publicChunkCount: report.publicChunkCount,
    boundaryCount: report.boundaryCount,
    outputSha256: report.outputSha256,
    outputBytes: report.outputBytes,
  }),
);
