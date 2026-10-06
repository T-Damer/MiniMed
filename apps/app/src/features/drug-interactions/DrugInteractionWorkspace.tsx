import type { MedicalCore } from '@localmed/contracts';
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  Show,
  untrack,
} from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { ChoiceChip } from '@/components/ChoiceChip';
import { Disclosure } from '@/components/Disclosure';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { SearchField } from '@/components/SearchField';
import { Heading } from '@/components/Text';
import { PrintManager } from '@/features/printing/print-manager';
import { CONTENT_CHANGED_EVENT } from '@/state/content-events';
import { buildOfficialDocumentHash } from '@/state/document-route';
import {
  cardDisplayName,
  type DrugCandidate,
  findDrugCandidates,
  resolveTypedName,
} from './drug-candidates';
import { InstructionDownloadOffer } from './InstructionDownloadOffer';
import { ALCOHOL_ITEM_ID, checkAllPairs, type DrugItem, itemDocumentId } from './interaction-check';
import { loadClassPhrases, loadInteractionIndex } from './interaction-load';
import {
  INTERACTION_NOTICE,
  INTERACTION_PRINT_TITLE,
  interactionShareText,
  renderInteractionPrintHtml,
} from './interaction-print';
import { ALCOHOL_QUERY_NAME } from './interaction-query';
import { sentenceSectionLabel } from './interaction-quotes';
import {
  type DocumentState,
  type PairView,
  pairStatusText,
  pairTitle,
  pairView,
  pluralSentence,
  printPairs,
  type SideView,
  SUBSTANCE_INSTRUCTION_NOTE,
  sideHeading,
  sideNote,
  sideSourceLine,
} from './interaction-view';
import '@/styles/drug-interactions.css';

const MAX_ITEMS = 10;
const VIDAL_CHECKER_URL = 'https://www.vidal.ru/drugs/interaction/new';
const ALCOHOL_NAME = /^(?:алкогол|этанол|спирт|вино\b|пиво\b)/iu;

function alcoholItem(typed?: string): DrugItem {
  return {
    id: ALCOHOL_ITEM_ID,
    kind: 'alcohol',
    card: null,
    label: 'Алкоголь',
    typed: typed && typed.toLocaleLowerCase('ru-RU') !== 'алкоголь' ? typed : undefined,
  };
}

function todayText(): string {
  return new Date().toLocaleDateString('ru-RU');
}

/** One quoted sentence with the words that name the other drug marked. */
function QuoteBlock(props: {
  readonly documentId: string;
  readonly quote: SideView['quotes'][number];
}): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);
  const long = () => props.quote.text.length > 360;
  return (
    <blockquote class="drug-interactions__quote">
      <span class="drug-interactions__quote-section">
        {sentenceSectionLabel(props.quote.flags)}
      </span>
      <p
        class="drug-interactions__quote-text"
        classList={{ 'drug-interactions__quote-text--clamped': long() && !expanded() }}
      >
        <For each={props.quote.segments}>
          {(segment) => (
            <Show when={segment.hit} fallback={segment.text}>
              <mark class="drug-interactions__mark">{segment.text}</mark>
            </Show>
          )}
        </For>
      </p>
      <span class="drug-interactions__quote-actions">
        <Show when={long()}>
          <button
            type="button"
            class="drug-interactions__quote-toggle"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded() ? 'Свернуть' : 'Показать полностью'}
          </button>
        </Show>
        <Show when={props.quote.anchor}>
          {(anchor) => (
            <a
              class="drug-interactions__quote-link"
              href={buildOfficialDocumentHash(props.documentId, anchor())}
            >
              Открыть в инструкции
            </a>
          )}
        </Show>
      </span>
    </blockquote>
  );
}

