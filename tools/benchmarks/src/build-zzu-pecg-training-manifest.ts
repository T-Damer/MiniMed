import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type EcgCsvRow,
  type EcgCsvTable,
  parseEcgCsv,
  requireEcgCsvCell,
  requireEcgCsvColumn,
} from './ecg-csv';
import {
  ECG_TRAINING_PROFILE,
  type EcgTrainingManifest,
  type EcgTrainingRecord,
  type EcgTrainingSex,
  type EcgTrainingSource,
  summarizeEcgTrainingManifest,
  validateEcgTrainingManifest,
} from './ecg-training-manifest';

const PROJECT_ROOT = resolve(import.meta.dirname, '../../..');
const ADULT_AGE_DAYS = 18 * 365;
const ZZU_SOURCE: EcgTrainingSource = {
  dataset: 'ZZU-pECG',
  revision: 'Figshare 27078763 v1',
  license: 'CC BY 4.0',
  rights: 'ZZU-pECG v1 (Figshare 27078763); retain CC BY 4.0 attribution and identify changes.',
};

export interface ZzuPecgExcludedCounts {
  readonly nineLead: number;
  readonly nonPediatric: number;
}

export interface ZzuPecgTrainingManifestBuild {
  readonly manifest: EcgTrainingManifest;
  readonly excludedCounts: ZzuPecgExcludedCounts;
}

function ageDays(table: EcgCsvTable, row: EcgCsvRow, index: number): number {
  const raw = requireEcgCsvCell(table, row, index, 'Age');
  const match = raw.match(/^(\d+)d$/u);
  const days = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  if (!match || !Number.isSafeInteger(days) || days < 0) {
    throw new Error(
      `${table.source} line ${row.line} has invalid Age ${JSON.stringify(raw)}; expected a value like 572d.`,
    );
  }
  return days;
}

function leadValue(table: EcgCsvTable, row: EcgCsvRow, index: number): 9 | 12 {
  const raw = requireEcgCsvCell(table, row, index, 'Lead');
  if (raw === '9' || /^9\.0+$/u.test(raw)) return 9;
  if (raw === '12' || /^12\.0+$/u.test(raw)) return 12;
  throw new Error(`${table.source} line ${row.line} has invalid Lead ${JSON.stringify(raw)}.`);
}

function genderValue(table: EcgCsvTable, row: EcgCsvRow, index: number): EcgTrainingSex {
  const raw = requireEcgCsvCell(table, row, index, 'Gender');
  return raw === 'Female' ? 'female' : raw === 'Male' ? 'male' : 'unknown';
}

function sourceCodes(
  table: EcgCsvTable,
  row: EcgCsvRow,
  index: number,
  prefix: string,
): readonly string[] {
  const raw = row.values[index]?.trim() ?? '';
  if (!raw) return [];
  return raw.split(';').flatMap((part) => {
    const token = part.trim();
    if (!token) return [];
    if (token.startsWith("'") || token.endsWith("'")) {
      if (!token.startsWith("'") || !token.endsWith("'")) {
        throw new Error(`${table.source} line ${row.line} has an unterminated ${prefix} code.`);
      }
      const unquoted = token.slice(1, -1).trim();
      return unquoted ? [`${prefix}${unquoted}`] : [];
    }
    return [`${prefix}${token}`];
  });
}

function sourceLabelCodes(
  table: EcgCsvTable,
  row: EcgCsvRow,
  columns: readonly [number, number, number],
): readonly string[] {
  const codes = [
    ...sourceCodes(table, row, columns[0], 'AHA:'),
    ...sourceCodes(table, row, columns[1], 'CHN:'),
    ...sourceCodes(table, row, columns[2], 'ICD10:'),
  ];
  const unique = [...new Set(codes)];
  if (unique.length === 0) {
    throw new Error(
      `${table.source} line ${row.line} must contain at least one source label code.`,
    );
  }
  return unique;
}

function splitForPatient(patientId: string): EcgTrainingRecord['split'] {
  const digest = createHash('sha256').update(`ZZU-pECG-v1:${patientId}`, 'utf8').digest();
  const bucket = Number(digest.readBigUInt64BE(0) % 10n);
  return bucket < 8 ? 'train' : bucket === 8 ? 'validation' : 'test';
}

