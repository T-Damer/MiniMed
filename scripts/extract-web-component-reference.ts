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
import { resolve } from 'node:path';
import type { Page } from 'playwright';
import {
  REFERENCE_VIEWPORT,
  REPOSITORY_ROOT,
  referencePage,
  withBuiltApp,
} from './lib/built-app-preview';

const OUTPUT = 'native/shared/src/commonTest/resources/web-component-reference.json';

interface Screen {
  readonly id: string;
  readonly hash: string;
  /** Prepares the state to capture, e.g. types a query. */
  readonly prepare?: (page: Page) => Promise<void>;
  /** Loads the databases for real (typing needs a ready core); captures no loading status. */
  readonly readyCore?: boolean;
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
    readyCore: true,
    prepare: async (page) => {
      const input = page.getByTestId('search-input');
      // The field enables once the 420 MB core is copied into OPFS for this fresh profile.
      await input.and(page.locator(':enabled')).waitFor({ timeout: 180_000 });
      await input.fill('пневмония');
    },
  },
  {
    id: 'results',
    hash: '#/search',
    readyCore: true,
    prepare: async (page) => {
      const input = page.getByTestId('search-input');
      await input.and(page.locator(':enabled')).waitFor({ timeout: 180_000 });
      await input.fill('пневмония');
      await input.press('Enter');
      await page
        .locator('.result-group, [data-testid="result-group"]')
        .first()
        .waitFor({ timeout: 60_000 });
    },
  },
  {
    id: 'reader',
    hash: '#/search',
    readyCore: true,
    prepare: async (page) => {
      const input = page.getByTestId('search-input');
      await input.and(page.locator(':enabled')).waitFor({ timeout: 180_000 });
      await input.fill('пневмония');
      await input.press('Enter');
      await page.locator('.result-open').first().click();
      await page.locator('.reader-header__open-document').click();
      await page.locator('.document-overlay-section').first().waitFor({ timeout: 60_000 });
    },
  },
];

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
    'feature-actions': '.home-feature__actions',
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
    'bottom-nav-bubble': '.app-bottom-nav__bubble',
    'bottom-nav-button': '.app-nav-button:not(.app-nav-button--active)',
    'bottom-nav-button-active': '.app-nav-button--active',
  },
  'home-clinical': {
    'clinical-toggle-on': '.search-clinical-toggle',
  },
  results: {
    'meanings-phrase': '.search-meanings__phrase',
    'choice-chip': '.choice-chip',
    'choice-chip-icon': '.choice-chip__icon',
    'choice-chip-label': '.choice-chip__label',
    'choice-chip-detail': '.choice-chip__detail',
    'identity-card': '.core-identity-matches__card',
    'identity-title': '.core-identity-matches__title',
    'identity-note': '.core-identity-matches__note',
    'button-secondary': '.ui-button--secondary',
    'result-group': '.result-group',
    'result-header': '.result-group-header',
    'result-index': '.result-group-header__index',
    'result-kind': '.result-group-header__kind',
    'result-kind-label': '.result-group-header__kind-label',
    'result-content-kind': '.result-group-header__content-kind',
    'result-title': '.result-group-header__title',
    'clinical-tag': '.clinical-tags__tag',
    'result-card': '.result-card',
    'result-path': '.result-path',
    'result-snippet': '.result-snippet',
    'result-open': '.result-open',
    'result-more': '.result-group__more',
    'result-note': '.result-group-header__note',
    'result-header-body': '.result-group-header__body',
    'result-action': '.result-group__action',
    'result-snippets': '.result-group__snippets',
    'download-chip': '.search-download-chip',
    'download-chip-icon': '.search-download-chip .choice-chip__icon',
    'download-chip-label': '.search-download-chip .choice-chip__label',
    'download-chip-detail': '.search-download-chip .choice-chip__detail',
    'result-category-icon': '.result-category-icon',
    'category-stamp': '.category-stamp',
    highlight: '.highlighted-text__match',
    'more-header': '.result-group__more .ui-disclosure__header',
    'more-title': '.result-group__more .ui-disclosure__title',
    'more-chevron': '.result-group__more .ui-disclosure__chevron',
  },
  reader: {
    'reader-chrome': '.document-page__chrome',
    'reader-back': '.document-page__back',
    'reader-outline-toggle': '.document-overlay-outline-toggle',
    'reader-crumbs': '.document-crumbs',
    'reader-crumb-link': '.document-crumbs__link',
    'reader-crumb-separator': '.document-crumbs__separator',
    'reader-crumb-current': '.document-crumbs__current-text',
    'reader-find-toggle': '.document-find__toggle',
    'reader-actions-button': '.reader-actions__button',
    'reader-paper': '.document-overlay-paper',
    'reader-section': '.document-overlay-section',
    'reader-section-title': '.document-overlay-section__title--h2',
    'reader-paragraph': '.document-overlay-section__paragraph',
    'reader-list': '.document-text-list',
    'reader-list-item': '.document-text-list__item',
    'reader-inline-link': '.document-inline-link',
    'reader-inline-link-icon': '.document-inline-link__icon',
    'reader-inline-link-label': '.document-inline-link__label',
    'reader-image': '.document-reference-image',
    'reader-image-picture': '.document-reference-image__image',
    'reader-image-caption': '.document-reference-image__caption',
    'scroll-top-button': '.scroll-top-button',
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
  'border-top-style',
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

await withBuiltApp(async (origin, browser) => {
  const result: Record<string, unknown> = {};
  const listOnly = process.argv.includes('--list');
  for (const colorScheme of ['light', 'dark'] as const) {
    const { context, page } = await referencePage(browser, colorScheme);
    const ready = await referencePage(browser, colorScheme, { holdDatabases: false });
    for (const screen of SCREENS) {
      const target = screen.readyCore ? ready.page : page;
      await openScreen(target, origin, screen);
      if (listOnly) {
        if (colorScheme === 'light') result[screen.id] = await listBlocks(target);
      } else {
        result[colorScheme] ??= {};
        const theme = result[colorScheme] as Record<string, unknown>;
        theme[screen.id] = await captureBlocks(target, BLOCKS[screen.id] ?? {});
      }
    }
    await context.close();
    await ready.context.close();
  }
  if (listOnly) {
    for (const [screen, counts] of Object.entries(result)) {
      console.log(`== ${screen}`);
      console.log(
        Object.entries(counts as Record<string, number>)
          .map(([name, count]) => `${name}×${count}`)
          .join('  '),
      );
    }
    return;
  }
  const reference = { viewport: REFERENCE_VIEWPORT, unit: '1 CSS px = 1 dp', themes: result };
  writeFileSync(resolve(REPOSITORY_ROOT, OUTPUT), `${JSON.stringify(reference, null, 2)}\n`);
  console.log(`Wrote ${OUTPUT}.`);
});
