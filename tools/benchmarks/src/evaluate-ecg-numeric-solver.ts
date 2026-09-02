import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import {
  ECG_NUMERIC_FEATURES,
  type EcgDiagnosticEstimate,
  type EcgNumericDiagnosticPack,
  inferEcgNumericDiagnostic,
  parseEcgNumericDiagnosticPack,
} from '../../../apps/app/src/features/calculators/ecg-numeric-inference';
import { parseEcgCsv, requireEcgCsvCell, requireEcgCsvColumn } from './ecg-csv';

const CLASS_IDS = ['NORM', 'MI', 'STTC', 'CD', 'HYP'] as const;
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
type ClassId = (typeof CLASS_IDS)[number];

export interface EcgNumericCaseResult {
  readonly actual: boolean;
  readonly estimate: EcgDiagnosticEstimate;
}

export interface EcgNumericClassMetrics {
  readonly positives: number;
  readonly negatives: number;
  readonly true_positive: number;
  readonly true_negative: number;
  readonly false_positive: number;
  readonly false_negative: number;
  readonly uncertain_positive: number;
  readonly uncertain_negative: number;
  readonly coverage: number;
  readonly positive_coverage: number;
  readonly negative_coverage: number;
  readonly sensitivity_answered: number;
  readonly specificity_answered: number;
  readonly precision_answered: number;
  readonly negative_predictive_value_answered: number;
  readonly f1_answered: number;
  readonly sensitivity_all: number;
  readonly specificity_all: number;
  readonly f1_all: number;
  readonly confident_false_negative_rate: number;
  readonly auc: number;
  readonly brier: number;
  readonly ece_10_bin: number;
}

interface AdultFoldCase {
  readonly labels: ReadonlySet<ClassId>;
}

interface EvaluatedCohort {
  readonly accepted: number;
  readonly cases: number;
  readonly featureRowsFound: number;
  readonly missingFeatureRows: number;
  readonly rejectedMissingFeature: number;
  readonly rejectedOutOfRange: number;
  readonly results: ReadonlyMap<ClassId, readonly EcgNumericCaseResult[]>;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? Number.NaN : numerator / denominator;
}

