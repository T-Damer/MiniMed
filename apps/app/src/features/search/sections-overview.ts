import type { AppGlyphName } from '@/components/AppGlyph';
import type { SearchScope } from '@/features/search/ScopedMedicalCore';
import type { SearchCatalogSection } from '@/features/search/searchCatalog';
import { formatCount } from '@/i18n/format-count';
import { pluralRu } from '@/i18n/labels';

export interface SectionOverviewRow {
  readonly id: SearchScope;
  readonly label: string;
  readonly icon: AppGlyphName;
  /** «744 рекомендации»: the section's size per the catalog, whatever is installed. */
  readonly countLabel: string;
  readonly empty: boolean;
}

/** «3 324 действующих вещества»: the number and its noun never break apart. */
export function formatSectionCount(
  count: number,
  [one, few, many]: readonly [string, string, string],
): string {
  return `${formatCount(count)} ${pluralRu(count, one, few, many)}`;
}

/**
 * The home screen's section list: every section that declares what it counts, in catalog order.
 * «Все источники» (the default) and clinical analysis (a switch, not a source) have no noun.
 */
export function sectionsOverviewRows(
  sections: readonly SearchCatalogSection[],
): readonly SectionOverviewRow[] {
  return sections.flatMap((section) => {
    if (!section.countNoun) return [];
    const count = section.count ?? 0;
    return [
      {
        id: section.id,
        label: section.label,
        icon: section.icon,
        countLabel: formatSectionCount(count, section.countNoun),
        empty: count === 0,
      },
    ];
  });
}
