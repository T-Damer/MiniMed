import { describe, expect, it } from 'vitest';

import {
  ECG_STANDARD_LEADS,
  type EcgDigitizationResult,
} from '@/features/calculators/ecg-model-contract';
import {
  canAcceptEcgAutomaticDraft,
  detectEcgLeadIntervals,
  detectEcgWaveMarkers,
  ecgAmplitudeSuggestions,
  ecgIntervalSuggestions,
} from '@/features/calculators/ecg-waveform-measurements';

function fixture(
  quality: EcgDigitizationResult['quality'],
  layout: EcgDigitizationResult['layout'] = '12x1',
): EcgDigitizationResult {
  const samples = new Float32Array(250);
  samples[95] = -0.2;
  samples[100] = 1.2;
  samples[105] = -0.5;
  samples[130] = 0.35;
  return {
    durationSeconds: 10,
    gridPixelsPerMillimeter: 4,
    layout,
    leads: ECG_STANDARD_LEADS.map((name) => ({
      coverage: 1,
      durationSeconds: 2.5,
      name,
      reviewed: false,
      samples,
      source: 'photo-auto',
      startSecond: 0,
    })),
    quality,
    qualityIssues: [],
    qualityReasons: [],
    rhythmCoverage: 1,
    heartRate: 60,
    rrIntervalsMs: [1_000, 1_000],
    rrMs: 1_000,
    sampleRateHz: 100,
  };
}

function realisticFixture(
  validLeadCount: number = ECG_STANDARD_LEADS.length,
): EcgDigitizationResult {
  const samples = new Float32Array(300).fill(0.12);
  for (let index = 76; index <= 90; index += 1) {
    samples[index] = (samples[index] ?? 0) + 0.18 * Math.sin(((index - 76) / 14) * Math.PI);
  }
  samples[98] = -0.2;
  samples[99] = -0.15;
  samples[101] = 0.8;
  samples[102] = 1.1;
  samples[103] = 0.8;
  samples[105] = -0.45;
  samples[106] = -0.35;
  samples[107] = -0.15;
  for (let index = 125; index <= 160; index += 1) {
    samples[index] = (samples[index] ?? 0) + 0.32 * Math.sin(((index - 125) / 35) * Math.PI);
  }
  const base = fixture('usable');
  return {
    ...base,
    leads: ECG_STANDARD_LEADS.map((name, index) => {
      const lead = base.leads[index];
      if (!lead) throw new Error(`Missing fixture lead ${name}`);
      return {
        ...lead,
        name,
        samples: index < validLeadCount ? samples : new Float32Array(samples.length),
      };
    }),
  };
}

