import type { FormSchema } from '@localmed/contracts';

import { displayDate } from '@/features/forms/form-print';

type FormSource = FormSchema['source'];

const MINZDRAV = 'Министерство здравоохранения Российской Федерации';

/** `Приказ Минздрава России от 13.05.2025 № 274н` (a joint order names both issuers). */
export function orderReference(source: FormSource): string {
  const issuer = source.issuer === MINZDRAV ? 'Минздрава России' : `(${source.issuer})`;
  return `Приказ ${issuer} от ${displayDate(source.orderDate)} № ${source.orderNumber}`;
}

/** `зарегистрирован Минюстом 27.06.2025 № 82707`. */
export function registrationReference(source: FormSource): string {
  return `зарегистрирован Минюстом ${displayDate(source.registration.date)} № ${source.registration.number}`;
}

/**
 * When the form is in force: «Действует с …», «Действует с … по …», or «Вступает в силу с …»
 * for an order whose date has not come yet (the blank is then a preview of the coming edition).
 */
export function validityLine(source: FormSource, today: string): string {
  const from = displayDate(source.effectiveFrom);
  if (source.effectiveFrom > today) return `Вступает в силу с ${from}.`;
  if (source.effectiveUntil) return `Действует с ${from} по ${displayDate(source.effectiveUntil)}.`;
  return `Действует с ${from}.`;
}

/** The local calendar day as `YYYY-MM-DD`. */
export function localToday(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
