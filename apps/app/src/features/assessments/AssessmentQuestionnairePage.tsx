import { createEffect, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import NumberFlow from 'solid-number-flow';

import { AppBreadcrumbs } from '@/components/AppBreadcrumbs';
import {
  AppContextMenu,
  type AppContextMenuAction,
  requestContextMenu,
} from '@/components/AppContextMenu';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { HorizontalScroller } from '@/components/HorizontalScroller';
import { Page } from '@/components/Page';
import { PatientCaseCombobox } from '@/components/PatientCaseCombobox';
import { Heading } from '@/components/Text';
import { AssessmentBackNav } from '@/features/assessments/AssessmentBackNav';
import { AssessmentDefinitionNotice } from '@/features/assessments/AssessmentDefinitionNotice';
import { AssessmentImageCarousel } from '@/features/assessments/AssessmentImageCarousel';
import { answeredQuestionCount, scoreAssessment } from '@/features/assessments/assessment-engine';
import { printBlankAssessment } from '@/features/assessments/assessment-print';
import { assessmentWorkspaceCrumbs } from '@/features/assessments/assessment-routing';
import type {
  AssessmentDefinition,
  AssessmentRecord,
  AssessmentResponseOption,
  AssessmentResponseValue,
  IncompleteAssessmentRecord,
} from '@/features/assessments/assessment-types';
import {
  createCompletedAssessmentRecord,
  removeAssessmentRecord,
  saveIncompleteAssessmentRecord,
} from '@/state/assessment-results';
import {
  type PatientProfile,
  type PatientVaultSnapshot,
  patientContextSnapshot,
} from '@/state/patient-domain';
import { recordAssessmentResultForPatient } from '@/state/patient-tool-recording';
import {
  acknowledgePatientVaultUiCleared,
  isPatientVaultUnlocked,
  PATIENT_VAULT_EVENT,
  PATIENT_VAULT_LOCK_EVENT,
  readPatientVault,
} from '@/state/patient-vault';

export function AssessmentQuestionnairePage(props: {
  readonly active: boolean;
  readonly definition: AssessmentDefinition;
  readonly sectionTitle: string;
  readonly initialRecord?: IncompleteAssessmentRecord | undefined;
  readonly onBack: () => void;
  readonly onSaved: (record: AssessmentRecord) => void;
  readonly onDraftSaved: (record?: IncompleteAssessmentRecord) => void;
  readonly onMessage: (message: string) => void;
}): JSX.Element {
  const [answers, setAnswers] = createSignal<Record<string, AssessmentResponseValue>>(
    props.initialRecord?.answers ?? {},
  );
  const [subjectLabel, setSubjectLabel] = createSignal(props.initialRecord?.subjectLabel ?? '');
  const [patientId, setPatientId] = createSignal(props.initialRecord?.patientId ?? '');
  const [episodeId, setEpisodeId] = createSignal(props.initialRecord?.episodeId ?? '');
  const [patientSnapshot, setPatientSnapshot] = createSignal<PatientVaultSnapshot>();
  const [busy, setBusy] = createSignal(false);
  const [methodologyOpen, setMethodologyOpen] = createSignal(false);
  const [highlightedQuestionId, setHighlightedQuestionId] = createSignal<string | null>(null);
  const [nextButtonHost, setNextButtonHost] = createSignal<HTMLElement | undefined>(undefined);
  const [showHeaderActionMenu, setShowHeaderActionMenu] = createSignal(true);
  let patientRefreshRequest = 0;
  let breadcrumbHost: HTMLDivElement | undefined;
  onMount(() => {
    setNextButtonHost(document.getElementById('app-floating-controls') ?? undefined);
    const updateHeaderActions = (): void => {
      const rows = new Set(
        Array.from(
          breadcrumbHost?.querySelectorAll<HTMLElement>('.document-crumbs__item') ?? [],
        ).map((item) => Math.round(item.getBoundingClientRect().top)),
      );
      setShowHeaderActionMenu(rows.size <= 2);
    };
    const observer = new ResizeObserver(updateHeaderActions);
    if (breadcrumbHost) observer.observe(breadcrumbHost);
    const frame = requestAnimationFrame(updateHeaderActions);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    });
  });
  let draftId = props.initialRecord?.id;
  let hydratedFromInitial = false;
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;

  const refreshPatients = (): void => {
    const request = ++patientRefreshRequest;
    if (!isPatientVaultUnlocked()) {
      const protectedForm = patientId() !== '';
      setPatientSnapshot(undefined);
      setPatientId('');
      setEpisodeId('');
      if (protectedForm) {
        // Do not let a locked patient form fall through to the ordinary local-results store.
        setAnswers({});
        setSubjectLabel('');
        draftId = undefined;
      }
      acknowledgePatientVaultUiCleared();
      return;
    }
    void readPatientVault()
      .then((next) => {
        if (request === patientRefreshRequest && isPatientVaultUnlocked()) {
          setPatientSnapshot(next);
        }
      })
      .catch((cause) => {
        if (request === patientRefreshRequest && isPatientVaultUnlocked()) {
          setPatientSnapshot(undefined);
          props.onMessage(
            cause instanceof Error ? cause.message : 'Не удалось прочитать пациентов.',
          );
        }
      });
  };
  onMount(() => {
    refreshPatients();
    window.addEventListener(PATIENT_VAULT_EVENT, refreshPatients);
    window.addEventListener(PATIENT_VAULT_LOCK_EVENT, refreshPatients);
  });
  onCleanup(() => {
    patientRefreshRequest += 1;
    window.removeEventListener(PATIENT_VAULT_EVENT, refreshPatients);
    window.removeEventListener(PATIENT_VAULT_LOCK_EVENT, refreshPatients);
  });
  const patientProfiles = (): readonly PatientProfile[] => patientSnapshot()?.profiles ?? [];
  const selectedPatient = (): PatientProfile | undefined => {
    const id = patientId();
    return id ? patientProfiles().find((profile) => profile.id === id) : undefined;
  };
  const patientEpisodes = () =>
    patientSnapshot()?.episodes.filter(
      (episode) => episode.patientId === patientId() && episode.status === 'open',
    ) ?? [];

  createEffect(() => {
    const initial = props.initialRecord;
    if (!initial || hydratedFromInitial) return;
    if (Object.keys(answers()).length > 0 || subjectLabel().trim().length > 0) return;
    setAnswers(initial.answers);
    setSubjectLabel(initial.subjectLabel);
    draftId = initial.id;
    hydratedFromInitial = true;
  });
  const answered = () => answeredQuestionCount(props.definition, answers());
  const complete = () => answered() === props.definition.questions.length;
  const remaining = () => props.definition.questions.length - answered();
  const progressPercent = () =>
    Math.round((answered() / props.definition.questions.length) * 10000) / 100;
  const printBlank = (): void => {
    if (!printBlankAssessment(props.definition)) {
      props.onMessage('Не удалось открыть окно печати.');
    }
  };
  const headerMenuActions = (): readonly AppContextMenuAction[] => [
    {
      id: 'print',
      label: 'Распечатать бланк',
      icon: 'printer',
      onSelect: printBlank,
    },
    {
      id: 'methodology',
      label: 'Методика и ограничения',
      icon: 'question',
      onSelect: () => setMethodologyOpen(true),
    },
  ];

  const saveDraft = (
    nextAnswers: Record<string, AssessmentResponseValue>,
    nextSubjectLabel = subjectLabel(),
  ): void => {
    if (patientId()) return;
    if (Object.keys(nextAnswers).length === 0 && !nextSubjectLabel.trim()) return;
    const record = saveIncompleteAssessmentRecord({
      ...(draftId ? { id: draftId } : {}),
      assessmentId: props.definition.id,
      subjectLabel: nextSubjectLabel,
      answers: nextAnswers,
      totalQuestions: props.definition.questions.length,
    });
    draftId = record.id;
    props.onDraftSaved(record);
  };

  const discardOrdinaryDraft = (): void => {
    const currentDraftId = draftId;
    draftId = undefined;
    if (currentDraftId) {
      removeAssessmentRecord(currentDraftId);
      // The parent owns the in-memory record list; refresh it after crossing the privacy
      // boundary so a removed draft cannot be hydrated again after navigating away and back.
      props.onDraftSaved();
    }
  };

  const selectPatient = (nextPatientId: string): void => {
    const previousPatientId = patientId();
    if (nextPatientId) {
      // A draft may contain answers entered before the user chose a patient. Remove it
      // before the protected flow starts and do not carry those answers across the
      // privacy boundary.
      discardOrdinaryDraft();
      setAnswers({});
    } else if (previousPatientId) {
      // Never turn protected answers into an ordinary local draft when unbinding.
      setAnswers({});
      draftId = undefined;
    }
    setPatientId(nextPatientId);
    setEpisodeId('');
    const patient = patientProfiles().find((candidate) => candidate.id === nextPatientId);
    setSubjectLabel(patient?.displayName ?? '');
  };

  const completeAssessment = async (): Promise<void> => {
    const result = scoreAssessment(props.definition, answers());
    if (!result.ok) {
      props.onMessage(result.error);
      return;
    }
    const record = createCompletedAssessmentRecord({
      ...(draftId ? { id: draftId } : {}),
      assessmentId: props.definition.id,
      subjectLabel: subjectLabel(),
      answers: answers(),
      result: result.value,
      ...(patientId() ? { patientId: patientId() } : {}),
      ...(episodeId() ? { episodeId: episodeId() } : {}),
      ...(props.definition.version ? { definitionVersion: props.definition.version } : {}),
      ...(patientId() && selectedPatient() && patientSnapshot()
        ? {
            contextSnapshot: patientContextSnapshot(
              selectedPatient() as PatientProfile,
              patientSnapshot() as PatientVaultSnapshot,
              result.value.completedAt,
            ),
          }
        : {}),
      persist: !patientId(),
    });
    if (patientId()) {
      try {
        const saved = await recordAssessmentResultForPatient({
          patientId: patientId(),
          ...(episodeId() ? { episodeId: episodeId() } : {}),
          record,
          definition: props.definition,
        });
        props.onMessage(
          saved.created
            ? 'Результат записан в защищённую карточку.'
            : (saved.reason ?? 'Результат рассчитан без записи в динамику.'),
        );
      } catch (cause) {
        props.onMessage(
          cause instanceof Error
            ? cause.message
            : 'Не удалось записать результат в карточку пациента.',
        );
        return;
      }
    }
    props.onSaved(record);
  };

  const submit = async (): Promise<void> => {
    if (busy()) return;
    setBusy(true);
    try {
      await completeAssessment();
    } finally {
      setBusy(false);
    }
  };

  const scrollToNextQuestion = (): void => {
    const target = document.querySelector<HTMLElement>(
      '.assessment-questionnaire .assessment-question:not(:has(input:checked))',
    );
    if (!target) return;
    // biome-ignore lint/complexity/useLiteralKeys: DOMStringMap is an index-signature API.
    const questionId = target.dataset['questionId'] ?? null;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (!questionId) return;
    setHighlightedQuestionId(questionId);
    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => {
      highlightTimer = undefined;
      setHighlightedQuestionId(null);
    }, 1100);
  };

  onCleanup(() => {
    if (highlightTimer) clearTimeout(highlightTimer);
  });

  const responseOptionLabel = (
    questionId: string,
    option: AssessmentResponseOption,
    scroll = false,
  ): JSX.Element => (
    <label
      class="assessment-response-options__option"
      classList={{
        'assessment-response-options__option--selected': answers()[questionId] === option.value,
        'assessment-response-options__option--scroll': scroll,
      }}
    >
      <input
        class="assessment-response-options__input"
        type="radio"
        name={questionId}
        value={option.value}
        checked={answers()[questionId] === option.value}
        disabled={busy()}
        onChange={() => {
          const nextAnswers = { ...answers(), [questionId]: option.value };
          setAnswers(nextAnswers);
          saveDraft(nextAnswers);
        }}
      />
      <Show when={!option.hideValue}>
        <span
          class="assessment-response-options__value"
          classList={{
            'assessment-response-options__value--selected': answers()[questionId] === option.value,
          }}
          aria-hidden="true"
        >
          {option.value}
        </span>
      </Show>
      <small class="assessment-response-options__label">
        <span class="assessment-response-options__text">{option.label}</span>
      </small>
    </label>
  );

  return (
    <div class="assessment-workspace">
      <Page
        class="assessment-page-header"
        navigation={
          <AssessmentBackNav sectionTitle={props.sectionTitle} onBackToCatalog={props.onBack} />
        }
        breadcrumbs={
          <div
            ref={(element) => {
              breadcrumbHost = element;
            }}
            class="assessment-questionnaire__breadcrumbs"
          >
            <AppBreadcrumbs
              items={assessmentWorkspaceCrumbs(props.definition)}
              onNavigate={(href) => {
                window.location.hash = href;
              }}
            />
          </div>
        }
        icon={<AppGlyph name="list-checks" class="page__icon-glyph" />}
        title={
          <Heading depth={3} class="assessment-subpage-title">
            {props.definition.title}
          </Heading>
        }
        description={props.definition.description}
        actions={
          <Show
            when={showHeaderActionMenu()}
            fallback={
              <div class="assessment-subpage-header-actions assessment-subpage-header-actions--trailing">
                <Button
                  type="button"
                  variant="icon"
                  class="knowledge-back-button assessment-questionnaire-print"
                  aria-label="Распечатать бланк теста"
                  title="Распечатать бланк теста"
                  onClick={printBlank}
                  icon={<AppGlyph name="printer" class="assessment-questionnaire-print__icon" />}
                />
                <Button
                  type="button"
                  variant="icon"
                  class="knowledge-back-button assessment-help-button"
                  aria-label="Методика и ограничения"
                  title="Методика и ограничения"
                  onClick={() => setMethodologyOpen(true)}
                  icon={<AppGlyph name="question" class="assessment-help-button__icon" />}
                />
              </div>
            }
          >
            <AppContextMenu
              actions={headerMenuActions()}
              hideButton
              class="assessment-questionnaire__header-menu"
            >
              <Button
                type="button"
                variant="icon"
                class="knowledge-back-button assessment-questionnaire__header-menu-button"
                aria-label="Действия опросника"
                title="Действия опросника"
                onClick={requestContextMenu}
                icon={<AppGlyph name="menu" class="assessment-questionnaire__header-menu-icon" />}
              />
            </AppContextMenu>
          </Show>
        }
      />

      <Show when={props.definition.intro?.trim()}>
        {(intro) => <p class="assessment-questionnaire__intro">{intro()}</p>}
      </Show>
      <Show when={props.definition.images?.length}>
        <AssessmentImageCarousel
          images={props.definition.images ?? []}
          label="Изображения опросника"
        />
      </Show>

      <div class="assessment-toolbar">
        <PatientCaseCombobox
          class="assessment-toolbar__field"
          profiles={patientProfiles()}
          patientId={patientId()}
          subjectLabel={subjectLabel()}
          unlocked={patientSnapshot() !== undefined && isPatientVaultUnlocked()}
          onPatientChange={selectPatient}
          onSubjectLabelChange={(value) => {
            setSubjectLabel(value);
            saveDraft(answers(), value);
          }}
          onSnapshotChange={(snapshot) => {
            patientRefreshRequest += 1;
            setPatientSnapshot(snapshot);
          }}
        />
        <Show when={selectedPatient()}>
          <label class="assessment-toolbar__episode-field">
            <span class="assessment-toolbar__episode-label">Осмотр — необязательно</span>
            <select
              class="assessment-toolbar__episode-input assessment-toolbar__input"
              data-testid="assessment-episode-select"
              value={episodeId()}
              onChange={(event) => setEpisodeId(event.currentTarget.value)}
            >
              <option value="">Отдельное событие</option>
              <For each={patientEpisodes()}>
                {(episode) => (
                  <option value={episode.id}>
                    {episode.title} · {new Date(episode.startedAt).toLocaleDateString('ru-RU')}
                  </option>
                )}
              </For>
            </select>
          </label>
        </Show>
      </div>

      <AssessmentDefinitionNotice
        definition={props.definition}
        open={methodologyOpen()}
        onOpenChange={setMethodologyOpen}
      />

      <div class="assessment-progress" aria-live="polite">
        <span class="assessment-progress__label">
          Заполнено {answered()} из {props.definition.questions.length}
        </span>
        <progress
          class="assessment-progress__bar"
          value={answered()}
          max={props.definition.questions.length}
        />
      </div>

      <form
        class="assessment-questionnaire"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <For each={props.definition.questions}>
          {(question, index) => (
            <fieldset
              class="assessment-question paper-card"
              classList={{
                'assessment-question--highlight': highlightedQuestionId() === question.id,
              }}
              data-question-id={question.id}
            >
              <legend
                class="assessment-question__legend"
                classList={{
                  'assessment-question__legend--answered': answers()[question.id] !== undefined,
                }}
              >
                <span
                  class="assessment-question__number"
                  classList={{
                    'assessment-question__number--wide': String(index() + 1).length >= 2,
                  }}
                >
                  {index() + 1}
                </span>
                <strong class="assessment-question__prompt">{question.prompt}</strong>
              </legend>
              <Show when={question.text?.trim()}>
                {(text) => <p class="assessment-question__text">{text()}</p>}
              </Show>
              <Show when={question.images?.length}>
                <AssessmentImageCarousel
                  images={question.images ?? []}
                  label={`Изображения к вопросу ${index() + 1}`}
                />
              </Show>
              <Show
                when={(question.responseOptions ?? props.definition.responseOptions).length > 5}
                fallback={
                  <div
                    class="assessment-response-options"
                    style={`--assessment-option-count: ${(question.responseOptions ?? props.definition.responseOptions).length};`}
                  >
                    <For each={question.responseOptions ?? props.definition.responseOptions}>
                      {(option) => responseOptionLabel(question.id, option)}
                    </For>
                  </div>
                }
              >
                <HorizontalScroller
                  class="assessment-response-options-scroll"
                  viewportClass="assessment-response-options-scroll__viewport"
                  controls
                  hideScrollbar
                  controlLabel="варианты ответов"
                >
                  <div class="assessment-response-options-scroll__row">
                    <For each={question.responseOptions ?? props.definition.responseOptions}>
                      {(option) => responseOptionLabel(question.id, option, true)}
                    </For>
                  </div>
                </HorizontalScroller>
              </Show>
            </fieldset>
          )}
        </For>

        <div class="assessment-submit-panel paper-card">
          <div class="assessment-submit-panel__summary">
            <strong class="assessment-submit-panel__status">
              {complete()
                ? 'Все пункты заполнены'
                : `Осталось ${props.definition.questions.length - answered()} пунктов`}
            </strong>
            <p class="assessment-submit-panel__disclaimer">{props.definition.disclaimer}</p>
          </div>
          <Button
            type="submit"
            class="assessment-submit-panel__button"
            data-testid="assessment-submit"
            disabled={!complete() || busy()}
            icon={<AppGlyph name="graph" />}
          >
            Рассчитать
          </Button>
        </div>
      </form>

      <Show when={props.active && answered() > 0 && nextButtonHost()}>
        {(host) => (
          <Portal mount={host()}>
            <button
              type="button"
              class="assessment-next-button floating-window-controls__item"
              classList={{ 'assessment-next-button--complete': complete() }}
              data-testid="assessment-next"
              aria-label={
                complete()
                  ? 'Показать результат'
                  : `Следующий вопрос. Осталось ${remaining()} из ${props.definition.questions.length}`
              }
              title={complete() ? 'Показать результат' : 'Следующий вопрос'}
              disabled={busy()}
              style={`--assessment-progress: ${progressPercent()}%;`}
              onClick={() => (complete() ? submit() : scrollToNextQuestion())}
            >
              <svg class="assessment-next-button__ring" viewBox="0 0 36 36" aria-hidden="true">
                <circle class="assessment-next-button__ring-track" cx="18" cy="18" r="16" />
                <circle
                  class="assessment-next-button__ring-fill"
                  cx="18"
                  cy="18"
                  r="16"
                  style={`stroke-dashoffset: ${100 * (1 - answered() / props.definition.questions.length)}`}
                />
              </svg>
              <Show
                when={complete()}
                fallback={<NumberFlow value={remaining()} class="assessment-next-button__count" />}
              >
                <AppGlyph
                  name="graph"
                  class="assessment-next-button__icon assessment-next-button__icon--complete"
                />
              </Show>
            </button>
          </Portal>
        )}
      </Show>
    </div>
  );
}
