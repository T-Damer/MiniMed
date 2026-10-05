import { describe, expect, it } from 'vitest';

import {
  firstImageOf,
  hasSafeContent,
  plainTextFromHtml,
  type SafeNode,
  safeImageUrl,
  safeLinkUrl,
  sanitizeFeedHtml,
  snippetFrom,
  withoutImages,
} from '@/features/news/feed-content';

const json = (nodes: readonly SafeNode[]): string => JSON.stringify(nodes);

describe('sanitizeFeedHtml', () => {
  it('keeps the allow-listed formatting', () => {
    const nodes = sanitizeFeedHtml(
      '<p>One <strong>two</strong> <em>three</em></p><ul><li>a</li></ul>',
    );
    expect(nodes).toEqual([
      {
        tag: 'p',
        children: [
          'One ',
          { tag: 'strong', children: ['two'] },
          ' ',
          { tag: 'em', children: ['three'] },
        ],
      },
      { tag: 'ul', children: [{ tag: 'li', children: ['a'] }] },
    ]);
  });

  it('removes scripts, styles, frames, forms and their content', () => {
    const html =
      '<p>ok</p><script>alert(1)</script><style>p{x:y}</style><iframe src="https://evil.example"></iframe>' +
      '<object data="x"></object><form action="/p"><input name="a"><button>Send</button></form><svg onload="x()"><a/></svg>';
    const out = json(sanitizeFeedHtml(html));
    expect(out).toContain('ok');
    for (const banned of [
      'alert',
      'p{x:y}',
      'evil',
      'iframe',
      'object',
      'form',
      'Send',
      'svg',
      'onload',
    ]) {
      expect(out).not.toContain(banned);
    }
  });

  it('drops every attribute except a checked href, and event handlers never survive', () => {
    const nodes = sanitizeFeedHtml(
      '<p onclick="x()" style="color:red" class="a" id="b">hi <a href="https://ok.example/p" onclick="x()" target="_self" rel="x">link</a></p>',
    );
    expect(nodes).toEqual([
      {
        tag: 'p',
        children: ['hi ', { tag: 'a', href: 'https://ok.example/p', children: ['link'] }],
      },
    ]);
  });

  it('unwraps links with unsafe schemes and keeps their text', () => {
    for (const href of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<b>x</b>',
      'vbscript:x',
      'file:///etc/passwd',
    ]) {
      const nodes = sanitizeFeedHtml(`<a href="${href}">text</a>`);
      expect(nodes).toEqual(['text']);
    }
  });

  it('resolves relative links against the base address and allows mailto', () => {
    const nodes = sanitizeFeedHtml('<a href="/x">a</a><a href="mailto:a@b.example">m</a>', {
      baseUrl: 'https://site.example/news/1',
    });
    expect(json(nodes)).toContain('https://site.example/x');
    expect(json(nodes)).toContain('mailto:a@b.example');
  });

  it('keeps https images only, with alt text', () => {
    const nodes = sanitizeFeedHtml(
      '<img src="https://i.example/a.png" alt="A" onerror="x()"><img src="http://i.example/b.png"><img src="javascript:x"><img src="data:image/png;base64,AAAA">',
    );
    expect(nodes).toEqual([{ tag: 'img', src: 'https://i.example/a.png', alt: 'A' }]);
  });

  it('decodes entities once and does not turn escaped markup into elements', () => {
    expect(sanitizeFeedHtml('&lt;script&gt;alert(1)&lt;/script&gt;')).toEqual([
      '<script>alert(1)</script>',
    ]);
  });

  it('maps headings, flattens tables and drops unknown tags but keeps their text', () => {
    const out = sanitizeFeedHtml(
      '<h2>T</h2><table><tr><td>a</td><td>b</td></tr></table><custom-tag>kept</custom-tag>',
    );
    expect(json(out)).toContain('"tag":"h4"');
    expect(json(out)).toContain('kept');
    expect(json(out)).not.toContain('table');
  });

  it('bounds depth, node count and text length', () => {
    const deep = `${'<div>'.repeat(40)}deep${'</div>'.repeat(40)}`;
    expect(json(sanitizeFeedHtml(deep))).not.toContain('deep');
    const long = sanitizeFeedHtml(`<p>${'word '.repeat(10_000)}</p>`);
    const text = JSON.stringify(long);
    expect(text.length).toBeLessThan(20_000);
    const many = sanitizeFeedHtml('<b>x</b>'.repeat(5000));
    expect(many.length).toBeLessThan(2000);
  });

  it('handles malformed markup without throwing', () => {
    expect(() => sanitizeFeedHtml('<p><b>unclosed <a href="https://x.example"')).not.toThrow();
    expect(() => sanitizeFeedHtml('</p></div><<>><a href=>')).not.toThrow();
  });
});

describe('plain text helpers', () => {
  it('extracts visible text with block spacing and decoded entities', () => {
    expect(plainTextFromHtml('<p>One</p><p>Two &amp; three</p><script>x()</script>')).toBe(
      'One Two & three',
    );
    expect(plainTextFromHtml('already plain')).toBe('already plain');
  });

  it('cuts snippets at a word boundary', () => {
    expect(snippetFrom('short', 20)).toBe('short');
    expect(snippetFrom('alpha beta gamma delta epsilon', 18)).toBe('alpha beta gamma…');
  });
});

describe('tree helpers and url checks', () => {
  it('finds the first image, strips images and reports content', () => {
    const tree = sanitizeFeedHtml('<p>a<img src="https://i.example/1.png"></p><p>b</p>');
    expect(firstImageOf(tree)).toBe('https://i.example/1.png');
    expect(firstImageOf(withoutImages(tree))).toBeUndefined();
    expect(hasSafeContent(tree)).toBe(true);
    expect(hasSafeContent([{ tag: 'p', children: [' '] }])).toBe(false);
  });

  it('validates links and images', () => {
    expect(safeLinkUrl('https://a.example/x')).toBe('https://a.example/x');
    expect(safeLinkUrl('//a.example/x', 'https://b.example/')).toBe('https://a.example/x');
    expect(safeLinkUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeLinkUrl('x'.repeat(3000))).toBeUndefined();
    expect(safeImageUrl('http://a.example/x.png')).toBeUndefined();
    expect(safeImageUrl('/x.png', 'https://a.example/')).toBe('https://a.example/x.png');
  });
});
