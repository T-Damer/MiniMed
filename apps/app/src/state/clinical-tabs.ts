import { parseDocumentReadRoute } from '@/state/document-route';

/**
 * Opt-in Clinical Tabs («Вкладки», Wave 2.1): tracks open screens across the whole app
 * (search, official/user documents, diaries, patients, notes, calculators, assessments,
 * knowledge base, news) with up to `MAX_CLINICAL_TABS` entries (2 hot + N frozen snapshots).
 */

export type ClinicalTabKind =
  | 'search'
  | 'official'
  | 'user'
  | 'diary'
  | 'patients'
  | 'notes'
  | 'calculator'
  | 'assessment'
  | 'modules'
  | 'news';

export interface ClinicalTabSnapshot {
  readonly id: string;
  readonly kind: ClinicalTabKind;
  readonly title: string;
  readonly subtitle?: string;
  /** Short frozen text lines captured from the screen before leaving, for visual grid cards. */
  readonly preview?: readonly string[];
  readonly hash: string;
  readonly documentId?: string;
  readonly anchor?: string;
  readonly anchorOffset?: number;
  readonly pinned?: boolean;
  readonly lastActiveAt: number;
}

export interface ClinicalTabsState {
  readonly tabs: readonly ClinicalTabSnapshot[];
  readonly activeTabId: string;
}

export const CLINICAL_TABS_STORAGE_KEY = 'minimed.clinical-tabs.v1';
export const CLINICAL_TABS_EVENT = 'minimed:clinical-tabs-changed';
export const MAX_CLINICAL_TABS = 12;
export const MAX_HOT_CLINICAL_TABS = 2;

const SEARCH_TAB_ID = 'tab:search';

const VALID_KINDS: ReadonlySet<string> = new Set<ClinicalTabKind>([
  'search',
  'official',
  'user',
  'diary',
  'patients',
  'notes',
  'calculator',
  'assessment',
  'modules',
  'news',
]);

let stateCache: ClinicalTabsState | null = null;

function defaultSearchTab(now = 0, hash = '#/search'): ClinicalTabSnapshot {
  return {
    id: SEARCH_TAB_ID,
    kind: 'search',
    title: 'Поиск',
    hash,
    pinned: true,
    lastActiveAt: now,
  };
}

function defaultState(now = 0): ClinicalTabsState {
  return {
    tabs: [defaultSearchTab(now)],
    activeTabId: SEARCH_TAB_ID,
  };
}

function normalizeHash(hash: string): string {
  if (!hash) return '#/search';
  return hash.startsWith('#') ? hash : `#/${hash.replace(/^\/+/u, '')}`;
}

function isClinicalTabSnapshot(value: unknown): value is ClinicalTabSnapshot {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item['id'] === 'string' &&
    typeof item['kind'] === 'string' &&
    VALID_KINDS.has(item['kind']) &&
    typeof item['title'] === 'string' &&
    typeof item['hash'] === 'string' &&
    typeof item['lastActiveAt'] === 'number'
  );
}

function storage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function loadClinicalTabsState(): ClinicalTabsState {
  if (stateCache) return stateCache;
  const raw = storage()?.getItem(CLINICAL_TABS_STORAGE_KEY);
  if (!raw) {
    stateCache = defaultState();
    return stateCache;
  }
  try {
    const parsed = JSON.parse(raw) as {
      readonly tabs?: unknown;
      readonly activeTabId?: unknown;
    };
    const tabs = Array.isArray(parsed.tabs) ? parsed.tabs.filter(isClinicalTabSnapshot) : [];
    if (tabs.length === 0) {
      stateCache = defaultState();
      return stateCache;
    }
    const activeTabId =
      typeof parsed.activeTabId === 'string' && tabs.some((tab) => tab.id === parsed.activeTabId)
        ? parsed.activeTabId
        : (tabs[0]?.id ?? SEARCH_TAB_ID);
    stateCache = { tabs, activeTabId };
    return stateCache;
  } catch {
    stateCache = defaultState();
    return stateCache;
  }
}

