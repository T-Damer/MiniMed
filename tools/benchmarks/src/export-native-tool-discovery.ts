/** Capture actual browser catalog ordering and source-backed calculator opportunities. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  clearDownloadedAssessments,
  registerDownloadedAssessment,
  searchAssessments,
} from '@localmed/app/features/assessments/assessment-catalog';
import {
  clearDownloadedCalculators,
  registerDownloadedCalculator,
  searchCalculators,
} from '@localmed/app/features/calculators/calculator-registry';
import {
  loadToolModuleRecords,
  TOOL_MODULE_FILES,
} from '@localmed/app/features/calculators/tool-module-test-helpers';
import { resolveCalculatorSuggestion } from '@localmed/app/features/search/calculator-suggestion';
import { REPOSITORY_ROOT } from '@localmed/benchmarks/real-corpus';
import { CalculatorSchemaSchema, type QueryAnalysis } from '@localmed/contracts';
import { analyzeClinicalQuery } from '@localmed/search-lexical';

const files = [...TOOL_MODULE_FILES, 'content/tool-modules/pediatrics-growth.json'];
const records = loadToolModuleRecords(files);
const ids = new Set(records.map((record) => record.id));
clearDownloadedCalculators();
clearDownloadedAssessments();
for (const record of records) {
  if (record.kind === 'calculator') registerDownloadedCalculator(record);
  else registerDownloadedAssessment(record);
}
const queries = [
  ...new Set([
    '',
    ' ',
    '\u00a0',
    '\u0085',
    'е',
    'a',
    'несуществующий инструмент',
    'доза',
    'СКФ',
    'шварца',
    'БЕРЕМЕННОСТЬ',
    'рост масса',
    '  масса  ',
    'Оценка\tразвития',
    'ё',
    'е',
    'ＰＨＱ',
    ...records.flatMap((record) => [record.title, record.shortTitle, ...record.aliases]),
  ]),
];
const catalog = queries.map((query) => ({
  query,
  calculatorIds: searchCalculators(query)
    .filter((record) => ids.has(record.id))
    .map((record) => record.id),
  assessmentIds: searchAssessments(query)
    .filter((record) => ids.has(record.id))
    .map((record) => record.id),
}));
const schemas = records
  .filter((record) => record.kind === 'calculator')
  .map((record) => CalculatorSchemaSchema.parse(record.definition));
const medicationNames = schemas.flatMap((schema) =>
  schema.search?.kind === 'medication-dose'
    ? [schema.search.medication.canonicalTerm, ...schema.search.medication.aliases]
    : [],
);
const aliases = medicationNames.map((name, index) => ({
  id: `tool.${index}`,
  canonicalTerm: name,
  alias: name,
  category: null,
  weight: 1,
}));
const opportunityQueries = [
  ...new Set([
    'пневмония',
    'рассчитать дозу неизвестного препарата',
    'рассчитать объем инфузии ребенку 12 кг',
    'рассчитать объем инфузии ребенку 2 года 12 кг',
    'парацетамол ребенку 5 лет 20 кг внутрь сироп',
    'парацетамол ребенку 5 лет 20 кг 21 кг',
    'парацетамол ребенку 5 лет 6 лет 20 кг',
    'сальбутамол ребенку 8 лет 20 кг при бронхиальной астме',
    'преднизолон ребенку 3 года 15 кг при крупе',
    'парацетамол и ибупрофен ребенку 5 лет 20 кг',
    ...medicationNames.map((name) => `рассчитать дозу ${name} ребенку 5 лет 20 кг`),
  ]),
];
const opportunities: {
  caseName: string;
  analysis: QueryAnalysis;
  availableIds: string[];
  result: ReturnType<typeof resolveCalculatorSuggestion> | null;
}[] = [];
for (const query of opportunityQueries) {
  const { analysis } = analyzeClinicalQuery(query, aliases);
  opportunities.push({
    caseName: query,
    analysis,
    availableIds: schemas.map((s) => s.id),
    result: resolveCalculatorSuggestion(analysis, schemas) ?? null,
  });
  if (analysis.calculation?.kind === 'medication-dose') {
    const fuzzy: QueryAnalysis = {
      ...analysis,
      calculation: {
        ...analysis.calculation,
        medicationCandidates: analysis.calculation.medicationCandidates.map((c) => ({
          ...c,
          matchType: 'fuzzy',
        })),
      },
    };
    opportunities.push({
      caseName: `fuzzy:${query}`,
      analysis: fuzzy,
      availableIds: schemas.map((s) => s.id),
      result: resolveCalculatorSuggestion(fuzzy, schemas) ?? null,
    });
    opportunities.push({
      caseName: `missing:${query}`,
      analysis,
      availableIds: [],
      result: resolveCalculatorSuggestion(analysis, []) ?? null,
    });
  }
}
// Explicitly test-only schemas exercise the same authored boundaries as the browser resolver tests.
// Current shipped bank has no declared search bindings; these are never added to its catalog.
const base = schemas[0];
if (!base) throw new Error('Missing source calculator fixture');
const boundarySchema = (id: string, kind: 'medication-dose' | 'infusion-volume') =>
  CalculatorSchemaSchema.parse({
    ...base,
    id,
    slug: id,
    shortTitle: 'Тестовый калькулятор',
    inputs: [
      { id: 'ageYears', label: 'Возраст', kind: 'number', required: false },
      { id: 'weightKg', label: 'Масса', kind: 'number', required: false },
      {
        id: 'form',
        label: 'Форма',
        kind: 'select',
        required: false,
        options: [
          { value: 'syrup', label: 'Сироп' },
          { value: 'tablet', label: 'Таблетки' },
        ],
      },
      {
        id: 'route',
        label: 'Путь',
        kind: 'select',
        required: false,
        options: [
          { value: 'oral', label: 'Перорально' },
          { value: 'intravenous', label: 'Внутривенно' },
        ],
      },
      {
        id: 'indication',
        label: 'Показание',
        kind: 'select',
        required: false,
        options: [
          { value: 'asthma', label: 'Бронхиальная астма' },
          { value: 'croup', label: 'Круп' },
        ],
      },
    ],
    inputRequirements: [],
    steps: [
      { id: 'placeholder', label: 'Результат', unit: 'нет', expression: '1', isOutput: true },
    ],
    assertions: [],
    search: {
      kind,
      bindings: {
        ageYearsInputId: 'ageYears',
        weightKgInputId: 'weightKg',
        formInputId: 'form',
        routeInputId: 'route',
        indicationInputId: 'indication',
      },
      ...(kind === 'medication-dose'
        ? { medication: { canonicalTerm: 'парацетамол', aliases: ['парацетамола'] } }
        : {}),
    },
  });
const boundarySchemas = [
  boundarySchema('boundary.paracetamol', 'medication-dose'),
  boundarySchema('boundary.infusion', 'infusion-volume'),
];
const boundaryQueries = [
  'парацетамол ребенку 5 лет 20 кг сироп внутрь при крупе',
  'парацетамол ребенку 5 лет 6 лет 20 кг 21 кг',
  'парацетамол без сиропа 20 кг',
  'парацетамол ребенку 5 лет 20 кг бронхиальная астма',
  'объем инфузии 80 кг',
];
const boundaryOpportunities = [];
for (const query of boundaryQueries) {
  const { analysis: raw } = analyzeClinicalQuery(query, []);
  const calculation = query.startsWith('объем')
    ? { kind: 'infusion-volume' as const }
    : {
        kind: 'medication-dose' as const,
        medicationCandidates: [
          { canonicalTerm: 'парацетамол', matchedText: 'парацетамол', matchType: 'exact' as const },
        ],
      };
  const analysis: QueryAnalysis = { ...raw, calculation };
  for (const mode of ['exact', 'fuzzy', 'ambiguous', 'missing', 'unsourced'] as const) {
    const altered: QueryAnalysis = {
      ...analysis,
      calculation:
        calculation.kind === 'infusion-volume'
          ? calculation
          : {
              ...calculation,
              medicationCandidates:
                mode === 'fuzzy'
                  ? calculation.medicationCandidates.map((c) => ({ ...c, matchType: 'fuzzy' }))
                  : mode === 'ambiguous'
                    ? [...calculation.medicationCandidates, ...calculation.medicationCandidates]
                    : calculation.medicationCandidates,
            },
    };
    const available =
      mode === 'missing'
        ? []
        : mode === 'unsourced'
          ? boundarySchemas.map((s) => ({ ...s, sources: [] }))
          : boundarySchemas;
    boundaryOpportunities.push({
      caseName: `${mode}:${query}`,
      analysis: altered,
      schemas: available,
      result: resolveCalculatorSuggestion(altered, available) ?? null,
    });
  }
}
const sourceFiles = [
  ...files,
  'apps/app/src/features/modules/catalog.shell.json',
  'apps/app/src/features/calculators/calculator-registry.ts',
  'apps/app/src/features/assessments/assessment-catalog.ts',
  'apps/app/src/features/search/calculator-suggestion.ts',
];
const output = {
  schemaVersion: 1,
  sources: sourceFiles.map((path) => ({
    path,
    sha256: createHash('sha256')
      .update(readFileSync(resolve(REPOSITORY_ROOT, path)))
      .digest('hex'),
  })),
  catalog,
  opportunities,
  boundaryOpportunities,
};
const path = resolve(
  REPOSITORY_ROOT,
  process.argv.find((arg) => arg.startsWith('--output='))?.slice(9) ??
    'native/shared/src/commonTest/resources/native-tool-discovery-golden.json',
);
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, `${JSON.stringify(output, null, 2)}\n`);
console.log(
  JSON.stringify({
    catalogQueries: catalog.length,
    opportunities: opportunities.length,
    offered: opportunities.filter((row) => row.result).length,
    boundaryOpportunities: boundaryOpportunities.length,
    output: path,
  }),
);
