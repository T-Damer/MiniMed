import { type FormRuleParagraph, parseFormSchema } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { listFormSchemas } from '@/features/forms/form-registry';
import { ruleCitation } from '@/features/forms/form-view-model';

const base = listFormSchemas()[0];
if (!base) throw new Error('no shipped schema');
const schema = parseFormSchema(base);

describe('rule citation', () => {
  it('cites the single rules appendix of a schema as «Порядок заполнения»', () => {
    const paragraph = schema.rules[0];
    if (!paragraph) throw new Error('no rule');
    const text = ruleCitation(schema, paragraph);
    expect(text).toContain('Порядок заполнения (приложение № ');
    expect(text).toContain(`п. ${paragraph.id};`);
  });

  it('names the appendix and the clause printed in it when the paragraph carries them', () => {
    const paragraph: FormRuleParagraph = {
      id: '1.11',
      clause: '11',
      appendix: { number: 1, title: 'Порядок назначения лекарственных препаратов' },
      text: '11. Рецептурный бланк формы № 107-1/у оформляется при назначении.',
      spans: [{ pdfPage: 10, firstLine: 38, lastLine: 40 }],
      textSha256: 'a'.repeat(64),
    };
    const text = ruleCitation(schema, paragraph);
    expect(text).toContain('Порядок назначения лекарственных препаратов (приложение № 1 к приказу № ');
    expect(text).toContain('п. 11; стр. 10 официального PDF');
  });
});
