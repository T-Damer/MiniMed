import { describe, expect, it } from 'vitest';
import {
  type EcgEditorDraft,
  type EcgEditorPoint,
  ecgCalibrationScale,
  ecgRegionTemplate,
  measureEcgEditor,
  validEcgRegions,
} from './ecgEditor';
import { extractEcgEditorRegion } from './ecgReviewExtraction';
import { clampEcgView } from './useEcgViewport';

const calibration = {
  speed: 25 as const,
  gain: 10 as const,
  horizontal: { start: { x: 0.1, y: 0.1 }, end: { x: 0.35, y: 0.1 } },
  vertical: { start: { x: 0.1, y: 0.1 }, end: { x: 0.1, y: 0.2 } },
};
const region = { id: 'II', lead: 'II' as const, x: 0, y: 0, width: 1, height: 1 };
const points: EcgEditorPoint[] = [
  ['pOnset', 0.25],
  ['pOffset', 0.275],
  ['qrsOnset', 0.29],
  ['qrsOffset', 0.315],
  ['tOffset', 0.4],
  ['rPeak', 0.3],
  ['rPeak', 0.55],
  ['baseline', 0.3],
].map(([kind, x], index) => ({
  id: String(index),
  kind: kind as EcgEditorPoint['kind'],
  x: Number(x),
  y: kind === 'baseline' ? 0.55 : 0.45,
  regionId: 'II',
  source: 'manual',
}));
const draft: EcgEditorDraft = { calibration, regions: [region], points };

describe('semi-manual ECG measurement', () => {
  it('uses independently calibrated time and voltage, preserving physical points at either paper speed', () => {
    const result = measureEcgEditor(draft, 'II');
    expect(result.errors).toEqual([]);
    expect(result.measurements).toMatchObject({
      rrMs: 1000,
      heartRate: 60,
      pDurationMs: 100,
      prMs: 160,
      qrsMs: 100,
      qtMs: 440,
      qtcFridericiaMs: 440,
    });
    expect(result.rAmplitudeMv).toBeCloseTo(1);
    const faster = measureEcgEditor(
      { ...draft, calibration: { ...calibration, speed: 50, gain: 5 } },
      'II',
    );
    expect(faster.measurements).toMatchObject({ rrMs: 500, heartRate: 120, qtMs: 220 });
    expect(faster.rAmplitudeMv).toBeCloseTo(2);
  });

  it('does not mix lead fragments, accept reversed boundaries or treat missing T as a normal QT', () => {
    expect(
      measureEcgEditor({ ...draft, points: points.filter((p) => p.kind !== 'tOffset') }, 'II')
        .measurements.qtMs,
    ).toBeUndefined();
    const wrongLead = points.map((p) => (p.kind === 'tOffset' ? { ...p, regionId: 'V1' } : p));
    expect(
      measureEcgEditor({ ...draft, points: wrongLead }, 'II').measurements.qtMs,
    ).toBeUndefined();
    const wrongOrder = points.map((p) => (p.kind === 'qrsOffset' ? { ...p, x: 0.2 } : p));
    expect(measureEcgEditor({ ...draft, points: wrongOrder }, 'II').measurements).toEqual({});
    expect(
      ecgCalibrationScale({
        ...calibration,
        horizontal: { start: { x: 0.1, y: 0.1 }, end: { x: 0.35, y: 0.2 } },
      }),
    ).toBeUndefined();
    expect(validEcgRegions(ecgRegionTemplate('3x4+1R'))).toBe(true);
    expect(validEcgRegions(ecgRegionTemplate('12x1'))).toBe(true);
    expect(validEcgRegions(ecgRegionTemplate('12x1').slice(1))).toBe(false);
  });

  it('extracts the selected photo region and drafts landmarks from its calibrated waveform', () => {
    const width = 1000;
    const height = 300;
    const signalProbability = new Float32Array(width * height);
    for (let x = 0; x < width; x += 1) {
      const phase = x % 250;
      const r = Math.max(0, 1 - Math.abs(phase - 125) / 10) * 30;
      const p = Math.max(0, 1 - Math.abs(phase - 80) / 15) * 4;
      const t = Math.max(0, 1 - Math.abs(phase - 195) / 35) * 8;
      const y = Math.round(150 - r - p - t);
      signalProbability[y * width + x] = 1;
    }
    const maps = {
      width,
      height,
      signalProbability,
      gridProbability: new Float32Array(width * height),
    };
    const extraction = extractEcgEditorRegion(maps, { ...region, x: 0.1, width: 0.8 }, calibration);
    expect(extraction.coverage).toBeGreaterThan(0.99);
    expect(extraction.path).toContain('M100.00');
    expect(extraction.points.some((p) => p.kind === 'qrsOnset')).toBe(true);
    expect(extraction.points.filter((p) => p.kind === 'rPeak').length).toBeGreaterThanOrEqual(2);
    expect(extraction.points.every((p) => p.x >= 0.1 && p.x <= 0.9)).toBe(true);
    expect(
      extractEcgEditorRegion(maps, { ...region, y: 0.8, height: 0.1 }, calibration).points,
    ).toEqual([]);
  });

  it('keeps zoom and pan inside the image', () => {
    expect(clampEcgView({ x: -0.4, y: 1, width: 0.25, height: 0.3 })).toEqual({
      x: 0,
      y: 0.7,
      width: 0.25,
      height: 0.3,
    });
  });
});
