import { describe, expect, it } from 'vitest';
import { encodeSkinDetails, SKIN_CLASSES, SKIN_DETAILS_SIZE } from '@/features/skin/skin-model';
import {
  manifestMatchesClasses,
  type SkinModelManifest,
  skinAnalysisFrom,
} from '@/features/skin/skin-model-client';

const manifest: SkinModelManifest = {
  format: 'minimed-skin-cnn',
  version: 1,
  model: 'model.int8.onnx',
  inputSide: 224,
  details: true,
  classes: SKIN_CLASSES.map((entry) => entry.id),
  malignantThreshold: 0.2,
};

describe('skin details vector', () => {
  it('matches the training encoder layout (tools/derm-cnn encode)', () => {
    expect(SKIN_DETAILS_SIZE).toBe(44);
    // Same case as the Python check: 18–29, male, arm, itch + grew + pain, 1–4 weeks, no skin type.
    const vector = encodeSkinDetails({
      age: '18_29',
      sex: 'male',
      sites: ['arm'],
      symptoms: { itch: true, grew: true, pain: true },
      duration: '1_4_weeks',
    });
    const hot = Array.from(vector.entries())
      .filter(([, value]) => value === 1)
      .map(([index]) => index);
    // age 1 · sex 8 · site arm 12 · itch known+yes 20,21 · grew 24,25 · pain 26,27 · duration 33 · fitz unknown 43
    expect(hot).toEqual([1, 8, 12, 20, 21, 24, 25, 26, 27, 33, 43]);
  });

  it('marks every field unknown when nothing is told', () => {
    const hot = Array.from(encodeSkinDetails({}).entries())
      .filter(([, value]) => value === 1)
      .map(([index]) => index);
    expect(hot).toEqual([7, 10, 19, 36, 43]);
  });
});

describe('skin analysis', () => {
  it('ranks, sums the malignant classes and fires the check at the threshold', () => {
    const probabilities = SKIN_CLASSES.map((entry) =>
      entry.id === 'melanoma' ? 0.5 : entry.id === 'nevus' ? 0.3 : 0.2 / 19,
    );
    const analysis = skinAnalysisFrom(probabilities, manifest);
    expect(analysis.predictions[0]?.classId).toBe('melanoma');
    expect(analysis.predictions[1]?.classId).toBe('nevus');
    expect(analysis.malignantFlag).toBe(true);
    expect(analysis.uncertain).toBe(false);
  });

  it('calls a close race uncertain', () => {
    const probabilities = SKIN_CLASSES.map((entry) =>
      entry.id === 'eczema' ? 0.3 : entry.id === 'psoriasis' ? 0.25 : 0.45 / 19,
    );
    const analysis = skinAnalysisFrom(probabilities, manifest);
    expect(analysis.uncertain).toBe(true);
    expect(analysis.malignantFlag).toBe(false);
  });

  it('rejects a model whose classes are not the app’s', () => {
    expect(manifestMatchesClasses(manifest)).toBe(true);
    expect(manifestMatchesClasses({ ...manifest, classes: [...manifest.classes].reverse() })).toBe(
      false,
    );
  });
});
