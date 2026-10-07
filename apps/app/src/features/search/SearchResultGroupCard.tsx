import type { SearchResult, SearchResultCategory, SearchResultGroup } from '@localmed/contracts';
import { children, For, type JSX, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { CATEGORY_VISUALS } from '@/components/ClinicalGlyph';
import { Disclosure } from '@/components/Disclosure';
import { HighlightedText } from '@/components/HighlightedText';
import { IcdText } from '@/components/IcdText';
import { ICD11_RESULT_LABEL, isIcd11DocumentId } from '@/features/icd11/icd11-document';
import {
  displaySectionPath,
  orderResultsForDisplay,
  presentResultSnippet,
} from '@/features/search/search-result-presentation';
import { RESULT_KIND_VISUALS } from '@/features/search/searchResultKindVisuals';
import { pluralRu } from '@/i18n/labels';
import '@/features/search/search-result-group.css';

const CATEGORY_LABELS: Readonly<Record<SearchResultCategory, string>> = {
  overview: 'Обзор',
  'clinical-picture': 'Клиника',
  'differential-diagnosis': 'Дифференциальный поиск',
  diagnostics: 'Диагностика',
  treatment: 'Лечение',
  routing: 'Маршрутизация',
  'follow-up': 'Наблюдение',
  other: 'Прочее',
};

const CATEGORY_PATH_ALIASES: Readonly<Record<SearchResultCategory, readonly string[]>> = {
  overview: ['обзор', 'определение', 'классификация', 'введение'],
  'clinical-picture': ['клиника', 'клиническая картина', 'клинические проявления'],
  'differential-diagnosis': ['дифференциальный', 'дифференциальная диагностика'],
  diagnostics: ['диагностика', 'обследование'],
  treatment: ['лечение', 'терапия'],
  routing: ['маршрутизация', 'госпитализация', 'направление'],
  'follow-up': ['наблюдение', 'реабилитация', 'профилактика', 'диспансеризация'],
  other: [],
};

function normalizePathSegment(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isCategoryPathSegment(category: SearchResultCategory, segment: string): boolean {
  const normalized = normalizePathSegment(segment);
  const label = normalizePathSegment(CATEGORY_LABELS[category]);
  if (normalized === label || normalized.includes(label) || label.includes(normalized)) {
    return true;
  }
  return CATEGORY_PATH_ALIASES[category].some(
    (alias) => normalized === alias || normalized.includes(alias) || alias.includes(normalized),
  );
}

function supplementalSectionPath(
  category: SearchResultCategory,
  sectionPath: readonly string[],
): string | null {
  const extra = sectionPath.filter((segment) => !isCategoryPathSegment(category, segment));
  return extra.length > 0 ? extra.join(' / ') : null;
}

export function SearchResultGroupCard(props: {
  readonly group: SearchResultGroup;
  readonly index: number;
  readonly selectedChunkId: string | undefined;
  readonly action: JSX.Element;
  readonly onOpenDocument: (documentId: string) => void;
  readonly onOpenResult: (result: SearchResult) => void;
}): JSX.Element {
  // Resolved once: the first line of the header gives up room to the action only when it shows.
  const action = children(() => props.action);
  const kind = () =>
    isIcd11DocumentId(props.group.documentId)
      ? { icon: RESULT_KIND_VISUALS.reference.icon, label: ICD11_RESULT_LABEL }
      : RESULT_KIND_VISUALS[props.group.documentKind ?? 'reference'];
  // Only what changes how a hit should be read; storage details (pointer, summary, full text)
  // stay out of the result.
  const contentLabel = (): string | undefined =>
    props.group.terminologyMatch === 'term'
      ? 'Медицинский термин'
      : props.group.terminologyMatch === 'term-mention'
        ? 'Вхождение термина в источнике'
        : props.group.terminologyMatch === 'related-term'
          ? 'Смежное понятие MeSH — не клинический вывод'
          : undefined;
  const results = () => {
    const ordered = orderResultsForDisplay(props.group.results);
    return props.group.documentKind === 'medication' ? ordered.slice(0, 3) : ordered;
  };
  const renderExcerpt = (result: SearchResult): JSX.Element => {
    const visual = CATEGORY_VISUALS[result.category];
    const pathSuffix = supplementalSectionPath(
      result.category,
      displaySectionPath(result.sectionPath),
    );
    const snippet = presentResultSnippet(result);
    return (
      <article
        class="result-card"
        classList={{
          'result-card--selected': props.selectedChunkId === result.chunkId,
        }}
      >
        <button
          class="result-open"
          type="button"
          data-testid="search-result"
          onClick={() => props.onOpenResult(result)}
        >
          <span class="result-category-line">
            {/* “Прочее” names no section; the path suffix says more. */}
            <Show when={result.category !== 'other'}>
              <span class={`category-stamp tone-${visual.tone}`}>
                {CATEGORY_LABELS[result.category]}
              </span>
            </Show>
            {/* A fragment that opens with its own label («МКБ-10: …») needs no label above. */}
            <Show
              when={pathSuffix && !snippet.text.startsWith(pathSuffix) ? pathSuffix : undefined}
            >
              {(path) => <span class="result-path result-category-line__path">{path()}</span>}
            </Show>
          </span>
          <p class="result-snippet">
            <HighlightedText text={snippet.text} ranges={snippet.ranges} />
          </p>
        </button>
      </article>
    );
  };
  return (
    <section class="result-group" data-document-id={props.group.documentId}>
      <div
        class="result-group__head"
        classList={{ 'result-group__head--with-action': action() !== undefined }}
      >
        <button
          type="button"
          class="result-group-header"
          onClick={() => props.onOpenDocument(props.group.documentId)}
        >
          <span
            class="result-group-header__index"
            classList={{ 'result-group-header__index--under-action': action() !== undefined }}
            aria-hidden="true"
          >
            {String(props.index + 1).padStart(2, '0')}
          </span>

          <span class="result-group-header__body">
            <span class="result-group-header__kind">
              <AppGlyph name={kind().icon} class="result-group-header__kind-icon" />
              <span class="result-group-header__kind-label">{kind().label}</span>
            </span>
            <Show when={contentLabel()}>
              {(label) => <span class="result-group-header__content-kind">{label()}</span>}
            </Show>
            <strong class="result-group-header__title">
              <IcdText text={props.group.title} />
            </strong>
          </span>
        </button>
        {action()}
      </div>
      <div class="result-group__snippets">
        <For each={results().slice(0, 1)}>{renderExcerpt}</For>
        <Show when={results().length > 1}>
          <Disclosure
            variant="inline"
            class="result-group__more"
            title={`Ещё ${results().length - 1} ${pluralRu(results().length - 1, 'фрагмент', 'фрагмента', 'фрагментов')}`}
          >
            <For each={results().slice(1)}>{renderExcerpt}</For>
          </Disclosure>
        </Show>
      </div>
    </section>
  );
}
