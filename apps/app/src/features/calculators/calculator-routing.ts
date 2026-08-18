import { findCalculator } from '@/features/calculators/calculator-registry';

export interface CalculatorCrumb {
  readonly label: string;
  readonly href?: string;
}

function decodeRoutePart(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

export function calculatorSectionPath(sectionId: string): string {
  return `#/calculators/section/${encodeURIComponent(sectionId)}`;
}

export function calculatorWorkspaceCrumbs(input: {
  readonly title: string;
  readonly sectionId: string;
  readonly sectionTitle: string;
}): readonly CalculatorCrumb[] {
  return [
    { label: 'Калькуляторы', href: '#/calculators' },
    { label: input.sectionTitle, href: calculatorSectionPath(input.sectionId) },
    { label: input.title },
  ];
}

export function calculatorSectionCrumbs(sectionTitle: string): readonly CalculatorCrumb[] {
  return [{ label: 'Калькуляторы', href: '#/calculators' }, { label: sectionTitle }];
}

export function calculatorParentHash(route: string): string | null {
  if (!route.startsWith('calculators')) return null;
  const parts = route.split('/');
  if (parts.length <= 1 || parts[0] !== 'calculators') return null;
  if (!parts[1]) return null;

  if (parts[1] === 'section') {
    return parts[2] ? '#/calculators' : null;
  }

  const slug = decodeRoutePart(parts[1]);
  if (!slug) return '#/calculators';
  const definition = findCalculator(slug);
  if (!definition) return '#/calculators';
  return calculatorSectionPath(definition.category);
}
