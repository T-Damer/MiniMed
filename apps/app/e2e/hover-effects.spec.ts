import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, type Page, test } from '@playwright/test';

import {
  addReading,
  DIARY_PAGE,
  localInput,
  openRecords,
  openSettings,
  testInvitation,
  testInvitationLink,
} from './diary-fixtures';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

// Owner's rule (2026-11-08): every interactive element has a hover effect, but only on devices that
// have hover. The check walks representative screens of the main app and of the diary, really hovers
// each visible interactive element with the mouse and compares the computed style of the element,
// its descendants and their pseudo-elements (slider thumbs, ::before/::after) before and after.
// Elements whose look does not change are reported. Separately, the style sheets are read for
// `:hover` rules that are not inside an `@media (hover: …)` block and that style a tested element
// (they stick on touch screens); those are listed in the report but do not fail the check.

/** Intentional exceptions: a CSS selector the element matches, with the reason. */
const ALLOWLIST: readonly { readonly selector: string; readonly reason: string }[] = [
  {
    selector: '.app-nav-button--active',
    reason: 'The current tab already shows its raised, notched state; hovering it changes nothing.',
  },
  {
    selector: 'a.skip-link',
    reason: 'Skip link: visible only on keyboard focus, never under the mouse.',
  },
];

interface Finding {
  readonly signature: string;
  readonly text: string;
}

interface HoverReport {
  readonly missing: Finding[];
  readonly ungated: string[];
  readonly checked: number;
}

