import type {
  AssessmentCatalogEntry,
  AssessmentCategory,
} from '@/features/assessments/assessment-catalog';

export type AssessmentSectionId = AssessmentCategory;

export interface AssessmentSectionDefinition {
  readonly id: AssessmentSectionId;
  readonly title: string;
  readonly description: string;
}

export interface AssessmentSectionGroup {
  readonly section: AssessmentSectionDefinition;
  readonly assessments: readonly AssessmentCatalogEntry[];
}

export interface AssessmentModuleDependency {
  readonly version: string;
  readonly assessmentIds: readonly string[];
}

export interface AssessmentInstallationState {
  readonly manualIds: ReadonlySet<string>;
  readonly sectionIds: ReadonlySet<AssessmentSectionId>;
  readonly excludedIds: ReadonlySet<string>;
  readonly moduleDependencies: Readonly<Record<string, AssessmentModuleDependency>>;
  readonly installedIds: ReadonlySet<string>;
}

interface StoredAssessmentModuleDependency {
  readonly version: string;
  readonly assessmentIds: readonly string[];
}

interface StoredAssessmentModuleDependencyInput {
  readonly version?: unknown;
  readonly assessmentIds?: unknown;
}

interface StoredAssessmentInstallationSnapshot {
  readonly schemaVersion: 2;
  readonly manualIds: readonly string[];
  readonly sectionIds: readonly AssessmentSectionId[];
  readonly excludedIds: readonly string[];
  readonly moduleDependencies: Readonly<Record<string, StoredAssessmentModuleDependency>>;
}

interface StoredAssessmentInstallationSnapshotInput {
  readonly schemaVersion?: unknown;
  readonly manualIds?: unknown;
  readonly sectionIds?: unknown;
  readonly excludedIds?: unknown;
  readonly moduleDependencies?: unknown;
}

export const ASSESSMENT_PACKS_EVENT = 'minimed:assessment-packs-changed';
const STORAGE_KEY = 'minimed.assessment-packs.v2';
const LEGACY_STORAGE_KEY = 'minimed.assessment-packs.v1';
const MODULE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const MAX_VERSION_LENGTH = 128;

export const ASSESSMENT_SECTIONS: readonly AssessmentSectionDefinition[] = [
  {
    id: 'self-reflection',
    title: 'Самооценка и личностный профиль',
    description: 'Опросники для структурированной саморефлексии и описания личностного профиля.',
  },
  {
    id: 'work-style',
    title: 'Стиль работы и управления',
    description: 'Инструменты для разбора рабочего поведения, управления и принятия решений.',
  },
  {
    id: 'team-role',
    title: 'Командные роли',
    description: 'Опросники о распределении ролей и взаимодействии внутри команды.',
  },
  {
    id: 'temperament',
    title: 'Темперамент',
    description: 'Типологические опросники для описания устойчивых особенностей реагирования.',
  },
  {
    id: 'newborn-screening',
    title: 'Оценка новорождённого',
    description: 'Стандартизированная оценка состояния новорождённого сразу после рождения.',
  },
  {
    id: 'perinatal-mood',
    title: 'Психологический скрининг',
    description:
      'Скрининговые шкалы настроения и тревоги для использования во время беременности и после родов.',
  },
  {
    id: 'gynecologic-endocrinology',
    title: 'Гинекологическая эндокринология',
    description:
      'Шкалы для оценки признаков гиперандрогении и сопутствующих эндокринных нарушений.',
  },
];

const SECTION_IDS = new Set(ASSESSMENT_SECTIONS.map((section) => section.id));

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readStorage(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): boolean {
  try {
    const target = storage();
    if (!target) return false;
    target.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeStorage(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // Storage may be unavailable in restricted browser contexts.
  }
}

function availableIdSet(definitions: readonly AssessmentCatalogEntry[]): ReadonlySet<string> {
  return new Set(definitions.map((definition) => definition.id));
}

function validAssessmentIds(values: unknown, availableIds: ReadonlySet<string>): readonly string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values.filter(
        (value): value is string => typeof value === 'string' && availableIds.has(value),
      ),
    ),
  ].toSorted();
}

