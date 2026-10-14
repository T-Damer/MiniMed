import { describe, expect, it } from 'vitest';

import {
  drugLabelOfTitle,
  joinProductAndSubstance,
  sameDrugName,
} from '@/features/medications/drug-label';

describe('drug labels made of a product and a substance', () => {
  it('writes a product that is the substance once', () => {
    expect(joinProductAndSubstance('Ацетилсалициловая кислота', 'АЦЕТИЛСАЛИЦИЛОВАЯ КИСЛОТА')).toBe(
      'АЦЕТИЛСАЛИЦИЛОВАЯ КИСЛОТА',
    );
    expect(joinProductAndSubstance('Нурофен', 'Ибупрофен')).toBe('Нурофен · Ибупрофен');
    expect(joinProductAndSubstance(null, 'Ибупрофен')).toBe('Ибупрофен');
  });

  it('compares names without case, ё and spacing', () => {
    expect(sameDrugName('Тёмный  мёд', 'тёмный мед')).toBe(true);
    expect(sameDrugName('Мёд', 'Мята')).toBe(false);
  });

  it('turns a search title into one name', () => {
    expect(drugLabelOfTitle('Ацетилсалициловая кислота · АЦЕТИЛСАЛИЦИЛОВАЯ КИСЛОТА')).toBe(
      'Ацетилсалициловая кислота',
    );
    expect(drugLabelOfTitle('АЦЕТИЛСАЛИЦИЛОВАЯ КИСЛОТА: инструкция')).toBe(
      'Ацетилсалициловая кислота',
    );
    expect(drugLabelOfTitle('Нурофен · ИБУПРОФЕН')).toBe('Нурофен · Ибупрофен');
  });
});
