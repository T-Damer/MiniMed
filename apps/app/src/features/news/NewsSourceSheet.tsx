import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { OverlayDialog } from '@/components/OverlayDialog';
import { FeedParseError, type ParsedFeed } from '@/features/news/feed-parser';
import { NewsAvatar } from '@/features/news/NewsAvatar';
import { avatarLook } from '@/features/news/news-avatar';
import { relativeTimeLabel } from '@/features/news/news-format';
import type { SourceInspection } from '@/features/news/news-service';
import { subscriptionIdFor } from '@/features/news/news-state';
import { getNewsService } from '@/features/news/news-store';
import {
  BROWSER_FEEDS_MESSAGE,
  FeedFetchError,
  isBrowserReadFailure,
} from '@/features/news/news-transport';
import type { FetchFailureCode, Subscription } from '@/features/news/news-types';
import { sheetAvatarTransitionName } from '@/features/news/news-view-transition';
import { type DiscoveredFeed, hostLabel } from '@/features/news/source-url';
import { bundledAvatarFor } from '@/features/news/suggested-avatars';
import type { SuggestedFeed } from '@/features/news/suggested-feeds';

/** What the sheet previews: a suggested source, or an address the user typed. */
export type SourceTarget =
  | { readonly kind: 'suggested'; readonly feed: SuggestedFeed }
  | { readonly kind: 'address'; readonly url: string };

type Preview =
  | { readonly kind: 'loading' }
  | { readonly kind: 'feed'; readonly url: string; readonly feed: ParsedFeed }
  | {
      readonly kind: 'page';
      readonly url: string;
      readonly title: string;
      readonly feeds: readonly DiscoveredFeed[];
    }
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

const PREVIEW_ITEMS = 5;
const MAX_FEED_CHOICES = 4;

function targetUrl(target: SourceTarget): string {
  return target.kind === 'suggested' ? target.feed.url : target.url;
}

function failureOf(error: unknown): { code: FetchFailureCode; message: string } {
  if (error instanceof FeedFetchError || error instanceof FeedParseError) {
    // A browser cannot tell «refused» from «unreachable» and can do nothing about either.
    if (isBrowserReadFailure(error.code)) {
      return { code: error.code, message: BROWSER_FEEDS_MESSAGE };
    }
    return { code: error.code, message: error.message };
  }
  return { code: 'network', message: 'Не удалось проверить адрес.' };
}

/**
 * The sheet of one source (a suggested card, or an address typed on «Источники»): avatar, name,
 * description, what it published lately, and «Подписаться». Nothing is requested until the sheet
 * opens, and then only the address of this source.
 */
