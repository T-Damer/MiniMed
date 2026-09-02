import { describe, expect, it } from 'vitest';
import { analyzeEcgAvSequence, parseEcgEventTimes } from '@/features/calculators/ecg-av-sequence';

describe('ECG AV event sequence', () => {
  it('parses ordered millisecond markers and rejects invalid sequences', () => {
    expect(parseEcgEventTimes('0, 800  1600;2400')).toEqual({ values: [0, 800, 1600, 2400] });
    expect(parseEcgEventTimes('0, 800, 800').error).toContain('возрастанию');
    expect(parseEcgEventTimes('0, nope, 800').error).toContain('миллисекундах');
  });

  it('drafts one-to-one, Mobitz I, Mobitz II and 2:1 observations from event times', () => {
    const oneToOne = analyzeEcgAvSequence({
      pOnsetsMs: [0, 800, 1600, 2400, 3200],
      qrsOnsetsMs: [180, 980, 1780, 2580, 3380],
    });
    expect(oneToOne.pattern).toBe('one-to-one');
    expect(oneToOne.morphology.oneToOneAvConduction).toBe('present');

    const mobitzI = analyzeEcgAvSequence({
      pOnsetsMs: [0, 800, 1600, 2400, 3200, 4000, 4800, 5600],
      qrsOnsetsMs: [160, 1000, 1840, 3360, 4200, 5040],
    });
    expect(mobitzI.pattern).toBe('mobitz-i');
    expect(mobitzI.morphology).toMatchObject({
      constantPrAroundDroppedQrs: 'absent',
      periodicNonConductedPWaves: 'present',
      progressivePrBeforeDroppedQrs: 'present',
      twoOrMoreConsecutiveNonConductedPWaves: 'absent',
    });

    const mobitzII = analyzeEcgAvSequence({
      pOnsetsMs: [0, 800, 1600, 2400, 3200, 4000, 4800, 5600],
      qrsOnsetsMs: [200, 1000, 2600, 3400, 5000, 5800],
    });
    expect(mobitzII.pattern).toBe('mobitz-ii');
    expect(mobitzII.morphology.constantPrAroundDroppedQrs).toBe('present');

    const twoToOne = analyzeEcgAvSequence({
      pOnsetsMs: [0, 800, 1600, 2400, 3200, 4000, 4800],
      qrsOnsetsMs: [180, 1780, 3380, 4980],
    });
    expect(twoToOne.pattern).toBe('two-to-one');
    expect(twoToOne.morphology.everySecondPConducted).toBe('present');
  });

  it('distinguishes high-grade nonconduction and AV dissociation', () => {
    const highGrade = analyzeEcgAvSequence({
      pOnsetsMs: [0, 800, 1600, 2400, 3200, 4000, 4800, 5600],
      qrsOnsetsMs: [180, 2580, 3380, 5780],
    });
    expect(highGrade.pattern).toBe('high-grade');
    expect(highGrade.morphology).toMatchObject({
      avDissociation: 'absent',
      someAvConductionPresent: 'present',
      twoOrMoreConsecutiveNonConductedPWaves: 'present',
    });

    const dissociation = analyzeEcgAvSequence({
      pOnsetsMs: [0, 700, 1400, 2100, 2800, 3500, 4200, 4900, 5600, 6300],
      qrsOnsetsMs: [500, 1900, 3300, 4700, 6100],
    });
    expect(dissociation.pattern).toBe('av-dissociation');
    expect(dissociation.morphology).toMatchObject({
      avDissociation: 'present',
      oneToOneAvConduction: 'absent',
      someAvConductionPresent: 'absent',
      twoOrMoreConsecutiveNonConductedPWaves: 'present',
    });
  });

  it('abstains when there are too few events or no stable interpretable relation', () => {
    expect(analyzeEcgAvSequence({ pOnsetsMs: [0, 800], qrsOnsetsMs: [180, 980] }).pattern).toBe(
      'insufficient',
    );
    expect(
      analyzeEcgAvSequence({
        pOnsetsMs: [0, 500, 1400, 2200, 3900],
        qrsOnsetsMs: [650, 1700, 3100, 5200],
      }).pattern,
    ).toBe('unclassified');
  });
});
