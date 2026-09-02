import { describe, expect, it } from 'vitest';

import {
  calculateEcgMeasurements,
  rescaleEcgPointPair,
  shiftEcgPointPair,
} from '@/features/calculators/ecg-photo-caliper';
import {
  type EcgMorphologyObservations,
  interpretAdultEcgMeasurements,
  interpretEcgPhoto,
} from '@/features/calculators/ecg-photo-interpreter';
import {
  assessEcgPhotoQuality,
  estimateCalibrationPixelsPerMillimeter,
} from '@/features/calculators/ecg-photo-quality';
import {
  enhanceSignalWithBlueInk,
  estimateGridSpacing,
  estimateRrIntervalsMs,
  extractDigitizedEcg,
  findTraceRows,
} from '@/features/calculators/ecg-waveform-digitizer';

it('adds blue trace evidence without changing images that have no blue ink', () => {
  const signal = Float32Array.from([0.1, 0.2]);
  const unchanged = enhanceSignalWithBlueInk(
    signal,
    Uint8Array.from([160, 30, 20, 100, 90, 60]),
    2,
  );
  expect(unchanged.detected).toBe(false);
  expect(unchanged.signalProbability).toBe(signal);

  const pixels = 1_000;
  const rgb = new Uint8Array(pixels * 3).fill(120);
  for (let pixel = 0; pixel < 3; pixel += 1) {
    rgb[pixel * 3] = 10;
    rgb[pixel * 3 + 1] = 40;
    rgb[pixel * 3 + 2] = 180;
  }
  const enhanced = enhanceSignalWithBlueInk(new Float32Array(pixels), rgb, 100);
  expect(enhanced.detected).toBe(true);
  expect(enhanced.signalProbability[0]).toBe(1);
  expect(enhanced.signalProbability[4]).toBe(0);

  const grid = new Uint8Array(100 * 100 * 3).fill(120);
  for (let y = 0; y < 100; y += 1) {
    for (let x = 0; x < 100; x += 1) {
      if (x % 10 !== 0 && y % 10 !== 0) continue;
      const offset = (y * 100 + x) * 3;
      grid[offset] = 10;
      grid[offset + 1] = 40;
      grid[offset + 2] = 180;
    }
  }
  expect(enhanceSignalWithBlueInk(new Float32Array(10_000), grid, 100).detected).toBe(false);
});

it('localizes blocking photo defects without flagging a sharp calibrated sheet', () => {
  const width = 128;
  const height = 128;
  const sharp = new Uint8Array(width * height * 3).fill(252);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x % 8 !== 0 && y % 8 !== 0) continue;
      const offset = (y * width + x) * 3;
      sharp[offset] = 226;
      sharp[offset + 1] = 178;
      sharp[offset + 2] = 178;
    }
    for (const x of [6, 7]) {
      const offset = (y * width + x) * 3;
      sharp[offset] = 30;
      sharp[offset + 1] = 30;
      sharp[offset + 2] = 30;
    }
  }
  expect(assessEcgPhotoQuality({ height, layout: '12x1', rgb: sharp, width })).toEqual([]);

  const flat = new Uint8Array(width * height * 3).fill(180);
  expect(
    assessEcgPhotoQuality({ height, layout: '12x1', rgb: flat, width }).map((issue) => issue.code),
  ).toEqual(['blur', 'missing-calibration']);

  const glare = Uint8Array.from(sharp);
  for (let y = 40; y < 88; y += 1) {
    for (let x = 40; x < 88; x += 1) {
      glare.fill(255, (y * width + x) * 3, (y * width + x) * 3 + 3);
    }
  }
  expect(
    assessEcgPhotoQuality({ height, layout: '12x1', rgb: glare, width }).some(
      (issue) => issue.code === 'glare' && issue.region.width > 0.2,
    ),
  ).toBe(true);

  const whiteHeader = Uint8Array.from(sharp);
  whiteHeader.fill(255, 0, width * 32 * 3);
  expect(
    assessEcgPhotoQuality({ height, layout: '12x1', rgb: whiteHeader, width }).some(
      (issue) => issue.code === 'glare',
    ),
  ).toBe(false);

  const sparseHeaderText = new Uint8Array(width * height * 3).fill(240);
  for (let y = 40; y < 88; y += 1) {
    for (let x = 40; x < 88; x += 1) {
      sparseHeaderText.fill(255, (y * width + x) * 3, (y * width + x) * 3 + 3);
    }
  }
  for (const startY of [32, 88]) {
    for (let y = startY; y < startY + 8; y += 1) {
      for (let x = 40; x < 88; x += 12) {
        sparseHeaderText.fill(80, (y * width + x) * 3, (y * width + x) * 3 + 3);
      }
    }
  }
  expect(
    assessEcgPhotoQuality({ height, layout: '12x1', rgb: sparseHeaderText, width }).some(
      (issue) => issue.code === 'glare',
    ),
  ).toBe(false);

  expect(
    assessEcgPhotoQuality({
      corners: {
        bottomLeft: { x: 0, y: 0.9 },
        bottomRight: { x: 0.9, y: 0.9 },
        topLeft: { x: 0, y: 0.1 },
        topRight: { x: 0.9, y: 0.1 },
      },
      height,
      layout: '12x1',
      rgb: sharp,
      width,
    }).some((issue) => issue.code === 'cropped-paper'),
  ).toBe(true);
});

