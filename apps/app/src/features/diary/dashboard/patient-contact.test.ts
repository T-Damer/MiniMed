import { describe, expect, it } from 'vitest';

import { patientVCard, telHref } from '@/features/diary/dashboard/patient-contact';

describe('patient contact', () => {
  it('dials only digits and the plus', () => {
    expect(telHref('+7 (900) 000-11-22')).toBe('tel:+79000001122');
  });

  it('writes an escaped vCard with one phone', () => {
    const card = patientVCard({ name: 'Лиса; А.К.', phone: '+7 900 000-11-22' });
    expect(card).toContain(String.raw`FN:Лиса\; А.К.`);
    expect(card).toContain('TEL;TYPE=CELL:+79000001122');
    expect(card.startsWith('BEGIN:VCARD\r\nVERSION:3.0')).toBe(true);
  });
});
