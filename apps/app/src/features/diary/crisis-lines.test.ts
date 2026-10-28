import { describe, expect, it } from 'vitest';

import { crisisLineParts } from '@/features/diary/crisis-lines';

describe('crisis lines', () => {
  it('turns the numbers of a help line into call links', () => {
    expect(crisisLineParts('Дежурный психиатр: +7 (495) 123-45-67, круглосуточно')).toEqual([
      { kind: 'text', text: 'Дежурный психиатр: ' },
      { kind: 'phone', text: '+7 (495) 123-45-67', href: 'tel:+74951234567' },
      { kind: 'text', text: ', круглосуточно' },
    ]);
    expect(crisisLineParts('Телефон доверия 8-800-2000-122 или 051')).toEqual([
      { kind: 'text', text: 'Телефон доверия ' },
      { kind: 'phone', text: '8-800-2000-122', href: 'tel:88002000122' },
      { kind: 'text', text: ' или ' },
      { kind: 'phone', text: '051', href: 'tel:051' },
    ]);
  });

  it('leaves text without a number and short digit runs alone', () => {
    expect(crisisLineParts('Приёмное отделение, корпус 2')).toEqual([
      { kind: 'text', text: 'Приёмное отделение, корпус 2' },
    ]);
  });
});
