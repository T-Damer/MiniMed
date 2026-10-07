import { describe, expect, it } from 'vitest';
import type { Subscription } from '@/features/news/news-types';
import { buildOpml, parseOpml } from '@/features/news/opml';

const base = { images: false, addedAt: 0, unread: 0 };
const subscriptions: Subscription[] = [
  { ...base, id: '1', kind: 'feed', url: 'https://a.example/feed?x=1&y=2', title: 'A & "B" <c>' },
  { ...base, id: '2', kind: 'site', url: 'https://b.example/', title: 'Сайт' },
];

describe('OPML', () => {
  it('leaves saved PubMed searches out of the file', () => {
    const search: Subscription = {
      ...base,
      id: '3',
      kind: 'pubmed',
      url: 'https://pubmed.ncbi.nlm.nih.gov/?term=secret',
      title: 'PubMed: secret',
      query: 'secret',
    };
    const opml = buildOpml([...subscriptions, search]);
    expect(opml).not.toContain('secret');
    expect(parseOpml(opml)).toHaveLength(2);
  });

  it('round-trips subscriptions through export and import', () => {
    const entries = parseOpml(buildOpml(subscriptions));
    expect(entries).toEqual([
      { title: 'A & "B" <c>', url: 'https://a.example/feed?x=1&y=2', kind: 'feed' },
      { title: 'Сайт', url: 'https://b.example/', kind: 'site' },
    ]);
  });

  it('flattens folders, skips invalid addresses and duplicates', () => {
    const opml = `<?xml version="1.0"?><opml version="2.0"><body>
      <outline text="Folder"><outline type="rss" text="One" xmlUrl="https://one.example/rss"/>
      <outline type="rss" text="Dup" xmlUrl="https://one.example/rss"/></outline>
      <outline type="rss" text="Bad" xmlUrl="javascript:alert(1)"/>
      <outline type="rss" text="NoUrl"/>
    </body></opml>`;
    expect(parseOpml(opml)).toEqual([
      { title: 'One', url: 'https://one.example/rss', kind: 'feed' },
    ]);
  });

  it('caps the number of imported entries', () => {
    const outlines = Array.from(
      { length: 150 },
      (_, index) => `<outline type="rss" xmlUrl="https://h${index}.example/rss"/>`,
    ).join('');
    expect(parseOpml(`<opml><body>${outlines}</body></opml>`)).toHaveLength(100);
  });
});
