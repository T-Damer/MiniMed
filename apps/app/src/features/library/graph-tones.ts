export type GraphTone = 'clinical' | 'drug' | 'legal' | 'notes' | 'other';

export function graphToneForSourceType(sourceType: string): GraphTone {
  if (sourceType.startsWith('clinical_recommendation')) return 'clinical';
  if (sourceType.startsWith('official_drug') || sourceType.startsWith('official_registry')) {
    return 'drug';
  }
  if (sourceType === 'regulatory_act') return 'legal';
  if (sourceType.startsWith('personal_') || sourceType.includes('note')) return 'notes';
  return 'other';
}
