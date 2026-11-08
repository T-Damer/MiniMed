import { describe, expect, it } from 'vitest';

import { helpSourceRow, sourceSiteName } from '@/components/help-sources';

describe('helpSourceRow', () => {
  it('names a КР by its title, with publisher, year and locator on one quiet line', () => {
    const row = helpSourceRow({
      title:
        'Клинические рекомендации «Психические и поведенческие расстройства, вызванные употреблением алкоголя. Синдром отмены алкоголя (алкогольное абстинентное состояние)» (Минздрав России, 2024, ID 784), приложение Г1, разделы 3.1, 6.1 и 6.2',
      publisher: 'Министерство здравоохранения Российской Федерации',
      year: '2024',
      url: 'https://sudact.ru/law/klinicheskie-rekomendatsii-psikhicheskie/prilozhenie-g1/',
      document: { moduleId: 'minimed.clinical.recommendation.784_1', documentId: 'kr.rf.784_1' },
    });
    expect(row).toEqual({
      kind: 'КР',
      name: 'Психические и поведенческие расстройства, вызванные употреблением алкоголя. Синдром отмены алкоголя (алкогольное абстинентное состояние)',
      meta: 'Минздрав России · 2024 · приложение Г1, разделы 3.1, 6.1 и 6.2',
      site: undefined,
    });
  });

  it('reads the colon form of a КР title and drops its registry id', () => {
    const row = helpSourceRow({
      title:
        'Клинические рекомендации: Острый тонзиллит и фарингит (острый тонзиллофарингит) (КР 306_3)',
    });
    expect(row.kind).toBe('КР');
    expect(row.name).toBe('Острый тонзиллит и фарингит (острый тонзиллофарингит)');
  });

  it('shortens Vancouver authors to the first one and names the site, not the address', () => {
    const row = helpSourceRow({
      title:
        'Sullivan JT, Sykora K, Schneiderman J, Naranjo CA, Sellers EM. Assessment of alcohol withdrawal: the revised Clinical Institute Withdrawal Assessment for Alcohol scale (CIWA-Ar)',
      publisher: 'British Journal of Addiction',
      year: '1989',
      url: 'https://pubmed.ncbi.nlm.nih.gov/2597811/',
    });
    expect(row).toEqual({
      kind: undefined,
      name: 'Assessment of alcohol withdrawal: the revised Clinical Institute Withdrawal Assessment for Alcohol scale (CIWA-Ar)',
      meta: 'Sullivan JT и соавт. · British Journal of Addiction · 1989',
      site: 'PubMed',
    });
  });

  it('keeps a plain title and finds its year in it', () => {
    const row = helpSourceRow({ title: 'Почивалов и др. Детские болезни, 2014, с. 26' });
    expect(row.name).toBe('Почивалов и др. Детские болезни, 2014, с. 26');
    expect(row.meta).toBe('2014');
  });
});

describe('sourceSiteName', () => {
  it('names known sites and falls back to the bare host', () => {
    expect(sourceSiteName('https://www.ahajournals.org/doi/10.1161/x')).toBe('AHA Journals');
    expect(sourceSiteName('https://example.org/a/b')).toBe('example.org');
    expect(sourceSiteName('not a url')).toBeUndefined();
  });
});
