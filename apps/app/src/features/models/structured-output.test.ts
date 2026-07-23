import { describe, expect, it } from 'vitest';

import { extractStructuredJson, normalizeLocalModelProbe } from './structured-output';

describe('extractStructuredJson', () => {
  it('reads a plain JSON object', () => {
    expect(extractStructuredJson('{"intent":"search","ageYears":3,"concepts":["астма"]}')).toEqual({
      intent: 'search',
      ageYears: 3,
      concepts: ['астма'],
    });
  });

  it('ignores Qwen thinking and a Markdown fence', () => {
    const output = `<think>Нужно вернуть объект.</think>\nОтвет:\n\`\`\`json\n{"intent":"search","ageYears":3,"concepts":["астма"]}\n\`\`\``;
    expect(extractStructuredJson(output)).toEqual({
      intent: 'search',
      ageYears: 3,
      concepts: ['астма'],
    });
  });

  it('finds a balanced object without consuming unrelated braces', () => {
    const output =
      'Пример {не JSON}. Итог: {"intent":"search","ageYears":3,"concepts":["объект {в строке}"]}.';
    expect(extractStructuredJson(output)).toEqual({
      intent: 'search',
      ageYears: 3,
      concepts: ['объект {в строке}'],
    });
  });

  it('returns null for incomplete output', () => {
    expect(extractStructuredJson('{"intent":"search"')).toBeNull();
  });
});

describe('normalizeLocalModelProbe', () => {
  it('accepts a numeric age encoded as a string', () => {
    expect(
      normalizeLocalModelProbe({ intent: 'search', ageYears: '3', concepts: [' астма '] }),
    ).toEqual({ intent: 'search', ageYears: 3, concepts: ['астма'] });
  });

  it('rejects empty or partial probes', () => {
    expect(normalizeLocalModelProbe({ intent: '', ageYears: 3, concepts: ['астма'] })).toBeNull();
    expect(normalizeLocalModelProbe({ intent: 'search', ageYears: 3, concepts: [] })).toBeNull();
  });
});
