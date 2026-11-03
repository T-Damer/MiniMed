import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  bundledAssessmentIds,
  clearDownloadedAssessments,
  getAssessmentCatalog,
  hasAssessmentPayload,
  loadAssessmentDefinition,
  registerBundledAssessment,
} from '@/features/assessments/assessment-catalog';
import { loadAssessmentInstallationState } from '@/features/assessments/assessment-packs';
import {
  DIARY_QUESTIONNAIRES,
  loadBuiltInScaleRecords,
} from '@/features/diary/diary-questionnaires';
import { APP_PROFILES } from '@/state/app-profile';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the diaries profile built-in scales', () => {
  it('resolve from the bundled packs without any network or module download', async () => {
    const fetched = vi.fn(() => Promise.reject(new Error('the network must stay unused')));
    vi.stubGlobal('fetch', fetched);
    const profile = APP_PROFILES.find((candidate) => candidate.id === 'diaries');
    const scales = profile?.builtInScales ?? [];
    expect(scales.length).toBeGreaterThan(0);

    for (const record of await loadBuiltInScaleRecords(scales)) registerBundledAssessment(record);

    const catalog = getAssessmentCatalog();
    for (const scale of scales) {
      const entry = catalog.find((candidate) => candidate.slug === scale.slug);
      expect(entry, scale.slug).toBeDefined();
      expect(hasAssessmentPayload(entry?.id ?? ''), scale.slug).toBe(true);
      const definition = await loadAssessmentDefinition(scale.slug);
      expect(definition.slug).toBe(scale.slug);
      expect(definition.questions.length, scale.slug).toBeGreaterThan(0);
    }
    // They count as installed, so the questionnaire page is the working one, not the download offer.
    const installed = loadAssessmentInstallationState(catalog).installedIds;
    for (const scale of scales) {
      const id = catalog.find((candidate) => candidate.slug === scale.slug)?.id ?? '';
      expect(installed.has(id), scale.slug).toBe(true);
    }
    expect(bundledAssessmentIds()).toHaveLength(DIARY_QUESTIONNAIRES.length);
    expect(fetched).not.toHaveBeenCalled();
  });

  it('survive a refresh of the downloaded modules', async () => {
    for (const record of await loadBuiltInScaleRecords(DIARY_QUESTIONNAIRES)) {
      registerBundledAssessment(record);
    }
    clearDownloadedAssessments();
    for (const scale of DIARY_QUESTIONNAIRES) {
      await expect(loadAssessmentDefinition(scale.slug), scale.slug).resolves.toMatchObject({
        slug: scale.slug,
      });
    }
  });
});
