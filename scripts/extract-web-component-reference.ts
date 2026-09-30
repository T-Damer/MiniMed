/**
 * Captures the WebView's computed component styles as the reference for native components.
 *
 *   bun run build:app && bun scripts/extract-web-component-reference.ts [--list]
 *
 * Serves the built app on a free 127.0.0.1 port, opens it at 375 × 812 (1 CSS px = 1 dp) in the
 * light and dark colour schemes, and records, for each BEM block below, the first visible
 * element's box, spacing, radius, colours, shadow and text styles. `--list` prints the BEM blocks
 * visible on each screen instead, to choose what to capture.
 */

import { writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { type Subprocess, spawn } from 'bun';
import { chromium, type Page } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const OUTPUT = 'native/shared/src/commonTest/resources/web-component-reference.json';
const VIEWPORT = { width: 375, height: 812 };

interface Screen {
  readonly id: string;
  readonly hash: string;
  /** Prepares the state to capture, e.g. types a query. */
  readonly prepare?: (page: Page) => Promise<void>;
}

const SCREENS: readonly Screen[] = [
  { id: 'home', hash: '#/search' },
  {
    id: 'home-clinical',
    hash: '#/search',
    prepare: async (page) => {
      await page.locator('.search-clinical-toggle').click();
    },
  },
  {
    id: 'home-typing',
    hash: '#/search',
    prepare: async (page) => {
      await page.getByTestId('search-input').fill('пневмония');
    },
  },
];

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolvePort(address.port);
        else reject(new Error('No port.'));
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

async function openScreen(page: Page, origin: string, screen: Screen): Promise<void> {
  await page.goto(`${origin}/${screen.hash}`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('search-input').waitFor();
  await screen.prepare?.(page);
  // Let transitions settle before reading computed styles.
  await page.waitForTimeout(600);
}

async function listBlocks(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const counts: Record<string, number> = {};
    for (const element of document.querySelectorAll<HTMLElement>('[class]')) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || rect.bottom < 0 || rect.top > innerHeight)
        continue;
      for (const name of element.classList) {
        if (!/^[a-z][a-z0-9-]*(__[a-z0-9-]+)?(--[a-z0-9-]+)?$/u.test(name)) continue;
        counts[name] = (counts[name] ?? 0) + 1;
      }
    }
    return counts;
  });
}

/** BEM block → selector of its first visible instance, per screen. */
const BLOCKS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  home: {
    'route-icon-button': '.search-random-record',
    'history-fab': '.search-history-fab',
    'query-sheet': '.query-sheet',
    'query-input': '[data-testid="search-input"]',
    'source-picker': '.search-source-picker',
    'clinical-toggle': '.search-clinical-toggle',
    'core-status': '.search-core-status',
    'core-status-title': '.search-core-status__title',
    'core-status-detail': '.search-core-status__detail',
    'quick-access-chip': '.search-quick-access__all',
    'quick-access-hint': '.search-quick-access__hint',
    'feature-card': '.home-feature',
    'feature-kicker': '.home-feature__kicker',
    'feature-title': '.home-feature__title',
    'feature-text': '.home-feature__text',
    'feature-action-primary': '.home-feature__action:not(.home-feature__action--secondary)',
    'feature-action-secondary': '.home-feature__action--secondary',
    'help-icon-link': '.help-icon-link',
    'carousel-arrow': '.carousel__arrow',
    'carousel-dot': '.carousel__dot:not(.carousel__dot--active)',
    'carousel-dot-active': '.carousel__dot--active',
    'sections-title': '.search-sections__title',
    'sections-list': '.search-sections__list',
    'section-item': '.search-sections__item',
    'section-item-next': '.search-sections__item + .search-sections__item',
    'query-actions': '.query-actions',
    'section-row': '.search-sections__row',
    'section-icon-frame': '.search-sections__icon-frame',
    'section-name': '.search-sections__name',
    'section-count': '.search-sections__count',
    'bottom-nav': '.app-bottom-nav',
    'bottom-nav-button': '.app-nav-button:not(.app-nav-button--active)',
    'bottom-nav-button-active': '.app-nav-button--active',
  },
  'home-clinical': {
    'clinical-toggle-on': '.search-clinical-toggle',
  },
  'home-typing': {
    'query-clear': '.query-sheet__clear',
    'search-button': '.search-button',
    'results-skeleton-row': '.search-results-skeleton__row',
  },
};

const STYLE_PROPERTIES = [
  'display',
  'gap',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-top-color',
  'border-bottom-width',
  'border-bottom-color',
  'border-top-left-radius',
  'background-color',
  'background-image',
  'box-shadow',
  'opacity',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-transform',
  'font-variant-numeric',
] as const;

async function captureBlocks(
  page: Page,
  blocks: Readonly<Record<string, string>>,
): Promise<Record<string, unknown>> {
  return page.evaluate(
    ({ blocks, properties }) => {
      const captured: Record<string, unknown> = {};
      for (const [name, selector] of Object.entries(blocks)) {
        const element = [...document.querySelectorAll<HTMLElement>(selector)].find((candidate) => {
          const rect = candidate.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        if (!element) {
          captured[name] = null;
          continue;
        }
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        captured[name] = {
          selector,
          box: {
            x: Math.round(rect.x * 10) / 10,
            y: Math.round(rect.y * 10) / 10,
            width: Math.round(rect.width * 10) / 10,
            height: Math.round(rect.height * 10) / 10,
          },
          style: Object.fromEntries(
            properties.map((property) => [property, style.getPropertyValue(property)]),
          ),
        };
      }
      return captured;
    },
    { blocks, properties: [...STYLE_PROPERTIES] },
  );
}

let server: Subprocess | undefined;
try {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  server = spawn(
    ['bunx', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: resolve(ROOT, 'apps/app'),
      stdout: 'ignore',
      stderr: 'ignore',
    },
  );
  await waitForServer(origin);
  const browser = await chromium.launch();
  try {
    const result: Record<string, unknown> = {};
    for (const colorScheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: 1,
        colorScheme,
      });
      await context.addInitScript(() => {
        localStorage.setItem('minimed:package-setup-dismissed:v1', '1');
      });
      const page = await context.newPage();
      for (const screen of SCREENS) {
        await openScreen(page, origin, screen);
        if (process.argv.includes('--list')) {
          if (colorScheme === 'light') result[screen.id] = await listBlocks(page);
        } else {
          const theme = (result[colorScheme] ??= {}) as Record<string, unknown>;
          theme[screen.id] = await captureBlocks(page, BLOCKS[screen.id] ?? {});
        }
      }
      await context.close();
    }
    if (process.argv.includes('--list')) {
      for (const [screen, counts] of Object.entries(result)) {
        console.log(`== ${screen}`);
        console.log(
          Object.entries(counts as Record<string, number>)
            .map(([name, count]) => `${name}×${count}`)
            .join('  '),
        );
      }
    } else {
      const reference = { viewport: VIEWPORT, unit: '1 CSS px = 1 dp', themes: result };
      writeFileSync(resolve(ROOT, OUTPUT), `${JSON.stringify(reference, null, 2)}\n`);
      console.log(`Wrote ${OUTPUT}.`);
    }
  } finally {
    await browser.close();
  }
} finally {
  server?.kill();
}
