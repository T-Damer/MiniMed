import { describe, expect, it } from 'vitest';

import {
  formatModuleCollectionSubtitle,
  formatOverviewCollectionSubtitle,
  moduleDocumentCountFact,
  moduleListedDocumentCount,
} from './module-display';

describe('formatModuleCollectionSubtitle', () => {
  const MB = 1024 * 1024;

  it('returns null for core when no byte totals are known', () => {
    expect(formatModuleCollectionSubtitle(0, 1, 0, 0, { variant: 'core' })).toBeNull();
  });

  it('shows only on-device bytes for core when installed', () => {
    expect(formatModuleCollectionSubtitle(1, 1, 15 * MB, 12 * MB, { variant: 'core' })).toBe(
      '12 МБ',
    );
  });

  it('shows download bytes for core when nothing is installed', () => {
    expect(formatModuleCollectionSubtitle(0, 1, 12 * MB, 0, { variant: 'core' })).toBe('12 МБ');
  });

  it('does not show counts for core', () => {
    expect(formatModuleCollectionSubtitle(0, 1, 12 * MB, 0, { variant: 'core' })).not.toContain(
      '/',
    );
  });

  it('returns null for default when there is nothing to show', () => {
    expect(formatModuleCollectionSubtitle(0, 0, 0, 0)).toBeNull();
  });

  it('shows download size when nothing is installed', () => {
    expect(formatModuleCollectionSubtitle(0, 3, 12 * MB, 0)).toBe('0/3 · 12 МБ');
  });

  it('shows a single size when fully installed and sizes match', () => {
    expect(formatModuleCollectionSubtitle(2, 2, 12 * MB, 12 * MB)).toBe('12 МБ');
  });

  it('prefers installed size when fully installed and sizes differ', () => {
    expect(formatModuleCollectionSubtitle(2, 2, 15 * MB, 12 * MB)).toBe('12 МБ');
  });

  it('shows partial counts with installed and catalog sizes when they differ', () => {
    expect(formatModuleCollectionSubtitle(1, 3, 24 * MB, 12 * MB)).toBe(
      '1/3 · загружено 12 МБ · 24 МБ',
    );
  });

  it('omits duplicate catalog size when it matches installed bytes during partial install', () => {
    expect(formatModuleCollectionSubtitle(1, 3, 12 * MB, 12 * MB)).toBe('1/3 · загружено 12 МБ');
  });
});

describe('formatOverviewCollectionSubtitle', () => {
  const MB = 1024 * 1024;

  it('does not show pack fractions', () => {
    expect(
      formatOverviewCollectionSubtitle({
        documentCountLabel: '8 документов',
        downloadBytes: 12 * MB,
        installedBytes: 0,
      }),
    ).toBe('8 документов · 12 МБ');
    expect(
      formatOverviewCollectionSubtitle({
        downloadBytes: 0,
        installedBytes: 0,
      }),
    ).toBeNull();
  });

  it('shows document count alone when pack size is unknown', () => {
    expect(
      formatOverviewCollectionSubtitle({
        documentCountLabel: '4708 документов',
        downloadBytes: 0,
        installedBytes: 0,
      }),
    ).toBe('4708 документов');
  });

  it('prefers on-device size when present', () => {
    expect(
      formatOverviewCollectionSubtitle({
        documentCountLabel: '12 документов',
        downloadBytes: 15 * MB,
        installedBytes: 12 * MB,
      }),
    ).toBe('12 документов · 12 МБ');
  });
});

describe('moduleDocumentCountFact', () => {
  it('uses preview counts when the document list is still empty', () => {
    expect(
      moduleDocumentCountFact({
        previewDocumentCount: 3,
        documents: [],
      } as never),
    ).toBe('3 документа');
    expect(moduleListedDocumentCount({ previewDocumentCount: 0, documents: [] } as never)).toBe(0);
    expect(moduleDocumentCountFact({ previewDocumentCount: 0, documents: [] } as never)).toBe(
      'Список документов уточняется',
    );
  });
});
