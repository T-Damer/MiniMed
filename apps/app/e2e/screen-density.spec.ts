import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';
import { densityFindings, measureScreenDensity, type ScreenDensity } from './screen-density';

/**
 * Screen density report (owner 2026-11-08, AGENTS.md «Fill the screen, avoid scrolling»): for each
 * main screen at phone and tablet width, the filled share of the first viewport, the largest empty
 * band, and whether it scrolls without being a list. It reports (attachment `density.json`,
 * `DENSITY_REPORT=<file>`) and fails only with `DENSITY_STRICT=1`: the thresholds are heuristics to
 * be calibrated on these numbers first (`e2e/screen-density.ts`).
 */
const SCREENS = [
  { name: 'home', hash: '#/search' },
  { name: 'calculators', hash: '#/calculators' },
  { name: 'ciwa-ar', hash: '#/calculators/minimed.calculator.ciwa-ar' },
  { name: 'assessments', hash: '#/assessments' },
  { name: 'tools', hash: '#/notes' },
  { name: 'patients', hash: '#/notes/patients' },
  { name: 'forms', hash: '#/notes/forms' },
  { name: 'news', hash: '#/news' },
  { name: 'settings', hash: '#/settings' },
] as const;

const DEVICES = [
  { device: 'phone', width: 390, height: 844 },
  { device: 'tablet', width: 1024, height: 768 },
] as const;

const STRICT = process.env['DENSITY_STRICT'] === '1';

for (const { device, width, height } of DEVICES) {
  test(`screen density at ${device} width`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width, height });
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    const report: Record<string, ScreenDensity & { readonly findings: readonly string[] }> = {};
    for (const screen of SCREENS) {
      await page.goto(`${E2E_ASSET_ORIGIN}/${screen.hash}`);
      await page.evaluate(() => document.fonts.ready);
      // Entrances, lazy chunks and skeletons settle (one loading state, then the content): measure
      // until two readings 400 ms apart agree.
      let density = await page.evaluate(measureScreenDensity);
      for (let attempt = 0; attempt < 15; attempt += 1) {
        await page.waitForTimeout(400);
        const next = await page.evaluate(measureScreenDensity);
        const settled =
          Math.abs(next.coverage - density.coverage) < 0.005 && next.scrolls === density.scrolls;
        density = next;
        if (settled && attempt >= 1) break;
      }
      const findings = densityFindings(density, device);
      report[screen.name] = { ...density, findings };
      if (STRICT) expect.soft(findings, `${screen.name} at ${device}`).toEqual([]);
    }
    const json = JSON.stringify(report, null, 2);
    await testInfo.attach(`density-${device}.json`, {
      body: json,
      contentType: 'application/json',
    });
    const target = process.env['DENSITY_REPORT'];
    if (target) {
      mkdirSync(target, { recursive: true });
      writeFileSync(`${target}/density-${device}.json`, json);
    }
    // The measurement itself must work on every screen.
    for (const [name, density] of Object.entries(report)) {
      expect(density.coverage, name).toBeGreaterThan(0);
    }
  });
}
