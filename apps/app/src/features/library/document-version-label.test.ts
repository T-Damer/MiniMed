import { describe, expect, it } from 'vitest';

import { documentVersionLabel } from '@/features/library/document-version-label';

describe('documentVersionLabel', () => {
  it('turns a clinical recommendation edition id into its edition number', () => {
    expect(documentVersionLabel('359_3')).toBe('ред. 3');
    expect(documentVersionLabel('1006_1')).toBe('ред. 1');
  });

  it('drops internal source identifiers', () => {
    expect(documentVersionLabel('site-36954b711a3c')).toBeUndefined();
    expect(documentVersionLabel('36954b711a3c0f12')).toBeUndefined();
    expect(documentVersionLabel('')).toBeUndefined();
    expect(documentVersionLabel('  ')).toBeUndefined();
    expect(documentVersionLabel(undefined)).toBeUndefined();
  });

  it('keeps labels that read as a date or a name', () => {
    expect(documentVersionLabel('2026-08-28')).toBe('2026-08-28');
    expect(documentVersionLabel('grls-24.07.2026')).toBe('grls-24.07.2026');
    expect(documentVersionLabel('с изменениями приказа № 677н')).toBe(
      'с изменениями приказа № 677н',
    );
  });
});
