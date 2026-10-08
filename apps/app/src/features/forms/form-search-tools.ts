import { anyAgeScope, type FormSchema } from '@localmed/contracts';

import { listFormSchemas } from '@/features/forms/form-registry';
import { notesFormsPath } from '@/features/notes/notes-routing';

/** A form as search lists it next to calculators and questionnaires; opens the filling screen. */
export interface FormSearchTool {
  readonly id: string;
  /** «Форма № 070/у»: the number leads, the order and its legal wording stay in the form itself. */
  readonly title: string;
  readonly description: string;
  readonly aliases: readonly string[];
  readonly href: string;
}

/** The typed shapes of one number: «070/у», «070у», «070», «форма 070/у». */
function numberAliases(formNumber: string): readonly string[] {
  const compact = formNumber.replace(/\s+/gu, '');
  const withoutSlash = compact.replace('/', '');
  const base = compact.split('/')[0] ?? compact;
  return [
    ...new Set([
      compact,
      withoutSlash,
      base,
      `форма ${compact}`,
      `форма № ${compact}`,
      `форма ${base}`,
    ]),
  ];
}

export function formSearchTool(schema: FormSchema): FormSearchTool {
  return {
    id: schema.id,
    title: `Форма № ${schema.formNumber} — ${schema.title}`,
    description: 'Официальная учётная форма: заполняется по карточке пациента и печатается.',
    aliases: numberAliases(schema.formNumber),
    href: notesFormsPath(schema.id),
  };
}

export function listFormSearchTools(): readonly FormSearchTool[] {
  return listFormSchemas().map(formSearchTool);
}

/** Forms are not tied to a patient's age. */
export const FORM_AGE_SCOPE = anyAgeScope(
  'Официальная учётная форма: возраст пациента не ограничивает её заполнение.',
);
