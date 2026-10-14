import type { ItemAnalysis } from './prescription-model';

/**
 * What the recipe still lacks, in words: the sheet says which step is missing instead of a general
 * «выберите форму». The recipe line needs the drug, its dosage form and its strength from the
 * registry, and the instruction the course is read from.
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
  if (first.state === 'not-installed') {
    return 'Рецепт собирается по инструкции: скачайте её в карточке препарата.';
  }
  if (first.state === 'no-instruction') {
    return 'Инструкции этого вещества нет в источниках приложения: рецепт собрать не из чего.';
  }
  return 'Текст рецепта появится здесь.';
}