/** Runs in the page: hovers each interactive element and reports those whose look does not change. */
async function scanHover(page: Page): Promise<HoverReport> {
  // Transitions would make the "after" snapshot a mid-transition value.
  await page.addStyleTag({
    content: '*,*::before,*::after{transition:none !important;animation:none !important}',
  });
  const candidates = await page.evaluate(
    (allowed) => {
      const SELECTOR = [
        'button',
        'a[href]',
        '[role="button"]',
        '[role="tab"]',
        '[role="radio"]',
        '[role="switch"]',
        '[role="menuitem"]',
        '[role="option"]',
        '[role="checkbox"]',
        'input[type="range"]',
        'input[type="checkbox"]',
        'input[type="radio"]',
        'select',
        'summary',
        'label',
      ].join(',');
      for (const old of document.querySelectorAll('[data-hover-probe]'))
        old.removeAttribute('data-hover-probe');
      const seen = new Set<string>();
      const found: { index: number; signature: string; text: string }[] = [];
      const all = document.querySelectorAll<HTMLElement>(SELECTOR);
      all.forEach((element, index) => {
        if (element.closest('[inert], [hidden], [aria-hidden="true"]')) return;
        if (allowed.some((selector) => element.matches(selector))) return;
        // Content of a closed <details> is not rendered, so it cannot be hovered.
        const folded = element.parentElement?.closest('details:not([open])');
        if (folded && !(element.matches('summary') && element.parentElement === folded)) return;
        if (
          (element as HTMLButtonElement).disabled ||
          element.getAttribute('aria-disabled') === 'true'
        )
          return;
        if (element.matches('label') && !element.querySelector('input, select, textarea, button'))
          return;
        const style = getComputedStyle(element);
        if (
          style.visibility === 'hidden' ||
          style.display === 'none' ||
          style.pointerEvents === 'none'
        )
          return;
        const box = element.getBoundingClientRect();
        if (box.width < 2 || box.height < 2) return;
        const signature = `${element.tagName.toLowerCase()}.${(element.getAttribute('class') ?? '').split(/\s+/u)[0] ?? ''}`;
        // One representative per kind keeps the run short; variants with other classes are separate.
        const variant = `${signature}|${element.getAttribute('class') ?? ''}|${element.getAttribute('role') ?? ''}`;
        if (seen.has(variant)) return;
        seen.add(variant);
        element.dataset['hoverProbe'] = String(index);
        found.push({
          index,
          signature,
          text: (element.getAttribute('aria-label') ?? element.textContent ?? '')
            .trim()
            .slice(0, 40),
        });
      });
      return found;
    },
    ALLOWLIST.map((entry) => entry.selector),
  );

  const missing: Finding[] = [];
  let checked = 0;
  for (const candidate of candidates) {
    const target = page.locator(`[data-hover-probe="${candidate.index}"]`);
    if ((await target.count()) === 0) continue;
    await target.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => undefined);
    const box = await target.boundingBox({ timeout: 2000 }).catch(() => null);
    if (!box) continue;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    if (y < 0 || y > (page.viewportSize()?.height ?? 0) || x < 0) continue;
    // Skip elements covered by something else (a sheet, a sticky header): hovering reaches the cover.
    const reachable = await target.evaluate(
      (element, point) => {
        const top = document.elementFromPoint(point.x, point.y);
        return top !== null && (element === top || element.contains(top) || top.contains(element));
      },
      { x, y },
    );
    if (!reachable) continue;

    const snapshot = (): Promise<string> =>
      target.evaluate((element) => {
        const PROPS = [
          'color',
          'background-color',
          'background-image',
          'box-shadow',
          'opacity',
          'transform',
          'text-decoration-line',
          'filter',
          'fill',
          'stroke',
        ];
        const SIDES = ['top', 'right', 'bottom', 'left'];
        const PSEUDOS = [
          null,
          '::before',
          '::after',
          '::-webkit-slider-thumb',
          '::-webkit-slider-runnable-track',
        ];
        // A border or outline colour only counts where there is a border or outline to see.
        const visibleEdges = (style: CSSStyleDeclaration): string[] => [
          ...SIDES.map((side) =>
            Number.parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0 &&
            style.getPropertyValue(`border-${side}-style`) !== 'none'
              ? style.getPropertyValue(`border-${side}-color`)
              : '',
          ),
          style.getPropertyValue('outline-style') !== 'none' &&
          Number.parseFloat(style.getPropertyValue('outline-width')) > 0
            ? style.getPropertyValue('outline-color')
            : '',
        ];
        const out: string[] = [];
        // A full-size open button over a card (position: absolute) is the card's hover.
        const cover =
          getComputedStyle(element).position === 'absolute' ? element.parentElement : null;
        const nodes = [
          element,
          ...(cover ? [cover] : []),
          ...Array.from(element.querySelectorAll('*')).slice(0, 40),
        ];
        for (const node of nodes) {
          for (const pseudo of PSEUDOS) {
            const style = getComputedStyle(node, pseudo);
            out.push(
              [
                ...PROPS.map((property) => style.getPropertyValue(property)),
                ...visibleEdges(style),
              ].join('|'),
            );
          }
        }
        return out.join('\n');
      });

    await page.mouse.move(1, 1);
    const before = await snapshot();
    await page.mouse.move(x, y);
    const after = await snapshot();
    checked += 1;
    if (process.env.HOVER_VERBOSE && before !== after) console.log(`  ok ${candidate.signature}`);
    if (before === after) {
      // Slider thumbs and other shadow parts have no readable computed style: compare pixels.
      const view = page.viewportSize() ?? { width: 1280, height: 720 };
      const clip = {
        x: Math.max(0, box.x - 8),
        y: Math.max(0, box.y - 8),
        width: Math.min(view.width - Math.max(0, box.x - 8), box.width + 16),
        height: Math.min(view.height - Math.max(0, box.y - 8), box.height + 16),
      };
      const hoveredPicture = await page.screenshot({ clip });
      await page.mouse.move(1, 1);
      const restingPicture = await page.screenshot({ clip });
      if (hoveredPicture.equals(restingPicture)) {
        missing.push({ signature: candidate.signature, text: candidate.text });
      }
    }
  }
  await page.mouse.move(1, 1);

  const ungated = await page.evaluate(() => {
    const hits = new Set<string>();
    const strip = (selector: string): string => selector.replace(/::?[\w-]*hover/gu, ':is(*)');
    const splitTop = (selector: string): string[] => {
      const parts: string[] = [];
      let depth = 0;
      let current = '';
      for (const char of selector) {
        if (char === '(' || char === '[') depth += 1;
        if (char === ')' || char === ']') depth -= 1;
        if (char === ',' && depth === 0) {
          parts.push(current);
          current = '';
        } else current += char;
      }
      parts.push(current);
      return parts;
    };
    const visit = (rules: CSSRuleList, gated: boolean): void => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule) {
          if (!rule.selectorText.includes(':hover')) {
            if (rule.cssRules.length > 0) visit(rule.cssRules, gated);
            continue;
          }
          if (gated) continue;
          for (const part of splitTop(rule.selectorText)) {
            if (!part.includes(':hover')) continue;
            const stripped = strip(part.replace(/::[\w-]+(\([^)]*\))?/gu, '')).trim();
            try {
              if (document.querySelector(stripped)) hits.add(part.trim());
            } catch {
              hits.add(part.trim());
            }
          }
        } else if (rule instanceof CSSMediaRule) {
          visit(rule.cssRules, gated || /hover/u.test(rule.conditionText));
        } else if ('cssRules' in rule) {
          visit((rule as CSSGroupingRule).cssRules, gated);
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        visit(sheet.cssRules, false);
      } catch {
        // Cross-origin sheet: nothing to read.
      }
    }
    return Array.from(hits);
  });

  return { missing, ungated, checked };
}

