import { describe, expect, it } from 'vitest';
import { parseNumberedHeading } from '@/features/library/numbered-headings';
import cases from '@/features/library/numbered-headings.cases.json';

describe('parseNumberedHeading (shared cases)', () => {
  it.each(cases.accept)('reads %j as a heading', ({ line, depth }) => {
    expect(parseNumberedHeading(line)?.depth).toBe(depth);
  });

  it.each(cases.reject.map((item) => [item.label, item.line] as const))(
    'does not read %s as a heading',
    (_label, line) => {
      expect(parseNumberedHeading(line)).toBeNull();
    },
  );
});

describe('parseNumberedHeading', () => {
  it('keeps the number and a title without the trailing full stop', () => {
    const heading = parseNumberedHeading('3.1.6 Лечение десмоидных опухолей.');
    expect(heading?.number).toBe('3.1.6');
    expect(heading?.title).toBe('Лечение десмоидных опухолей');
    expect(parseNumberedHeading('3.2.1. Выбор стратегии лечения')?.number).toBe('3.2.1');
    expect(parseNumberedHeading('2.2 Неспецифические осложнения:')?.title).toBe(
      'Неспецифические осложнения:',
    );
  });

  it('rejects very long lines', () => {
    expect(parseNumberedHeading(`3.1 ${'Очень длинный заголовок '.repeat(12)}`)).toBeNull();
  });
});