function SideBlock(props: { readonly side: SideView }): JSX.Element {
  const note = () => sideNote(props.side);
  const source = () => sideSourceLine(props.side);
  return (
    <section class="drug-interactions__side" data-state={props.side.state}>
      <h4 class="drug-interactions__side-title">{sideHeading(props.side)}</h4>
      <Show when={source()}>
        <p class="drug-interactions__side-source">{source()}</p>
      </Show>
      <Show when={props.side.source?.qualityNote}>
        {(text) => <p class="drug-interactions__side-note">{text()}</p>}
      </Show>
      <Show when={props.side.state === 'loading'}>
        <p class="drug-interactions__side-note" role="status">
          Читаем установленную инструкцию…
        </p>
      </Show>
      <Show when={props.side.state === 'not-installed'}>
        <p class="drug-interactions__side-status" data-testid="interaction-side-status">
          {props.side.count > 0
            ? `В указателе есть ${props.side.count} ${pluralSentence(props.side.count)} с упоминанием «${props.side.to.label}», но инструкция не установлена — скачайте её, чтобы прочитать.`
            : `В инструкции «${props.side.from.label}» по указателю упоминаний «${props.side.to.label}» не найдено; сама инструкция не установлена.`}
        </p>
      </Show>
      <Show when={props.side.state === 'no-instruction'}>
        <p class="drug-interactions__side-status">{note()}</p>
      </Show>
      <Show when={props.side.state === 'ready'}>
        <Show
          when={props.side.quotes.length > 0}
          fallback={
            <p class="drug-interactions__side-status" data-testid="interaction-side-status">
              {props.side.changed > 0
                ? note()
                : `В этой инструкции упоминаний «${props.side.to.label}» не найдено.`}
            </p>
          }
        >
          <For each={props.side.quotes}>
            {(quote) => <QuoteBlock documentId={props.side.documentId ?? ''} quote={quote} />}
          </For>
          <Show when={props.side.changed > 0}>
            <p class="drug-interactions__side-note">{note()}</p>
          </Show>
        </Show>
        <p class="drug-interactions__side-note">{SUBSTANCE_INSTRUCTION_NOTE}</p>
      </Show>
    </section>
  );
}

function PairCard(props: { readonly view: PairView }): JSX.Element {
  return (
    <article
      class="drug-interactions__pair paper-card"
      data-status={props.view.status}
      data-testid="interaction-pair"
    >
      <header class="drug-interactions__pair-header">
        <Heading depth={3} class="drug-interactions__pair-title">
          {pairTitle(props.view)}
        </Heading>
        <p class="drug-interactions__pair-status" data-testid="interaction-pair-status">
          {pairStatusText(props.view)}
        </p>
      </header>
      <For each={props.view.sides}>{(side) => <SideBlock side={side} />}</For>
    </article>
  );
}

/**
 * «Взаимодействие препаратов»: 2–10 drugs, and for every pair the sentences of each drug's official
 * instruction that name the other drug or its class. A search over instruction texts, not a
 * clinical decision system: «не найдено» never means «безопасно».
 */
