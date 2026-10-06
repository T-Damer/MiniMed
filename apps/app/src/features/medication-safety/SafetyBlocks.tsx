import { For, type JSX, Show } from 'solid-js';

import { buildOfficialDocumentHash } from '@/state/document-route';
import { SafetyDownloadOffer } from './SafetyDownloadOffer';
import {
  CALC_NOTICE,
  type IntentView,
  NOTHING_SAID_TEXT,
  type QuoteGroup,
  type QuoteView,
  sourceLine,
} from './safety-view';
import '@/styles/medication-safety.css';

export function QuoteBlock(props: {
  readonly documentId: string;
  readonly quote: QuoteView;
}): JSX.Element {
  return (
    <blockquote class="safety-card__quote" data-testid="safety-quote">
      <span class="safety-card__quote-section">{props.quote.originLabel}</span>
      <p class="safety-card__quote-text">
        <Show when={props.quote.cutBefore}>
          <span class="safety-card__cut">… </span>
        </Show>
        <For each={props.quote.segments}>
          {(segment) => (
            <Show when={segment.hit} fallback={segment.text}>
              <mark class="safety-card__mark">{segment.text}</mark>
            </Show>
          )}
        </For>
        <Show when={props.quote.cutAfter}>
          <span class="safety-card__cut"> …</span>
        </Show>
      </p>
      <Show
        when={
          props.quote.forms.length > 0 ||
          props.quote.weightLimits.length > 0 ||
          props.quote.categories.length > 0
        }
      >
        <ul class="safety-card__tags">
          <For each={props.quote.forms}>
            {(form) => (
              <li class="safety-card__tag safety-card__tag--form">Названа форма: {form}</li>
            )}
          </For>
          <For each={props.quote.weightLimits}>
            {(weight) => (
              <li class="safety-card__tag safety-card__tag--weight">Масса тела: {weight}</li>
            )}
          </For>
          <For each={props.quote.categories}>
            {(category) => <li class="safety-card__tag">{category}</li>}
          </For>
        </ul>
      </Show>
      <For each={props.quote.calc}>
        {(line) => (
          <p class="safety-card__calc" data-testid="safety-calc" data-relation={line.relation}>
            {line.text}
          </p>
        )}
      </For>
      <Show when={props.quote.anchor}>
        {(anchor) => (
          <a class="safety-card__link" href={buildOfficialDocumentHash(props.documentId, anchor())}>
            Открыть в инструкции
          </a>
        )}
      </Show>
    </blockquote>
  );
}

function GroupBlock(props: {
  readonly documentId: string;
  readonly group: QuoteGroup;
}): JSX.Element {
  const body = (): JSX.Element => (
    <>
      <For each={props.group.quotes}>
        {(quote) => <QuoteBlock documentId={props.documentId} quote={quote} />}
      </For>
      <Show when={props.group.hidden > 0}>
        <p class="safety-card__note">
          Ещё предложений в этом разделе: {props.group.hidden}. Откройте инструкцию целиком.
        </p>
      </Show>
    </>
  );
  return (
    <Show
      when={props.group.id === 'other'}
      fallback={
        <section class="safety-card__group" data-group={props.group.id}>
          <h5 class="safety-card__group-title">{props.group.title}</h5>
          {body()}
        </section>
      }
    >
      <details class="safety-card__group safety-card__group--folded" data-group="other">
        <summary class="safety-card__group-summary">
          {props.group.title} ({props.group.quotes.length + props.group.hidden})
        </summary>
        {body()}
      </details>
    </Show>
  );
}

export function IntentBlock(props: {
  readonly view: IntentView;
  readonly onContentChanged: () => Promise<void>;
  readonly onSelect: (documentId: string | null) => void;
}): JSX.Element {
  const source = () => props.view.source;
  return (
    <section
      class="safety-card__intent"
      data-intent={props.view.intent}
      data-state={props.view.state}
      data-testid="safety-intent"
    >
      <h4 class="safety-card__intent-title">{props.view.title}</h4>
      <Show when={props.view.alternatives.length > 1}>
        <fieldset class="safety-card__choices">
          <legend class="safety-card__choices-label">Инструкция:</legend>
          <For each={props.view.alternatives}>
            {(choice) => (
              <button
                type="button"
                class="safety-card__choice"
                classList={{
                  'safety-card__choice--active':
                    choice.documentId === props.view.source?.documentId,
                }}
                aria-pressed={choice.documentId === props.view.source?.documentId}
                onClick={() => props.onSelect(choice.documentId)}
              >
                {choice.label}
              </button>
            )}
          </For>
        </fieldset>
      </Show>
      <Show when={props.view.state === 'loading'}>
        <p class="safety-card__note" role="status">
          Читаем установленную инструкцию…
        </p>
      </Show>
      <Show when={props.view.state === 'no-instruction'}>
        <p class="safety-card__status" data-testid="safety-no-instruction">
          Инструкции этого вещества нет в источниках приложения: ответить по её тексту нельзя.
        </p>
      </Show>
      <Show when={props.view.state === 'not-installed'}>
        <p class="safety-card__status" data-testid="safety-not-installed">
          Инструкция не установлена: указатель знает, где в ней об этом сказано, но прочитать
          предложения можно только из установленной инструкции.
        </p>
        <Show when={props.view.moduleToInstall}>
          {(moduleId) => (
            <SafetyDownloadOffer moduleId={moduleId()} onContentChanged={props.onContentChanged} />
          )}
        </Show>
      </Show>
      <Show when={props.view.state === 'ready' ? source() : null}>
        {(current) => (
          <>
            <p class="safety-card__source" data-testid="safety-source">
              {sourceLine(current())}
            </p>
            <Show when={current().info?.qualityNote}>
              {(note) => <p class="safety-card__note">{note()}</p>}
            </Show>
            <Show when={props.view.nothingSaid}>
              <p class="safety-card__status" data-testid="safety-nothing-said">
                {NOTHING_SAID_TEXT}
              </p>
              <p class="safety-card__note">
                Проверена эта инструкция: в её разделах о беременности, противопоказаниях и особых
                указаниях такого предложения не найдено.{' '}
                <a class="safety-card__link" href={buildOfficialDocumentHash(current().documentId)}>
                  Открыть инструкцию
                </a>
              </p>
            </Show>
            <Show when={props.view.ageSummary.length > 0}>
              <div class="safety-card__summary" data-testid="safety-age-summary">
                <For each={props.view.ageSummary}>
                  {(line) => (
                    <p class="safety-card__calc" data-relation={line.relation}>
                      {line.text} («{line.words}», {line.sectionLabel})
                    </p>
                  )}
                </For>
                <p class="safety-card__note">{CALC_NOTICE}</p>
              </div>
            </Show>
            <For each={props.view.groups}>
              {(group) => <GroupBlock documentId={current().documentId} group={group} />}
            </For>
            <Show when={props.view.changed > 0}>
              <p class="safety-card__note">
                Текст инструкции изменился с момента составления указателя: откройте инструкцию.
              </p>
            </Show>
            <Show when={current().substanceNote}>
              {(note) => <p class="safety-card__note">{note()}</p>}
            </Show>
          </>
        )}
      </Show>
    </section>
  );
}
