import { type FormSchema, parseFormSchema } from '@localmed/contracts';

import form088u from './schemas/ru-mintrud-minzdrav-488n-551n-088u.json';
import form0251u from './schemas/ru-minzdrav-274n-025-1u.json';
import form070u from './schemas/ru-minzdrav-274n-070u.json';
import form072u from './schemas/ru-minzdrav-274n-072u.json';
import form076u from './schemas/ru-minzdrav-274n-076u.json';
import form079u from './schemas/ru-minzdrav-274n-079u.json';
import form071u from './schemas/ru-minzdrav-395n-071u.json';
import form057u from './schemas/ru-minzdrav-519n-057u.json';
import form058u from './schemas/ru-minzdrav-740n-058u.json';
import form003vu from './schemas/ru-minzdrav-1092n-003-vu.json';
import form1071u from './schemas/ru-minzdrav-1094n-107-1u.json';
import form148u04l from './schemas/ru-minzdrav-1094n-148-1u-04l.json';
import form148u88 from './schemas/ru-minzdrav-1094n-148-1u-88.json';

/**
 * Form schemas shipped with the app, generated from official orders by tools/ingest. The order is
 * the order of the list: the certificates and referrals a doctor writes most often come first, the
 * edition that is not in force yet (058/у) after the forms in force.
 */
const SHIPPED_SCHEMAS: readonly unknown[] = [
  form070u,
  form057u,
  form088u,
  form1071u,
  form148u88,
  form148u04l,
  form003vu,
  form071u,
  form072u,
  form076u,
  form079u,
  form0251u,
  form058u,
];

let parsed: readonly FormSchema[] | undefined;

/** Validated at the boundary once; a corrupt shipped schema fails loudly, never half-renders. */
export function listFormSchemas(): readonly FormSchema[] {
  parsed ??= SHIPPED_SCHEMAS.map((schema) => parseFormSchema(schema));
  return parsed;
}

export function findFormSchema(id: string): FormSchema | undefined {
  return listFormSchemas().find((schema) => schema.id === id);
}
