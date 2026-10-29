import { describe, expect, it } from 'vitest';

import {
  activeTriggers,
  atlasCondition,
  conditionDanger,
  describedConditions,
  missingAtlasClasses,
  SKIN_ATLAS,
  sanitizeSkinFindings,
  skinDangerSummary,
  toggleFinding,
} from '@/features/skin/skin-atlas';
import { SKIN_ELEMENTS } from '@/features/skin/skin-atlas-terms';
import { lesionArtShapes } from '@/features/skin/skin-lesion-art';

describe('skin atlas data', () => {
  it('covers every model class and marks the description-only conditions', () => {
    expect(missingAtlasClasses()).toEqual([]);
    const describedOnly = SKIN_ATLAS.filter((entry) => !entry.model).map((entry) => entry.id);
    expect(describedOnly).toEqual(
      expect.arrayContaining(['vitiligo', 'milia', 'furuncle', 'skin_ulcer', 'measles_koplik']),
    );
  });

  it('gives every condition two or three pictures and at least one source', () => {
    for (const entry of SKIN_ATLAS) {
      expect(entry.art.length, entry.id).toBeGreaterThanOrEqual(2);
      expect(entry.art.length, entry.id).toBeLessThanOrEqual(3);
      expect(entry.sources.length, entry.id).toBeGreaterThan(0);
      for (const art of entry.art) expect(lesionArtShapes(art).length).toBeGreaterThan(3);
    }
  });

  it('rates the malignant classes at least high', () => {
    for (const id of ['melanoma', 'scc']) expect(atlasCondition(id)?.danger).toBe('high');
  });
});

describe('red flags', () => {
  it('raise a condition when one of their triggers is ticked', () => {
    const zoster = atlasCondition('herpes_zoster');
    if (!zoster) throw new Error('zoster missing');
    expect(conditionDanger(zoster, activeTriggers({}, {}))).toBe('moderate');
    expect(conditionDanger(zoster, activeTriggers({}, { signs: ['near_eye'] }))).toBe('urgent');
  });

  it('count present symptoms as triggers, absent ones not', () => {
    const triggers = activeTriggers(
      { symptoms: { bleed: true, itch: false } },
      { signs: ['fever'] },
    );
    expect([...triggers].toSorted()).toEqual(['bleed', 'fever']);
  });
});

describe('description match', () => {
  it('needs an element', () => {
    expect(describedConditions({}, { colors: ['white'] })).toEqual([]);
  });

  it('finds Koplik spots from white spots on the mucosa with fever', () => {
    const matches = describedConditions(
      {},
      { elements: ['papule'], colors: ['white'], signs: ['mucosa', 'fever'] },
    );
    expect(matches[0]?.conditionId).toBe('measles_koplik');
  });

  it('finds vitiligo from a white macule', () => {
    const matches = describedConditions({}, { elements: ['macule'], colors: ['white'] });
    expect(matches.map((match) => match.conditionId)).toContain('vitiligo');
  });
});

describe('danger summary', () => {
  it('takes the most dangerous variant shown and its action', () => {
    const summary = skinDangerSummary({
      predictions: [
        { classId: 'nevus', probability: 0.6 },
        { classId: 'melanoma', probability: 0.25 },
      ],
      described: [],
      malignantFlag: false,
      details: {},
      findings: {},
    });
    expect(summary?.level).toBe('high');
    expect(summary?.conditionId).toBe('melanoma');
    expect(summary?.reasons[0]).toContain('среди вариантов');
  });

  it('lifts a fired malignancy check to high even with benign cards', () => {
    const summary = skinDangerSummary({
      predictions: [{ classId: 'seborrheic_keratosis', probability: 0.7 }],
      described: [],
      malignantFlag: true,
      details: {},
      findings: {},
    });
    expect(summary?.level).toBe('high');
    expect(summary?.reasons).toContain('Сработала проверка на злокачественность');
  });

  it('is urgent for measles found by description', () => {
    const findings = {
      elements: ['papule'],
      colors: ['white'],
      signs: ['mucosa', 'fever'],
    } as const;
    const summary = skinDangerSummary({
      predictions: [],
      described: describedConditions({}, findings),
      malignantFlag: false,
      details: {},
      findings,
    });
    expect(summary?.level).toBe('urgent');
  });
});

describe('findings storage', () => {
  it('drops unknown ids and empty text', () => {
    expect(
      sanitizeSkinFindings({ elements: ['papule', 'nope'], signs: 'fever', evolution: '  ' }),
    ).toEqual({ elements: ['papule'] });
  });

  it('toggles in the declared order', () => {
    expect(toggleFinding(SKIN_ELEMENTS, ['ulcer'], 'macule')).toEqual(['macule', 'ulcer']);
    expect(toggleFinding(SKIN_ELEMENTS, ['macule', 'ulcer'], 'macule')).toEqual(['ulcer']);
  });
});
