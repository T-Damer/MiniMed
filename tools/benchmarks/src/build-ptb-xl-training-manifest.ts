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
import { type EcgCsvTable, parseEcgCsv, requireEcgCsvCell, requireEcgCsvColumn } from './ecg-csv';
import { ECG_IMAGE_LABELS, type EcgImageLabel } from './ecg-image-dataset';
import {
  ECG_TRAINING_PROFILE,
  type EcgTrainingManifest,
  type EcgTrainingRecord,
  type EcgTrainingSource,
  summarizeEcgTrainingManifest,
  validateEcgTrainingManifest,
} from './ecg-training-manifest';

const PROJECT_ROOT = resolve(import.meta.dirname, '../../..');
const PTB_XL_SOURCE: EcgTrainingSource = {
  dataset: 'PTB-XL/PTB-XL+',
  revision: 'PTB-XL 1.0.3 + PTB-XL+ 1.0.1',
  license: 'CC BY 4.0',
  rights: 'PhysioNet PTB-XL 1.0.3 and PTB-XL+ 1.0.1; retain attribution and identify changes.',
};
const ACUTE_12SL_NUMBERS = new Set([
  '821',
  '822',
  '823',
  '827',
  '829',
  '902',
  '903',
  '904',
  '963',
  '964',
  '965',
  '966',
  '967',
  '968',
]);
const DIAGNOSTIC_CLASSES = new Set(['NORM', 'MI', 'STTC', 'CD', 'HYP']);
const DIRECT_LABEL_CODES = new Map<string, EcgImageLabel>([
  ['PAC', 'PAC'],
  ['PVC', 'PVC'],
  ['AFIB', 'AFIB/AFL'],
  ['AFLT', 'AFIB/AFL'],
  ['STACH', 'TACHY'],
  ['SVTAC', 'TACHY'],
  ['PSVT', 'TACHY'],
  ['SBRAD', 'BRADY'],
]);

export interface PtbXlExcludedCounts {
  readonly missingAge: number;
  readonly invalidAge: number;
  readonly pediatric: number;
  readonly unlabeled: number;
}

export interface PtbXlTrainingManifestBuild {
  readonly manifest: EcgTrainingManifest;
  readonly excludedCounts: PtbXlExcludedCounts;
}

interface ScpDefinition {
  readonly diagnostic: boolean;
  readonly diagnosticClass: string | null;
}

type PythonValue =
  | null
  | boolean
  | number
  | string
  | PythonValue[]
  | { readonly [key: string]: PythonValue };

function pythonError(path: string, raw: string, offset: number): Error {
  return new Error(`${path} has malformed Python-ish value at offset ${offset}: ${raw}`);
}

function parsePythonLiteral(raw: string, path: string): PythonValue {
  const input = raw.trim();
  if (!input) throw new Error(`${path} must not be empty.`);
  let index = 0;

  const fail = (): never => {
    throw pythonError(path, raw, index);
  };
  const skip = () => {
    while (/\s/u.test(input[index] ?? '')) index += 1;
  };
  const quoted = (): string => {
    const quote = input[index];
    if (quote !== "'" && quote !== '"') return fail();
    index += 1;
    let result = '';
    while (index < input.length) {
      const character = input[index];
      if (character === quote) {
        index += 1;
        return result;
      }
      if (character === '\\') {
        index += 1;
        const escaped = input[index];
        if (escaped === undefined) return fail();
        result +=
          escaped === 'n' ? '\n' : escaped === 'r' ? '\r' : escaped === 't' ? '\t' : escaped;
        index += 1;
      } else {
        result += character;
        index += 1;
      }
    }
    return fail();
  };
  const value = (): PythonValue => {
    skip();
    const character = input[index];
    if (character === "'" || character === '"') return quoted();
    if (character === '[' || character === '(' || character === '{') {
      const opening = character;
      index += 1;
      skip();
      if (opening === '{') {
        const result: Record<string, PythonValue> = {};
        if (input[index] === '}') {
          index += 1;
          return result;
        }
        while (index < input.length) {
          const key = value();
          skip();
          if (input[index] !== ':') return fail();
          index += 1;
          result[String(key)] = value();
          skip();
          if (input[index] === ',') {
            index += 1;
            skip();
            if (input[index] === '}') {
              index += 1;
              return result;
            }
            continue;
          }
          if (input[index] === '}') {
            index += 1;
            return result;
          }
          return fail();
        }
        return fail();
      }
      const result: PythonValue[] = [];
      const closing = opening === '[' ? ']' : ')';
      if (input[index] === closing) {
        index += 1;
        return result;
      }
      while (index < input.length) {
        result.push(value());
        skip();
        if (input[index] === ',') {
          index += 1;
          skip();
          if (input[index] === closing) {
            index += 1;
            return result;
          }
          continue;
        }
        if (input[index] === closing) {
          index += 1;
          return result;
        }
        return fail();
      }
      return fail();
    }
    const number = input.slice(index).match(/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/u)?.[0];
    if (number) {
      index += number.length;
      const parsed = Number(number);
      if (!Number.isFinite(parsed)) return fail();
      return parsed;
    }
    const name = input.slice(index).match(/^[A-Za-z_][A-Za-z_0-9]*/u)?.[0];
    if (name) {
      index += name.length;
      if (name === 'None') return null;
      if (name === 'True') return true;
      if (name === 'False') return false;
    }
    return fail();
  };

  const result = value();
  skip();
  if (index !== input.length) return fail();
  return result;
}

