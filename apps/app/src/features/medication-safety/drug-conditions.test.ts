import { describe, expect, it } from 'vitest';

import { type ConditionId, type ConditionSectionInput, drugConditions } from './drug-conditions';

function section(type: string | null, title: string, text: string): ConditionSectionInput {
  return { type, title, chunks: [{ text, anchor: `${type ?? 'other'}-1` }] };
}

function levels(sections: readonly ConditionSectionInput[]): Record<ConditionId, string> {
  return Object.fromEntries(
    drugConditions(sections).map((finding) => [finding.id, finding.level]),
  ) as Record<ConditionId, string>;
}

describe('drugConditions', () => {
  it('reads glimepiride-like contraindications', () => {
    const result = levels([
      section(
        'contraindications',
        'Противопоказания',
        'Сахарный диабет 1 типа; тяжелые нарушения функции печени; тяжелые нарушения функции почек (в т.ч. у пациентов, находящихся на гемодиализе); беременность и период грудного вскармливания; детский возраст до 18 лет.',
      ),
      section(
        'special-instructions',
        'Влияние на способность управлять транспортными средствами, механизмами',
        'В начале лечения следует воздержаться от управления транспортными средствами.',
      ),
    ]);
    expect(result.pregnancy).toBe('contraindicated');
    expect(result.lactation).toBe('contraindicated');
    expect(result.children).toBe('contraindicated');
    expect(result.liver).toBe('caution');
    expect(result.kidney).toBe('caution');
    expect(result.driving).toBe('caution');
    expect(result.elderly).toBe('unknown');
  });

  it('keeps a young-age limit partial and finds a dose for children', () => {
    const findings = drugConditions([
      section('contraindications', 'Противопоказания', 'Детский возраст до 3 лет.'),
      section(
        'dosage',
        'Способ применения и дозы',
        'Детям старше 3 лет — по 5 мг 2 раза в сутки. Пожилым пациентам коррекции дозы не требуется.',
      ),
    ]);
    const children = findings.find((finding) => finding.id === 'children');
    expect(children?.level).toBe('caution');
    expect(children?.summary).toBe('Противопоказано в части случаев');
    expect(findings.find((finding) => finding.id === 'elderly')?.level).toBe('allowed');
  });

  it('applies a bare pregnancy-section sentence to the topics of its heading', () => {
    const result = levels([
      section(
        'pregnancy',
        'Применение при беременности и в период грудного вскармливания',
        'Противопоказано.',
      ),
    ]);
    expect(result.pregnancy).toBe('contraindicated');
    expect(result.lactation).toBe('contraindicated');
  });

  it('reads «не противопоказан» and «не влияет» as allowed', () => {
    const result = levels([
      section(
        'special-instructions',
        'Влияние на способность управлять транспортными средствами',
        'Препарат не влияет на способность управлять транспортными средствами и механизмами.',
      ),
      section(
        'dosage',
        'Способ применения и дозы',
        'У пациентов с почечной недостаточностью коррекции дозы не требуется.',
      ),
    ]);
    expect(result.driving).toBe('allowed');
    expect(result.kidney).toBe('allowed');
  });

  it('ignores adverse effects and does not take «детородного» for children', () => {
    const result = levels([
      section('adverse-effects', 'Побочное действие', 'Гепатит, нарушение функции почек.'),
      section(
        'special-instructions',
        'Особые указания',
        'Женщинам детородного возраста следует применять надежные методы контрацепции.',
      ),
    ]);
    expect(result.liver).toBe('unknown');
    expect(result.kidney).toBe('unknown');
    expect(result.children).toBe('unknown');
  });
});
