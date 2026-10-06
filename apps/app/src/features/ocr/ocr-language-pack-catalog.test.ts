import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  buildOcrLanguagePackDescriptor,
  formatOcrPackSize,
  OCR_LANGUAGE_PACK_FILES,
  OCR_LANGUAGE_PACK_TOTAL_BYTES,
  OCR_LANGUAGE_PACK_VERSION,
  type OcrLanguagePackFile,
  parseOcrLanguagePackDescriptor,
  verifyOcrLanguageFile,
} from './ocr-language-pack-catalog';

const SAMPLE = new Uint8Array([31, 139, 8, 0, 1, 2, 3, 4, 5]);

function sampleFile(overrides: Partial<OcrLanguagePackFile> = {}): OcrLanguagePackFile {
  return {
    language: 'eng',
    sources: ['https://example.invalid/eng.traineddata.gz'],
    bytes: SAMPLE.byteLength,
    sha256: createHash('sha256').update(SAMPLE).digest('hex'),
    ...overrides,
  };
}

describe('OCR language pack catalog', () => {
  it('lists the two languages tesseract is started with, from pinned immutable sources', () => {
    expect(OCR_LANGUAGE_PACK_FILES.map((file) => file.language)).toEqual(['eng', 'rus']);
    for (const file of OCR_LANGUAGE_PACK_FILES) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(file.sources.length).toBeGreaterThan(1);
      for (const source of file.sources) {
        expect(source.startsWith('https://')).toBe(true);
        // A commit hash, not a branch: the bytes behind a URL must not move under the checksum.
        expect(source).toMatch(/[0-9a-f]{40}/u);
        expect(source.endsWith(`/${file.language}.traineddata.gz`)).toBe(true);
      }
    }
    expect(OCR_LANGUAGE_PACK_TOTAL_BYTES).toBe(19_557_397);
  });

  it('formats the size with a Russian decimal comma', () => {
    expect(formatOcrPackSize(OCR_LANGUAGE_PACK_TOTAL_BYTES)).toBe('19,6 МБ');
    expect(formatOcrPackSize(1_500_000)).toBe('1,5 МБ');
  });

  it('accepts exactly the catalog bytes', async () => {
    await expect(verifyOcrLanguageFile(sampleFile(), SAMPLE)).resolves.toBeUndefined();
  });

  it('rejects a different size before looking at the content', async () => {
    await expect(verifyOcrLanguageFile(sampleFile(), SAMPLE.slice(1))).rejects.toThrow(
      /размер не совпадает/u,
    );
  });

  it('rejects the right size with different content', async () => {
    const tampered = Uint8Array.from(SAMPLE);
    tampered[8] = 99;
    await expect(verifyOcrLanguageFile(sampleFile(), tampered)).rejects.toThrow(
      /контрольная сумма/u,
    );
  });

  it('round-trips the installed descriptor and rejects anything else', () => {
    const descriptor = buildOcrLanguagePackDescriptor('2026-10-07T00:00:00.000Z');
    expect(parseOcrLanguagePackDescriptor(JSON.parse(JSON.stringify(descriptor)))).toEqual(
      descriptor,
    );
    expect(parseOcrLanguagePackDescriptor(null)).toBeNull();
    expect(parseOcrLanguagePackDescriptor({ ...descriptor, version: 'tessdata-3.0.0' })).toBeNull();
    expect(parseOcrLanguagePackDescriptor({ ...descriptor, installedAt: 7 })).toBeNull();
    expect(
      parseOcrLanguagePackDescriptor({ ...descriptor, files: descriptor.files.slice(1) }),
    ).toBeNull();
    expect(
      parseOcrLanguagePackDescriptor({
        ...descriptor,
        files: descriptor.files.map((file) => ({ ...file, sha256: '0'.repeat(64) })),
      }),
    ).toBeNull();
    expect(descriptor.version).toBe(OCR_LANGUAGE_PACK_VERSION);
  });
});
