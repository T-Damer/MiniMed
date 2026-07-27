import { access, copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');

const sourceDatabase = resolve(root, 'data/build/core-demo.db');
const sourceReportPath = resolve(root, 'data/build/core-demo-report.json');
const targetDatabase = resolve(root, 'apps/app/public/content/core-demo.db');
const targetReportPath = resolve(root, 'apps/app/public/content/core-demo-report.json');

async function readReport(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

const candidateReport = await readReport(sourceReportPath);
if (!candidateReport || typeof candidateReport.documents !== 'number') {
  console.error(
    `Cannot publish demo content pack: missing or invalid build report at ${sourceReportPath}. Run "bun run content:compile" first.`,
  );
  process.exit(1);
}

const publishedPackExists = await access(targetDatabase).then(
  () => true,
  () => false,
);

// The published pack is owned by CI's "Automated content database rebuild"
// workflow, which compiles the full pilot corpus. The local fixtures build is a
// small verification pack and must never silently replace the richer one.
if (publishedPackExists && !force) {
  const publishedReport = await readReport(targetReportPath);
  if (
    publishedReport?.outputChecksum &&
    publishedReport.outputChecksum === candidateReport.outputChecksum
  ) {
    console.log('Published demo content pack is already current; nothing to copy.');
    process.exit(0);
  }
  if (typeof publishedReport?.documents !== 'number') {
    console.warn(
      `Skipped publishing: ${targetDatabase} exists but its report is missing or unreadable, so the packs cannot be compared. Re-run with --force to overwrite it.`,
    );
    process.exit(0);
  }
  if (candidateReport.documents < publishedReport.documents) {
    console.warn(
      `Skipped publishing: the compiled pack has ${candidateReport.documents} documents while the published CI-built pack has ${publishedReport.documents}. Re-run with --force to overwrite it anyway.`,
    );
    process.exit(0);
  }
}

const targets = [
  [sourceDatabase, targetDatabase],
  [resolve(root, 'data/build/core-demo-report.json'), targetReportPath],
];

for (const [source, target] of targets) {
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}

console.log('Published compiled demo content pack to apps/app/public/content.');
