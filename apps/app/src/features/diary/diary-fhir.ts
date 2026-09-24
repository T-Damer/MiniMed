import {
  type DiaryResults,
  GLUCOSE_CONTEXT_LABEL,
  isBloodPressureEntry,
  isGlucoseEntry,
} from '@/features/diary/diary-model';

/**
 * HL7 FHIR R4 representation of a diary for exchange with other systems. The patient is not
 * identified in the diary, so resources carry no subject; the importing system binds them.
 * Codes: LOINC for measurements, UCUM for units.
 */

const LOINC = 'http://loinc.org';
const UCUM = 'http://unitsofmeasure.org';
const OBSERVATION_CATEGORY = 'http://terminology.hl7.org/CodeSystem/observation-category';
const PATIENT_REPORTED = {
  system: 'https://t-damer.github.io/MiniMed/fhir/tags',
  code: 'patient-reported',
  display: 'Сообщено пациентом (дневник самоконтроля)',
};

type FhirResource = Readonly<Record<string, unknown>>;

function quantity(value: number, unit: string, code: string) {
  return { value, unit, system: UCUM, code };
}

function coding(code: string, display: string) {
  return { coding: [{ system: LOINC, code, display }] };
}

function vitalSigns() {
  return [{ coding: [{ system: OBSERVATION_CATEGORY, code: 'vital-signs' }] }];
}

export function diaryToFhirBundle(results: DiaryResults, exportedAt = new Date()): FhirResource {
  const { invitation } = results;
  const meta = { tag: [PATIENT_REPORTED] };
  const performer = [{ display: 'Пациент (самоконтроль)' }];
  const resources: FhirResource[] = [];
  for (const entry of results.entries) {
    const id = `${invitation.id}-${entry.id}`;
    const note = entry.note ? { note: [{ text: entry.note }] } : {};
    if (isBloodPressureEntry(entry)) {
      resources.push({
        resourceType: 'Observation',
        id,
        meta,
        status: 'final',
        category: vitalSigns(),
        code: coding('85354-9', 'Blood pressure panel with all children optional'),
        effectiveDateTime: entry.at,
        performer,
        component: [
          {
            code: coding('8480-6', 'Systolic blood pressure'),
            valueQuantity: quantity(entry.systolic, 'mm[Hg]', 'mm[Hg]'),
          },
          {
            code: coding('8462-4', 'Diastolic blood pressure'),
            valueQuantity: quantity(entry.diastolic, 'mm[Hg]', 'mm[Hg]'),
          },
        ],
        ...note,
      });
      if (entry.pulse !== undefined) {
        resources.push({
          resourceType: 'Observation',
          id: `${id}-hr`,
          meta,
          status: 'final',
          category: vitalSigns(),
          code: coding('8867-4', 'Heart rate'),
          effectiveDateTime: entry.at,
          performer,
          valueQuantity: quantity(entry.pulse, '/min', '/min'),
        });
      }
    } else if (isGlucoseEntry(entry)) {
      resources.push({
        resourceType: 'Observation',
        id,
        meta,
        status: 'final',
        code: coding('14743-9', 'Glucose [Moles/volume] in Capillary blood by Glucometer'),
        effectiveDateTime: entry.at,
        performer,
        valueQuantity: quantity(entry.mmol, 'mmol/L', 'mmol/L'),
        note: [
          {
            text: [GLUCOSE_CONTEXT_LABEL[entry.context], entry.note].filter(Boolean).join('. '),
          },
        ],
      });
    } else {
      const medication = invitation.medications?.[entry.medication];
      resources.push({
        resourceType: 'MedicationStatement',
        id,
        meta,
        status: entry.taken ? 'completed' : 'not-taken',
        medicationCodeableConcept: { text: medication?.name ?? 'Препарат' },
        effectiveDateTime: entry.at,
        informationSource: { display: 'Пациент' },
        ...(medication?.dose ? { dosage: [{ text: medication.dose }] } : {}),
        ...note,
      });
    }
  }
  return {
    resourceType: 'Bundle',
    id: invitation.id,
    type: 'collection',
    timestamp: exportedAt.toISOString(),
    meta,
    // Collection entries need no fullUrl; ids are local to this export.
    entry: resources.map((resource) => ({ resource })),
  };
}
