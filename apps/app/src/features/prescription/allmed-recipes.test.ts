import type { MedicalDocument } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { extractAllmedRecipes } from './allmed-recipes';

function allmedDoc(sections: { title: string; text: string }[]): MedicalDocument {
  return {
    id: 'drug.allmed.test',
    title: 'Тестовый препарат',
    sourceType: 'allmed_reference',
    language: 'ru',
    metadata: {},
    sections: sections.map((section, index) => ({
      id: `sec-${index}`,
      anchor: `sec-${index}`,
      title: section.title,
      depth: 1,
      chunks: [
        {
          id: `chunk-${index}`,
          anchor: `chunk-${index}`,
          originalText: section.text,
        },
      ],
    })),
  } as unknown as MedicalDocument;
}

describe('extractAllmedRecipes', () => {
  it('prefers Russian signatura from recipe_ru, deduplicates blocks, and extracts form numbers', () => {
    const doc = allmedDoc([
      {
        title: 'Пример рецепта — справочно, не назначение',
        text: 'Rp.: Tab. Acidi acetylsalicylici 500 mg\nD.t.d. N 20\nS. Take 1 tablet orally.\n\nRp.: Sol. Atropini 1% - 5 ml\nD.S.: По 1 капле.',
      },
      {
        title: 'Расшифровка примера рецепта — справочно',
        text: 'Rp.: Tab. Acidi acetylsalicylici 500 mg\nD.t.d. N 20\nS. Принимать по 1 таблетке внутрь.\n\nРецептурный бланк - 107-1/у\nОтпускается без рецепта',
      },
    ]);

    const summary = extractAllmedRecipes([doc]);
    expect(summary.recipes.length).toBeGreaterThanOrEqual(2);
    expect(summary.recipes[0]?.text).toContain('Принимать по 1 таблетке внутрь');
    expect(summary.formNumbers).toEqual(['107-1/у']);
    expect(summary.dispensingNotes).toContain('Отпускается без рецепта');
  });

  it('keeps primary recipe blocks when recipe_ru only contains dispensing notes', () => {
    const doc = allmedDoc([
      {
        title: 'Пример рецепта — справочно, не назначение',
        text: 'Rp.: Sol. Atropini 1% - 5 ml\nD.S.: По 1-2 капли.',
      },
      {
        title: 'Расшифровка примера рецепта — справочно',
        text: 'Рецептурный бланк - 107-1/у',
      },
    ]);

    const summary = extractAllmedRecipes([doc]);
    expect(summary.recipes).toHaveLength(1);
    expect(summary.recipes[0]?.text).toContain('Atropini');
    expect(summary.formNumbers).toEqual(['107-1/у']);
  });
});
