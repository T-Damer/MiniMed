import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import { PAGE_HEROES } from '@/app/page-heroes';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import type { HeaderAction } from '@/components/HeaderActions';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { Heading } from '@/components/Text';
import { TextArea } from '@/components/TextArea';
import { TextField } from '@/components/TextField';
import { printBlankAssessment } from '@/features/assessments/assessment-print';
import { UserQuestionnaireBandsEditor } from '@/features/assessments/UserQuestionnaireBandsEditor';
import { UserQuestionnaireQuestionCard } from '@/features/assessments/UserQuestionnaireQuestionCard';
import {
  addQuestion,
  addSection,
  canAddQuestion,
  canAddSection,
  canMoveQuestion,
  duplicateQuestion,
  moveQuestion,
  moveQuestionToSection,
  moveSection,
  removeQuestion,
  removeSection,
  updateQuestion,
  updateSection,
} from '@/features/assessments/user-questionnaire-edit';
import { ToolPopulationField } from '@/features/tools/ToolPopulationField';
import { pluralRu } from '@/i18n/labels';
import {
  formatScoreRange,
  orderedQuestions,
  type QuestionnaireIssue,
  questionnaireIsScored,
  questionnaireScoreRange,
  userQuestionnaireIssues,
} from '@/state/user-questionnaire-rules';
import {
  readUserQuestionnaireImages,
  type StoredUserQuestionnaire,
  saveUserQuestionnaire,
  type UserQuestionnaire,
  type UserQuestionnaireImage,
  userQuestionnaireToAssessmentDefinition,
} from '@/state/user-questionnaires';

import '@/features/assessments/user-questionnaire-editor.css';

const MAX_IMAGES = 24;

function questionCount(count: number): string {
  return `${count} ${pluralRu(count, 'вопрос', 'вопроса', 'вопросов')}`;
}

function sectionCount(count: number): string {
  return `${count} ${pluralRu(count, 'раздел', 'раздела', 'разделов')}`;
}

