import {
  type DiaryField,
  type DiaryPlanValue,
  type DiaryResults,
  type DiaryValue,
  describeDiaryValue,
  planItem,
} from '@/features/diary/diary-model';

/**
 * HL7 FHIR R4 representation of a diary for exchange with other systems. The patient is not
 * identified in the diary, so resources carry no subject; the importing system binds them.
 * Numeric fields with a LOINC code become coded Observations (UCUM units); a tracked plan item
 * becomes a MedicationStatement; every other answer is an Observation coded by its label text.
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

function vitalSigns() {
  return [{ coding: [{ system: OBSERVATION_CATEGORY, code: 'vital-signs' }] }];
}

function survey() {
  return [{ coding: [{ system: OBSERVATION_CATEGORY, code: 'survey' }] }];
}

function answer(field: DiaryField, value: DiaryValue): Record<string, unknown> {
  if (typeof value === 'number') {
    return field.type === 'count'
      ? { valueInteger: value }
      : {
          valueQuantity: {
            value,
            ...(field.unit ? { unit: field.unit } : {}),
            ...(field.metric?.ucum ? { system: UCUM, code: field.metric.ucum } : {}),
          },
        };
  }
  if (typeof value === 'boolean') return { valueBoolean: value };
  if (typeof value === 'string') return { valueString: value };
  return { valueString: (value as readonly string[]).join(', ') };
}

export function diaryToFhirBundle(results: DiaryResults, exportedAt = new Date()): FhirResource {
  const { invitation } = results;
  const meta = { tag: [PATIENT_REPORTED] };
  const performer = [{ display: 'Пациент (самоконтроль)' }];
  const resources: FhirResource[] = [];
  for (const entry of results.entries) {
    const note = entry.note ? { note: [{ text: entry.note }] } : {};
    const systolic = entry.values['systolic'];
    const diastolic = entry.values['diastolic'];
    const pressurePanel =
      invitation.template === 'blood-pressure' &&
      typeof systolic === 'number' &&
      typeof diastolic === 'number';
    if (pressurePanel) {
      resources.push({
        resourceType: 'Observation',
        id: `${invitation.id}-${entry.id}`,
        meta,
        status: 'final',
        category: vitalSigns(),
        code: { coding: [{ system: LOINC, code: '85354-9', display: 'Blood pressure panel' }] },
        effectiveDateTime: entry.at,
        performer,
        component: [
          {
            code: {
              coding: [{ system: LOINC, code: '8480-6', display: 'Systolic blood pressure' }],
            },
            valueQuantity: { value: systolic, unit: 'mm[Hg]', system: UCUM, code: 'mm[Hg]' },
          },
          {
            code: {
              coding: [{ system: LOINC, code: '8462-4', display: 'Diastolic blood pressure' }],
            },
            valueQuantity: { value: diastolic, unit: 'mm[Hg]', system: UCUM, code: 'mm[Hg]' },
          },
        ],
        ...note,
      });
    }
    for (const field of invitation.fields) {
      const value = entry.values[field.id];
      if (value === undefined) continue;
      if (pressurePanel && (field.id === 'systolic' || field.id === 'diastolic')) continue;
      const id = `${invitation.id}-${entry.id}-${field.id}`;
      if (field.type === 'plan') {
        const plan = value as DiaryPlanValue;
        const item = planItem(invitation, plan.item);
        if (field.trackDone && plan.done !== undefined) {
          resources.push({
            resourceType: 'MedicationStatement',
            id,
            meta,
            status: plan.done ? 'completed' : 'not-taken',
            medicationCodeableConcept: { text: item?.name ?? plan.other ?? field.label },
            effectiveDateTime: entry.at,
            informationSource: { display: 'Пациент' },
            ...(item?.dose ? { dosage: [{ text: item.dose }] } : {}),
            ...note,
          });
          continue;
        }
        resources.push({
          resourceType: 'Observation',
          id,
          meta,
          status: 'final',
          category: survey(),
          code: { text: field.label },
          effectiveDateTime: entry.at,
          performer,
          valueString: describeDiaryValue(invitation, field, value),
        });
        continue;
      }
      const loinc = field.metric?.loinc;
      resources.push({
        resourceType: 'Observation',
        id,
        meta,
        status: 'final',
        category: loinc ? vitalSigns() : survey(),
        code: loinc
          ? {
              coding: [{ system: LOINC, code: loinc, display: field.metric?.label ?? field.label }],
            }
          : { text: field.label },
        effectiveDateTime: entry.at,
        performer,
        ...answer(field, value),
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
