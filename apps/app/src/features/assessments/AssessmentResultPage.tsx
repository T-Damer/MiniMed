import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
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
  const [methodologyOpen, setMethodologyOpen] = createSignal(false);
  const [shareMessage, setShareMessage] = createSignal('');
  const completed = () => (props.record.kind === 'completed' ? props.record.result : undefined);
  const manualText = () => (props.record.kind === 'manual' ? props.record.text : '');

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
        <div class="assessment-subpage-header-actions assessment-subpage-header-actions--leading">
          <button
            type="button"
            class="knowledge-back-button"
            aria-label="К тесту"
            onClick={props.onBack}
          >
            <AppGlyph name="arrow-left" />
          </button>
        </div>
        <div class="assessment-subpage-header__content">
          <p class="archive-kicker">Результат сохранён локально</p>
          <h1 class="assessment-subpage-title">{props.definition.title}</h1>
          <p>
            {props.record.subjectLabel || 'Без подписи'} · {formatDate(props.record.createdAt)}
          </p>
        </div>
        <div class="assessment-subpage-header-actions assessment-subpage-header-actions--trailing">
          <button
            type="button"
            class="knowledge-back-button assessment-help-button"
            aria-label="Методика и ограничения"
            title="Методика и ограничения"
            onClick={() => setMethodologyOpen(true)}
          >
            <span class="assessment-help-button__label" aria-hidden="true">
              ?
            </span>
          </button>
        </div>
      </header>

      <Show
        when={completed()}
        fallback={
          <section class="assessment-result-summary paper-card">
            <h2 class="assessment-result-summary__heading">Результат внесён вручную</h2>
            <pre class="assessment-result-summary__manual-text">{manualText()}</pre>
            <p class="assessment-result-summary__text">
              MiniMed не пересчитывал баллы и не проверял версию внешнего бланка.
            </p>
          </section>
        }
      >
        {(result) => (
          <section class="assessment-result-summary paper-card">
            <h2 class="assessment-result-summary__heading">{result().headline}</h2>
            <p class="assessment-result-summary__text">{result().summary}</p>
            <div class="assessment-score-list">
              <For each={result().scores}>
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
            <p class="assessment-disclaimer">{props.definition.disclaimer}</p>
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
          <p class="assessment-result-share-status" role="status" aria-live="polite">
            {message()}
          </p>
        )}
      </Show>

      <div class="assessment-result-actions paper-card">
        <Button
          icon={<AppGlyph name="printer" />}
          onClick={() => printAssessmentRecord(props.definition, props.record)}
        >
          Распечатать
        </Button>
        <Button
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
        >
          Поделиться
        </Button>
        <Button
          variant="secondary"
          icon={<AppGlyph name="notes" />}
          data-testid="assessment-save-note"
          onClick={() => setNotePanelOpen((value) => !value)}
        >
          Записать
        </Button>
        <Button variant="danger" icon={<AppGlyph name="trash" />} onClick={props.onDelete}>
          Удалить
        </Button>
      </div>

      <Show when={notePanelOpen()}>
        <section class="assessment-note-panel paper-card">
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
