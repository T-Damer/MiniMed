import type {
  MedicalCore,
  MedicalDocument,
  MedicalDocumentSummary,
  MedicalSection,
  TextRange,
} from '@localmed/contracts';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { toast } from 'solid-sonner';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { DocumentCrumbs } from '@/components/DocumentCrumbs';
import { DocumentText, documentTextSearchText } from '@/components/DocumentText';
import { QueryHighlightedText } from '@/components/HighlightedText';
import { DocumentFindBar, type DocumentFindResultState } from '@/features/library/DocumentFindBar';
import type { MutableDocumentSectionTree } from '@/features/library/document-display';
import {
  displayDocumentSubtitle,
  displayDocumentTitle,
  documentSectionHeadingTag,
  nestDocumentSections,
  resolveReadableDocumentId,
  sourceTypeReaderLabel,
  visibleReaderSections,
} from '@/features/library/document-display';
import { type DocumentFindUnit, rangesForFindUnit } from '@/features/library/document-find';
import {
  buildDocumentLinkPhrases,
  createDocumentLinkMatcher,
} from '@/features/library/document-medication-links';
import { printDocument, shareDocument } from '@/features/library/document-print';
import {
  DocumentReaderChromeShell,
  useDocumentReaderChrome,
} from '@/features/library/document-reader-chrome';
import { DocumentRichBlock } from '@/features/library/document-rich-block';
import {
  documentRenderBlockSearchText,
  resolveDocumentChunkItems,
} from '@/features/library/document-rich-block-data';
import type { ResolvedReferenceImage } from '@/features/library/reference-image-assets';
import { getReferenceImageResolver } from '@/features/library/reference-image-assets';
import type { ClinicalMedicationLink } from '@/features/medications/clinical-medication-links';
import {
  ALLMED_SOURCE_URL,
  type ResolvedMedicationPackagingImage,
  resolveMedicationPackagingImage,
} from '@/features/medications/medication-packaging-images';
import type {
  MedicationProduct,
  TradeNameSupplement,
} from '@/features/medications/medication-record';
import { formatFullTextDownloadLabel, formatModuleBytes } from '@/features/modules/module-display';
import type { ModulePointerResolution } from '@/features/modules/module-pointer-install';
import { buildDocumentSectionLink, openDocumentOverlay } from '@/state/document-navigation';
import type { DocumentTrail } from '@/state/document-trail';

interface OfficialDocumentReaderProps {
  readonly core?: MedicalCore | undefined;
  readonly document: MedicalDocument | undefined;
  readonly pendingTitle?: string;
  readonly availableDocuments?: readonly MedicalDocumentSummary[];
  readonly medicationProduct?: MedicationProduct;
  readonly supplementalPanels?: readonly TradeNameSupplement[];
  readonly clinicalMedicationLinks?: readonly ClinicalMedicationLink[];
  readonly initialAnchor?: string | null;
  readonly trail: DocumentTrail | null;
  readonly openError?: string | null;
  readonly modulePointer?: ModulePointerResolution | null;
  readonly modulePointerPending?: boolean;
  readonly modulePointerProgress?: number | null;
  readonly modulePointerInstallError?: string | null;
  readonly onNavigate: (href: string) => void;
  readonly onInstallModulePointer?: () => Promise<void>;
  readonly onRequestFullText: (
    document: MedicalDocument,
    onProgress?: (fraction: number | null) => void,
  ) => Promise<void>;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').trim();
}

function statusLabel(status: string): string {
  if (status === 'active' || status === 'current') return 'Действующая редакция';
  if (status === 'superseded') return 'Заменённая редакция';
  if (status === 'historical') return 'Исторический документ';
  return status;
}

const emptyFindState: DocumentFindResultState = {
  query: '',
  mode: 'exact',
  matches: [],
  activeIndex: 0,
  loading: false,
};

const INITIAL_SECTION_BATCH = 4;
const SECTION_BATCH_SIZE = 3;

function sectionIndexForAnchor(
  sections: ReturnType<typeof visibleReaderSections>,
  anchor: string | null | undefined,
): number {
  if (!anchor) return -1;
  return sections.findIndex(
    (section) =>
      section.anchor === anchor || section.chunks.some((chunk) => chunk.anchor === anchor),
  );
}

function scheduleIdleWork(work: () => void): number {
  const requestIdleCallback = (
    globalThis as typeof globalThis & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    }
  ).requestIdleCallback;
  if (typeof requestIdleCallback === 'function') {
    return requestIdleCallback(work, { timeout: 100 });
  }
  return window.setTimeout(work, 0);
}

