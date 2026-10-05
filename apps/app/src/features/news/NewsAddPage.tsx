import { type Accessor, createSignal, For, type JSX, Match, Show, Switch } from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { NavBack } from '@/components/NavBack';
import { TextField } from '@/components/TextField';
import { FeedParseError } from '@/features/news/feed-parser';
import { NewsSuggestedFeeds } from '@/features/news/NewsSuggestedFeeds';
import { NEWS_ROOT_HASH } from '@/features/news/news-routing';
import type { NewsSnapshot, SourceInspection } from '@/features/news/news-service';
import { getNewsService } from '@/features/news/news-store';
import { FeedFetchError } from '@/features/news/news-transport';
import type { FetchFailureCode } from '@/features/news/news-types';
import { hostLabel, normalizeSourceUrl } from '@/features/news/source-url';

type AddState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'invalid'; readonly message: string }
  | { readonly kind: 'found'; readonly inspection: SourceInspection }
  | {
      readonly kind: 'failed';
      readonly url: string;
      readonly code: FetchFailureCode;
      readonly message: string;
    };

/** Failures after which the address may still be a website worth opening in the viewer. */
const SITE_FALLBACK_CODES: ReadonlySet<FetchFailureCode> = new Set([
  'cors',
  'not-a-feed',
  'malformed',
  'empty',
  'too-large',
  'http',
  'network',
  'timeout',
]);

