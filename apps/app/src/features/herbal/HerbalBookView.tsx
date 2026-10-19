import type { MedicalCore } from '@localmed/contracts';
import {
  createDeferred,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { SearchField } from '@/components/SearchField';
import { useStickySurface } from '@/components/sticky-surface';
import { Heading } from '@/components/Text';
import { ModuleDownloadOffer } from '@/features/modules/ModuleDownloadOffer';
import { CONTENT_CHANGED_EVENT } from '@/state/content-events';
import { openDocumentOverlay } from '@/state/document-navigation';
import { fuzzyQueryScore } from '@/state/fuzzy-text';
import {
  buildHerbalBook,
  HERBAL_MODULE_ID,
  HERBAL_PLATES_MODULE_ID,
  type HerbalBook,
  type HerbalChapter,
  herbalActions,
  herbalPlantCountLabel,
} from './herbal-chapter';
import { herbalBookActionFromHash, herbalBookHash } from './herbal-routing';

interface HerbalBookViewProps {
  readonly core: MedicalCore;
  readonly onBack: () => void;
  readonly onContentChanged?: () => Promise<void>;
}

const EMPTY_BOOK: HerbalBook = { plants: [], guides: [] };

function HerbalHelp(): JSX.Element {
  return (
    <div class="herbal-help">
      <p class="herbal-help__text">
        Для самообразования и случаев, когда под рукой только травы. Не заменяет врача.
      </p>
      <p class="herbal-help__text">
        Способ приготовления, показания и противопоказания — из инструкций ГРЛС на лекарственное
        растительное сырьё. Ограничения, дозы и действующие вещества — из монографий и отчётов
        EMA/HMPC: русская строка, по нажатию — английская цитата и страница. Эти строки пока
        черновик, врач их не проверял.
      </p>
      <p class="herbal-help__text">
        Рисунки — ботанические таблицы XIX века (общественное достояние). Определять растение в
        природе только по рисунку нельзя.
      </p>
    </div>
  );
}

export function HerbalBookView(props: HerbalBookViewProps): JSX.Element {
  const [book, setBook] = createSignal<HerbalBook>(EMPTY_BOOK);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string>();
  const [query, setQuery] = createSignal('');
  const [action, setAction] = createSignal<string | null>(
    herbalBookActionFromHash(window.location.hash),
  );
  const [toolbarElement, setToolbarElement] = createSignal<HTMLElement | undefined>();
  useStickySurface(toolbarElement);

  const refresh = async (): Promise<void> => {
    setError(undefined);
    try {
      const result = await props.core.listDocuments();
      if (!result.ok) throw new Error(result.error.message);
      setBook(buildHerbalBook(result.value));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось открыть травник.');
    } finally {
      setLoading(false);
    }
  };
  const handleContentChanged = (): void => {
    void refresh();
  };
  onMount(() => {
    void refresh();
    window.addEventListener(CONTENT_CHANGED_EVENT, handleContentChanged);
  });
  onCleanup(() => window.removeEventListener(CONTENT_CHANGED_EVENT, handleContentChanged));

  const contentChanged = async (): Promise<void> => {
    await props.onContentChanged?.();
    await refresh();
  };

  const chooseAction = (next: string | null): void => {
    const value = action() === next ? null : next;
    setAction(value);
    // The filter lives in the address so Back and a tab round trip restore it.
    window.history.replaceState(window.history.state, '', herbalBookHash(value));
  };

  const actions = createMemo(() => herbalActions(book().plants));
  const deferredQuery = createDeferred(query, { timeoutMs: 120 });
  const visiblePlants = createMemo((): readonly HerbalChapter[] => {
    const selected = action();
    const filtered = selected
      ? book().plants.filter((plant) => plant.actions.includes(selected))
      : book().plants;
    const value = deferredQuery().trim();
    if (!value) return filtered;
    return filtered
      .map((plant) => ({
        plant,
        score: fuzzyQueryScore(value, [plant.title, plant.latin, plant.partRu, ...plant.actions]),
      }))
      .filter(({ score }) => score > 0)
      .toSorted((left, right) => right.score - left.score)
      .map(({ plant }) => plant);
  });

  return (
    <section class="herbal-book">
      <Page
        class="herbal-book__header"
        navigation={
          <NavBack
            class="knowledge-back-button"
            aria-label="К базе знаний"
            onClick={props.onBack}
          />
        }
        icon={<AppGlyph name="leaf" class="page__icon-glyph" />}
        title={<Heading depth={1}>Травник</Heading>}
        help={<HerbalHelp />}
        helpTitle="О травнике"
      />

      <Show when={!loading() && book().plants.length === 0 && !error()}>
        <div class="herbal-book__offer paper-card">
          <p class="herbal-book__offer-text">
            Лекарственные растения: как заварить, кому нельзя, действие и состав.
          </p>
          <ModuleDownloadOffer
            moduleId={HERBAL_MODULE_ID}
            onContentChanged={contentChanged}
            subtitle={(module) => herbalPlantCountLabel([module]) ?? module.title}
            failureMessage="Не удалось скачать травник."
          />
        </div>
      </Show>

      <Show when={book().plants.length > 0}>
        <div
          ref={setToolbarElement}
          class="herbal-book__toolbar route-sticky-chrome route-sticky-chrome--transparent"
        >
          <SearchField
            class="herbal-book__search"
            value={query()}
            onInput={setQuery}
            onClear={() => setQuery('')}
            label="Поиск растения"
            hideLabel
            placeholder="Название или латынь"
          />
          <fieldset class="herbal-book__actions" aria-label="Действие">
            <For each={actions()}>
              {(item) => (
                <button
                  type="button"
                  class="herbal-book__action"
                  classList={{ 'herbal-book__action--active': action() === item }}
                  aria-pressed={action() === item}
                  onClick={() => chooseAction(item)}
                >
                  {item}
                </button>
              )}
            </For>
          </fieldset>
        </div>

        <For each={book().guides}>
          {(guide) => (
            <button
              type="button"
              class="herbal-book__guide paper-card"
              onClick={() => openDocumentOverlay(guide.documentId)}
            >
              <AppGlyph name="flask" class="herbal-book__guide-icon" />
              <span class="herbal-book__guide-title">{guide.title}</span>
              <AppGlyph name="arrow-up-right" class="herbal-book__guide-open" />
            </button>
          )}
        </For>

        <ModuleDownloadOffer
          class="herbal-book__plates-offer"
          moduleId={HERBAL_PLATES_MODULE_ID}
          onContentChanged={contentChanged}
          subtitle={() => 'Большие ботанические рисунки'}
          action="Иллюстрации"
          variant="secondary"
          failureMessage="Не удалось скачать иллюстрации."
        />

        <Show when={visiblePlants().length === 0}>
          <p class="herbal-book__empty paper-card">Ничего не найдено.</p>
        </Show>
        <div class="herbal-book__grid">
          <For each={visiblePlants()}>
            {(plant) => (
              <button
                type="button"
                class="herbal-card paper-card"
                aria-label={`Открыть «${plant.title}»`}
                onClick={() => openDocumentOverlay(plant.documentId)}
              >
                <Show
                  when={plant.thumbnail}
                  fallback={<span class="herbal-card__image herbal-card__image--empty" />}
                >
                  {(src) => <img class="herbal-card__image" src={src()} alt="" loading="lazy" />}
                </Show>
                <span class="herbal-card__body">
                  <strong class="herbal-card__title">{plant.title}</strong>
                  <em class="herbal-card__latin">{plant.latin}</em>
                  <span class="herbal-card__part">{plant.partRu}</span>
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>

      <Show when={error()}>
        {(message) => (
          <div class="error-card" role="alert">
            {message()}
          </div>
        )}
      </Show>
    </section>
  );
}