function cancelIdleWork(handle: number): void {
  const cancelIdleCallback = (
    globalThis as typeof globalThis & { cancelIdleCallback?: (handle: number) => void }
  ).cancelIdleCallback;
  if (typeof cancelIdleCallback === 'function') {
    cancelIdleCallback(handle);
    return;
  }
  window.clearTimeout(handle);
}

function AllmedSupplementPanel(props: { readonly supplement: TradeNameSupplement }): JSX.Element {
  const [image, setImage] = createSignal<ResolvedMedicationPackagingImage | null>(null);

  onMount(() => {
    const reference = props.supplement.product.imageReference;
    if (!reference) return;
    void resolveMedicationPackagingImage(reference).then(setImage);
  });

  return (
    <details class="document-allmed-supplement">
      <summary class="document-allmed-supplement__summary">
        {props.supplement.product.tradeName}
      </summary>
      <div class="document-allmed-supplement__body">
        <Show when={image()}>
          {(resolvedImage) => (
            <figure class="document-allmed-supplement__figure">
              <img
                class="document-allmed-supplement__image"
                src={resolvedImage().url}
                alt={`Фото упаковки: ${props.supplement.product.tradeName}`}
                loading="lazy"
              />
              <figcaption class="document-allmed-supplement__caption">
                Фото упаковки из справочного материала Allmed
              </figcaption>
            </figure>
          )}
        </Show>
        <Show when={props.supplement.product.shortDescription}>
          {(description) => <p class="document-allmed-supplement__description">{description()}</p>}
        </Show>
        <a
          class="document-allmed-supplement__source"
          href={ALLMED_SOURCE_URL}
          rel="noreferrer"
          target="_blank"
        >
          Источник: allmed.pro
        </a>
      </div>
    </details>
  );
}

