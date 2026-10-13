import { describe, expect, it } from 'vitest';

import { foldedString, foldText, originalRange } from '@/features/anchoring/text-fold';

describe('foldText', () => {
  it('ignores case, ё/е, quotes, dashes, non-breaking spaces and soft hyphens', () => {
    const a = foldedString('Артериальная гипертензия — «ЗАБОЛЕВАНИЕ», все пациенты.');
    const b = foldedString('артериальная  гипертензия - "заболевание"  всё пациенты');
    // «все» and «всё» differ only by ё/е.
    expect(a).toBe('артериальная гипертензия заболевание все пациенты');
    expect(b).toBe('артериальная гипертензия заболевание все пациенты');
    expect(foldedString('про­филактика')).toBe('профилактика');
    expect(foldedString('Ёж')).toBe('еж');
  });

  it('keeps comparison signs and numbers, which carry clinical meaning', () => {
    expect(foldedString('САД ≥ 140 мм рт. ст.')).toBe('сад ≥ 140 мм рт ст');
    expect(foldedString('СКФ <60')).not.toBe(foldedString('СКФ >60'));
    expect(foldedString('0,5 мг')).toBe('0 5 мг');
  });

  it('maps folded offsets back to the original span', () => {
    const source = 'Начало «цитата, с запятой» конец';
    const folded = foldText(source);
    expect(folded.text).toBe('начало цитата с запятой конец');
    const start = folded.text.indexOf('цитата');
    const range = originalRange(folded, start, start + 'цитата с запятой'.length);
    expect(source.slice(range.start, range.end)).toBe('цитата, с запятой');
  });

  it('does not let a stray combining mark split a word', () => {
    expect(foldedString('йод')).toBe('иод');
  });

  it('has no leading or trailing separators', () => {
    expect(foldedString('  «...Текст...»  ')).toBe('текст');
    expect(foldedString('')).toBe('');
    expect(foldedString('.,;')).toBe('');
  });
});
