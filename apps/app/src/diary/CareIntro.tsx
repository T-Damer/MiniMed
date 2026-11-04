import { createMemo, createSignal, For, type JSX, Match, onMount, Show, Switch } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { CrisisContent } from '@/diary/care-contacts';
import { pluralize } from '@/diary/diary-format';
import { ConsentFullText } from '@/features/diary/consent/ConsentDocumentText';
import {
  acceptedAll,
  diaryOperator,
  type JoiningAcceptance,
  type JoiningDocument,
  joiningDocuments,
} from '@/features/diary/consent/joining-documents';
import type { DiaryInvitation, DiaryOperator } from '@/features/diary/diary-model';

type Step = 'documents' | 'crisis';

function DocumentCard(props: {
  readonly document: JoiningDocument;
  readonly operator: DiaryOperator;
  readonly accepted: boolean;
  readonly onAccept: (accepted: boolean) => void;
}): JSX.Element {
  return (
    <li
      class="consent-doc"
      classList={{ 'consent-doc--accepted': props.accepted }}
      data-document={props.document.id}
    >
      <div class="consent-doc__head">
        <span class="consent-doc__icon" aria-hidden="true">
          <AppGlyph name="file-text" class="consent-doc__glyph" />
        </span>
        <h2 class="consent-doc__title">{props.document.title}</h2>
        <span class="consent-doc__badge">Шаблон</span>
      </div>
      <ul class="consent-doc__points">
        <For each={props.document.summary}>
          {(point) => <li class="consent-doc__point">{point}</li>}
        </For>
      </ul>
      <ConsentFullText document={props.document} operator={props.operator} />
      <button
        type="button"
        class="consent-accept"
        classList={{ 'consent-accept--on': props.accepted }}
        aria-pressed={props.accepted}
        aria-label={`Принимаю: ${props.document.title}`}
        onClick={() => props.onAccept(!props.accepted)}
      >
        <span
          class="consent-accept__box"
          classList={{ 'consent-accept__box--on': props.accepted }}
          aria-hidden="true"
        >
          <AppGlyph
            name="check"
            class={
              props.accepted
                ? 'consent-accept__tick consent-accept__tick--on'
                : 'consent-accept__tick'
            }
          />
        </span>
        <span class="consent-accept__label">Принимаю</span>
      </button>
    </li>
  );
}

/**
 * Before the first entry of a care diary: the three joining documents, each accepted on its own
 * (DIARY26), then where to turn when it is very bad. A connected diary sends nothing to the doctor
 * before this is done (`patient-connection.ts`); the acceptances keep each document's wording.
 */
export function CareIntro(props: {
  readonly invitation: DiaryInvitation;
  /** The diary syncs through the service rather than being sent by hand. */
  readonly connected?: boolean;
  readonly onDone: (consents: readonly JoiningAcceptance[]) => void;
}): JSX.Element {
  const [step, setStep] = createSignal<Step>('documents');
  const [accepted, setAccepted] = createSignal<readonly JoiningAcceptance[]>([]);
  const documents = createMemo(() => joiningDocuments(props.connected === true));
  const operator = createMemo(() => diaryOperator(props.invitation));
  const ready = (): boolean => acceptedAll(documents(), accepted());
  const count = (): number => accepted().length;
  const isAccepted = (document: JoiningDocument): boolean =>
    accepted().some((item) => item.document === document.id);
  const accept = (document: JoiningDocument, on: boolean): void => {
    const others = accepted().filter((item) => item.document !== document.id);
    setAccepted(
      on
        ? [
            ...others,
            { document: document.id, version: document.version, at: new Date().toISOString() },
          ]
        : others,
    );
  };

  let heading: HTMLHeadingElement | undefined;
  const go = (next: Step): void => {
    setStep(next);
    window.scrollTo(0, 0);
    queueMicrotask(() => heading?.focus({ preventScroll: true }));
  };
  onMount(() => heading?.focus({ preventScroll: true }));

  return (
    <main class="diary-page diary-page--care diary-intro">
      <p class="diary-intro__step">Шаг {step() === 'documents' ? 1 : 2} из 2</p>
      <Switch>
        <Match when={step() === 'documents'}>
          <h1 class="diary-intro__title" tabindex="-1" ref={heading}>
            Документы для подключения
          </h1>
          <p class="diary-intro__lead">
            {props.invitation.doctor
              ? `${props.invitation.doctor} подключает вас к наблюдению по этому дневнику. Примите каждый документ.`
              : 'Врач подключает вас к наблюдению по этому дневнику. Примите каждый документ.'}
          </p>
          <ol class="consent-docs">
            <For each={documents()}>
              {(document) => (
                <DocumentCard
                  document={document}
                  operator={operator()}
                  accepted={isAccepted(document)}
                  onAccept={(on) => accept(document, on)}
                />
              )}
            </For>
          </ol>
          <div class="consent-docs__footer">
            <p class="consent-docs__count" aria-live="polite">
              <Show when={!ready()} fallback="Все документы приняты">
                Принято {count()} из {documents().length}{' '}
                {pluralize(documents().length, 'документа', 'документов', 'документов')}
              </Show>
            </p>
            <Button
              class="diary-button diary-intro__next"
              variant="primary"
              disabled={!ready()}
              onClick={() => go('crisis')}
            >
              Далее
            </Button>
          </div>
        </Match>
        <Match when={step() === 'crisis'}>
          <h1 class="diary-intro__title" tabindex="-1" ref={heading}>
            Если станет очень плохо
          </h1>
          <CrisisContent invitation={props.invitation} />
          <p class="diary-intro__lead">Эти контакты всегда под кнопкой «Помощь» вверху дневника.</p>
          <Button
            class="diary-button diary-intro__next"
            variant="primary"
            onClick={() => props.onDone(accepted())}
          >
            Начать дневник
          </Button>
        </Match>
      </Switch>
    </main>
  );
}
