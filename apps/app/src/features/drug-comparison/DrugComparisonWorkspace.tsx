import type { MedicalDocument } from '@localmed/contracts';
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
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { SearchField } from '@/components/SearchField';
import { Switch } from '@/components/Switch';
import { Heading } from '@/components/Text';
import { InstructionDownloadOffer } from '@/features/drug-interactions/InstructionDownloadOffer';
import { InteractionPairsPanel } from '@/features/drug-interactions/InteractionPairs';
import type { DrugItem } from '@/features/drug-interactions/interaction-check';
import { loadInteractionIndex } from '@/features/drug-interactions/interaction-load';
import type { PrintPair } from '@/features/drug-interactions/interaction-print';
import { type PairView, printPairs } from '@/features/drug-interactions/interaction-view';
import { loadAtcNames } from '@/features/medications/atc-names';
import { displayDrugName } from '@/features/medications/drug-screen';
import { PrintManager } from '@/features/printing/print-manager';
import { CONTENT_CHANGED_EVENT } from '@/state/content-events';
import { ComparisonMatrix } from './ComparisonMatrix';
import { ComparisonSections } from './ComparisonSections';
import { decodeDrug, type FoundDrug, findDrugs, resolveDrugName } from './comparison-candidates';
import { loadComparisonIndex } from './comparison-load';
import { printModelOf } from './comparison-model';
import {
  COMPARISON_PRINT_TITLE,
  comparisonShareText,
  renderComparisonPrintHtml,
} from './comparison-print';
import {
  REGISTRY_ROWS,
  type RegistryCell,
  registryCell,
  registrySourceLine,
} from './comparison-registry';
import { safetyRowViews } from './comparison-safety';
import { type ExtractedRow, extractRows } from './comparison-sections';
import {
  COMPARISON_NOTICE,
  COMPARISON_NOTICE_SHORT,
  type CompareItem,
  chooseDocuments,
  columnViews,
  type DocumentState,
  MAX_DRUGS,
  MIN_DRUGS,
  quoteRowViews,
  sectionRowViews,
} from './comparison-view';
import '@/styles/drug-comparison.css';

function todayText(): string {
  return new Date().toLocaleDateString('ru-RU');
}

/**
 * «Сравнение препаратов»: 2–4 drugs in columns, registry rows and quoted instruction sections in
 * rows, statements matched across the instructions and marked «у обоих» / «у других совпадения нет». A
 * comparison of instruction texts, not a clinical recommendation: nothing is summarised, nothing is
 * called better or worse.
 */