it('measures a repeated 1 mV calibration pulse as 10 mm', () => {
  const width = 240;
  const height = 240;
  const rgb = new Uint8Array(width * height * 3).fill(252);
  for (let band = 0; band < 12; band += 1) {
    for (let y = band * 20 + 5; y < band * 20 + 15; y += 1) {
      rgb.fill(20, (y * width + 12) * 3, (y * width + 12) * 3 + 3);
    }
  }
  expect(estimateCalibrationPixelsPerMillimeter({ height, layout: '12x1', rgb, width })).toBe(1);
});

describe('ECG photo caliper', () => {
  it('converts calibrated pixel distances into intervals, heart rate and QTc', () => {
    expect(
      calculateEcgMeasurements(
        {
          rr: { start: 0, end: 100 },
          p: { start: 0, end: 15 },
          pr: { start: 0, end: 20 },
          qrs: { start: 0, end: 10 },
          qt: { start: 0, end: 40 },
        },
        5,
      ),
    ).toEqual({
      rrMs: 400,
      heartRate: 150,
      pDurationMs: 60,
      prMs: 80,
      qrsMs: 40,
      qtMs: 160,
      qtcBazettMs: 253,
      qtcFridericiaMs: 217,
      qtcFraminghamMs: 252,
    });
  });

  it('uses the fixed 50 mm/s profile (20 ms per grid millimeter)', () => {
    expect(
      calculateEcgMeasurements({ rr: { start: 0, end: 500 }, pr: { start: 0, end: 10 } }, 10),
    ).toMatchObject({
      rrMs: 1000,
      heartRate: 60,
      prMs: 20,
    });
  });

  it('moves a caliper without changing its width or leaving the image', () => {
    expect(shiftEcgPointPair({ start: 20, end: 50 }, -40, 100)).toEqual({ start: 0, end: 30 });
    expect(shiftEcgPointPair({ start: 20, end: 50 }, 80, 100)).toEqual({ start: 70, end: 100 });
  });

  it('preserves calibrated measurements when the displayed image width changes', () => {
    const calibration = rescaleEcgPointPair({ start: 100, end: 350 }, 1_000, 2_000);
    const qrs = rescaleEcgPointPair({ start: 400, end: 450 }, 1_000, 2_000);

    expect(calibration).toEqual({ start: 200, end: 700 });
    expect(qrs).toEqual({ start: 800, end: 900 });
    expect(
      calculateEcgMeasurements({ qrs }, Math.abs(calibration.end - calibration.start) / 25),
    ).toMatchObject({ qrsMs: 100 });
  });

  it('blocks interpretation until adult confirmation, image quality and calibration pass', () => {
    const blocked = interpretEcgPhoto({
      adultConfirmed: false,
      recordingProfileConfirmed: false,
      imageWidth: 800,
      imageHeight: 1200,
      pixelsPerMillimeter: 0,
      measurements: { rrMs: 800, heartRate: 75 },
    });

    expect(blocked.eligible).toBe(false);
    expect(blocked.status).toBe('not-eligible');
    expect(blocked.findings).toEqual([]);
    expect(blocked.eligibility.issues.map((issue) => issue.id)).toEqual([
      'adult-confirmation-required',
      'recording-profile-confirmation-required',
      'image-too-small',
      'image-not-horizontal',
      'grid-calibration-required',
    ]);
  });

  it('keeps adult screening boundaries and avoids morphology diagnoses', () => {
    const normal = interpretEcgPhoto({
      adultConfirmed: true,
      recordingProfileConfirmed: true,
      imageWidth: 1200,
      imageHeight: 600,
      pixelsPerMillimeter: 5,
      measurements: {
        rrMs: 1200,
        heartRate: 50,
        prMs: 120,
        qrsMs: 119,
        qtcFridericiaMs: 470,
      },
    });
    expect(normal.status).toBe('normal');
    expect(normal.findings.map((finding) => finding.id)).toEqual([
      'heart-rate-within-screening-range',
      'pr-within-screening-range',
      'qrs-within-screening-range',
      'qtc-within-screening-range',
    ]);

    const findings = interpretEcgPhoto({
      adultConfirmed: true,
      recordingProfileConfirmed: true,
      imageWidth: 1200,
      imageHeight: 600,
      pixelsPerMillimeter: 5,
      measurements: {
        heartRate: 100,
        prMs: 201,
        qrsMs: 120,
        qtcFridericiaMs: 500,
      },
    });
    expect(findings.status).toBe('urgent-review');
    expect(findings.findings.map((finding) => finding.id)).toEqual([
      'heart-rate-tachycardia',
      'pr-long',
      'qrs-wide',
      'qtc-wide-qrs-review',
    ]);
    expect(findings.findings.every((finding) => finding.sourceId.length > 0)).toBe(true);
    expect(findings.findings.every((finding) => finding.evidence.threshold.length > 0)).toBe(true);
    expect(findings.findings.map((finding) => finding.text).join(' ')).not.toMatch(
      /инфаркт|фибрилляц|RBBB|LBBB|блокад/i,
    );

    const lowerBoundaryFindings = interpretEcgPhoto({
      adultConfirmed: true,
      recordingProfileConfirmed: true,
      imageWidth: 1200,
      imageHeight: 600,
      pixelsPerMillimeter: 5,
      measurements: {
        heartRate: 49,
        prMs: 119,
        qrsMs: 119,
        qtcFridericiaMs: 499,
      },
    });
    expect(lowerBoundaryFindings.status).toBe('finding');
    expect(lowerBoundaryFindings.findings.map((finding) => finding.id)).toEqual([
      'heart-rate-bradycardia',
      'pr-short',
      'qrs-within-screening-range',
      'qtc-prolonged',
    ]);
  });

  it('uses Fridericia for screening when Bazett is inflated at high heart rate', () => {
    const result = interpretEcgPhoto({
      adultConfirmed: true,
      recordingProfileConfirmed: true,
      imageWidth: 1200,
      imageHeight: 600,
      pixelsPerMillimeter: 5,
      measurements: {
        rrMs: 400,
        heartRate: 150,
        qtMs: 320,
        qtcBazettMs: 506,
        qtcFridericiaMs: 434,
      },
    });

    expect(result.findings.map((finding) => finding.id)).toEqual([
      'heart-rate-tachycardia',
      'qtc-within-screening-range',
    ]);
    expect(result.findings.at(-1)?.evidence.formula).toBe('Fridericia');
    expect(result.status).toBe('finding');
  });

  it('reuses interval rules for manual numeric data without a photo gate', () => {
    const result = interpretAdultEcgMeasurements({
      measurements: {
        rrMs: 800,
        prMs: 220,
        qrsMs: 130,
        qtcFraminghamMs: 480,
      },
    });

    expect(result.findings.map((finding) => finding.id)).toEqual([
      'heart-rate-within-screening-range',
      'pr-long',
      'qrs-wide',
      'qtc-wide-qrs-review',
    ]);
    expect(result.findings.at(-1)?.evidence.formula).toBe('Framingham');
    expect(result.missingData).toEqual([]);
  });

  it('reports first-degree AV delay only when PR is long and 1:1 conduction is confirmed', () => {
    const findingIds = (prMs: number, oneToOneAvConduction: 'unknown' | 'present' | 'absent') =>
      interpretAdultEcgMeasurements({
        measurements: { prMs },
        morphology: { oneToOneAvConduction },
      }).findings.map((finding) => finding.id);

    expect(findingIds(201, 'present')).toEqual(['pr-long', 'first-degree-av-delay-pattern']);
    expect(findingIds(201, 'unknown')).toEqual(['pr-long']);
    expect(findingIds(201, 'absent')).toEqual(['pr-long']);
    expect(findingIds(200, 'present')).toEqual(['pr-within-screening-range']);
  });

  it('classifies confirmed AV-conduction sequences without guessing through incomplete or conflicting data', () => {
    const interpretation = (overrides: Partial<EcgMorphologyObservations>) =>
      interpretAdultEcgMeasurements({
        measurements: {},
        morphology: {
          distinctPWavesAbsent: 'absent',
          oneToOneAvConduction: 'absent',
          pacedQrs: 'absent',
          blockedPrematureAtrialBeatExcluded: 'present',
          ...overrides,
        },
      });
    const findingIds = (overrides: Partial<EcgMorphologyObservations>) =>
      interpretation(overrides).findings.map((finding) => finding.id);

    expect(
      findingIds({
        everySecondPConducted: 'present',
        periodicNonConductedPWaves: 'present',
        twoOrMoreConsecutiveNonConductedPWaves: 'absent',
        someAvConductionPresent: 'present',
        avDissociation: 'absent',
      }),
    ).toEqual(['two-to-one-av-conduction-pattern']);
    expect(
      findingIds({
        everySecondPConducted: 'absent',
        periodicNonConductedPWaves: 'present',
        twoOrMoreConsecutiveNonConductedPWaves: 'absent',
        someAvConductionPresent: 'present',
        avDissociation: 'absent',
        progressivePrBeforeDroppedQrs: 'present',
        constantPrAroundDroppedQrs: 'absent',
      }),
    ).toEqual(['mobitz-i-av-block-pattern']);
    expect(
      findingIds({
        everySecondPConducted: 'absent',
        periodicNonConductedPWaves: 'present',
        twoOrMoreConsecutiveNonConductedPWaves: 'absent',
        someAvConductionPresent: 'present',
        avDissociation: 'absent',
        progressivePrBeforeDroppedQrs: 'absent',
        constantPrAroundDroppedQrs: 'present',
      }),
    ).toEqual(['mobitz-ii-av-block-pattern']);
    expect(
      findingIds({
        everySecondPConducted: 'absent',
        periodicNonConductedPWaves: 'present',
        twoOrMoreConsecutiveNonConductedPWaves: 'present',
        someAvConductionPresent: 'present',
        avDissociation: 'absent',
      }),
    ).toEqual(['high-grade-av-block-pattern']);
    const complete = interpretation({
      everySecondPConducted: 'absent',
      twoOrMoreConsecutiveNonConductedPWaves: 'present',
      someAvConductionPresent: 'absent',
      avDissociation: 'present',
    });
    expect(complete.findings.map((finding) => finding.id)).toEqual(['complete-av-block-pattern']);
    expect(complete.status).toBe('urgent-review');
    expect(
      findingIds({
        everySecondPConducted: 'unknown',
        periodicNonConductedPWaves: 'present',
        twoOrMoreConsecutiveNonConductedPWaves: 'unknown',
        someAvConductionPresent: 'present',
        avDissociation: 'absent',
        progressivePrBeforeDroppedQrs: 'present',
        constantPrAroundDroppedQrs: 'present',
      }),
    ).toEqual([]);
    expect(
      findingIds({
        everySecondPConducted: 'absent',
        periodicNonConductedPWaves: 'present',
        twoOrMoreConsecutiveNonConductedPWaves: 'absent',
        someAvConductionPresent: 'present',
        avDissociation: 'absent',
        progressivePrBeforeDroppedQrs: 'present',
        constantPrAroundDroppedQrs: 'absent',
        blockedPrematureAtrialBeatExcluded: 'absent',
      }),
    ).toEqual([]);
    expect(
      findingIds({
        everySecondPConducted: 'absent',
        twoOrMoreConsecutiveNonConductedPWaves: 'present',
        someAvConductionPresent: 'present',
        avDissociation: 'present',
      }),
    ).toEqual([]);
  });

  it('reports WPW-type preexcitation only when all three adult criteria agree', () => {
    const findingIds = (prMs: number, qrsMs: number, deltaWave: 'unknown' | 'present' | 'absent') =>
      interpretAdultEcgMeasurements({
        measurements: { prMs, qrsMs },
        morphology: {
          deltaWave,
          rightPrecordialTerminalRPrime: 'present',
          lateralWideTerminalS: 'present',
        },
      }).findings.map((finding) => finding.id);

    expect(findingIds(119, 121, 'present')).toEqual([
      'pr-short',
      'qrs-wide',
      'wpw-type-preexcitation-pattern',
    ]);
    expect(findingIds(120, 121, 'present')).not.toContain('wpw-type-preexcitation-pattern');
    expect(findingIds(119, 120, 'present')).not.toContain('wpw-type-preexcitation-pattern');
    expect(findingIds(119, 121, 'unknown')).not.toContain('wpw-type-preexcitation-pattern');
  });

  it('reports an AF pattern only when all three visual criteria agree', () => {
    const findingIds = (overrides: Partial<EcgMorphologyObservations> = {}) =>
      interpretAdultEcgMeasurements({
        measurements: {},
        morphology: {
          rrIntervalsIrregular: 'present',
          distinctPWavesAbsent: 'present',
          fibrillatoryAtrialActivity: 'present',
          ...overrides,
        },
      }).findings.map((finding) => finding.id);

    expect(findingIds()).toEqual(['atrial-fibrillation-pattern']);
    expect(findingIds({ rrIntervalsIrregular: 'unknown' })).toEqual([]);
    expect(findingIds({ distinctPWavesAbsent: 'absent' })).toEqual([]);
    expect(findingIds({ fibrillatoryAtrialActivity: 'unknown' })).toEqual([]);
    expect(findingIds({ oneToOneAvConduction: 'present' })).toEqual([]);
  });

  it('uses sex-specific adult QTc thresholds and keeps the unknown-sex threshold conservative', () => {
    const findingId = (sex: 'female' | 'male' | 'unknown', qtcFraminghamMs: number) =>
      interpretAdultEcgMeasurements({ sex, measurements: { qtcFraminghamMs } }).findings[0]?.id;

    expect(findingId('female', 460)).toBe('qtc-prolonged');
    expect(findingId('male', 451)).toBe('qtc-prolonged');
    expect(findingId('male', 450)).toBe('qtc-within-screening-range');
    expect(findingId('unknown', 470)).toBe('qtc-within-screening-range');
  });

  it('reports a complete RBBB pattern only when duration and both morphology criteria agree', () => {
    const base = {
      adultConfirmed: true,
      recordingProfileConfirmed: true,
      imageWidth: 1200,
      imageHeight: 600,
      pixelsPerMillimeter: 5,
      measurements: { qrsMs: 128 },
    } as const;

    const incomplete = interpretEcgPhoto({
      ...base,
      morphology: { rightPrecordialTerminalRPrime: 'present' },
    });
    expect(incomplete.findings.map((finding) => finding.id)).toEqual(['qrs-wide']);

    const complete = interpretEcgPhoto({
      ...base,
      morphology: {
        rightPrecordialTerminalRPrime: 'present',
        lateralWideTerminalS: 'present',
      },
    });
    expect(complete.findings.map((finding) => finding.id)).toEqual([
      'qrs-wide',
      'complete-rbbb-pattern',
    ]);
    expect(complete.findings.at(-1)?.criteria).toHaveLength(3);
  });

  it('reports a complete LBBB pattern only with the full confirmed morphology set', () => {
    const result = interpretEcgPhoto({
      adultConfirmed: true,
      recordingProfileConfirmed: true,
      imageWidth: 1200,
      imageHeight: 600,
      pixelsPerMillimeter: 5,
      measurements: { qrsMs: 132 },
      morphology: {
        lateralBroadNotchedR: 'present',
        lateralQWaveAbsent: 'present',
        lateralRPeakTimeOver60Ms: 'present',
      },
    });

    expect(result.findings.map((finding) => finding.id)).toEqual([
      'qrs-wide',
      'complete-lbbb-pattern',
    ]);
    expect(result.findings.at(-1)?.text).toMatch(/признаки совместимы/i);
    expect(result.findings.at(-1)?.sourceId).toBe('aha-accf-hrs-2009-part-iii');
  });

  it('explains missing measurements instead of claiming a normal ECG', () => {
    const result = interpretEcgPhoto({
      adultConfirmed: true,
      recordingProfileConfirmed: true,
      imageWidth: 1200,
      imageHeight: 600,
      pixelsPerMillimeter: 5,
      measurements: {},
    });

    expect(result.status).toBe('requires-review');
    expect(result.findings).toEqual([]);
    expect(result.missingData.map((item) => item.id)).toEqual(['heart-rate', 'pr', 'qrs', 'qtc']);
  });

  it('extracts a fixed-layout waveform and RR from segmentation maps', () => {
    const width = 1024;
    const height = 512;
    const grid = new Float32Array(width * height).fill(0.05);
    const signal = new Float32Array(width * height).fill(0.05);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (x % 4 === 0 || y % 4 === 0) grid[y * width + x] = 0.8;
      }
    }
    const rows = [90, 200, 310, 420];
    for (let x = 0; x < width; x += 1) {
      const cycle = x % 200;
      const rhythmY = cycle >= 96 && cycle <= 104 ? 420 - (20 - Math.abs(cycle - 100) * 4) : 420;
      signal[90 * width + x] = 0.8;
      signal[(rhythmY - 220) * width + x] = 0.8;
      signal[310 * width + x] = 0.8;
      signal[rhythmY * width + x] = 0.8;
    }

    expect(
      estimateGridSpacing(Float32Array.from({ length: width }, (_, x) => (x % 4 ? 0 : 1))),
    ).toBe(4);
    expect(
      findTraceRows(Float32Array.from({ length: height }, (_, y) => (rows.includes(y) ? 1 : 0))),
    ).toEqual(rows);

    const result = extractDigitizedEcg({
      gridProbability: grid,
      height,
      pixelAspectRatio: 1,
      signalProbability: signal,
      width,
    });
    expect(result.quality).toBe('usable');
    expect(result.leads.map((lead) => lead.name)).toEqual([
      'I',
      'aVR',
      'V1',
      'V4',
      'II',
      'aVL',
      'V2',
      'V5',
      'III',
      'aVF',
      'V3',
      'V6',
    ]);
    expect(result.rrMs).toBeCloseTo(1000, -1);
    expect(result.heartRate).toBeCloseTo(60, 0);
    expect(result.rrIntervalsMs.length).toBeGreaterThanOrEqual(3);
    expect(result.rrIntervalsMs.every((interval) => Math.abs(interval - 1000) <= 20)).toBe(true);
    expect(result.rhythmLead).toMatchObject({
      coverage: 1,
      durationSeconds: result.durationSeconds,
      name: 'II',
      reviewed: false,
      source: 'photo-auto',
      startSecond: 0,
    });
    expect(result.rhythmLead?.samples).toHaveLength(
      Math.round(result.durationSeconds * result.sampleRateHz),
    );
  });

  it('extracts confident 12x1 rows as full-duration standard leads', () => {
    const width = 1200;
    const height = 768;
    const grid = new Float32Array(width * height).fill(0.05);
    const signal = new Float32Array(width * height).fill(0.05);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (x % 4 === 0 || y % 4 === 0) grid[y * width + x] = 0.8;
      }
    }
    const rows = Array.from({ length: 12 }, (_, index) => 36 + index * 62);
    for (let x = 0; x < width; x += 1) {
      if (x % 7 === 0) continue;
      const cycle = x % 200;
      for (const [index, row] of rows.entries()) {
        const y =
          index === 1 && cycle >= 96 && cycle <= 104 ? row - (20 - Math.abs(cycle - 100) * 4) : row;
        signal[y * width + x] = 0.8;
      }
    }

    const result = extractDigitizedEcg({
      gridProbability: grid,
      height,
      layoutHint: '12x1',
      pixelAspectRatio: 1,
      signalProbability: signal,
      width,
    });

    expect(result.quality).toBe('usable');
    expect(result.layout).toBe('12x1');
    expect(result.leads.map((lead) => lead.name)).toEqual([
      'I',
      'II',
      'III',
      'aVR',
      'aVL',
      'aVF',
      'V1',
      'V2',
      'V3',
      'V4',
      'V5',
      'V6',
    ]);
    expect(result.leads.every((lead) => lead.durationSeconds === result.durationSeconds)).toBe(
      true,
    );
    expect(result.leads.every((lead) => lead.startSecond === 0)).toBe(true);
    expect(result.durationSeconds).toBeCloseTo(6, 2);
    expect(result.rhythmLead?.name).toBe('II');
    expect(result.rrMs).toBeCloseTo(1000, -1);
    expect(result.heartRate).toBeCloseTo(60, 0);

    const calibrationFallback = extractDigitizedEcg({
      calibrationPixelsPerMillimeter: 4,
      gridProbability: new Float32Array(width * height),
      height,
      layoutHint: '12x1',
      pixelAspectRatio: 1,
      signalProbability: signal,
      width,
    });
    expect(calibrationFallback.quality).toBe('usable');
    expect(calibrationFallback.durationSeconds).toBe(6);
  });

  it('fails closed when signal noise does not support a 12-row layout', () => {
    const width = 1024;
    const height = 512;
    const grid = new Float32Array(width * height).fill(0.05);
    const signal = new Float32Array(width * height).fill(0.05);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (x % 4 === 0 || y % 4 === 0) grid[y * width + x] = 0.8;
        if ((x * 17 + y * 31) % 97 === 0) signal[y * width + x] = 0.8;
      }
    }

    const result = extractDigitizedEcg({
      gridProbability: grid,
      height,
      layoutHint: '12x1',
      pixelAspectRatio: 1,
      signalProbability: signal,
      width,
    });

    expect(result.quality).not.toBe('usable');
    expect(result.leads.filter((lead) => lead.coverage >= 0.7)).toEqual([]);
  });

  it('crops page margins from the segmented grid before splitting the lead columns', () => {
    const width = 1024;
    const height = 512;
    const left = 112;
    const right = 912;
    const top = 32;
    const bottom = 480;
    const grid = new Float32Array(width * height).fill(0.05);
    const signal = new Float32Array(width * height).fill(0.05);
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        if ((x - left) % 4 === 0 || (y - top) % 4 === 0) grid[y * width + x] = 0.8;
      }
    }
    for (let x = left; x < right; x += 1) {
      const cycle = (x - left) % 200;
      const rhythmY = cycle >= 96 && cycle <= 104 ? 420 - (20 - Math.abs(cycle - 100) * 4) : 420;
      signal[80 * width + x] = 0.8;
      signal[(rhythmY - 230) * width + x] = 0.8;
      signal[300 * width + x] = 0.8;
      signal[rhythmY * width + x] = 0.8;
    }

    const result = extractDigitizedEcg({
      gridProbability: grid,
      height,
      pixelAspectRatio: 1,
      signalProbability: signal,
      width,
    });

    expect(result.quality).toBe('usable');
    expect(result.leads).toHaveLength(12);
    expect(result.leads.every((lead) => lead.coverage >= 0.7)).toBe(true);
    expect(result.durationSeconds).toBeLessThan(4.5);
    expect(result.detectedGridCorners).toMatchObject({
      bottomLeft: { x: expect.closeTo(0.1, 1), y: expect.closeTo(0.95, 1) },
      topRight: { x: expect.closeTo(0.9, 1), y: expect.closeTo(0.05, 1) },
    });
  });

  it('calibrates time and voltage independently after anisotropic model resize', () => {
    const width = 1024;
    const height = 512;
    const grid = new Float32Array(width * height).fill(0.05);
    const signal = new Float32Array(width * height).fill(0.05);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (x % 4 === 0 || y % 8 === 0) grid[y * width + x] = 0.8;
      }
    }
    for (let x = 0; x < width; x += 1) {
      const cycle = x % 200;
      const rhythmY = cycle >= 96 && cycle <= 104 ? 420 - (20 - Math.abs(cycle - 100) * 4) : 420;
      signal[90 * width + x] = 0.8;
      signal[(rhythmY - 220) * width + x] = 0.8;
      signal[310 * width + x] = 0.8;
      signal[rhythmY * width + x] = 0.8;
    }

    const result = extractDigitizedEcg({
      gridProbability: grid,
      height,
      pixelAspectRatio: 2,
      signalProbability: signal,
      width,
    });

    expect(result.quality).toBe('usable');
    expect(result.durationSeconds).toBeCloseTo(5.12, 2);
    expect(Math.max(...(result.rhythmLead?.samples ?? []))).toBeCloseTo(0.25, 2);
  });

  it('requires review when repeated lead II disagrees with the rhythm strip', () => {
    const width = 1024;
    const height = 512;
    const grid = new Float32Array(width * height).fill(0.05);
    const signal = new Float32Array(width * height).fill(0.05);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (x % 4 === 0 || y % 4 === 0) grid[y * width + x] = 0.8;
      }
    }
    for (let x = 0; x < width; x += 1) {
      signal[90 * width + x] = 0.8;
      signal[(200 - (x % 100 === 50 ? 20 : 0)) * width + x] = 0.8;
      signal[310 * width + x] = 0.8;
      signal[(420 - (x % 160 === 80 ? 20 : 0)) * width + x] = 0.8;
    }

    const result = extractDigitizedEcg({
      gridProbability: grid,
      height,
      pixelAspectRatio: 1,
      signalProbability: signal,
      width,
    });

    expect(result.quality).toBe('review');
    expect(result.qualityReasons).toContain(
      'Повторное отведение II не совпало с ритм-строкой; проверьте перспективу фото.',
    );
  });

  it('does not count broad T waves as additional QRS complexes', () => {
    const rhythm = new Float32Array(500);
    for (const rPeak of [50, 150, 250, 350, 450]) {
      rhythm[rPeak - 1] = 0.2;
      rhythm[rPeak] = 1;
      rhythm[rPeak + 1] = 0.2;
      const tPeak = rPeak + 35;
      for (let offset = -10; offset <= 10; offset += 1) {
        rhythm[tPeak + offset] = 0.7 * (1 - Math.abs(offset) / 11);
      }
    }

    expect(estimateRrIntervalsMs(rhythm)).toEqual([1000, 1000, 1000, 1000]);
  });
});
