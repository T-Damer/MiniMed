import { For, type JSX, Show } from 'solid-js';

import { resultPath } from '@/features/assessments/assessment-routing';
import { findAssessmentRecord } from '@/state/assessment-results';
import { loadCalculationHistory } from '@/state/calculation-history';
import type {
  NoteAttachedAssessmentResult,
  NoteAttachedCalculatorResult,
  NoteAttachedResult,
} from '@/state/patient-notes';
import { rememberReturnTo } from '@/state/return-navigation';

function openAssessmentResult(result: NoteAttachedAssessmentResult): void {
  rememberReturnTo();
  window.location.hash = resultPath(result.specialtyId, result.slug, result.recordId);
}

function openCalculatorResult(result: NoteAttachedCalculatorResult): void {
  rememberReturnTo();
  window.location.hash = `#/calculators/${encodeURIComponent(result.slug)}`;
}

function AssessmentAttachedCard(props: {
  readonly result: NoteAttachedAssessmentResult;
  readonly variant: 'list' | 'editor';
}): JSX.Element {
  const isManual = () => Boolean(props.result.manualText?.trim());
  const showDisclaimer = () =>
    props.variant === 'editor' && Boolean(props.result.disclaimer?.trim());
  const liveRecord = () =>
    props.variant === 'editor' ? findAssessmentRecord(props.result.recordId) : undefined;
  const compact = () => props.variant === 'list';

  return (
    <div class="assessment-result-summary paper-card">
      <p class="archive-kicker">Опросник</p>
      <Show
        when={compact()}
        fallback={<h3 class="assessment-result-summary__heading">{props.result.title}</h3>}
      >
        <div class="assessment-result-summary__heading">{props.result.title}</div>
      </Show>
      <Show when={isManual()}>
        <div class="assessment-result-summary__heading">Результат внесён вручную</div>
        <pre class="assessment-result-summary__manual-text">{props.result.manualText}</pre>
      </Show>
      <Show when={!isManual()}>
        <Show when={props.result.headline.trim()}>
          <div class="assessment-result-summary__heading">{props.result.headline}</div>
        </Show>
        <Show when={props.result.summary.trim()}>
          <p class="assessment-result-summary__text">{props.result.summary}</p>
        </Show>
        <Show when={props.result.scores.length > 0}>
          <div class="assessment-score-list">
            <For each={props.result.scores}>
              {(score) => (
                <div class="assessment-score-list__row">
                  <span class="assessment-score-list__label">
                    <strong>{score.label}</strong>
                    <small class="assessment-score-list__detail">
                      {score.rawScore} / {score.maximumScore}
                    </small>
                  </span>
                  <progress class="assessment-score-list__bar" value={score.percent} max={100} />
                  <b class="assessment-score-list__value">{score.percent}%</b>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
      <Show when={showDisclaimer()}>
        <p class="assessment-disclaimer">{props.result.disclaimer}</p>
      </Show>
      <Show when={liveRecord()}>
        <button
          type="button"
          class="note-attached-results__open-link"
          onClick={() => openAssessmentResult(props.result)}
        >
          Открыть исходный результат
        </button>
      </Show>
    </div>
  );
}

function CalculatorAttachedCard(props: {
  readonly result: NoteAttachedCalculatorResult;
  readonly variant: 'list' | 'editor';
}): JSX.Element {
  const showWarnings = () => props.variant === 'editor' && props.result.warnings.length > 0;
  const liveRecord = () =>
    props.variant === 'editor'
      ? loadCalculationHistory().some((record) => record.id === props.result.recordId)
      : false;

  const compact = () => props.variant === 'list';

  return (
    <div class="calculator-result paper-card">
      <header>
        <p class="archive-kicker">Калькулятор</p>
        <Show when={compact()} fallback={<h3>{props.result.title}</h3>}>
          <div class="calculator-result__title">{props.result.title}</div>
        </Show>
        <small>{props.result.inputSummary}</small>
      </header>
      <div class="calculator-output-list">
        <For each={props.result.outputs}>
          {(item) => (
            <div>
              <span>{item.label}</span>
              <strong>{item.display}</strong>
            </div>
          )}
        </For>
      </div>
      <Show when={showWarnings()}>
        <div class="calculator-warnings">
          <For each={props.result.warnings}>{(warning) => <p>{warning}</p>}</For>
        </div>
      </Show>
      <Show when={liveRecord()}>
        <button
          type="button"
          class="note-attached-results__open-link"
          onClick={() => openCalculatorResult(props.result)}
        >
          Открыть исходный результат
        </button>
      </Show>
    </div>
  );
}

export function NoteAttachedResults(props: {
  readonly results: readonly NoteAttachedResult[];
  readonly variant: 'list' | 'editor';
}): JSX.Element {
  return (
    <Show when={props.results.length > 0}>
      <div
        class="note-attached-results"
        classList={{
          'note-attached-results--list': props.variant === 'list',
          'note-attached-results--editor': props.variant === 'editor',
        }}
      >
        <For each={props.results}>
          {(result) =>
            result.kind === 'assessment' ? (
              <AssessmentAttachedCard result={result} variant={props.variant} />
            ) : (
              <CalculatorAttachedCard result={result} variant={props.variant} />
            )
          }
        </For>
      </div>
    </Show>
  );
}
