import {
  type Accessor,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { NavBack } from '@/components/NavBack';
import { TextField } from '@/components/TextField';
import { FeedParseError } from '@/features/news/feed-parser';
import { NEWS_ROOT_HASH } from '@/features/news/news-routing';
import type { NewsSnapshot } from '@/features/news/news-service';
import { pluralRu, subscriptionIdFor } from '@/features/news/news-state';
import { getNewsService } from '@/features/news/news-store';
import { FeedFetchError } from '@/features/news/news-transport';
import {
  authorsShort,
  normalizePubmedQuery,
  PUBMED_MAX_QUERY_CHARS,
  type PubmedArticle,
  pubmedArticleUrl,
  pubmedDateLabel,
  pubmedSearchPageUrl,
} from '@/features/news/pubmed';
import type { PubmedSearchResult } from '@/features/news/pubmed-client';

type SearchState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'searching' }
  | { readonly kind: 'failed'; readonly message: string };

/** Kept while the app is open so that leaving to read an article and coming back loses nothing. Never persisted, never logged. */
const [lastQuery, setLastQuery] = createSignal('');
const [lastResult, setLastResult] = createSignal<PubmedSearchResult | undefined>();

function ArticleRow(props: { readonly article: PubmedArticle }): JSX.Element {
  const meta = () =>
    [props.article.journal, props.article.pubdate ? pubmedDateLabel(props.article.pubdate) : '']
      .filter((part) => part !== '')
      .join(' · ');
  return (
    <li class="news-pubmed__item">
      <a
        class="news-pubmed__link"
        href={pubmedArticleUrl(props.article.pmid)}
        target="_blank"
        rel="noopener noreferrer"
        referrerPolicy="no-referrer"
        data-pubmed-article={props.article.pmid}
      >
        <span class="news-pubmed__copy">
          <span class="news-pubmed__title">{props.article.title}</span>
          <Show when={meta()}>
            <span class="news-pubmed__meta">{meta()}</span>
          </Show>
          <Show when={props.article.authors.length > 0}>
            <span class="news-pubmed__authors">{authorsShort(props.article.authors)}</span>
          </Show>
        </span>
        <AppGlyph name="arrow-square-out" class="news-pubmed__open" />
      </a>
    </li>
  );
}

/**
 * PubMed search through NCBI E-utilities (ADR-0024). User-initiated only: nothing is sent until the
 * user presses «Найти», and the notice above the button says what is sent. The result can be saved
 * as a source that refreshes with the others.
 */
