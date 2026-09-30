import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { type Subprocess, spawn } from 'bun';
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright';

export const REPOSITORY_ROOT = resolve(import.meta.dirname, '../..');
/** The web reference viewport: 1 CSS px = 1 dp, as the native design system assumes. */
export const REFERENCE_VIEWPORT = { width: 375, height: 812 } as const;

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolvePort(address.port);
        else reject(new Error('No free port.'));
      });
    });
  });
}

async function waitForServer(origin: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = await fetch(origin).then(
      (response) => response.ok,
      () => false,
    );
    if (ready) return;
    await Bun.sleep(200);
  }
  throw new Error(`The preview server at ${origin} did not start.`);
}

/**
 * Serves the built WebView (`bun run build:app`) on a free 127.0.0.1 port with a Chromium browser
 * for the duration of [task].
 */
export async function withBuiltApp<T>(
  task: (origin: string, browser: Browser) => Promise<T>,
): Promise<T> {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let server: Subprocess | undefined;
  try {
    server = spawn(
      ['bunx', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
      { cwd: resolve(REPOSITORY_ROOT, 'apps/app'), stdout: 'ignore', stderr: 'ignore' },
    );
    await waitForServer(origin);
    const browser = await chromium.launch();
    try {
      return await task(origin, browser);
    } finally {
      await browser.close();
    }
  } finally {
    server?.kill();
  }
}

/**
 * A reference-sized page in the given colour scheme, past the first-run setup screen, in a
 * repeatable state: reduced motion stops the carousel autoplay and transitions, and database
 * downloads are held open so the core status stays at its first message.
 */
export async function referencePage(
  browser: Browser,
  colorScheme: 'light' | 'dark',
  options: { readonly holdDatabases?: boolean } = {},
): Promise<{ readonly context: BrowserContext; readonly page: Page }> {
  const context = await browser.newContext({
    viewport: REFERENCE_VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme,
    reducedMotion: 'reduce',
  });
  if (options.holdDatabases ?? true) {
    // Never answered, so the page keeps showing the first «connecting» status. A page that needs a
    // ready core must use its own context: the held download keeps the OPFS pool busy.
    await context.route('**/content/*.db', () => undefined);
  }
  await context.addInitScript(() => {
    localStorage.setItem('minimed:package-setup-dismissed:v1', '1');
  });
  return { context, page: await context.newPage() };
}
