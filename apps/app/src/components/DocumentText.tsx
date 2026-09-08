import { Popover } from '@kobalte/core/popover';
import type { MedicalCore, TextRange } from '@localmed/contracts';
import { createEffect, createMemo, createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { QueryHighlightedText } from '@/components/HighlightedText';
import { stripKnownHtmlMarkup } from '@/components/html-markup';
import { useInlinePreviewBounds } from '@/components/useInlinePreviewBounds';
import { openAssessment } from '@/features/assessments/assessment-links';
import { openCalculator } from '@/features/calculators/calculator-links';
import {
  createDocumentLinkMatcher,
  type DocumentInlineLinkKind,
  type DocumentLinkMatcher,
  type DocumentLinkPhrase,
  type DocumentTextBlock,
  type LinkedTextSegment,
  parseDocumentText,
} from '@/features/library/document-medication-links';
import { DocumentRichBlock } from '@/features/library/document-rich-block';
import {
  type MedicationPreviewExcerpt,
  medicationPreviewExcerpts,
} from '@/features/library/medication-link-preview';
import type { ResolvedReferenceImage } from '@/features/library/reference-image-assets';
import { segmentTextWithToolLinks } from '@/features/tool-links/document-tool-links';
import { openDocumentOverlay } from '@/state/document-navigation';

const EXTERNAL_URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gu;

type PlainTextSegment =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'url'; readonly value: string };

type TextSlice<T extends { readonly value: string }> = T & { readonly offset: number };

function withTextOffsets<T extends { readonly value: string }>(
  segments: readonly T[],
): readonly TextSlice<T>[] {
  let offset = 0;
  return segments.map((segment) => {
    const result = { ...segment, offset };
    offset += segment.value.length;
    return result;
  });
}

function segmentTextWithExternalUrls(text: string): readonly PlainTextSegment[] {
  const segments: PlainTextSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(EXTERNAL_URL_PATTERN)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      segments.push({ kind: 'text', value: text.slice(lastIndex, start) });
    }
    segments.push({ kind: 'url', value: match[0] });
    lastIndex = start + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ kind: 'text', value: text.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ kind: 'text', value: text }];
}

function glyphForDocumentLinkKind(kind: DocumentInlineLinkKind): AppGlyphName {
  switch (kind) {
    case 'medication':
      return 'pill';
    case 'recommendation':
      return 'book-open';
    case 'document':
      return 'file-text';
  }
}

function HighlightedLabel(props: {
  readonly text: string;
  readonly query?: string | undefined;
  readonly exactQuery?: boolean | undefined;
  readonly fuzzyQuery?: boolean | undefined;
  readonly highlightClass?: string | undefined;
  readonly ranges?: readonly TextRange[] | undefined;
  readonly unitId?: string | undefined;
  readonly activeStart?: number | undefined;
  readonly rangeOffset?: number | undefined;
}): JSX.Element {
  return (
    <span class="document-inline-link__label">
      <QueryHighlightedText
        text={props.text}
        query={props.query ?? ''}
        exact={props.exactQuery}
        fuzzy={props.fuzzyQuery}
        matchClass={props.highlightClass}
        ranges={props.ranges}
        unitId={props.unitId}
        activeStart={props.activeStart}
        rangeOffset={props.rangeOffset}
      />
    </span>
  );
}

type LinkedDocumentSegment = Extract<LinkedTextSegment, { readonly kind: 'link' }>;