function saveClinicalTabsState(next: ClinicalTabsState): ClinicalTabsState {
  stateCache = next;
  try {
    storage()?.setItem(CLINICAL_TABS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore sessionStorage quota issues in private browsing.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<ClinicalTabsState>(CLINICAL_TABS_EVENT, { detail: next }));
  }
  return next;
}

export function resetClinicalTabsForTests(): void {
  stateCache = null;
  try {
    storage()?.removeItem(CLINICAL_TABS_STORAGE_KEY);
  } catch {
    // Ignore.
  }
}

export function subscribeClinicalTabs(listener: (state: ClinicalTabsState) => void): () => void {
  const handle = (event: Event): void => {
    const detail = (event as CustomEvent<ClinicalTabsState>).detail;
    listener(detail ?? loadClinicalTabsState());
  };
  window.addEventListener(CLINICAL_TABS_EVENT, handle);
  return () => window.removeEventListener(CLINICAL_TABS_EVENT, handle);
}

function sortTabsForDisplay(tabs: readonly ClinicalTabSnapshot[]): readonly ClinicalTabSnapshot[] {
  const pinned = tabs.filter((tab) => tab.pinned);
  const unpinned = tabs.filter((tab) => !tab.pinned);
  return [...pinned, ...unpinned];
}

function trimOverflowTabs(
  tabs: readonly ClinicalTabSnapshot[],
  activeTabId: string,
): readonly ClinicalTabSnapshot[] {
  if (tabs.length <= MAX_CLINICAL_TABS) return sortTabsForDisplay(tabs);
  const removable = tabs
    .filter((tab) => !tab.pinned && tab.id !== activeTabId)
    .toSorted((left, right) => left.lastActiveAt - right.lastActiveAt);
  const toDrop = new Set(removable.slice(0, tabs.length - MAX_CLINICAL_TABS).map((tab) => tab.id));
  return sortTabsForDisplay(tabs.filter((tab) => !toDrop.has(tab.id)));
}

export function tabIdForDocument(kind: 'official' | 'user', documentId: string): string {
  return `tab:${kind}:${documentId}`;
}

interface ParsedToolTab {
  readonly id: string;
  readonly kind: ClinicalTabKind;
  readonly defaultTitle: string;
  readonly subtitle?: string;
}

