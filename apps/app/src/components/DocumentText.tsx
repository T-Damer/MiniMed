import { For, type JSX } from 'solid-js';

import { QueryHighlightedText } from '@/components/HighlightedText';
import { parseDocumentText } from '@/features/library/document-medication-links';

function InlineDocumentText(props: {
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
          <QueryHighlightedText text={part.replace(/^#/u, '')} query={props.query ?? ''} />
        );
      }}
    </For>
  );
}

export function DocumentText(props: {
  readonly text: string;
  readonly onReference?: ((reference: string) => void) | undefined;
  readonly query?: string | undefined;
}): JSX.Element {
  const blocks = () => parseDocumentText(props.text);
  const bullets = () => blocks().length > 0 && blocks().every((block) => block.kind === 'bullet');

  return bullets() ? (
    <ul class="document-text-list">
      <For each={blocks()}>
        {(block) => (
          <li>
            <InlineDocumentText
              text={block.text}
              onReference={props.onReference}
              query={props.query}
            />
          </li>
        )}
      </For>
    </ul>
  ) : (
    <For each={blocks()}>
      {(block) =>
        block.kind === 'bullet' ? (
          <ul class="document-text-list">
            <li>
              <InlineDocumentText
                text={block.text}
                onReference={props.onReference}
                query={props.query}
              />
            </li>
          </ul>
        ) : (
          <p>
            <InlineDocumentText
              text={block.text}
              onReference={props.onReference}
              query={props.query}
            />
          </p>
        )
      }
    </For>
  );
}
