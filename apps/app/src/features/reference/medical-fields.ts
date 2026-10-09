/**
 * Medical fields a dictionary sense can belong to. The ids are the ones the edition build writes
 * into `sense.field` (`tools/ingest/.../kr_fields.py`); labels come from the data itself, this
 * table only lets the app recognise a field from a specialty name the doctor picked or opened.
 */
export interface MedicalField {
  readonly id: string;
  readonly label: string;
  /** Lower-case word starts that name the field or its practitioner («кардиолог», «кардиохирург»). */
  readonly stems: readonly string[];
}

export const MEDICAL_FIELDS: readonly MedicalField[] = [
  { id: 'psychiatry', label: 'психиатрия', stems: ['психиатр'] },
  { id: 'neurology', label: 'неврология', stems: ['невролог', 'неврол'] },
  { id: 'cardiology', label: 'кардиология', stems: ['кардиолог', 'кардио'] },
  { id: 'oncology', label: 'онкология', stems: ['онколог', 'онко'] },
  { id: 'hematology', label: 'гематология', stems: ['гематолог'] },
  { id: 'endocrinology', label: 'эндокринология', stems: ['эндокринолог'] },
  { id: 'gastroenterology', label: 'гастроэнтерология', stems: ['гастроэнтеролог'] },
  { id: 'pulmonology', label: 'пульмонология', stems: ['пульмонолог'] },
  { id: 'nephrology', label: 'нефрология', stems: ['нефролог'] },
  { id: 'urology', label: 'урология', stems: ['уролог'] },
  { id: 'gynecology', label: 'гинекология', stems: ['гинеколог'] },
  { id: 'obstetrics', label: 'акушерство', stems: ['акушер'] },
  { id: 'neonatology', label: 'неонатология', stems: ['неонатолог'] },
  { id: 'pediatrics', label: 'педиатрия', stems: ['педиатр'] },
  { id: 'dermatology', label: 'дерматология', stems: ['дерматолог', 'дерматовенеролог'] },
  { id: 'rheumatology', label: 'ревматология', stems: ['ревматолог'] },
  { id: 'ophthalmology', label: 'офтальмология', stems: ['офтальмолог', 'окулист'] },
  {
    id: 'otolaryngology',
    label: 'оториноларингология',
    stems: ['оториноларинголог', 'лор'],
  },
  { id: 'dentistry', label: 'стоматология', stems: ['стоматолог'] },
  { id: 'traumatology', label: 'травматология', stems: ['травматолог'] },
  { id: 'orthopedics', label: 'ортопедия', stems: ['ортопед'] },
  { id: 'surgery', label: 'хирургия', stems: ['хирург'] },
  { id: 'anesthesiology', label: 'анестезиология', stems: ['анестезиолог', 'реаниматолог'] },
  { id: 'infectious', label: 'инфекционные болезни', stems: ['инфекционист', 'инфекц'] },
  { id: 'allergology', label: 'аллергология', stems: ['аллерголог'] },
  { id: 'immunology', label: 'иммунология', stems: ['иммунолог'] },
  { id: 'genetics', label: 'медицинская генетика', stems: ['генетик', 'генетич'] },
  { id: 'radiology', label: 'лучевая диагностика', stems: ['рентгенолог', 'радиолог'] },
  { id: 'toxicology', label: 'токсикология', stems: ['токсиколог'] },
  { id: 'narcology', label: 'наркология', stems: ['нарколог'] },
  { id: 'phthisiology', label: 'фтизиатрия', stems: ['фтизиатр'] },
  { id: 'rehabilitation', label: 'реабилитация', stems: ['реабилитолог'] },
  { id: 'emergency', label: 'неотложные состояния', stems: ['скорая'] },
];

function nameWords(name: string): readonly string[] {
  return name
    .toLowerCase()
    .replaceAll('ё', 'е')
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
}

/** The field a specialty name points at («Психиатрия», «психиатр-нарколог» → first match). */
export function fieldForSpecialty(name: string): string | undefined {
  return fieldsForSpecialty(name)[0];
}

/** Every distinct field a name mentions, in reading order («Гематология и онкология»). */
export function fieldsForSpecialty(name: string): readonly string[] {
  const found: string[] = [];
  for (const word of nameWords(name)) {
    const match = MEDICAL_FIELDS.find((field) => field.stems.some((stem) => word.startsWith(stem)));
    if (match && !found.includes(match.id)) found.push(match.id);
  }
  return found;
}

/** The field named by a catalogue specialty slug («child-psychiatry» → psychiatry), if its words are a field id. */
export function fieldForSpecialtySlug(slug: string): string | undefined {
  return slug
    .split('-')
    .map((word) => MEDICAL_FIELDS.find((field) => field.id === word)?.id)
    .find((id) => id !== undefined);
}

/** The label of a field id, or the id itself when the table does not know it. */
export function medicalFieldLabel(id: string): string {
  return MEDICAL_FIELDS.find((field) => field.id === id)?.label ?? id;
}
