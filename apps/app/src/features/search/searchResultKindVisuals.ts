import type { AppGlyphName } from '@/components/AppGlyph';
import type { SearchResultDocumentKind } from '@/features/search/ScopedMedicalCore';

export const RESULT_KIND_VISUALS: Readonly<
  Record<SearchResultDocumentKind, { readonly icon: AppGlyphName; readonly label: string }>
> = {
  medication: { icon: 'prescription', label: 'Препарат' },
  'clinical-recommendation': { icon: 'book-open', label: 'Клиническая рекомендация' },
  legal: { icon: 'scales', label: 'Нормативный акт' },
  calculator: { icon: 'calculator', label: 'Калькулятор' },
  assessment: { icon: 'list-checks', label: 'Опросник' },
  reference: { icon: 'notes', label: 'Норма / справочник' },
};