function ReferencePointerImage(props: { readonly documentId: string }): JSX.Element {
  const [image, setImage] = createSignal<ResolvedReferenceImage | null>();
  const [failed, setFailed] = createSignal(false);

  onMount(() => {
    void getReferenceImageResolver()
      .resolveFirst(props.documentId)
      .then((value) => setImage(value))
      .catch(() => setFailed(true));
  });

  return (
    <Show
      when={image()}
      fallback={
        <Show when={failed()}>
          <p class="document-reference-image__fallback">Не удалось загрузить иллюстрацию.</p>
        </Show>
      }
    >
      {(value) => (
        <figure class="document-reference-image document-reference-image--pointer">
          <img
            class="document-reference-image__image"
            src={value().url}
            alt={value().alt}
            loading="lazy"
            onError={() => setFailed(true)}
            hidden={failed()}
          />
          <Show when={!failed()}>
            <figcaption class="document-reference-image__caption">
              <span>Источник: Красота и медицина</span>{' '}
              <a
                class="document-reference-image__source"
                href={value().sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                Открыть
              </a>
            </figcaption>
          </Show>
          <Show when={failed()}>
            <p class="document-reference-image__fallback">
              Иллюстрация недоступна в подключённом наборе.
            </p>
          </Show>
        </figure>
      )}
    </Show>
  );
}

function MedicationProductPanel(props: {
  readonly product: MedicationProduct;
  readonly currentDocumentId: string;
}): JSX.Element {
  const sources = () => [
    ...(props.product.sourceKind === 'esklp' ? ['ЕСКЛП'] : []),
    ...(props.product.grlsRegistrationDocumentId || props.product.instructionDocumentId
      ? ['ГРЛС']
      : []),
    ...(props.product.supplementalDescription || props.product.imageReference ? ['Allmed'] : []),
  ];
  const links = () =>
    [
      props.product.mnnDocumentId
        ? { id: props.product.mnnDocumentId, label: 'Карточка МНН' }
        : null,
      props.product.grlsRegistrationDocumentId
        ? { id: props.product.grlsRegistrationDocumentId, label: 'Регистрация ГРЛС' }
        : null,
      props.product.instructionDocumentId
        ? { id: props.product.instructionDocumentId, label: 'Инструкция' }
        : null,
    ].filter(
      (item): item is { readonly id: string; readonly label: string } =>
        item !== null && item.id !== props.currentDocumentId,
    );

  return (
    <section class="document-medication-product" aria-label="Карточка препарата">
      <h2 class="document-medication-product__title">
        {props.product.tradeName} · {props.product.inn}
      </h2>
      <div class="document-medication-product__presentations">
        <For each={props.product.presentations}>
          {(presentation) => (
            <p class="document-medication-product__presentation">
              {presentation.dosageForm}
              <Show when={presentation.strength}> · {presentation.strength}</Show>
            </p>
          )}
        </For>
      </div>
      <Show when={links().length > 0}>
        <div class="document-medication-product__links">
          <For each={links()}>
            {(link) => (
              <Button
                type="button"
                variant="secondary"
                class="document-medication-product__link"
                onClick={() => openDocumentOverlay(link.id, null, { preferSummary: true })}
              >
                {link.label}
              </Button>
            )}
          </For>
        </div>
      </Show>
      <Show when={sources().length > 0}>
        <p class="document-medication-product__source">Источник: {sources().join(' · ')}</p>
      </Show>
    </section>
  );
}

function ClinicalMedicationLinksPanel(props: {
  readonly links: readonly ClinicalMedicationLink[];
}): JSX.Element {
  return (
    <section
      class="document-clinical-medication-links"
      aria-labelledby="document-clinical-medication-links-title"
    >
      <h2
        id="document-clinical-medication-links-title"
        class="document-clinical-medication-links__title"
      >
        Клинические рекомендации
      </h2>
      <div class="document-clinical-medication-links__list">
        <For each={props.links}>
          {(link) => (
            <article class="document-clinical-medication-links__item">
              <Button
                type="button"
                variant="secondary"
                class="document-clinical-medication-links__link"
                onClick={() =>
                  openDocumentOverlay(link.pointerDocumentId, link.sourceAnchor, {
                    preferSummary: true,
                  })
                }
              >
                {link.recommendationTitle}
              </Button>
              <Show when={link.ageGroups.length > 0}>
                <p class="document-clinical-medication-links__population">
                  Популяция: {link.ageGroups.join(', ')}
                </p>
              </Show>
            </article>
          )}
        </For>
      </div>
      <p class="document-clinical-medication-links__source">Источник: клинические рекомендации</p>
    </section>
  );
}

export function OfficialDocumentReader(props: OfficialDocumentReaderProps): JSX.Element {
  const [findState, setFindState] = createSignal<DocumentFindResultState>(emptyFindState);
  const [findOpen, setFindOpen] = createSignal(false);
  const [fullTextPending, setFullTextPending] = createSignal(false);
  const [fullTextProgress, setFullTextProgress] = createSignal<number | null>(null);
  const [fullTextError, setFullTextError] = createSignal<string | null>(null);
  const [mountedSectionCount, setMountedSectionCount] = createSignal(0);
  let flashTimeout: number | undefined;
  let flashedHeading: HTMLElement | null = null;

  const orderedSections = createMemo(() => {
    const document = props.document;
    if (!document) return [];
    return visibleReaderSections(document.sections, document.sourceType);
  });

  const visibleSections = createMemo(() => orderedSections().slice(0, mountedSectionCount()));
  // Stable node identities keep Solid's <For> from remounting already-rendered
  // sections on every idle batch append.
  const sectionTreeCache = new Map<MedicalSection, MutableDocumentSectionTree>();
  const visibleSectionTree = createMemo(() =>
    nestDocumentSections(visibleSections(), sectionTreeCache),
  );
  const sectionsPending = createMemo(
    () => mountedSectionCount() > 0 && mountedSectionCount() < orderedSections().length,
  );

  createEffect(() => {
    const sections = orderedSections();
    const document = props.document;
    if (!document || sections.length === 0) {
      setMountedSectionCount(0);
      return;
    }

    const anchorIndex = sectionIndexForAnchor(sections, props.initialAnchor);
    const initialCount =
      anchorIndex >= 0
        ? Math.min(sections.length, Math.max(INITIAL_SECTION_BATCH, anchorIndex + 1))
        : Math.min(INITIAL_SECTION_BATCH, sections.length);
    setMountedSectionCount(initialCount);

    if (initialCount >= sections.length) return;

    let cancelled = false;
    let count = initialCount;
    let idleHandle: number | undefined;

    const appendBatch = (): void => {
      if (cancelled) return;
      count = Math.min(
        sections.length,
        Math.max(count, mountedSectionCount()) + SECTION_BATCH_SIZE,
      );
      setMountedSectionCount(count);
      if (count < sections.length) {
        idleHandle = scheduleIdleWork(appendBatch);
      }
    };

    idleHandle = scheduleIdleWork(appendBatch);
    onCleanup(() => {
      cancelled = true;
      if (idleHandle !== undefined) cancelIdleWork(idleHandle);
    });
  });

  const findUnits = createMemo((): readonly DocumentFindUnit[] => {
    const document = props.document;
    if (!document) return [];
    const units: DocumentFindUnit[] = [];
    units.push({ id: document.id, text: displayDocumentTitle(document) });
    for (const section of orderedSections()) {
      units.push({ id: section.anchor, text: section.title });
      for (const item of resolveDocumentChunkItems(section.chunks)) {
        units.push({
          id: item.chunk.anchor,
          text:
            item.kind === 'rich'
              ? documentRenderBlockSearchText(item.block)
              : documentTextSearchText(
                  item.chunk.originalText,
                  // biome-ignore lint/complexity/useLiteralKeys: source spans are optional runtime metadata.
                  item.chunk.metadata?.['sourceSpans'],
                ),
        });
      }
    }
    return units;
  });

  const findSearchable = createMemo(() => {
    const document = props.document;
    return Boolean(
      document &&
        (displayDocumentTitle(document).trim().length > 0 ||
          orderedSections().some(
            (section) => section.title.trim().length > 0 || section.chunks.length > 0,
          )),
    );
  });

  const findMatches = createMemo(() => findState().matches);
  const rangesByUnit = createMemo(() => {
    const map = new Map<string, TextRange[]>();
    for (const match of findMatches()) {
      const existing = map.get(match.unitId) ?? [];
      existing.push({ start: match.start, end: match.end });
      map.set(match.unitId, existing);
    }
    return map;
  });

  const activeMatch = createMemo(() => {
    const state = findState();
    return findMatches()[state.activeIndex];
  });
  let lastScrolledMatchKey = '';

  const chrome = useDocumentReaderChrome({
    ...(props.initialAnchor != null && props.initialAnchor !== ''
      ? { initialAnchor: props.initialAnchor }
      : {}),
    sectionSelector: '.document-overlay-section',
    outlineItemAttr: 'data-section-anchor',
    scrollSpyWhen: () => Boolean(props.document) && orderedSections().length > 0,
    onBeforeScrollTo: (anchor) => {
      const sectionIndex = sectionIndexForAnchor(orderedSections(), anchor);
      if (sectionIndex >= mountedSectionCount()) setMountedSectionCount(sectionIndex + 1);
    },
    onScrollTo: (_anchor, section) => {
      const heading = section?.querySelector<HTMLElement>('.document-overlay-section__title');
      if (heading) {
        if (flashTimeout !== undefined) {
          window.clearTimeout(flashTimeout);
          flashedHeading?.classList.remove('document-overlay-section__title--flash');
        }
        heading.classList.add('document-overlay-section__title--flash');
        flashedHeading = heading;
        flashTimeout = window.setTimeout(() => {
          heading.classList.remove('document-overlay-section__title--flash');
          if (flashedHeading === heading) flashedHeading = null;
          flashTimeout = undefined;
        }, 1200);
      }
    },
  });

  createEffect(() => {
    const match = activeMatch();
    const state = findState();
    if (!match || state.loading) {
      if (state.loading) lastScrolledMatchKey = '';
      return;
    }
    const key = `${match.unitId}:${String(match.start)}:${String(state.activeIndex)}`;
    if (key === lastScrolledMatchKey) return;
    lastScrolledMatchKey = key;
    const sectionIndex = sectionIndexForAnchor(orderedSections(), match.unitId);
    if (sectionIndex >= mountedSectionCount()) {
      setMountedSectionCount(sectionIndex + 1);
      lastScrolledMatchKey = '';
      return;
    }
    const unitId = match.unitId;
    const start = match.start;
    requestAnimationFrame(() => {
      const paper = globalThis.document.querySelector<HTMLElement>('.document-overlay-paper');
      const mark = paper?.querySelector<HTMLElement>(
        `[data-document-find-unit="${CSS.escape(unitId)}"][data-document-find-start="${String(start)}"]`,
      );
      if (mark) {
        mark.scrollIntoView({ behavior: 'auto', block: 'center' });
        return;
      }
      globalThis.document.getElementById(unitId)?.scrollIntoView({
        behavior: 'auto',
        block: 'center',
      });
    });
  });

  let initialScrollKey: string | undefined;
  createEffect(() => {
    const document = props.document;
    const anchor = props.initialAnchor;
    if (!document) {
      initialScrollKey = undefined;
      return;
    }
    if (mountedSectionCount() === 0) return;
    const key = `${document.id}\n${anchor ?? ''}`;
    if (initialScrollKey === key) return;
    // The route mounts before its asynchronous document arrives. Scroll after the target renders,
    // once per document/anchor; later section batches must not reset the reader's position.
    const frame = requestAnimationFrame(() => {
      const target = anchor ? globalThis.document.getElementById(anchor) : null;
      if (anchor && !target) return;
      initialScrollKey = key;
      if (target) target.scrollIntoView({ behavior: 'instant', block: 'start' });
      else
        globalThis.document
          .querySelector<HTMLElement>('.document-overlay-paper')
          ?.scrollTo({ top: 0, behavior: 'instant' });
    });
    onCleanup(() => cancelAnimationFrame(frame));
  });

  const availableIds = createMemo(
    () => new Set((props.availableDocuments ?? []).map((document) => document.id)),
  );
  const documentLinks = createMemo(() =>
    buildDocumentLinkPhrases(props.availableDocuments ?? [], props.document?.id),
  );
  const fullTextDocumentId = createMemo(() => {
    const document = props.document;
    if (document?.sourceType !== 'clinical_recommendation_summary') return null;
    const readableId = resolveReadableDocumentId(document.id, availableIds());
    return readableId === document.id ? null : readableId;
  });
  const documentLinkMatcher = createMemo(() =>
    props.document ? createDocumentLinkMatcher(documentLinks()) : null,
  );
  const isClinicalSummary = createMemo(
    () => props.document?.sourceType === 'clinical_recommendation_summary',
  );
  const referenceImageResolver = createMemo(() => {
    const document = props.document;
    if (
      !document ||
      (document.sourceType !== 'krasotaimedicina_reference' &&
        document.metadata['sourceKind'] !== 'disease-reference')
    ) {
      return undefined;
    }
    const resolver = getReferenceImageResolver();
    return (documentId: string, source: string) => resolver.resolve(documentId, source);
  });

  const copySectionLink = async (documentId: string, sectionAnchor: string): Promise<void> => {
    const url = buildDocumentSectionLink(documentId, sectionAnchor);
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Скопировано');
    } catch {
      toast.error('Не удалось скопировать ссылку на раздел.');
    }
  };

  const openFullText = async (): Promise<void> => {
    const document = props.document;
    if (!document || fullTextPending()) return;
    setFullTextPending(true);
    setFullTextProgress(null);
    setFullTextError(null);
    try {
      await props.onRequestFullText(document, setFullTextProgress);
    } catch (cause) {
      setFullTextError(
        cause instanceof Error ? cause.message : 'Не удалось загрузить полную рекомендацию.',
      );
    } finally {
      setFullTextPending(false);
      setFullTextProgress(null);
    }
  };
  const fullTextButtonLabel = (): string =>
    formatFullTextDownloadLabel(
      fullTextPending(),
      fullTextProgress(),
      Boolean(fullTextDocumentId()),
    );

  const modulePointerButtonLabel = (): string => {
    if (!props.modulePointerPending) return 'Скачать набор';
    if (props.modulePointerProgress !== null && props.modulePointerProgress !== undefined) {
      return `${Math.min(100, Math.round(props.modulePointerProgress * 100))}%`;
    }
    return 'Загружаем набор…';
  };

  const pageTitle = (): string =>
    props.document
      ? displayDocumentTitle(props.document)
      : (props.pendingTitle ?? props.openError ?? 'Документ');

  return (
    <DocumentReaderChromeShell
      ariaLabel={pageTitle()}
      class="document-page document-overlay page-surface page-grain"
      chrome={chrome}
      searchOpen={findOpen}
      trail={props.trail}
      onNavigate={props.onNavigate}
      breadcrumbs={
        <Show when={props.trail}>
          {(currentTrail) => (
            <DocumentCrumbs trail={currentTrail()} onNavigate={props.onNavigate} />
          )}
        </Show>
      }
      headerSearchSlot={
        <Show when={props.document}>
          <DocumentFindBar
            units={findUnits}
            disabled={!findSearchable()}
            onOpenChange={setFindOpen}
            onResult={(next) => {
              setFindState((current) => {
                if (
                  !next.query.trim() &&
                  !current.query.trim() &&
                  !next.loading &&
                  !current.loading &&
                  next.matches.length === 0 &&
                  current.matches.length === 0
                ) {
                  return current;
                }
                return next;
              });
            }}
          />
        </Show>
      }
      printButton={
        <Show when={props.document}>
          {(documentValue) => (
            <div class="document-page__reader-actions">
              <Button
                type="button"
                variant="icon"
                class="document-page__reader-action document-page__print-button"
                aria-label="Распечатать документ"
                title="Распечатать документ"
                onClick={() => {
                  if (!printDocument(documentValue())) {
                    toast.error('Не удалось открыть окно печати.');
                  }
                }}
                icon={
                  <AppGlyph
                    name="printer"
                    class="document-page__reader-action-icon document-page__print-icon"
                  />
                }
              />
            </div>
          )}
        </Show>
      }
      bodyError={
        <Show when={props.openError}>
          {(message) => (
            <div class="document-page__error" role="alert">
              <p>{message()}</p>
            </div>
          )}
        </Show>
      }
      showLayout={Boolean(props.document) && !props.openError}
      outlineEnabled={!props.document || orderedSections().length > 1}
      loadingBody={
        <Show when={!props.document && !props.openError}>
          <div
            class="document-page__loading"
            role="status"
            aria-live="polite"
            aria-label="Загрузка страницы"
          >
            <span class="document-page__loading-spinner" aria-hidden="true" />
          </div>
        </Show>
      }
      outlineSearchSlot={
        <Show when={props.document}>
          <p class="document-overlay-outline-label">Оглавление</p>
        </Show>
      }
      outlineNav={
        <For each={orderedSections()}>
          {(section, index) => {
            const headingTag = documentSectionHeadingTag(section.depth);
            return (
              <button
                type="button"
                data-section-anchor={section.anchor}
                class={`document-overlay-outline-section-button document-overlay-outline-section-button--${headingTag}`}
                classList={{
                  'document-overlay-outline-section-button--active':
                    chrome.activeAnchor() === section.anchor,
                }}
                aria-current={chrome.activeAnchor() === section.anchor ? 'location' : undefined}
                onClick={() => chrome.scrollTo(section.anchor)}
              >
                <span class="document-overlay-outline-section-number">
                  {String(index() + 1).padStart(2, '0')}
                </span>
                <span class="document-overlay-outline-section-button__label">{section.title}</span>
              </button>
            );
          }}
        </For>
      }
      outlineFooter={
        <Show when={props.document}>
          {(documentValue) => (
            <details class="doctor-technical-details">
              <summary>Сведения об источнике</summary>
              <dl>
                <div>
                  <dt>Редакция</dt>
                  <dd>{documentValue().versionLabel}</dd>
                </div>
                <div>
                  <dt>Статус</dt>
                  <dd>{statusLabel(documentValue().status)}</dd>
                </div>
                <div>
                  <dt>Тип</dt>
                  <dd>{documentValue().sourceType.replaceAll('_', ' ')}</dd>
                </div>
              </dl>
            </details>
          )}
        </Show>
      }
      content={
        <article ref={chrome.setPaper} class="document-overlay-paper">
          <Show when={props.document}>
            {(documentValue) => (
              <>
                <Show when={sourceTypeReaderLabel(documentValue().sourceType)}>
                  {(label) => <p class="document-overlay-paper__source-label">{label()}</p>}
                </Show>
                <h1
                  class="document-overlay-paper__title"
                  classList={{
                    'document-overlay-paper__title--pointer': Boolean(props.modulePointer),
                  }}
                >
                  <QueryHighlightedText
                    text={displayDocumentTitle(documentValue())}
                    query={findState().query}
                    exact={findState().mode === 'exact'}
                    fuzzy={findState().mode === 'similar'}
                    ranges={rangesForFindUnit(
                      rangesByUnit(),
                      documentValue().id,
                      findState().query,
                    )}
                    unitId={documentValue().id}
                    activeStart={
                      activeMatch()?.unitId === documentValue().id
                        ? activeMatch()?.start
                        : undefined
                    }
                    matchClass="document-overlay-match"
                  />
                </h1>
                <header class="document-overlay-paper__header">
                  <Show when={displayDocumentSubtitle(documentValue())}>
                    {(subtitle) => <p class="document-overlay-lead">{subtitle()}</p>}
                  </Show>
                  <Show when={fullTextError()}>
                    {(message) => (
                      <p class="document-overlay-full-text-error" role="alert">
                        {message()}
                      </p>
                    )}
                  </Show>
                  <Show when={isClinicalSummary() && !fullTextDocumentId()}>
                    <p class="document-overlay-summary-note">
                      Это краткая выжимка. Полная рекомендация загрузится и откроется здесь.
                    </p>
                  </Show>
                  <Show when={props.modulePointer}>
                    {(resolution) => (
                      <section
                        class="document-module-pointer"
                        aria-labelledby="document-module-pointer-title"
                      >
                        <p class="document-module-pointer__eyebrow">Дополнительный набор</p>
                        <h2
                          id="document-module-pointer-title"
                          class="document-module-pointer__title"
                        >
                          {resolution().state === 'unavailable'
                            ? 'Полный документ пока недоступен'
                            : resolution().state === 'installed'
                              ? 'Подключение полного документа'
                              : 'Полный документ доступен после загрузки'}
                        </h2>
                        <Show when={resolution().module}>
                          {(module) => (
                            <p class="document-module-pointer__details">
                              {module().title} · {formatModuleBytes(module().sizes.downloadBytes)}
                            </p>
                          )}
                        </Show>
                        <Show when={resolution().message}>
                          {(message) => (
                            <p class="document-module-pointer__message" role="status">
                              {message()}
                            </p>
                          )}
                        </Show>
                        <Show when={props.modulePointerInstallError}>
                          {(message) => (
                            <p class="document-module-pointer__error" role="alert">
                              {message()}
                            </p>
                          )}
                        </Show>
                        <Show
                          when={
                            resolution().state === 'available' &&
                            Boolean(props.onInstallModulePointer)
                          }
                        >
                          <Button
                            type="button"
                            variant="primary"
                            class="document-module-pointer__action"
                            disabled={props.modulePointerPending}
                            onClick={() => void props.onInstallModulePointer?.()}
                            icon={
                              <AppGlyph
                                name={props.modulePointerPending ? 'refresh' : 'download'}
                                class="document-module-pointer__action-icon"
                              />
                            }
                          >
                            {modulePointerButtonLabel()}
                          </Button>
                        </Show>
                      </section>
                    )}
                  </Show>
                  <div class="document-overlay-paper__actions">
                    <Show when={isClinicalSummary()}>
                      <Button
                        type="button"
                        class="document-overlay-full-text-inline"
                        variant="primary"
                        disabled={fullTextPending()}
                        aria-label={fullTextButtonLabel()}
                        onClick={() => void openFullText()}
                        icon={
                          <AppGlyph
                            name={fullTextPending() ? 'refresh' : 'download'}
                            class={`document-overlay-action-button__icon${fullTextPending() ? ' document-overlay-action-button__icon--spin' : ''}`}
                          />
                        }
                      >
                        {fullTextButtonLabel()}
                      </Button>
                    </Show>
                    <Show when={documentValue().sourceType === 'medical_reference'}>
                      <Button
                        type="button"
                        class="document-overlay-action-button"
                        aria-label="Поделиться памяткой"
                        onClick={() => {
                          shareDocument(documentValue())
                            .then((mode) => {
                              toast.success(
                                mode === 'shared'
                                  ? 'Памятка передана.'
                                  : 'Памятка скопирована в буфер обмена.',
                              );
                            })
                            .catch(() => toast.error('Не удалось поделиться памяткой.'));
                        }}
                        icon={
                          <AppGlyph name="share" class="document-overlay-action-button__icon" />
                        }
                      >
                        Поделиться
                      </Button>
                    </Show>
                  </div>
                </header>

                <Show when={props.medicationProduct}>
                  {(product) => (
                    <MedicationProductPanel
                      product={product()}
                      currentDocumentId={documentValue().id}
                    />
                  )}
                </Show>

                <Show when={(props.clinicalMedicationLinks?.length ?? 0) > 0}>
                  <ClinicalMedicationLinksPanel links={props.clinicalMedicationLinks ?? []} />
                </Show>

                <Show when={(props.supplementalPanels?.length ?? 0) > 0}>
                  <section
                    class="document-allmed-supplements"
                    aria-labelledby="document-allmed-supplements-title"
                  >
                    <h2
                      id="document-allmed-supplements-title"
                      class="document-allmed-supplements__title"
                    >
                      Справочные материалы Allmed
                    </h2>
                    <div class="document-allmed-supplements__list">
                      <For each={props.supplementalPanels ?? []}>
                        {(supplement) => <AllmedSupplementPanel supplement={supplement} />}
                      </For>
                    </div>
                  </section>
                </Show>

                <Show
                  when={
                    documentValue().sourceType === 'core_catalog_pointer' &&
                    documentValue().metadata['sourceKind'] === 'disease-reference'
                  }
                >
                  <ReferencePointerImage
                    documentId={
                      typeof documentValue().metadata['sourceDocumentId'] === 'string'
                        ? (documentValue().metadata['sourceDocumentId'] as string)
                        : documentValue().id
                    }
                  />
                </Show>

                <For each={visibleSectionTree()}>
                  {(node) => {
                    const renderSection = (treeNode: typeof node): JSX.Element => {
                      const section = treeNode.section;
                      const path = () => section.sectionPath.join(' / ');
                      const state = () => findState();
                      const currentMatch = () => activeMatch();
                      const headingTag = documentSectionHeadingTag(section.depth);
                      return (
                        <section
                          class="document-overlay-section"
                          classList={{
                            'document-overlay-section--active':
                              chrome.activeAnchor() === section.anchor,
                          }}
                          id={section.anchor}
                        >
                          <Show when={normalize(path()) !== normalize(section.title)}>
                            <p class="document-overlay-path">{path()}</p>
                          </Show>
                          <Dynamic
                            component={headingTag}
                            class={`document-overlay-section__title document-overlay-section__title--${headingTag} document-overlay-section__title--copy`}
                            classList={{
                              'document-overlay-section__title--active':
                                chrome.activeAnchor() === section.anchor,
                            }}
                            tabIndex={0}
                            role="button"
                            aria-label={`Скопировать ссылку на раздел «${section.title}»`}
                            onClick={() => void copySectionLink(documentValue().id, section.anchor)}
                            onKeyDown={(event: KeyboardEvent) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                void copySectionLink(documentValue().id, section.anchor);
                              }
                            }}
                          >
                            <QueryHighlightedText
                              text={section.title}
                              query={state().query}
                              exact={state().mode === 'exact'}
                              fuzzy={state().mode === 'similar'}
                              ranges={rangesForFindUnit(
                                rangesByUnit(),
                                section.anchor,
                                state().query,
                              )}
                              unitId={section.anchor}
                              activeStart={
                                currentMatch()?.unitId === section.anchor
                                  ? currentMatch()?.start
                                  : undefined
                              }
                              matchClass="document-overlay-match"
                            />
                          </Dynamic>
                          <For each={resolveDocumentChunkItems(section.chunks)}>
                            {(item) => {
                              const activeStart = () =>
                                currentMatch()?.unitId === item.chunk.anchor
                                  ? currentMatch()?.start
                                  : undefined;
                              return (
                                <Show
                                  when={item.kind === 'rich' ? item.block : undefined}
                                  fallback={
                                    <div
                                      id={item.chunk.anchor}
                                      class="document-text-chunk"
                                      classList={{
                                        'document-initial-anchor':
                                          props.initialAnchor === item.chunk.anchor,
                                      }}
                                    >
                                      <DocumentText
                                        text={item.chunk.originalText}
                                        query={state().query}
                                        exactQuery={state().mode === 'exact'}
                                        fuzzyQuery={state().mode === 'similar'}
                                        ranges={rangesForFindUnit(
                                          rangesByUnit(),
                                          item.chunk.anchor,
                                          state().query,
                                        )}
                                        unitId={item.chunk.anchor}
                                        activeStart={activeStart()}
                                        highlightClass="document-overlay-match"
                                        paragraphClass="document-overlay-section__paragraph"
                                        // biome-ignore lint/complexity/useLiteralKeys: source spans are optional runtime metadata.
                                        sourceSpans={item.chunk.metadata?.['sourceSpans']}
                                        documentId={documentValue().id}
                                        resolveImage={referenceImageResolver()}
                                        core={props.core}
                                        documentLinkMatcher={documentLinkMatcher() ?? undefined}
                                        onDocumentLink={(documentId) => {
                                          openDocumentOverlay(documentId, null, {
                                            preferSummary: true,
                                          });
                                        }}
                                      />
                                    </div>
                                  }
                                >
                                  {(block) => (
                                    <div
                                      id={item.chunk.anchor}
                                      classList={{
                                        'document-rich-block': true,
                                        'document-initial-anchor':
                                          props.initialAnchor === item.chunk.anchor,
                                      }}
                                    >
                                      <DocumentRichBlock
                                        block={block()}
                                        highlight={{
                                          query: state().query,
                                          exact: state().mode === 'exact',
                                          fuzzy: state().mode === 'similar',
                                          ranges: rangesForFindUnit(
                                            rangesByUnit(),
                                            item.chunk.anchor,
                                            state().query,
                                          ),
                                          unitId: item.chunk.anchor,
                                          activeStart: activeStart(),
                                        }}
                                      />
                                    </div>
                                  )}
                                </Show>
                              );
                            }}
                          </For>
                          <For each={treeNode.children}>{(child) => renderSection(child)}</For>
                        </section>
                      );
                    };
                    return renderSection(node);
                  }}
                </For>
                <Show when={sectionsPending()}>
                  <div
                    class="document-overlay-paper__pending"
                    role="status"
                    aria-label="Загружаем остальные разделы"
                  >
                    <span class="document-overlay-spinner" aria-hidden="true" />
                  </div>
                </Show>
              </>
            )}
          </Show>
        </article>
      }
    />
  );
}
