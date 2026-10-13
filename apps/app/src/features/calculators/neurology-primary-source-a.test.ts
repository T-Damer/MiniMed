import { describe, expect, it } from 'vitest';

import { evaluateCalculatorSchema } from '@/features/calculators/calculator-schema-engine';
import { loadToolModuleCalculatorSchemas } from '@/features/calculators/tool-module-test-helpers';

/**
 * Primary-source verification of NIHSS, Hunt-Hess, Hoehn-Yahr (original and modified) and the ASIA
 * impairment scale (2026-10-13). Sources actually read in full:
 *  - NIHSS: item scales and the 1-4 / 5-15 / 16-20 / 21-42 bands of the current Russian clinical
 *    recommendations "Ischaemic stroke and TIA" (ID 814, 2024), Appendix G (full NIHSS, Russian
 *    translation of the NIH scale), and "Haemorrhagic stroke" (ID 523) Appendix G17.
 *  - Hunt-Hess: stages I-V and the one-grade shift for serious systemic disease / vasospasm from
 *    Appendix G1 of the Russian clinical recommendations "Haemorrhagic stroke" (ID 523, 2025).
 *  - Hoehn-Yahr: modified stages 0-5 as reproduced from Goetz 2004 in open-access PMC5676002.
 *  - ASIA: grades A-E and the sacral-sparing / "half of the key muscles" rules, Kirshblum 2011 full
 *    text (J Spinal Cord Med 34:535, PMC3232636).
 */
const SCHEMAS = loadToolModuleCalculatorSchemas(['content/tool-modules/neurology-rehab.json']);
type Inputs = Record<string, number | string>;

function run(name: string, inputs: Inputs) {
  const schema = SCHEMAS.find((candidate) => candidate.id === `minimed.calculator.${name}`);
  if (!schema) throw new Error(`Missing calculator ${name}`);
  const result = evaluateCalculatorSchema(schema, inputs);
  if (!result.ok) throw new Error(`${name}: ${result.error}`);
  const output = result.outputs[0];
  if (output?.kind !== 'number') throw new Error(`${name}: expected a numeric output`);
  return {
    score: output.value,
    range: result.evaluation.verdict?.rangeId,
    explanation: result.evaluation.verdict?.explanation,
    interpretation: result.warnings.find((warning) => warning.code === 'interpretation')?.message,
  };
}

const NIHSS_ZERO: Inputs = {
  loc: 0,
  locQuestions: 0,
  locCommands: 0,
  gaze: 0,
  visual: 0,
  facial: 0,
  armLeft: 0,
  armRight: 0,
  legLeft: 0,
  legRight: 0,
  ataxia: 0,
  sensory: 0,
  language: 0,
  dysarthria: 0,
  extinction: 0,
};

describe('NIHSS against the Russian clinical recommendations (Appendix G)', () => {
  it('scores a hand-computed case line by line', () => {
    // 1a 1 + 1b 1 + 1c 0 + gaze 1 + fields 2 + face 1 + L arm 0 + R arm 3 + L leg 0 + R leg 2
    // + ataxia 0 + sensory 1 + language 2 + dysarthria 1 + extinction 1 = 16
    const result = run('nihss', {
      ...NIHSS_ZERO,
      loc: 1,
      locQuestions: 1,
      gaze: 1,
      visual: 2,
      facial: 1,
      armRight: 3,
      legRight: 2,
      sensory: 1,
      language: 2,
      dysarthria: 1,
      extinction: 1,
    });
    expect(result.score).toBe(16);
    expect(result.range).toBe('moderate-severe');
  });

  it('reaches the printed maximum of 42 with the printed per-line maxima', () => {
    const result = run('nihss', {
      loc: 3,
      locQuestions: 2,
      locCommands: 2,
      gaze: 2,
      visual: 3,
      facial: 3,
      armLeft: 4,
      armRight: 4,
      legLeft: 4,
      legRight: 4,
      ataxia: 2,
      sensory: 2,
      language: 3,
      dysarthria: 2,
      extinction: 2,
    });
    expect(result.score).toBe(42);
    expect(result.range).toBe('severe');
  });

  it('uses the bands 0 / 1-4 / 5-15 / 16-20 / 21-42 printed in the recommendations', () => {
    const bands: ReadonlyArray<readonly [Inputs, number, string]> = [
      [NIHSS_ZERO, 0, 'no-symptoms'],
      [{ ...NIHSS_ZERO, armLeft: 4 }, 4, 'minor'],
      [{ ...NIHSS_ZERO, armLeft: 4, facial: 1 }, 5, 'moderate'],
      [{ ...NIHSS_ZERO, armLeft: 4, armRight: 4, legLeft: 4, facial: 3 }, 15, 'moderate'],
      [
        { ...NIHSS_ZERO, armLeft: 4, armRight: 4, legLeft: 4, facial: 3, sensory: 1 },
        16,
        'moderate-severe',
      ],
      [
        { ...NIHSS_ZERO, armLeft: 4, armRight: 4, legLeft: 4, legRight: 4, visual: 3, sensory: 1 },
        20,
        'moderate-severe',
      ],
      [
        { ...NIHSS_ZERO, armLeft: 4, armRight: 4, legLeft: 4, legRight: 4, visual: 3, sensory: 2 },
        21,
        'severe',
      ],
    ];
    for (const [inputs, score, range] of bands) {
      const result = run('nihss', inputs);
      expect(result.score).toBe(score);
      expect(result.range).toBe(range);
      expect(result.interpretation).toBe(result.explanation);
    }
  });
});

