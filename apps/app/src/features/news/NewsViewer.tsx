import { matchError } from '@localmed/contracts';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { PAGE_HEROES } from '@/app/page-heroes';

import { AppGlyph } from '@/components/AppGlyph';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { SkeletonLines } from '@/components/PageSkeleton';
import {
  firstImageOf,
  type SafeNode,
  safeTextLength,
  withoutImages,
} from '@/features/news/feed-content';
import { NewsAvatar } from '@/features/news/NewsAvatar';
import { NewsRichText } from '@/features/news/NewsRichText';
import { avatarLookOf } from '@/features/news/news-avatar';
import { attemptFeed, failureState, feedFailureOf } from '@/features/news/news-failure';
import { itemDateLabel, shortSourceName } from '@/features/news/news-format';
import { NEWS_ROOT_HASH } from '@/features/news/news-routing';
import type { NewsSnapshot } from '@/features/news/news-service';
import { getNewsService } from '@/features/news/news-store';
import { feedsNeedNativeApp } from '@/features/news/news-transport';
import type {
  FeedFailure,
  NewsItem,
  StoredArticle,
  Subscription,
} from '@/features/news/news-types';
import { buildPageFrameDocument } from '@/features/news/page-frame';
import { navigateBack } from '@/state/app-back';

export type NewsViewerTarget =
  | { readonly kind: 'item'; readonly itemId: string }
  | { readonly kind: 'site'; readonly feedId: string };

type FrameState = 'loading' | 'loaded' | 'slow';
type ArticleState = 'idle' | 'loading' | 'ready' | 'none' | 'failed';

/** A frame that has not fired `load` by now is treated as refused or stuck. */
export const FRAME_SLOW_AFTER_MS = 12_000;
/** From this much text the feed carries the article itself and the page is not fetched on opening. */
const FULL_TEXT_CHARS = 400;

/**
 * A page an https app may frame: a plain http address would be blocked as mixed content, and almost
 * every site answers https, so the browser build tries that first (the external link keeps the
 * original address).
 */
export function frameAddress(url: string): string {
  return url.replace(/^http:\/\//iu, 'https://');
}

/** The line under a teaser when the full article could not be downloaded; the feed text stays. */
function articleProblem(failure: FeedFailure): string {
  return matchError(failure, {
    offline: () => 'Нет сети — показан текст из ленты.',
    cors: () => 'Сайт не разрешает загрузить статью из браузера — откройте её на сайте.',
    network: () => 'Сайт недоступен — показан текст из ленты.',
    timeout: () => 'Сайт не ответил вовремя — показан текст из ленты.',
    http: (e) => `Сайт вернул ошибку${e.status ? ` ${e.status}` : ''} — показан текст из ленты.`,
    'too-large': () => 'Страница слишком большая — показан текст из ленты.',
    'not-a-feed': () => 'Статью на странице найти не удалось — показан текст из ленты.',
    malformed: () => 'Страницу не удалось прочитать — показан текст из ленты.',
    rejected: () => 'Сайт не принял запрос — показан текст из ленты.',
    empty: () => 'Сайт вернул пустую страницу — показан текст из ленты.',
    unexpected: () => 'Статью обработать не удалось — показан текст из ленты.',
  });
}

function ExternalLink(props: {
  readonly url: string;
  readonly class: string;
  readonly label?: string;
  readonly children: JSX.Element;
}): JSX.Element {
  return (
    <a
      class={props.class}
      href={props.url}
      target="_blank"
      rel="noopener noreferrer"
      referrerPolicy="no-referrer"
      aria-label={props.label}
      title={props.label}
    >
      {props.children}
    </a>
  );
}

function Spinner(props: { readonly label: string }): JSX.Element {
  return (
    <span class="news-viewer__spinner" role="status">
      <AppGlyph name="refresh" class="news-viewer__spinner-icon" />
      <span class="sr-only">{props.label}</span>
    </span>
  );
}

/**
 * Best effort in a browser that may not read the site: the page itself in a frame, as far as the
 * site lets a frame show it. A frame that has not loaded in time is offered the browser instead; a
 * refusal by the site cannot be observed from here, so «Открыть в браузере» stays reachable in the
 * header either way. Android reads pages natively and never gets here.
 */
function NewsSiteFrame(props: { readonly url: string; readonly title: string }): JSX.Element {
  const [state, setState] = createSignal<FrameState>('loading');
  const slowTimer = setTimeout(() => {
    if (state() === 'loading') setState('slow');
  }, FRAME_SLOW_AFTER_MS);
  onCleanup(() => clearTimeout(slowTimer));
  return (
    <div class="news-frame" data-frame-state={state()}>
      <Show when={state() === 'slow'}>
        <div class="news-frame__fallback" role="alert" data-testid="news-frame-fallback">
          <AppGlyph name="globe" class="news-frame__fallback-icon" />
          <p class="news-frame__fallback-title">Страница не открывается внутри приложения</p>
          <ExternalLink url={props.url} class="news-pill news-pill--primary">
            <AppGlyph name="arrow-square-out" class="news-pill__icon" />
            Открыть в браузере
          </ExternalLink>
        </div>
      </Show>
      <iframe
        class="news-frame__frame"
        classList={{ 'news-frame__frame--behind': state() === 'slow' }}
        title={props.title}
        src={frameAddress(props.url)}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        allow=""
        onLoad={() => setState('loaded')}
      />
    </div>
  );
}

type RawState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly document: string }
  | { readonly kind: 'failed'; readonly failure: FeedFailure };

