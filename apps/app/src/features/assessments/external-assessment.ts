import type { ExternalAssessmentAdministration } from '@localmed/contracts';

import type { ExternalAssessmentValue } from '@/features/assessments/assessment-types';

export type ExternalAssessmentVariant = ExternalAssessmentAdministration['variants'][number];

export type ExternalAssessmentValuesResult =
  | {
      readonly ok: true;
      readonly values: Readonly<Record<string, ExternalAssessmentValue>>;
    }
  | { readonly ok: false; readonly error: string };

function numberFromText(value: string): number {
  return Number(value.replace(',', '.'));
}

export function parseExternalAssessmentValues(
  variant: ExternalAssessmentVariant,
  rawValues: Readonly<Record<string, string>>,
): ExternalAssessmentValuesResult {
  const values: Record<string, ExternalAssessmentValue> = {};
  for (const field of variant.resultFields) {
    const raw = rawValues[field.id]?.trim() ?? '';
    if (!raw) {
      if (field.required) return { ok: false, error: `Заполните поле «${field.label}».` };
      continue;
    }

    if (field.kind === 'number') {
      const value = numberFromText(raw);
      if (!Number.isFinite(value)) {
        return { ok: false, error: `«${field.label}» должно быть числом.` };
      }
      if (field.integer && !Number.isInteger(value)) {
        return { ok: false, error: `«${field.label}» должно быть целым числом.` };
      }
      if (field.minimum !== undefined && value < field.minimum) {
        return { ok: false, error: `«${field.label}» не может быть меньше ${field.minimum}.` };
      }
      if (field.maximum !== undefined && value > field.maximum) {
        return { ok: false, error: `«${field.label}» не может быть больше ${field.maximum}.` };
      }
      values[field.id] = value;
      continue;
    }

    if (field.kind === 'select') {
      if (!field.options.some((option) => option.value === raw)) {
        return { ok: false, error: `Выберите допустимое значение для «${field.label}».` };
      }
      values[field.id] = raw;
      continue;
    }

    values[field.id] = raw;
  }
  return { ok: true, values };
}

const EXTENSION_MIME: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export function isAcceptedExternalAssessmentMaterial(
  file: Readonly<{ name: string; type: string }>,
  acceptedMimeTypes: readonly string[],
): boolean {
  if (acceptedMimeTypes.includes(file.type)) return true;
  if (file.type && file.type !== 'application/octet-stream') return false;
  const extension = file.name.toLocaleLowerCase('en-US').split('.').at(-1) ?? '';
  const inferred = EXTENSION_MIME[extension];
  return inferred !== undefined && acceptedMimeTypes.includes(inferred);
}
