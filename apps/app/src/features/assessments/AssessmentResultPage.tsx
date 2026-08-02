import { createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { AssessmentDefinitionNotice } from '@/features/assessments/AssessmentDefinitionNotice';
import { formatAssessmentRecord } from '@/features/assessments/assessment-engine';
import {
  printAssessmentRecord,
  shareAssessmentRecord,
} from '@/features/assessments/assessment-print';
import type {
  AssessmentDefinition,
  AssessmentRecord,
} from '@/features/assessments/assessment-types';
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
  const completed = () => (props.record.kind === 'completed' ? props.record.result : undefined);
  const manualText = () => (props.record.kind === 'manual' ? props.record.text : '');

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
    const text = formatAssessmentRecord(props.definition, props.record);
    const next = addPatientNote(cardId, text);
    if (!next.notes.some((note) => note.cardId === cardId && note.text === text)) {
      props.onMessage('Не удалось записать результат в заметку.');
      return;
    }
    props.onNotesChanged(next);
    props.onMessage('Результат записан в карточку пациента.');
    setNotePanelOpen(false);
  };

  return (
    <article class="assessment-result-page">
      <header class="assessment-subpage-header">
        <button
          type="button"
          class="knowledge-back-button"
          aria-label="К тесту"
          onClick={props.onBack}
        >
          <AppGlyph name="arrow-left" />
        </button>
        <div>
          <p class="archive-kicker">Результат сохранён локально</p>
          <h1>{props.definition.title}</h1>
          <p>
            {props.record.subjectLabel || 'Без подписи'} · {formatDate(props.record.createdAt)}
          </p>
        </div>
      </header>

      <Show
        when={completed()}
        fallback={
          <section class="assessment-result-summary paper-card">
            <h2>Результат внесён вручную</h2>
            <pre>{manualText()}</pre>
            <p>MiniMed не пересчитывал баллы и не проверял версию внешнего бланка.</p>
          </section>
        }
      >
        {(result) => (
          <section class="assessment-result-summary paper-card">
            <h2>{result().headline}</h2>
            <p>{result().summary}</p>
            <div class="assessment-score-list">
              <For each={result().scores}>
                {(score) => (
                  <div>
                    <span>
                      <strong>{score.label}</strong>
                      <small>
                        {score.rawScore} / {score.maximumScore}
                      </small>
                    </span>
                    <progress value={score.percent} max={100} />
                    <b>{score.percent}%</b>
                  </div>
                )}
              </For>
            </div>
            <p class="assessment-disclaimer">{props.definition.disclaimer}</p>
          </section>
        )}
      </Show>

      <div class="assessment-result-actions paper-card">
        <button
          type="button"
          onClick={() => printAssessmentRecord(props.definition, props.record)}
        >
          Распечатать / PDF
        </button>
        <button
          type="button"
          onClick={() => {
            void shareAssessmentRecord(props.definition, props.record)
              .then((mode) =>
                props.onMessage(
                  mode === 'shared'
                    ? 'Результат передан.'
                    : 'Результат скопирован в буфер обмена.',
                ),
              )
              .catch(() => props.onMessage('Не удалось поделиться результатом.'));
          }}
        >
          Поделиться
        </button>
        <button
          type="button"
          data-testid="assessment-save-note"
          onClick={() => setNotePanelOpen((value) => !value)}
        >
          Записать в заметку
        </button>
        <button type="button" onClick={props.onDelete}>
          Удалить результат
        </button>
      </div>

      <Show when={notePanelOpen()}>
        <section class="assessment-note-panel paper-card">
          <h2>Сохранить в карточку пациента</h2>
          <label>
            <span>Существующая карточка</span>
            <select
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
            <label>
              <span>Название новой карточки</span>
              <input
                value={newCardTitle()}
                placeholder={props.record.subjectLabel || 'Пациент'}
                onInput={(event) => setNewCardTitle(event.currentTarget.value)}
              />
            </label>
          </Show>
          <div class="assessment-panel-actions">
            <button type="button" onClick={saveToNote}>
              Записать результат
            </button>
            <button type="button" onClick={() => setNotePanelOpen(false)}>
              Отмена
            </button>
          </div>
        </section>
      </Show>

      <AssessmentDefinitionNotice definition={props.definition} />
    </article>
  );
}
