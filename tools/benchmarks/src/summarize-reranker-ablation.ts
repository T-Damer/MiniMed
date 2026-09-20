import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const args = process.argv.slice(2);
const option = (key: string): string | undefined =>
  args.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);

for (const arg of args) {
  if (!/^--(?:linear|embedding|report)=.+/u.test(arg)) {
    throw new Error(`Unknown argument ${arg}`);
  }
}

const projectPath = (value: string | undefined, fallback: string): string =>
  resolve(root, value ?? fallback);
const linearPath = projectPath(
  option('linear'),
  'data/build/search-quality-linear-reranker-report.json',
);
const embeddingPath = projectPath(
  option('embedding'),
  'data/build/search-quality-frozen-embedding-report.json',
);
const reportPath = projectPath(
  option('report'),
  'data/build/search-quality-reranker-ablation-summary.json',
);

for (const path of [linearPath, embeddingPath]) {
  if (!existsSync(path)) throw new Error(`Reranker report does not exist: ${path}`);
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function numberValue(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function readJson(path: string): Record<string, unknown> {
  return objectValue(JSON.parse(readFileSync(path, 'utf8')) as unknown, path);
}

interface ComparisonRow {
  readonly fixtureId: string;
  readonly family: string | null;
  readonly goal: string | null;
  readonly originalTop1Grade: number;
  readonly modelTop1Grade: number;
  readonly maximumAvailableGrade: number;
  readonly originalTop1DocumentId: string | null;
  readonly modelTop1DocumentId: string | null;
}

function nullableString(value: unknown): string | null {
  return value === null ? null : stringValue(value, 'nullable string');
}

function comparisonRows(
  report: Record<string, unknown>,
  model: 'linear' | 'gated' | 'embedding',
): readonly ComparisonRow[] {
  return arrayValue(report.rows, `${model}.rows`).map((value, index) => {
    const row = objectValue(value, `${model}.rows[${index}]`);
    const modelGradeKey =
      model === 'linear'
        ? 'linearTop1Grade'
        : model === 'gated'
          ? 'gatedTop1Grade'
          : 'embeddingTop1Grade';
    const modelDocumentKey =
      model === 'linear'
        ? 'linearTop1DocumentId'
        : model === 'gated'
          ? 'gatedTop1DocumentId'
          : 'embeddingTop1DocumentId';
    return {
      fixtureId: stringValue(row.fixtureId, `${model}.rows[${index}].fixtureId`),
      family: nullableString(row.family),
      goal: nullableString(row.goal),
      originalTop1Grade: numberValue(
        row.originalTop1Grade,
        `${model}.rows[${index}].originalTop1Grade`,
      ),
      modelTop1Grade: numberValue(row[modelGradeKey], `${model}.rows[${index}].${modelGradeKey}`),
      maximumAvailableGrade: numberValue(
        row.maximumAvailableGrade,
        `${model}.rows[${index}].maximumAvailableGrade`,
      ),
      originalTop1DocumentId: nullableString(row.originalTop1DocumentId),
      modelTop1DocumentId: nullableString(row[modelDocumentKey]),
    };
  });
}

function testSha(report: Record<string, unknown>, label: string): string {
  const test = objectValue(report.test, `${label}.test`);
  return stringValue(test.sha256, `${label}.test.sha256`);
}

function summarize(rows: readonly ComparisonRow[]) {
  const classified = rows.map((row) => {
    const originalBest = row.originalTop1Grade === row.maximumAvailableGrade;
    const modelBest = row.modelTop1Grade === row.maximumAvailableGrade;
    return {
      ...row,
      originalBest,
      modelBest,
      gradeDelta: row.modelTop1Grade - row.originalTop1Grade,
      status:
        !originalBest && modelBest
          ? 'fixed'
          : originalBest && !modelBest
            ? 'regressed'
            : row.modelTop1Grade > row.originalTop1Grade
              ? 'improved'
              : row.modelTop1Grade < row.originalTop1Grade
                ? 'worsened'
                : 'unchanged',
    };
  });
  const count = (status: string) => classified.filter((row) => row.status === status).length;
  return {
    fixtureCount: classified.length,
    fixed: count('fixed'),
    regressed: count('regressed'),
    improved: count('improved'),
    worsened: count('worsened'),
    unchanged: count('unchanged'),
    netBestGradeFixes: count('fixed') - count('regressed'),
    changed: classified.filter((row) => row.status !== 'unchanged'),
  };
}

const linear = readJson(linearPath);
const embedding = readJson(embeddingPath);
const linearSha = testSha(linear, 'linear');
const embeddingSha = testSha(embedding, 'embedding');
if (linearSha !== embeddingSha) {
  throw new Error(`Frozen candidate pool mismatch: linear=${linearSha}, embedding=${embeddingSha}`);
}

const linearRows = comparisonRows(linear, 'linear');
const gatedRows = comparisonRows(linear, 'gated');
const embeddingRows = comparisonRows(embedding, 'embedding');
const linearIds = linearRows.map((row) => row.fixtureId).toSorted();
const embeddingIds = embeddingRows.map((row) => row.fixtureId).toSorted();
if (
  linearIds.length !== embeddingIds.length ||
  linearIds.some((fixtureId, index) => fixtureId !== embeddingIds[index])
) {
  throw new Error('Linear and embedding reports contain different fixture sets.');
}

const report = {
  schemaVersion: 2,
  experiment: 'minimed-frozen-reranker-ablation-summary',
  generatedAt: new Date().toISOString(),
  frozenCandidateSha256: linearSha,
  linear: summarize(linearRows),
  gated: summarize(gatedRows),
  embedding: summarize(embeddingRows),
};

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(
  JSON.stringify(
    {
      reportPath,
      frozenCandidateSha256: linearSha,
      linear: {
        fixed: report.linear.fixed,
        regressed: report.linear.regressed,
        netBestGradeFixes: report.linear.netBestGradeFixes,
      },
      gated: {
        fixed: report.gated.fixed,
        regressed: report.gated.regressed,
        netBestGradeFixes: report.gated.netBestGradeFixes,
      },
      embedding: {
        fixed: report.embedding.fixed,
        regressed: report.embedding.regressed,
        netBestGradeFixes: report.embedding.netBestGradeFixes,
      },
    },
    null,
    2,
  ),
);
