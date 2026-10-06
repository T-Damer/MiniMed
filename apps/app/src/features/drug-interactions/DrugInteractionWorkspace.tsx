import type { MedicalCore } from '@localmed/contracts';
import {
  createEffect,
  createResource,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  Show,
  untrack,
} from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { ChoiceChip } from '@/components/ChoiceChip';
import { Disclosure } from '@/components/Disclosure';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { SearchField } from '@/components/SearchField';
import { Heading } from '@/components/Text';
import { MAX_COMPARED_NAMES } from '@/features/drug-comparison/comparison-query';
import { notesDrugComparisonPath } from '@/features/notes/notes-routing';
import { CONTENT_CHANGED_EVENT } from '@/state/content-events';
import {
  cardDisplayName,
  type DrugCandidate,
  findDrugCandidates,
  resolveTypedName,
} from './drug-candidates';
import { InteractionPairsPanel } from './InteractionPairs';
import { ALCOHOL_ITEM_ID, type DrugItem } from './interaction-check';
import { loadInteractionIndex } from './interaction-load';
import { INTERACTION_NOTICE } from './interaction-print';
import { ALCOHOL_QUERY_NAME } from './interaction-query';
import '@/styles/drug-interactions.css';

const MAX_ITEMS = 10;
const MAX_COMPARED = MAX_COMPARED_NAMES;
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
  const [items, setItems] = createSignal<readonly DrugItem[]>([]);
  const [unresolved, setUnresolved] = createSignal<readonly string[]>([]);
  const [query, setQuery] = createSignal('');
  const [candidates, setCandidates] = createSignal<readonly DrugCandidate[]>([]);
  const [resolving, setResolving] = createSignal(props.initialNames.length > 0);

  /** The drugs (not alcohol) that can be sent to «Сравнение препаратов». */
  const comparable = (): readonly DrugItem[] => items().filter((item) => item.kind === 'drug');
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
            <p>
              Предложения из раздела «Взаимодействие с другими лекарственными средствами» показаны
              сразу; предложения из «Особых указаний», «Противопоказаний» и «С осторожностью»
              свёрнуты под строкой «ещё из других разделов».
            </p>
            <p>
              Если скачан необязательный модуль меток, рядом с парой, у которой есть предложение из
              инструкции, показана степень риска по международной базе DDInter. Это метка базы, а не
              текст инструкции.
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
        <Show when={comparable().length >= 2}>
          <a
            class="drug-interactions__compare"
            href={notesDrugComparisonPath(
              [],
              comparable()
                .slice(0, MAX_COMPARED)
                .map((item) => item.id),
            )}
            data-testid="interaction-compare-link"
          >
            <AppGlyph name="pill" class="drug-interactions__compare-icon" />
            <span class="drug-interactions__compare-text">
              {comparable().length > MAX_COMPARED
                ? `Сравнить первые ${MAX_COMPARED} препарата`
                : 'Сравнить эти препараты'}
            </span>
            <AppGlyph name="caret-right" class="drug-interactions__compare-icon" />
          </a>
        </Show>
        <InteractionPairsPanel
          core={props.core}
          items={items()}
          onContentChanged={onContentChanged}
        />
      </Show>
    </section>
  );
}
