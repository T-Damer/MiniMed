import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import {
  AppContextMenu,
  type AppContextMenuAction,
  requestContextMenu,
} from '@/components/AppContextMenu';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { Heading } from '@/components/Text';
import { AssessmentDefinitionNotice } from '@/features/assessments/AssessmentDefinitionNotice';
import {
  printAssessmentRecord,
  shareAssessmentRecord,
} from '@/features/assessments/assessment-print';
import type {
  AssessmentDefinition,
  AssessmentEvaluation,
  AssessmentRecord,
  ScoredAssessment,
} from '@/features/assessments/assessment-types';
import { Chart } from '@/features/calculators/CalculatorChart';
import { ScoreScale } from '@/features/calculators/ScoreScale';
import { scaledValueIds } from '@/features/calculators/score-scale';
import {
  attachedResultNoteTitle,
  snapshotAssessmentForNote,
} from '@/features/notes/note-attached-results';
import {
  addPatientNote,
  createPatientCard,
  type PatientNotesSnapshot,
} from '@/state/patient-notes';

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

interface EvaluationNotice {
  readonly title: string;
  readonly text: string;
}

/**
 * What the declared evaluation tells the reader. Only a verdict, a context the reader can still
 * supply, or a declared reason the result does not apply is shown; an evaluation the tool schema
 * never declared rules for says nothing — the score and its interpretation stand alone.
 */
export function evaluationNotice(
  evaluation: AssessmentEvaluation | undefined,
): EvaluationNotice | undefined {
  if (!evaluation) return undefined;
  if (evaluation.status === 'verdict') {
    const verdict = evaluation.verdict;
    const text = verdict?.explanation ?? evaluation.reason;
    return text ? { title: verdict?.title ?? 'Оценка результата', text } : undefined;
  }
  if (evaluation.status === 'missing-context') {
    const text = evaluation.missingContext.join(' ').trim();
    return text ? { title: 'Не хватает данных для оценки', text } : undefined;
  }
  if (evaluation.status === 'not-applicable' && evaluation.reason) {
    return { title: 'Оценка не применяется', text: evaluation.reason };
  }
  return undefined;
}

/** Scores the result does not already draw on a score scale. */
function unscaledScores(result: ScoredAssessment): ScoredAssessment['scores'] {
  const scaled = scaledValueIds(result.scales);
  return result.scores.filter((score) => !scaled.has(score.scaleId));
}

