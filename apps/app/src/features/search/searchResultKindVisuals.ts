import type { SearchResultGroup } from '@localmed/contracts';
import type { AppGlyphName } from '@/components/AppGlyph';
import { ICD11_RESULT_LABEL } from '@/features/icd11/icd11-document';
import type {
  SearchResultDocumentKind,
  SearchResultDocumentType,
} from '@/features/search/ScopedMedicalCore';

export const RESULT_KIND_VISUALS: Readonly<
  Record<SearchResultDocumentKind, { readonly icon: AppGlyphName; readonly label: string }>
> = {
  medication: { icon: 'prescription', label: 'Препарат' },
  'clinical-recommendation': { icon: 'book-open', label: 'Клиническая рекомендация' },
  legal: { icon: 'scales', label: 'Нормативный акт' },
  calculator: { icon: 'calculator', label: 'Калькулятор' },
  assessment: { icon: 'list-checks', label: 'Опросник' },
  reference: { icon: 'notes', label: 'Справочник' },
};

/** What a result card calls its source: the document type a doctor knows. */
export const RESULT_TYPE_VISUALS: Readonly<
  Record<SearchResultDocumentType, { readonly icon: AppGlyphName; readonly label: string }>
> = {
  'clinical-recommendation': { icon: 'book-open', label: 'Клинические рекомендации' },
  medication: { icon: 'prescription', label: 'Препарат' },
  order: { icon: 'scales', label: 'Приказ' },
  law: { icon: 'scales', label: 'Закон' },
  legal: { icon: 'scales', label: 'Нормативный акт' },
  calculator: { icon: 'calculator', label: 'Калькулятор' },
  assessment: { icon: 'list-checks', label: 'Опросник' },
  icd10: { icon: 'list-dashes', label: 'МКБ-10' },
  icd11: { icon: 'list-dashes', label: ICD11_RESULT_LABEL },
  definition: { icon: 'text-aa', label: 'Определение' },
  reference: { icon: 'books', label: 'Справочник' },
};

/**
 * The card's type label. A group found as the term itself reads as its definition; a group from an
 * older saved search (no `documentType`) falls back on the coarser document kind.
 */
export function resultTypeVisual(
  group: Pick<SearchResultGroup, 'documentType' | 'documentKind' | 'terminologyMatch'>,
): { readonly icon: AppGlyphName; readonly label: string } {
  if (group.terminologyMatch === 'term') return RESULT_TYPE_VISUALS.definition;
  if (group.documentType) return RESULT_TYPE_VISUALS[group.documentType];
  return RESULT_KIND_VISUALS[group.documentKind ?? 'reference'];
}
