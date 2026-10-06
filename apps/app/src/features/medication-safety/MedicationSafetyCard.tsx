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

import { AppGlyph } from '@/components/AppGlyph';
import { CONTENT_CHANGED_EVENT } from '@/state/content-events';
import { IntentBlock } from './SafetyBlocks';
import { resolveSafetyCandidate } from './safety-candidates';
import { loadSafetyIndex } from './safety-load';
import type { SafetyQuery } from './safety-query';
import {
  CARD_NOTICE,
  type DocumentState,
  documentsToRead,
  type IntentView,
  intentView,
} from './safety-view';
import '@/styles/medication-safety.css';

/**
 * The card above the results of a question about a drug in pregnancy, during breastfeeding or in a
 * child («ибупрофен при беременности», «X ребёнку 3 лет»): the sentences of the drug's official
 * instruction that say something on it, quoted without change with their section and a link to the
 * place. It never answers «можно»: when the instruction says nothing it says so and names the
 * instruction it checked.
 */
export function MedicationSafetyCard(props: {
  readonly core: MedicalCore | undefined;
  readonly query: SafetyQuery;
  readonly onContentChanged?: (() => Promise<void>) | undefined;
}): JSX.Element {
  const onContentChanged =
    props.onContentChanged ??
    (async () => {
      window.dispatchEvent(new Event(CONTENT_CHANGED_EVENT));
    });
  const [index] = createResource(loadSafetyIndex);
  const [candidate] = createResource(
    () => {
      const loaded = index();
      const core = props.core;
      return loaded && core ? { loaded, core, name: props.query.name } : undefined;
    },
    (source) => resolveSafetyCandidate(source.core, source.loaded, source.name),
  );
  const [documents, setDocuments] = createSignal<ReadonlyMap<string, DocumentState>>(new Map());
  // The instruction the doctor switched to; null: the card's own choice.
  const [selected, setSelected] = createSignal<string | null>(null);

  let requested = new Set<string>();
  const forgetDocuments = (): void => {
    requested = new Set();
    setDocuments(new Map());
  };
  createEffect(on(() => props.core, forgetDocuments, { defer: true }));
  createEffect(() => {
    const loaded = index();
    const found = candidate();
    const core = props.core;
    const read = documents();
    if (!loaded || !found || !core) return;
    const generation = requested;
    for (const id of documentsToRead(loaded, found, props.query.intents, read, selected())) {
      if (generation.has(id)) continue;
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

  const views = createMemo<readonly IntentView[]>(() => {
    const loaded = index();
    const found = candidate();
    if (!loaded || !found) return [];
    const read = documents();
    return props.query.intents.map((intent) =>
      intentView({
        index: loaded,
        candidate: found,
        intent,
        age: props.query.age,
        trimester: props.query.trimester,
        selectedDocumentId: selected(),
        documents: read,
      }),
    );
  });

  return (
    <Show when={candidate()}>
      {(found) => (
        <section class="safety-card paper-card" data-testid="safety-card">
          <header class="safety-card__header">
            <AppGlyph name="pill" class="safety-card__icon" />
            <div class="safety-card__heading">
              <h3 class="safety-card__title">
                {found().label}
                <Show when={props.query.age}>
                  {(age) => (
                    <span class="safety-card__asked">
                      {' '}
                      · {age().kind === 'upTo' ? 'до ' : ''}
                      {age().text}
                    </span>
                  )}
                </Show>
                <Show when={props.query.trimester}>
                  {(trimester) => <span class="safety-card__asked"> · {trimester()} триместр</span>}
                </Show>
              </h3>
              <p class="safety-card__notice" data-testid="safety-notice">
                {CARD_NOTICE}
              </p>
            </div>
          </header>
          <For each={views()}>
            {(view) => (
              <IntentBlock view={view} onContentChanged={onContentChanged} onSelect={setSelected} />
            )}
          </For>
        </section>
      )}
    </Show>
  );
}
