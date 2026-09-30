import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const child = Bun.spawn(
  ['./gradlew', ':shared:wasmJsBrowserDevelopmentRun', '--continuous', '--console=plain'],
  {
    cwd: resolve(root, 'native'),
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      HOME: '/Users/d',
      PATH: '/Users/d/.bun/bin:/Users/d/.local/bin:/opt/homebrew/bin:/usr/bin:/bin',
      TMPDIR: resolve(root, 'playwright'),
      LANG: 'en_US.UTF-8',
      TZ: 'UTC',
      JAVA_HOME: '/opt/homebrew/Cellar/openjdk@21/21.0.12/libexec/openjdk.jdk/Contents/Home',
    },
  },
);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
process.exit(await child.exited);
