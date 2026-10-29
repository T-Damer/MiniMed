import { describe, expect, it } from 'vitest';
import { SKIN_CLASSES } from '@/features/skin/skin-model';
import {
  MAX_SKIN_RESULTS,
  skinComparingLine,
  skinResultViews,
  skinStatusLines,
  visiblePredictions,
} from '@/features/skin/skin-results';

const [first, second, third, fourth] = SKIN_CLASSES;
if (!first || !second || !third || !fourth) throw new Error('The class list is too short.');

describe('which conditions are shown', () => {
  it('always shows the first and adds up to two real contenders', () => {
    const predictions = [
      { classId: first.id, probability: 0.5 },
      { classId: second.id, probability: 0.25 },
      { classId: third.id, probability: 0.15 },
      { classId: fourth.id, probability: 0.1 },
    ];
    expect(visiblePredictions(predictions)).toHaveLength(MAX_SKIN_RESULTS);
    expect(visiblePredictions(predictions).map((entry) => entry.classId)).toEqual([
      first.id,
      second.id,
      third.id,
    ]);
  });

  it('leaves out the long tail below the threshold', () => {
    const views = skinResultViews([
      { classId: first.id, probability: 0.9 },
      { classId: second.id, probability: 0.05 },
    ]);
    expect(views).toHaveLength(1);
    expect(views[0]?.percent).toBe(90);
  });

  it('shows a lone weak result and never a percentage below 1', () => {
    const [view] = skinResultViews([{ classId: first.id, probability: 0.001 }]);
    expect(view?.percent).toBe(1);
  });

  it('skips a class the app no longer knows', () => {
    expect(skinResultViews([{ classId: 'unknown', probability: 0.9 }])).toEqual([]);
  });

  it('carries the Russian name, codes and malignancy of the class', () => {
    const malignant = SKIN_CLASSES.find((entry) => entry.malignant);
    if (!malignant) throw new Error('No malignant class declared.');
    const [view] = skinResultViews([{ classId: malignant.id, probability: 0.6 }]);
    expect(view).toMatchObject({
      name: malignant.ru,
      icd10: malignant.icd10,
      malignant: true,
    });
  });
});

describe('status lines', () => {
  it('states each fact plainly and nothing otherwise', () => {
    expect(skinStatusLines({ uncertain: false, malignantFlag: false })).toEqual([]);
    expect(
      skinStatusLines({ uncertain: true, malignantFlag: true }).map((line) => line.kind),
    ).toEqual(['malignant', 'uncertain']);
  });

  it('declines the comparison line by the count', () => {
    expect(skinComparingLine(21)).toBe('Сравниваю с 21 состоянием…');
    expect(skinComparingLine(22)).toBe('Сравниваю с 22 состояниями…');
    expect(skinComparingLine(11)).toBe('Сравниваю с 11 состояниями…');
  });
});
