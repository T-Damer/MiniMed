import { describe, expect, it } from 'vitest';
import { senseCaseVerdict } from './sense-ranking-cases';

describe('senseCaseVerdict', () => {
  const depression = {
    definitionIncludes: 'психическое расстройство',
    definitionExcludes: 'перелома',
  };

  it('accepts the mood disorder and rejects the fracture pattern for «Депрессия»', () => {
    expect(
      senseCaseVerdict(depression, 'Депрессия – психическое расстройство со снижением настроения.'),
    ).toBe(true);
    expect(senseCaseVerdict(depression, 'Депрессия – процесс формирования перелома кости.')).toBe(
      false,
    );
  });

  it('needs the wanted words', () => {
    expect(senseCaseVerdict(depression, 'Депрессия – что-то иное.')).toBe(false);
  });
});
