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
} from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { Disclosure } from '@/components/Disclosure';
import { Heading } from '@/components/Text';
import { PrintManager } from '@/features/printing/print-manager';
import { CONTENT_CHANGED_EVENT } from '@/state/content-events';
import { buildOfficialDocumentHash } from '@/state/document-route';
import { InstructionDownloadOffer } from './InstructionDownloadOffer';
import { checkAllPairs, type DrugItem, itemDocumentId } from './interaction-check';
import { loadClassPhrases, loadInteractionIndex } from './interaction-load';
import {
  INTERACTION_PRINT_TITLE,
  interactionShareText,
  renderInteractionPrintHtml,
} from './interaction-print';
import { sentenceSectionLabel } from './interaction-quotes';
import {
  SEVERITY_LICENSE_URL,
  type SeverityLevel,
  type SeverityLookup,
  type SeverityProvenance,
  severityAttribution,
  severityDocumentId,
} from './interaction-severity';
import { loadSeverityPartners, loadSeverityProvenance } from './interaction-severity-load';
import {
  type DocumentState,
  hasReadableSide,
  otherSectionsLabel,
  type PairView,
  pairOfferModules,
  pairStatusText,
  pairTitle,
  pairView,
  printPairs,
  type SideView,
  sideHeading,
  sideNote,
  sideSourceLine,
  splitQuotes,
} from './interaction-view';
import { SeverityDownloadOffer } from './SeverityDownloadOffer';
import '@/styles/drug-interactions.css';

const VIDAL_CHECKER_URL = 'https://www.vidal.ru/drugs/interaction/new';

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

/**
 * What one instruction says about the other drug. Only instructions that can be read get a block:
 * «нет в источниках» is said once in the pair's status line and «не установлена» is the download
 * offer under that line, so neither is repeated per drug.
 */
function SideBlock(props: { readonly side: SideView }): JSX.Element {
  const note = () => sideNote(props.side);
  const source = () => sideSourceLine(props.side);
  const split = createMemo(() => splitQuotes(props.side.quotes));
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
          <For each={split().main}>
            {(quote) => <QuoteBlock documentId={props.side.documentId ?? ''} quote={quote} />}
          </For>
          <Show when={split().main.length === 0}>
            <p class="drug-interactions__side-status" data-testid="interaction-main-empty">
              {`В разделе о взаимодействии с другими лекарственными средствами упоминаний «${props.side.to.label}» нет.`}
            </p>
          </Show>
          <Show when={split().other.length > 0}>
            <Disclosure
              variant="inline"
              class="drug-interactions__fold"
              title={otherSectionsLabel(split().other.length)}
            >
              <div class="drug-interactions__fold-body" data-testid="interaction-fold-body">
                <For each={split().other}>
                  {(quote) => <QuoteBlock documentId={props.side.documentId ?? ''} quote={quote} />}
                </For>
              </div>
            </Disclosure>
          </Show>
          <Show when={props.side.changed > 0}>
            <p class="drug-interactions__side-note">{note()}</p>
          </Show>
        </Show>
      </Show>
    </section>
  );
}

function PairCard(props: {
  readonly view: PairView;
  /** The download of a missing instruction sits in the card that needs it. */
  readonly offers: boolean;
  readonly onContentChanged: () => Promise<void>;
}): JSX.Element {
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
        <Show when={props.view.severity}>
          {(severity) => (
            <div class="drug-interactions__severity" data-testid="interaction-severity">
              <span
                class="drug-interactions__severity-label"
                classList={{
                  [`drug-interactions__severity-label--${severity().level}`]: true,
                }}
                data-level={severity().level}
              >
                {severity().label}
              </span>
              <span class="drug-interactions__severity-note">{severity().note}</span>
            </div>
          )}
        </Show>
      </header>
      <For each={props.view.sides.filter(hasReadableSide)}>
        {(side) => <SideBlock side={side} />}
      </For>
      <Show when={props.offers}>
        <For each={pairOfferModules(props.view)}>
          {(moduleId) => (
            <InstructionDownloadOffer
              moduleId={moduleId}
              onContentChanged={props.onContentChanged}
            />
          )}
        </For>
      </Show>
    </article>
  );
}

/**
 * The pairs of the given drugs and what the official instructions say about each: the summary,
 * the offers to install missing instructions, one card per pair and the DDInter source note. Shared
 * by «Взаимодействие препаратов» and «Сравнение препаратов» (CMP1), so both quote the same
 * sentences with the same labels. `actions` adds print, share and the vidal.ru link-out.
 */
