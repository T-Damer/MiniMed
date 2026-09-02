import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  generateEcgPhoneCapturePack,
  generateSyntheticEcgReference,
  renderEcgCapturePageSvg,
} from './generate-ecg-phone-capture-pack';

describe('ECG phone capture pack', () => {
  it('builds a deterministic physical 12x1/50/10 no-patient pack', () => {
    const parent = mkdtempSync(resolve(tmpdir(), 'minimed-ecg-capture-test-'));
    try {
      const firstOutput = resolve(parent, 'first');
      const secondOutput = resolve(parent, 'second');
      const first = generateEcgPhoneCapturePack(firstOutput, 2);
      const second = generateEcgPhoneCapturePack(secondOutput, 2);

      expect(first).toEqual(second);
      expect(first.cases.map((item) => item.split)).toEqual(['dev', 'test']);
      expect(JSON.stringify(first)).not.toMatch(/patient_id/iu);
      const firstCase = first.cases[0];
      if (!firstCase) throw new Error('Expected a generated capture case.');
      const referenceBytes = readFileSync(resolve(firstOutput, firstCase.reference_signal_file));
      expect(createHash('sha256').update(referenceBytes).digest('hex')).toBe(
        firstCase.reference_signal_sha256,
      );
      expect(readFileSync(resolve(firstOutput, firstCase.print_page_file), 'utf8')).toContain(
        'data-time-axis-mm="250"',
      );
      const html = readFileSync(resolve(firstOutput, 'capture-pack.html'), 'utf8');
      expect(html).toContain('Печатайте в масштабе 100%');
      expect(html).toContain('fit-to-page');
      expect(() => generateEcgPhoneCapturePack(firstOutput, 2)).toThrow(/already exists/iu);
      expect(() =>
        generateEcgPhoneCapturePack(resolve(process.cwd(), 'tools/benchmarks/forbidden-pack'), 2),
      ).toThrow(/outside the repository/iu);

      const reference = generateSyntheticEcgReference(0);
      expect(generateSyntheticEcgReference(0)).toEqual(reference);
      expect(reference.values_mV).toHaveLength(12);
      expect(reference.values_mV[0]).toHaveLength(2_500);
      const svg = renderEcgCapturePageSvg('geometry-check', reference);
      expect(svg).toContain('width="297mm" height="210mm"');
      expect(svg).toContain('50 mm/s · 10 mm/mV · 5.0 s');
      expect(svg).toContain('SYNTHETIC · NO PATIENT DATA');
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
