import {
  findAssessmentBySlug,
  findAssessmentSpecialty,
} from '@/features/assessments/assessment-catalog';
import {
  ASSESSMENT_SECTIONS,
  type AssessmentSectionId,
} from '@/features/assessments/assessment-packs';

export interface AssessmentCrumb {
  readonly label: string;
  readonly href?: string;
}

export type AssessmentRoute =
  | { readonly kind: 'index' }
  | { readonly kind: 'user-index' }
  | { readonly kind: 'user-editor'; readonly fileId?: string }
  | { readonly kind: 'user-assessment'; readonly fileId: string; readonly recordId?: string }
  | { readonly kind: 'user-result'; readonly fileId: string; readonly recordId: string }
  | { readonly kind: 'specialty'; readonly specialtyId: string }
  | {
      readonly kind: 'section';
      readonly specialtyId: string;
      readonly sectionId: AssessmentSectionId;
    }
  | {
      readonly kind: 'assessment';
      readonly specialtyId: string;
      readonly slug: string;
      readonly recordId?: string;
    }
  | {
      readonly kind: 'result';
      readonly specialtyId: string;
      readonly slug: string;
      readonly recordId: string;
    };

function isSectionId(value: string): value is AssessmentSectionId {
  return ASSESSMENT_SECTIONS.some((section) => section.id === value);
}

function decodePart(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

export function specialtyPath(specialtyId: string): string {
  return `#/assessments/${encodeURIComponent(specialtyId)}`;
}

export function sectionPath(specialtyId: string, sectionId: AssessmentSectionId): string {
  return `${specialtyPath(specialtyId)}/${encodeURIComponent(sectionId)}`;
}

export function assessmentPath(specialtyId: string, slug: string): string {
  return `${specialtyPath(specialtyId)}/${encodeURIComponent(slug)}`;
}

export function resumePath(specialtyId: string, slug: string, recordId: string): string {
  return `${assessmentPath(specialtyId, slug)}/resume/${encodeURIComponent(recordId)}`;
}

export function resultPath(specialtyId: string, slug: string, recordId: string): string {
  return `${assessmentPath(specialtyId, slug)}/results/${encodeURIComponent(recordId)}`;
}

export function userQuestionnaireHomePath(): string {
  return '#/assessments/mine';
}

export function userQuestionnaireNewPath(): string {
  return `${userQuestionnaireHomePath()}/new`;
}

export function userQuestionnairePath(fileId: string): string {
  return `${userQuestionnaireHomePath()}/${encodeURIComponent(fileId)}`;
}

export function userQuestionnaireEditPath(fileId: string): string {
  return `${userQuestionnairePath(fileId)}/edit`;
}

export function userQuestionnaireResumePath(fileId: string, recordId: string): string {
  return `${userQuestionnairePath(fileId)}/resume/${encodeURIComponent(recordId)}`;
}

export function userQuestionnaireResultPath(fileId: string, recordId: string): string {
  return `${userQuestionnairePath(fileId)}/results/${encodeURIComponent(recordId)}`;
}

export function assessmentHomePath(slug: string): string {
  const entry = findAssessmentBySlug(slug);
  if (!entry) return '#/assessments';
  return isSectionId(entry.category)
    ? sectionPath(entry.bankId, entry.category)
    : specialtyPath(entry.bankId);
}

export function readAssessmentRoute(hash = window.location.hash): AssessmentRoute {
  const parts = hash.replace(/^#\/?/u, '').split('/');
  if (parts[0] !== 'assessments' || !parts[1]) return { kind: 'index' };
  const first = decodePart(parts[1]);
  if (!first) return { kind: 'index' };

  if (first === 'mine') {
    const fileId = decodePart(parts[2]);
    const action = decodePart(parts[3]);
    const recordId = decodePart(parts[4]);
    if (!fileId) return { kind: 'user-index' };
    if (fileId === 'new' && !action) return { kind: 'user-editor' };
    if (action === 'edit' && !recordId) return { kind: 'user-editor', fileId };
    if (action === 'results' && recordId) return { kind: 'user-result', fileId, recordId };
    if (action === 'resume' && recordId) return { kind: 'user-assessment', fileId, recordId };
    return { kind: 'user-assessment', fileId };
  }

  if (findAssessmentSpecialty(first)) {
    const second = decodePart(parts[2]);
    if (!second) return { kind: 'specialty', specialtyId: first };
    const third = decodePart(parts[3]);
    const fourth = decodePart(parts[4]);
    if (third === 'results' && fourth) {
      return { kind: 'result', specialtyId: first, slug: second, recordId: fourth };
    }
    if (third === 'resume' && fourth) {
      return { kind: 'assessment', specialtyId: first, slug: second, recordId: fourth };
    }
    if (isSectionId(second) && !third) {
      return { kind: 'section', specialtyId: first, sectionId: second };
    }
    return { kind: 'assessment', specialtyId: first, slug: second };
  }

  const entry = findAssessmentBySlug(first);
  if (!entry) return { kind: 'index' };
  const second = decodePart(parts[2]);
  const third = decodePart(parts[3]);
  if (second === 'results' && third) {
    return { kind: 'result', specialtyId: entry.bankId, slug: first, recordId: third };
  }
  if (second === 'resume' && third) {
    return { kind: 'assessment', specialtyId: entry.bankId, slug: first, recordId: third };
  }
  return { kind: 'assessment', specialtyId: entry.bankId, slug: first };
}

export function assessmentWorkspaceCrumbs(definition: {
  readonly title: string;
  readonly bankId: string;
  readonly bankLabel: string;
  readonly category: string;
}): readonly AssessmentCrumb[] {
  const bankHref =
    definition.bankId === 'mine' ? userQuestionnaireHomePath() : specialtyPath(definition.bankId);
  const crumbs: AssessmentCrumb[] = [
    { label: 'Тесты', href: '#/assessments' },
    { label: definition.bankLabel, href: bankHref },
  ];
  if (isSectionId(definition.category)) {
    crumbs.push({
      label:
        ASSESSMENT_SECTIONS.find((section) => section.id === definition.category)?.title ??
        definition.category,
      href: sectionPath(definition.bankId, definition.category),
    });
  }
  crumbs.push({ label: definition.title });
  return crumbs;
}

export function assessmentCatalogCrumbs(
  specialtyTitle: string,
  specialtyId: string,
  sectionTitle?: string,
): readonly AssessmentCrumb[] {
  if (!sectionTitle) {
    return [{ label: 'Тесты', href: '#/assessments' }, { label: specialtyTitle }];
  }
  return [
    { label: 'Тесты', href: '#/assessments' },
    { label: specialtyTitle, href: specialtyPath(specialtyId) },
    { label: sectionTitle },
  ];
}

export function assessmentParentHash(route: string): string | null {
  if (!route.startsWith('assessments')) return null;
  const parsed = readAssessmentRoute(`#/${route}`);
  switch (parsed.kind) {
    case 'index':
      return null;
    case 'user-index':
      return '#/assessments';
    case 'user-editor':
      return parsed.fileId ? userQuestionnairePath(parsed.fileId) : userQuestionnaireHomePath();
    case 'user-assessment':
      return userQuestionnaireHomePath();
    case 'user-result':
      return userQuestionnairePath(parsed.fileId);
    case 'specialty':
      return '#/assessments';
    case 'section':
      return specialtyPath(parsed.specialtyId);
    case 'assessment':
      return assessmentHomePath(parsed.slug);
    case 'result':
      return assessmentPath(parsed.specialtyId, parsed.slug);
  }
}
