import { isSameDocumentFamily } from '@localmed/core';

import {
  buildOfficialDocumentHash,
  buildUserDocumentHash,
  type DocumentReadRoute,
  isDocumentReadRoute,
} from '@/state/document-route';

export type DocumentTrailOriginView =
  | 'search'
  | 'modules'
  | 'assessments'
  | 'calculators'
  | 'notes'
  | 'settings';

export interface DocumentTrailOrigin {
  readonly hash: string;
  readonly search: string;
  readonly label: string;
  readonly view: DocumentTrailOriginView;
}

export interface DocumentTrailCrumb {
  readonly kind: 'official' | 'user';
  readonly id: string;
  readonly title: string;
  readonly href: string;
}

export interface DocumentTrail {
  readonly origin: DocumentTrailOrigin;
  readonly crumbs: readonly DocumentTrailCrumb[];
}

const STORAGE_KEY = 'minimed:document-trail';

const ROOT_VIEWS: readonly DocumentTrailOriginView[] = [
  'search',
  'modules',
  'assessments',
  'calculators',
  'notes',
  'settings',
];

function normalizeHash(hash: string): string {
  if (!hash) return '#/search';
  return hash.startsWith('#') ? hash : `#/${hash.replace(/^\/+/u, '')}`;
}

export function viewFromHash(hash: string): DocumentTrailOriginView {
  const value = hash.replace(/^#\/?/u, '');
  if (value === 'documents') return 'modules';
  if (
    value === 'settings' ||
    value.startsWith('settings/') ||
    value === 'modules/model' ||
    value === 'status'
  ) {
    return 'settings';
  }
  if (value.startsWith('modules/')) return 'modules';
  if (value === 'assessments' || value.startsWith('assessments/')) return 'assessments';
  if (value === 'calculators' || value.startsWith('calculators/')) return 'calculators';
  if (value === 'notes' || value.startsWith('notes/')) return 'notes';
  if (value === 'history') return 'search';
  if (ROOT_VIEWS.includes(value as DocumentTrailOriginView)) {
    return value as DocumentTrailOriginView;
  }
  return 'search';
}

export function originLabelForView(view: DocumentTrailOriginView, hash: string): string {
  if (view === 'search') return 'Поиск';
  if (view === 'assessments') return 'Тесты';
  if (view === 'calculators') return 'Калькуляторы';
  if (view === 'notes') return 'Заметки';
  if (view === 'settings') return 'Настройки';
  const route = hash.replace(/^#\/?/u, '');
  if (route === 'modules/documents/user' || route.startsWith('modules/documents/user/')) {
    return 'Ваши документы';
  }
  if (
    route === 'modules/documents/medications' ||
    route.startsWith('modules/documents/medications/')
  ) {
    return 'Препараты';
  }
  if (route.startsWith('modules/documents')) return 'Документы';
  return 'Документы';
}

function defaultOrigin(kind: 'official' | 'user'): DocumentTrailOrigin {
  if (kind === 'user') {
    return {
      hash: '#/modules/documents/user',
      search: '',
      label: 'Ваши документы',
      view: 'modules',
    };
  }
  return {
    hash: '#/search',
    search: '',
    label: 'Поиск',
    view: 'search',
  };
}

function crumbHref(
  kind: 'official' | 'user',
  id: string,
  section?: string,
  pageIndex?: number,
): string {
  if (kind === 'official') {
    return section === undefined
      ? buildOfficialDocumentHash(id)
      : buildOfficialDocumentHash(id, section);
  }
  return pageIndex === undefined ? buildUserDocumentHash(id) : buildUserDocumentHash(id, pageIndex);
}

export function loadDocumentTrail(): DocumentTrail | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DocumentTrail;
    if (!parsed.origin || !Array.isArray(parsed.crumbs)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveDocumentTrail(trail: DocumentTrail): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(trail));
}

export function clearDocumentTrail(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

export function beginDocumentTrail(kind: 'official' | 'user'): DocumentTrail {
  const hash = normalizeHash(window.location.hash);
  const trail: DocumentTrail = {
    origin: isDocumentReadRoute(hash)
      ? defaultOrigin(kind)
      : {
          hash,
          search: window.location.search,
          label: originLabelForView(viewFromHash(hash), hash),
          view: viewFromHash(hash),
        },
    crumbs: [],
  };
  saveDocumentTrail(trail);
  return trail;
}

export interface AppendDocumentCrumbInput {
  readonly kind: 'official' | 'user';
  readonly id: string;
  readonly title: string;
  readonly section?: string;
  readonly pageIndex?: number;
}

export function appendDocumentCrumb(
  trail: DocumentTrail,
  crumb: AppendDocumentCrumbInput,
): DocumentTrail {
  const href = crumbHref(crumb.kind, crumb.id, crumb.section, crumb.pageIndex);
  const fullCrumb: DocumentTrailCrumb = {
    kind: crumb.kind,
    id: crumb.id,
    title: crumb.title,
    href,
  };
  const existingIndex = trail.crumbs.findIndex(
    (item) => item.kind === crumb.kind && isSameDocumentFamily(item.id, crumb.id),
  );
  const crumbs =
    existingIndex >= 0
      ? [...trail.crumbs.slice(0, existingIndex), { ...fullCrumb, title: crumb.title }]
      : [...trail.crumbs, fullCrumb];
  const next = { origin: trail.origin, crumbs };
  saveDocumentTrail(next);
  return next;
}

export function sliceTrailToCrumb(trail: DocumentTrail, index: number): DocumentTrail {
  const next = { origin: trail.origin, crumbs: trail.crumbs.slice(0, index + 1) };
  saveDocumentTrail(next);
  return next;
}

export function sliceTrailToOrigin(trail: DocumentTrail): DocumentTrail {
  const next = { origin: trail.origin, crumbs: [] };
  saveDocumentTrail(next);
  return next;
}

export function updateCurrentCrumbTitle(trail: DocumentTrail, title: string): DocumentTrail {
  if (trail.crumbs.length === 0) return trail;
  const crumbs = [...trail.crumbs];
  const lastIndex = crumbs.length - 1;
  const last = crumbs[lastIndex];
  if (!last) return trail;
  crumbs[lastIndex] = { ...last, title };
  const next = { origin: trail.origin, crumbs };
  saveDocumentTrail(next);
  return next;
}

export function updateCurrentCrumbDocument(
  trail: DocumentTrail,
  id: string,
  title: string,
): DocumentTrail {
  if (trail.crumbs.length === 0) return trail;
  const crumbs = [...trail.crumbs];
  const lastIndex = crumbs.length - 1;
  const last = crumbs[lastIndex];
  if (!last) return trail;
  crumbs[lastIndex] = {
    ...last,
    id,
    title,
    href: crumbHref(last.kind, id),
  };
  const next = { origin: trail.origin, crumbs };
  saveDocumentTrail(next);
  return next;
}

export function rebuildTrailForPastedRoute(route: DocumentReadRoute): DocumentTrail {
  const origin = defaultOrigin(route.kind);
  const title = route.kind === 'user' ? 'Личный документ' : 'Документ';
  const trail: DocumentTrail = {
    origin,
    crumbs: [
      {
        kind: route.kind,
        id: route.documentId,
        title,
        href:
          route.kind === 'official'
            ? route.section === undefined
              ? buildOfficialDocumentHash(route.documentId)
              : buildOfficialDocumentHash(route.documentId, route.section)
            : route.pageIndex === undefined
              ? buildUserDocumentHash(route.documentId)
              : buildUserDocumentHash(route.documentId, route.pageIndex),
      },
    ],
  };
  saveDocumentTrail(trail);
  return trail;
}
