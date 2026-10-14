import { describe, expect, it } from 'vitest';

import { externalUrlLabel } from '@/components/external-url-label';

describe('externalUrlLabel', () => {
  it('shows only the site of a long address', () => {
    expect(
      externalUrlLabel('https://publication.pravo.gov.ru/Document/View/0001202112200070'),
    ).toBe('publication.pravo.gov.ru');
    expect(externalUrlLabel('https://www.example.org/a/very/long/path/to/some/document.pdf')).toBe(
      'example.org',
    );
  });

  it('keeps a short address as written', () => {
    expect(externalUrlLabel('https://doi.org/10.1/abc')).toBe('https://doi.org/10.1/abc');
  });
});