const reports = new Map<string, HoverReport>();

async function audit(page: Page, name: string): Promise<void> {
  // Let the screen settle (route transition, sheet slide) before comparing styles.
  await page.waitForTimeout(500);
  const report = await scanHover(page);
  reports.set(name, report);
  test.info().annotations.push({
    type: `hover ${name}`,
    description: `${report.checked} checked, ${report.missing.length} missing, ${report.ungated.length} ungated rules`,
  });
  if (report.ungated.length > 0 && process.env['HOVER_VERBOSE']) {
    console.log(`[ungated hover rules on ${name}]\n${report.ungated.join('\n')}`);
  }
  expect
    .soft(
      report.missing.map((item) => `${item.signature} «${item.text}»`),
      `no hover effect on «${name}»`,
    )
    .toEqual([]);
}

/** Static finding list: `:hover` rules outside an `@media (hover: …)` block that style a seen element. */
test.afterAll(() => {
  const ungated = new Set<string>();
  for (const report of reports.values()) for (const rule of report.ungated) ungated.add(rule);
  if (ungated.size > 0) {
    console.log(
      `[hover-effects] ${ungated.size} :hover rules are not gated by @media (hover: hover) (report only):\n  ${Array.from(ungated).sort().join('\n  ')}`,
    );
  }
});

test.describe('main app', () => {
  test.use({ viewport: { width: 1100, height: 800 } });

  test('home, calculators, a calculator and settings', async ({ page }) => {
    test.setTimeout(180_000);
    await mountBuiltApp(page, { splitNavigation: false });
    await audit(page, 'home');

    for (const [name, hash] of [
      ['calculators', '#/calculators'],
      ['calculator', '#/calculators/minimed.calculator.ciwa-ar'],
      ['settings', '#/settings'],
      ['settings-general', '#/settings/general'],
      ['settings-appearance', '#/settings/appearance'],
    ] as const) {
      await page.goto(`${E2E_ASSET_ORIGIN}/${hash}`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('main, [role="main"]').first()).toBeVisible();
      await audit(page, name);
    }
  });
});

