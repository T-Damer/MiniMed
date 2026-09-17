import type { AssessmentDefinition } from '@/features/assessments/assessment-types';

export function assessmentSourceNote(definition: AssessmentDefinition): string {
  return [
    `Редакция формы: ${definition.version ?? definition.title}`,
    `Источник формы: ${definition.license.notice}`,
    definition.license.sourceUrl ?? '',
    definition.disclaimer,
  ].filter(Boolean).join('\n');
}

export function assessmentQuestionInstructions(definition: AssessmentDefinition): string {
  return definition.questions.flatMap((question, index) => {
    const text = question.text?.trim();
    return text ? [`Пояснение к пункту ${index + 1}: ${text}`] : [];
  }).join('\n\n');
}
