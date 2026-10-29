import {
  SKIN_CLASSES,
  type SkinAnalysis,
  type SkinDetails,
  type SkinModel,
} from '@/features/skin/skin-model';

/**
 * A stand-in model for tests and UI work without the local weights: a deterministic ranking from
 * the photo's size and the details, after a short delay like the real worker's.
 */
export function createFakeSkinModel(delayMs = 600): SkinModel {
  return {
    async status() {
      return 'ready';
    },
    async analyze(photo: Blob, details: SkinDetails): Promise<SkinAnalysis> {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      const seed = photo.size + (details.sites?.length ?? 0) * 7 + (details.age?.length ?? 0) * 13;
      const scores = SKIN_CLASSES.map((entry, index) => ({
        classId: entry.id,
        score: ((seed * (index + 3)) % 97) + 1,
      }));
      const total = scores.reduce((sum, entry) => sum + entry.score ** 2, 0);
      const predictions = scores
        .map((entry) => ({ classId: entry.classId, probability: entry.score ** 2 / total }))
        .toSorted((left, right) => right.probability - left.probability);
      const malignantScore = predictions
        .filter((entry) => SKIN_CLASSES.find((c) => c.id === entry.classId)?.malignant)
        .reduce((sum, entry) => sum + entry.probability, 0);
      const [first, second] = predictions;
      return {
        predictions,
        malignantScore,
        malignantFlag: malignantScore > 0.25,
        uncertain: (first?.probability ?? 0) - (second?.probability ?? 0) < 0.05,
      };
    },
  };
}