describe('numeric suggestions from digitized ECG waveforms', () => {
  it('finds editable Q/R/S/T drafts but never exports them for a non-usable image', () => {
    const usable = fixture('usable');
    const firstLead = usable.leads[0];
    expect(firstLead).toBeDefined();
    if (!firstLead) return;
    const markers = detectEcgWaveMarkers(firstLead, 100, 1_000);
    expect(markers.map((marker) => marker.wave)).toEqual(['Q', 'R', 'S', 'T']);
    expect(markers.map((marker) => marker.amplitudeMv)).toEqual([
      expect.closeTo(-0.2, 3),
      expect.closeTo(1.2, 3),
      expect.closeTo(-0.5, 3),
      expect.closeTo(0.35, 3),
    ]);
    expect(ecgAmplitudeSuggestions(usable)).toMatchObject({
      R_Amp_II: 1.2,
      S_Amp_V1: -0.5,
      T_Amp_aVR: 0.35,
    });
    expect(Object.keys(ecgAmplitudeSuggestions(usable))).toHaveLength(24);
    expect(ecgAmplitudeSuggestions(fixture('review'))).toEqual({});
  });

  it('accepts an automatic draft only after the fixed recording profile is confirmed', () => {
    expect(canAcceptEcgAutomaticDraft(fixture('usable'), false)).toBe(false);
    expect(canAcceptEcgAutomaticDraft(fixture('usable'), true)).toBe(true);
    expect(canAcceptEcgAutomaticDraft(fixture('usable', '3x4+1R'), true)).toBe(false);
    expect(canAcceptEcgAutomaticDraft(fixture('review'), true)).toBe(false);
  });

  it('delineates a realistic twelve-lead P-QRS-T draft and abstains without lead support', () => {
    const realistic = realisticFixture();
    const firstLead = realistic.leads[0];
    expect(firstLead).toBeDefined();
    if (!firstLead) return;
    const detection = detectEcgLeadIntervals(firstLead, 100, 1_000);
    expect(detection).toBeDefined();
    if (!detection) return;
    const durationMs = (range: { readonly end: number; readonly start: number } | undefined) =>
      range ? (range.end - range.start) * 10 : 0;
    expect(durationMs(detection.ranges.p)).toBeGreaterThanOrEqual(100);
    expect(durationMs(detection.ranges.p)).toBeLessThanOrEqual(160);
    expect(durationMs(detection.ranges.pr)).toBeGreaterThanOrEqual(150);
    expect(durationMs(detection.ranges.pr)).toBeLessThanOrEqual(220);
    expect(durationMs(detection.ranges.qrs)).toBeGreaterThanOrEqual(80);
    expect(durationMs(detection.ranges.qrs)).toBeLessThanOrEqual(140);
    expect(durationMs(detection.ranges.qt)).toBeGreaterThanOrEqual(560);
    expect(durationMs(detection.ranges.qt)).toBeLessThanOrEqual(640);

    const suggestions = ecgIntervalSuggestions(realistic);
    expect(suggestions.heartRate).toBe(60);
    expect(suggestions.qrsMs).toBeGreaterThanOrEqual(80);
    expect(suggestions.qrsMs).toBeLessThanOrEqual(140);
    expect(suggestions.pDurationMs).toBeUndefined();
    expect(suggestions.prMs).toBeUndefined();
    expect(suggestions.qtMs).toBeUndefined();
    expect(suggestions.qtcFraminghamMs).toBeUndefined();

    const baselineQrs = suggestions.qrsMs;
    const widerInFourLeads = {
      ...realistic,
      leads: realistic.leads.map((lead, leadIndex) => ({
        ...lead,
        samples:
          leadIndex < 8
            ? lead.samples
            : Float32Array.from(lead.samples, (value, sampleIndex) => {
                if (sampleIndex === 108) return -0.35;
                if (sampleIndex === 109) return -0.2;
                if (sampleIndex === 110) return -0.1;
                return value;
              }),
      })),
    } satisfies EcgDigitizationResult;
    expect(ecgIntervalSuggestions(widerInFourLeads).qrsMs).toBeGreaterThan(baselineQrs ?? 0);

    const independentlySupported = realisticFixture();
    expect(
      ecgIntervalSuggestions({
        ...independentlySupported,
        leads: independentlySupported.leads.map((lead, leadIndex) => ({
          ...lead,
          samples: Float32Array.from(lead.samples, (value, sampleIndex) =>
            (leadIndex < 4 && sampleIndex >= 76 && sampleIndex <= 90) ||
            (leadIndex >= 8 && sampleIndex >= 125 && sampleIndex <= 160)
              ? 0.12
              : value,
          ),
        })),
      }),
    ).toMatchObject({
      qrsMs: expect.any(Number),
    });
    expect(ecgIntervalSuggestions(fixture('review'))).toEqual({});
    expect(ecgIntervalSuggestions(realisticFixture(4))).toEqual({});
    expect(
      ecgIntervalSuggestions({
        ...realisticFixture(),
        leads: realisticFixture().leads.map((lead) => ({
          ...lead,
          samples: new Float32Array(lead.samples.length),
        })),
      }),
    ).toEqual({});
    const noisy = realisticFixture();
    expect(
      ecgIntervalSuggestions({
        ...noisy,
        leads: noisy.leads.map((lead) => ({
          ...lead,
          samples: Float32Array.from(
            { length: lead.samples.length },
            (_, index) => 0.35 * Math.sin(index * 2.7) + 0.2 * Math.cos(index * 1.9),
          ),
        })),
      }),
    ).toEqual({});
  });
});
