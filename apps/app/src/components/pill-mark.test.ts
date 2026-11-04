import { describe, expect, it } from 'vitest';

import { drugShape, pillLetter } from '@/components/pill-mark';

describe('pill mark', () => {
  it('prints the first letter or digit of the name, in capitals', () => {
    expect(pillLetter('сертралин')).toBe('С');
    expect(pillLetter('«Эсциталопрам»')).toBe('Э');
    expect(pillLetter('5-НТР')).toBe('5');
    expect(pillLetter('')).toBe('•');
  });
});

describe('drug shape', () => {
  it('reads the form the plan writes', () => {
    expect(drugShape('таблетки, покрытые плёночной оболочкой')).toBe('tablet');
    expect(drugShape('капсулы')).toBe('capsule');
    expect(drugShape('раствор для приёма внутрь')).toBe('liquid');
    expect(drugShape('капли')).toBe('liquid');
    expect(drugShape('раствор для внутримышечного введения')).toBe('ampoule');
    expect(drugShape('мазь')).toBe('tube');
    expect(drugShape(undefined)).toBe('tablet');
  });
});