export function InteractionPairsPanel(props: {
  readonly core: MedicalCore | undefined;
  readonly items: readonly DrugItem[];
  readonly onContentChanged: () => Promise<void>;
  readonly actions?: boolean;
  /** Called with the pair views whenever they change (the comparison prints and shares them). */
  readonly onPairs?: (views: readonly PairView[]) => void;
  /** `false`: the caller shows the download offers itself, from `onMissingModules`. */
  readonly offers?: boolean;
  /** Called with the instruction modules the pairs need and the device does not have. */
  readonly onMissingModules?: (moduleIds: readonly string[]) => void;
}): JSX.Element {
  const [index] = createResource(loadInteractionIndex);
  const [phrases] = createResource(() => loadClassPhrases().catch(() => []));
  const [documents, setDocuments] = createSignal<ReadonlyMap<string, DocumentState>>(new Map());
  const [contentRevision, setContentRevision] = createSignal(0);
  const [severityDocuments, setSeverityDocuments] = createSignal<
    ReadonlyMap<string, ReadonlyMap<string, SeverityLevel> | 'loading'>
  >(new Map());
  const onContentChanged = props.onContentChanged;

  // Installed instructions: read once per document; a reconnected core or a content change starts over.
  let requested = new Set<string>();
  let severityRequested = new Set<string>();
  const forgetDocuments = (): void => {
    requested = new Set();
    setDocuments(new Map());
    severityRequested = new Set();
    setSeverityDocuments(new Map());
    setContentRevision((value) => value + 1);
  };
  createEffect(on(() => props.core, forgetDocuments, { defer: true }));
  createEffect(() => {
    const loaded = index();
    const core = props.core;
    documents();
    if (!loaded || !core) return;
    const generation = requested;
    for (const item of props.items) {
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

  const pairChecks = createMemo(() => {
    const loaded = index();
    return loaded ? checkAllPairs(loaded, props.items) : [];
  });

  // The optional DDInter module: its manifest says it is installed, and which source and licence.
  const [provenance] = createResource(
    () => (props.core ? { core: props.core, revision: contentRevision() } : false),
    ({ core }): Promise<SeverityProvenance | null> =>
      loadSeverityProvenance(core).catch(() => null),
  );
  // The severity document of each pair that has instruction sentences, read once.
  createEffect(() => {
    const core = props.core;
    if (!core || !provenance()) return;
    const generation = severityRequested;
    for (const pair of pairChecks()) {
      if (pair.found === 0 || pair.a.kind !== 'drug' || pair.b.kind !== 'drug') continue;
      const { documentId } = severityDocumentId(pair.a.id, pair.b.id);
      if (generation.has(documentId)) continue;
      generation.add(documentId);
      setSeverityDocuments((current) => new Map(current).set(documentId, 'loading'));
      void loadSeverityPartners(core, documentId)
        .catch(() => new Map<string, SeverityLevel>())
        .then((partners) => {
          if (generation !== severityRequested) return;
          setSeverityDocuments((current) => new Map(current).set(documentId, partners));
        });
    }
  });
  const severityLookup = createMemo<SeverityLookup | null>(() => {
    const installed = provenance();
    if (!installed) return null;
    const read = severityDocuments();
    return {
      provenance: installed,
      levelOf: (first, second) => {
        const { documentId, partner } = severityDocumentId(first, second);
        const partners = read.get(documentId);
        return partners && partners !== 'loading' ? (partners.get(partner) ?? null) : null;
      },
    };
  });

  const views = createMemo<readonly PairView[]>(() => {
    const loaded = index();
    if (!loaded) return [];
    const read = documents();
    const classes = phrases() ?? [];
    const severity = severityLookup();
    return pairChecks().map((pair) => pairView(loaded, pair, read, classes, severity));
  });
  createEffect(() => props.onPairs?.(views()));
  const foundCount = () => views().filter((view) => view.status === 'found').length;
  const labelledCount = () => views().filter((view) => view.severity !== null).length;
  /** Pairs with a sentence that can be quoted now: only those could carry a severity label. */
  const quotablePairCount = () =>
    views().filter((view) => view.sides.some((side) => side.quotes.length > 0)).length;
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

  createEffect(() => props.onMissingModules?.(missingModules()));

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
    <>
      <div
        class="drug-interactions__toolbar"
        classList={{
          'drug-interactions__toolbar--empty': views().length <= 1 && props.actions === false,
        }}
      >
        <div class="drug-interactions__summary" role="status" data-testid="interaction-summary">
          <Show when={views().length > 1}>
            <span>
              Пар: {views().length}. Упоминание найдено в {foundCount()}.
            </span>
          </Show>
        </div>
        <Show when={props.actions !== false}>
          <div class="drug-interactions__actions">
            <Button
              type="button"
              variant="icon"
              class="drug-interactions__action"
              aria-label="Печать"
              title="Печать"
              icon={<AppGlyph name="printer" />}
              onClick={printOut}
            />
            <Button
              type="button"
              variant="icon"
              class="drug-interactions__action"
              aria-label="Поделиться"
              title="Поделиться"
              icon={<AppGlyph name="share" />}
              onClick={() => void share()}
            />
          </div>
        </Show>
      </div>
      <Show when={quotablePairCount() > 0 && provenance.state === 'ready' && provenance() === null}>
        <SeverityDownloadOffer onContentChanged={onContentChanged} />
      </Show>
      <div class="drug-interactions__pairs" data-testid="interaction-pairs">
        <For each={views()}>
          {(view) => (
            <PairCard
              view={view}
              offers={props.offers !== false}
              onContentChanged={onContentChanged}
            />
          )}
        </For>
      </div>
      <Show when={severityLookup()}>
        {(lookup) => (
          <aside class="drug-interactions__severity-source" data-testid="severity-source">
            <p class="drug-interactions__severity-source-text">
              {severityAttribution(lookup().provenance)} Показаны только метки; описаний базы в
              приложении нет.
            </p>
            <p class="drug-interactions__severity-source-text">
              {labelledCount() === 0
                ? 'Для выбранных пар меток нет: метка показывается только там, где в инструкции есть предложение, и база DDInter знает пару.'
                : `Меток на экране: ${labelledCount()}.`}{' '}
              <a
                class="drug-interactions__vidal"
                href={lookup().provenance.licenseUrl || SEVERITY_LICENSE_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Лицензия {lookup().provenance.license}
              </a>
            </p>
          </aside>
        )}
      </Show>
      <Show when={props.actions !== false}>
        <footer class="drug-interactions__footer">
          <span>«Не найдено» не значит «безопасно».</span>
          <a
            class="drug-interactions__vidal"
            href={VIDAL_CHECKER_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Проверить на vidal.ru
          </a>
        </footer>
      </Show>
    </>
  );
}