export function DrugInteractionWorkspace(props: {
  readonly core: MedicalCore | undefined;
  readonly initialNames: readonly string[];
  readonly initialCards: readonly string[];
  readonly onBack: () => void;
  readonly onContentChanged?: () => Promise<void>;
}): JSX.Element {
  const onContentChanged =
    props.onContentChanged ??
    (async () => {
      window.dispatchEvent(new Event(CONTENT_CHANGED_EVENT));
    });
  const [index] = createResource(loadInteractionIndex);
  const [phrases] = createResource(() => loadClassPhrases().catch(() => []));
  const [items, setItems] = createSignal<readonly DrugItem[]>([]);
  const [unresolved, setUnresolved] = createSignal<readonly string[]>([]);
  const [query, setQuery] = createSignal('');
  const [candidates, setCandidates] = createSignal<readonly DrugCandidate[]>([]);
  const [documents, setDocuments] = createSignal<ReadonlyMap<string, DocumentState>>(new Map());
  const [resolving, setResolving] = createSignal(props.initialNames.length > 0);

  const hasItem = (id: string): boolean => items().some((item) => item.id === id);
  const addItem = (item: DrugItem): void => {
    setItems((current) =>
      current.length >= MAX_ITEMS || current.some((entry) => entry.id === item.id)
        ? current
        : [...current, item],
    );
  };
  const addCandidate = (candidate: DrugCandidate, typed?: string): void => {
    addItem({
      id: candidate.slug,
      kind: 'drug',
      card: candidate.card,
      label: candidate.label,
      typed:
        typed && typed.toLocaleLowerCase('ru-RU') !== candidate.label.toLocaleLowerCase('ru-RU')
          ? typed
          : undefined,
    });
  };
  const removeItem = (id: string): void => {
    setItems((current) => current.filter((item) => item.id !== id));
  };

  // The drugs the tool was opened with: exact cards first, then typed names through the drug search.
  let initialized = false;
  createEffect(() => {
    const loaded = index();
    const core = props.core;
    if (!loaded || !core || initialized) return;
    initialized = true;
    void (async () => {
      for (const slug of props.initialCards) {
        const card = loaded.cardBySlug.get(slug);
        if (card !== undefined) addCandidate({ slug, card, label: cardDisplayName(slug) });
      }
      const missing: string[] = [];
      for (const name of props.initialNames) {
        if (ALCOHOL_NAME.test(name.trim()) || name === ALCOHOL_QUERY_NAME) {
          addItem(alcoholItem(name));
          continue;
        }
        const found = await resolveTypedName(core, loaded, name);
        if (found.length === 0) missing.push(name);
        for (const candidate of found) addCandidate(candidate, name);
      }
      setUnresolved(missing);
      setResolving(false);
    })();
  });

  // The drug search box.
  createEffect(() => {
    const text = query().trim();
    const loaded = index();
    const core = props.core;
    if (text.length < 2 || !loaded || !core) {
      setCandidates([]);
      return;
    }
    const handle = setTimeout(() => {
      void findDrugCandidates(core, loaded, text).then((found) => {
        if (untrack(() => query().trim()) === text) setCandidates(found);
      });
    }, 250);
    onCleanup(() => clearTimeout(handle));
  });

  // Installed instructions: read once per document; a reconnected core or a content change starts over.
  let requested = new Set<string>();
  const forgetDocuments = (): void => {
    requested = new Set();
    setDocuments(new Map());
  };
  createEffect(on(() => props.core, forgetDocuments, { defer: true }));
  createEffect(() => {
    const loaded = index();
    const core = props.core;
    documents();
    if (!loaded || !core) return;
    const generation = requested;
    for (const item of items()) {
      const id = itemDocumentId(loaded, item);
      if (!id || generation.has(id)) continue;
      generation.add(id);
      setDocuments((current) => new Map(current).set(id, 'loading'));
      void core.getDocument(id).then((result) => {
        if (generation !== requested) return;
        setDocuments((current) =>
          new Map(current).set(id, result.ok ? { document: result.value } : 'missing'),
        );
      });
    }
  });
  window.addEventListener(CONTENT_CHANGED_EVENT, forgetDocuments);
  onCleanup(() => window.removeEventListener(CONTENT_CHANGED_EVENT, forgetDocuments));

  const views = createMemo<readonly PairView[]>(() => {
    const loaded = index();
    if (!loaded) return [];
    const read = documents();
    const classes = phrases() ?? [];
    return checkAllPairs(loaded, items()).map((pair) => pairView(loaded, pair, read, classes));
  });
  const foundCount = () => views().filter((view) => view.status === 'found').length;
  /** The instruction modules the pairs need and the device does not have: one offer for each. */
  const missingModules = createMemo(() => [
    ...new Set(
      views().flatMap((view) =>
        view.sides.flatMap((side) =>
          side.state === 'not-installed' && side.moduleId ? [side.moduleId] : [],
        ),
      ),
    ),
  ]);

  const printOut = (): void => {
    const html = renderInteractionPrintHtml(printPairs(views()), todayText());
    if (!PrintManager.html(html, INTERACTION_PRINT_TITLE)) {
      toast.error('Не удалось открыть печать. Разрешите всплывающие окна для этого сайта.');
    }
  };
  const share = async (): Promise<void> => {
    const text = interactionShareText(printPairs(views()));
    try {
      if ('share' in navigator && typeof navigator.share === 'function') {
        await navigator.share({ title: INTERACTION_PRINT_TITLE, text });
        return;
      }
      await navigator.clipboard.writeText(text);
      toast.success('Текст скопирован.');
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      toast.error('Не удалось поделиться текстом.');
    }
  };

  return (
    <section class="drug-interactions" aria-label="Взаимодействие препаратов">
      <header class="drug-interactions__chrome">
        <NavBack
          class="drug-interactions__back knowledge-back-button"
          aria-label="Назад"
          onClick={props.onBack}
        />
      </header>
      <Page
        icon={<AppGlyph name="pill" class="page__icon-glyph" />}
        title={<Heading depth={1}>Взаимодействие препаратов</Heading>}
        description="Поиск по текстам официальных инструкций: где инструкция одного препарата упоминает другой или его группу."
      />
      <aside class="drug-interactions__notice paper-card" role="note">
        <p class="drug-interactions__notice-text" data-testid="interaction-notice">
          {INTERACTION_NOTICE}
        </p>
        <Disclosure variant="inline" title="Как это работает">
          <div class="drug-interactions__how">
            <p>
              Указатель построен заранее по текстам инструкций из ГРЛС и с сайтов производителей: в
              разделах «Взаимодействие с другими лекарственными средствами», «Особые указания»,
              «Противопоказания» и «С осторожностью» отмечены предложения, где названо другое
              вещество (по МНН) или группа препаратов (по официальному названию группы АТХ).
            </p>
            <p>
              Предложения показаны дословно из установленных инструкций, с названием раздела и
              ссылкой на то место, откуда они взяты. Ничего не пересказывается и не переводится.
            </p>
            <p>
              Если у препарата несколько инструкций, читается одна из них; тексты других
              производителей могут отличаться. Торговые названия в тексте не ищутся.
            </p>
          </div>
        </Disclosure>
      </aside>

      <section class="drug-interactions__picker" aria-label="Препараты для проверки">
        <SearchField
          class="drug-interactions__search"
          label="Добавить препарат"
          placeholder="Название или МНН, например: варфарин"
          value={query()}
          onInput={setQuery}
          onClear={() => {
            setQuery('');
            setCandidates([]);
          }}
        />
        <Show when={candidates().length > 0}>
          <ul class="drug-interactions__candidates" aria-label="Найденные препараты">
            <For each={candidates()}>
              {(candidate) => (
                <li class="drug-interactions__candidate-row">
                  <button
                    type="button"
                    class="drug-interactions__candidate"
                    disabled={hasItem(candidate.slug)}
                    onClick={() => {
                      addCandidate(candidate);
                      setQuery('');
                      setCandidates([]);
                    }}
                  >
                    <AppGlyph name={hasItem(candidate.slug) ? 'check' : 'plus'} />
                    <span>{candidate.label}</span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={query().trim().length >= 2 && candidates().length === 0 && !index.loading}>
          <p class="drug-interactions__hint" role="status">
            Ничего не найдено. Если справочник препаратов не скачан, скачайте его в разделе
            «Препараты».
          </p>
        </Show>
        <div class="drug-interactions__quick">
          <ChoiceChip
            class="drug-interactions__alcohol"
            icon={<AppGlyph name="plus" />}
            disabled={hasItem(ALCOHOL_ITEM_ID) || items().length >= MAX_ITEMS}
            onClick={() => addItem(alcoholItem())}
          >
            Алкоголь
          </ChoiceChip>
          <span class="drug-interactions__quick-note">
            Не препарат: ищется в инструкциях других препаратов.
          </span>
        </div>
      </section>

      <Show when={items().length > 0 || unresolved().length > 0 || resolving()}>
        <ul class="drug-interactions__items" aria-label="Выбранные препараты">
          <For each={items()}>
            {(item) => (
              <li class="drug-interactions__item" data-testid="interaction-item">
                <span class="drug-interactions__item-name">{item.label}</span>
                <Show when={item.typed}>
                  {(typed) => (
                    <span class="drug-interactions__item-typed">по запросу «{typed()}»</span>
                  )}
                </Show>
                <button
                  type="button"
                  class="drug-interactions__item-remove"
                  aria-label={`Убрать «${item.label}»`}
                  onClick={() => removeItem(item.id)}
                >
                  <AppGlyph name="minus" />
                </button>
              </li>
            )}
          </For>
          <For each={unresolved()}>
            {(name) => (
              <li class="drug-interactions__item drug-interactions__item--missing">
                <span class="drug-interactions__item-name">Не найден: «{name}»</span>
                <button
                  type="button"
                  class="drug-interactions__item-remove"
                  aria-label={`Убрать «${name}»`}
                  onClick={() =>
                    setUnresolved((current) => current.filter((entry) => entry !== name))
                  }
                >
                  <AppGlyph name="minus" />
                </button>
              </li>
            )}
          </For>
          <Show when={resolving()}>
            <li class="drug-interactions__item drug-interactions__item--busy" role="status">
              Ищем препараты из запроса…
            </li>
          </Show>
        </ul>
      </Show>
      <Show when={items().length >= MAX_ITEMS}>
        <p class="drug-interactions__hint">Достигнут предел в {MAX_ITEMS} препаратов.</p>
      </Show>

      <Show when={index.error}>
        <p class="drug-interactions__hint" role="alert">
          Указатель взаимодействий не загрузился. Перезапустите приложение.
        </p>
      </Show>

      <Show
        when={items().length >= 2}
        fallback={
          <Show when={!resolving()}>
            <p class="drug-interactions__empty" role="status">
              Добавьте два препарата или больше, чтобы увидеть, что говорят о них инструкции.
            </p>
          </Show>
        }
      >
        <div class="drug-interactions__summary" role="status" data-testid="interaction-summary">
          <span>
            Пар: {views().length}. Упоминание найдено в {foundCount()}.
          </span>
        </div>
        <div class="drug-interactions__actions">
          <Button
            type="button"
            variant="secondary"
            icon={<AppGlyph name="printer" />}
            onClick={printOut}
          >
            Печать
          </Button>
          <Button
            type="button"
            variant="secondary"
            icon={<AppGlyph name="share" />}
            onClick={() => void share()}
          >
            Поделиться
          </Button>
          <a
            class="drug-interactions__vidal"
            href={VIDAL_CHECKER_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Проверить на vidal.ru
          </a>
        </div>
        <p class="drug-interactions__vidal-note">
          Ссылка открывает отдельный сайт со своей базой данных; приложение не передаёт ему список
          препаратов.
        </p>
        <Show when={missingModules().length > 0}>
          <section class="drug-interactions__offers paper-card" aria-label="Инструкции для чтения">
            <p class="drug-interactions__offers-text">
              Тексты этих инструкций ещё не скачаны: указатель знает, где в них названы другие
              препараты, но прочитать предложения можно только из установленной инструкции.
            </p>
            <For each={missingModules()}>
              {(moduleId) => (
                <InstructionDownloadOffer moduleId={moduleId} onContentChanged={onContentChanged} />
              )}
            </For>
          </section>
        </Show>
        <div class="drug-interactions__pairs" data-testid="interaction-pairs">
          <For each={views()}>{(view) => <PairCard view={view} />}</For>
        </div>
      </Show>
    </section>
  );
}
