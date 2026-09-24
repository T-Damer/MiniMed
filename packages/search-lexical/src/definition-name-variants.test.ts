import { describe, expect, it } from 'vitest';
import { definitionNameTranspositions as variants } from './definition-name-variants';

describe('bounded dictionary spelling candidates', () => {
  it.each([
    ['ксреостомия', 'ксеростомия'],
    ['электромиогарфия', 'электромиография'],
    ['гипергдироз', 'гипергидроз'],
    ['xerostoima', 'xerostomia'],
  ])('finds a single adjacent swap in %s', (query, expected) => {
    expect(variants(query)).toContain(expected);
    expect(variants(query)).not.toContain(query);
  });
  it.each(['АД', '12345678', 'a12345', 'аbcdef', 'болит голова', 'а'.repeat(49), 'боль'])(
    'does not fuzz codes, short words, mixed scripts or phrases: %s',
    (query) => expect(variants(query)).toEqual([]),
  );
  it('bounds every spelling branch at 47 equality keys', () => {
    const result = variants('аб'.repeat(24));
    expect(result.length).toBeLessThanOrEqual(47);
    expect(new Set(result).size).toBe(result.length);
    expect(result.every((value) => value.length === 48)).toBe(true);
  });
  it('does not repeat unchanged identical-letter words', () => {
    expect(variants('а'.repeat(20))).toEqual([]);
  });
});
