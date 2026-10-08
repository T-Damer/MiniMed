import { type Accessor, createSignal, For, type JSX, onMount, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { Switch } from '@/components/Switch';
import { TextField } from '@/components/TextField';
import { NewsAvatar } from '@/features/news/NewsAvatar';
import { NewsSourceSheet, type SourceTarget } from '@/features/news/NewsSourceSheet';
import { avatarLookOf } from '@/features/news/news-avatar';
import { NEWS_ROOT_HASH } from '@/features/news/news-routing';
import type { NewsSnapshot } from '@/features/news/news-service';
import { fetchedAtLabel } from '@/features/news/news-state';
import { getNewsService } from '@/features/news/news-store';
import type { Subscription } from '@/features/news/news-types';
import { buildOpml, parseOpml } from '@/features/news/opml';
import { hostLabel, normalizeSourceUrl } from '@/features/news/source-url';
import { shareSystemFile } from '@/state/native-share';

function SourceRow(props: {
  readonly subscription: Subscription;
  readonly icons: Readonly<Record<string, string>>;
  readonly onImages: (enabled: boolean) => void;
  readonly onRemove: () => void;
}): JSX.Element {
  const detail = (): string => {
    const subscription = props.subscription;
    if (subscription.error) return `${hostLabel(subscription.url)} · ${subscription.error.message}`;
    if (subscription.kind === 'site') return `${hostLabel(subscription.url)} · сайт`;
    return `${hostLabel(subscription.siteUrl ?? subscription.url)} · ${fetchedAtLabel(subscription.fetchedAt, Date.now())}`;
  };
  return (
    <li class="news-source" data-source={props.subscription.id}>
      <NewsAvatar
        size="sm"
        look={avatarLookOf(props.subscription, props.icons)}
        glyph={props.subscription.kind === 'pubmed' ? 'search' : undefined}
      />
      <span class="news-source__copy">
        <span class="news-source__title">{props.subscription.title}</span>
        <span
          class="news-source__detail"
          classList={{ 'news-source__detail--error': Boolean(props.subscription.error) }}
        >
          {detail()}
        </span>
      </span>
      <Show when={props.subscription.kind === 'feed'}>
        <span class="news-source__images" title="Показывать изображения">
          <AppGlyph name="image" class="news-source__images-icon" />
          <Switch
            checked={props.subscription.images}
            onChange={props.onImages}
            aria-label={`Показывать изображения: ${props.subscription.title}`}
          />
        </span>
      </Show>
      <button
        type="button"
        class="news-icon-button news-icon-button--quiet news-icon-button--danger"
        aria-label={`Удалить: ${props.subscription.title}`}
        title="Удалить"
        onClick={props.onRemove}
      >
        <AppGlyph name="trash" class="news-icon-button__icon" />
      </button>
    </li>
  );
}

/**
 * «Источники»: adding by address and managing the list on one page. An address opens the source
 * sheet (avatar, description, latest entries) before anything is subscribed.
 */
export function NewsSourcesPage(props: {
  readonly snapshot: Accessor<NewsSnapshot>;
  /** Opened from «+»: the address field takes focus. */
  readonly focusAdd?: boolean;
}): JSX.Element {
  const service = getNewsService();
  const [address, setAddress] = createSignal('');
  const [invalid, setInvalid] = createSignal<string>();
  const [target, setTarget] = createSignal<SourceTarget>();
  const [removing, setRemoving] = createSignal<Subscription>();
  const [importing, setImporting] = createSignal(false);
  let field: HTMLInputElement | undefined;

  onMount(() => {
    if (props.focusAdd) queueMicrotask(() => field?.focus());
  });

  const check = (): void => {
    const normalized = normalizeSourceUrl(address());
    if (!normalized.ok) {
      setInvalid(normalized.message);
      return;
    }
    setInvalid(undefined);
    setTarget({ kind: 'address', url: normalized.url });
  };

  const exportOpml = async (): Promise<void> => {
    const blob = new Blob([buildOpml(props.snapshot().subscriptions)], {
      type: 'text/x-opml;charset=utf-8',
    });
    try {
      await shareSystemFile({
        title: 'Источники ленты',
        fileName: 'minimed-news.opml',
        mimeType: 'text/x-opml',
        blob,
      });
    } catch {
      toast.error('Не удалось сохранить файл с источниками.');
    }
  };

  const importOpml = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setImporting(true);
    try {
      const entries = parseOpml(await file.text());
      if (entries.length === 0) {
        toast.error('В файле нет источников.');
        return;
      }
      let added = 0;
      let failed = 0;
      for (const entry of entries) {
        try {
          if (entry.kind === 'feed') {
            await service.subscribeFeed(entry.url, entry.title ? { title: entry.title } : {});
          } else {
            await service.subscribeSite(entry.url, entry.title);
          }
          added += 1;
        } catch {
          failed += 1;
        }
      }
      toast.success(
        `Импортировано источников: ${added}${failed > 0 ? `, не удалось: ${failed}` : ''}`,
      );
    } finally {
      setImporting(false);
    }
  };

  const icons = () => props.snapshot().icons;
  return (
    <section class="news-sources page-surface page-grain" data-testid="news-sources">
      <Page
        class="news-sources__heading"
        navigation={
          <NavBack
            class="knowledge-back-button"
            aria-label="К ленте"
            onClick={() => {
              window.location.hash = NEWS_ROOT_HASH;
            }}
          />
        }
        title={<h1 class="news-sources__title">Источники</h1>}
        help={
          <>
            <p>
              Вставьте адрес ленты (RSS, Atom, JSON Feed) или сайта: приложение найдёт ленту само,
              если сайт её объявляет. Запрос уйдёт только на этот адрес; источник увидит IP-адрес
              устройства, больше ничего не отправляется.
            </p>
            <p>
              Подписки и записи хранятся только на этом устройстве. Список можно сохранить в файл
              OPML и загрузить на другом устройстве.
            </p>
          </>
        }
        actions={
          <div class="news-sources__tools">
            <Show when={props.snapshot().subscriptions.some((entry) => entry.kind !== 'pubmed')}>
              <button
                type="button"
                class="news-icon-button"
                aria-label="Сохранить список источников (OPML)"
                title="Сохранить список"
                onClick={() => void exportOpml()}
              >
                <AppGlyph name="share" class="news-icon-button__icon" />
              </button>
            </Show>
            <label
              class="news-icon-button"
              classList={{ 'news-icon-button--disabled': importing() }}
              title="Загрузить список"
            >
              <input
                class="news-sources__file"
                type="file"
                accept=".opml,.xml,text/xml,text/x-opml,application/xml"
                aria-label="Загрузить список источников (OPML)"
                disabled={importing()}
                onChange={(event) => {
                  const input = event.currentTarget;
                  void importOpml(input.files?.[0]).finally(() => {
                    input.value = '';
                  });
                }}
              />
              <AppGlyph name="file-arrow-down" class="news-icon-button__icon" />
            </label>
          </div>
        }
      />

      <form
        class="news-sources__add"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          check();
        }}
      >
        <TextField
          class="news-sources__field"
          inputClass="news-sources__input"
          label="Адрес ленты или сайта"
          hideLabel
          type="url"
          inputMode="url"
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          placeholder="Адрес ленты или сайта"
          value={address()}
          ref={(element: HTMLInputElement) => {
            field = element;
          }}
          onInput={(event) => {
            setAddress(event.currentTarget.value);
            setInvalid(undefined);
          }}
          name="news-source-url"
        />
        <button
          type="submit"
          class="news-icon-button news-icon-button--primary news-sources__submit"
          aria-label="Проверить адрес"
          title="Проверить адрес"
          disabled={address().trim() === ''}
        >
          <AppGlyph name="plus" class="news-icon-button__icon" />
        </button>
      </form>
      <Show when={invalid()}>
        {(message) => (
          <p class="news-sources__error" role="alert">
            {message()}
          </p>
        )}
      </Show>

      <Show
        when={props.snapshot().subscriptions.length > 0}
        fallback={<p class="news-sources__empty">Подписок пока нет.</p>}
      >
        <ul class="news-sources__list">
          <For each={props.snapshot().subscriptions}>
            {(subscription) => (
              <SourceRow
                subscription={subscription}
                icons={icons()}
                onImages={(enabled) => service.setImages(subscription.id, enabled)}
                onRemove={() => setRemoving(subscription)}
              />
            )}
          </For>
        </ul>
      </Show>

      <NewsSourceSheet
        target={target()}
        subscriptions={props.snapshot().subscriptions}
        icons={icons()}
        onClose={() => setTarget(undefined)}
      />
      <ConfirmationDialog
        open={removing() !== undefined}
        title="Удалить источник?"
        description={
          <p>
            «{removing()?.title}» и сохранённые записи этого источника будут удалены с устройства.
          </p>
        }
        confirmLabel="Удалить"
        danger
        onOpenChange={(open) => {
          if (!open) setRemoving(undefined);
        }}
        onConfirm={() => {
          const picked = removing();
          setRemoving(undefined);
          if (picked) void service.remove(picked.id);
        }}
      />
    </section>
  );
}