function mean(values: readonly number[]): number {
  const finite = values.filter(Number.isFinite);
  return finite.length === 0
    ? Number.NaN
    : finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function auc(results: readonly EcgNumericCaseResult[]): number {
  const sorted = [...results].sort(
    (left, right) => left.estimate.probability - right.estimate.probability,
  );
  const positives = sorted.filter((result) => result.actual).length;
  const negatives = sorted.length - positives;
  if (positives === 0 || negatives === 0) return Number.NaN;
  let rankSum = 0;
  for (let start = 0; start < sorted.length; ) {
    let end = start + 1;
    while (
      end < sorted.length &&
      sorted[end]?.estimate.probability === sorted[start]?.estimate.probability
    ) {
      end += 1;
    }
    const averageRank = (start + 1 + end) / 2;
    for (let index = start; index < end; index += 1) {
      if (sorted[index]?.actual) rankSum += averageRank;
    }
    start = end;
  }
  return (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

export function scoreEcgNumericClass(
  results: readonly EcgNumericCaseResult[],
): EcgNumericClassMetrics {
  let truePositive = 0;
  let trueNegative = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let uncertainPositive = 0;
  let uncertainNegative = 0;
  let thresholdTruePositive = 0;
  let thresholdTrueNegative = 0;
  let thresholdFalsePositive = 0;
  let thresholdFalseNegative = 0;
  let brierSum = 0;
  const bins = Array.from({ length: 10 }, () => ({ count: 0, probability: 0, actual: 0 }));
  for (const result of results) {
    const { actual, estimate } = result;
    if (estimate.probability >= estimate.threshold) {
      if (actual) thresholdTruePositive += 1;
      else thresholdFalsePositive += 1;
    } else if (actual) thresholdFalseNegative += 1;
    else thresholdTrueNegative += 1;
    if (estimate.status === 'uncertain') {
      if (actual) uncertainPositive += 1;
      else uncertainNegative += 1;
    } else if (estimate.status === 'positive') {
      if (actual) truePositive += 1;
      else falsePositive += 1;
    } else if (actual) falseNegative += 1;
    else trueNegative += 1;
    brierSum += (estimate.probability - Number(actual)) ** 2;
    const bin = bins[Math.min(9, Math.floor(estimate.probability * 10))];
    if (!bin) throw new Error('Internal ECE bin error.');
    bin.count += 1;
    bin.probability += estimate.probability;
    bin.actual += Number(actual);
  }
  const positives = truePositive + falseNegative + uncertainPositive;
  const negatives = trueNegative + falsePositive + uncertainNegative;
  const answered = truePositive + trueNegative + falsePositive + falseNegative;
  const ece = bins.reduce(
    (sum, bin) =>
      bin.count === 0
        ? sum
        : sum +
          (bin.count / results.length) *
            Math.abs(bin.probability / bin.count - bin.actual / bin.count),
    0,
  );
  return {
    positives,
    negatives,
    true_positive: truePositive,
    true_negative: trueNegative,
    false_positive: falsePositive,
    false_negative: falseNegative,
    uncertain_positive: uncertainPositive,
    uncertain_negative: uncertainNegative,
    coverage: ratio(answered, results.length),
    positive_coverage: ratio(truePositive + falseNegative, positives),
    negative_coverage: ratio(trueNegative + falsePositive, negatives),
    sensitivity_answered: ratio(truePositive, truePositive + falseNegative),
    specificity_answered: ratio(trueNegative, trueNegative + falsePositive),
    precision_answered: ratio(truePositive, truePositive + falsePositive),
    negative_predictive_value_answered: ratio(trueNegative, trueNegative + falseNegative),
    f1_answered: ratio(2 * truePositive, 2 * truePositive + falsePositive + falseNegative),
    sensitivity_all: ratio(thresholdTruePositive, thresholdTruePositive + thresholdFalseNegative),
    specificity_all: ratio(thresholdTrueNegative, thresholdTrueNegative + thresholdFalsePositive),
    f1_all: ratio(
      2 * thresholdTruePositive,
      2 * thresholdTruePositive + thresholdFalsePositive + thresholdFalseNegative,
    ),
    confident_false_negative_rate: ratio(falseNegative, positives),
    auc: auc(results),
    brier: ratio(brierSum, results.length),
    ece_10_bin: ece,
  };
}

function parseCsvLine(line: string, source: string, lineNumber: number): readonly string[] {
  const values: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      values.push(value);
      value = '';
    } else value += character;
  }
  if (quoted) throw new Error(`${source} line ${lineNumber} has an unterminated quoted field.`);
  values.push(value);
  return values;
}

function parseScpCodes(value: string, source: string): readonly string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    throw new Error(`${source} has an invalid scp_codes mapping.`);
  }
  const content = trimmed.slice(1, -1);
  if (!content.trim()) return [];
  const codes: string[] = [];
  const pair = /\s*(?:,\s*)?'([^']+)'\s*:\s*(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*/giy;
  let position = 0;
  while (position < content.length) {
    pair.lastIndex = position;
    const match = pair.exec(content);
    if (!match || match.index !== position) {
      throw new Error(`${source} has an unsupported scp_codes mapping.`);
    }
    const code = match[1];
    const probability = Number(match[2]);
    if (!code || !Number.isFinite(probability)) {
      throw new Error(`${source} has an invalid scp_codes entry.`);
    }
    if (probability > 0) codes.push(code);
    position = pair.lastIndex;
  }
  return codes;
}

function diagnosticCodeMap(path: string): ReadonlyMap<string, ClassId> {
  const table = parseEcgCsv(readFileSync(path, 'utf8'), basename(path));
  const diagnosticIndex = requireEcgCsvColumn(table, ['diagnostic'], 'diagnostic');
  const classIndex = requireEcgCsvColumn(table, ['diagnostic_class'], 'diagnostic_class');
  const result = new Map<string, ClassId>();
  for (const row of table.rows) {
    if (Number(row.values[diagnosticIndex]) !== 1) continue;
    const classId = row.values[classIndex]?.trim() as ClassId | undefined;
    const code = row.values[0]?.trim();
    if (code && classId && CLASS_IDS.includes(classId)) result.set(code, classId);
  }
  return result;
}

function adultFoldCases(
  metadataPath: string,
  statementPath: string,
  targetFold: 9 | 10,
): ReadonlyMap<string, AdultFoldCase> {
  const codeMap = diagnosticCodeMap(statementPath);
  const table = parseEcgCsv(readFileSync(metadataPath, 'utf8'), basename(metadataPath));
  const idIndex = requireEcgCsvColumn(table, ['ecg_id'], 'ecg_id');
  const ageIndex = requireEcgCsvColumn(table, ['age'], 'age');
  const foldIndex = requireEcgCsvColumn(table, ['strat_fold'], 'strat_fold');
  const codesIndex = requireEcgCsvColumn(table, ['scp_codes'], 'scp_codes');
  const result = new Map<string, AdultFoldCase>();
  for (const row of table.rows) {
    const age = Number(row.values[ageIndex]);
    const fold = Number(row.values[foldIndex]);
    if (!Number.isFinite(age) || age < 18 || age > 120 || fold !== targetFold) continue;
    const id = requireEcgCsvCell(table, row, idIndex, 'ecg_id');
    if (result.has(id)) throw new Error(`${basename(metadataPath)} has duplicate ecg_id ${id}.`);
    const codes = parseScpCodes(
      requireEcgCsvCell(table, row, codesIndex, 'scp_codes'),
      `${basename(metadataPath)} line ${row.line}`,
    );
    result.set(id, {
      labels: new Set(codes.map((code) => codeMap.get(code)).filter((id): id is ClassId => !!id)),
    });
  }
  return result;
}

