/**
 * What the instruction says that concerns the patient's state (RX1): pregnancy, breastfeeding and,
 * for a child, the age limits. The sentences are those the safety index finds in the open
 * instruction (SAFE1), quoted without change with their sections; this module only decides which of
 * the three questions apply to the patient. It never answers «можно» or «нельзя».
 */
import type { MedicalDocument } from '@localmed/contracts';

import { safetyOfDocument } from '@/features/medication-safety/safety-document';
import type { SafetyIntent, TypedAge } from '@/features/medication-safety/safety-query';
import {
  type DocumentState,
  type IntentView,
  intentView,
} from '@/features/medication-safety/safety-view';
import { ADULT_AGE_DAYS, type PatientFacts } from './dose-population';

export interface PatientStateFacts extends PatientFacts {
  readonly pregnant: boolean;
  readonly lactating: boolean;
}

export function safetyIntentsFor(patient: PatientStateFacts): readonly SafetyIntent[] {
  const intents: SafetyIntent[] = [];
  if (patient.pregnant) intents.push('pregnancy');
  if (patient.lactating) intents.push('lactation');
  if (
    (patient.ageDays !== undefined && patient.ageDays < ADULT_AGE_DAYS) ||
    (patient.ageDays === undefined && patient.group === 'child')
  ) {
    intents.push('age');
  }
  return intents;
}

function typedAge(patient: PatientStateFacts): TypedAge | null {
  if (patient.ageDays === undefined) return null;
  return { days: patient.ageDays, kind: 'exact', text: ageText(patient.ageDays) };
}

const AGE_YEAR_DAYS = 365.25;
const AGE_MONTH_DAYS = AGE_YEAR_DAYS / 12;

/**
 * «5 лет», «8 мес.», «12 дн.» for an age in days. The days of a whole number of years or months are
 * rounded (`Math.round(5 * 365.25)` = 1826, `8 * 30.4375` = 243.5 → 244) and a birth date gives a day
 * less in a span without a leap day, so the count is taken a little generously: never «4 года» for
 * a patient whose fifth birthday is today.
 */
export function ageText(ageDays: number): string {
  const years = Math.floor((ageDays + 1.5) / AGE_YEAR_DAYS);
  if (years >= 2) {
    const tail = years % 100;
    const last = years % 10;
    const word =
      tail >= 11 && tail <= 14
        ? 'лет'
        : last === 1
          ? 'год'
          : last >= 2 && last <= 4
            ? 'года'
            : 'лет';
    return `${years} ${word}`;
  }
  const months = Math.floor((ageDays + 0.5) / AGE_MONTH_DAYS);
  return months >= 1 ? `${months} мес.` : `${ageDays} дн.`;
}

/** The blocks of the card for the questions that apply; empty when the patient raises none. */
export function safetyViewsFor(
  document: MedicalDocument,
  patient: PatientStateFacts,
): readonly IntentView[] {
  const intents = safetyIntentsFor(patient);
  if (intents.length === 0) return [];
  const safety = safetyOfDocument(document);
  if (!safety) return [];
  const documents = new Map<string, DocumentState>([[document.id, { document }]]);
  return intents.map((intent) =>
    intentView({
      index: safety.index,
      candidate: safety.candidate,
      intent,
      age: typedAge(patient),
      trimester: null,
      documents,
    }),
  );
}