function InlineDocumentLink(props: {
  readonly segment: LinkedDocumentSegment;
  readonly onOpen: (documentId: string) => void;
  readonly core?: MedicalCore | undefined;
  readonly query?: string | undefined;
  readonly exactQuery?: boolean | undefined;
  readonly fuzzyQuery?: boolean | undefined;
  readonly highlightClass?: string | undefined;
  readonly ranges?: readonly TextRange[] | undefined;
  readonly unitId?: string | undefined;
  readonly activeStart?: number | undefined;
  readonly rangeOffset: number;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [previewCard, setPreviewCard] = createSignal<HTMLElement>();
  const [choice, setChoice] = createSignal('');
  const manyChoices = () => (props.segment.alternatives?.length ?? 0) > 2;
  const selectedAlternative = () =>
    props.segment.alternatives?.find((_item, index) => String(index) === choice());
  const primarySource = () =>
    selectedAlternative()?.preview?.source ?? props.segment.preview?.source;
  useInlinePreviewBounds(open, previewCard, () => setOpen(false));

  const [excerpts, setExcerpts] = createSignal<readonly MedicationPreviewExcerpt[]>();
  const [previewError, setPreviewError] = createSignal<string>();
  const [sourceLabel, setSourceLabel] = createSignal<string>();
  const ambiguous = () => (props.segment.alternatives?.length ?? 0) > 1;
  const canPreview = () =>
    Boolean(
      ambiguous() ||
        props.segment.preview ||
        (props.segment.linkKind === 'medication' && props.core),
    );
  const activate = async () => {
    if (!canPreview()) {
      props.onOpen(props.segment.documentId);
      return;
    }
    setOpen((value) => !value);
    if (!open() || ambiguous() || props.segment.preview || excerpts() || !props.core) return;
    setPreviewError();
    const result = await props.core.getDocument(props.segment.documentId);
    if (!result.ok) {
      setPreviewError(result.error.message);
      return;
    }
    setSourceLabel(`${result.value.title} · ${result.value.versionLabel}`);
    setExcerpts(medicationPreviewExcerpts(result.value, props.segment.value));
  };

  return (
    <Popover
      open={open()}
      onOpenChange={setOpen}
      placement="bottom-start"
      gutter={7}
      flip
      slide
      fitViewport
      overflowPadding={8}
    >
      <Popover.Anchor as="span" class="document-inline-preview">
        <button
          type="button"
          class="document-inline-link"
          aria-expanded={canPreview() ? open() : undefined}
          aria-haspopup={canPreview() ? 'dialog' : undefined}
          onClick={activate}
        >
          <AppGlyph
            name={glyphForDocumentLinkKind(ambiguous() ? 'document' : props.segment.linkKind)}
            class="document-inline-link__icon"
          />
          <HighlightedLabel
            text={props.segment.value}
            query={props.query}
            exactQuery={props.exactQuery}
            fuzzyQuery={props.fuzzyQuery}
            highlightClass={props.highlightClass}
            ranges={props.ranges}
            unitId={props.unitId}
            activeStart={props.activeStart}
            rangeOffset={props.rangeOffset}
          />
        </button>
      </Popover.Anchor>
      <Show when={canPreview()}>
        <Popover.Portal>
          <Popover.Content
            ref={setPreviewCard}
            class="document-inline-preview__card"
            aria-label={
              ambiguous()
                ? `${props.segment.value}: значения`
                : (props.segment.preview?.title ?? props.segment.value)
            }
            onOpenAutoFocus={(event) => {
              if (!ambiguous()) event.preventDefault();
            }}
          >
            <div class="document-inline-preview__header">
              <strong class="document-inline-preview__title">
                {ambiguous()
                  ? `${props.segment.value}: выберите значение`
                  : (props.segment.preview?.title ?? props.segment.value)}
              </strong>
              <Show when={manyChoices()}>
                <select
                  class="document-inline-preview__choice"
                  aria-label="Выберите документ"
                  value={choice()}
                  onChange={(event) => setChoice(event.currentTarget.value)}
                >
                  <option class="document-inline-preview__choice-option" value="">
                    Выберите документ…
                  </option>
                  <For each={props.segment.alternatives}>
                    {(alternative, index) => (
                      <option
                        class="document-inline-preview__choice-option"
                        value={String(index())}
                      >
                        {alternative.title}
                      </option>
                    )}
                  </For>
                </select>
              </Show>
              <Show when={ambiguous() && !manyChoices()}>
                <For each={props.segment.alternatives}>
                  {(alternative) => (
                    <button
                      type="button"
                      class="document-inline-preview__open"
                      title={alternative.preview?.source?.label ?? alternative.title}
                      aria-label={`Открыть: ${alternative.title}`}
                      onClick={() => {
                        setOpen(false);
                        const source = alternative.preview?.source;
                        if (source)
                          openDocumentOverlay(source.documentId, source.anchor ?? null, {
                            preferSummary: true,
                          });
                        else props.onOpen(alternative.documentId);
                      }}
                    >
                      Открыть
                      <AppGlyph
                        name="arrow-square-up-right"
                        class="document-inline-preview__open-icon"
                      />
                    </button>
                  )}
                </For>
              </Show>
              <Show when={!ambiguous() || selectedAlternative()}>
                <button
                  type="button"
                  class="document-inline-preview__open"
                  title={primarySource()?.label}
                  onClick={() => {
                    setOpen(false);
                    const source = primarySource();
                    if (source)
                      openDocumentOverlay(source.documentId, source.anchor ?? null, {
                        preferSummary: true,
                      });
                    else
                      props.onOpen(selectedAlternative()?.documentId ?? props.segment.documentId);
                  }}
                >
                  Открыть
                  <AppGlyph
                    name="arrow-square-up-right"
                    class="document-inline-preview__open-icon"
                  />
                </button>
              </Show>
            </div>
            <Show when={ambiguous()}>
              <For
                each={
                  manyChoices()
                    ? props.segment.alternatives?.filter(
                        (_item, index) => String(index) === choice(),
                      )
                    : props.segment.alternatives
                }
              >
                {(alternative) => (
                  <div class="document-inline-preview__meaning">
                    <button
                      type="button"
                      class="document-inline-preview__meaning-link"
                      onClick={() => {
                        setOpen(false);
                        props.onOpen(alternative.documentId);
                      }}
                    >
                      {alternative.title}
                    </button>
                    <Show when={alternative.preview}>
                      {(preview) => (
                        <>
                          <p class="document-inline-preview__definition document-inline-preview__definition--choice">
                            {preview().definition}
                          </p>
                        </>
                      )}
                    </Show>
                  </div>
                )}
              </For>
            </Show>
            <Show when={!ambiguous() && props.segment.preview}>
              {(preview) => (
                <p class="document-inline-preview__definition">{preview().definition}</p>
              )}
            </Show>
            <Show when={!ambiguous() && !props.segment.preview}>
              <Show when={previewError()}>
                {(error) => (
                  <p class="document-inline-preview__definition" role="alert">
                    {error()}
                  </p>
                )}
              </Show>
              <Show when={!excerpts() && !previewError()}>
                <p class="document-inline-preview__definition" role="status">
                  Открываем локальные данные…
                </p>
              </Show>
              <For each={excerpts()}>
                {(excerpt) => (
                  <div class="document-inline-preview__excerpt">
                    <p class="document-inline-preview__definition">{excerpt.text}</p>
                    <Show when={excerpt.anchor}>
                      {(anchor) => (
                        <button
                          type="button"
                          class="document-inline-preview__source"
                          onClick={() => {
                            setOpen(false);
                            openDocumentOverlay(props.segment.documentId, anchor());
                          }}
                        >
                          Открыть фрагмент источника
                        </button>
                      )}
                    </Show>
                  </div>
                )}
              </For>
              <Show when={excerpts()?.length === 0}>
                <p class="document-inline-preview__definition">
                  В локальных данных нет сведений о форме и концентрации.
                </p>
              </Show>
              <p class="document-inline-preview__source-label">
                Источник: {sourceLabel() ?? props.segment.value}. Сведения о препарате; не схема
                дозирования.
              </p>
            </Show>
          </Popover.Content>
        </Popover.Portal>
      </Show>
    </Popover>
  );
}

function LinkedPlainText(props: {
  readonly text: string;
  readonly query?: string | undefined;
  readonly exactQuery?: boolean | undefined;
  readonly fuzzyQuery?: boolean | undefined;
  readonly highlightClass?: string | undefined;
  readonly ranges?: readonly TextRange[] | undefined;
  readonly unitId?: string | undefined;
  readonly activeStart?: number | undefined;
  readonly rangeOffset?: number | undefined;
}): JSX.Element {
  return (
    <For each={withTextOffsets(segmentTextWithToolLinks(props.text))}>
      {(segment) => {
        if (segment.kind === 'text') {
          return (
            <For each={withTextOffsets(segmentTextWithExternalUrls(segment.value))}>
              {(urlSegment) =>
                urlSegment.kind === 'url' ? (
                  <a
                    class="document-inline-link"
                    href={urlSegment.value}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <AppGlyph name="arrow-square-up-right" class="document-inline-link__icon" />
                    <HighlightedLabel
                      text={urlSegment.value}
                      query={props.query}
                      exactQuery={props.exactQuery}
                      fuzzyQuery={props.fuzzyQuery}
                      highlightClass={props.highlightClass}
                      ranges={props.ranges}
                      unitId={props.unitId}
                      activeStart={props.activeStart}
                      rangeOffset={(props.rangeOffset ?? 0) + segment.offset + urlSegment.offset}
                    />
                  </a>
                ) : (
                  <QueryHighlightedText
                    text={urlSegment.value.replace(/^#/u, '')}
                    query={props.query ?? ''}
                    exact={props.exactQuery}
                    fuzzy={props.fuzzyQuery}
                    matchClass={props.highlightClass}
                    ranges={props.ranges}
                    unitId={props.unitId}
                    activeStart={props.activeStart}
                    rangeOffset={
                      (props.rangeOffset ?? 0) +
                      segment.offset +
                      urlSegment.offset +
                      (urlSegment.value.startsWith('#') ? 1 : 0)
                    }
                  />
                )
              }
            </For>
          );
        }
        const assessment = segment.kind === 'assessment';
        return (
          <button
            type="button"
            class={`document-inline-link document-inline-tool-link ${segment.kind}-inline-link`}
            onClick={() =>
              assessment
                ? openAssessment(segment.slug, { preferWindow: true })
                : openCalculator(segment.slug, { preferWindow: true })
            }
          >
            <AppGlyph
              name={assessment ? 'list-checks' : 'calculator'}
              class="document-inline-link__icon"
            />
            <HighlightedLabel
              text={segment.value}
              query={props.query}
              exactQuery={props.exactQuery}
              fuzzyQuery={props.fuzzyQuery}
              highlightClass={props.highlightClass}
              ranges={props.ranges}
              unitId={props.unitId}
              activeStart={props.activeStart}
              rangeOffset={(props.rangeOffset ?? 0) + segment.offset}
            />
          </button>
        );
      }}
    </For>
  );
}

function InlineDocumentText(props: {
  readonly segmentDocumentLinks?: ((text: string) => readonly LinkedTextSegment[]) | undefined;
  readonly onDocumentLink?: ((documentId: string) => void) | undefined;
  readonly core?: MedicalCore | undefined;
  readonly text: string;
  readonly onReference?: ((reference: string) => void) | undefined;
  readonly query?: string | undefined;
  readonly exactQuery?: boolean | undefined;
  readonly fuzzyQuery?: boolean | undefined;
  readonly highlightClass?: string | undefined;
  readonly ranges?: readonly TextRange[] | undefined;
  readonly unitId?: string | undefined;
  readonly activeStart?: number | undefined;
  readonly rangeOffset?: number | undefined;
}): JSX.Element {
  const parts = () => {
    let offset = 0;
    return props.text.split(/(\*\*|#[\p{L}\p{M}-]+|\([A-ZА-Я0-9]{4,8}\))/gu).map((value) => {
      const part = { value, offset };
      offset += value.length;
      return part;
    });
  };
  return (
    <For each={parts()}>
      {(part) => {
        if (part.value === '**') return null;
        const hashtag = /^#([\p{L}\p{M}-]+)$/u.exec(part.value)?.[1];
        const code = /^\(([A-ZА-Я0-9]{4,8})\)$/u.exec(part.value)?.[1];
        const reference = hashtag ?? code;
        return reference && props.onReference ? (
          <button
            type="button"
            class="document-inline-link document-inline-reference"
            onClick={() => props.onReference?.(reference)}
          >
            <AppGlyph name="notes" class="document-inline-link__icon" />
            <HighlightedLabel
              text={hashtag ?? part.value}
              query={props.query}
              exactQuery={props.exactQuery}
              fuzzyQuery={props.fuzzyQuery}
              highlightClass={props.highlightClass}
              ranges={props.ranges}
              unitId={props.unitId}
              activeStart={props.activeStart}
              rangeOffset={(props.rangeOffset ?? 0) + part.offset + (hashtag ? 1 : 0)}
            />
          </button>
        ) : (
          <For
            each={withTextOffsets(
              props.segmentDocumentLinks?.(part.value) ?? [
                { kind: 'text' as const, value: part.value },
              ],
            )}
          >
            {(segment) =>
              segment.kind === 'link' && props.onDocumentLink ? (
                <InlineDocumentLink
                  segment={segment}
                  onOpen={props.onDocumentLink}
                  core={props.core}
                  query={props.query}
                  exactQuery={props.exactQuery}
                  fuzzyQuery={props.fuzzyQuery}
                  highlightClass={props.highlightClass}
                  ranges={props.ranges}
                  unitId={props.unitId}
                  activeStart={props.activeStart}
                  rangeOffset={(props.rangeOffset ?? 0) + part.offset + segment.offset}
                />
              ) : (
                <LinkedPlainText
                  text={segment.value}
                  query={props.query}
                  exactQuery={props.exactQuery}
                  fuzzyQuery={props.fuzzyQuery}
                  highlightClass={props.highlightClass}
                  ranges={props.ranges}
                  unitId={props.unitId}
                  activeStart={props.activeStart}
                  rangeOffset={(props.rangeOffset ?? 0) + part.offset + segment.offset}
                />
              )
            }
          </For>
        );
      }}
    </For>
  );
}

type DocumentTextGroup =
  | { readonly kind: 'table'; readonly items: readonly DocumentTextBlock[] }
  | { readonly kind: 'paragraph'; readonly items: readonly DocumentTextBlock[] }
  | { readonly kind: 'bullet' | 'ordered'; readonly items: readonly DocumentTextBlock[] }
  | { readonly kind: 'image'; readonly items: readonly DocumentTextBlock[] };

type DocumentTextBlockWithOffset = DocumentTextBlock & { readonly offset: number };
type DocumentTextGroupWithOffsets =
  | { readonly kind: 'table'; readonly items: readonly DocumentTextBlockWithOffset[] }
  | { readonly kind: 'paragraph'; readonly items: readonly DocumentTextBlockWithOffset[] }
  | { readonly kind: 'bullet' | 'ordered'; readonly items: readonly DocumentTextBlockWithOffset[] }
  | { readonly kind: 'image'; readonly items: readonly DocumentTextBlockWithOffset[] };

function groupBlocks(blocks: readonly DocumentTextBlock[]): readonly DocumentTextGroup[] {
  const groups: DocumentTextGroup[] = [];
  for (const block of blocks) {
    const previous = groups.at(-1);
    if (block.kind === 'image' || block.kind === 'table') {
      groups.push({ kind: block.kind, items: [block] });
    } else if (block.kind !== 'paragraph' && previous?.kind === block.kind) {
      groups[groups.length - 1] = { ...previous, items: [...previous.items, block] };
    } else {
      groups.push({ kind: block.kind, items: [block] });
    }
  }
  return groups;
}

function addSearchOffsets(
  groups: readonly DocumentTextGroup[],
): readonly DocumentTextGroupWithOffsets[] {
  let offset = 0;
  return groups.map((group) => ({
    ...group,
    items: group.items.map((item) => {
      const text = (item.kind === 'image' ? item.alt : item.text).replaceAll('**', '');
      const result = { ...item, text, offset };
      offset += text.length + 1;
      return result;
    }),
  }));
}

export function documentTextSearchText(text: string, sourceSpans?: unknown): string {
  return parseDocumentText(stripKnownHtmlMarkup(text), sourceSpans)
    .map((block) => (block.kind === 'image' ? block.alt : block.text).replaceAll('**', ''))
    .join('\n');
}

function ReferenceImage(props: {
  readonly documentId?: string | undefined;
  readonly block: Extract<DocumentTextBlock, { readonly kind: 'image' }>;
  readonly resolveImage?:
    | ((documentId: string, source: string) => Promise<ResolvedReferenceImage | null>)
    | undefined;
}): JSX.Element {
  const [image, setImage] = createSignal<ResolvedReferenceImage | null>();
  const [failed, setFailed] = createSignal(false);
  const [pending, setPending] = createSignal(true);
  const [error, setError] = createSignal(false);
  const resolved = () => image();

  createEffect(() => {
    const documentId = props.documentId;
    if (!documentId || !props.resolveImage) return;
    setFailed(false);
    setError(false);
    setPending(true);
    void props
      .resolveImage(documentId, props.block.source)
      .then((value) => {
        setImage(value);
        setPending(false);
      })
      .catch(() => {
        setError(true);
        setPending(false);
      });
  });

  return (
    <Show when={props.resolveImage}>
      <Show
        when={failed() ? undefined : resolved()}
        fallback={
          <p class="document-reference-image__fallback">
            {pending()
              ? 'Загружаем иллюстрацию…'
              : error()
                ? 'Не удалось прочитать локальную иллюстрацию.'
                : 'Иллюстрация недоступна в подключённом наборе.'}
          </p>
        }
      >
        {(value) => (
          <figure class="document-reference-image">
            <img
              class="document-reference-image__image"
              src={value().url}
              alt={value().alt || props.block.alt}
              loading="lazy"
              onError={() => setFailed(true)}
            />
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
          </figure>
        )}
      </Show>
    </Show>
  );
}

export function DocumentText(props: {
  readonly documentLinkMatcher?: DocumentLinkMatcher | undefined;
  readonly documentLinks?: readonly DocumentLinkPhrase[] | undefined;
  readonly onDocumentLink?: ((documentId: string) => void) | undefined;
  readonly core?: MedicalCore | undefined;
  readonly sourceSpans?: unknown;
  readonly paragraphClass?: string | undefined;
  readonly text: string;
  readonly onReference?: ((reference: string) => void) | undefined;
  readonly documentId?: string | undefined;
  readonly resolveImage?:
    | ((documentId: string, source: string) => Promise<ResolvedReferenceImage | null>)
    | undefined;
  readonly query?: string | undefined;
  readonly exactQuery?: boolean | undefined;
  readonly fuzzyQuery?: boolean | undefined;
  readonly highlightClass?: string | undefined;
  readonly ranges?: readonly TextRange[] | undefined;
  readonly unitId?: string | undefined;
  readonly activeStart?: number | undefined;
}): JSX.Element {
  const segmentDocumentLinks = createMemo(
    (): ((text: string) => readonly LinkedTextSegment[]) | undefined => {
      if (props.documentLinkMatcher) {
        return (text: string) =>
          props.documentLinkMatcher?.segment(text) ?? [{ kind: 'text', value: text }];
      }
      const links = props.documentLinks;
      if (!links || links.length === 0) return undefined;
      const matcher = createDocumentLinkMatcher(links);
      return (text: string) => matcher.segment(text);
    },
  );
  const groups = createMemo(() =>
    addSearchOffsets(
      groupBlocks(parseDocumentText(stripKnownHtmlMarkup(props.text), props.sourceSpans)),
    ),
  );
  const inline = (text: string, rangeOffset: number): JSX.Element => (
    <InlineDocumentText
      text={text}
      segmentDocumentLinks={segmentDocumentLinks()}
      onDocumentLink={props.onDocumentLink}
      core={props.core}
      onReference={props.onReference}
      query={props.query}
      exactQuery={props.exactQuery}
      fuzzyQuery={props.fuzzyQuery}
      highlightClass={props.highlightClass}
      ranges={props.ranges}
      unitId={props.unitId}
      activeStart={props.activeStart}
      rangeOffset={rangeOffset}
    />
  );

  return (
    <For each={groups()}>
      {(group) => {
        if (group.kind === 'table') {
          const item = group.items[0];
          return item?.kind === 'table' ? (
            <DocumentRichBlock
              block={item.table}
              highlight={{
                query: props.query,
                exact: props.exactQuery,
                fuzzy: props.fuzzyQuery,
                ranges: props.ranges,
                unitId: props.unitId,
                activeStart: props.activeStart,
                rangeOffset: item.offset,
              }}
            />
          ) : null;
        }
        if (group.kind === 'image') {
          const item = group.items[0];
          return item?.kind === 'image' ? (
            <ReferenceImage
              documentId={props.documentId}
              block={item}
              resolveImage={props.resolveImage}
            />
          ) : null;
        }
        if (group.kind === 'bullet') {
          return (
            <ul class="document-text-list">
              <For each={group.items}>
                {(item) =>
                  item.kind === 'bullet' ? (
                    <li class="document-text-list__item">{inline(item.text, item.offset)}</li>
                  ) : null
                }
              </For>
            </ul>
          );
        }
        if (group.kind === 'ordered') {
          const first = group.items[0];
          return (
            <ol
              class="document-text-list"
              start={first?.kind === 'ordered' ? first.ordinal : undefined}
            >
              <For each={group.items}>
                {(item) =>
                  item.kind === 'ordered' ? (
                    <li class="document-text-list__item">{inline(item.text, item.offset)}</li>
                  ) : null
                }
              </For>
            </ol>
          );
        }
        const item = group.items[0];
        return item?.kind === 'paragraph' ? (
          <p class={props.paragraphClass}>{inline(item.text, item.offset)}</p>
        ) : null;
      }}
    </For>
  );
}
