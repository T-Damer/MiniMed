import { AssessmentDefinitionSchema, type ToolDefinitionRecord } from '@localmed/contracts';
import type { AssessmentDefinition } from '@/features/assessments/assessment-types';

export function assessmentDefinitionFromRecord(record: ToolDefinitionRecord): AssessmentDefinition {
  if (record.kind !== 'assessment') throw new Error('Expected an assessment record.');
  const parsed = AssessmentDefinitionSchema.parse(record.definition);
  if (parsed.id !== record.id) throw new Error(`Assessment payload does not match ${record.id}.`);
  const { interpretations, license, questions, ...rest } = parsed;
  const definition: AssessmentDefinition = {
    ...rest,
    schemaVersion: 2,
    version: record.version,
    evaluation: parsed.evaluation,
    observationMappings: parsed.observationMappings,
    license: {
      kind: license.kind,
      notice: license.notice,
      ...(license.sourceUrl ? { sourceUrl: license.sourceUrl } : {}),
    },
    questions: questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      scaleId: question.scaleId,
      ...(question.reverse === true ? { reverse: true as const } : {}),
      ...(question.responseOptions ? { responseOptions: question.responseOptions } : {}),
    })),
    ...(interpretations
      ? {
          interpretations: interpretations.map((band) => ({
            minScore: band.minScore,
            maxScore: band.maxScore,
            headline: band.headline,
            message: band.message,
            ...(band.scaleId ? { scaleId: band.scaleId } : {}),
            ...(band.when ? { when: band.when } : {}),
          })),
        }
      : {}),
    sourceLinks: record.sources,
  };
  return definition;
}
