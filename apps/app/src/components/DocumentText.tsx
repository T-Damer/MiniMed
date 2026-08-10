import { For, type JSX } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { QueryHighlightedText } from '@/components/HighlightedText';
import { stripKnownHtmlMarkup } from '@/components/html-markup';
import { openAssessment } from '@/features/assessments/assessment-links';
import { openCalculator } from '@/features/calculators/calculator-links';
import {
  type DocumentLinkPhrase,
  type DocumentTextBlock,
  parseDocumentText,
  segmentTextWithMedicationLinks,
} from '@/features/library/document-medication-links';
import { segmentTextWithToolLinks } from '@/features/tool-links/document-tool-links';

function LinkedPlainText(props: {
  readonly text: string;
  readonly query?: string | undefined;
}): JSX.Element {
  return (
    <For each={segmentTextWithToolLinks(props.text)}>
      {(segment) => {
        if (segment.kind === 'text') {
          return (
            <QueryHighlightedText
              text={segment.value.replace(/^#/u, '')}
              query={props.query ?? ''}
            />
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
            <AppGlyph name={assessment ? 'list-checks' : 'calculator'} />
            <span>
              <QueryHighlightedText text={segment.value} query={props.query ?? ''} />
            </span>
          </button>
        );
      }}
    </For>
  );
}

function InlineDocumentText(props: {
  readonly documentLinks?: readonly DocumentLinkPhrase[] | undefined;
  readonly onDocumentLink?: ((documentId: string) => void) | undefined;
  readonly text: string;
  readonly onReference?: ((reference: string) => void) | undefined;
  readonly query?: string | undefined;
}): JSX.Element {
  const parts = () => props.text.split(/(\*\*|#[\p{L}\p{M}-]+|\([A-ZА-Я0-9]{4,8}\))/gu);
  return (
    <For each={parts()}>
      {(part) => {
        if (part === '**') return null;
        const hashtag = /^#([\p{L}\p{M}-]+)$/u.exec(part)?.[1];
        const code = /^\(([A-ZА-Я0-9]{4,8})\)$/u.exec(part)?.[1];
        const reference = hashtag ?? code;
        return reference && props.onReference ? (
          <button
            type="button"
            class="document-inline-reference"
            onClick={() => props.onReference?.(reference)}
          >
            <QueryHighlightedText text={hashtag ?? part} query={props.query ?? ''} />
          </button>
        ) : (
          <For each={segmentTextWithMedicationLinks(part, props.documentLinks ?? [])}>
            {(segment) =>
              segment.kind === 'link' && props.onDocumentLink ? (
                <button
                  type="button"
                  class="document-inline-link"
                  onClick={() => props.onDocumentLink?.(segment.documentId)}
                >
                  <QueryHighlightedText text={segment.value} query={props.query ?? ''} />
                </button>
              ) : (
                <LinkedPlainText text={segment.value} query={props.query} />
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

export function DocumentText(props: {
  readonly documentLinks?: readonly DocumentLinkPhrase[] | undefined;
  readonly onDocumentLink?: ((documentId: string) => void) | undefined;
  readonly sourceSpans?: unknown;
  readonly paragraphClass?: string | undefined;
  readonly text: string;
  readonly onReference?: ((reference: string) => void) | undefined;
  readonly query?: string | undefined;
}): JSX.Element {
  const groups = () =>
    groupBlocks(parseDocumentText(stripKnownHtmlMarkup(props.text), props.sourceSpans));
  const inline = (text: string): JSX.Element => (
    <InlineDocumentText
      text={text}
      documentLinks={props.documentLinks}
      onDocumentLink={props.onDocumentLink}
      onReference={props.onReference}
      query={props.query}
    />
  );

  return (
    <For each={groups()}>
      {(group) => {
        if (group.kind === 'bullet') {
          return (
            <ul class="document-text-list">
              <For each={group.items}>
                {(item) => <li class="document-text-list__item">{inline(item.text)}</li>}
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
                {(item) => <li class="document-text-list__item">{inline(item.text)}</li>}
              </For>
            </ol>
          );
        }
        return <p class={props.paragraphClass}>{inline(group.items[0]?.text ?? '')}</p>;
      }}
    </For>
  );
}
