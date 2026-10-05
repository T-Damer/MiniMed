import { type FormSchema, parseFormSchema } from '@localmed/contracts';

import form0251u from './schemas/ru-minzdrav-274n-025-1u.json';
import form070u from './schemas/ru-minzdrav-274n-070u.json';
import form072u from './schemas/ru-minzdrav-274n-072u.json';
import form076u from './schemas/ru-minzdrav-274n-076u.json';
import form079u from './schemas/ru-minzdrav-274n-079u.json';

/** Form schemas shipped with the app, generated from official orders by tools/ingest. */
const SHIPPED_SCHEMAS: readonly unknown[] = [form070u, form072u, form076u, form079u, form0251u];

let parsed: readonly FormSchema[] | undefined;

/** Validated at the boundary once; a corrupt shipped schema fails loudly, never half-renders. */
export function listFormSchemas(): readonly FormSchema[] {
  parsed ??= SHIPPED_SCHEMAS.map((schema) => parseFormSchema(schema));
  return parsed;
}

export function findFormSchema(id: string): FormSchema | undefined {
  return listFormSchemas().find((schema) => schema.id === id);
}