async function evaluateCohort(
  pack: EcgNumericDiagnosticPack,
  cases: ReadonlyMap<string, AdultFoldCase>,
  featuresPath: string,
): Promise<EvaluatedCohort> {
  const results = new Map<ClassId, EcgNumericCaseResult[]>(CLASS_IDS.map((id) => [id, []]));
  const seen = new Set<string>();
  let rejectedMissingFeature = 0;
  let rejectedOutOfRange = 0;
  let accepted = 0;
  let header: readonly string[] | null = null;
  let idIndex = -1;
  let featureIndices: readonly number[] = [];
  let lineNumber = 0;
  const lines = createInterface({
    input: createReadStream(featuresPath),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  for await (const line of lines) {
    lineNumber += 1;
    const values = parseCsvLine(line, basename(featuresPath), lineNumber);
    if (!header) {
      header = values.map((value) => value.trim());
      idIndex = header.indexOf('ecg_id');
      featureIndices = ECG_NUMERIC_FEATURES.map((feature) => header?.indexOf(feature.id) ?? -1);
      if (idIndex < 0 || featureIndices.some((index) => index < 0)) {
        throw new Error(
          `${basename(featuresPath)} is missing ecg_id or a required numeric feature.`,
        );
      }
      continue;
    }
    if (values.length !== header.length) {
      throw new Error(
        `${basename(featuresPath)} line ${lineNumber} has ${values.length} fields; expected ${header.length}.`,
      );
    }
    const id = values[idIndex]?.trim();
    if (!id || !cases.has(id)) continue;
    if (seen.has(id)) throw new Error(`${basename(featuresPath)} has duplicate ecg_id ${id}.`);
    seen.add(id);
    const row = featureIndices.map((index) => Number(values[index]));
    if (
      row.some(
        (value, index) => !values[featureIndices[index] ?? -1]?.trim() || !Number.isFinite(value),
      )
    ) {
      rejectedMissingFeature += 1;
      continue;
    }
    if (
      row.some((value, index) => {
        const feature = ECG_NUMERIC_FEATURES[index];
        return !feature || value < feature.min || value > feature.max;
      })
    ) {
      rejectedOutOfRange += 1;
      continue;
    }
    const testCase = cases.get(id);
    if (!testCase) continue;
    const estimates = inferEcgNumericDiagnostic(pack.classes, pack.models, row);
    for (const estimate of estimates) {
      results.get(estimate.id)?.push({ actual: testCase.labels.has(estimate.id), estimate });
    }
    accepted += 1;
  }
  if (!header) throw new Error(`${basename(featuresPath)} is empty.`);
  if (accepted === 0) throw new Error('No eligible complete adult ECG records were evaluated.');
  return {
    accepted,
    cases: cases.size,
    featureRowsFound: seen.size,
    missingFeatureRows: cases.size - seen.size,
    rejectedMissingFeature,
    rejectedOutOfRange,
    results,
  };
}

export function selectEcgSafetyNegativeCutoff(
  results: readonly EcgNumericCaseResult[],
  maximumConfidentFalseNegativeRate = 0.05,
): number {
  if (
    !Number.isFinite(maximumConfidentFalseNegativeRate) ||
    maximumConfidentFalseNegativeRate < 0 ||
    maximumConfidentFalseNegativeRate >= 1
  ) {
    throw new Error('Maximum confident false-negative rate must be in [0, 1).');
  }
  const positives = results
    .filter((result) => result.actual)
    .map((result) => result.estimate.probability)
    .sort((left, right) => left - right);
  if (positives.length === 0) throw new Error('Safety cutoff requires positive validation cases.');
  const allowedFalseNegatives = Math.floor(maximumConfidentFalseNegativeRate * positives.length);
  let cutoff = 0;
  for (let index = 0; index < positives.length; ) {
    const probability = positives[index];
    if (probability === undefined) throw new Error('Unable to select safety cutoff.');
    let tiedEnd = index + 1;
    while (positives[tiedEnd] === probability) tiedEnd += 1;
    if (tiedEnd > allowedFalseNegatives) break;
    cutoff = probability;
    index = tiedEnd;
  }
  return cutoff;
}

function applyEcgSafetyPolicy(
  results: readonly EcgNumericCaseResult[],
  negativeCutoff: number,
  positiveCutoff: number,
): readonly EcgNumericCaseResult[] {
  return results.map(({ actual, estimate }) => ({
    actual,
    estimate: {
      ...estimate,
      status:
        estimate.probability <= negativeCutoff
          ? 'negative'
          : estimate.probability >= positiveCutoff
            ? 'positive'
            : 'uncertain',
    },
  }));
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export interface EvaluationOptions {
  readonly model: string;
  readonly features: string;
  readonly metadata: string;
  readonly statements: string;
  readonly output: string;
}

export async function evaluateEcgNumericSolver(options: EvaluationOptions) {
  const modelPath = resolve(options.model);
  const featuresPath = resolve(options.features);
  const metadataPath = resolve(options.metadata);
  const statementsPath = resolve(options.statements);
  const pack = parseEcgNumericDiagnosticPack(readFileSync(modelPath));
  const validationCases = adultFoldCases(metadataPath, statementsPath, 9);
  const testCases = adultFoldCases(metadataPath, statementsPath, 10);
  const [validation, test] = await Promise.all([
    evaluateCohort(pack, validationCases, featuresPath),
    evaluateCohort(pack, testCases, featuresPath),
  ]);
  const perClass = Object.fromEntries(
    pack.classes.map((classConfig) => {
      const classResults = test.results.get(classConfig.id) ?? [];
      return [
        classConfig.id,
        {
          threshold: classConfig.threshold,
          negative_threshold: classConfig.negativeThreshold,
          positive_threshold: classConfig.positiveThreshold,
          ...scoreEcgNumericClass(classResults),
        },
      ];
    }),
  ) as Record<
    ClassId,
    EcgNumericClassMetrics & {
      readonly threshold: number;
      readonly negative_threshold: number;
      readonly positive_threshold: number;
    }
  >;
  const metrics = Object.values(perClass);
  const pathologyMetrics = CLASS_IDS.slice(1).map((id) => perClass[id]);
  const pathologyConfidentFalseNegatives = pathologyMetrics.reduce(
    (sum, metric) => sum + metric.false_negative,
    0,
  );
  const pathologyPositives = pathologyMetrics.reduce((sum, metric) => sum + metric.positives, 0);
  const macro = {
    auc: mean(metrics.map((metric) => metric.auc)),
    brier: mean(metrics.map((metric) => metric.brier)),
    ece_10_bin: mean(metrics.map((metric) => metric.ece_10_bin)),
    f1_all: mean(metrics.map((metric) => metric.f1_all)),
    f1_answered: mean(metrics.map((metric) => metric.f1_answered)),
    sensitivity_all: mean(metrics.map((metric) => metric.sensitivity_all)),
    sensitivity_answered: mean(metrics.map((metric) => metric.sensitivity_answered)),
    specificity_all: mean(metrics.map((metric) => metric.specificity_all)),
    specificity_answered: mean(metrics.map((metric) => metric.specificity_answered)),
    coverage: mean(metrics.map((metric) => metric.coverage)),
    pathology_confident_false_negative_count: pathologyConfidentFalseNegatives,
    pathology_confident_false_negative_rate: ratio(
      pathologyConfidentFalseNegatives,
      pathologyPositives,
    ),
  };
  const maximumValidationConfidentFalseNegativeRate = 0.05;
  const safetyPolicy = Object.fromEntries(
    pack.classes.slice(1).map((classConfig) => {
      const validationResults = validation.results.get(classConfig.id) ?? [];
      const testResults = test.results.get(classConfig.id) ?? [];
      const negativeCutoff = selectEcgSafetyNegativeCutoff(
        validationResults,
        maximumValidationConfidentFalseNegativeRate,
      );
      const positiveCutoff = classConfig.positiveThreshold;
      return [
        classConfig.id,
        {
          negative_cutoff: negativeCutoff,
          positive_cutoff: positiveCutoff,
          validation: scoreEcgNumericClass(
            applyEcgSafetyPolicy(validationResults, negativeCutoff, positiveCutoff),
          ),
          test: scoreEcgNumericClass(
            applyEcgSafetyPolicy(testResults, negativeCutoff, positiveCutoff),
          ),
        },
      ];
    }),
  ) as Record<
    Exclude<ClassId, 'NORM'>,
    {
      readonly negative_cutoff: number;
      readonly positive_cutoff: number;
      readonly validation: EcgNumericClassMetrics;
      readonly test: EcgNumericClassMetrics;
    }
  >;
  const summarizeSafetyPolicy = (split: 'test' | 'validation') => {
    const values = Object.values(safetyPolicy).map((entry) => entry[split]);
    const confidentFalseNegatives = values.reduce((sum, metric) => sum + metric.false_negative, 0);
    const positives = values.reduce((sum, metric) => sum + metric.positives, 0);
    return {
      macro_coverage: mean(values.map((metric) => metric.coverage)),
      macro_f1_answered: mean(values.map((metric) => metric.f1_answered)),
      confident_false_negative_count: confidentFalseNegatives,
      positive_count: positives,
      confident_false_negative_rate: ratio(confidentFalseNegatives, positives),
    };
  };
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    model_version: pack.version,
    cohort: {
      source: 'PTB-XL 1.0.3 / PTB-XL+ 1.0.1',
      split: 'strat_fold=10',
      population: 'adult 18-120 years',
      metadata_cases: test.cases,
      feature_rows_found: test.featureRowsFound,
      accepted_complete_in_range: test.accepted,
      rejected_missing_feature: test.rejectedMissingFeature,
      rejected_out_of_range: test.rejectedOutOfRange,
      missing_feature_row: test.missingFeatureRows,
    },
    inputs: {
      model: { file: basename(modelPath), sha256: sha256(modelPath) },
      features: { file: basename(featuresPath), sha256: sha256(featuresPath) },
      metadata: { file: basename(metadataPath), sha256: sha256(metadataPath) },
      statements: { file: basename(statementsPath), sha256: sha256(statementsPath) },
    },
    macro,
    per_class: perClass,
    validation_selected_safety_policy: {
      selection_split: 'strat_fold=9',
      evaluation_split: 'strat_fold=10',
      maximum_validation_confident_false_negative_rate: maximumValidationConfidentFalseNegativeRate,
      validation_cohort: {
        metadata_cases: validation.cases,
        accepted_complete_in_range: validation.accepted,
        rejected_missing_feature: validation.rejectedMissingFeature,
        rejected_out_of_range: validation.rejectedOutOfRange,
        missing_feature_row: validation.missingFeatureRows,
      },
      validation_summary: summarizeSafetyPolicy('validation'),
      test_summary: summarizeSafetyPolicy('test'),
      per_class: safetyPolicy,
    },
  };
}

function cliOptions(args: readonly string[]): EvaluationOptions {
  const allowed = new Set(['--model', '--features', '--metadata', '--statements', '--output']);
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag || !allowed.has(flag) || !value || value.startsWith('--') || values.has(flag)) {
      throw new Error(
        'Usage: --model FILE --features FILE --metadata FILE --statements FILE --output FILE',
      );
    }
    values.set(flag, value);
  }
  const model = values.get('--model');
  const features = values.get('--features');
  const metadata = values.get('--metadata');
  const statements = values.get('--statements');
  const output = values.get('--output');
  if (!model || !features || !metadata || !statements || !output) {
    throw new Error(
      'Usage: --model FILE --features FILE --metadata FILE --statements FILE --output FILE',
    );
  }
  return { model, features, metadata, statements, output };
}

function externalOutput(path: string): string {
  const target = resolve(path);
  const fromRepository = relative(REPOSITORY_ROOT, target);
  if (fromRepository === '' || (fromRepository !== '..' && !fromRepository.startsWith('../'))) {
    throw new Error('Numeric ECG evaluation output must be outside the repository.');
  }
  if (existsSync(target)) throw new Error(`Output already exists: ${target}`);
  return target;
}

export async function runEcgNumericSolverEvaluator(args = process.argv.slice(2)): Promise<number> {
  let temporaryOutput: string | null = null;
  try {
    const options = cliOptions(args);
    const output = externalOutput(options.output);
    const report = await evaluateEcgNumericSolver(options);
    temporaryOutput = resolve(dirname(output), `.${basename(output)}.${process.pid}.tmp`);
    writeFileSync(temporaryOutput, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    renameSync(temporaryOutput, output);
    temporaryOutput = null;
    process.stdout.write(`${JSON.stringify({ output, macro: report.macro }, null, 2)}\n`);
    return 0;
  } catch (cause) {
    if (temporaryOutput && existsSync(temporaryOutput)) unlinkSync(temporaryOutput);
    process.stderr.write(
      `ECG numeric Solver evaluation failed: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runEcgNumericSolverEvaluator();
}
