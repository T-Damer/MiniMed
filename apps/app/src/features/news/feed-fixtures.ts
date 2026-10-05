/** Feed texts for the unit tests: one per format, shaped like the real feeds measured in ADR-0024. */

export const RSS2_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Тестовая лента &amp; новости</title>
    <link>https://example.org/</link>
    <language>ru</language>
    <item>
      <title><![CDATA[Первая запись: &quot;ВОЗ&quot;]]></title>
      <link>https://example.org/news/1</link>
      <guid isPermaLink="false">news_1</guid>
      <pubDate>Mon, 05 Oct 2026 10:30:00 +0300</pubDate>
      <dc:creator>Иван Петров</dc:creator>
      <description>&lt;p&gt;Краткое &lt;b&gt;описание&lt;/b&gt; записи.&lt;/p&gt;</description>
      <content:encoded><![CDATA[<p>Полный текст <a href="/news/1/full">статьи</a>.</p><img src="https://example.org/pic.jpg" alt="Фото"><script>alert(1)</script>]]></content:encoded>
      <media:thumbnail url="https://example.org/thumb.jpg"/>
    </item>
    <item>
      <title>Вторая запись</title>
      <link>https://example.org/news/2</link>
      <guid>https://example.org/news/2</guid>
      <pubDate>Sun, 04 Oct 2026 08:00:00 GMT</pubDate>
      <description>Только текст без разметки.</description>
    </item>
    <item>
      <title>Вторая запись</title>
      <link>https://example.org/news/2</link>
      <guid>https://example.org/news/2</guid>
      <description>Дубликат.</description>
    </item>
  </channel>
</rss>`;

export const RSS1_RDF_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel rdf:about="https://journal.example/toc">
    <title>Journal of Tests: Table of Contents</title>
    <link>https://journal.example/toc</link>
  </channel>
  <item rdf:about="https://journal.example/doi/10.1000/abc">
    <title>Drug X in Advanced Disease</title>
    <link>https://journal.example/doi/10.1000/abc</link>
    <dc:date>2026-10-03T12:00:00Z</dc:date>
    <dc:creator>A. Author</dc:creator>
    <description>Background: a trial.</description>
  </item>
</rdf:RDF>`;

export const ATOM_FEED = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">
  <title>PLOS Test</title>
  <link rel="self" href="https://atom.example/feed"/>
  <link rel="alternate" href="https://atom.example/"/>
  <entry>
    <title type="html">Mortality &amp;lt;among&amp;gt; children</title>
    <id>tag:atom.example,2026:1</id>
    <link rel="alternate" href="https://atom.example/articles/1"/>
    <link rel="enclosure" href="https://atom.example/articles/1.pdf"/>
    <published>2026-09-30T09:00:00Z</published>
    <updated>2026-10-01T09:00:00Z</updated>
    <author><name>Dr. Atom</name></author>
    <summary type="html">&lt;p&gt;Summary &lt;em&gt;text&lt;/em&gt;.&lt;/p&gt;</summary>
  </entry>
  <entry>
    <title>No link entry</title>
    <id>tag:atom.example,2026:2</id>
    <updated>2026-10-02T09:00:00Z</updated>
    <content type="text">Plain &lt;content&gt;</content>
  </entry>
</feed>`;

export const JSON_FEED = JSON.stringify({
  version: 'https://jsonfeed.org/version/1.1',
  title: 'JSON Test Feed',
  home_page_url: 'https://json.example/',
  language: 'en',
  items: [
    {
      id: 'a1',
      url: 'https://json.example/a1',
      title: 'JSON item',
      content_html: '<p>Hello <i>world</i></p>',
      date_published: '2026-10-04T10:00:00Z',
      authors: [{ name: 'J. Son' }],
      image: 'https://json.example/a1.png',
    },
    {
      id: 'a2',
      title: 'Text only',
      content_text: 'a < b & c',
      date_published: '2026-10-03T10:00:00Z',
    },
    'not an object',
  ],
});

export const HTML_PAGE = `<!DOCTYPE html><html><head><title>Журнал &amp; сайт</title>
<link rel="alternate" type="application/rss+xml" title="Все новости" href="/rss.xml">
<link rel="alternate" type="application/atom+xml" href="https://news.example/atom">
<link rel="stylesheet" href="/style.css">
<link rel="alternate" type="text/html" href="/ru">
</head><body><h1>Hello</h1></body></html>`;
