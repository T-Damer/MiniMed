/** Capture existing schema engines: TZ=UTC bun tools/benchmarks/src/export-native-tools.ts */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { assessmentDefinitionFromRecord } from '@localmed/app/features/assessments/assessment-definition';
import { scoreAssessment } from '@localmed/app/features/assessments/assessment-engine';
import type {
  AssessmentAnswers,
  AssessmentDefinition,
} from '@localmed/app/features/assessments/assessment-types';
import { evaluateCalculatorExpression } from '@localmed/app/features/calculators/calculator-expression';
import { collectCasesForSchema } from '@localmed/app/features/calculators/calculator-schema-cases';
import { evaluateCalculatorSchema } from '@localmed/app/features/calculators/calculator-schema-engine';
import {
  loadToolModuleRecords,
  TOOL_MODULE_FILES,
} from '@localmed/app/features/calculators/tool-module-test-helpers';
import { REPOSITORY_ROOT } from '@localmed/benchmarks/real-corpus';
import { CalculatorSchemaSchema } from '@localmed/contracts';

const files = [...TOOL_MODULE_FILES, 'content/tool-modules/pediatrics-growth.json'];
if (process.env['TZ'] !== 'UTC') throw new Error('Native tools oracle requires explicit TZ=UTC');
const completedAt = new Date().toISOString();
const today = evaluateCalculatorExpression('today()', {});
if (typeof today !== 'string') throw new Error('Production today() did not return a date');

function assessmentCases(definition: AssessmentDefinition) {
  const rows: { caseName: string; answers: AssessmentAnswers }[] = [
    { caseName: 'empty', answers: {} },
  ];
  const options = (id: string) => {
    const question = definition.questions.find((candidate) => candidate.id === id);
    if (!question) throw new Error('Question is missing');
    return question.responseOptions ?? definition.responseOptions;
  };
  const filled = (last: boolean): AssessmentAnswers =>
    Object.fromEntries(
      definition.questions.map((question) => {
        const choices = options(question.id);
        const value = (last ? choices.at(-1) : choices[0])?.value;
        if (value === undefined) throw new Error('Question response options are missing');
        return [question.id, value];
      }),
    );
  const baseline = filled(false);
  rows.push(
    { caseName: 'all-first', answers: baseline },
    { caseName: 'all-last', answers: filled(true) },
  );
  for (const question of definition.questions) {
    for (const option of options(question.id)) {
      rows.push({
        caseName: `response:${question.id}:${option.value}`,
        answers: { ...baseline, [question.id]: option.value },
      });
    }
    const missing = { ...baseline };
    delete missing[question.id];
    rows.push({ caseName: `missing:${question.id}`, answers: missing });
    const invalid = Math.max(...options(question.id).map((option) => option.value)) + 1;
    rows.push({
      caseName: `invalid:${question.id}`,
      answers: { ...baseline, [question.id]: invalid },
    });
  }
  return rows.map((row) => ({
    ...row,
    toolId: definition.id,
    result: scoreAssessment(definition, row.answers, completedAt),
  }));
}

const records = loadToolModuleRecords(files);
if (new Set(records.map((record) => record.id)).size !== records.length)
  throw new Error('Duplicate tool identity');
const calculatorCases = records
  .filter((record) => record.kind === 'calculator')
  .flatMap((record) => {
    const schema = CalculatorSchemaSchema.parse(record.definition);
    return collectCasesForSchema(schema).map(({ schemaId, caseName, inputs, options }) => {
      const nonFiniteInputs = Object.keys(inputs).filter(
        (id) => typeof inputs[id] === 'number' && !Number.isFinite(inputs[id]),
      );
      return {
        toolId: schemaId,
        caseName,
        inputs: Object.fromEntries(
          Object.entries(inputs).filter(([id]) => !nonFiniteInputs.includes(id)),
        ),
        ...(nonFiniteInputs.length ? { nonFiniteInputs } : {}),
        ...(options ? { options } : {}),
        result: evaluateCalculatorSchema(schema, inputs, options),
      };
    });
  });
const assessmentRows = records
  .filter((record) => record.kind === 'assessment')
  .flatMap((record) => assessmentCases(assessmentDefinitionFromRecord(record)));
if (today !== evaluateCalculatorExpression('today()', {}))
  throw new Error('Oracle generation crossed the date boundary');
const output = {
  schemaVersion: 1,
  generatedAt: completedAt,
  today,
  timezone: process.env['TZ'] ?? null,
  sources: files.map((path) => ({
    path,
    sha256: createHash('sha256')
      .update(readFileSync(resolve(REPOSITORY_ROOT, path)))
      .digest('hex'),
  })),
  records,
  calculatorCases,
  assessmentCases: assessmentRows,
};
const args = process.argv.slice(2);
if (args.some((arg) => !/^--output=.+$/u.test(arg)) || args.length > 1)
  throw new Error('Expected only optional --output=path');
const path = resolve(
  REPOSITORY_ROOT,
  args[0]?.slice('--output='.length) ??
    'native/shared/src/commonTest/resources/native-tools-golden.json',
);
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, `${JSON.stringify(output, null, 2)}\n`);
console.log(
  JSON.stringify({
    tools: records.length,
    calculators: records.filter((record) => record.kind === 'calculator').length,
    assessments: records.filter((record) => record.kind === 'assessment').length,
    calculatorCases: calculatorCases.length,
    assessmentCases: assessmentRows.length,
  }),
);