function parseScpCodes(raw: string, path: string): Readonly<Record<string, PythonValue>> {
  if (!raw.trim()) return {};
  const parsed = parsePythonLiteral(raw, path);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${path} must be a Python-ish dictionary.`);
  }
  return parsed;
}

function statementKey(value: PythonValue | string): string {
  if (typeof value === 'number' && Number.isInteger(value)) return String(value);
  const text = String(value).trim();
  if (/^\d+(?:\.0+)?$/u.test(text)) return String(Number(text));
  return text.toUpperCase();
}

function statementValues(parsed: PythonValue, path: string): readonly string[] {
  if (typeof parsed === 'string' || typeof parsed === 'number') return [statementKey(parsed)];
  if (Array.isArray(parsed)) {
    return parsed.flatMap((item, index) => statementValues(item, `${path}[${index}]`));
  }
  if (parsed !== null && typeof parsed === 'object') {
    return [
      ...Object.entries(parsed).flatMap(([key, item]) => [
        statementKey(key),
        ...statementValues(item, `${path}.${key}`),
      ]),
    ];
  }
  throw new Error(`${path} must contain statement ids or acronyms.`);
}

function parseScpDefinitions(table: EcgCsvTable): ReadonlyMap<string, ScpDefinition> {
  const nameColumn =
    table.headers[0] === ''
      ? 0
      : requireEcgCsvColumn(table, ['name', 'code', 'scp_code'], 'SCP name');
  const diagnosticColumn = requireEcgCsvColumn(table, ['diagnostic'], 'diagnostic');
  const classColumn = requireEcgCsvColumn(
    table,
    ['diagnostic_class', 'diagnostic class'],
    'diagnostic_class',
  );
  const definitions = new Map<string, ScpDefinition>();
  for (const row of table.rows) {
    const name = requireEcgCsvCell(table, row, nameColumn, 'SCP name').toUpperCase();
    if (definitions.has(name))
      throw new Error(`${table.source} line ${row.line} duplicates SCP ${name}.`);
    const diagnosticRaw = row.values[diagnosticColumn]?.trim() ?? '';
    const diagnostic =
      diagnosticRaw === ''
        ? false
        : /^1(?:\.0+)?$/u.test(diagnosticRaw)
          ? true
          : /^0(?:\.0+)?$/u.test(diagnosticRaw)
            ? false
            : (() => {
                throw new Error(`${table.source} line ${row.line} has invalid diagnostic flag.`);
              })();
    const diagnosticClass = row.values[classColumn]?.trim();
    definitions.set(name, {
      diagnostic,
      diagnosticClass: diagnosticClass ? diagnosticClass.toUpperCase() : null,
    });
  }
  return definitions;
}

function parseMapping(table: EcgCsvTable): ReadonlySet<string> {
  const numberColumn = requireEcgCsvColumn(
    table,
    ['statementnumber', 'statement_number', 'statement_id', 'number', 'id', 'code', '12sl_code'],
    '12SL statement number',
  );
  const acronymColumn = requireEcgCsvColumn(
    table,
    ['acronym', 'acronym_code', 'statement', 'name', 'label', '12sl_statement'],
    '12SL acronym',
  );
  const acute = new Set<string>(ACUTE_12SL_NUMBERS);
  const seen = new Set<string>();
  for (const row of table.rows) {
    const rawNumber = row.values[numberColumn]?.trim();
    if (!rawNumber) continue;
    const number = statementKey(rawNumber);
    if (!/^\d+$/u.test(number)) {
      throw new Error(`${table.source} line ${row.line} has an invalid statement id ${number}.`);
    }
    if (seen.has(number))
      throw new Error(`${table.source} line ${row.line} duplicates statement ${number}.`);
    seen.add(number);
    if (ACUTE_12SL_NUMBERS.has(number)) {
      acute.add(statementKey(requireEcgCsvCell(table, row, acronymColumn, '12SL acronym')));
    }
  }
  return acute;
}

function parseTwelveSlStatements(table: EcgCsvTable): ReadonlyMap<string, ReadonlySet<string>> {
  const ecgColumn = requireEcgCsvColumn(table, ['ecg_id', 'ecg'], 'ECG id');
  const statementsColumn = requireEcgCsvColumn(
    table,
    ['statements', 'statements_12sl', '12sl_statements', 'statement_ids', 'statement', 'codes'],
    '12SL statements',
  );
  const statements = new Map<string, ReadonlySet<string>>();
  for (const row of table.rows) {
    const ecgId = numericId(
      requireEcgCsvCell(table, row, ecgColumn, 'ECG id'),
      `${table.source} line ${row.line} ecg_id`,
    );
    if (statements.has(ecgId))
      throw new Error(`${table.source} line ${row.line} duplicates ECG ${ecgId}.`);
    const raw = row.values[statementsColumn]?.trim() ?? '';
    const values = raw
      ? statementValues(
          parsePythonLiteral(raw, `${table.source} line ${row.line} statements`),
          `${table.source} line ${row.line} statements`,
        )
      : [];
    statements.set(ecgId, new Set(values));
  }
  return statements;
}

function numericId(raw: string, path: string): string {
  const value = raw.trim();
  if (!/^\d+(?:\.0+)?$/u.test(value))
    throw new Error(`${path} has an invalid id ${JSON.stringify(raw)}.`);
  return value.replace(/\.0+$/u, '').replace(/^0+(?=\d)/u, '');
}

function ageValue(raw: string): number | null | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  const age = Number(value);
  if (!Number.isFinite(age) || age < 0) return null;
  return age;
}

function foldValue(raw: string, path: string): number {
  const value = raw.trim();
  if (!/^\d+$/u.test(value)) throw new Error(`${path} has an invalid strat_fold.`);
  const fold = Number(value);
  if (fold < 1 || fold > 10) throw new Error(`${path} has an invalid strat_fold ${value}.`);
  return fold;
}

function labelsFor(
  codes: Readonly<Record<string, PythonValue>>,
  definitions: ReadonlyMap<string, ScpDefinition>,
  twelveSl: ReadonlySet<string> | undefined,
  acuteIdentifiers: ReadonlySet<string>,
): readonly EcgImageLabel[] {
  const labels = new Set<EcgImageLabel>();
  let hasMi = false;
  for (const code of Object.keys(codes)) {
    const normalized = code.toUpperCase();
    const definition = definitions.get(normalized);
    if (
      definition?.diagnostic &&
      definition.diagnosticClass &&
      DIAGNOSTIC_CLASSES.has(definition.diagnosticClass)
    ) {
      if (definition.diagnosticClass === 'MI') hasMi = true;
      else labels.add(definition.diagnosticClass as EcgImageLabel);
    }
    const direct = DIRECT_LABEL_CODES.get(normalized);
    if (direct) labels.add(direct);
  }
  const acute = [...(twelveSl ?? [])].some((statement) => acuteIdentifiers.has(statement));
  if (hasMi) labels.add(acute ? 'Acute MI' : 'Old MI');
  if (acute) labels.add('Acute MI');
  return ECG_IMAGE_LABELS.filter((label) => labels.has(label));
}

function splitForFold(fold: number): EcgTrainingRecord['split'] {
  return fold === 9 ? 'validation' : fold === 10 ? 'test' : 'train';
}

export function buildPtbXlTrainingManifest(
  ptbxlDatabaseCsv: string,
  scpStatementsCsv: string,
  twelveSlStatementsCsv: string,
  twelveSlMappingCsv: string,
): PtbXlTrainingManifestBuild {
  const database = parseEcgCsv(ptbxlDatabaseCsv, 'ptbxl_database.csv');
  const scpDefinitions = parseScpDefinitions(parseEcgCsv(scpStatementsCsv, 'scp_statements.csv'));
  const twelveSlStatements = parseTwelveSlStatements(
    parseEcgCsv(twelveSlStatementsCsv, '12sl_statements.csv'),
  );
  const acuteIdentifiers = parseMapping(parseEcgCsv(twelveSlMappingCsv, '12sl_mapping.csv'));
  const ecgColumn = requireEcgCsvColumn(database, ['ecg_id'], 'ecg_id');
  const patientColumn = requireEcgCsvColumn(database, ['patient_id', 'group_id'], 'patient_id');
  const ageColumn = requireEcgCsvColumn(database, ['age'], 'age');
  const sexColumn = requireEcgCsvColumn(database, ['sex'], 'sex');
  const codesColumn = requireEcgCsvColumn(database, ['scp_codes', 'scp codes'], 'scp_codes');
  const foldColumn = requireEcgCsvColumn(database, ['strat_fold', 'fold'], 'strat_fold');
  const records: EcgTrainingRecord[] = [];
  const seenEcgIds = new Set<string>();
  const excludedCounts = { missingAge: 0, invalidAge: 0, pediatric: 0, unlabeled: 0 };

  for (const row of database.rows) {
    const ecgId = numericId(
      requireEcgCsvCell(database, row, ecgColumn, 'ecg_id'),
      `ptbxl_database.csv line ${row.line} ecg_id`,
    );
    if (seenEcgIds.has(ecgId)) {
      throw new Error(`ptbxl_database.csv line ${row.line} duplicates metadata ecg_id ${ecgId}.`);
    }
    seenEcgIds.add(ecgId);
    const patientId = numericId(
      requireEcgCsvCell(database, row, patientColumn, 'patient_id'),
      `ptbxl_database.csv line ${row.line} patient_id`,
    );
    const fold = foldValue(
      requireEcgCsvCell(database, row, foldColumn, 'strat_fold'),
      `ptbxl_database.csv line ${row.line} strat_fold`,
    );
    const codes = parseScpCodes(
      row.values[codesColumn]?.trim() ?? '',
      `ptbxl_database.csv line ${row.line} scp_codes`,
    );
    const labels = labelsFor(
      codes,
      scpDefinitions,
      twelveSlStatements.get(ecgId),
      acuteIdentifiers,
    );
    const age = ageValue(row.values[ageColumn] ?? '');
    if (age === undefined) {
      excludedCounts.missingAge += 1;
      continue;
    }
    if (age === null || age < 18) {
      if (age === null) excludedCounts.invalidAge += 1;
      else excludedCounts.pediatric += 1;
      continue;
    }
    if (labels.length === 0) {
      excludedCounts.unlabeled += 1;
      continue;
    }
    const sexRaw = row.values[sexColumn]?.trim();
    const sex = sexRaw === '0' ? 'male' : sexRaw === '1' ? 'female' : 'unknown';
    records.push({
      id: `ptb-xl:record:${ecgId}`,
      base_ecg_id: `ptb-xl:base:${ecgId}`,
      patient_id: `ptb-xl:patient:${patientId}`,
      source: PTB_XL_SOURCE,
      cohort: 'adult',
      sex,
      input_kind: 'signal',
      profile: ECG_TRAINING_PROFILE,
      split: splitForFold(fold),
      ground_truth_labels: labels,
    });
  }

  const manifest = validateEcgTrainingManifest({ records });
  return { manifest, excludedCounts };
}

interface CliOptions {
  readonly ptbxlDatabase: string;
  readonly scpStatements: string;
  readonly twelveSlStatements: string;
  readonly twelveSlMapping: string;
  readonly output: string;
}

function cliOptions(args: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      !flag ||
      !value ||
      ![
        '--ptbxl-database',
        '--scp-statements',
        '--12sl-statements',
        '--12sl-mapping',
        '--output',
      ].includes(flag)
    ) {
      throw new Error(
        'Usage: build-ptb-xl-training-manifest --ptbxl-database FILE --scp-statements FILE --12sl-statements FILE --12sl-mapping FILE --output FILE',
      );
    }
    if (values.has(flag)) throw new Error(`Duplicate CLI flag ${flag}.`);
    values.set(flag, value);
  }
  const get = (flag: string): string => {
    const value = values.get(flag);
    if (!value) throw new Error(`Missing required CLI flag ${flag}.`);
    return value;
  };
  return {
    ptbxlDatabase: get('--ptbxl-database'),
    scpStatements: get('--scp-statements'),
    twelveSlStatements: get('--12sl-statements'),
    twelveSlMapping: get('--12sl-mapping'),
    output: get('--output'),
  };
}

function writeOutput(path: string, manifest: EcgTrainingManifest): void {
  const output = resolve(process.cwd(), path);
  const relativeToProject = relative(PROJECT_ROOT, output);
  const outsideRepository =
    relativeToProject === '..' ||
    relativeToProject.startsWith(`..${sep}`) ||
    isAbsolute(relativeToProject);
  if (!relativeToProject || !outsideRepository) {
    throw new Error('PTB-XL manifest output must be outside the repository.');
  }
  if (existsSync(output)) throw new Error(`Output already exists: ${output}`);
  const directory = dirname(output);
  mkdirSync(directory, { recursive: true });
  const stagingDirectory = mkdtempSync(resolve(directory, '.ecg-training-manifest-'));
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
  const result = buildPtbXlTrainingManifest(
    readFileSync(options.ptbxlDatabase, 'utf8'),
    readFileSync(options.scpStatements, 'utf8'),
    readFileSync(options.twelveSlStatements, 'utf8'),
    readFileSync(options.twelveSlMapping, 'utf8'),
  );
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
