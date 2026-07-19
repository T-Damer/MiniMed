import { spawnSync } from 'node:child_process';

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const uv = process.platform === 'win32' ? 'uv.exe' : 'uv';
const phaseTimeoutMs = Number.parseInt(
  process.env.LOCALMED_VERIFY_PHASE_TIMEOUT_MS ?? '300000',
  10,
);

const phases = [
  { label: 'content', command: pnpm, args: ['run', 'content:build'] },
  { label: 'format-and-lint', command: pnpm, args: ['run', 'check'] },
  { label: 'typescript', command: pnpm, args: ['run', 'typecheck'] },
  { label: 'unit-tests', command: pnpm, args: ['run', 'test:unit'] },
  { label: 'production-builds', command: pnpm, args: ['run', 'build'] },
  {
    label: 'python-format',
    command: uv,
    args: [
      'run',
      '--project',
      'tools/ingest',
      'ruff',
      'format',
      '--check',
      'tools/ingest/src',
      'tools/ingest/tests',
    ],
  },
  {
    label: 'python-lint',
    command: uv,
    args: [
      'run',
      '--project',
      'tools/ingest',
      'ruff',
      'check',
      'tools/ingest/src',
      'tools/ingest/tests',
    ],
  },
  {
    label: 'python-typecheck',
    command: uv,
    args: ['run', '--project', 'tools/ingest', 'pyright', 'tools/ingest/src', 'tools/ingest/tests'],
  },
  {
    label: 'python-tests',
    command: uv,
    args: ['run', '--project', 'tools/ingest', 'pytest', 'tools/ingest/tests'],
  },
  { label: 'retrieval-benchmarks', command: pnpm, args: ['run', 'benchmark:all'] },
  { label: 'native-contract', command: pnpm, args: ['run', 'native:source:check'] },
  { label: 'peer-dependencies', command: pnpm, args: ['run', 'peers:check'] },
  { label: 'secret-scan', command: pnpm, args: ['run', 'secrets:check'] },
];

for (const phase of phases) {
  const startedAt = Date.now();
  console.log(`\n=== verify:${phase.label} ===`);
  const result = spawnSync(phase.command, phase.args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    timeout: phaseTimeoutMs,
  });
  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  if (result.error) {
    const timedOut = result.error.code === 'ETIMEDOUT';
    console.error(
      timedOut
        ? `Verification phase "${phase.label}" timed out after ${elapsedSeconds}s.`
        : `Verification phase "${phase.label}" failed to start: ${result.error.message}`,
    );
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`Verification phase "${phase.label}" failed after ${elapsedSeconds}s.`);
    process.exit(result.status ?? 1);
  }
  console.log(`=== verify:${phase.label} passed in ${elapsedSeconds}s ===`);
}

console.log('\nAll LocalMed verification phases passed.');
