export type DocumentInteractiveToolKind = 'assessment' | 'calculator';

export interface DocumentInteractiveToolLink {
  readonly kind: DocumentInteractiveToolKind;
  readonly id: string;
  readonly href: string;
  readonly label: 'Пройти' | 'Рассчитать';
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function routeMatchesKind(route: string, kind: DocumentInteractiveToolKind): boolean {
  if (/\s/u.test(route) || route.includes('?')) return false;
  const prefix = kind === 'assessment' ? '#/assessments/' : '#/calculators/';
  if (!route.startsWith(prefix)) return false;
  const remainder = route.slice(prefix.length);
  return Boolean(remainder) && remainder.split('/').every(Boolean);
}

/**
 * Returns a CTA only for an explicitly reviewed tool link.
 *
 * A title, alias, entity type or calculationRequired flag is never enough to infer a route.
 * This keeps a reference card useful when the interactive definition is absent or installed later.
 */
export function documentInteractiveToolLink(
  metadata: Readonly<Record<string, unknown>>,
): DocumentInteractiveToolLink | undefined {
  const assessmentId = nonEmptyString(metadata['interactiveAssessmentId']);
  const calculatorId = nonEmptyString(metadata['interactiveCalculatorId']);
  const route = nonEmptyString(metadata['interactiveRoute']);
  if (!route || Boolean(assessmentId) === Boolean(calculatorId)) return undefined;

  if (assessmentId) {
    if (!routeMatchesKind(route, 'assessment')) return undefined;
    return { kind: 'assessment', id: assessmentId, href: route, label: 'Пройти' };
  }
  if (!calculatorId || !routeMatchesKind(route, 'calculator')) return undefined;
  return { kind: 'calculator', id: calculatorId, href: route, label: 'Рассчитать' };
}
