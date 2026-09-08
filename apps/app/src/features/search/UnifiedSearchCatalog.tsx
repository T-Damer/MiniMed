import type { MedicalCore, MedicalDocumentSummary } from '@localmed/contracts';
import { type JSX, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { ClinicalTags } from '@/components/ClinicalTags';
import { LayoutVirtualizedGrid } from '@/components/LayoutVirtualizedGrid';
import { DocumentLibrary } from '@/features/library/DocumentLibrary';
import type { SearchScope } from '@/features/search/ScopedMedicalCore';
import type { SearchCatalogTool } from '@/features/search/searchCatalog';

export function UnifiedSearchCatalog(props: {
  readonly core: MedicalCore;
  readonly scope: SearchScope;
  readonly query: string;
  readonly hideDocuments?: boolean;
  readonly catalogOnly?: boolean;
  readonly documents: readonly MedicalDocumentSummary[];
  readonly tools: readonly SearchCatalogTool[];
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly onOpenTool: () => void;
}): JSX.Element {
  const tools = () =>
    props.catalogOnly || props.scope === 'calculators' || props.scope === 'assessments';
  return (
    <section class="unified-catalog" aria-label="Каталог выбранного раздела">
      <Show when={tools() || (props.scope === 'all' && props.tools.length > 0)}>
        <div class="unified-catalog__tools">
          <LayoutVirtualizedGrid data={props.tools}>
            {(entry) => (
              <a
                class="unified-catalog__tool catalog-card paper-card"
                href={entry.href}
                aria-label={entry.title}
                onClick={props.onOpenTool}
              >
                <span class="catalog-card__tags">
                  <AppGlyph name={entry.icon} class="unified-catalog__icon" />
                  <ClinicalTags title={entry.title} specialties={[entry.group]} />
                </span>
                <strong class="catalog-card__title">{entry.title}</strong>
                <span class="catalog-card__description">{entry.description}</span>
              </a>
            )}
          </LayoutVirtualizedGrid>
        </div>
        <Show when={props.tools.length === 0}>
          <p class="unified-catalog__empty">Инструменты не найдены. Уточните запрос или раздел.</p>
        </Show>
      </Show>
      <Show when={!props.hideDocuments && !tools() && !props.query.trim()}>
        <Show when={props.loading}>
          <p class="unified-catalog__status" role="status">
            Открываем каталог…
          </p>
        </Show>
        <Show when={props.error}>
          {(message) => (
            <p class="unified-catalog__error" role="alert">
              {message()}
            </p>
          )}
        </Show>
        <Show when={!props.loading && !props.error}>
          <DocumentLibrary
            core={props.core}
            embedded
            hideGraphControl
            query=""
            documents={props.documents}
          />
        </Show>
      </Show>
    </section>
  );
}
