import { describe, expect, it } from 'vitest';

async function loadParser() {
  if (typeof document === 'undefined') {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { createElement: () => ({ innerHTML: '', textContent: '' }) },
    });
  }
  return import('@/features/library/markdown-parser');
}

describe('markdown parser', () => {
  it('parses GFM, math, marks, tables, and stable heading anchors', async () => {
    const { parseMarkdownDocument } = await loadParser();
    const document = parseMarkdownDocument(
      '# Заголовок\n\n# Заголовок\n\n==важно== $x$\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n- [x] готово',
    );
    expect(document.outline).toEqual([
      { anchor: 'md-заголовок', label: 'Заголовок', depth: 1 },
      { anchor: 'md-заголовок-2', label: 'Заголовок', depth: 1 },
    ]);
    expect(JSON.stringify(document.tree)).toContain('"type":"table"');
    expect(JSON.stringify(document.tree)).toContain('"type":"inlineMath"');
    expect(JSON.stringify(document.tree)).toContain('"type":"mark"');
    expect(JSON.stringify(document.tree)).toContain('"type":"listItem"');
  });

  it('falls back to synchronous parsing when workers are unavailable', async () => {
    const markdown = '# Проверка';
    const { MARKDOWN_WORKER_THRESHOLD, parseMarkdownDocumentAsync } = await loadParser();
    const parsed = await parseMarkdownDocumentAsync(markdown);
    expect(parsed.outline[0]?.label).toBe('Проверка');
    expect(MARKDOWN_WORKER_THRESHOLD).toBeGreaterThan(0);
  });
});
