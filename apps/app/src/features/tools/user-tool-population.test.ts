import { describe, expect, it } from 'vitest';

import {
  parseUserToolPopulation,
  USER_TOOL_POPULATION_MISSING,
  userToolPopulationError,
  userToolPopulationToAgeScope,
} from '@/features/tools/user-tool-population';

describe('user tool population', () => {
  it('turns the author answer into an age scope', () => {
    expect(userToolPopulationToAgeScope({ group: 'adults' }).groups).toEqual(['adults']);
    expect(userToolPopulationToAgeScope({ group: 'any' }).groups).toEqual([
      'neonates',
      'children',
      'adults',
    ]);
    const children = userToolPopulationToAgeScope({
      group: 'children',
      neonates: true,
      maxAge: { value: 5, unit: 'years' },
    });
    expect(children.groups).toEqual(['neonates', 'children']);
    expect(children.maxAge).toEqual({ value: 5, unit: 'years' });
    expect(children.basis).toBe('Указано автором инструмента.');
  });

  it('asks for a choice when none was made', () => {
    expect(userToolPopulationError(undefined)).toBe(USER_TOOL_POPULATION_MISSING);
  });

  it('explains wrong limits in plain Russian', () => {
    expect(
      userToolPopulationError({
        group: 'children',
        minAge: { value: 10, unit: 'years' },
        maxAge: { value: 5, unit: 'years' },
      }),
    ).toBe('Нижняя граница возраста больше верхней: поменяйте их местами.');
    expect(userToolPopulationError({ group: 'adults', minAge: { value: 10, unit: 'years' } })).toBe(
      'Для взрослых нижняя граница возраста — не меньше 18 лет.',
    );
    expect(
      userToolPopulationError({ group: 'children', maxAge: { value: 30, unit: 'years' } }),
    ).toBe('Для детей верхняя граница возраста — не больше 19 лет.');
    expect(
      userToolPopulationError({ group: 'adults', minAge: { value: 20, unit: 'years' } }),
    ).toBeNull();
  });

  it('validates a population read from a file', () => {
    expect(
      parseUserToolPopulation({ group: 'adults', minAge: { value: 21, unit: 'years' } }),
    ).toEqual({
      group: 'adults',
      minAge: { value: 21, unit: 'years' },
    });
    expect(() => parseUserToolPopulation({ group: 'teens' })).toThrow('выберите детей, взрослых');
    expect(() => parseUserToolPopulation('adults')).toThrow('Возраст пациентов указан неверно');
    expect(() =>
      parseUserToolPopulation({ group: 'children', minAge: { value: -1, unit: 'years' } }),
    ).toThrow('нижняя граница указана неверно');
  });
});