function parseToolRouteTab(normalizedHash: string): ParsedToolTab | null {
  const path = (normalizedHash.replace(/^#\/?/u, '').split('?')[0] ?? '').replace(/\/+$/u, '');
  if (!path || path === 'search' || path.startsWith('search/')) return null;
  if (path === 'settings' || path.startsWith('settings/') || path === 'status') return null;

  // Only concrete clinical work items become tabs — browsing hub/list routes (`#/modules`,
  // `#/notes`, `#/notes/patients`, `#/calculators`, `#/assessments`, `#/news`) do not flood tabs.
  if (path.startsWith('notes/diaries/')) {
    const sub = path.slice('notes/diaries/'.length).replace(/^\/+/u, '');
    const segment = sub.split('/')[0] ?? '';
    if (!segment || segment === 'new') return null;
    return {
      id: `tab:diary:${segment}`,
      kind: 'diary',
      defaultTitle: 'Дневник пациента',
    };
  }
  if (path.startsWith('notes/patients/')) {
    const sub = path.slice('notes/patients/'.length).replace(/^\/+/u, '');
    const segment = sub.split('/')[0] ?? '';
    if (!segment || segment === 'new') return null;
    return {
      id: `tab:patients:${segment}`,
      kind: 'patients',
      defaultTitle: 'Карточка пациента',
    };
  }
  if (path.startsWith('calculators/')) {
    const slug = path.slice('calculators/'.length).replace(/^\/+/u, '');
    if (!slug) return null;
    return {
      id: `tab:calculator:${slug}`,
      kind: 'calculator',
      defaultTitle: 'Калькулятор',
    };
  }
  if (path.startsWith('assessments/')) {
    const slug = path.slice('assessments/'.length).replace(/^\/+/u, '');
    if (!slug) return null;
    return {
      id: `tab:assessment:${slug}`,
      kind: 'assessment',
      defaultTitle: 'Опросник',
    };
  }
  return null;
}

export function syncRouteToClinicalTabs(
  hash: string,
  options: {
    readonly title?: string;
    readonly subtitle?: string;
    readonly now?: number;
  } = {},
): ClinicalTabsState {
  const now = options.now ?? Date.now();
  const normalized = normalizeHash(hash);
  const current = loadClinicalTabsState();
  const docRoute = parseDocumentReadRoute(normalized);

  if (docRoute) {
    const id = tabIdForDocument(docRoute.kind, docRoute.documentId);
    const existing = current.tabs.find((tab) => tab.id === id);
    const nextTab: ClinicalTabSnapshot = {
      id,
      kind: docRoute.kind,
      title: options.title?.trim() || existing?.title || 'Документ',
      ...(options.subtitle !== undefined
        ? { subtitle: options.subtitle }
        : existing?.subtitle !== undefined
          ? { subtitle: existing.subtitle }
          : {}),
      hash: normalized,
      documentId: docRoute.documentId,
      ...(docRoute.kind === 'official' && docRoute.section
        ? { anchor: docRoute.section }
        : existing?.anchor !== undefined
          ? { anchor: existing.anchor }
          : {}),
      ...(existing?.anchorOffset !== undefined ? { anchorOffset: existing.anchorOffset } : {}),
      ...(existing?.pinned ? { pinned: true } : {}),
      lastActiveAt: now,
    };
    const nextTabs = existing
      ? current.tabs.map((tab) => (tab.id === id ? nextTab : tab))
      : [...current.tabs, nextTab];
    return saveClinicalTabsState({
      tabs: trimOverflowTabs(nextTabs, id),
      activeTabId: id,
    });
  }

  if (
    normalized === '#/search' ||
    normalized.startsWith('#/search?') ||
    normalized.startsWith('#/search/')
  ) {
    const searchExists = current.tabs.some((tab) => tab.id === SEARCH_TAB_ID);
    const searchQuery = new URLSearchParams(normalized.split('?')[1] ?? '').get('q')?.trim();
    const title = searchQuery ? `Поиск: ${searchQuery}` : 'Поиск';
    const nextTabs = searchExists
      ? current.tabs.map((tab) =>
          tab.id === SEARCH_TAB_ID ? { ...tab, title, hash: normalized, lastActiveAt: now } : tab,
        )
      : [defaultSearchTab(now, normalized), ...current.tabs];
    return saveClinicalTabsState({
      tabs: trimOverflowTabs(nextTabs, SEARCH_TAB_ID),
      activeTabId: SEARCH_TAB_ID,
    });
  }

  const tool = parseToolRouteTab(normalized);
  if (tool) {
    const existing = current.tabs.find((tab) => tab.id === tool.id);
    const nextTab: ClinicalTabSnapshot = {
      id: tool.id,
      kind: tool.kind,
      title: options.title?.trim() || existing?.title || tool.defaultTitle,
      ...(options.subtitle !== undefined
        ? { subtitle: options.subtitle }
        : existing?.subtitle !== undefined
          ? { subtitle: existing.subtitle }
          : {}),
      hash: normalized,
      ...(existing?.pinned ? { pinned: true } : {}),
      lastActiveAt: now,
    };
    const nextTabs = existing
      ? current.tabs.map((tab) => (tab.id === tool.id ? nextTab : tab))
      : [...current.tabs, nextTab];
    return saveClinicalTabsState({
      tabs: trimOverflowTabs(nextTabs, tool.id),
      activeTabId: tool.id,
    });
  }

  return current;
}

export function openClinicalTabInBackground(input: {
  readonly kind: 'official' | 'user';
  readonly documentId: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly hash: string;
  readonly now?: number;
}): {
  readonly state: ClinicalTabsState;
  readonly tab: ClinicalTabSnapshot;
  readonly created: boolean;
} {
  const now = input.now ?? Date.now();
  const current = loadClinicalTabsState();
  const id = tabIdForDocument(input.kind, input.documentId);
  const existing = current.tabs.find((tab) => tab.id === id);
  const tab: ClinicalTabSnapshot = {
    id,
    kind: input.kind,
    title: input.title.trim() || existing?.title || 'Документ',
    ...(input.subtitle !== undefined
      ? { subtitle: input.subtitle }
      : existing?.subtitle !== undefined
        ? { subtitle: existing.subtitle }
        : {}),
    hash: normalizeHash(input.hash),
    documentId: input.documentId,
    ...(existing?.anchor !== undefined ? { anchor: existing.anchor } : {}),
    ...(existing?.anchorOffset !== undefined ? { anchorOffset: existing.anchorOffset } : {}),
    ...(existing?.pinned ? { pinned: true } : {}),
    lastActiveAt: existing?.lastActiveAt ?? now,
  };
  const nextTabs = existing
    ? current.tabs.map((item) => (item.id === id ? tab : item))
    : [...current.tabs, tab];
  const state = saveClinicalTabsState({
    tabs: trimOverflowTabs(nextTabs, current.activeTabId),
    activeTabId: current.activeTabId,
  });
  return { state, tab, created: !existing };
}

export function updateActiveClinicalTabTitle(title: string): ClinicalTabsState {
  return updateActiveClinicalTabSnapshot({ title });
}

export function updateActiveClinicalTabSnapshot(patch: {
  readonly title?: string;
  readonly subtitle?: string;
  readonly preview?: readonly string[];
}): ClinicalTabsState {
  const current = loadClinicalTabsState();
  const active = current.tabs.find((tab) => tab.id === current.activeTabId);
  if (!active) return current;
  const nextTitle =
    active.kind !== 'search' && patch.title?.trim() ? patch.title.trim() : active.title;
  const nextSubtitle =
    patch.subtitle !== undefined ? patch.subtitle.trim() || undefined : active.subtitle;
  const cleanedPreview = patch.preview
    ?.map((line) => line.replace(/\s+/gu, ' ').trim())
    .filter(Boolean)
    .slice(0, 4);
  const nextPreview = cleanedPreview && cleanedPreview.length > 0 ? cleanedPreview : active.preview;
  const samePreview =
    (nextPreview?.length ?? 0) === (active.preview?.length ?? 0) &&
    (nextPreview ?? []).every((line, index) => line === active.preview?.[index]);
  if (nextTitle === active.title && nextSubtitle === active.subtitle && samePreview) {
    return current;
  }
  const updated: ClinicalTabSnapshot = {
    ...active,
    title: nextTitle,
    ...(nextSubtitle ? { subtitle: nextSubtitle } : {}),
    ...(nextPreview ? { preview: nextPreview } : {}),
  };
  return saveClinicalTabsState({
    ...current,
    tabs: current.tabs.map((tab) => (tab.id === active.id ? updated : tab)),
  });
}

export function updateClinicalTabMeta(
  kind: 'official' | 'user',
  documentId: string,
  patch: {
    readonly title?: string;
    readonly subtitle?: string;
    readonly anchor?: string;
    readonly anchorOffset?: number;
  },
): ClinicalTabsState {
  const current = loadClinicalTabsState();
  const id = tabIdForDocument(kind, documentId);
  const existing = current.tabs.find((tab) => tab.id === id);
  if (!existing) return current;
  const nextTab: ClinicalTabSnapshot = {
    ...existing,
    ...(patch.title?.trim() ? { title: patch.title.trim() } : {}),
    ...(patch.subtitle !== undefined ? { subtitle: patch.subtitle } : {}),
    ...(patch.anchor !== undefined ? { anchor: patch.anchor } : {}),
    ...(patch.anchorOffset !== undefined ? { anchorOffset: patch.anchorOffset } : {}),
  };
  if (
    nextTab.title === existing.title &&
    nextTab.subtitle === existing.subtitle &&
    nextTab.anchor === existing.anchor &&
    nextTab.anchorOffset === existing.anchorOffset
  ) {
    return current;
  }
  return saveClinicalTabsState({
    ...current,
    tabs: current.tabs.map((tab) => (tab.id === id ? nextTab : tab)),
  });
}

export function activateClinicalTab(id: string, now = Date.now()): ClinicalTabSnapshot | null {
  const current = loadClinicalTabsState();
  const target = current.tabs.find((tab) => tab.id === id);
  if (!target) return null;
  const updated: ClinicalTabSnapshot = { ...target, lastActiveAt: now };
  saveClinicalTabsState({
    tabs: current.tabs.map((tab) => (tab.id === id ? updated : tab)),
    activeTabId: id,
  });
  return updated;
}

export function adjacentClinicalTab(
  state: ClinicalTabsState,
  delta: -1 | 1,
): ClinicalTabSnapshot | null {
  if (state.tabs.length < 2) return null;
  const currentIndex = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
  if (currentIndex < 0) return state.tabs[0] ?? null;
  const nextIndex = (currentIndex + delta + state.tabs.length) % state.tabs.length;
  return state.tabs[nextIndex] ?? null;
}

export function togglePinClinicalTab(id: string): ClinicalTabsState {
  const current = loadClinicalTabsState();
  if (id === SEARCH_TAB_ID) return current;
  const nextTabs = current.tabs.map((tab) =>
    tab.id === id ? { ...tab, pinned: !tab.pinned } : tab,
  );
  return saveClinicalTabsState({
    ...current,
    tabs: sortTabsForDisplay(nextTabs),
  });
}

export function closeClinicalTab(
  id: string,
  now = Date.now(),
): { readonly state: ClinicalTabsState; readonly nextActive: ClinicalTabSnapshot } {
  const current = loadClinicalTabsState();
  if (id === SEARCH_TAB_ID) {
    const active =
      current.tabs.find((tab) => tab.id === current.activeTabId) ?? defaultSearchTab(now);
    return { state: current, nextActive: active };
  }
  const index = current.tabs.findIndex((tab) => tab.id === id);
  if (index < 0) {
    const active =
      current.tabs.find((tab) => tab.id === current.activeTabId) ?? defaultSearchTab(now);
    return { state: current, nextActive: active };
  }
  const remaining = current.tabs.filter((tab) => tab.id !== id);
  const ensured = remaining.length > 0 ? remaining : [defaultSearchTab(now)];
  const nextActive =
    current.activeTabId === id
      ? (ensured[Math.min(index, ensured.length - 1)] ?? ensured[0] ?? defaultSearchTab(now))
      : (ensured.find((tab) => tab.id === current.activeTabId) ??
        ensured[0] ??
        defaultSearchTab(now));
  const state = saveClinicalTabsState({
    tabs: ensured,
    activeTabId: nextActive.id,
  });
  return { state, nextActive };
}

export function closeOtherClinicalTabs(keepId: string, now = Date.now()): ClinicalTabsState {
  const current = loadClinicalTabsState();
  const kept = current.tabs.filter(
    (tab) => tab.id === keepId || tab.pinned || tab.id === SEARCH_TAB_ID,
  );
  const ensured = kept.length > 0 ? kept : [defaultSearchTab(now)];
  const activeTabId = ensured.some((tab) => tab.id === keepId)
    ? keepId
    : (ensured[0]?.id ?? SEARCH_TAB_ID);
  return saveClinicalTabsState({
    tabs: sortTabsForDisplay(ensured),
    activeTabId,
  });
}

/**
 * Returns the IDs of up to `MAX_HOT_CLINICAL_TABS` (2) tabs that may stay hot in memory:
 * the active tab plus the most recently used other tab.
 */
export function hotClinicalTabIds(state: ClinicalTabsState): readonly string[] {
  const active = state.tabs.find((tab) => tab.id === state.activeTabId);
  const others = state.tabs
    .filter((tab) => tab.id !== state.activeTabId)
    .toSorted((left, right) => right.lastActiveAt - left.lastActiveAt);
  const result: string[] = [];
  if (active) result.push(active.id);
  for (const tab of others) {
    if (result.length >= MAX_HOT_CLINICAL_TABS) break;
    result.push(tab.id);
  }
  return result;
}
