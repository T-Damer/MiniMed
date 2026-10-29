import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeSkinModel } from '@/features/skin/skin-model-fake';
import { resolveSkinModel, SKIN_TEST_MODEL_PROPERTY } from '@/features/skin/skin-model-test-hook';

describe('the test model seam', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the app model without a window or without an injected model', () => {
    const app = createFakeSkinModel(0);
    expect(resolveSkinModel(app)).toBe(app);
    vi.stubGlobal('window', {});
    expect(resolveSkinModel(app)).toBe(app);
  });

  it('uses an injected model that has the two methods, and nothing else', () => {
    const app = createFakeSkinModel(0);
    const injected = createFakeSkinModel(0);
    vi.stubGlobal('window', { [SKIN_TEST_MODEL_PROPERTY]: injected });
    expect(resolveSkinModel(app)).toBe(injected);
    vi.stubGlobal('window', { [SKIN_TEST_MODEL_PROPERTY]: { status: 'ready' } });
    expect(resolveSkinModel(app)).toBe(app);
  });
});
