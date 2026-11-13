import { describe, expect, it } from 'vitest';

import { markdownOpensWithTitle } from '@/features/notes/note-title-heading';

describe('markdownOpensWithTitle', () => {
  it('matches a first-level heading equal to the title', () => {
    expect(markdownOpensWithTitle('# Осмотр на дому\n\n## Данные визита', 'Осмотр на дому')).toBe(
      true,
    );
  });

  it('skips leading blank lines and ignores case, emphasis and closing hashes', () => {
    expect(markdownOpensWithTitle('\n\n#  **Осмотр  на дому** #\n', 'осмотр на дому')).toBe(true);
  });

  it('does not match a different first heading, a second-level heading or body text', () => {
    expect(markdownOpensWithTitle('# Выписка\n', 'Осмотр на дому')).toBe(false);
    expect(markdownOpensWithTitle('## Осмотр на дому\n', 'Осмотр на дому')).toBe(false);
    expect(markdownOpensWithTitle('Осмотр на дому\n# Осмотр на дому', 'Осмотр на дому')).toBe(
      false,
    );
  });

  it('never matches an empty title or text', () => {
    expect(markdownOpensWithTitle('# \n', '')).toBe(false);
    expect(markdownOpensWithTitle('', 'Осмотр')).toBe(false);
  });
});
