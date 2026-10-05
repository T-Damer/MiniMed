/** Routes of «Мои калькуляторы»; the calculator itself opens on the ordinary `#/calculators/<id>`. */
export const USER_CALCULATORS_SEGMENT = 'mine';

export function userCalculatorsPath(): string {
  return `#/calculators/${USER_CALCULATORS_SEGMENT}`;
}

export function userCalculatorNewPath(): string {
  return `${userCalculatorsPath()}/new`;
}

export function userCalculatorEditPath(id: string): string {
  return `${userCalculatorsPath()}/${encodeURIComponent(id)}/edit`;
}

export type UserCalculatorRoute =
  | { readonly kind: 'list' }
  | { readonly kind: 'new' }
  | { readonly kind: 'edit'; readonly id: string };

/**
 * Reads a hash route (without `#/`). Returns undefined for any route that is not part of
 * «Мои калькуляторы»; `section/custom` is the section path of the same list.
 */
export function parseUserCalculatorRoute(route: string): UserCalculatorRoute | undefined {
  const parts = route.split('/');
  if (parts[0] !== 'calculators') return undefined;
  if (parts[1] === 'section' && parts[2] === 'custom') return { kind: 'list' };
  if (parts[1] !== USER_CALCULATORS_SEGMENT) return undefined;
  if (parts.length === 2) return { kind: 'list' };
  if (parts.length === 3 && parts[2] === 'new') return { kind: 'new' };
  if (parts.length === 4 && parts[3] === 'edit' && parts[2]) {
    try {
      return { kind: 'edit', id: decodeURIComponent(parts[2]) };
    } catch {
      return { kind: 'list' };
    }
  }
  return { kind: 'list' };
}