/**
 * The page as the site serves it, downloaded by the app and shown with its scripts removed in a
 * sandboxed frame (`srcdoc`, no `allow-scripts`). X-Frame-Options does not apply: the frame shows
 * the app's own copy, not the site.
 */
/** What the page fallback says: the state of the failure, in the build that is running. */
function pageFailure(failure: FeedFailure) {
  return failureState(failure, { browserBuild: feedsNeedNativeApp() });
}

function NewsRawPage(props: { readonly url: string; readonly title: string }): JSX.Element {
  const service = getNewsService();
  const [state, setState] = createSignal<RawState>({ kind: 'loading' });
  const abort = new AbortController();
  onCleanup(() => abort.abort());
  onMount(() => {
    const address = service.transportKind === 'web' ? frameAddress(props.url) : props.url;
    void attemptFeed(() => service.fetchPage(address, abort.signal)).then((fetched) => {
      if (abort.signal.aborted) return;
      setState(
        fetched.ok
          ? {
              kind: 'ready',
              document: buildPageFrameDocument(fetched.value.html, fetched.value.finalUrl),
            }
          : { kind: 'failed', failure: fetched.error },
      );
    });
  });
  return (
    <Switch>
      <Match when={state().kind === 'loading'}>
        <SkeletonLines class="news-viewer__page-loading" label="Загружаем страницу" lines={8} />
      </Match>
      <Match when={state().kind === 'ready'}>
        <iframe
          class="news-viewer__page"
          data-testid="news-page-frame"
          title={props.title}
          srcdoc={(state() as Extract<RawState, { kind: 'ready' }>).document}
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          allow=""
        />
      </Match>
      <Match when={(state() as Extract<RawState, { kind: 'failed' }>).failure.kind === 'cors'}>
        <NewsSiteFrame url={props.url} title={props.title} />
      </Match>
      <Match when={true}>
        <div class="news-frame__fallback" role="alert" data-testid="news-frame-fallback">
          <AppGlyph name="globe" class="news-frame__fallback-icon" />
          <p class="news-frame__fallback-title">
            {pageFailure((state() as Extract<RawState, { kind: 'failed' }>).failure).title}
          </p>
          <Show when={pageFailure((state() as Extract<RawState, { kind: 'failed' }>).failure).text}>
            {(text) => <p class="news-frame__fallback-text">{text()}</p>}
          </Show>
          <ExternalLink url={props.url} class="news-pill news-pill--primary">
            <AppGlyph name="arrow-square-out" class="news-pill__icon" />
            Открыть в браузере
          </ExternalLink>
        </div>
      </Match>
    </Switch>
  );
}

