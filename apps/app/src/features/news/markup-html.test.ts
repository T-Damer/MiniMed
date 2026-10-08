import { describe, expect, it } from 'vitest';

import { type MarkupElement, parseMarkup } from '@/features/news/markup';

const names = (element: MarkupElement): string[] =>
  element.children.filter((c): c is MarkupElement => c.kind === 'element').map((c) => c.name);

describe('parseMarkup HTML implied end tags', () => {
  it('closes an open <p> when the next paragraph or block starts', () => {
    const root = parseMarkup('<div><p>one<p>two<ul><li>a</li></ul><p>three</div>', 'html');
    const div = root.children[0] as MarkupElement;
    expect(names(div)).toEqual(['p', 'p', 'ul', 'p']);
  });

  it('closes <li>, <dt>/<dd> and table cells and rows without closing tags', () => {
    const list = parseMarkup('<ul><li>a<li>b<li>c</ul>', 'html').children[0] as MarkupElement;
    expect(names(list)).toEqual(['li', 'li', 'li']);
    const table = parseMarkup('<table><tr><td>1<td>2<tr><td>3</table>', 'html')
      .children[0] as MarkupElement;
    expect(names(table)).toEqual(['tr', 'tr']);
    expect(names(table.children[0] as MarkupElement)).toEqual(['td', 'td']);
  });

  it('keeps inline elements inside a paragraph', () => {
    const p = parseMarkup('<p>a <b>bold</b> <a href="/x">link</a> b', 'html')
      .children[0] as MarkupElement;
    expect(names(p)).toEqual(['b', 'a']);
  });

  it('does not touch XML parsing', () => {
    const channel = parseMarkup('<channel><item>a</item><item>b</item></channel>', 'xml')
      .children[0] as MarkupElement;
    expect(names(channel)).toEqual(['item', 'item']);
  });
});