export function NewsPubmedPage(props: { readonly snapshot: Accessor<NewsSnapshot> }): JSX.Element {
  const service = getNewsService();
  const [query, setQuery] = createSignal(lastQuery());
  const [state, setState] = createSignal<SearchState>({ kind: 'idle' });
  const [result, setResult] = createSignal(lastResult());
  const [saving, setSaving] = createSignal(false);
  let controller: AbortController | undefined;
  onCleanup(() => controller?.abort());

  const saved = createMemo(() => {
    const current = result();
    if (!current) return undefined;
    const id = subscriptionIdFor(pubmedSearchPageUrl(current.query));
    return props.snapshot().subscriptions.find((entry) => entry.id === id);
  });

  const search = async (): Promise<void> => {
    const checked = normalizePubmedQuery(query());
    if (!checked.ok) {
      setState({ kind: 'failed', message: checked.message });
      return;
    }
    controller?.abort();
    const mine = new AbortController();
    controller = mine;
    setState({ kind: 'searching' });
    try {
      const found = await service.searchPubmed(checked.query, mine.signal);
      if (mine.signal.aborted) return;
      setLastQuery(checked.query);
      setLastResult(found);
      setResult(found);
      setState({ kind: 'idle' });
    } catch (error) {
      if (mine.signal.aborted) return;
      const message =
        error instanceof FeedFetchError || error instanceof FeedParseError
          ? error.message
          : 'Не удалось выполнить поиск.';
      setState({ kind: 'failed', message });
    }
  };

  const save = async (): Promise<void> => {
    const current = result();
    if (!current) return;
    setSaving(true);
    try {
      await service.subscribePubmed(current.query, current);
      toast.success('Поиск сохранён: новые статьи будут появляться в ленте.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось сохранить поиск.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section class="news-pubmed page-surface page-grain" data-testid="news-pubmed">
      <header class="news-pubmed__header">
        <NavBack
          class="knowledge-back-button"
          aria-label="К ленте"
          onClick={() => {
            window.location.hash = NEWS_ROOT_HASH;
          }}
        />
        <div class="news-pubmed__heading">
          <h1 class="news-pubmed__page-title">Поиск в PubMed</h1>
          <p class="news-pubmed__description">
            Статьи из базы PubMed (NCBI), самые новые — первыми. Для точного запроса подойдут
            английские термины и операторы AND / OR.
          </p>
        </div>
      </header>

      <form
        class="news-pubmed__form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <TextField
          class="news-pubmed__field"
          label="Запрос"
          type="search"
          enterkeyhint="search"
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          maxLength={PUBMED_MAX_QUERY_CHARS}
          placeholder="например, glaucoma AND treatment"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          name="news-pubmed-query"
        />
        <Button
          type="submit"
          variant="primary"
          class="news-pubmed__submit"
          icon={<AppGlyph name="search" />}
          disabled={state().kind === 'searching' || query().trim() === ''}
        >
          {state().kind === 'searching' ? 'Ищем…' : 'Найти'}
        </Button>
      </form>
      <p class="news-pubmed__notice" data-testid="news-pubmed-notice">
        <AppGlyph name="info" class="news-pubmed__notice-icon" />
        Текст запроса отправляется в NCBI (PubMed) — только когда вы нажимаете «Найти».
      </p>

      <Switch>
        <Match when={state().kind === 'failed'}>
          <p class="news-pubmed__error" role="alert">
            {(state() as Extract<SearchState, { kind: 'failed' }>).message}
          </p>
        </Match>
        <Match when={state().kind === 'searching'}>
          <p class="news-pubmed__status" role="status">
            Ищем в PubMed…
          </p>
        </Match>
      </Switch>

      <Show when={result()}>
        {(found) => (
          <section class="news-pubmed__results" data-testid="news-pubmed-results">
            <Show
              when={found().articles.length > 0}
              fallback={<p class="news-pubmed__status">По этому запросу ничего не найдено.</p>}
            >
              <p class="news-pubmed__summary">
                Найдено: {found().total.toLocaleString('ru-RU')}{' '}
                {pluralRu(found().total, 'статья', 'статьи', 'статей')}. Показаны самые новые:{' '}
                {found().articles.length}.
              </p>
              <ul class="news-pubmed__list">
                <For each={found().articles}>{(article) => <ArticleRow article={article} />}</For>
              </ul>
            </Show>
            <div class="news-pubmed__save">
              <Show
                when={saved()}
                fallback={
                  <>
                    <Button
                      variant="secondary"
                      class="news-pubmed__subscribe"
                      icon={<AppGlyph name="rss" />}
                      disabled={saving()}
                      onClick={() => void save()}
                    >
                      Подписаться на этот поиск
                    </Button>
                    <p class="news-pubmed__hint">
                      Свежие статьи будут появляться в ленте при её обновлении. Запрос уходит в NCBI
                      при каждом обновлении; отключить можно в «Источниках».
                    </p>
                  </>
                }
              >
                <p class="news-pubmed__saved" role="status" data-testid="news-pubmed-saved">
                  <AppGlyph name="check" class="news-pubmed__saved-icon" />
                  Поиск сохранён как источник. <a href={NEWS_ROOT_HASH}>К ленте</a>
                </p>
              </Show>
            </div>
          </section>
        )}
      </Show>
    </section>
  );
}
