import type { ItemAnalysis } from './prescription-model';

/**
 * What the recipe still lacks, in words: the sheet says which step is missing instead of a general
 * «выберите форму». The recipe line needs the drug, its dosage form and its strength from the
 * registry; the sign comes from the instruction, or from the doctor when there is none.
 */
export function recipeMissingText(
  analyses: readonly Pick<ItemAnalysis, 'state' | 'form' | 'strength' | 'rp'>[],
): string {
  const first = analyses.find((analysis) => analysis.rp === '');
  if (!first) return 'Добавьте препарат: текст рецепта появится здесь.';
  if (first.state === 'pick-drug') return 'Выберите препарат: текст рецепта появится здесь.';
  if (first.form === null) return 'Выберите лекарственную форму: текст рецепта появится здесь.';
  if (first.strength === null) return 'Выберите дозировку: текст рецепта появится здесь.';
  if (first.state === 'loading') return 'Читаем инструкцию…';
  // With a form and a strength the registry gives the Rp. line, instruction or not; an empty one
  // here is the doctor's own text, cleared.
  return 'Впишите текст рецепта: он появится здесь.';
}
