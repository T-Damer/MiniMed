import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { NavBack } from '@/components/NavBack';
import { SegmentedControl } from '@/components/SegmentedControl';
import { firstImageOf, safeTextLength, withoutImages } from '@/features/news/feed-content';
import { NewsRichText } from '@/features/news/NewsRichText';
import { itemDateLabel } from '@/features/news/news-format';
import { NEWS_ROOT_HASH } from '@/features/news/news-routing';
import type { NewsSnapshot } from '@/features/news/news-service';
import { getNewsService, probeFraming } from '@/features/news/news-store';
import type { NewsItem, Subscription } from '@/features/news/news-types';
import { hostLabel } from '@/features/news/source-url';

export type NewsViewerTarget =
  | { readonly kind: 'item'; readonly itemId: string }
  | { readonly kind: 'site'; readonly feedId: string };

type ViewerMode = 'feed' | 'page';
type FrameState = 'checking' | 'loading' | 'loaded' | 'slow' | 'refused';

/** A frame that has not fired `load` by now is treated as refused or stuck. */
export const FRAME_SLOW_AFTER_MS = 12_000;
/** Below this much text the feed gave a teaser, and the page is the better first view. */
const FULL_TEXT_CHARS = 400;

/**
 * A page an https app may frame: a plain http address would be blocked as mixed content, and almost
 * every site answers https, so the viewer tries that first (the external link keeps the original).
 */
