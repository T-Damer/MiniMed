import type { SearchResult, SearchResultCategory, SearchResultGroup } from '@localmed/contracts';
import { For, type JSX, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { CATEGORY_VISUALS, ClinicalGlyph } from '@/components/ClinicalGlyph';
import { ClinicalTags } from '@/components/ClinicalTags';
import { Disclosure } from '@/components/Disclosure';
import { HighlightedText } from '@/components/HighlightedText';
import { IcdText } from '@/components/IcdText';
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
  readonly specialties: readonly string[];
  readonly selectedChunkId: string | undefined;
  readonly action: JSX.Element;
  readonly onOpenDocument: (documentId: string) => void;
  readonly onOpenResult: (result: SearchResult) => void;
}): JSX.Element {
  const kind = () => RESULT_KIND_VISUALS[props.group.documentKind ?? 'reference'];
  const contentLabel = () =>
    props.group.terminologyMatch === 'term'
      ? 'Медицинский термин'
      : props.group.terminologyMatch === 'term-mention'
        ? 'Вхождение термина в источнике'
        : props.group.terminologyMatch === 'related-term'
          ? 'Смежное понятие MeSH — не клинический вывод'
          : props.group.contentKind === 'summary'
            ? 'Краткий обзор'
            : props.group.contentKind === 'pointer'
              ? 'Карточка источника'
              : 'Полный текст';
  const results = () =>
    props.group.documentKind === 'medication'
      ? props.group.results.slice(0, 3)
      : props.group.results;
  const renderExcerpt = (result: SearchResult): JSX.Element => {
    const visual = CATEGORY_VISUALS[result.category];
    const pathSuffix = supplementalSectionPath(result.category, result.sectionPath);
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
            <span class={`result-category-icon tone-${visual.tone}`} aria-hidden="true">
              <ClinicalGlyph name={visual.icon} />
            </span>
            {/* “Прочее” names no section; the path suffix says more. */}
            <Show when={result.category !== 'other'}>
              <span class={`category-stamp tone-${visual.tone}`}>
                {CATEGORY_LABELS[result.category]}
              </span>
            </Show>
            <Show when={pathSuffix}>
              <span class="result-path">{pathSuffix}</span>
            </Show>
          </span>
          <p class="result-snippet">
            <HighlightedText text={result.snippet} ranges={result.highlightedRanges} />
          </p>
        </button>
      </article>
    );
  };
  return (
    <section class="result-group">
      <button
        type="button"
        class="result-group-header"
        onClick={() => props.onOpenDocument(props.group.documentId)}
      >
        <span class="result-group-header__index" aria-hidden="true">
          {String(props.index + 1).padStart(2, '0')}
        </span>

        <span class="result-group-header__body">
          <span class="result-group-header__kind">
            <AppGlyph name={kind().icon} class="result-group-header__kind-icon" />
            <span class="result-group-header__kind-label">{kind().label}</span>
          </span>
          <span class="result-group-header__content-kind">{contentLabel()}</span>
          <strong class="result-group-header__title">
            <IcdText text={props.group.title} />
          </strong>
          <ClinicalTags title={props.group.title} specialties={props.specialties} />
          <span class="result-group-header__note result-minimal-note">
            {props.group.results[0]?.sectionPath.join(' / ') ?? 'Релевантный источник'}
          </span>
        </span>
      </button>
      {props.action}
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