function validSectionIds(values: unknown): readonly AssessmentSectionId[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values.filter(
        (value): value is AssessmentSectionId =>
          typeof value === 'string' && SECTION_IDS.has(value as AssessmentSectionId),
      ),
    ),
  ].toSorted();
}

function validModuleId(value: string): boolean {
  return MODULE_ID_PATTERN.test(value);
}

function validModuleVersion(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_VERSION_LENGTH;
}

function validModuleDependencies(
  value: unknown,
  availableIds: ReadonlySet<string>,
): Readonly<Record<string, StoredAssessmentModuleDependency>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const dependencies: Record<string, StoredAssessmentModuleDependency> = {};
  for (const [moduleId, rawDependency] of Object.entries(value)) {
    if (!validModuleId(moduleId) || !rawDependency || typeof rawDependency !== 'object') continue;
    const dependency = rawDependency as StoredAssessmentModuleDependencyInput;
    if (!validModuleVersion(dependency.version)) continue;
    const assessmentIds = validAssessmentIds(dependency.assessmentIds, availableIds);
    if (assessmentIds.length === 0) continue;
    dependencies[moduleId] = { version: dependency.version, assessmentIds };
  }
  return dependencies;
}

function emptySnapshot(): StoredAssessmentInstallationSnapshot {
  return {
    schemaVersion: 2,
    manualIds: [],
    sectionIds: [],
    excludedIds: [],
    moduleDependencies: {},
  };
}

function parseSnapshot(
  raw: string | null,
  definitions: readonly AssessmentCatalogEntry[],
): StoredAssessmentInstallationSnapshot | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const value = parsed as StoredAssessmentInstallationSnapshotInput;
    if (value.schemaVersion !== 2) return null;
    const availableIds = availableIdSet(definitions);
    return {
      schemaVersion: 2,
      manualIds: validAssessmentIds(value.manualIds, availableIds),
      sectionIds: validSectionIds(value.sectionIds),
      excludedIds: validAssessmentIds(value.excludedIds, availableIds),
      moduleDependencies: validModuleDependencies(value.moduleDependencies, availableIds),
    };
  } catch {
    return null;
  }
}

function migrateLegacySnapshot(
  definitions: readonly AssessmentCatalogEntry[],
): StoredAssessmentInstallationSnapshot | null {
  const raw = readStorage(LEGACY_STORAGE_KEY);
  if (!raw) return null;
  try {
    const availableIds = availableIdSet(definitions);
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const snapshot: StoredAssessmentInstallationSnapshot = {
      ...emptySnapshot(),
      manualIds: validAssessmentIds(parsed, availableIds),
    };
    if (writeStorage(STORAGE_KEY, JSON.stringify(snapshot))) removeStorage(LEGACY_STORAGE_KEY);
    return snapshot;
  } catch {
    return null;
  }
}

function installedIdsFromSnapshot(
  snapshot: StoredAssessmentInstallationSnapshot,
  definitions: readonly AssessmentCatalogEntry[],
): ReadonlySet<string> {
  const installed = new Set(snapshot.manualIds);
  const excluded = new Set(snapshot.excludedIds);
  for (const definition of definitions) {
    if (snapshot.sectionIds.includes(definition.category) && !excluded.has(definition.id)) {
      installed.add(definition.id);
    }
  }
  for (const dependency of Object.values(snapshot.moduleDependencies)) {
    for (const id of dependency.assessmentIds) installed.add(id);
  }
  return installed;
}

function stateFromSnapshot(
  snapshot: StoredAssessmentInstallationSnapshot,
  definitions: readonly AssessmentCatalogEntry[],
): AssessmentInstallationState {
  return {
    manualIds: new Set(snapshot.manualIds),
    sectionIds: new Set(snapshot.sectionIds),
    excludedIds: new Set(snapshot.excludedIds),
    moduleDependencies: snapshot.moduleDependencies,
    installedIds: installedIdsFromSnapshot(snapshot, definitions),
  };
}

