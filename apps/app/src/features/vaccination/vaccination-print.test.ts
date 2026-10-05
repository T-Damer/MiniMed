import { describe, expect, it } from 'vitest';

import { getVaccinationCalendar } from '@/features/vaccination/vaccination-calendar';
import {
  displayIsoDate,
  escapeHtml,
  renderVaccinationPrintHtml,
} from '@/features/vaccination/vaccination-print';

describe('vaccination print', () => {
  const calendar = getVaccinationCalendar();
  const html = renderVaccinationPrintHtml(calendar, '2026-10-05');

  it('is an A4 landscape page with the edition line and the source', () => {
    expect(html).toContain('@page { size: A4 landscape;');
    expect(html).toContain('по приказу № 1122н в ред. приказа № 677н');
    expect(html).toContain('http://publication.pravo.gov.ru/document/0001202112200070');
    expect(html).toContain('http://publication.pravo.gov.ru/document/0001202401300021');
    expect(html).toContain('Распечатано из MiniMed 05.10.2026');
  });

  it('prints every row of the three appendices with its wording', () => {
    for (const row of calendar.national.rows) {
      expect(html).toContain(escapeHtml(row.category));
      for (const item of row.items) expect(html).toContain(escapeHtml(item.text));
    }
    for (const row of calendar.epidemic.rows) {
      expect(html).toContain(escapeHtml(row.vaccine));
      for (const block of row.categories) expect(html).toContain(escapeHtml(block.text));
    }
    for (const item of calendar.procedure.items) {
      for (const block of item.blocks) expect(html).toContain(escapeHtml(block));
      if (item.footnote) expect(html).toContain(escapeHtml(item.footnote.text));
    }
  });

  it('prints the three columns of each table as the order names them and repeats the head', () => {
    for (const column of [...calendar.national.columns, ...calendar.epidemic.columns]) {
      expect(html).toContain(escapeHtml(column));
    }
    expect(html).toContain('display: table-header-group');
  });

  it('labels the summary grid as compiled, not as the text of the order', () => {
    expect(html).toContain('не является текстом приказа');
  });

  it('escapes markup and formats dates', () => {
    expect(escapeHtml('<a href="x">&\'')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#039;');
    expect(displayIsoDate('2026-10-05')).toBe('05.10.2026');
    expect(displayIsoDate('not a date')).toBe('not a date');
    expect(html).not.toContain('<script');
  });
});
