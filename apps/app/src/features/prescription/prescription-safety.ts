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

export function ageText(ageDays: number): string {
  const years = Math.floor(ageDays / 365.25);
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
  const months = Math.floor(ageDays / 30.44);
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
