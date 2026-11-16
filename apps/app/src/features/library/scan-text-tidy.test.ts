import type { MedicalDocument } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  collapseScanRepeats,
  isContentFreeScanText,
  isScrapScanHeading,
  tidyScannedDocument,
} from '@/features/library/scan-text-tidy';

const chunk = (id: string, originalText: string) => ({ id, anchor: id, originalText }) as never;
const section = (id: string, title: string, chunks: readonly unknown[]) =>
  ({ id, title, anchor: id, chunks }) as never;
const scan = (sections: readonly unknown[], ocr: unknown = true): MedicalDocument =>
  ({ id: 'd', metadata: { ocr }, sections }) as unknown as MedicalDocument;

describe('a scanned instruction as the reader shows it', () => {
  it('tells a chunk with no word from text', () => {
    expect(isContentFreeScanText('0 0 0 00000011')).toBe(true);
    expect(isContentFreeScanText('(на')).toBe(true);
    expect(isContentFreeScanText('3 года.')).toBe(false);
  });

  it('keeps one copy of a sentence printed twice in a row, and nothing shorter', () => {
    expect(
      collapseScanRepeats(
        'Не применять по истечении срока годности, Не применять по истечении срока годности, указанного на упаковке.',
      ),
    ).toBe('Не применять по истечении срока годности, указанного на упаковке.');
    // Short repeats are ordinary language: «по 1 таблетке, по 1 таблетке».
    expect(collapseScanRepeats('по 1 таблетке, по 1 таблетке утром и вечером')).toBe(
      'по 1 таблетке, по 1 таблетке утром и вечером',
    );
    // A repeat with other words between its copies stays.
    const apart =
      'Хранить при температуре не выше 25 °C. Срок годности 3 года. Хранить при температуре не выше 25 °C.';
    expect(collapseScanRepeats(apart)).toBe(apart);
  });

  it('tells a scrap of a stamp from a heading', () => {
    expect(isScrapScanHeading('ИЛИ')).toBe(true);
    expect(isScrapScanHeading('LLC')).toBe(true);
    expect(isScrapScanHeading('Срок годности')).toBe(false);
    expect(isScrapScanHeading('Состав')).toBe(false);
  });

  it('drops empty chunks, joins a scrap heading to the section above, lists no empty section', () => {
    const tidy = tidyScannedDocument(
      scan([
        section('s1', 'Срок годности', [chunk('c1', '3 года.'), chunk('c2', '0 0 0')]),
        section('s2', 'ИЛИ', [chunk('c3', 'Не применять после срока.')]),
        section('s3', 'Представитель', [chunk('c4', '— —')]),
      ]),
    );
    expect(tidy.sections.map((item) => item.title)).toEqual(['Срок годности']);
    expect(tidy.sections[0]?.chunks.map((item) => item.id)).toEqual(['c1', 'c3']);
  });

  it('leaves a document that is not a scan exactly as it is', () => {
    const document = scan([section('s1', 'ИЛИ', [chunk('c1', '0 0')])], false);
    expect(tidyScannedDocument(document)).toBe(document);
  });
});
