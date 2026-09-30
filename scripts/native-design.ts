/**
 * One entry point for the native design-system loop.
 *
 *   bun run native:design sync [--build]   capture the web reference, regenerate tokens and styles
 *   bun run native:design check            drift checks plus the component parity test
 *   bun run native:design compare          web vs native screenshots side by side (light/dark)
 *   bun run native:design preview          build the Wasm preview and serve it on 127.0.0.1
 *
 * `--build` rebuilds the WebView first; otherwise the existing `apps/app/dist` is used.
 * Screenshots land in `playwright/design-compare/` (ignored by git).
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'bun';
import { REPOSITORY_ROOT, referencePage, withBuiltApp } from './lib/built-app-preview';

const JAVA_HOME =
  process.env.JAVA_HOME ??
  '/opt/homebrew/Cellar/openjdk@21/21.0.12/libexec/openjdk.jdk/Contents/Home';
const COMPARE_DIR = resolve(REPOSITORY_ROOT, 'playwright/design-compare');
const SCHEMES = ['light', 'dark'] as const;

function run(label: string, command: readonly string[], cwd = REPOSITORY_ROOT): void {
  console.log(`→ ${label}`);
  const result = spawnSync([...command], {
    cwd,
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env, JAVA_HOME },
  });
  if (result.exitCode !== 0) throw new Error(`${label} failed (exit ${result.exitCode}).`);
}

function gradle(label: string, ...tasks: string[]): void {
  run(label, ['./gradlew', ...tasks, '--console=plain', '-q'], resolve(REPOSITORY_ROOT, 'native'));
}

function sync(): void {
  if (process.argv.includes('--build')) run('build the WebView', ['bun', 'run', 'build:app']);
  run('capture the web component reference', ['bun', 'scripts/extract-web-component-reference.ts']);
  run('generate design tokens', ['bun', 'scripts/generate-native-design-tokens.ts']);
  run('generate component styles', ['bun', 'scripts/generate-native-component-styles.ts']);
}

function check(): void {
  run('design tokens match the CSS', [
    'bun',
    'scripts/generate-native-design-tokens.ts',
    '--check',
  ]);
  run('component styles match the reference', [
    'bun',
    'scripts/generate-native-component-styles.ts',
    '--check',
  ]);
  gradle(
    'component parity test',
    ':shared:desktopTest',
    '--tests',
    '*NativeComponentParityTest*',
    '--rerun',
  );
}

function dataUrl(path: string): string {
  return `data:image/png;base64,${readFileSync(path).toString('base64')}`;
}

async function compare(): Promise<void> {
  if (process.argv.includes('--build')) run('build the WebView', ['bun', 'run', 'build:app']);
  mkdirSync(COMPARE_DIR, { recursive: true });
  gradle(
    'render the native gallery',
    ':shared:desktopTest',
    '--tests',
    '*NativeDesignGalleryTest*',
    '--rerun',
  );
  console.log('→ capture the WebView and compose the pairs');
  await withBuiltApp(async (origin, browser) => {
    for (const scheme of SCHEMES) {
      const { context, page } = await referencePage(browser, scheme);
      await page.goto(`${origin}/#/search`);
      await page.getByTestId('search-input').waitFor();
      await page.waitForTimeout(800);
      const webPath = resolve(COMPARE_DIR, `web-home-${scheme}.png`);
      await page.screenshot({ path: webPath });
      await context.close();

      const nativePath = resolve(REPOSITORY_ROOT, `playwright/native-design-gallery-${scheme}.png`);
      const sheet = await browser.newPage({ viewport: { width: 790, height: 870 } });
      await sheet.setContent(`<!doctype html><body style="margin:0;font:13px sans-serif;background:#fff">
        <div style="display:flex;gap:20px;padding:10px">
          <figure style="margin:0"><figcaption>WebView (reference)</figcaption><img src="${dataUrl(webPath)}"></figure>
          <figure style="margin:0"><figcaption>Native design system</figcaption><img src="${dataUrl(nativePath)}"></figure>
        </div></body>`);
      const pairPath = resolve(COMPARE_DIR, `home-${scheme}.png`);
      await sheet.screenshot({ path: pairPath, fullPage: true });
      await sheet.close();
      console.log(`  ${pairPath}`);
    }
  });
}

/** Builds the Wasm preview distribution and serves it until interrupted (PORT, default 4175). */
async function preview(): Promise<void> {
  gradle('build the Wasm preview', ':shared:wasmJsBrowserDistribution');
  const root = resolve(REPOSITORY_ROOT, 'native/shared/build/dist/wasmJs/productionExecutable');
  const port = Number(process.env.PORT ?? 4175);
  Bun.serve({
    hostname: '127.0.0.1',
    port,
    fetch(request) {
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!path.startsWith(`${root}/`)) return new Response('Not found', { status: 404 });
      const file = Bun.file(path);
      // Rebuilds keep the name shared.js; never let the browser reuse an older bundle.
      return file.size > 0
        ? new Response(file, { headers: { 'Cache-Control': 'no-store' } })
        : new Response('Not found', { status: 404 });
    },
  });
  console.log(
    `Design gallery: http://127.0.0.1:${port}/?scene=design (add &theme=dark, &loading=1)`,
  );
  console.log(`Native screens: http://127.0.0.1:${port}/?scene=search`);
}

const command = process.argv[2];
if (command === 'sync') sync();
else if (command === 'check') check();
else if (command === 'compare') await compare();
else if (command === 'preview') await preview();
else {
  console.error(
    'Usage: bun run native:design <sync [--build] | check | compare [--build] | preview>',
  );
  process.exit(1);
}