export function buildZzuPecgTrainingManifest(attributesCsv: string): ZzuPecgTrainingManifestBuild {
  const table = parseEcgCsv(attributesCsv, 'AttributesDictionary.csv');
  const ecgColumn = requireEcgCsvColumn(table, ['ecg_id'], 'ECG_ID');
  const patientColumn = requireEcgCsvColumn(table, ['patient_id'], 'Patient_ID');
  const ageColumn = requireEcgCsvColumn(table, ['age'], 'Age');
  const genderColumn = requireEcgCsvColumn(table, ['gender'], 'Gender');
  const leadColumn = requireEcgCsvColumn(table, ['lead'], 'Lead');
  const ahaColumn = requireEcgCsvColumn(table, ['aha_code'], 'AHA_code');
  const chnColumn = requireEcgCsvColumn(table, ['chn_code'], 'CHN_code');
  const icdColumn = requireEcgCsvColumn(table, ['icd-10 code', 'icd_10 code'], 'ICD-10 code');
  const records: EcgTrainingRecord[] = [];
  const seenEcgIds = new Set<string>();
  const excludedCounts = { nineLead: 0, nonPediatric: 0 };

  for (const row of table.rows) {
    const ecgId = requireEcgCsvCell(table, row, ecgColumn, 'ECG_ID');
    if (seenEcgIds.has(ecgId)) {
      throw new Error(
        `${table.source} line ${row.line} duplicates ECG_ID ${JSON.stringify(ecgId)}.`,
      );
    }
    seenEcgIds.add(ecgId);
    const patientId = requireEcgCsvCell(table, row, patientColumn, 'Patient_ID');
    const age = ageDays(table, row, ageColumn);
    const gender = genderValue(table, row, genderColumn);
    const lead = leadValue(table, row, leadColumn);
    if (lead === 9) {
      excludedCounts.nineLead += 1;
      continue;
    }
    if (age >= ADULT_AGE_DAYS) {
      excludedCounts.nonPediatric += 1;
      continue;
    }
    records.push({
      id: `zzu-pecg:record:${ecgId}`,
      base_ecg_id: `zzu-pecg:base:${ecgId}`,
      patient_id: `zzu-pecg:patient:${patientId}`,
      source: ZZU_SOURCE,
      cohort: 'pediatric',
      age_days: age,
      sex: gender,
      input_kind: 'signal',
      profile: ECG_TRAINING_PROFILE,
      split: splitForPatient(patientId),
      ground_truth_labels: [],
      source_label_codes: sourceLabelCodes(table, row, [ahaColumn, chnColumn, icdColumn]),
    });
  }

  return {
    manifest: validateEcgTrainingManifest({ records }),
    excludedCounts,
  };
}

interface CliOptions {
  readonly attributes: string;
  readonly output: string;
}

function cliOptions(args: readonly string[]): CliOptions {
  const usage = 'Usage: build-zzu-pecg-training-manifest --attributes FILE --output FILE';
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag || !value || (flag !== '--attributes' && flag !== '--output')) {
      throw new Error(usage);
    }
    if (values.has(flag)) throw new Error(`Duplicate CLI flag ${flag}.`);
    values.set(flag, value);
  }
  const attributes = values.get('--attributes');
  const output = values.get('--output');
  if (!attributes || !output) throw new Error(usage);
  return { attributes, output };
}

function writeOutput(path: string, manifest: EcgTrainingManifest): void {
  const output = resolve(process.cwd(), path);
  const relativeToProject = relative(PROJECT_ROOT, output);
  const outsideRepository =
    relativeToProject === '..' ||
    relativeToProject.startsWith(`..${sep}`) ||
    isAbsolute(relativeToProject);
  if (!relativeToProject || !outsideRepository) {
    throw new Error('ZZU-pECG manifest output must be outside the repository.');
  }
  if (existsSync(output)) throw new Error(`Output already exists: ${output}`);
  const directory = dirname(output);
  mkdirSync(directory, { recursive: true });
  const stagingDirectory = mkdtempSync(resolve(directory, '.zzu-pecg-training-manifest-'));
  const staging = resolve(stagingDirectory, 'manifest.json');
  try {
    writeFileSync(staging, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    renameSync(staging, output);
  } catch (cause) {
    if (existsSync(staging)) unlinkSync(staging);
    throw cause;
  } finally {
    rmSync(stagingDirectory, { recursive: true, force: true });
  }
}

function runCli(): void {
  const options = cliOptions(process.argv.slice(2));
  const result = buildZzuPecgTrainingManifest(readFileSync(options.attributes, 'utf8'));
  const manifest = validateEcgTrainingManifest(result.manifest);
  writeOutput(options.output, manifest);
  process.stdout.write(
    `${JSON.stringify(
      { summary: summarizeEcgTrainingManifest(manifest), excludedCounts: result.excludedCounts },
      null,
      2,
    )}\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli();