export function frameAddress(url: string): string {
  return url.replace(/^http:\/\//iu, 'https://');
}

function addressLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`;
    return `${parsed.hostname.replace(/^www\./u, '')}${path === '/' ? '' : path}`;
  } catch {
    return url;
  }
}

function ExternalLink(props: {
  readonly url: string;
  readonly class: string;
  readonly children: JSX.Element;
}): JSX.Element {
  return (
    <a
      class={props.class}
      href={props.url}
      target="_blank"
      rel="noopener noreferrer"
      referrerPolicy="no-referrer"
    >
      {props.children}
    </a>
  );
}

function NewsSiteFrame(props: {
  readonly url: string;
  readonly title: string;
  /** Set when the cached text can stand in for a refused page. */
  readonly onShowFeed?: (() => void) | undefined;
}): JSX.Element {
  const [state, setState] = createSignal<FrameState>('checking');
  let slowTimer: ReturnType<typeof setTimeout> | undefined;
  const abort = new AbortController();

  onMount(() => {
    void probeFraming(frameAddress(props.url), abort.signal).then((verdict) => {
      if (abort.signal.aborted) return;
      setState(verdict === 'refused' ? 'refused' : 'loading');
    });
  });
  createEffect(
    on(state, (current) => {
      if (slowTimer) clearTimeout(slowTimer);
      slowTimer = undefined;
      if (current === 'loading') {
        slowTimer = setTimeout(() => {
          if (state() === 'loading') setState('slow');
        }, FRAME_SLOW_AFTER_MS);
      }
    }),
  );
  onCleanup(() => {
    abort.abort();
    if (slowTimer) clearTimeout(slowTimer);
  });

  const frameVisible = () => state() === 'loading' || state() === 'loaded' || state() === 'slow';
  return (
    <div class="news-frame" data-frame-state={state()}>
      <Show when={state() === 'checking'}>
        <p class="news-frame__status" role="status">
          Проверяем, можно ли показать страницу…
        </p>
      </Show>
      <Show when={state() === 'refused' || state() === 'slow'}>
        <div class="news-frame__fallback" role="alert" data-testid="news-frame-fallback">
          <AppGlyph name="globe" class="news-frame__fallback-icon" />
          <p class="news-frame__fallback-title">
            {state() === 'refused'
              ? 'Этот сайт не разрешает показ внутри приложения'
              : 'Страница не открывается внутри приложения'}
          </p>
          <p class="news-frame__fallback-text">
            {state() === 'refused'
              ? 'Сайт запрещает встраивание в чужие страницы (X-Frame-Options или frame-ancestors). Откройте его в браузере.'
              : 'Возможно, сайт запрещает встраивание или не отвечает. Откройте его в браузере.'}
          </p>
          <div class="news-frame__fallback-actions">
            <ExternalLink url={props.url} class="news-viewer__action news-viewer__action--primary">
              <AppGlyph name="arrow-square-out" class="news-viewer__action-icon" />
              Открыть в браузере
            </ExternalLink>
            <Show when={props.onShowFeed}>
              {(show) => (
                <button type="button" class="news-viewer__action" onClick={() => show()()}>
                  <AppGlyph name="file-text" class="news-viewer__action-icon" />
                  Текст из ленты
                </button>
              )}
            </Show>
          </div>
        </div>
      </Show>
      <Show when={frameVisible()}>
        <p class="news-frame__hint">
          Пустая страница? Многие сайты запрещают встраивание —{' '}
          <ExternalLink url={props.url} class="news-frame__hint-link">
            открыть в браузере
          </ExternalLink>
          .
        </p>
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
      </Show>
    </div>
  );
}

function NewsArticle(props: {
  readonly item: NewsItem;
  readonly subscription: Subscription | undefined;
}): JSX.Element {
  const images = () => props.subscription?.images === true;
  const nodes = () => (images() ? props.item.content : withoutImages(props.item.content));
  // The cover is the item's image, unless the text already shows that same picture.
  const coverUrl = (): string | undefined => {
    const cover = props.item.imageUrl;
    return images() && cover && cover !== firstImageOf(nodes()) ? cover : undefined;
  };
  return (
    <article class="news-article" data-testid="news-article">
      <p class="news-article__meta">
        {props.subscription?.title ?? 'Источник удалён'} · {itemDateLabel(props.item.publishedAt)}
        <Show when={props.item.author}>{(author) => <> · {author()}</>}</Show>
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
      <Show when={!images() && props.item.imageUrl && props.subscription?.kind === 'feed'}>
        <button
          type="button"
          class="news-article__images"
          data-testid="news-article-images"
          onClick={() => {
            const subscription = props.subscription;
            if (subscription) getNewsService().setImages(subscription.id, true);
          }}
        >
          <AppGlyph name="image" class="news-article__images-icon" />У записи есть картинка.
          Показывать картинки этого источника (они загружаются с его сайта)
        </button>
      </Show>
      <div class="news-article__body">
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
          <ExternalLink url={url()} class="news-viewer__action news-viewer__action--primary">
            <AppGlyph name="arrow-square-out" class="news-viewer__action-icon" />
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
  const hasText = () => (item()?.content.length ?? 0) > 0 || (item()?.snippet ?? '') !== '';
  // PubMed refuses framing and its record carries no abstract: the record itself is the view.
  const isPubmed = () => subscription()?.kind === 'pubmed';
  const [mode, setMode] = createSignal<ViewerMode>('page');
  let modeChosen = false;
  // The first view is the feed's own text when it carries a real article, the page otherwise.
  createEffect(() => {
    const current = item();
    if (modeChosen || !current) return;
    modeChosen = true;
    const fullText = safeTextLength(current.content) >= FULL_TEXT_CHARS;
    setMode(fullText || !current.url || isPubmed() ? 'feed' : 'page');
  });
  createEffect(() => {
    const current = item();
    if (current && !current.read) void service.markRead(current.id);
  });

  const title = () => item()?.title ?? subscription()?.title ?? '';
  const missing = () =>
    props.snapshot().itemsLoaded && (props.target.kind === 'item' ? !item() : !subscription());
  const showPage = () => props.target.kind === 'site' || mode() === 'page';

  return (
    <section class="news-viewer page-surface page-grain" data-testid="news-viewer">
      <header class="news-viewer__bar">
        <NavBack
          class="knowledge-back-button news-viewer__back"
          aria-label="К ленте"
          onClick={() => {
            window.location.hash = NEWS_ROOT_HASH;
          }}
        />
        <div class="news-viewer__heading">
          <p class="news-viewer__source">{subscription()?.title ?? 'Лента'}</p>
          <h1 class="news-viewer__title">{title()}</h1>
          <Show when={pageUrl()}>
            {(url) => (
              <p class="news-viewer__address" data-testid="news-viewer-address">
                <AppGlyph
                  name={/^http:/iu.test(url()) ? 'info' : 'lock'}
                  class="news-viewer__address-icon"
                />
                {addressLabel(url())}
                <Show when={/^http:/iu.test(url())}>
                  <span class="news-viewer__address-warning"> · без шифрования</span>
                </Show>
              </p>
            )}
          </Show>
        </div>
        <Show when={pageUrl()}>
          {(url) => (
            <ExternalLink url={url()} class="news-viewer__external">
              <AppGlyph name="arrow-square-out" class="news-viewer__action-icon" />
              <span class="news-viewer__external-label">Открыть в браузере</span>
            </ExternalLink>
          )}
        </Show>
      </header>
      <Show
        when={!missing()}
        fallback={
          <div class="news-viewer__missing" role="status">
            <p>Эта запись больше не хранится в ленте.</p>
            <button
              type="button"
              class="news-viewer__action"
              onClick={() => {
                window.location.hash = NEWS_ROOT_HASH;
              }}
            >
              К ленте
            </button>
          </div>
        }
      >
        <Show when={props.target.kind === 'item' && pageUrl() && hasText() && !isPubmed()}>
          <SegmentedControl
            class="news-viewer__mode"
            label="Что показать"
            value={mode()}
            onChange={setMode}
            options={[
              { value: 'feed', label: 'Из ленты' },
              { value: 'page', label: 'Страница' },
            ]}
          />
        </Show>
        <Show
          when={showPage() && pageUrl()}
          fallback={
            <Show when={item()}>
              {(current) => <NewsArticle item={current()} subscription={subscription()} />}
            </Show>
          }
        >
          {(url) => (
            <NewsSiteFrame
              url={url()}
              title={title()}
              onShowFeed={item() && hasText() ? () => setMode('feed') : undefined}
            />
          )}
        </Show>
      </Show>
      <Show when={subscription()?.kind === 'feed' && pageUrl() && !showPage()}>
        <p class="news-viewer__note">
          Это текст, который опубликовала лента. Полная статья — на странице источника (
          {hostLabel(pageUrl() ?? '')}).
        </p>
      </Show>
      <Show when={isPubmed() && pageUrl()}>
        <p class="news-viewer__note">
          Это сведения из PubMed: название, журнал, авторы. Аннотация и ссылки на полный текст — на
          странице статьи; она откроется в браузере.
        </p>
      </Show>
    </section>
  );
}
