import { describe, expect, it } from 'vitest';

import { formatPackagingImageFetchDate, packagingImageSourceView } from './packaging-image-source';

describe('packagingImageSourceView', () => {
  it('names the site, links the source file and gives the fetch date', () => {
    expect(
      packagingImageSourceView({
        sourceUrl: 'https://allmed.pro/img/preparations/1.jpeg',
        fetchedAt: '2026-10-13',
      }),
    ).toEqual({
      siteName: 'Allmed',
      url: 'https://allmed.pro/img/preparations/1.jpeg',
      urlLabel: 'allmed.pro/img/preparations/1.jpeg',
      fetched: '13 октября 2026 г.',
    });
  });

  it('drops a link that is not https and a missing or malformed date', () => {
    const view = packagingImageSourceView({
      sourceUrl: 'javascript:alert(1)',
      fetchedAt: null,
    });
    expect(view.url).toBeNull();
    expect(view.urlLabel).toBeNull();
    expect(view.fetched).toBeNull();
    expect(
      packagingImageSourceView({ sourceUrl: 'not a url', fetchedAt: '13.10.2026' }).fetched,
    ).toBeNull();
    expect(formatPackagingImageFetchDate('2026-13-45')).toBeNull();
  });
});