test.describe('patient diary', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test('home, entry form, records, settings, send and the care diary', async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'canShare', { value: undefined });
    });
    await page.goto(DIARY_PAGE);
    await expect(page.getByRole('region', { name: 'Вставьте ссылку от врача' })).toBeVisible();
    await audit(page, 'diary-empty-list');

    await page.goto(await testInvitationLink(testInvitation({ doctor: 'Иванова А. А.' })));
    await expect(page.locator('.diary-notice')).toBeVisible();
    await audit(page, 'diary-home');

    await page.getByRole('button', { name: 'Записать показания', exact: true }).click();
    await expect(page.getByLabel(/^Верхнее/u)).toBeVisible();
    await audit(page, 'diary-entry-form');
    await page.getByLabel(/^Верхнее/u).fill('138');
    await page.getByLabel(/^Нижнее/u).fill('88');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.locator('.diary-saved')).toBeVisible();
    await audit(page, 'diary-saved');

    await addReading(page, { systolic: 150, diastolic: 95, pulse: 80, at: localInput(2, 8, 10) });
    await openSettings(page);
    await audit(page, 'diary-settings');
    await page.getByRole('button', { name: 'На главную', exact: true }).click();
    await openRecords(page);
    await audit(page, 'diary-records');
    await page.getByRole('button', { name: 'На главную', exact: true }).click();
    await page.getByRole('button', { name: 'Отправить врачу', exact: true }).click();
    await audit(page, 'diary-send');

    const care = testInvitation({
      template: 'care',
      doctor: 'Иванова А. А.',
      plan: [{ id: 'p1', name: 'Эналаприл', dose: '5 мг', times: [{ time: '08:00' }] }],
      contacts: [{ kind: 'phone', value: '+7 900 000-00-00', label: 'Регистратура' }],
    });
    await page.goto(await testInvitationLink(care));
    const tabs = page.getByRole('navigation', { name: 'Дневник' });
    await expect(tabs).toBeVisible();
    await audit(page, 'care-today');
    for (const tab of ['Записи', 'Врачу', 'Настройки']) {
      await tabs.getByRole('button', { name: tab, exact: true }).click();
      await audit(page, `care-${tab}`);
    }
  });
});

test.describe('doctor diary demo', () => {
  test.use({ viewport: { width: 1100, height: 800 } });
  const root = resolve(import.meta.dirname, '../../..');
  let server: ChildProcess | undefined;
  let directory = '';
  let service = '';

  test.beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'minimed-diary-hover-'));
    const port = 8_950 + test.info().workerIndex;
    service = `http://127.0.0.1:${port}`;
    server = spawn('bun', ['apps/diary-server/src/main.ts'], {
      cwd: root,
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: process.env['HOME'] ?? '',
        DIARY_SIGNUP: 'open',
        DIARY_DB: join(directory, 'diary.db'),
        DIARY_PORT: String(port),
      },
      stdio: 'ignore',
    });
    await expect
      .poll(
        async () => {
          try {
            return (await fetch(`${service}/api/health`)).ok;
          } catch {
            return false;
          }
        },
        { timeout: 20_000 },
      )
      .toBe(true);
  });

  test.afterAll(() => {
    server?.kill();
    rmSync(directory, { recursive: true, force: true });
  });

  test('sign-in, patient list, a patient, the chart settings and the screen editor', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.route(`${E2E_ASSET_ORIGIN}/api/**`, (route) =>
      route.continue({ url: route.request().url().replace(E2E_ASSET_ORIGIN, service) }),
    );
    await page.goto(`${E2E_ASSET_ORIGIN}/?profile=diaries#/notes/diaries`, {
      waitUntil: 'domcontentloaded',
    });
    const demo = page.getByRole('button', { name: 'Демо — без регистрации' });
    await expect(demo).toBeVisible();
    await audit(page, 'doctor-sign-in');
    await demo.click();
    const rows = page.locator('.diary-dash-row');
    await expect(rows).toHaveCount(4, { timeout: 120_000 });
    await audit(page, 'doctor-list');

    await rows.first().locator('.diary-dash-row__open').click();
    const overview = page.getByTestId('diary-overview');
    await expect(overview).toBeVisible({ timeout: 60_000 });
    await overview.getByRole('button', { name: /Статистика/u }).click();
    await expect(overview.locator('.diary-overview__row').first()).toBeVisible({ timeout: 30_000 });
    await audit(page, 'doctor-patient');

    await overview.getByRole('button', { name: 'Все графики на весь экран' }).click();
    await expect(page.locator('.diary-chart--combined')).toBeVisible();
    await audit(page, 'doctor-charts');
    await page.goBack();

    await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
    await expect(page.locator('.screen-editor')).toBeVisible({ timeout: 30_000 });
    await audit(page, 'doctor-editor');
  });
});
