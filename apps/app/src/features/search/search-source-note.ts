import type { SourceScope } from '@localmed/contracts';
import { pluralRu } from '@/i18n/labels';

/** «6 068 материалов»: what a named source holds, the number and its noun never break apart. */
export function sourceMaterialsLabel(count: number): string {
  return `${count.toLocaleString('ru-RU').replaceAll(' ', ' ')} ${pluralRu(count, 'материал', 'материала', 'материалов')}`;
}

/**
 * The note's line: the source and what is searched inside it, or, for a bare name, how much the
 * source holds (the list below is what the doctor asked for).
 */
export function sourceNoteText(scope: SourceScope): string {
  return scope.remainder
    ? `${scope.label} · «${scope.remainder}»`
    : `${scope.label} · ${sourceMaterialsLabel(scope.documentCount)}`;
}
