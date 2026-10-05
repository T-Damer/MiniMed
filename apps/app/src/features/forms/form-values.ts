import type { FormField, FormSchema } from '@localmed/contracts';

/** What the user (or a prefill) put in a field: text, a picked code, picked codes, or a mark. */
export type FormValue = string | boolean | readonly string[];
export type FormValues = Readonly<Record<string, FormValue>>;

export function isFilled(value: FormValue | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim().length > 0;
  return value.length > 0;
}

/** Fields the person fills in (signatures and stamps are put on the printed sheet). */
export function fillableFields(schema: FormSchema): readonly FormField[] {
  return schema.fields.filter((field) => field.type !== 'signature' && field.type !== 'stamp');
}

export function textValue(value: FormValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

export function listValue(value: FormValue | undefined): readonly string[] {
  if (Array.isArray(value)) return value as readonly string[];
  return typeof value === 'string' && value ? [value] : [];
}
