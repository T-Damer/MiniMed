import { parseFormSchema } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { listFormSchemas } from '@/features/forms/form-registry';
import { ruleCitation } from '@/features/forms/form-view-model';

const base = listFormSchemas()[0];
if (!base) throw new Error('no shipped schema');
const paragraph = base.rules[0];
if (!paragraph) throw new Error('no rule');

describe('rule citation of an order without a filling-rules appendix', () => {
  it('cites a clause of the order itself, not an appendix', () => {
    const { rulesAppendix: _dropped, ...source } = base.source;
    const schema = parseFormSchema({ ...base, source });
    expect(schema.source.rulesAppendix).toBeUndefined();
    expect(ruleCitation(schema, { ...paragraph, id: '1' })).toBe(
      `Приказ № ${base.source.orderNumber}, п. 1; стр. ${paragraph.spans[0]?.pdfPage} официального PDF`,
    );
  });

  it('names a sub-item numbered «1)» by its printed designation', () => {
    const cited = ruleCitation(parseFormSchema(base), {
      ...paragraph,
      id: '6.1',
      clause: '6, подпункт 1',
      appendix: { number: 2, title: 'Порядок выдачи медицинского заключения' },
    });
    expect(cited).toContain('Порядок выдачи медицинского заключения (приложение № 2 к приказу № ');
    expect(cited).toContain('п. 6, подпункт 1;');
  });
});
