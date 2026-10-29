import type { SkinModel } from '@/features/skin/skin-model';

/**
 * A test-only seam. The weights are not in the repository, so the browser specs
 * (`apps/app/e2e/skin-photo.spec.ts`) put a model of their own on `window` before the page starts;
 * without it the page uses the app's model. Nothing in the product sets this property.
 */
export const SKIN_TEST_MODEL_PROPERTY = '__minimedSkinTestModel';

function isSkinModel(value: unknown): value is SkinModel {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate['status'] === 'function' && typeof candidate['analyze'] === 'function';
}

export function resolveSkinModel(appModel: SkinModel): SkinModel {
  if (typeof window === 'undefined') return appModel;
  const injected = (window as unknown as Record<string, unknown>)[SKIN_TEST_MODEL_PROPERTY];
  return isSkinModel(injected) ? injected : appModel;
}
