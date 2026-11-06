import { AssessmentDefinitionSchema, type ToolDefinitionRecord } from '@localmed/contracts';
import type { AssessmentDefinition } from '@/features/assessments/assessment-types';

export function assessmentDefinitionFromRecord(record: ToolDefinitionRecord): AssessmentDefinition {
  if (record.kind !== 'assessment') throw new Error('Expected an assessment record.');
  const parsed = AssessmentDefinitionSchema.parse(record.definition);
  if (parsed.id !== record.id) throw new Error(`Assessment payload does not match ${record.id}.`);
  const {
    interpretations,
    license,
    questions,
    scales,
    tallies,
    tables,
    pageSize,
    language,
    answerSheet,
    responseOptions,
    variants,
    variantLabel,
    intro,
    ...rest
  } = parsed;
  const options = (
    list: readonly {
      value: number;
      label: string;
      shortLabel?: string | undefined;
      hideValue?: true | undefined;
    }[],
  ) =>
    list.map((option) => ({
      value: option.value,
      label: option.label,
      ...(option.shortLabel ? { shortLabel: option.shortLabel } : {}),
      ...(option.hideValue ? { hideValue: true as const } : {}),
    }));
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
    scales: scales.map((scale) => ({
      id: scale.id,
      label: scale.label,
      shortLabel: scale.shortLabel,
      description: scale.description,
      ...(scale.formula ? { formula: scale.formula } : {}),
      ...(scale.context ? { context: true as const } : {}),
      ...(scale.hidden ? { hidden: true as const } : {}),
    })),
    questions: questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      scaleId: question.scaleId,
      ...(question.reverse === true ? { reverse: true as const } : {}),
      ...(question.responseOptions ? { responseOptions: options(question.responseOptions) } : {}),
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
    tallies: tallies.map((tally) => ({
      id: tally.id,
      value: tally.value,
      label: tally.label,
      ...(tally.warnAt === undefined ? {} : { warnAt: tally.warnAt }),
      ...(tally.warning ? { warning: tally.warning } : {}),
    })),
    tables: tables.map((table) => ({
      id: table.id,
      title: table.title,
      columns: table.columns,
      rows: table.rows,
      ...(table.caption ? { caption: table.caption } : {}),
    })),
    responseOptions: options(responseOptions),
    ...(pageSize === undefined ? {} : { pageSize }),
    ...(answerSheet ? { answerSheet } : {}),
    variants: variants.map((variant) => ({
      label: variant.label,
      assessmentId: variant.assessmentId,
      ...(variant.language ? { language: variant.language } : {}),
    })),
    ...(variantLabel ? { variantLabel } : {}),
    ...(intro ? { intro } : {}),
    ...(language ? { language } : {}),
    sourceLinks: record.sources,
  };
  return definition;
}