function NewsArticle(props: {
  readonly item: NewsItem;
  readonly subscription: Subscription | undefined;
  readonly article: StoredArticle | undefined;
  readonly state: ArticleState;
  readonly problem: string | undefined;
}): JSX.Element {
  const images = () => props.subscription?.images === true;
  const source = (): 'page' | 'feed' => (props.article ? 'page' : 'feed');
  const rawNodes = (): readonly SafeNode[] => props.article?.content ?? props.item.content;
  const nodes = () => (images() ? rawNodes() : withoutImages(rawNodes()));
  const hasPictures = () =>
    props.item.imageUrl !== undefined ||
    props.article?.imageUrl !== undefined ||
    firstImageOf(rawNodes()) !== undefined;
  // The cover is the item's image, unless the text already shows that same picture.
  const coverUrl = (): string | undefined => {
    const cover = props.item.imageUrl ?? props.article?.imageUrl;
    return images() && cover && cover !== firstImageOf(nodes()) ? cover : undefined;
  };
  return (
    <article
      class="news-article paper-sheet"
      data-testid="news-article"
      data-article-source={source()}
    >
      <h1 class="news-article__title">{props.item.title}</h1>
      <p class="news-article__meta">
        {itemDateLabel(props.item.publishedAt)}
        <Show when={props.item.author ?? props.article?.byline}>
          {(author) => <> · {author()}</>}
        </Show>
        <Show when={props.state === 'loading'}>
          <Spinner label="Загружаем статью" />
        </Show>
      </p>
      <Show when={coverUrl()}>
        {(src) => (
          <img
            class="news-article__cover"
            data-testid="news-article-cover"
            src={src()}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
          />
        )}
      </Show>
      <Show when={!images() && hasPictures() && props.subscription?.kind === 'feed'}>
        <button
          type="button"
          class="news-pill"
          data-testid="news-article-images"
          onClick={() => {
            const subscription = props.subscription;
            if (subscription) getNewsService().setImages(subscription.id, true);
          }}
        >
          <AppGlyph name="image" class="news-pill__icon" />
          Показать картинки
        </button>
      </Show>
      <Show when={props.problem}>
        {(message) => (
          <p class="news-article__problem" role="status">
            <AppGlyph name="info" class="news-article__problem-icon" />
            {message()}
          </p>
        )}
      </Show>
      {/* The body fades in again when the article replaces the feed text: the two classes name the same animation twice, so a change of class restarts it. */}
      <div
        class="news-article__body"
        classList={{
          'news-article__body--page': source() === 'page',
          'news-article__body--feed': source() === 'feed',
        }}
        data-testid="news-article-body"
      >
        <Show
          when={nodes().length > 0}
          fallback={
            <p class="news-article__empty">
              {props.item.snippet || 'Лента не передала текст этой записи.'}
            </p>
          }
        >
          <NewsRichText nodes={nodes()} images={images()} />
        </Show>
      </div>
      <Show when={props.subscription?.kind === 'pubmed' && props.item.url}>
        {(url) => (
          <ExternalLink url={url()} class="news-pill news-pill--primary">
            <AppGlyph name="arrow-square-out" class="news-pill__icon" />
            Открыть в PubMed
          </ExternalLink>
        )}
      </Show>
    </article>
  );
}

