import { afterEach, describe, expect, it, vi } from 'vitest';

import { ASSESSMENT_CATALOG } from '@/features/assessments/assessment-catalog';
import {
  assessmentIdsInSection,
  assessmentRequiredByModules,
  groupAssessmentsBySection,
  installAssessmentIds,
  installAssessmentSection,
  isAssessmentSectionComplete,
  loadAssessmentInstallationState,
  pruneAssessmentModuleDependencies,
  removeAssessmentIds,
  removeAssessmentModuleDependencies,
  removeAssessmentSection,
  setAssessmentModuleDependencies,
} from '@/features/assessments/assessment-packs';

interface InstalledStorage {
  readonly values: Map<string, string>;
  readonly dispatchEvent: ReturnType<typeof vi.fn>;
}

function installStorage(initial: Readonly<Record<string, string>> = {}): InstalledStorage {
  const values = new Map(Object.entries(initial));
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => {
      values.clear();
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  } satisfies Storage;
  const dispatchEvent = vi.fn();
  vi.stubGlobal('window', { localStorage, dispatchEvent });
  return { values, dispatchEvent };
}

afterEach(() => vi.unstubAllGlobals());

describe('questionnaire packs', () => {
  it('groups every catalog item into a named section', () => {
    const groups = groupAssessmentsBySection(ASSESSMENT_CATALOG);

    expect(groups.flatMap((group) => group.assessments)).toHaveLength(ASSESSMENT_CATALOG.length);
    expect(groups.map((group) => group.section.id)).toEqual(
      expect.arrayContaining(['self-reflection', 'work-style', 'team-role', 'temperament']),
    );
  });

  it('starts empty and installs or removes a complete section explicitly', () => {
    installStorage();
    const sectionIds = assessmentIdsInSection('self-reflection', ASSESSMENT_CATALOG);

    expect(loadAssessmentInstallationState(ASSESSMENT_CATALOG).installedIds.size).toBe(0);
    const installed = installAssessmentSection('self-reflection', ASSESSMENT_CATALOG);
    expect(installed.sectionIds.has('self-reflection')).toBe(true);
    expect(sectionIds.every((id) => installed.installedIds.has(id))).toBe(true);
    expect(isAssessmentSectionComplete('self-reflection', installed, ASSESSMENT_CATALOG)).toBe(
      true,
    );

    const removed = removeAssessmentSection('self-reflection', ASSESSMENT_CATALOG);
    expect(removed.sectionIds.has('self-reflection')).toBe(false);
    expect(sectionIds.every((id) => !removed.installedIds.has(id))).toBe(true);
    expect(isAssessmentSectionComplete('self-reflection', removed, ASSESSMENT_CATALOG)).toBe(false);
  });

  it('supports excluding one item from a selected section and restoring it', () => {
    installStorage();
    const target = ASSESSMENT_CATALOG.find((definition) => definition.category === 'team-role');
    expect(target).toBeDefined();

    installAssessmentSection('team-role', ASSESSMENT_CATALOG);
    const afterRemove = removeAssessmentIds([target?.id ?? ''], ASSESSMENT_CATALOG);
    expect(afterRemove.excludedIds.has(target?.id ?? '')).toBe(true);
    expect(afterRemove.installedIds.has(target?.id ?? '')).toBe(false);

    const restored = installAssessmentSection('team-role', ASSESSMENT_CATALOG);
    expect(restored.excludedIds.has(target?.id ?? '')).toBe(false);
    expect(restored.installedIds.has(target?.id ?? '')).toBe(true);
  });

  it('keeps a module-retained exclusion incomplete until the section is restored', () => {
    installStorage();
    const target = ASSESSMENT_CATALOG.find(
      (definition) => definition.category === 'self-reflection',
    );
    expect(target).toBeDefined();
    const id = target?.id ?? '';

    installAssessmentSection('self-reflection', ASSESSMENT_CATALOG);
    setAssessmentModuleDependencies('clinical.one', '1.0.0', [id], ASSESSMENT_CATALOG);
    const excluded = removeAssessmentIds([id], ASSESSMENT_CATALOG);

    expect(excluded.excludedIds.has(id)).toBe(true);
    expect(excluded.installedIds.has(id)).toBe(true);
    expect(isAssessmentSectionComplete('self-reflection', excluded, ASSESSMENT_CATALOG)).toBe(
      false,
    );

    const restored = installAssessmentSection('self-reflection', ASSESSMENT_CATALOG);
    expect(isAssessmentSectionComplete('self-reflection', restored, ASSESSMENT_CATALOG)).toBe(true);
  });

  it('drops stale exclusions when their section is removed', () => {
    installStorage();
    const target = ASSESSMENT_CATALOG.find((definition) => definition.category === 'team-role');
    expect(target).toBeDefined();
    const id = target?.id ?? '';

    installAssessmentSection('team-role', ASSESSMENT_CATALOG);
    removeAssessmentIds([id], ASSESSMENT_CATALOG);
    const removed = removeAssessmentSection('team-role', ASSESSMENT_CATALOG);

    expect(removed.excludedIds.has(id)).toBe(false);
    expect(removed.installedIds.has(id)).toBe(false);
  });

  it('keeps a questionnaire while any manual or module source still requires it', () => {
    installStorage();
    const target = ASSESSMENT_CATALOG[0];
    expect(target).toBeDefined();
    const id = target?.id ?? '';

    installAssessmentIds([id], ASSESSMENT_CATALOG);
    setAssessmentModuleDependencies('clinical.one', '1.0.0', [id], ASSESSMENT_CATALOG);
    let state = setAssessmentModuleDependencies('clinical.two', '1.0.0', [id], ASSESSMENT_CATALOG);
    expect(assessmentRequiredByModules(id, state)).toEqual(['clinical.one', 'clinical.two']);

    state = removeAssessmentIds([id], ASSESSMENT_CATALOG);
    expect(state.manualIds.has(id)).toBe(false);
    expect(state.installedIds.has(id)).toBe(true);

    state = removeAssessmentModuleDependencies('clinical.one', ASSESSMENT_CATALOG);
    expect(state.installedIds.has(id)).toBe(true);
    state = removeAssessmentModuleDependencies('clinical.two', ASSESSMENT_CATALOG);
    expect(state.installedIds.has(id)).toBe(false);
  });

  it('prunes dependencies when the active module version changes', () => {
    installStorage();
    const id = ASSESSMENT_CATALOG[0]?.id ?? '';
    setAssessmentModuleDependencies('clinical.one', '1.0.0', [id], ASSESSMENT_CATALOG);

    const state = pruneAssessmentModuleDependencies(
      new Map([['clinical.one', '2.0.0']]),
      ASSESSMENT_CATALOG,
    );

    expect(state.moduleDependencies).toEqual({});
    expect(state.installedIds.has(id)).toBe(false);
  });

  it('does not persist or notify again for an identical dependency snapshot', () => {
    const { dispatchEvent, values } = installStorage();
    const id = ASSESSMENT_CATALOG[0]?.id ?? '';

    setAssessmentModuleDependencies('clinical.one', '1.0.0', [id], ASSESSMENT_CATALOG);
    const serialized = values.get('minimed.assessment-packs.v2');
    setAssessmentModuleDependencies('clinical.one', '1.0.0', [id], ASSESSMENT_CATALOG);

    expect(values.get('minimed.assessment-packs.v2')).toBe(serialized);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('migrates the legacy list as explicit manual installations', () => {
    const id = ASSESSMENT_CATALOG[0]?.id ?? '';
    const { values } = installStorage({
      'minimed.assessment-packs.v1': JSON.stringify([id]),
    });

    const state = loadAssessmentInstallationState(ASSESSMENT_CATALOG);
    expect(state.manualIds.has(id)).toBe(true);
    expect(state.installedIds.has(id)).toBe(true);
    expect(values.has('minimed.assessment-packs.v1')).toBe(false);
    expect(values.has('minimed.assessment-packs.v2')).toBe(true);
  });
});