function snapshotFromState(
  state: AssessmentInstallationState,
): StoredAssessmentInstallationSnapshot {
  const dependencies: Record<string, StoredAssessmentModuleDependency> = {};
  for (const [moduleId, dependency] of Object.entries(state.moduleDependencies).toSorted(
    ([left], [right]) => left.localeCompare(right, 'en'),
  )) {
    dependencies[moduleId] = {
      version: dependency.version,
      assessmentIds: [...dependency.assessmentIds].toSorted(),
    };
  }
  return {
    schemaVersion: 2,
    manualIds: [...state.manualIds].toSorted(),
    sectionIds: [...state.sectionIds].toSorted(),
    excludedIds: [...state.excludedIds].toSorted(),
    moduleDependencies: dependencies,
  };
}

function persist(
  snapshot: StoredAssessmentInstallationSnapshot,
  definitions: readonly AssessmentCatalogEntry[],
): AssessmentInstallationState {
  const serialized = JSON.stringify(snapshot);
  if (readStorage(STORAGE_KEY) === serialized) return stateFromSnapshot(snapshot, definitions);
  const stored = writeStorage(STORAGE_KEY, serialized);
  if (stored && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ASSESSMENT_PACKS_EVENT));
  }
  return stateFromSnapshot(snapshot, definitions);
}

export function loadAssessmentInstallationState(
  definitions: readonly AssessmentCatalogEntry[],
): AssessmentInstallationState {
  const snapshot =
    parseSnapshot(readStorage(STORAGE_KEY), definitions) ??
    migrateLegacySnapshot(definitions) ??
    emptySnapshot();
  return stateFromSnapshot(snapshot, definitions);
}

export function loadInstalledAssessmentIds(
  definitions: readonly AssessmentCatalogEntry[],
): ReadonlySet<string> {
  return loadAssessmentInstallationState(definitions).installedIds;
}

export function assessmentIdsInSection(
  sectionId: AssessmentSectionId,
  definitions: readonly AssessmentCatalogEntry[],
): readonly string[] {
  return definitions
    .filter((definition) => definition.category === sectionId)
    .map((definition) => definition.id);
}

export function isAssessmentSectionComplete(
  sectionId: AssessmentSectionId,
  state: AssessmentInstallationState,
  definitions: readonly AssessmentCatalogEntry[],
): boolean {
  if (!state.sectionIds.has(sectionId)) return false;
  const assessmentIds = assessmentIdsInSection(sectionId, definitions);
  return assessmentIds.length > 0 && assessmentIds.every((id) => !state.excludedIds.has(id));
}

export function assessmentRequiredByModules(
  assessmentId: string,
  state: AssessmentInstallationState,
): readonly string[] {
  return Object.entries(state.moduleDependencies)
    .filter(([, dependency]) => dependency.assessmentIds.includes(assessmentId))
    .map(([moduleId]) => moduleId)
    .toSorted();
}

export function installAssessmentIds(
  ids: readonly string[],
  definitions: readonly AssessmentCatalogEntry[],
): AssessmentInstallationState {
  const current = loadAssessmentInstallationState(definitions);
  const availableIds = availableIdSet(definitions);
  const manualIds = new Set(current.manualIds);
  const excludedIds = new Set(current.excludedIds);
  for (const id of ids) {
    if (!availableIds.has(id)) continue;
    manualIds.add(id);
    excludedIds.delete(id);
  }
  return persist(snapshotFromState({ ...current, manualIds, excludedIds }), definitions);
}