export function AssessmentResultPage(props: {
  readonly definition: AssessmentDefinition;
  readonly record: AssessmentRecord;
  readonly notes: PatientNotesSnapshot;
  readonly onBack: () => void;
  readonly onDelete: () => void;
  readonly onNotesChanged: (snapshot: PatientNotesSnapshot) => void;
  readonly onMessage: (message: string) => void;
}): JSX.Element {
  const [notePanelOpen, setNotePanelOpen] = createSignal(false);
  const [selectedCardId, setSelectedCardId] = createSignal('');
  const [newCardTitle, setNewCardTitle] = createSignal('');
  const [methodologyOpen, setMethodologyOpen] = createSignal(false);
  const [shareMessage, setShareMessage] = createSignal('');
  const completed = () => (props.record.kind === 'completed' ? props.record.result : undefined);
  const manualText = () => (props.record.kind === 'manual' ? props.record.text : '');
  const printResult = (includeQuestions = false): void => {
    if (
      !printAssessmentRecord(
        props.definition,
        props.record,
        attachedResultNoteTitle(props.notes, props.record.id),
        includeQuestions,
      )
    ) {
      props.onMessage('Не удалось открыть окно печати.');
    }
  };
  const printActions = (): readonly AppContextMenuAction[] => [
    {
      id: 'result',
      label: 'Печатать результат',
      icon: 'printer',
      onSelect: () => printResult(),
    },
    {
      id: 'result-with-questions',
      label: 'Печатать вместе с вопросами',
      icon: 'list-checks',
      disabled: props.record.kind !== 'completed',
      onSelect: () => printResult(true),
    },
    {
      id: 'info',
      label: 'Информация',
      icon: 'info',
      onSelect: () => setMethodologyOpen(true),
    },
  ];

  onMount(() => {
    const hideFloatingControls = (): void => {
      document
        .querySelector<HTMLElement>('.patient-notes-fab')
        ?.classList.add('assessment-patient-notes-fab--hidden');
    };
    hideFloatingControls();
    const timer = window.setTimeout(hideFloatingControls, 0);
    onCleanup(() => window.clearTimeout(timer));
  });
  onCleanup(() => {
    document
      .querySelector<HTMLElement>('.patient-notes-fab')
      ?.classList.remove('assessment-patient-notes-fab--hidden');
  });

  const saveToNote = (): void => {
    let cardId = selectedCardId();
    if (!cardId) {
      const title = newCardTitle().trim() || props.record.subjectLabel.trim();
      if (!title) {
        props.onMessage('Выберите карточку пациента или укажите имя для новой карточки.');
        return;
      }
      const next = createPatientCard(title, 'Карточка создана из раздела тестов.');
      cardId = next.cards[0]?.id ?? '';
      if (!cardId) {
        props.onMessage('Не удалось создать карточку пациента.');
        return;
      }
      setSelectedCardId(cardId);
    }
    const attachment = snapshotAssessmentForNote(props.definition, props.record);
    const next = addPatientNote(cardId, '', null, { attachedResults: [attachment] });
    const saved = next.notes
      .filter((note) => note.cardId === cardId)
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    if (!saved?.attachedResults?.some((item) => item.recordId === attachment.recordId)) {
      props.onMessage('Не удалось записать результат в заметку.');
      return;
    }
    props.onNotesChanged(next);
    props.onMessage('Результат записан в карточку пациента.');
    setNotePanelOpen(false);
  };

  return (
    <article class="assessment-result-page">
      <Page
        class="assessment-page-header assessment-result-page__header"
        navigation={
          <NavBack class="knowledge-back-button" aria-label="К тесту" onClick={props.onBack} />
        }
        icon={<AppGlyph name="list-checks" class="page__icon-glyph" />}
        title={
          <Heading depth={3} class="assessment-subpage-title">
            {props.definition.title}
          </Heading>
        }
        description={`${props.record.subjectLabel || 'Без подписи'} · ${formatDate(props.record.createdAt)}`}
        help={<p class="assessment-disclaimer">{props.definition.disclaimer}</p>}
        helpTitle="Как читать результат"
        actions={
          <div class="assessment-subpage-header-actions assessment-subpage-header-actions--trailing">
            <AppContextMenu
              actions={printActions()}
              hideButton
              class="assessment-result-print-menu"
            >
              <Button
                type="button"
                variant="icon"
                class="knowledge-back-button assessment-result-print-button"
                aria-label="Действия"
                title="Действия"
                onClick={requestContextMenu}
                icon={<AppGlyph name="menu" class="assessment-result-print-button__icon" />}
              />
            </AppContextMenu>
          </div>
        }
      />

      <Show
        when={completed()}
        fallback={
          <section class="assessment-result-summary paper-card">
            <h2 class="assessment-result-summary__heading">Результат внесён вручную</h2>
            <pre class="assessment-result-summary__manual-text">{manualText()}</pre>
            <p class="assessment-result-summary__text">
              Баллы не пересчитывались, версия бланка не проверялась.
            </p>
          </section>
        }
      >
        {(result) => (
          <section class="assessment-result-summary paper-card">
            <Show when={evaluationNotice(result().evaluation)}>
              {(notice) => (
                <section class="assessment-result-evaluation" aria-live="polite">
                  <strong class="assessment-result-evaluation__title">{notice().title}</strong>
                  <p class="assessment-result-evaluation__text">{notice().text}</p>
                </section>
              )}
            </Show>
            <Show when={result().headline.trim()}>
              <h2 class="assessment-result-summary__heading">{result().headline}</h2>
            </Show>
            <Show when={result().summary.trim()}>
              <p class="assessment-result-summary__text">{result().summary}</p>
            </Show>
            <For each={result().scales ?? []}>{(scale) => <ScoreScale spec={scale} />}</For>
            <For each={result().visuals ?? []}>
              {(visual) => (
                <Chart
                  title={visual.title ?? props.definition.title}
                  spec={visual}
                  {...(visual.heightPx === undefined ? {} : { heightPx: visual.heightPx })}
                />
              )}
            </For>
            <Show when={unscaledScores(result()).length > 0}>
              <div class="assessment-score-list">
                <For each={unscaledScores(result())}>
                  {(score) => (
                    <div class="assessment-score-list__row">
                      <span class="assessment-score-list__label">
                        <strong>{score.label}</strong>
                        <small class="assessment-score-list__detail">
                          {score.rawScore} / {score.maximumScore}
                        </small>
                      </span>
                      <progress
                        class="assessment-score-list__bar"
                        value={score.percent}
                        max={100}
                      />
                      <b class="assessment-score-list__value">{score.percent}%</b>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </section>
        )}
      </Show>

      <AssessmentDefinitionNotice
        definition={props.definition}
        open={methodologyOpen()}
        onOpenChange={setMethodologyOpen}
      />

      <Show when={shareMessage()}>
        {(message) => (
          <p
            class="assessment-result-share-status assessment-result-page__full"
            role="status"
            aria-live="polite"
          >
            {message()}
          </p>
        )}
      </Show>

      <div class="assessment-result-actions paper-card">
        <Button
          variant="icon"
          aria-label="Поделиться"
          title="Поделиться"
          icon={<AppGlyph name="share" />}
          onClick={() => {
            setShareMessage('Подготавливаем результат…');
            void shareAssessmentRecord(props.definition, props.record)
              .then((mode) =>
                setShareMessage(
                  mode === 'shared' ? 'Результат передан.' : 'Результат скопирован в буфер обмена.',
                ),
              )
              .catch(() => setShareMessage('Не удалось поделиться результатом.'));
          }}
        />
        <Show when={!props.record.patientId}>
          <Button
            variant="icon"
            aria-label="Записать"
            title="Записать в карточку пациента"
            icon={<AppGlyph name="notes" />}
            data-testid="assessment-save-note"
            onClick={() => setNotePanelOpen((value) => !value)}
          />
        </Show>
        <Button
          variant="icon"
          class="assessment-result-actions__delete"
          aria-label="Удалить"
          title="Удалить"
          icon={<AppGlyph name="trash" />}
          onClick={props.onDelete}
        />
      </div>

      <p class="assessment-footnote">{props.definition.license.notice}</p>

      <Show when={notePanelOpen() && !props.record.patientId}>
        <section class="assessment-note-panel paper-card assessment-result-page__full">
          <h2 class="assessment-note-panel__heading">Сохранить в карточку пациента</h2>
          <label class="assessment-note-panel__field">
            <span class="assessment-note-panel__label">Существующая карточка</span>
            <select
              class="assessment-note-panel__select"
              value={selectedCardId()}
              onChange={(event) => setSelectedCardId(event.currentTarget.value)}
            >
              <option value="">Создать новую карточку</option>
              <For each={props.notes.cards}>
                {(card) => <option value={card.id}>{card.title}</option>}
              </For>
            </select>
          </label>
          <Show when={!selectedCardId()}>
            <label class="assessment-note-panel__field">
              <span class="assessment-note-panel__label">Название новой карточки</span>
              <input
                class="assessment-note-panel__input"
                list="assessment-patient-suggestions"
                value={newCardTitle()}
                placeholder={props.record.subjectLabel || 'Пациент'}
                onInput={(event) => setNewCardTitle(event.currentTarget.value)}
              />
              <datalist id="assessment-patient-suggestions">
                <For each={props.notes.cards}>{(card) => <option value={card.title} />}</For>
              </datalist>
            </label>
          </Show>
          <div class="assessment-panel-actions">
            <Button
              class="assessment-panel-actions__button assessment-panel-actions__button--primary"
              icon={<AppGlyph name="notes" />}
              onClick={saveToNote}
            >
              Сохранить
            </Button>
            <Button
              class="assessment-panel-actions__button"
              variant="quiet"
              icon={<AppGlyph name="close" />}
              onClick={() => setNotePanelOpen(false)}
            >
              Отмена
            </Button>
          </div>
        </section>
      </Show>
    </article>
  );
}
