import type { ContentModuleCatalogEntry } from '@localmed/contracts';
import type { AppGlyphName } from '@/components/AppGlyph';
import { HERBAL_MODULE_ID, herbalPlantCountLabel } from '@/features/herbal/herbal-chapter';
import { HERBAL_BOOK_HASH } from '@/features/herbal/herbal-routing';
import { isModuleReleased } from '@/features/modules/local-packaged-modules';
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

/** A book of the knowledge base listed with the sections: it opens its own page, not a search scope. */
export interface SectionShortcutRow {
  readonly id: string;
  readonly label: string;
  readonly icon: AppGlyphName;
  readonly countLabel: string;
  readonly href: string;
}

/**
 * «Травник» (owner 2026-10-19): the herbal book next to the search sections, with its plant count,
 * once the release offers it. The book itself offers the download, so it is never locked.
 */
export function sectionShortcutRows(
  modules: readonly ContentModuleCatalogEntry[],
): readonly SectionShortcutRow[] {
  const herbal = modules.filter(
    (module) => module.id === HERBAL_MODULE_ID && isModuleReleased(module),
  );
  if (herbal.length === 0) return [];
  return [
    {
      id: 'herbal',
      label: 'Травник',
      icon: 'leaf',
      countLabel: herbalPlantCountLabel(herbal) ?? '',
      href: HERBAL_BOOK_HASH,
    },
  ];
}
