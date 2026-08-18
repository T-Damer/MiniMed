import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getAssessmentCatalog,
  registerDownloadedAssessment,
} from '@/features/assessments/assessment-catalog';
import {
  assessmentIdsInSection,
  assessmentRequiredByModules,
  groupAssessmentsBySection,
  installAssessmentIds,
  installAssessmentSection,
  isAssessmentSectionComplete,
  isAssessmentSectionFromDatabase,
  loadAssessmentInstallationState,
  pruneAssessmentModuleDependencies,
  removeAssessmentIds,
  removeAssessmentModuleDependencies,
  removeAssessmentSection,
  setAssessmentModuleDependencies,
  setDatabaseAssessmentIds,
} from '@/features/assessments/assessment-packs';
import { loadToolModuleRecords } from '@/features/calculators/tool-module-test-helpers';

function psychologyCatalog() {
  for (const record of loadToolModuleRecords(['content/tool-modules/psychology.json'])) {
    if (record.kind === 'assessment') registerDownloadedAssessment(record);
  }
  return getAssessmentCatalog();
}

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

afterEach(() => {
  setDatabaseAssessmentIds([]);
  vi.unstubAllGlobals();
});

describe('questionnaire packs', () => {
  it('groups every catalog item into a named section', () => {
    const catalog = psychologyCatalog();
    const groups = groupAssessmentsBySection(catalog);

    expect(groups.flatMap((group) => group.assessments)).toHaveLength(catalog.length);
    expect(groups.map((group) => group.section.id)).toEqual(
      expect.arrayContaining(['self-reflection', 'work-style', 'team-role', 'temperament']),
    );
  });

  it('starts empty and installs or removes a complete section explicitly', () => {
    installStorage();
    const catalog = psychologyCatalog();
    const sectionIds = assessmentIdsInSection('self-reflection', catalog);

    expect(loadAssessmentInstallationState(catalog).installedIds.size).toBe(0);
    const installed = installAssessmentSection('self-reflection', catalog);
    expect(installed.sectionIds.has('self-reflection')).toBe(true);
    expect(sectionIds.every((id) => installed.installedIds.has(id))).toBe(true);
    expect(isAssessmentSectionComplete('self-reflection', installed, catalog)).toBe(true);

    const removed = removeAssessmentSection('self-reflection', catalog);
    expect(removed.sectionIds.has('self-reflection')).toBe(false);
    expect(sectionIds.every((id) => !removed.installedIds.has(id))).toBe(true);
    expect(isAssessmentSectionComplete('self-reflection', removed, catalog)).toBe(false);
  });

  it('supports excluding one item from a selected section and restoring it', () => {
    installStorage();
    const catalog = psychologyCatalog();
    const target = catalog.find((definition) => definition.category === 'team-role');
    expect(target).toBeDefined();

    installAssessmentSection('team-role', catalog);
    const afterRemove = removeAssessmentIds([target?.id ?? ''], catalog);
    expect(afterRemove.excludedIds.has(target?.id ?? '')).toBe(true);
    expect(afterRemove.installedIds.has(target?.id ?? '')).toBe(false);

    const restored = installAssessmentSection('team-role', catalog);
    expect(restored.installedIds.has(target?.id ?? '')).toBe(true);
  });

  it('keeps module-required assessments installed when manually excluded from a section', () => {
    installStorage();
    const catalog = psychologyCatalog();
    const target = catalog.find(
      (definition) =>
        definition.category === 'self-reflection' && definition.slug === 'personal-egogram',
    );
    const id = target?.id ?? '';
    expect(id).not.toBe('');

    installAssessmentSection('self-reflection', catalog);
    setAssessmentModuleDependencies('clinical.one', '1.0.0', [id], catalog);
    const excluded = removeAssessmentIds([id], catalog);
    expect(excluded.installedIds.has(id)).toBe(true);
    expect(assessmentRequiredByModules(id, excluded)).toEqual(['clinical.one']);
    expect(isAssessmentSectionComplete('self-reflection', excluded, catalog)).toBe(false);

    const restored = installAssessmentSection('self-reflection', catalog);
    expect(isAssessmentSectionComplete('self-reflection', restored, catalog)).toBe(true);
  });

  it('clears exclusions when a section is removed entirely', () => {
    installStorage();
    const catalog = psychologyCatalog();
    const target = catalog.find((definition) => definition.category === 'team-role');
    const id = target?.id ?? '';

    installAssessmentSection('team-role', catalog);
    removeAssessmentIds([id], catalog);
    const removed = removeAssessmentSection('team-role', catalog);
    expect(removed.excludedIds.has(id)).toBe(false);
    expect(removed.installedIds.has(id)).toBe(false);
  });

  it('tracks module dependencies and manual installs separately', () => {
    installStorage();
    const catalog = psychologyCatalog();
    const target = catalog[0];
    const id = target?.id ?? '';

    installAssessmentIds([id], catalog);
    setAssessmentModuleDependencies('clinical.one', '1.0.0', [id], catalog);
    let state = setAssessmentModuleDependencies('clinical.two', '1.0.0', [id], catalog);
    expect(state.moduleDependencies['clinical.one']?.assessmentIds).toEqual([id]);

    state = removeAssessmentIds([id], catalog);
    expect(state.installedIds.has(id)).toBe(true);

    state = removeAssessmentModuleDependencies('clinical.one', catalog);
    expect(state.installedIds.has(id)).toBe(true);
    state = removeAssessmentModuleDependencies('clinical.two', catalog);
    expect(state.installedIds.has(id)).toBe(false);
  });

  it('prunes module dependencies when the installed module version changes', () => {
    installStorage();
    const catalog = psychologyCatalog();
    const id = catalog[0]?.id ?? '';
    setAssessmentModuleDependencies('clinical.one', '1.0.0', [id], catalog);
    const pruned = pruneAssessmentModuleDependencies(new Map([['clinical.one', '2.0.0']]), catalog);
    expect(pruned.moduleDependencies).toEqual({});
  });

  it('does not emit duplicate storage events for identical snapshots', () => {
    installStorage();
    const catalog = psychologyCatalog();
    const id = catalog[0]?.id ?? '';
    const { dispatchEvent } = installStorage();
    setAssessmentModuleDependencies('clinical.one', '1.0.0', [id], catalog);
    const before = dispatchEvent.mock.calls.length;
    setAssessmentModuleDependencies('clinical.one', '1.0.0', [id], catalog);
    expect(dispatchEvent.mock.calls.length).toBe(before);
  });

  it('returns an empty installation snapshot when storage is unavailable', () => {
    vi.stubGlobal('window', undefined);
    const catalog = psychologyCatalog();
    const id = catalog[0]?.id ?? '';
    const installed = installAssessmentIds([id], catalog);
    expect(installed.installedIds.has(id)).toBe(true);
    expect(loadAssessmentInstallationState(catalog).installedIds.size).toBe(0);
  });

  it('treats module-backed questionnaires as already installed without a download flag', () => {
    installStorage();
    const catalog = psychologyCatalog();
    setDatabaseAssessmentIds(catalog.map((definition) => definition.id));
    const state = loadAssessmentInstallationState(catalog);
    expect(state.installedIds.size).toBe(catalog.length);
    expect(isAssessmentSectionFromDatabase('self-reflection', catalog)).toBe(true);
    expect(isAssessmentSectionComplete('self-reflection', state, catalog)).toBe(true);
  });
});
