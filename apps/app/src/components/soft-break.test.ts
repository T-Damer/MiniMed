import { describe, expect, it } from 'vitest';

import { softBreakParts } from './soft-break';

describe('soft break parts', () => {
  it('splits a combined drug name after each joint, keeping every character', () => {
    const name = 'ПАРАЦЕТАМОЛ+ФЕНИЛЭФРИН+ФЕНИРАМИН';
    expect(softBreakParts(name)).toEqual(['ПАРАЦЕТАМОЛ+', 'ФЕНИЛЭФРИН+', 'ФЕНИРАМИН']);
    expect(softBreakParts(name).join('')).toBe(name);
    expect(softBreakParts('Рифампицин/изониазид')).toEqual(['Рифампицин/', 'изониазид']);
    expect(softBreakParts('Ко-тримоксазол')).toEqual(['Ко-', 'тримоксазол']);
  });

  it('leaves a name without a joint, and a joint with nothing after it, whole', () => {
    expect(softBreakParts('Парацетамол')).toEqual(['Парацетамол']);
    expect(softBreakParts('Витамин C+ ')).toEqual(['Витамин C+ ']);
    expect(softBreakParts('')).toEqual(['']);
  });
});
