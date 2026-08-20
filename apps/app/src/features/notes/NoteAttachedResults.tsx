import { createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { resultPath } from '@/features/assessments/assessment-routing';
import type { RichNoteAttachedCalculatorResult } from '@/features/notes/note-attached-results';
import { findAssessmentRecord } from '@/state/assessment-results';
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

function AssessmentAttachedCard(props: {
  readonly result: NoteAttachedAssessmentResult;
  readonly variant: 'list' | 'editor';
}): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);
  const isManual = () => Boolean(props.result.manualText?.trim());
  const liveRecord = () => findAssessmentRecord(props.result.recordId);
  const visibleScores = () => (expanded() ? props.result.scores : props.result.scores.slice(0, 1));
  const hasMore = () =>
    props.result.scores.length > 1 ||
    Boolean(props.result.summary.trim()) ||
    Boolean(props.result.disclaimer?.trim());

  return (
    <div class="note-result-card note-result-card--assessment paper-card">
      <header class="note-result-card__header">
        <span class="note-result-card__icon" aria-hidden="true">
          <AppGlyph name="list-checks" />
        </span>
        <div class="note-result-card__heading">
          <small>Опросник</small>
          <strong>{props.result.title}</strong>
          <Show when={props.result.headline.trim()}>
            <span>{props.result.headline}</span>
          </Show>
        </div>
      </header>

      <Show when={isManual()}>
        <pre class="note-result-card__manual">{props.result.manualText}</pre>
      </Show>
      <Show when={!isManual()}>
        <Show when={visibleScores().length > 0}>
          <div class="note-result-card__values">
            <For each={visibleScores()}>
              {(score) => (
                <div class="note-result-card__value-row">
                  <span>{score.label}</span>
                  <strong>
                    {score.rawScore} / {score.maximumScore}
                  </strong>
                  <small>{score.percent}%</small>
                </div>
              )}
            </For>
          </div>
        </Show>
        <Show when={expanded() && props.result.summary.trim()}>
          <p class="note-result-card__detail">{props.result.summary}</p>
        </Show>
        <Show when={expanded() && props.result.disclaimer?.trim()}>
          <p class="note-result-card__disclaimer">{props.result.disclaimer}</p>
        </Show>
      </Show>

      <div class="note-result-card__actions">
        <Show when={hasMore()}>
          <button type="button" onClick={() => setExpanded((value) => !value)}>
            {expanded() ? 'Свернуть' : 'Развернуть'}
          </button>
        </Show>
        <Show when={liveRecord()}>
          <button type="button" onClick={() => openAssessmentResult(props.result)}>
            Открыть исходный результат
          </button>
        </Show>
      </div>
    </div>
  );
}

function CalculatorAttachedCard(props: {
  readonly result: NoteAttachedCalculatorResult;
  readonly variant: 'list' | 'editor';
}): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);
  const [sourceOpen, setSourceOpen] = createSignal(false);
  const rich = () => props.result as RichNoteAttachedCalculatorResult;
  const visibleOutputs = () =>
    expanded() ? props.result.outputs : props.result.outputs.slice(0, 2);
  const hasMore = () => props.result.outputs.length > 2 || props.result.warnings.length > 0;
  const sourceRecord = () => rich().recordSnapshot;
  const sourceSchema = () => rich().schemaSnapshot;

  return (
    <div class="note-result-card note-result-card--calculator paper-card">
      <header class="note-result-card__header">
        <span class="note-result-card__icon" aria-hidden="true">
          <AppGlyph name="calculator" />
        </span>
        <div class="note-result-card__heading">
          <small>Калькулятор</small>
          <strong>{props.result.title}</strong>
          <span>{props.result.inputSummary}</span>
        </div>
      </header>

      <div class="note-result-card__values">
        <For each={visibleOutputs()}>
          {(item) => (
            <div class="note-result-card__value-row">
              <span>{item.label}</span>
              <strong>{item.display}</strong>
            </div>
          )}
        </For>
      </div>

      <Show when={expanded() && props.result.warnings.length > 0}>
        <div class="note-result-card__warnings">
          <For each={props.result.warnings}>{(warning) => <p>{warning}</p>}</For>
        </div>
      </Show>

      <Show when={sourceOpen()}>
        <section class="note-result-card__source" aria-label="Исходный расчёт">
          <Show
            when={sourceRecord()}
            fallback={<p>Старая заметка не содержит snapshot исходного расчёта.</p>}
          >
            {(record) => (
              <>
                <div class="note-result-card__source-row">
                  <span>Входные данные</span>
                  <strong>{record().inputSummary}</strong>
                </div>
                <div class="note-result-card__source-row">
                  <span>Формула</span>
                  <code>{record().result.formula}</code>
                </div>
                <Show when={sourceSchema()}>
                  {(schema) => (
                    <div class="note-result-card__source-row">
                      <span>Схема</span>
                      <strong>
                        v{schema().schemaVersion} · {schema().shortTitle}
                      </strong>
                    </div>
                  )}
                </Show>
                <Show when={record().result.trace.length > 0}>
                  <ol class="note-result-card__trace">
                    <For each={record().result.trace}>
                      {(step) => (
                        <li>
                          <span>{step.label}</span>
                          <code>{step.expression}</code>
                          <strong>
                            {step.value} {step.unit}
                          </strong>
                        </li>
                      )}
                    </For>
                  </ol>
                </Show>
              </>
            )}
          </Show>
        </section>
      </Show>

      <div class="note-result-card__actions">
        <Show when={hasMore()}>
          <button type="button" onClick={() => setExpanded((value) => !value)}>
            {expanded() ? 'Свернуть' : 'Развернуть'}
          </button>
        </Show>
        <button type="button" onClick={() => setSourceOpen((value) => !value)}>
          {sourceOpen() ? 'Закрыть исходник' : 'Открыть исходный результат'}
        </button>
      </div>
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
