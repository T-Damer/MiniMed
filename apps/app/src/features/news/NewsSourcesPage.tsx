import { type Accessor, createSignal, For, type JSX, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { FileButton } from '@/components/FileButton';
import { NavBack } from '@/components/NavBack';
import { Switch } from '@/components/Switch';
import { NewsSourceTile } from '@/features/news/NewsSourceTile';
import { NEWS_ADD_HASH, NEWS_PUBMED_HASH, NEWS_ROOT_HASH } from '@/features/news/news-routing';
import type { NewsSnapshot } from '@/features/news/news-service';
import { fetchedAtLabel } from '@/features/news/news-state';
import { getNewsService } from '@/features/news/news-store';
import { hasItems, type Subscription } from '@/features/news/news-types';
import { buildOpml, parseOpml } from '@/features/news/opml';
import { hostLabel } from '@/features/news/source-url';
import { suggestedFeedById } from '@/features/news/suggested-feeds';
import { shareSystemFile } from '@/state/native-share';

function SourceRow(props: {
  readonly subscription: Subscription;
  readonly unread: number;
  readonly editing: boolean;
  readonly onEdit: () => void;
  readonly onCancelEdit: () => void;
  readonly onRename: (title: string) => void;
  readonly onImages: (enabled: boolean) => void;
  readonly onRemove: () => void;
}): JSX.Element {
  const [draft, setDraft] = createSignal(props.subscription.title);
  const feed = () => props.subscription.kind === 'feed';
  const items = () => hasItems(props.subscription.kind);
  const glyph = () => {
    const kind = props.subscription.kind;
    return kind === 'pubmed' ? 'search' : kind === 'feed' ? 'rss' : 'globe';
  };
  const status = (): string => {
    const subscription = props.subscription;
    if (subscription.kind === 'site') return 'Сайт — открывается в приложении';
    if (subscription.error) return subscription.error.message;
    return `Обновлено: ${fetchedAtLabel(subscription.fetchedAt, Date.now())}`;
  };
  return (
    <li class="news-source" data-source={props.subscription.id}>
      <div class="news-source__main">
        <NewsSourceTile
          visual={suggestedFeedById(props.subscription.suggestedId)?.visual}
          glyph={glyph()}
          size="small"
        />
        <div class="news-source__copy">
          <Show
            when={props.editing}
            fallback={<span class="news-source__title">{props.subscription.title}</span>}
          >
            <form
              class="news-source__rename"
              onSubmit={(event) => {
                event.preventDefault();
                props.onRename(draft());
              }}
            >
              <input
                class="news-source__input"
                type="text"
                maxLength={120}
                aria-label="Название источника"
                value={draft()}
                onInput={(event) => setDraft(event.currentTarget.value)}
              />
              <button type="submit" class="news-source__button">
                Сохранить
              </button>
              <button type="button" class="news-source__button" onClick={props.onCancelEdit}>
                Отмена
              </button>
            </form>
          </Show>
          <span class="news-source__host">{hostLabel(props.subscription.url)}</span>
          <span
            class="news-source__status"
            classList={{ 'news-source__status--error': Boolean(props.subscription.error) }}
          >
            {status()}
          </span>
          <Show when={props.subscription.query}>
            {(query) => <span class="news-source__status">Запрос: {query()}</span>}
          </Show>
          <Show when={items() && props.unread > 0}>
            <span class="news-source__unread">Непрочитанных: {props.unread}</span>
          </Show>
        </div>
      </div>
      <div class="news-source__controls">
        <Show when={feed()}>
          <span class="news-source__switch">
            <span class="news-source__switch-label">Изображения</span>
            <Switch
              checked={props.subscription.images}
              onChange={props.onImages}
              aria-label={`Показывать изображения: ${props.subscription.title}`}
            />
          </span>
        </Show>
        <button
          type="button"
          class="news-source__button"
          aria-label={`Переименовать: ${props.subscription.title}`}
          onClick={() => {
            setDraft(props.subscription.title);
            props.onEdit();
          }}
        >
          <AppGlyph name="edit" class="news-source__button-icon" />
          Название
        </button>
        <button
          type="button"
          class="news-source__button news-source__button--danger"
          aria-label={`Удалить: ${props.subscription.title}`}
          onClick={props.onRemove}
        >
          <AppGlyph name="trash" class="news-source__button-icon" />
          Удалить
        </button>
      </div>
    </li>
  );
}

export function NewsSourcesPage(props: { readonly snapshot: Accessor<NewsSnapshot> }): JSX.Element {
  const service = getNewsService();
  const [editingId, setEditingId] = createSignal<string>();
  const [removing, setRemoving] = createSignal<Subscription>();
  const [importing, setImporting] = createSignal(false);
  const unreadOf = (id: string): number =>
    props.snapshot().subscriptions.find((entry) => entry.id === id)?.unread ?? 0;

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

  return (
    <section class="news-sources page-surface page-grain" data-testid="news-sources">
      <header class="news-sources__header">
        <NavBack
          class="knowledge-back-button"
          aria-label="К ленте"
          onClick={() => {
            window.location.hash = NEWS_ROOT_HASH;
          }}
        />
        <div class="news-sources__heading">
          <h1 class="news-sources__title">Источники</h1>
          <p class="news-sources__description">
            Названия, изображения и удаление. Подписки и записи хранятся только на этом устройстве.
          </p>
        </div>
      </header>
      <Show
        when={props.snapshot().subscriptions.length > 0}
        fallback={
          <div class="news-sources__empty">
            <p>Подписок пока нет.</p>
            <a class="news-sources__link" href={NEWS_ADD_HASH}>
              Добавить источник
            </a>
          </div>
        }
      >
        <ul class="news-sources__list">
          <For each={props.snapshot().subscriptions}>
            {(subscription) => (
              <SourceRow
                subscription={subscription}
                unread={unreadOf(subscription.id)}
                editing={editingId() === subscription.id}
                onEdit={() => setEditingId(subscription.id)}
                onCancelEdit={() => setEditingId(undefined)}
                onRename={(title) => {
                  service.rename(subscription.id, title);
                  setEditingId(undefined);
                }}
                onImages={(enabled) => service.setImages(subscription.id, enabled)}
                onRemove={() => setRemoving(subscription)}
              />
            )}
          </For>
        </ul>
      </Show>
      <div class="news-sources__tools">
        <a class="news-sources__link" href={NEWS_ADD_HASH}>
          <AppGlyph name="plus" class="news-sources__link-icon" />
          Добавить источник
        </a>
        <a class="news-sources__link" href={NEWS_PUBMED_HASH}>
          <AppGlyph name="search" class="news-sources__link-icon" />
          Поиск в PubMed
        </a>
        <Show when={props.snapshot().subscriptions.some((entry) => entry.kind !== 'pubmed')}>
          <button type="button" class="news-sources__link" onClick={() => void exportOpml()}>
            <AppGlyph name="share" class="news-sources__link-icon" />
            Экспорт OPML
          </button>
        </Show>
        <FileButton
          variant="secondary"
          accept=".opml,.xml,text/xml,text/x-opml,application/xml"
          disabled={importing()}
          onChange={(event) => {
            const input = event.currentTarget;
            void importOpml(input.files?.[0]).finally(() => {
              input.value = '';
            });
          }}
        >
          {importing() ? 'Импортируем…' : 'Импорт OPML'}
        </FileButton>
      </div>
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
          const target = removing();
          setRemoving(undefined);
          if (target) void service.remove(target.id);
        }}
      />
    </section>
  );
}
