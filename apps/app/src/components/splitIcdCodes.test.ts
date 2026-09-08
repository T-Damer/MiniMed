import { expect, it } from 'vitest';
import { splitIcdCodes } from './splitIcdCodes';

it('styles complete ICD codes and ranges without changing ordinary numbers or words', () => {
  const title = 'А00-А99 · A00.1–B99 — МКБ-10, 2026 год, AB123, A001';
  const parts = splitIcdCodes(title);
  expect(parts.map((part) => part.text).join('')).toBe(title);
  expect(parts.filter((part) => part.code).map((part) => part.text)).toEqual([
    'А00-А99',
    'A00.1–B99',
  ]);
});