export function DrugComparisonWorkspace(props: {
  readonly core: import('@localmed/contracts').MedicalCore | undefined;
  readonly initialNames: readonly string[];
  readonly initialDrugs: readonly string[];
  readonly onBack: () => void;
  readonly onContentChanged?: () => Promise<void>;
}): JSX.Element {
  const onContentChanged =
    props.onContentChanged ??
    (async () => {
      window.dispatchEvent(new Event(CONTENT_CHANGED_EVENT));
    });
  const [index] = createResource(loadComparisonIndex);
  const [interactionIndex] = createResource(() => loadInteractionIndex().catch(() => null));
  const [atc] = createResource(() => loadAtcNames().catch(() => null));
  const [items, setItems] = createSignal<readonly CompareItem[]>([]);
  const [unresolved, setUnresolved] = createSignal<readonly string[]>([]);
  const [query, setQuery] = createSignal('');
  const [candidates, setCandidates] = createSignal<readonly FoundDrug[]>([]);
  const [resolving, setResolving] = createSignal(
    props.initialNames.length > 0 || props.initialDrugs.length > 0,
  );
  const [documents, setDocuments] = createSignal<ReadonlyMap<string, DocumentState>>(new Map());
  const [overrides, setOverrides] = createSignal<ReadonlyMap<string, string>>(new Map());
  const [onlyDifferences, setOnlyDifferences] = createSignal(false);
  const [pairs, setPairs] = createSignal<readonly PairView[]>([]);
  const [pairModules, setPairModules] = createSignal<readonly string[]>([]);
  let searchInput: HTMLInputElement | undefined;

  const itemId = (drug: Pick<FoundDrug, 'slug' | 'product'>): string =>
    drug.product ? `${drug.slug}|${drug.product}` : drug.slug;
  const hasDrug = (drug: FoundDrug): boolean => items().some((item) => item.id === itemId(drug));

  const addDrug = (drug: FoundDrug, typed?: string): void => {
    const loaded = index();
    const card = loaded?.cardBySlug.get(drug.slug);
    if (!loaded || card === undefined) return;
    const name = displayDrugName(loaded.asset.cards[card]?.n ?? drug.slug);
    const label = drug.product ? `${drug.product} · ${name}` : name;
    setItems((current) =>
      current.length >= MAX_DRUGS || current.some((item) => item.id === itemId(drug))
        ? current
        : [
            ...current,
            {
              id: itemId(drug),
              card,
              label,
              product: drug.product,
              typed:
                typed && typed.toLocaleLowerCase('ru-RU') !== label.toLocaleLowerCase('ru-RU')
                  ? typed
                  : undefined,
            },
          ],
    );
  };
  const removeItem = (id: string): void => {
    setItems((current) => current.filter((item) => item.id !== id));
    setOverrides((current) => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });
  };

  // The drugs the tool was opened with: exact drugs first, then typed names through the drug search.
  let initialized = false;
  createEffect(() => {
    const loaded = index();
    const core = props.core;
    if (!loaded || !core || initialized) return;
    initialized = true;
    void (async () => {
      for (const value of props.initialDrugs) {
        const { slug, product } = decodeDrug(value);
        if (loaded.cardBySlug.has(slug)) addDrug({ slug, product, label: slug });
      }
      const missing: string[] = [];
      for (const name of props.initialNames) {
        const found = await resolveDrugName(core, name);
        if (found) addDrug(found, name);
        else missing.push(name);
      }
      setUnresolved(missing);
      setResolving(false);
    })();
  });

  // The drug search box.
  createEffect(() => {
    const text = query().trim();
    const core = props.core;
    if (text.length < 2 || !core || !index()) {
      setCandidates([]);
      return;
    }
    const handle = setTimeout(() => {
      void findDrugs(core, text).then((found) => {
        if (untrack(() => query().trim()) === text) setCandidates(found);
      });
    }, 250);
    onCleanup(() => clearTimeout(handle));
  });

  const chosen = createMemo(() => {
    const loaded = index();
    return loaded
      ? chooseDocuments(loaded, items(), overrides())
      : new Map<string, string | null>();
  });

  // Installed instructions: read once per document; a reconnected core or a content change starts over.
  let requested = new Set<string>();
  const forgetDocuments = (): void => {
    requested = new Set();
    setDocuments(new Map());
  };
  createEffect(on(() => props.core, forgetDocuments, { defer: true }));
  createEffect(() => {
    const core = props.core;
    documents();
    if (!core) return;
    const generation = requested;
    for (const id of chosen().values()) {
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

  const columns = createMemo(() => {
    const loaded = index();
    return loaded ? columnViews(loaded, items(), chosen(), documents()) : [];
  });
  const readDocuments = createMemo(() => {
    const map = new Map<number, MedicalDocument>();
    for (const column of columns()) {
      const state = column.documentId ? documents().get(column.documentId) : undefined;
      if (column.state === 'ready' && state && typeof state === 'object') {
        map.set(column.position, state.document);
      }
    }
    return map;
  });
  // Extraction runs once per installed document.
  const extractedCache = new Map<MedicalDocument, ReadonlyMap<string, ExtractedRow>>();
  const extracted = createMemo(() => {
    const map = new Map<number, ReadonlyMap<string, ExtractedRow>>();
    for (const [position, document] of readDocuments()) {
      let rows = extractedCache.get(document);
      if (!rows) {
        rows = extractRows(document);
        extractedCache.set(document, rows);
      }
      map.set(position, rows);
    }
    return map;
  });
  const ownNames = createMemo(() => {
    const loaded = index();
    const map = new Map<number, readonly string[]>();
    for (const column of columns()) {
      const card = loaded?.asset.cards[column.item.card];
      map.set(
        column.position,
        [card?.n, column.item.product, column.tradeName].filter(
          (name): name is string => typeof name === 'string' && name !== '',
        ),
      );
    }
    return map;
  });
  const sectionRows = createMemo(() => sectionRowViews(columns(), extracted(), ownNames()));
  const quoteRows = createMemo(() => quoteRowViews(columns(), readDocuments()));
  const safetyRows = createMemo(() => safetyRowViews(columns(), readDocuments()));
  const registry = createMemo(() => {
    const loaded = index();
    if (!loaded) return [];
    const catalog = atc() ?? null;
    return REGISTRY_ROWS.map((spec) => ({
      spec,
      cells: columns().map((column): RegistryCell => {
        const card = loaded.asset.cards[column.item.card];
        return card
          ? registryCell(spec.id, card, loaded.asset, catalog)
          : { lines: ['В реестре не указано'], more: [], empty: true };
      }),
    }));
  });
  const registrySource = createMemo(() => {
    const loaded = index();
    return loaded ? registrySourceLine(loaded.asset, atc() ?? null) : '';
  });
  /** The instruction modules the columns need and the device does not have: one offer for each. */
  const missingModules = createMemo(() => [
    ...new Set([
      ...columns().flatMap((column) =>
        column.state === 'not-installed' && column.moduleId ? [column.moduleId] : [],
      ),
      ...pairModules(),
    ]),
  ]);

  // The same substances for the interaction panel (one per substance).
  const interactionItems = createMemo<readonly DrugItem[]>(() => {
    const loaded = interactionIndex();
    if (!loaded) return [];
    const seen = new Set<string>();
    const list: DrugItem[] = [];
    for (const item of items()) {
      const slug = item.id.split('|')[0] ?? item.id;
      const card = loaded.cardBySlug.get(slug);
      if (card === undefined || seen.has(slug)) continue;
      seen.add(slug);
      list.push({
        id: slug,
        kind: 'drug',
        card,
        label: displayDrugName(index()?.asset.cards[item.card]?.n ?? slug),
      });
    }
    return list;
  });

  const printInteractions = (): readonly PrintPair[] => printPairs(pairs());
  const printModel = () =>
    printModelOf({
      columns: columns(),
      registry: registry(),
      quoteRows: quoteRows(),
      safetyRows: safetyRows(),
      sectionRows: sectionRows(),
      onlyDifferences: onlyDifferences(),
      interactions: printInteractions(),
      registrySource: registrySource(),
    });
  const printOut = (): void => {
    const html = renderComparisonPrintHtml(printModel(), todayText());
    if (!PrintManager.html(html, COMPARISON_PRINT_TITLE)) {
      toast.error('Не удалось открыть печать. Разрешите всплывающие окна для этого сайта.');
    }
  };
  const share = async (): Promise<void> => {
    const text = comparisonShareText(printModel());
    try {
      if ('share' in navigator && typeof navigator.share === 'function') {
        await navigator.share({ title: COMPARISON_PRINT_TITLE, text });
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
    <section class="drug-comparison" aria-label="Сравнение препаратов">
      <Page
        navigation={
          <NavBack
            class="drug-comparison__back knowledge-back-button"
            aria-label="Назад"
            onClick={props.onBack}
          />
        }
        title={<Heading depth={1}>Сравнение препаратов</Heading>}
        description="Двух–четырёх препаратов рядом"
        help={
          <>
            <p class="drug-comparison__notice-text" data-testid="comparison-notice">
              {COMPARISON_NOTICE_SHORT}
            </p>
            <p class="drug-comparison__help">
              Реестровые строки (МНН, группа АТХ, формы и дозировки, условия отпуска, ЖНВЛП, число
              регистраций) взяты из ЕСКЛП, ГРЛС и НСИ «АТХ» и подписаны источником.
            </p>
            <p class="drug-comparison__help">
              Разделы инструкций показаны дословно из установленных текстов. Каждый пункт
              (предложение или пункт списка) приводится к общему виду: регистр, знаки, окончания
              слов, название самого препарата не учитываются. Пункты с одинаковыми словами отмечены
              «у обоих», пункты, у которых совпадает не менее 60 % слов, показаны рядом с пометкой
              «формулировки различаются», а различающиеся слова и числа выделены. Остальные пункты
              отмечены «у других совпадения нет»: другая инструкция может говорить о том же иными
              словами — проверьте её раздел. Ничего не пересказывается и не оценивается.
            </p>
            <p class="drug-comparison__help">
              Для каждого препарата читается одна инструкция; где возможно, у всех препаратов
              берётся одна лекарственная форма. Другую инструкцию вещества можно выбрать в заголовке
              столбца. Тексты других производителей могут отличаться.
            </p>
          </>
        }
      />

      <section class="drug-comparison__picker" aria-label="Препараты для сравнения">
        <SearchField
          class="drug-comparison__search"
          label="Добавить препарат"
          placeholder="Препарат или МНН"
          value={query()}
          onInput={setQuery}
          inputRef={(element) => {
            searchInput = element;
          }}
          onClear={() => {
            setQuery('');
            setCandidates([]);
          }}
        />
        <Show when={candidates().length > 0}>
          <ul class="drug-comparison__candidates" aria-label="Найденные препараты">
            <For each={candidates()}>
              {(drug) => (
                <li class="drug-comparison__candidate-row">
                  <button
                    type="button"
                    class="drug-comparison__candidate"
                    disabled={hasDrug(drug) || items().length >= MAX_DRUGS}
                    onClick={() => {
                      addDrug(drug);
                      setQuery('');
                      setCandidates([]);
                    }}
                  >
                    <AppGlyph name={hasDrug(drug) ? 'check' : 'plus'} />
                    <span>{drug.label}</span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={query().trim().length >= 2 && candidates().length === 0 && !index.loading}>
          <p class="drug-comparison__hint" role="status">
            Ничего не найдено. Если справочник препаратов не скачан, скачайте его в разделе
            «Препараты».
          </p>
        </Show>
      </section>

      <Show when={items().length > 0 || unresolved().length > 0 || resolving()}>
        <ul class="drug-comparison__items" aria-label="Выбранные препараты">
          <For each={items()}>
            {(item) => (
              <li class="drug-comparison__item" data-testid="comparison-item">
                <span class="drug-comparison__item-name">{item.label}</span>
                <Show when={item.typed}>
                  {(typed) => (
                    <span class="drug-comparison__item-typed">по запросу «{typed()}»</span>
                  )}
                </Show>
                <button
                  type="button"
                  class="drug-comparison__item-remove"
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
              <li class="drug-comparison__item drug-comparison__item--missing">
                <span class="drug-comparison__item-name">Не найден: «{name}»</span>
                <button
                  type="button"
                  class="drug-comparison__item-remove"
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
            <li class="drug-comparison__item drug-comparison__item--busy" role="status">
              Ищем препараты…
            </li>
          </Show>
        </ul>
      </Show>
      <Show when={items().length >= MAX_DRUGS}>
        <p class="drug-comparison__hint">Достигнут предел в {MAX_DRUGS} препарата.</p>
      </Show>
      <Show when={index.error}>
        <p class="drug-comparison__hint" role="alert">
          Указатель сравнения не загрузился. Перезапустите приложение.
        </p>
      </Show>

      <Show
        when={items().length >= MIN_DRUGS}
        fallback={
          <Show when={!resolving()}>
            <p class="drug-comparison__empty" role="status" data-testid="comparison-empty">
              Добавьте {items().length === 0 ? 'два препарата' : 'ещё один препарат'} или больше (до{' '}
              {MAX_DRUGS}), чтобы сравнить их.
              <Show when={items().length === 1}>
                {' '}
                <button
                  type="button"
                  class="drug-comparison__toggle"
                  onClick={() => searchInput?.focus()}
                >
                  Выбрать
                </button>
              </Show>
            </p>
          </Show>
        }
      >
        <div class="drug-comparison__toolbar">
          <div class="drug-comparison__differences">
            <Switch
              checked={onlyDifferences()}
              onChange={setOnlyDifferences}
              aria-label="Показать только различия"
            />
            <span class="drug-comparison__differences-label">Показать только различия</span>
          </div>
          <div class="drug-comparison__actions-bar">
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
          </div>
        </div>

        <Show when={missingModules().length > 0}>
          <section class="drug-comparison__offers paper-card" aria-label="Инструкции для чтения">
            <p class="drug-comparison__offers-text">
              Тексты этих инструкций ещё не скачаны: разделы инструкций можно прочитать и сравнить
              только из установленных текстов.
            </p>
            <For each={missingModules()}>
              {(moduleId) => (
                <InstructionDownloadOffer moduleId={moduleId} onContentChanged={onContentChanged} />
              )}
            </For>
          </section>
        </Show>

        <ComparisonMatrix
          columns={columns()}
          registry={registry()}
          registrySource={registrySource()}
          quoteRows={quoteRows()}
          safetyRows={safetyRows()}
          onRemove={removeItem}
          onChoose={(id, documentId) =>
            setOverrides((current) => new Map(current).set(id, documentId))
          }
        />
        <ComparisonSections
          rows={sectionRows()}
          columns={columns()}
          onlyDifferences={onlyDifferences()}
        />

        <Show when={interactionItems().length >= 2}>
          <section
            class="drug-comparison__interactions"
            aria-label="Взаимодействие между препаратами"
          >
            <h3 class="drug-comparison__group">Взаимодействие между этими препаратами</h3>
            <p class="drug-comparison__group-source">
              Предложения из официальных инструкций, где один препарат упоминает другой (поиск по
              текстам, как в инструменте «Взаимодействие препаратов»).
            </p>
            <InteractionPairsPanel
              core={props.core}
              items={interactionItems()}
              onContentChanged={onContentChanged}
              actions={false}
              onPairs={setPairs}
              offers={false}
              onMissingModules={setPairModules}
            />
          </section>
        </Show>
        <p class="drug-comparison__footnote">{COMPARISON_NOTICE}</p>
      </Show>
    </section>
  );
}
