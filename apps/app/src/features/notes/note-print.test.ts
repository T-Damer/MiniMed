import { describe, expect, it } from 'vitest';

import { buildNotePrintHtml } from '@/features/notes/note-print';

describe('note print layout', () => {
  it('prints the optional record title, date, and requested typography', () => {
    const html = buildNotePrintHtml('Осмотр <ребёнка>', '27 августа 2026, 12:30', '<p>Текст</p>');

    expect(html).toContain('<h1 class="note-print__title">Осмотр &lt;ребёнка&gt;</h1>');
    expect(html).toContain('27 августа 2026, 12:30');
    expect(html).toContain('font-size: 14px');
    expect(html).toContain('font-family: var(--note-print-body-font)');
    expect(html).toContain('font-family: var(--note-print-title-font)');
    expect(html).toContain('<p>Текст</p>');
  });

  it('does not add a printed title when the record is untitled', () => {
    const html = buildNotePrintHtml('', '27 августа 2026, 12:30', '<p>Текст</p>');

    expect(html).not.toContain('class="note-print__title"');
    expect(html).toContain('27 августа 2026, 12:30');
  });

  it('uses A4 with 1 cm margins for a template', () => {
    const html = buildNotePrintHtml('Осмотр на дому', undefined, '<p>Текст</p>', true);

    expect(html).toContain('@page { size: A4; margin: 10mm; }');
  });

  it('keeps rendered KaTeX markup available in the print document', () => {
    const html = buildNotePrintHtml(
      'Формула',
      undefined,
      '<span class="katex"><span class="katex-mathml">x</span></span>',
    );

    expect(html).toContain('.katex');
    expect(html).toContain('<span class="katex">');
  });
});
