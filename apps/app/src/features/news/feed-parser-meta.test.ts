import { describe, expect, it } from 'vitest';

import { parseFeed } from '@/features/news/feed-parser';

describe('parseFeed channel description and icon', () => {
  const rss = (image: string): string =>
    `<rss version="2.0"><channel><title>T</title><description>Новости &amp; события</description>${image}<item><title>a</title></item></channel></rss>`;

  it('reads the RSS description and the channel image, https only', () => {
    const feed = parseFeed(
      rss('<image><url>/logo.png</url><title>T</title><link>https://x.test/</link></image>'),
      { baseUrl: 'https://x.test/feed.xml' },
    );
    expect(feed.description).toBe('Новости & события');
    expect(feed.iconUrl).toBe('https://x.test/logo.png');
    expect(parseFeed(rss('<image><url>http://x.test/logo.png</url></image>')).iconUrl).toBe(
      undefined,
    );
  });

  it('reads the Atom subtitle and icon', () => {
    const atom = parseFeed(
      '<feed xmlns="http://www.w3.org/2005/Atom"><title>A</title><subtitle>Подзаголовок</subtitle><icon>https://a.test/i.png</icon><entry><title>e</title></entry></feed>',
    );
    expect(atom.description).toBe('Подзаголовок');
    expect(atom.iconUrl).toBe('https://a.test/i.png');
  });

  it('reads the JSON Feed description and favicon', () => {
    const json = parseFeed(
      JSON.stringify({
        version: 'https://jsonfeed.org/version/1.1',
        title: 'J',
        description: 'Описание',
        favicon: 'https://j.test/f.png',
        items: [{ id: '1', title: 't' }],
      }),
    );
    expect(json.description).toBe('Описание');
    expect(json.iconUrl).toBe('https://j.test/f.png');
  });
});