describe('Hunt-Hess against Appendix G1 of the haemorrhagic stroke recommendations', () => {
  it('maps grades I-V and shifts one grade for serious systemic disease or vasospasm', () => {
    for (let grade = 1; grade <= 5; grade += 1) {
      const result = run('hunt-hess', { clinicalGrade: grade, systemicShift: 0 });
      expect(result.score).toBe(grade);
      expect(result.range).toBe(`grade-${grade}`);
    }
    // "next less favourable category": II + serious systemic disease -> III; V stays V.
    expect(run('hunt-hess', { clinicalGrade: 2, systemicShift: 1 }).score).toBe(3);
    expect(run('hunt-hess', { clinicalGrade: 4, systemicShift: 1 }).range).toBe('grade-5');
    expect(run('hunt-hess', { clinicalGrade: 5, systemicShift: 1 }).score).toBe(5);
  });

  it('keeps the printed grade II wording: moderate to severe headache, only cranial nerve palsy', () => {
    const schema = SCHEMAS.find((candidate) => candidate.id === 'minimed.calculator.hunt-hess');
    const input = schema?.inputs.find((candidate) => candidate.id === 'clinicalGrade');
    const grade2 = input?.options?.find((option) => String(option.value) === '2');
    expect(grade2?.label).toContain('умеренная или сильная головная боль');
    expect(grade2?.label).toContain('паралича черепных нервов');
  });
});

describe('Hoehn-Yahr against Goetz 2004 (modified stages) and Hoehn & Yahr 1967', () => {
  it('returns the stage chosen, including the half stages of the modified scale', () => {
    for (const stage of [0, 1, 1.5, 2, 2.5, 3, 4, 5]) {
      const result = run('hoehn-yahr-modified', { stage });
      expect(result.score).toBe(stage);
      expect(result.range).toBe(`stage-${String(stage).replace('.', '-')}`);
    }
    expect(run('hoehn-yahr-modified', { stage: 2.5 }).explanation).toContain('тест');
    for (const stage of [1, 2, 3, 4, 5]) {
      expect(run('hoehn-yahr', { stage }).range).toBe(`stage-${stage}`);
    }
  });
});

describe('ASIA impairment scale against Kirshblum 2011 (Standards, step 5)', () => {
  const base: Inputs = {
    normalAll: 0,
    voluntaryAnalContraction: 0,
    sacralSensory: 0,
    motorBelowLevel: 0,
    halfKeyMuscles: 0,
  };

  it('A: no sacral sparing at all', () => {
    expect(run('asia-ais', base).range).toBe('ais-a');
  });

  it('B: sacral sensory sparing without motor function more than three levels below', () => {
    expect(run('asia-ais', { ...base, sacralSensory: 1 }).range).toBe('ais-b');
  });

  it('C or D: voluntary anal contraction, or sacral sensation plus motor sparing > 3 levels below', () => {
    expect(run('asia-ais', { ...base, voluntaryAnalContraction: 1 }).range).toBe('ais-c');
    expect(run('asia-ais', { ...base, sacralSensory: 1, motorBelowLevel: 1 }).range).toBe('ais-c');
    expect(run('asia-ais', { ...base, voluntaryAnalContraction: 1, halfKeyMuscles: 1 }).range).toBe(
      'ais-d',
    );
    expect(
      run('asia-ais', { ...base, sacralSensory: 1, motorBelowLevel: 1, halfKeyMuscles: 1 }).range,
    ).toBe('ais-d');
  });

  it('E: normal sensation and motor function in a patient with a prior deficit', () => {
    expect(
      run('asia-ais', { ...base, normalAll: 1, voluntaryAnalContraction: 1, sacralSensory: 1 })
        .range,
    ).toBe('ais-e');
  });
});
