import {
  PAST_MED_AUTHOR_LABEL,
  PAST_MED_EFFECT_LABEL,
  PAST_MED_STOP_LABEL,
  type PastMedication,
  pastMedConcern,
} from '@/features/diary/diary-med-history';
import {
  DIARY_MISS_REASON_LABEL,
  type DiaryField,
  type DiaryPlanValue,
  type DiaryResults,
  type DiaryValue,
  describeDiaryValue,
  markedDose,
  planItem,
} from '@/features/diary/diary-model';

/**
 * HL7 FHIR R4 representation of a diary for exchange with other systems. The patient is not
 * identified in the diary, so resources carry no subject; the importing system binds them.
 * Numeric fields with a LOINC code become coded Observations (UCUM units); a tracked plan item
 * becomes a MedicationStatement; every other answer is an Observation coded by its label text.
 * A medicine taken before (MEDHIST1) becomes a MedicationStatement over its period and, with an
 * allergy or intolerance, an AllergyIntolerance (unconfirmed: entered from the patient's words).
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
    // A counted amount with a unit («порций», «сигарет») keeps it as a quantity.
    return field.type === 'count' && !field.unit
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

const ATC_SYSTEM = 'http://www.whocc.no/atc';
const CLINICAL = 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical';
const VERIFICATION = 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification';

function medicationConcept(item: PastMedication): Record<string, unknown> {
  const codes = (item.atc ?? []).filter((code) => code.length === 7);
  return {
    text: item.name,
    ...(codes.length ? { coding: codes.map((code) => ({ system: ATC_SYSTEM, code })) } : {}),
  };
}

/** FHIR R4 has three reaction severities; «угрожала жизни» is the highest of them. */
const REACTION_SEVERITY = {
  mild: 'mild',
  moderate: 'moderate',
  severe: 'severe',
  'life-threatening': 'severe',
} as const;

function pastMedResources(prefix: string, item: PastMedication, meta: unknown): FhirResource[] {
  const notes = [
    item.duration ? `Длительность: ${item.duration}` : '',
    item.approx ? 'Даты примерные' : '',
    item.reaction ? `Реакция: ${item.reaction}` : '',
    item.effect ? `Эффект по оценке пациента: ${PAST_MED_EFFECT_LABEL[item.effect]}` : '',
    item.note ?? '',
  ].filter(Boolean);
  const source = { display: PAST_MED_AUTHOR_LABEL[item.by] };
  const statement: FhirResource = {
    resourceType: 'MedicationStatement',
    id: `${prefix}-h-${item.id}`,
    meta,
    status: item.stop ? 'stopped' : 'completed',
    ...(item.stop
      ? {
          statusReason: [
            {
              text:
                item.stop === 'other' && item.stopNote
                  ? item.stopNote
                  : PAST_MED_STOP_LABEL[item.stop],
            },
          ],
        }
      : {}),
    medicationCodeableConcept: medicationConcept(item),
    ...(item.from || item.to
      ? {
          effectivePeriod: {
            ...(item.from ? { start: item.from } : {}),
            ...(item.to ? { end: item.to } : {}),
          },
        }
      : {}),
    dateAsserted: item.updatedAt,
    informationSource: source,
    ...(item.dose ? { dosage: [{ text: item.dose }] } : {}),
    ...(notes.length ? { note: notes.map((text) => ({ text })) } : {}),
  };
  const concern = pastMedConcern(item);
  if (concern !== 'allergy' && concern !== 'intolerance') return [statement];
  // FHIR: leave `type` out when it is not clear whether it is an allergy or an intolerance.
  const type =
    item.allergy === 'yes' ? 'allergy' : item.allergy === 'no' ? 'intolerance' : undefined;
  const allergy: FhirResource = {
    resourceType: 'AllergyIntolerance',
    id: `${prefix}-a-${item.id}`,
    meta,
    clinicalStatus: { coding: [{ system: CLINICAL, code: 'active' }] },
    verificationStatus: { coding: [{ system: VERIFICATION, code: 'unconfirmed' }] },
    ...(type ? { type } : {}),
    category: ['medication'],
    code: medicationConcept(item),
    recordedDate: item.updatedAt,
    asserter: source,
    ...(item.reaction || item.severity
      ? {
          reaction: [
            {
              manifestation: [{ text: item.reaction ?? 'Реакция не описана' }],
              ...(item.severity ? { severity: REACTION_SEVERITY[item.severity] } : {}),
            },
          ],
        }
      : {}),
  };
  return [statement, allergy];
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
        const dose = markedDose(invitation, plan);
        if (field.trackDone && plan.done !== undefined) {
          resources.push({
            resourceType: 'MedicationStatement',
            id,
            meta,
            status: plan.done ? 'completed' : 'not-taken',
            // FHIR R4 MedicationStatement.statusReason: why it was not taken, in words.
            ...(!plan.done && plan.reason
              ? { statusReason: [{ text: DIARY_MISS_REASON_LABEL[plan.reason] }] }
              : {}),
            medicationCodeableConcept: { text: item?.name ?? plan.other ?? field.label },
            effectiveDateTime: entry.at,
            informationSource: { display: 'Пациент' },
            ...(dose ? { dosage: [{ text: dose }] } : {}),
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
  for (const item of results.medHistory ?? []) {
    resources.push(...pastMedResources(invitation.id, item, meta));
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