export function NewsSourceSheet(props: {
  readonly target: SourceTarget | undefined;
  readonly subscriptions: readonly Subscription[];
  readonly icons: Readonly<Record<string, string>>;
  readonly onClose: () => void;
}): JSX.Element {
  const service = getNewsService();
  // The last target stays in place while the sheet slides away.
  const [shown, setShown] = createSignal<SourceTarget | undefined>(props.target);
  const [preview, setPreview] = createSignal<Preview>({ kind: 'loading' });
  const [choices, setChoices] = createSignal<readonly DiscoveredFeed[]>([]);
  const [fetchedIcon, setFetchedIcon] = createSignal<string | undefined>();
  const [busy, setBusy] = createSignal(false);
  let controller: AbortController | undefined;

  const inspect = async (url: string, signal: AbortSignal, followFeeds: boolean): Promise<void> => {
    let inspection: SourceInspection;
    try {
      inspection = await service.inspectSource(url, signal);
    } catch (error) {
      if (signal.aborted) return;
      setPreview({ kind: 'failed', url, ...failureOf(error) });
      return;
    }
    if (signal.aborted) return;
    if (inspection.type === 'feed') {
      setPreview({ kind: 'feed', url: inspection.url, feed: inspection.feed });
      const site = inspection.feed.siteUrl ?? inspection.url;
      if (bundledAvatarFor(site) === undefined) {
        void service
          .previewIcon(site, inspection.feed.iconUrl, signal)
          .then((icon) => {
            if (!signal.aborted) setFetchedIcon(icon);
          })
          .catch((error: unknown) => {
            if (!signal.aborted) console.warn('Значок источника не получен.', error);
          });
      }
      return;
    }
    const found = inspection.feeds.slice(0, MAX_FEED_CHOICES);
    setPreview({ kind: 'page', url: inspection.url, title: inspection.title, feeds: found });
    setChoices(found);
    const first = found[0];
    if (followFeeds && first) await inspect(first.url, signal, false);
  };

  createEffect(
    on(
      () => props.target,
      (target) => {
        controller?.abort();
        if (!target) return;
        const mine = new AbortController();
        controller = mine;
        setShown(target);
        setPreview({ kind: 'loading' });
        setChoices([]);
        setFetchedIcon(undefined);
        setBusy(false);
        void inspect(targetUrl(target), mine.signal, true);
      },
    ),
  );
  onCleanup(() => controller?.abort());

  const suggested = () => {
    const target = shown();
    return target?.kind === 'suggested' ? target.feed : undefined;
  };
  const feedOf = () => {
    const current = preview();
    return current.kind === 'feed' ? current.feed : undefined;
  };
  const title = createMemo(() => {
    const known = suggested()?.title ?? feedOf()?.title;
    if (known) return known;
    const current = preview();
    const target = shown();
    if (current.kind === 'page' && current.title) return current.title;
    return hostLabel(target ? targetUrl(target) : '');
  });
  const siteUrl = () =>
    suggested()?.siteUrl ??
    feedOf()?.siteUrl ??
    (shown() ? targetUrl(shown() as SourceTarget) : undefined);
  const description = () => suggested()?.description ?? feedOf()?.description;
  const look = createMemo(() => {
    const site = siteUrl();
    const base = avatarLook(title(), site, props.icons, suggested()?.id);
    const fetched = fetchedIcon();
    return fetched && !base.src ? { ...base, src: fetched } : base;
  });
  const pageUrl = (): string | undefined => {
    const current = preview();
    return current.kind === 'feed' || current.kind === 'page' || current.kind === 'failed'
      ? current.url
      : undefined;
  };
  const subscribed = () => {
    const url = pageUrl() ?? (shown() ? targetUrl(shown() as SourceTarget) : '');
    const id = subscriptionIdFor(url);
    return props.subscriptions.some((entry) => entry.id === id);
  };
  const domain = () => hostLabel(siteUrl() ?? '');

  const finish = (message: string): void => {
    toast.success(message);
    props.onClose();
  };
  const subscribeFeed = async (): Promise<void> => {
    const current = preview();
    if (current.kind !== 'feed') return;
    setBusy(true);
    try {
      const pick = suggested();
      const subscription = await service.subscribeFeed(
        pick?.url ?? current.url,
        {
          ...(pick ? { title: pick.title, language: pick.language, suggestedId: pick.id } : {}),
          ...(pick?.carriesImages ? { images: true } : {}),
          ...(fetchedIcon() ? { icon: fetchedIcon() as string } : {}),
        },
        current.feed,
      );
      finish(`Источник добавлен: ${subscription.title}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось добавить источник.');
    } finally {
      setBusy(false);
    }
  };
  const subscribeSite = async (): Promise<void> => {
    const pick = suggested();
    const url = pick?.siteUrl ?? pageUrl() ?? (shown() ? targetUrl(shown() as SourceTarget) : '');
    setBusy(true);
    try {
      const current = preview();
      const name =
        pick?.title ?? (current.kind === 'page' && current.title ? current.title : hostLabel(url));
      const subscription = await service.subscribeSite(url, name, {
        ...(fetchedIcon() ? { icon: fetchedIcon() as string } : {}),
      });
      finish(`Сайт добавлен: ${subscription.title}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось добавить сайт.');
    } finally {
      setBusy(false);
    }
  };
  const chooseFeed = (feed: DiscoveredFeed): void => {
    controller?.abort();
    const mine = new AbortController();
    controller = mine;
    setPreview({ kind: 'loading' });
    void inspect(feed.url, mine.signal, false);
  };
  /** The web build cannot read this source: say so, offer no action that could not work there. */
  const browserBlocked = () => {
    const current = preview();
    return current.kind === 'failed' && isBrowserReadFailure(current.code);
  };
  const siteOnlyAllowed = () => {
    const current = preview();
    if (current.kind === 'page') return current.feeds.length === 0;
    return (
      current.kind === 'failed' &&
      SITE_FALLBACK_CODES.has(current.code) &&
      !isBrowserReadFailure(current.code)
    );
  };
  const feedItems = () => feedOf()?.items.slice(0, PREVIEW_ITEMS) ?? [];

  return (
    <OverlayDialog
      open={props.target !== undefined}
      title={title()}
      subtitle={domain()}
      class="news-sheet"
      bodyClass="news-sheet__body"
      headerStart={
        <NewsAvatar size="md" look={look()} transitionName={sheetAvatarTransitionName()} />
      }
      onClose={props.onClose}
    >
      <div class="news-sheet__content" data-testid="news-source-sheet">
        <Show when={description()}>
          {(text) => <p class="news-sheet__description">{text()}</p>}
        </Show>
        <Show
          when={subscribed()}
          fallback={
            <Switch>
              <Match when={preview().kind === 'feed'}>
                <Button
                  variant="primary"
                  class="news-sheet__subscribe"
                  icon={<AppGlyph name="plus" />}
                  disabled={busy()}
                  onClick={() => void subscribeFeed()}
                >
                  Подписаться
                </Button>
              </Match>
              <Match when={siteOnlyAllowed()}>
                <Button
                  variant="primary"
                  class="news-sheet__subscribe"
                  icon={<AppGlyph name="globe" />}
                  disabled={busy()}
                  onClick={() => void subscribeSite()}
                >
                  Добавить как сайт
                </Button>
              </Match>
              <Match when={!browserBlocked()}>
                <Button
                  variant="primary"
                  class="news-sheet__subscribe"
                  icon={<AppGlyph name="plus" />}
                  disabled
                >
                  Подписаться
                </Button>
              </Match>
            </Switch>
          }
        >
          <p class="news-sheet__subscribed" role="status">
            <AppGlyph name="check" class="news-sheet__subscribed-icon" />
            Уже в ленте
          </p>
        </Show>

        <Show when={choices().length > 1}>
          <ul class="news-sheet__choices" aria-label="Ленты сайта">
            <For each={choices()}>
              {(choice) => (
                <li class="news-sheet__choice-item">
                  <button
                    type="button"
                    class="news-sheet__choice"
                    aria-pressed={pageUrl() === choice.url}
                    onClick={() => chooseFeed(choice)}
                  >
                    {choice.title || hostLabel(choice.url)}
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <Switch>
          <Match when={preview().kind === 'loading'}>
            <ul class="news-sheet__news news-sheet__news--loading" aria-busy="true" role="status">
              <li class="news-sheet__skeleton" />
              <li class="news-sheet__skeleton" />
              <li class="news-sheet__skeleton news-sheet__skeleton--short" />
            </ul>
          </Match>
          <Match when={feedItems().length > 0}>
            <ul class="news-sheet__news" data-testid="news-source-items">
              <For each={feedItems()}>
                {(item) => (
                  <li class="news-sheet__news-item">
                    <span class="news-sheet__news-title">{item.title}</span>
                    <Show when={item.publishedAt !== undefined}>
                      <span class="news-sheet__news-time">
                        {relativeTimeLabel(item.publishedAt as number, Date.now())}
                      </span>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </Match>
          <Match when={preview().kind === 'failed'}>
            <p class="news-sheet__problem" role="alert">
              <AppGlyph name="info" class="news-sheet__problem-icon" />
              {(preview() as Extract<Preview, { kind: 'failed' }>).message}
            </p>
          </Match>
        </Switch>
      </div>
    </OverlayDialog>
  );
}
