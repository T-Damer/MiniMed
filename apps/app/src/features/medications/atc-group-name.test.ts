import { describe, expect, it } from 'vitest';
import { atcGroupName, atcGroupNameInline } from './atc-group-name';
import atcNames from './atc-names.json';

describe('the name beside an ATC code', () => {
  it('names a substance code by its level-4 group', () => {
    expect(atcGroupName(atcNames.names, 'N02BE51')).toBe('Анилиды');
    expect(atcGroupName(atcNames.names, 'N02BA71')).toBe(atcNames.names['N02BA']);
  });

  it('names a group code by itself and falls back to the level above', () => {
    expect(atcGroupName(atcNames.names, 'J05AX')).toBe('Другие противовирусные препараты');
    expect(atcGroupName(atcNames.names, 'J05')).toBe(atcNames.names['J05']);
    expect(atcGroupName({ N02: 'Анальгетики' }, 'N02ZZ99')).toBe('Анальгетики');
  });

  it('has no name for a code the dictionary does not know, and not for the anatomical letter', () => {
    expect(atcGroupName({ N: 'Нервная система' }, 'N99ZZ01')).toBeNull();
    expect(atcGroupName(atcNames.names, 'N')).toBeNull();
  });

  it('lowers the first letter of a word and keeps an abbreviation', () => {
    expect(atcGroupNameInline('Анилиды')).toBe('анилиды');
    expect(atcGroupNameInline('Другие анальгетики')).toBe('другие анальгетики');
    expect(atcGroupNameInline('НПВП')).toBe('НПВП');
  });
});