function NewsAddFound(props: {
  readonly inspection: SourceInspection;
  readonly busy: boolean;
  readonly onSubscribeFeed: (url: string, preview?: SourceInspection) => void;
  readonly onSubscribeSite: (url: string, title: string) => void;
}): JSX.Element {
  const inspection = props.inspection;
  if (inspection.type === 'feed') {
    return (
      <div class="news-add__result" data-testid="news-add-result">
        <p class="news-add__result-title">
          <AppGlyph name="rss" class="news-add__result-icon" />
          Найдена лента: {inspection.feed.title || hostLabel(inspection.url)}
        </p>
        <p class="news-add__result-meta">Записей в ленте: {inspection.feed.items.length}</p>
        <ul class="news-add__preview">
          <For each={inspection.feed.items.slice(0, 3)}>
            {(item) => <li class="news-add__preview-item">{item.title}</li>}
          </For>
        </ul>
        <div class="news-add__result-actions">
          <button
            type="button"
            class="news-add__primary"
            disabled={props.busy}
            onClick={() => props.onSubscribeFeed(inspection.url, inspection)}
          >
            Подписаться
          </button>
        </div>
      </div>
    );
  }
  return (
    <div class="news-add__result" data-testid="news-add-result">
      <p class="news-add__result-title">
        <AppGlyph name="globe" class="news-add__result-icon" />
        Это сайт: {inspection.title || hostLabel(inspection.url)}
      </p>
      <Show
        when={inspection.feeds.length > 0}
        fallback={
          <p class="news-add__result-meta">
            Страница не объявляет ленту. Её можно добавить как сайт и читать в приложении (без
            счётчика новых записей).
          </p>
        }
      >
        <p class="news-add__result-meta">Сайт объявляет ленты:</p>
        <ul class="news-add__feeds">
          <For each={inspection.feeds}>
            {(feed) => (
              <li class="news-add__feed">
                <span class="news-add__feed-copy">
                  <span class="news-add__feed-title">{feed.title || hostLabel(feed.url)}</span>
                  <span class="news-add__feed-url">{feed.url}</span>
                </span>
                <button
                  type="button"
                  class="news-add__primary"
                  disabled={props.busy}
                  onClick={() => props.onSubscribeFeed(feed.url)}
                >
                  Подписаться
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <div class="news-add__result-actions">
        <button
          type="button"
          class="news-add__secondary"
          disabled={props.busy}
          onClick={() =>
            props.onSubscribeSite(inspection.url, inspection.title || hostLabel(inspection.url))
          }
        >
          Добавить как сайт
        </button>
      </div>
    </div>
  );
}

function NewsAddFailed(props: {
  readonly failed: Extract<AddState, { kind: 'failed' }>;
  readonly busy: boolean;
  readonly onSubscribeSite: (url: string, title: string) => void;
}): JSX.Element {
  return (
    <div class="news-add__result news-add__result--failed" role="alert">
      <p class="news-add__result-title">{props.failed.message}</p>
      <Show when={SITE_FALLBACK_CODES.has(props.failed.code)}>
        <p class="news-add__result-meta">
          Адрес можно добавить как сайт: он откроется в приложении, а если сайт запрещает
          встраивание, — в браузере.
        </p>
        <div class="news-add__result-actions">
          <button
            type="button"
            class="news-add__secondary"
            disabled={props.busy}
            onClick={() => props.onSubscribeSite(props.failed.url, hostLabel(props.failed.url))}
          >
            Добавить как сайт
          </button>
        </div>
      </Show>
    </div>
  );
}

export function NewsAddPage(props: { readonly snapshot: Accessor<NewsSnapshot> }): JSX.Element {
  const service = getNewsService();
  const [address, setAddress] = createSignal('');
  const [state, setState] = createSignal<AddState>({ kind: 'idle' });
  const [busy, setBusy] = createSignal(false);

  const goToList = (): void => {
    window.location.hash = NEWS_ROOT_HASH;
  };

  const inspect = async (): Promise<void> => {
    const normalized = normalizeSourceUrl(address());
    if (!normalized.ok) {
      setState({ kind: 'invalid', message: normalized.message });
      return;
    }
    setState({ kind: 'checking' });
    try {
      const inspection = await service.inspectSource(normalized.url);
      setState({ kind: 'found', inspection });
    } catch (error) {
      if (error instanceof FeedFetchError) {
        setState({ kind: 'failed', url: normalized.url, code: error.code, message: error.message });
      } else if (error instanceof FeedParseError) {
        setState({ kind: 'failed', url: normalized.url, code: error.code, message: error.message });
      } else {
        setState({
          kind: 'failed',
          url: normalized.url,
          code: 'network',
          message: 'Не удалось проверить адрес.',
        });
      }
    }
  };

  const subscribeFeed = async (url: string, preview?: SourceInspection): Promise<void> => {
    setBusy(true);
    try {
      const subscription = await service.subscribeFeed(
        url,
        {},
        preview?.type === 'feed' && preview.url === url ? preview.feed : undefined,
      );
      toast.success(`Источник добавлен: ${subscription.title}`);
      goToList();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось добавить источник.');
    } finally {
      setBusy(false);
    }
  };

  const subscribeSite = async (url: string, title: string): Promise<void> => {
    setBusy(true);
    try {
      const subscription = await service.subscribeSite(url, title);
      toast.success(`Сайт добавлен: ${subscription.title}`);
      goToList();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось добавить сайт.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="news-add page-surface page-grain" data-testid="news-add">
      <header class="news-add__header">
        <NavBack class="knowledge-back-button" aria-label="К ленте" onClick={goToList} />
        <div class="news-add__heading">
          <h1 class="news-add__title">Добавить источник</h1>
          <p class="news-add__description">
            Вставьте адрес ленты (RSS, Atom, JSON Feed) или сайта. Для сайта приложение само найдёт
            ленту, если страница её объявляет.
          </p>
        </div>
      </header>

      <form
        class="news-add__form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void inspect();
        }}
      >
        <TextField
          class="news-add__field"
          label="Адрес ленты или сайта"
          type="url"
          inputMode="url"
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          placeholder="https://example.org/feed.xml"
          value={address()}
          onInput={(event) => setAddress(event.currentTarget.value)}
          name="news-source-url"
        />
        <button
          type="submit"
          class="news-add__submit"
          disabled={state().kind === 'checking' || address().trim() === ''}
        >
          {state().kind === 'checking' ? 'Проверяем…' : 'Проверить'}
        </button>
      </form>
      <p class="news-add__privacy">
        Запрос уйдёт только на этот адрес; источник увидит IP-адрес устройства. Больше ничего не
        отправляется.
      </p>

      <Switch>
        <Match when={state().kind === 'invalid'}>
          <p class="news-add__error" role="alert">
            {(state() as { message: string }).message}
          </p>
        </Match>
        <Match when={state().kind === 'checking'}>
          <p class="news-add__status" role="status">
            Читаем адрес…
          </p>
        </Match>
        <Match when={state().kind === 'found'}>
          <NewsAddFound
            inspection={(state() as Extract<AddState, { kind: 'found' }>).inspection}
            busy={busy()}
            onSubscribeFeed={(url, preview) => void subscribeFeed(url, preview)}
            onSubscribeSite={(url, title) => void subscribeSite(url, title)}
          />
        </Match>
        <Match when={state().kind === 'failed'}>
          <NewsAddFailed
            failed={state() as Extract<AddState, { kind: 'failed' }>}
            busy={busy()}
            onSubscribeSite={(url, title) => void subscribeSite(url, title)}
          />
        </Match>
      </Switch>

      <NewsSuggestedFeeds subscriptions={props.snapshot().subscriptions} />
    </section>
  );
}
