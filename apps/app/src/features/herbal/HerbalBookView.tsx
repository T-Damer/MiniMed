import type { MedicalCore } from '@localmed/contracts';
import {
  createDeferred,
  createEffect,
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
  herbalQueryStem,
  herbalSearchValues,
} from './herbal-chapter';
import { herbalBookActionFromHash, herbalBookHash } from './herbal-routing';

interface HerbalBookViewProps {
  readonly core: MedicalCore;
  readonly onBack: () => void;
  readonly onContentChanged?: () => Promise<void>;
}

const EMPTY_BOOK: HerbalBook = { plants: [], guides: [] };

/** A name match first; a symptom typed in another form («кашель» for «при кашле») still finds. */
function herbalScore(query: string, values: readonly string[]): number {
  const score = fuzzyQueryScore(query, values);
  if (score > 0) return score;
  const stem = herbalQueryStem(query);
  return stem ? fuzzyQueryScore(stem, values) : 0;
}

function HerbalHelp(): JSX.Element {
  return (
    <div class="herbal-help">
      <p class="herbal-help__text">
        Для самообразования и случаев, когда под рукой только травы. Не заменяет врача.
      </p>
      <p class="herbal-help__text">
        Способ приготовления, показания и противопоказания — из инструкций ГРЛС на лекарственное
        растительное сырьё, если оно зарегистрировано. Ограничения, дозы и действующие вещества — из
        монографий EMA/HMPC, а где их нет — из монографий ВОЗ; безопасность — из NCCIH, LactMed,
        LiverTox и ТР ТС 021/2011. Русская строка, по нажатию — английская цитата и страница.
      </p>
      <p class="herbal-help__text">
        Рисунки — старые ботанические таблицы (общественное достояние); у нескольких растений их
        нет. Определять растение в природе только по рисунку нельзя.
      </p>
    </div>
  );
}

export function HerbalBookView(props: HerbalBookViewProps): JSX.Element {
  const [book, setBook] = createSignal<HerbalBook>(EMPTY_BOOK);
  const [loading, setLoading] = createSignal(true);
  // After an install the book stays in its download card until the new content has been read.
  const [opening, setOpening] = createSignal(false);
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
    setOpening(true);
    try {
      await props.onContentChanged?.();
      await refresh();
    } finally {
      setOpening(false);
    }
  };

  const chooseAction = (next: string | null): void => {
    const value = action() === next ? null : next;
    setAction(value);
    // The filter lives in the address so Back and a tab round trip restore it.
    window.history.replaceState(window.history.state, '', herbalBookHash(value));
  };

  const actions = createMemo(() => herbalActions(book().plants));
  const [actionsElement, setActionsElement] = createSignal<HTMLElement | undefined>();
  // The chosen chip stays in view, also when the address restores a filter far down the row.
  createEffect(() => {
    const selected = action();
    const row = actionsElement();
    if (!selected || !row || actions().length === 0) return;
    const chip = Array.from(row.querySelectorAll<HTMLElement>('.herbal-book__action')).find(
      (element) => element.textContent === selected,
    );
    chip?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
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
        score: herbalScore(value, herbalSearchValues(plant)),
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
          <Show
            when={!opening()}
            fallback={
              <p class="herbal-book__opening" role="status">
                <span class="herbal-book__opening-spinner" aria-hidden="true" />
                Открываем травник…
              </p>
            }
          >
            <ModuleDownloadOffer
              moduleId={HERBAL_MODULE_ID}
              onContentChanged={contentChanged}
              subtitle={(module) => herbalPlantCountLabel([module]) ?? module.title}
              failureMessage="Не удалось скачать травник."
            />
          </Show>
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
            placeholder="Растение или жалоба"
          />
          <fieldset ref={setActionsElement} class="herbal-book__actions" aria-label="Действие">
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

        {/* Hidden while the installed book is current; a newer release offers itself here. */}
        <ModuleDownloadOffer
          class="herbal-book__update-offer"
          moduleId={HERBAL_MODULE_ID}
          onContentChanged={contentChanged}
          subtitle={() => 'Новая версия травника'}
          action="Обновить"
          variant="secondary"
          failureMessage="Не удалось обновить травник."
        />

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
                <span class="herbal-card__sheet">
                  <Show
                    when={plant.thumbnail}
                    fallback={<AppGlyph name="leaf" class="herbal-card__placeholder" />}
                  >
                    {(src) => <img class="herbal-card__image" src={src()} alt="" loading="lazy" />}
                  </Show>
                </span>
                <span class="herbal-card__body">
                  <strong class="herbal-card__title">{plant.title}</strong>
                  <em class="herbal-card__latin">{plant.latin}</em>
                  <span class="herbal-card__part">{plant.partRu}</span>
                  <Show when={plant.redBook}>
                    <span class="herbal-card__redbook">Красная книга</span>
                  </Show>
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
