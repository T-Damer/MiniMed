import { describe, expect, it } from 'vitest';

import { patientMetricLabel, patientSexLabel } from './patient-labels';

describe('patient labels', () => {
  it('names every stored sex in Russian', () => {
    expect(patientSexLabel('male')).toBe('Мужской');
    expect(patientSexLabel('female')).toBe('Женский');
    expect(patientSexLabel('intersex')).toBe('Интерсекс');
    expect(patientSexLabel('unknown')).toBe('Неизвестно');
    expect(patientSexLabel(undefined)).toBeUndefined();
  });

  it('shows registry metrics by name and keeps a custom id as typed', () => {
    expect(patientMetricLabel('body-mass')).toBe('Масса тела');
    expect(patientMetricLabel('blood-pressure')).toBe('Артериальное давление');
    expect(patientMetricLabel('my-score')).toBe('my-score');
  });
});
