import type { MedicalDocument } from '@localmed/contracts';
import { createMemo, For, type JSX, Show } from 'solid-js';

import { Disclosure } from '@/components/Disclosure';
import { IntentBlock } from './SafetyBlocks';
import { safetyOfDocument } from './safety-document';
import type { SafetyIntent } from './safety-query';
import { CARD_NOTICE, type DocumentState, intentView } from './safety-view';
import '@/styles/medication-safety.css';

const INTENTS: readonly SafetyIntent[] = ['pregnancy', 'lactation', 'age'];
const NO_CHANGE = async (): Promise<void> => {};
const NO_SELECTION = (): void => {};

/**
 * «Беременность, ГВ, дети» on the instruction a doctor has open: the sentences of this very text
 * about pregnancy, lactation and age limits, quoted without change, found with the same extraction
 * as the search card. Folded by default; nothing is shown for a text without such sentences.
 */
export function DrugSafetyBlock(props: { readonly document: MedicalDocument }): JSX.Element {
  const found = createMemo(() => safetyOfDocument(props.document));
  const views = createMemo(() => {
    const safety = found();
    if (!safety) return [];
    const documents = new Map<string, DocumentState>([
      [props.document.id, { document: props.document }],
    ]);
    return INTENTS.map((intent) =>
      intentView({
        index: safety.index,
        candidate: safety.candidate,
        intent,
        age: null,
        trimester: null,
        documents,
      }),
    );
  });
  const hasAnything = () => views().some((view) => view.groups.length > 0);
  return (
    <Show when={hasAnything()}>
      <section class="safety-block paper-card" data-testid="drug-safety-block">
        <Disclosure variant="inline" title="Беременность, ГВ, дети">
          <div class="safety-block__body">
            <p class="safety-card__notice">{CARD_NOTICE}</p>
            <For each={views()}>
              {(view) => (
                <IntentBlock view={view} onContentChanged={NO_CHANGE} onSelect={NO_SELECTION} />
              )}
            </For>
          </div>
        </Disclosure>
      </section>
    </Show>
  );
}