function scrollToPart(part: QuestionnaireIssue['part']): void {
  const target = document.getElementById(`user-questionnaire-${part ?? 'questions'}`);
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * The top of the questionnaire as the respondent sees it: the background picture with the name and
 * the introduction over it. Without a picture it is a quiet row that offers to add one.
 */
function UserQuestionnaireHero(props: {
  readonly title: string;
  readonly intro: string;
  readonly image: UserQuestionnaireImage | undefined;
  readonly onPick: () => void;
  readonly onRemove: (imageId: string) => void;
}): JSX.Element {
  return (
    <Show
      when={props.image}
      fallback={
        <section
          class="user-questionnaire-hero user-questionnaire-hero--empty paper-card"
          aria-label="Фон опросника"
        >
          <div class="user-questionnaire-hero__copy">
            <h2 class="user-questionnaire-hero__label">Фон опросника</h2>
            <p class="user-questionnaire-hero__hint">PNG, JPEG, GIF или WebP до 5 МБ</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            class="user-questionnaire-hero__add"
            data-testid="questionnaire-background-add"
            onClick={props.onPick}
            icon={<AppGlyph name="image" class="user-questionnaire-editor__icon" />}
          >
            Добавить фон
          </Button>
        </section>
      }
    >
      {(image) => (
        <section
          class="user-questionnaire-hero user-questionnaire-hero--filled"
          aria-label="Фон опросника"
          data-testid="questionnaire-background"
          style={{ 'background-image': `url("${image().dataUrl}")` }}
        >
          <div class="user-questionnaire-hero__tools">
            <Button
              type="button"
              variant="icon"
              class="user-questionnaire-hero__tool"
              aria-label="Изменить фон"
              title="Изменить фон"
              onClick={props.onPick}
              icon={<AppGlyph name="image" class="user-questionnaire-editor__icon" />}
            />
            <Button
              type="button"
              variant="icon"
              class="user-questionnaire-hero__tool"
              aria-label={`Удалить фон «${image().name}»`}
              title="Удалить фон"
              onClick={() => props.onRemove(image().id)}
              icon={<AppGlyph name="trash" class="user-questionnaire-editor__icon" />}
            />
          </div>
          <div class="user-questionnaire-hero__text">
            <p class="user-questionnaire-hero__title">{props.title || 'Новый опросник'}</p>
            <Show when={props.intro}>
              <p class="user-questionnaire-hero__intro">{props.intro}</p>
            </Show>
          </div>
        </section>
      )}
    </Show>
  );
}

export function UserQuestionnaireEditorPage(props: {
  readonly stored: StoredUserQuestionnaire;
  readonly onBack: () => void;
  readonly onRun: () => void;
  readonly onSaved: (stored: StoredUserQuestionnaire) => void;
  readonly onMessage: (message: string) => void;
  readonly onExport: () => void;
  readonly onDuplicate: () => void;
  readonly onDelete: () => void;
}): JSX.Element {
  const [draft, setDraft] = createSignal(props.stored.questionnaire);
  const [saveState, setSaveState] = createSignal<'saved' | 'saving' | 'error'>('saved');
  const [error, setError] = createSignal('');
  /** The question whose pictures are being picked; null picks the background of the questionnaire. */
  const [imageTarget, setImageTarget] = createSignal<string | null>(null);
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  let fileId = props.stored.file.id;
  let pending: UserQuestionnaire | undefined;
  let saving = false;
  let disposed = false;
  let imageInput: HTMLInputElement | undefined;

  createEffect(() => {
    if (props.stored.file.id === fileId) return;
    fileId = props.stored.file.id;
    pending = undefined;
    setDraft(props.stored.questionnaire);
    setSaveState('saved');
    setError('');
  });

  onCleanup(() => {
    disposed = true;
  });

  /**
   * The draft on screen is the source of truth while the doctor types: a saved copy is trimmed and
   * normalised, and writing it back would eat a space typed a moment ago. Only a title the library
   * had to change is taken over.
   */
  const persist = (next: UserQuestionnaire): void => {
    setDraft(next);
    pending = next;
    setSaveState('saving');
    setError('');
    if (saving) return;
    saving = true;
    void (async () => {
      while (pending) {
        const current = pending;
        pending = undefined;
        try {
          const saved = await saveUserQuestionnaire(fileId, current);
          if (disposed) continue;
          const typedTitle = draft().title.trim();
          if (typedTitle && saved.questionnaire.title !== typedTitle) {
            setDraft((value) => ({ ...value, title: saved.questionnaire.title }));
          }
          props.onSaved(saved);
          if (!pending) setSaveState('saved');
        } catch (cause) {
          if (disposed) continue;
          setSaveState('error');
          setError(cause instanceof Error ? cause.message : 'Не удалось сохранить черновик.');
        }
      }
      saving = false;
    })();
  };

  const issues = createMemo(() => userQuestionnaireIssues(draft()));
  const errors = () => issues().filter((issue) => issue.severity === 'error');
  const warnings = () => issues().filter((issue) => issue.severity === 'warning');
  const issueMessagesFor = (questionId: string): readonly string[] =>
    issues()
      .filter((issue) => issue.questionId === questionId)
      .map((issue) => issue.message);
  const ordered = createMemo(() => orderedQuestions(draft()));
  const questionsOf = (sectionId: string | undefined) =>
    ordered().filter((question) => question.sectionId === sectionId);
  const numberOf = (questionId: string): number =>
    ordered().findIndex((question) => question.id === questionId) + 1;
  const scored = () => questionnaireIsScored(draft());
  const totalRange = () => questionnaireScoreRange(draft(), 'total');
  const summary = (): string => {
    const parts = [questionCount(draft().questions.length)];
    if (draft().sections.length > 0) parts.push(sectionCount(draft().sections.length));
    const range = totalRange();
    if (range) parts.push(`баллы ${formatScoreRange(range.min, range.max)}`);
    return parts.join(' · ');
  };
  const printBlank = (): void => {
    if (
      !printBlankAssessment(
        userQuestionnaireToAssessmentDefinition({
          file: { ...props.stored.file, title: draft().title },
          questionnaire: draft(),
        }),
      )
    ) {
      props.onMessage('Не удалось открыть окно печати.');
    }
  };

  const totalImageCount = () =>
    draft().images.length +
    draft().questions.reduce((sum, question) => sum + question.images.length, 0);
  const attachImages = (target: string | null, images: readonly UserQuestionnaireImage[]): void => {
    const imageCount =
      target === null
        ? totalImageCount() - draft().images.length + Math.min(images.length, 1)
        : totalImageCount() + images.length;
    if (imageCount > MAX_IMAGES) {
      setSaveState('error');
      setError(`В одном опроснике может быть не более ${MAX_IMAGES} изображений.`);
      return;
    }
    if (target === null) {
      persist({ ...draft(), images: images.slice(0, 1) });
      return;
    }
    persist(
      updateQuestion(draft(), target, (question) => ({
        ...question,
        images: [...question.images, ...images],
      })),
    );
  };
  const openImagePicker = (target: string | null): void => {
    setImageTarget(target);
    imageInput?.click();
  };
  const removeImage = (target: string | null, imageId: string): void => {
    if (target === null) {
      persist({ ...draft(), images: draft().images.filter((image) => image.id !== imageId) });
      return;
    }
    persist(
      updateQuestion(draft(), target, (question) => ({
        ...question,
        images: question.images.filter((image) => image.id !== imageId),
      })),
    );
  };

  /**
   * The card of the question in a list slot. Slots are keyed by position, so the id is read
   * through an accessor: after a move the same card shows the question that took its place.
   */
  const renderQuestion = (questionId: () => string): JSX.Element => {
    const question = () => draft().questions.find((item) => item.id === questionId());
    return (
      <Show when={question()}>
        {(current) => (
          <UserQuestionnaireQuestionCard
            question={current()}
            number={numberOf(questionId())}
            sections={draft().sections}
            scored={scored()}
            issues={issueMessagesFor(questionId())}
            canMoveUp={canMoveQuestion(draft(), questionId(), -1)}
            canMoveDown={canMoveQuestion(draft(), questionId(), 1)}
            canDuplicate={canAddQuestion(draft())}
            onChange={(update) => persist(updateQuestion(draft(), questionId(), update))}
            onMove={(direction) => persist(moveQuestion(draft(), questionId(), direction))}
            onDuplicate={() => persist(duplicateQuestion(draft(), questionId()))}
            onRemove={() => persist(removeQuestion(draft(), questionId()))}
            onMoveToSection={(sectionId) =>
              persist(moveQuestionToSection(draft(), questionId(), sectionId))
            }
            onAddImages={() => openImagePicker(questionId())}
            onRemoveImage={(imageId) => removeImage(questionId(), imageId)}
          />
        )}
      </Show>
    );
  };

  const runBlocked = createMemo(() => errors().length > 0 || saveState() !== 'saved');
  /** Run is the primary action (folds last); print and export next; copy and delete live in «⋯». */
  const headerActions = createMemo((): readonly HeaderAction[] => [
    {
      id: 'run',
      label: 'Пройти опросник',
      icon: 'play',
      priority: 1,
      disabled: runBlocked(),
      testId: 'questionnaire-run',
      onSelect: props.onRun,
    },
    {
      id: 'print',
      label: 'Распечатать бланк',
      icon: 'printer',
      priority: 2,
      testId: 'questionnaire-print',
      onSelect: printBlank,
    },
    {
      id: 'export',
      label: 'Экспорт в файл',
      icon: 'share',
      priority: 2,
      testId: 'questionnaire-export',
      onSelect: props.onExport,
    },
    {
      id: 'duplicate',
      label: 'Создать копию',
      icon: 'copy',
      priority: 3,
      menuOnly: true,
      testId: 'questionnaire-duplicate',
      onSelect: props.onDuplicate,
    },
    {
      id: 'delete',
      label: 'Удалить опросник',
      icon: 'trash',
      priority: 3,
      menuOnly: true,
      danger: true,
      testId: 'questionnaire-delete',
      onSelect: () => setConfirmDelete(true),
    },
  ]);

  return (
    <div class="assessment-workspace user-questionnaire-editor">
      <Page
        hero={PAGE_HEROES.assessments}
        class="assessment-page-header user-questionnaire-editor__header"
        navigation={<NavBack aria-label="Назад" title="Назад" onClick={props.onBack} />}
        title={
          <Heading depth={2} class="assessment-subpage-title">
            {draft().title.trim() || 'Новый опросник'}
          </Heading>
        }
        description={
          <span
            class="user-questionnaire-editor__save-state"
            classList={{ 'user-questionnaire-editor__save-state--error': saveState() === 'error' }}
            role="status"
            data-testid="questionnaire-save-state"
          >
            {saveState() === 'saving'
              ? 'Сохраняем…'
              : saveState() === 'error'
                ? error()
                : 'Все изменения сохранены'}
          </span>
        }
        headerActions={headerActions()}
        help={
          <>
            <p>
              Изменения сохраняются сами. «Пройти» открывает опросник так, как его увидит пациент;
              бланк для печати и файл для коллеги — рядом.
            </p>
            <p>
              Разделы группируют вопросы под заголовком и, если нужно, считают баллы отдельно.
              Вопрос без раздела входит только в общий итог.
            </p>
          </>
        }
      />

      <UserQuestionnaireHero
        title={draft().title.trim()}
        intro={draft().description.trim()}
        image={draft().images[0]}
        onPick={() => openImagePicker(null)}
        onRemove={(imageId) => removeImage(null, imageId)}
      />

      <Show when={issues().length > 0}>
        <section
          class="questionnaire-issues paper-card"
          aria-label="Что нужно исправить"
          data-testid="questionnaire-issues"
        >
          <h2
            class="questionnaire-issues__title"
            classList={{ 'questionnaire-issues__title--ready': errors().length === 0 }}
          >
            {errors().length > 0
              ? `Чтобы пройти опросник, исправьте: ${errors().length}`
              : 'Опросник готов. Советы:'}
          </h2>
          <ul class="questionnaire-issues__list">
            <For each={[...errors(), ...warnings()].slice(0, 8)}>
              {(issue) => (
                <li class="questionnaire-issues__item">
                  <button
                    type="button"
                    class="questionnaire-issues__link"
                    classList={{
                      'questionnaire-issues__link--warning': issue.severity === 'warning',
                    }}
                    onClick={() => scrollToPart(issue.part)}
                  >
                    {issue.message}
                  </button>
                </li>
              )}
            </For>
          </ul>
          <Show when={issues().length > 8}>
            <p class="questionnaire-issues__more">И ещё {issues().length - 8}.</p>
          </Show>
        </section>
      </Show>

      <section
        class="user-questionnaire-editor__details paper-card"
        id="user-questionnaire-details"
      >
        <h2 class="user-questionnaire-editor__section-title">Об опроснике</h2>
        <TextField
          label="Название"
          hint="Так опросник называется в списке и в «Моих файлах»."
          data-testid="questionnaire-title"
          value={draft().title}
          onInput={(event) => persist({ ...draft(), title: event.currentTarget.value })}
        />
        <TextArea
          label="Вводный текст"
          rows={3}
          placeholder="Для кого этот опросник и как его заполнять"
          data-testid="questionnaire-description"
          value={draft().description}
          onInput={(event) => persist({ ...draft(), description: event.currentTarget.value })}
        />
        <TextArea
          label="Ограничение"
          rows={2}
          hint="Показывается рядом с результатом."
          data-testid="questionnaire-disclaimer"
          value={draft().disclaimer}
          onInput={(event) => persist({ ...draft(), disclaimer: event.currentTarget.value })}
        />
      </section>

      <section
        class="user-questionnaire-editor__details paper-card"
        id="user-questionnaire-population"
      >
        <ToolPopulationField
          value={draft().population}
          error={issues().find((issue) => issue.part === 'population')?.message}
          onChange={(population) => persist({ ...draft(), population })}
        />
      </section>

      <input
        ref={(element) => {
          imageInput = element;
        }}
        class="user-questionnaire-editor__image-input"
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple={imageTarget() !== null}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          void readUserQuestionnaireImages(files)
            .then((images) => attachImages(imageTarget(), images))
            .catch((cause: unknown) => {
              setSaveState('error');
              setError(cause instanceof Error ? cause.message : 'Не удалось добавить изображения.');
            });
        }}
      />

      <section
        class="user-questionnaire-editor__questions"
        id="user-questionnaire-questions"
        aria-label="Вопросы"
      >
        <header class="user-questionnaire-editor__questions-header">
          <h2 class="user-questionnaire-editor__section-title">Вопросы</h2>
          <Button
            type="button"
            variant="secondary"
            class="user-questionnaire-editor__add-section"
            data-testid="questionnaire-add-section"
            title="Раздел группирует вопросы под заголовком и может считать баллы отдельно"
            disabled={!canAddSection(draft())}
            onClick={() => persist(addSection(draft()))}
            icon={<AppGlyph name="plus" class="user-questionnaire-editor__icon" />}
          >
            Добавить раздел
          </Button>
        </header>
        <p class="user-questionnaire-editor__hint" data-testid="questionnaire-summary">
          {summary()}
        </p>

        <Show when={questionsOf(undefined).length > 0}>
          <div class="user-questionnaire-editor__group">
            <Show when={draft().sections.length > 0}>
              <h3 class="user-questionnaire-editor__group-title">Вопросы без раздела</h3>
            </Show>
            <Index each={questionsOf(undefined)}>
              {(question) => renderQuestion(() => question().id)}
            </Index>
          </div>
        </Show>

        <Index each={draft().sections}>
          {(section, sectionIndex) => (
            <section
              class="questionnaire-section paper-card"
              data-testid="questionnaire-section"
              aria-label={`Раздел ${sectionIndex + 1}`}
            >
              <header class="questionnaire-section__header">
                <h3 class="questionnaire-section__title">Раздел {sectionIndex + 1}</h3>
                <div class="questionnaire-section__actions">
                  <Button
                    type="button"
                    variant="icon"
                    class="questionnaire-section__action"
                    aria-label={`Поднять раздел ${sectionIndex + 1} выше`}
                    title="Выше"
                    disabled={sectionIndex === 0}
                    onClick={() => persist(moveSection(draft(), section().id, -1))}
                    icon={<AppGlyph name="caret-up" class="user-questionnaire-editor__icon" />}
                  />
                  <Button
                    type="button"
                    variant="icon"
                    class="questionnaire-section__action"
                    aria-label={`Опустить раздел ${sectionIndex + 1} ниже`}
                    title="Ниже"
                    disabled={sectionIndex === draft().sections.length - 1}
                    onClick={() => persist(moveSection(draft(), section().id, 1))}
                    icon={<AppGlyph name="caret-down" class="user-questionnaire-editor__icon" />}
                  />
                  <Button
                    type="button"
                    variant="icon"
                    class="questionnaire-section__action"
                    aria-label={`Удалить раздел ${sectionIndex + 1}`}
                    title="Удалить раздел (вопросы останутся)"
                    onClick={() => persist(removeSection(draft(), section().id))}
                    icon={<AppGlyph name="trash" class="user-questionnaire-editor__icon" />}
                  />
                </div>
              </header>
              <TextField
                label="Название раздела"
                placeholder="Например, «Тревога»"
                data-testid="questionnaire-section-title"
                value={section().title}
                onInput={(event) => {
                  const title = event.currentTarget.value;
                  persist(
                    updateSection(draft(), section().id, (current) => ({ ...current, title })),
                  );
                }}
              />
              <TextArea
                label="Описание раздела"
                rows={2}
                placeholder="Необязательно: как отвечать на вопросы этого раздела"
                value={section().description}
                onInput={(event) => {
                  const description = event.currentTarget.value;
                  persist(
                    updateSection(draft(), section().id, (current) => ({
                      ...current,
                      description,
                    })),
                  );
                }}
              />
              <Index each={questionsOf(section().id)}>
                {(question) => renderQuestion(() => question().id)}
              </Index>
              <Button
                type="button"
                variant="secondary"
                class="questionnaire-section__add-question"
                disabled={!canAddQuestion(draft())}
                onClick={() => persist(addQuestion(draft(), section().id))}
                icon={<AppGlyph name="plus" class="user-questionnaire-editor__icon" />}
              >
                Добавить вопрос в раздел
              </Button>
            </section>
          )}
        </Index>

        <Button
          type="button"
          variant="primary"
          class="user-questionnaire-editor__add-question"
          data-testid="questionnaire-add-question"
          disabled={!canAddQuestion(draft())}
          onClick={() => persist(addQuestion(draft()))}
          icon={<AppGlyph name="plus" class="user-questionnaire-editor__icon" />}
        >
          Добавить вопрос
        </Button>
      </section>

      <div id="user-questionnaire-bands">
        <UserQuestionnaireBandsEditor
          questionnaire={draft()}
          issues={issues()}
          onChange={persist}
        />
      </div>

      <ConfirmationDialog
        open={confirmDelete()}
        title="Удалить опросник?"
        description={`«${draft().title.trim() || 'Без названия'}» будет удалён вместе с файлом. Сохранённые результаты не изменятся.`}
        confirmLabel="Удалить"
        danger
        onConfirm={() => {
          setConfirmDelete(false);
          props.onDelete();
        }}
        onOpenChange={setConfirmDelete}
      />
    </div>
  );
}
