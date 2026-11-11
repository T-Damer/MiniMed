import { createSignal, createUniqueId, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { type JoiningDocument, joiningParagraph } from '@/features/diary/consent/joining-documents';
import type { DiaryOperator } from '@/features/diary/diary-model';
import '@/features/diary/consent/consent.css';

/** A document's full text with the clinic's details in place; blanks show what belongs there. */
export function ConsentDocumentText(props: {
  readonly document: Pick<JoiningDocument, 'sections'>;
  readonly operator?: DiaryOperator;
}): JSX.Element {
  return (
    <div class="consent-text">
      <For each={props.document.sections}>
        {(section) => (
          <section class="consent-text__section">
            <Show when={section.heading}>
              {(heading) => <h3 class="consent-text__heading">{heading()}</h3>}
            </Show>
            <For each={section.paragraphs}>
              {(paragraph) => (
                <p class="consent-text__paragraph">
                  <For each={joiningParagraph(paragraph, props.operator ?? {})}>
                    {(part) =>
                      part.blank ? <span class="consent-text__blank">{part.text}</span> : part.text
                    }
                  </For>
                </p>
              )}
            </For>
          </section>
        )}
      </For>
    </div>
  );
}

/**
 * «Полный текст» under a document's summary: the text unfolds in place (height and fade), and is
 * out of the tab order and the accessibility tree while folded.
 */
export function ConsentFullText(props: {
  readonly document: JoiningDocument;
  readonly operator: DiaryOperator;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const id = createUniqueId();
  return (
    <>
      <button
        type="button"
        class="consent-more"
        aria-expanded={open()}
        aria-controls={id}
        onClick={() => setOpen(!open())}
      >
        <span class="consent-more__label">{open() ? 'Свернуть' : 'Полный текст'}</span>
        <AppGlyph
          name="caret-down"
          class={open() ? 'consent-more__caret consent-more__caret--open' : 'consent-more__caret'}
        />
      </button>
      <div id={id} class="consent-full" classList={{ 'consent-full--open': open() }}>
        <div class="consent-full__inner" inert={!open()}>
          <ConsentDocumentText document={props.document} operator={props.operator} />
        </div>
      </div>
    </>
  );
}
