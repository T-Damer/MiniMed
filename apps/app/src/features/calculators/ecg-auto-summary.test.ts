import { describe, expect, it } from 'vitest';
import { summarizeEcgAutoMarkup } from './ecg-auto-summary';
import { ECG_STANDARD_LEADS, type EcgDigitizationResult } from './ecg-model-contract';

const line = { start: { x: 0.1, y: 0.1 }, end: { x: 0.3, y: 0.1 } };
const base: EcgDigitizationResult = {
  durationSeconds: 5,
  gridPixelsPerMillimeter: 4,
  heartRate: 64,
  layout: '12x1',
  leads: ECG_STANDARD_LEADS.map((name) => ({
    coverage: 0.95,
    durationSeconds: 5,
    name,
    reviewed: false,
    samples: new Float32Array(),
    source: 'photo-auto',
    startSecond: 0,
  })),
  quality: 'usable',
  qualityIssues: [],
  qualityReasons: [],
  rhythmCoverage: 0.97,
  rrIntervalsMs: [940, 940],
  rrMs: 940,
  sampleRateHz: 100,
};

const status = (items: ReturnType<typeof summarizeEcgAutoMarkup>) =>
  Object.fromEntries(items.map((item) => [item.id, item.status]));

describe('automatic ECG markup summary', () => {
  it('keeps speed and rhythm as review targets even when every lead was found', () => {
    const items = summarizeEcgAutoMarkup(base, { horizontal: line, vertical: line });
    expect(status(items)).toEqual({
      grid: 'found',
      speed: 'review',
      leads: 'found',
      rhythm: 'review',
      photo: 'found',
    });
    expect(items.find((item) => item.id === 'rhythm')?.detail).toContain('около 32');
  });

  it('reports missing axes, leads, heart rate and blocking photo defects', () => {
    const { heartRate: _heartRate, ...withoutRate } = base;
    const items = summarizeEcgAutoMarkup(
      {
        ...withoutRate,
        quality: 'failed',
        leads: [],
        qualityIssues: [
          {
            code: 'glare',
            detail: '',
            region: { x: 0, y: 0, width: 1, height: 1 },
            severity: 'blocking',
            title: 'Блик на кривых',
          },
        ],
      },
      { horizontal: line },
    );
    expect(status(items)).toEqual({
      grid: 'review',
      speed: 'review',
      leads: 'missing',
      rhythm: 'missing',
      photo: 'missing',
    });
    expect(items.find((item) => item.id === 'photo')?.detail).toBe('Блик на кривых');
  });
});