export function NewsViewer(props: {
  readonly target: NewsViewerTarget;
  readonly snapshot: Accessor<NewsSnapshot>;
}): JSX.Element {
  const service = getNewsService();
  const item = createMemo(() =>
    props.target.kind === 'item'
      ? props
          .snapshot()
          .items.find((entry) => entry.id === (props.target as { itemId: string }).itemId)
      : undefined,
  );
  const subscription = createMemo(() => {
    const snapshot = props.snapshot();
    if (props.target.kind === 'site') {
      const feedId = props.target.feedId;
      return snapshot.subscriptions.find((entry) => entry.id === feedId);
    }
    const feedId = item()?.feedId;
    return feedId ? snapshot.subscriptions.find((entry) => entry.id === feedId) : undefined;
  });
  const pageUrl = createMemo(() =>
    props.target.kind === 'site' ? subscription()?.url : item()?.url,
  );
  // PubMed refuses framing and its record carries no abstract: the record itself is the view.
  const isPubmed = () => subscription()?.kind === 'pubmed';
  const isSite = () => props.target.kind === 'site';
  const [raw, setRaw] = createSignal(false);
  const [article, setArticle] = createSignal<StoredArticle>();
  const [articleState, setArticleState] = createSignal<ArticleState>('idle');
  const [problem, setProblem] = createSignal<string>();
  const [cacheChecked, setCacheChecked] = createSignal(false);

  createEffect(() => {
    const current = item();
    if (current && !current.read) void service.markRead(current.id);
  });

  // Opening an item: the saved article first (offline), then the page when the feed gave a teaser.
  createEffect(
    on(
      () => item()?.id,
      (id) => {
        const current = item();
        if (!id || !current) return;
        const abort = new AbortController();
        onCleanup(() => abort.abort());
        void (async () => {
          const saved = await service.cachedArticle(id);
          if (abort.signal.aborted) return;
          setCacheChecked(true);
          if (saved) {
            setArticle(saved);
            setArticleState('ready');
            return;
          }
          const teaser = safeTextLength(current.content) < FULL_TEXT_CHARS;
          if (!current.url || isPubmed() || !teaser) return;
          setArticleState('loading');
          try {
            const downloaded = await service.downloadArticle(current, abort.signal);
            if (abort.signal.aborted) return;
            setArticle(downloaded);
            setArticleState(downloaded ? 'ready' : 'none');
          } catch (error) {
            if (abort.signal.aborted) return;
            setProblem(articleProblem(feedFailureOf(error)));
            setArticleState('failed');
          }
        })();
      },
    ),
  );

  const title = () => item()?.title ?? subscription()?.title ?? '';
  const missing = () =>
    props.snapshot().itemsLoaded && (props.target.kind === 'item' ? !item() : !subscription());
  const showRaw = () => isSite() || raw();
  const canToggle = () => !isSite() && !isPubmed() && pageUrl() !== undefined;
  const sourceName = () => {
    const entry = subscription();
    return entry ? shortSourceName(entry.title) : 'Лента';
  };
  const look = () => {
    const entry = subscription();
    return entry ? avatarLookOf(entry, props.snapshot().icons) : undefined;
  };

  return (
    <section class="news-viewer page-surface page-grain" data-testid="news-viewer">
      <Page
        hero={PAGE_HEROES.news}
        class="news-viewer__heading"
        navigation={
          <NavBack
            class="knowledge-back-button"
            aria-label="К ленте"
            onClick={() => {
              navigateBack(NEWS_ROOT_HASH);
            }}
          />
        }
        parent={{ label: 'Лента', href: NEWS_ROOT_HASH }}
        title={
          <span class="news-viewer__source">
            <NewsAvatar size="xs" look={look()} glyph={isPubmed() ? 'search' : undefined} />
            <span class="news-viewer__source-name">{sourceName()}</span>
          </span>
        }
        {...(isPubmed()
          ? {
              help: (
                <p>
                  Это сведения из PubMed: название, журнал, авторы. Аннотация и ссылки на полный
                  текст — на странице статьи; она откроется в браузере.
                </p>
              ),
              helpTitle: 'О записи',
            }
          : {})}
        actions={
          <div class="news-viewer__actions">
            <Show when={canToggle()}>
              <button
                type="button"
                class="news-icon-button"
                classList={{ 'news-icon-button--active': raw() }}
                aria-pressed={raw()}
                aria-label={raw() ? 'Показать статью' : 'Показать страницу сайта'}
                title={raw() ? 'Показать статью' : 'Показать страницу сайта'}
                data-testid="news-viewer-raw"
                onClick={() => setRaw((value) => !value)}
              >
                <AppGlyph name={raw() ? 'file-text' : 'browsers'} class="news-icon-button__icon" />
              </button>
            </Show>
            <Show when={pageUrl()}>
              {(url) => (
                <ExternalLink url={url()} class="news-icon-button" label="Открыть в браузере">
                  <AppGlyph name="arrow-square-out" class="news-icon-button__icon" />
                </ExternalLink>
              )}
            </Show>
          </div>
        }
      />
      <Show
        when={!missing()}
        fallback={
          <div class="news-viewer__missing" role="status">
            <p>Эта запись больше не хранится в ленте.</p>
            <button
              type="button"
              class="news-pill"
              onClick={() => {
                window.location.hash = NEWS_ROOT_HASH;
              }}
            >
              К ленте
            </button>
          </div>
        }
      >
        <Show
          when={showRaw() && pageUrl()}
          fallback={
            <Show when={item() && (cacheChecked() || isPubmed())}>
              <NewsArticle
                item={item() as NewsItem}
                subscription={subscription()}
                article={article()}
                state={articleState()}
                problem={problem()}
              />
            </Show>
          }
        >
          {(url) => <NewsRawPage url={url()} title={title()} />}
        </Show>
      </Show>
    </section>
  );
}
