import { readAssessmentRoute } from '@/features/assessments/assessment-routing';
import { clearReturnTo, type ReturnToLocation, restoreReturnTo } from '@/state/return-navigation';

interface ToolEntry {
  readonly workspace: string;
  readonly from: ReturnToLocation;
}
const STORAGE_KEY = 'minimed:tool-entry-trail';

export function toolWorkspace(hash: string): string | undefined {
  const route = hash.replace(/^#\/?/u, '');
  const parts = route.split('/');
  if (parts[0] === 'calculators' && parts[1] && parts[1] !== 'section') {
    return `calculators/${parts[1]}`;
  }
  if (parts[0] !== 'assessments') return undefined;
  const assessment = readAssessmentRoute(hash);
  switch (assessment.kind) {
    case 'assessment':
    case 'result':
      return `assessments/${assessment.specialtyId}/${assessment.slug}`;
    case 'user-assessment':
    case 'user-result':
    case 'user-editor':
      return `assessments/mine/${assessment.fileId ?? 'new'}`;
    default:
      return undefined;
  }
}

function readTrail(): readonly ToolEntry[] {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((entry: unknown): entry is ToolEntry => {
      if (!entry || typeof entry !== 'object' || !('workspace' in entry) || !('from' in entry))
        return false;
      const from = entry.from;
      return (
        typeof entry.workspace === 'string' &&
        !!from &&
        typeof from === 'object' &&
        'hash' in from &&
        typeof from.hash === 'string' &&
        from.hash.startsWith('#/') &&
        'search' in from &&
        typeof from.search === 'string' &&
        (from.search === '' || from.search.startsWith('?'))
      );
    });
  } catch {
    return [];
  }
}

export function trackToolNavigation(oldURL: string, newURL: string): void {
  if (!URL.canParse(oldURL) || !URL.canParse(newURL)) return;
  const before = new URL(oldURL);
  const after = new URL(newURL);
  if (before.origin !== after.origin || before.pathname !== after.pathname) return;
  const oldWorkspace = toolWorkspace(before.hash);
  const workspace = toolWorkspace(after.hash);
  const trail = readTrail();
  const last = trail.at(-1);
  // Creation replaces the temporary /new route with its saved file, not a new entry point.
  if (oldWorkspace === 'assessments/mine/new' && workspace?.startsWith('assessments/mine/')) {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        last?.workspace === oldWorkspace ? [...trail.slice(0, -1), { ...last, workspace }] : [],
      ),
    );
    return;
  }
  if (
    last &&
    last.workspace === oldWorkspace &&
    last.from.hash === after.hash &&
    last.from.search === after.search
  ) {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(trail.slice(0, -1)));
    return;
  }
  if (oldWorkspace === workspace) return;
  if (!workspace) {
    sessionStorage.removeItem(STORAGE_KEY);
    return;
  }
  const parents = oldWorkspace ? trail : [];
  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify([
      ...parents,
      {
        workspace,
        from: { hash: before.hash || '#/search', search: before.search },
      },
    ]),
  );
}

export function returnFromTool(): boolean {
  const entry = readTrail().at(-1);
  if (!entry || entry.workspace !== toolWorkspace(window.location.hash)) return false;
  clearReturnTo();
  restoreReturnTo(entry.from);
  return true;
}
