import type { CalculatorSchema, FormSchema } from '@localmed/contracts';
import {
  type FormFillAssessmentSource,
  type FormFillBinding,
  formFillFromAssessment,
  formFillFromCalculator,
  formFillFromOfficialForm,
  formFillHasCues,
  formFillOverlayFor,
} from '@localmed/core/form-fill';

/**
 * Which screens offer «Заполнить по беседе» (FORMFILL1): a calculator, questionnaire or official form whose
 * declared overlay gives word cues, so the conversation can fill it without a model. Decided by the
 * declared data, never by a tool id in the UI.
 */
export function calculatorConversationBinding(
  schema: CalculatorSchema | undefined,
): FormFillBinding | undefined {
  const overlay = schema ? formFillOverlayFor(schema.id) : undefined;
  if (!schema || !overlay) return undefined;
  const binding = formFillFromCalculator(schema, overlay);
  return formFillHasCues(binding.form) ? binding : undefined;
}

export function officialFormConversationBinding(schema: FormSchema): FormFillBinding | undefined {
  const overlay = formFillOverlayFor(schema.id);
  if (!overlay) return undefined;
  const binding = formFillFromOfficialForm(schema, overlay);
  return formFillHasCues(binding.form) ? binding : undefined;
}

export function assessmentConversationBinding(
  definition: FormFillAssessmentSource,
): FormFillBinding | undefined {
  const overlay = formFillOverlayFor(definition.id);
  if (!overlay) return undefined;
  const binding = formFillFromAssessment(definition, overlay);
  return formFillHasCues(binding.form) ? binding : undefined;
}