export function removeAssessmentIds(
  ids: readonly string[],
  definitions: readonly AssessmentCatalogEntry[],
): AssessmentInstallationState {
  const current = loadAssessmentInstallationState(definitions);
  const definitionById = new Map(
    definitions.map((definition) => [definition.id, definition] as const),
  );
  const manualIds = new Set(current.manualIds);
  const excludedIds = new Set(current.excludedIds);
  for (const id of ids) {
    manualIds.delete(id);
    const definition = definitionById.get(id);
    if (definition && current.sectionIds.has(definition.category)) excludedIds.add(id);
    else excludedIds.delete(id);
  }
  return persist(snapshotFromState({ ...current, manualIds, excludedIds }), definitions);
}

export function installAssessmentSection(
  sectionId: AssessmentSectionId,
  definitions: readonly AssessmentCatalogEntry[],
): AssessmentInstallationState {
  const current = loadAssessmentInstallationState(definitions);
  if (!SECTION_IDS.has(sectionId)) return current;
  const sectionIds = new Set(current.sectionIds);
  const excludedIds = new Set(current.excludedIds);
  sectionIds.add(sectionId);
  for (const id of assessmentIdsInSection(sectionId, definitions)) excludedIds.delete(id);
  return persist(snapshotFromState({ ...current, sectionIds, excludedIds }), definitions);
}

export function removeAssessmentSection(
  sectionId: AssessmentSectionId,
  definitions: readonly AssessmentCatalogEntry[],
): AssessmentInstallationState {
  const current = loadAssessmentInstallationState(definitions);
  if (!SECTION_IDS.has(sectionId)) return current;
  const sectionIds = new Set(current.sectionIds);
  const excludedIds = new Set(current.excludedIds);
  sectionIds.delete(sectionId);
  for (const id of assessmentIdsInSection(sectionId, definitions)) excludedIds.delete(id);
  return persist(snapshotFromState({ ...current, sectionIds, excludedIds }), definitions);
}

export function setAssessmentModuleDependencies(
  moduleId: string,
  version: string,
  ids: readonly string[],
  definitions: readonly AssessmentCatalogEntry[],
): AssessmentInstallationState {
  const current = loadAssessmentInstallationState(definitions);
  if (!validModuleId(moduleId) || !validModuleVersion(version)) return current;
  const availableIds = availableIdSet(definitions);
  const assessmentIds = validAssessmentIds(ids, availableIds);
  const moduleDependencies = { ...current.moduleDependencies };
  if (assessmentIds.length > 0) moduleDependencies[moduleId] = { version, assessmentIds };
  else delete moduleDependencies[moduleId];
  return persist(snapshotFromState({ ...current, moduleDependencies }), definitions);
}

export function removeAssessmentModuleDependencies(
  moduleId: string,
  definitions: readonly AssessmentCatalogEntry[],
): AssessmentInstallationState {
  const current = loadAssessmentInstallationState(definitions);
  if (!(moduleId in current.moduleDependencies)) return current;
  const moduleDependencies = { ...current.moduleDependencies };
  delete moduleDependencies[moduleId];
  return persist(snapshotFromState({ ...current, moduleDependencies }), definitions);
}

export function pruneAssessmentModuleDependencies(
  installedModules: ReadonlyMap<string, string>,
  definitions: readonly AssessmentCatalogEntry[],
): AssessmentInstallationState {
  const current = loadAssessmentInstallationState(definitions);
  const moduleDependencies: Record<string, AssessmentModuleDependency> = {};
  for (const [moduleId, dependency] of Object.entries(current.moduleDependencies)) {
    if (installedModules.get(moduleId) === dependency.version) {
      moduleDependencies[moduleId] = dependency;
    }
  }
  if (Object.keys(moduleDependencies).length === Object.keys(current.moduleDependencies).length) {
    return current;
  }
  return persist(snapshotFromState({ ...current, moduleDependencies }), definitions);
}

export function groupAssessmentsBySection(
  definitions: readonly AssessmentCatalogEntry[],
): readonly AssessmentSectionGroup[] {
  return ASSESSMENT_SECTIONS.map((section) => ({
    section,
    assessments: definitions.filter((definition) => definition.category === section.id),
  })).filter((group) => group.assessments.length > 0);
}
