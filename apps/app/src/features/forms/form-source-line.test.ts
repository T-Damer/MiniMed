import type { FormSchema } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';
import { listFormSchemas } from '@/features/forms/form-registry';
import {
  localToday,
  orderReference,
  registrationReference,
  validityLine,
} from '@/features/forms/form-source-line';

const source = (changes: Partial<FormSchema['source']>): FormSchema['source'] => {
  const base = listFormSchemas()[0]?.source;
  if (!base) throw new Error('no shipped form');
  return { ...base, ...changes };
};

describe('form source line', () => {
  it('names the order of Минздрав by its short form and a joint order by both issuers', () => {
    expect(orderReference(source({ orderDate: '2025-05-13', orderNumber: '274н' }))).toBe(
      'Приказ Минздрава России от 13.05.2025 № 274н',
    );
    expect(
      orderReference(
        source({
          issuer:
            'Министерство труда и социальной защиты Российской Федерации и Министерство здравоохранения Российской Федерации',
          orderDate: '2022-08-12',
          orderNumber: '488н/551н',
        }),
      ),
    ).toContain('Приказ (Министерство труда');
  });

  it('names the registration with the Ministry of Justice', () => {
    const { registration } = source({});
    expect(
      registrationReference(
        source({ registration: { ...registration, date: '2025-06-27', number: '82707' } }),
      ),
    ).toBe('зарегистрирован Минюстом 27.06.2025 № 82707');
  });

  it('says «действует» for a form in force, with the end date when the order has one', () => {
    expect(
      validityLine(
        source({ effectiveFrom: '2025-09-01', effectiveUntil: '2031-09-01' }),
        '2026-10-05',
      ),
    ).toBe('Действует с 01.09.2025 по 01.09.2031.');
    const open = source({ effectiveFrom: '2025-10-27' });
    delete (open as { effectiveUntil?: string }).effectiveUntil;
    expect(validityLine(open, '2026-10-05')).toBe('Действует с 27.10.2025.');
  });

  it('says «вступает в силу» while the date has not come, so a coming edition is not shown as current', () => {
    expect(
      validityLine(
        source({ effectiveFrom: '2027-03-01', effectiveUntil: '2033-03-01' }),
        '2026-10-05',
      ),
    ).toBe('Вступает в силу с 01.03.2027.');
    expect(
      validityLine(
        source({ effectiveFrom: '2027-03-01', effectiveUntil: '2033-03-01' }),
        '2027-03-01',
      ),
    ).toBe('Действует с 01.03.2027 по 01.03.2033.');
  });

  it('reads the local calendar day', () => {
    expect(localToday(new Date(2026, 9, 5, 23, 59))).toBe('2026-10-05');
    expect(localToday(new Date(2026, 0, 2, 0, 1))).toBe('2026-01-02');
  });
});
