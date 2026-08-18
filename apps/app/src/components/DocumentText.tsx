import type { TextRange } from '@localmed/contracts';
import { createMemo, For, type JSX } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { QueryHighlightedText } from '@/components/HighlightedText';
import { stripKnownHtmlMarkup } from '@/components/html-markup';
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
import { segmentTextWithToolLinks } from '@/features/tool-links/document-tool-links';

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
              assessment ? openAssessment(segment.slug) : openCalculator(segment.slug)
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
                <button
                  type="button"
                  class="document-inline-link"
                  onClick={() => props.onDocumentLink?.(segment.documentId)}
                >
                  <AppGlyph
                    name={glyphForDocumentLinkKind(segment.linkKind)}
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
                    rangeOffset={(props.rangeOffset ?? 0) + part.offset + segment.offset}
                  />
                </button>
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
  | { readonly kind: 'paragraph'; readonly items: readonly DocumentTextBlock[] }
  | { readonly kind: 'bullet' | 'ordered'; readonly items: readonly DocumentTextBlock[] };

type DocumentTextBlockWithOffset = DocumentTextBlock & { readonly offset: number };
type DocumentTextGroupWithOffsets =
  | { readonly kind: 'paragraph'; readonly items: readonly DocumentTextBlockWithOffset[] }
  | { readonly kind: 'bullet' | 'ordered'; readonly items: readonly DocumentTextBlockWithOffset[] };

function groupBlocks(blocks: readonly DocumentTextBlock[]): readonly DocumentTextGroup[] {
  const groups: DocumentTextGroup[] = [];
  for (const block of blocks) {
    const previous = groups.at(-1);
    if (block.kind !== 'paragraph' && previous?.kind === block.kind) {
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
      const text = item.text.replaceAll('**', '');
      const result = { ...item, text, offset };
      offset += text.length + 1;
      return result;
    }),
  }));
}

export function documentTextSearchText(text: string, sourceSpans?: unknown): string {
  return parseDocumentText(stripKnownHtmlMarkup(text), sourceSpans)
    .map((block) => block.text.replaceAll('**', ''))
    .join('\n');
}

export function DocumentText(props: {
  readonly documentLinkMatcher?: DocumentLinkMatcher | undefined;
  readonly documentLinks?: readonly DocumentLinkPhrase[] | undefined;
  readonly onDocumentLink?: ((documentId: string) => void) | undefined;
  readonly sourceSpans?: unknown;
  readonly paragraphClass?: string | undefined;
  readonly text: string;
  readonly onReference?: ((reference: string) => void) | undefined;
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
        if (group.kind === 'bullet') {
          return (
            <ul class="document-text-list">
              <For each={group.items}>
                {(item) => (
                  <li class="document-text-list__item">{inline(item.text, item.offset)}</li>
                )}
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
                {(item) => (
                  <li class="document-text-list__item">{inline(item.text, item.offset)}</li>
                )}
              </For>
            </ol>
          );
        }
        const item = group.items[0];
        return <p class={props.paragraphClass}>{inline(item?.text ?? '', item?.offset ?? 0)}</p>;
      }}
    </For>
  );
}
