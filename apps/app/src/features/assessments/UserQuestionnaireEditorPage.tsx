import { createEffect, createMemo, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';
import { AppBreadcrumbs } from '@/components/AppBreadcrumbs';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { Page } from '@/components/Page';
import { Heading } from '@/components/Text';
import { printBlankAssessment } from '@/features/assessments/assessment-print';
import {
  createUserQuestionnaireOption,
  createUserQuestionnaireQuestion,
  duplicateUserQuestionnaireQuestion,
  readUserQuestionnaireImages,
  type StoredUserQuestionnaire,
  saveUserQuestionnaire,
  type UserQuestionnaire,
  type UserQuestionnaireImage,
  type UserQuestionnaireOption,
  type UserQuestionnaireQuestion,
  userQuestionnaireReadinessError,
  userQuestionnaireToAssessmentDefinition,
} from '@/state/user-questionnaires';

function replaceQuestion(
  questionnaire: UserQuestionnaire,
  questionId: string,
  update: (question: UserQuestionnaireQuestion) => UserQuestionnaireQuestion,
): UserQuestionnaire {
  return {
    ...questionnaire,
    questions: questionnaire.questions.map((question) =>
      question.id === questionId ? update(question) : question,
    ),
  };
}

function replaceOption(
  question: UserQuestionnaireQuestion,
  optionId: string,
  update: (option: UserQuestionnaireOption) => UserQuestionnaireOption,
): UserQuestionnaireQuestion {
  return {
    ...question,
    options: question.options.map((option) => (option.id === optionId ? update(option) : option)),
  };
}

export function UserQuestionnaireEditorPage(props: {
  readonly stored: StoredUserQuestionnaire;
  readonly onBack: () => void;
  readonly onRun: () => void;
  readonly onSaved: (stored: StoredUserQuestionnaire) => void;
  readonly onMessage: (message: string) => void;
}): JSX.Element {
  const [draft, setDraft] = createSignal(props.stored.questionnaire);
  const [saveState, setSaveState] = createSignal<'saved' | 'saving' | 'error'>('saved');
  const [error, setError] = createSignal('');
  const [imageTarget, setImageTarget] = createSignal<string | null>(null);
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
          setDraft(saved.questionnaire);
          props.onSaved(saved);
          setSaveState('saved');
        } catch (cause) {
          if (disposed) continue;
          setSaveState('error');
          setError(cause instanceof Error ? cause.message : 'Не удалось сохранить черновик.');
        }
      }
      saving = false;
    })();
  };

  const readinessError = createMemo(() => userQuestionnaireReadinessError(draft()));
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
    if (imageCount > 24) {
      setSaveState('error');
      setError('В одном опроснике может быть не более 24 изображений.');
      return;
    }
    if (target === null) {
      persist({ ...draft(), images: images.slice(0, 1) });
      return;
    }
    persist(
      replaceQuestion(draft(), target, (question) => ({
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
      replaceQuestion(draft(), target, (question) => ({
        ...question,
        images: question.images.filter((image) => image.id !== imageId),
      })),
    );
  };

  const ImageList = (imageProps: {
    readonly target: string;
    readonly images: readonly UserQuestionnaireImage[];
  }): JSX.Element => (
    <Show when={imageProps.images.length > 0}>
      <div class="user-questionnaire-editor__image-list">
        <For each={imageProps.images}>
          {(image) => (
            <article class="user-questionnaire-editor__image-card">
              <img class="user-questionnaire-editor__image" src={image.dataUrl} alt={image.name} />
              <Button
                type="button"
                variant="icon"
                class="user-questionnaire-editor__image-remove"
                aria-label={`Удалить изображение «${image.name}»`}
                onClick={() => removeImage(imageProps.target, image.id)}
                icon={<AppGlyph name="trash" class="user-questionnaire-editor__button-icon" />}
              />
            </article>
          )}
        </For>
      </div>
    </Show>
  );

  return (
    <div class="assessment-workspace user-questionnaire-editor">
      <Page
        class="assessment-page-header user-questionnaire-editor__header"
        navigation={
          <Button
            type="button"
            variant="icon"
            class="user-questionnaire-editor__back"
            aria-label="Назад"
            title="Назад"
            onClick={props.onBack}
            icon={<AppGlyph name="arrow-left" class="user-questionnaire-editor__button-icon" />}
          />
        }
        breadcrumbs={
          <AppBreadcrumbs
            items={[
              { label: 'Тесты', href: '#/assessments' },
              { label: 'Мои опросники', href: '#/assessments/mine' },
              { label: draft().title },
            ]}
            onNavigate={(href) => {
              window.location.hash = href;
            }}
          />
        }
        icon={<AppGlyph name="list-checks" class="page__icon-glyph" />}
        title={
          <Heading depth={2} class="assessment-subpage-title">
            Редактирование опросника
          </Heading>
        }
        description={draft().description}
        actions={
          <div class="assessment-subpage-header-actions user-questionnaire-editor__actions">
            <Button
              type="button"
              variant="icon"
              class="user-questionnaire-editor__action"
              aria-label="Распечатать опросник"
              title="Распечатать опросник"
              onClick={printBlank}
              icon={<AppGlyph name="printer" class="user-questionnaire-editor__button-icon" />}
            />
            <Button
              type="button"
              variant="primary"
              class="user-questionnaire-editor__run"
              disabled={Boolean(readinessError()) || saveState() !== 'saved'}
              title={
                readinessError() ??
                (saveState() === 'saving'
                  ? 'Дождитесь сохранения черновика'
                  : saveState() === 'error'
                    ? error()
                    : 'Открыть опросник')
              }
              onClick={props.onRun}
              icon={<AppGlyph name="list-checks" class="user-questionnaire-editor__button-icon" />}
            >
              Пройти
            </Button>
          </div>
        }
      />

      <section class="user-questionnaire-editor__details paper-card">
        <label class="user-questionnaire-editor__field">
          <span class="user-questionnaire-editor__label">Название файла и опросника</span>
          <input
            class="user-questionnaire-editor__input"
            value={draft().title}
            onInput={(event) => persist({ ...draft(), title: event.currentTarget.value })}
          />
          <small class="user-questionnaire-editor__hint">
            Переименование файла в «Моих файлах» меняет это название.
          </small>
        </label>
        <label class="user-questionnaire-editor__field">
          <span class="user-questionnaire-editor__label">Вводный текст</span>
          <textarea
            class="user-questionnaire-editor__textarea"
            value={draft().description}
            placeholder="Для кого этот опросник и как его заполнять"
            onInput={(event) => persist({ ...draft(), description: event.currentTarget.value })}
          />
        </label>
        <label class="user-questionnaire-editor__field">
          <span class="user-questionnaire-editor__label">Ограничение</span>
          <textarea
            class="user-questionnaire-editor__textarea"
            value={draft().disclaimer}
            onInput={(event) => persist({ ...draft(), disclaimer: event.currentTarget.value })}
          />
        </label>
      </section>

      <section class="user-questionnaire-editor__hero" aria-label="Фон опросника">
        <header class="user-questionnaire-editor__hero-header">
          <div class="user-questionnaire-editor__hero-copy">
            <h2 class="user-questionnaire-editor__hero-title">Фон опросника</h2>
            <p class="user-questionnaire-editor__hero-text">
              Одно изображение в начале опросника: PNG, JPEG, GIF или WebP до 5 МБ.
            </p>
          </div>
          <Button
            type="button"
            variant="primary"
            class="user-questionnaire-editor__hero-action"
            onClick={() => openImagePicker(null)}
            icon={<AppGlyph name="image" class="user-questionnaire-editor__button-icon" />}
          >
            {draft().images.length > 0 ? 'Изменить фон' : 'Добавить фон'}
          </Button>
        </header>
        <Show
          when={draft().images[0]}
          fallback={<p class="user-questionnaire-editor__hero-empty">Фон пока не добавлен.</p>}
        >
          {(image) => (
            <figure class="user-questionnaire-editor__hero-preview">
              <img
                class="user-questionnaire-editor__hero-image"
                src={image().dataUrl}
                alt={image().name}
              />
              <figcaption class="user-questionnaire-editor__hero-caption">
                {image().name}
              </figcaption>
              <Button
                type="button"
                variant="icon"
                class="user-questionnaire-editor__hero-remove"
                aria-label={`Удалить фон «${image().name}»`}
                title="Удалить фон"
                onClick={() => removeImage(null, image().id)}
                icon={<AppGlyph name="trash" class="user-questionnaire-editor__button-icon" />}
              />
            </figure>
          )}
        </Show>
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

      <section class="user-questionnaire-editor__questions" aria-label="Вопросы">
        <For each={draft().questions}>
          {(question, index) => (
            <article class="user-questionnaire-editor__question paper-card">
              <header class="user-questionnaire-editor__question-header">
                <h2 class="user-questionnaire-editor__question-title">Вопрос {index() + 1}</h2>
                <div class="user-questionnaire-editor__question-actions">
                  <Button
                    type="button"
                    variant="primary"
                    class="user-questionnaire-editor__duplicate-question"
                    disabled={draft().questions.length >= 50}
                    title="Копировать вопрос"
                    onClick={() =>
                      persist({
                        ...draft(),
                        questions: draft().questions.flatMap((item) =>
                          item.id === question.id
                            ? [item, duplicateUserQuestionnaireQuestion(item)]
                            : [item],
                        ),
                      })
                    }
                    icon={
                      <AppGlyph
                        name="squares-four"
                        class="user-questionnaire-editor__button-icon"
                      />
                    }
                  >
                    Копировать
                  </Button>
                  <Button
                    type="button"
                    variant="icon"
                    class="user-questionnaire-editor__remove-question"
                    aria-label={`Удалить вопрос ${index() + 1}`}
                    title="Удалить вопрос"
                    onClick={() =>
                      persist({
                        ...draft(),
                        questions: draft().questions.filter((item) => item.id !== question.id),
                      })
                    }
                    icon={<AppGlyph name="trash" class="user-questionnaire-editor__button-icon" />}
                  />
                </div>
              </header>
              <label class="user-questionnaire-editor__field">
                <span class="user-questionnaire-editor__label">Формулировка</span>
                <textarea
                  class="user-questionnaire-editor__textarea"
                  value={question.prompt}
                  onInput={(event) =>
                    persist(
                      replaceQuestion(draft(), question.id, (current) => ({
                        ...current,
                        prompt: event.currentTarget.value,
                      })),
                    )
                  }
                />
              </label>
              <label class="user-questionnaire-editor__field">
                <span class="user-questionnaire-editor__label">Текст перед ответами</span>
                <textarea
                  class="user-questionnaire-editor__textarea"
                  value={question.text}
                  placeholder="Необязательное пояснение"
                  onInput={(event) =>
                    persist(
                      replaceQuestion(draft(), question.id, (current) => ({
                        ...current,
                        text: event.currentTarget.value,
                      })),
                    )
                  }
                />
              </label>
              <section class="user-questionnaire-editor__question-media">
                <header class="user-questionnaire-editor__section-header">
                  <h3 class="user-questionnaire-editor__media-title">Изображения к вопросу</h3>
                  <Button
                    type="button"
                    variant="primary"
                    class="user-questionnaire-editor__add-image"
                    onClick={() => openImagePicker(question.id)}
                    icon={<AppGlyph name="image" class="user-questionnaire-editor__button-icon" />}
                  >
                    Добавить
                  </Button>
                </header>
                <ImageList target={question.id} images={question.images} />
              </section>
              <section class="user-questionnaire-editor__options" aria-label="Варианты ответа">
                <h3 class="user-questionnaire-editor__options-title">Варианты ответов</h3>
                <p class="user-questionnaire-editor__options-hint">
                  Веса необязательны. Оставьте их пустыми, если не нужен подсчёт баллов.
                </p>
                <For each={question.options}>
                  {(option) => (
                    <div class="user-questionnaire-editor__option">
                      <label class="user-questionnaire-editor__option-field">
                        <span class="user-questionnaire-editor__option-label">Ответ</span>
                        <input
                          class="user-questionnaire-editor__input"
                          value={option.label}
                          onInput={(event) =>
                            persist(
                              replaceQuestion(draft(), question.id, (current) =>
                                replaceOption(current, option.id, (currentOption) => ({
                                  ...currentOption,
                                  label: event.currentTarget.value,
                                })),
                              ),
                            )
                          }
                        />
                      </label>
                      <label class="user-questionnaire-editor__weight-field">
                        <span class="user-questionnaire-editor__option-label">Вес</span>
                        <input
                          class="user-questionnaire-editor__input"
                          type="number"
                          min="-1000"
                          max="1000"
                          step="1"
                          value={option.weight ?? ''}
                          onInput={(event) => {
                            const value = event.currentTarget.value.trim();
                            const weight = value ? Number(value) : undefined;
                            if (weight !== undefined && !Number.isFinite(weight)) return;
                            persist(
                              replaceQuestion(draft(), question.id, (current) =>
                                replaceOption(current, option.id, (currentOption) => {
                                  const { weight: _weight, ...withoutWeight } = currentOption;
                                  return weight === undefined
                                    ? withoutWeight
                                    : { ...withoutWeight, weight };
                                }),
                              ),
                            );
                          }}
                        />
                      </label>
                      <Show when={question.options.length > 2}>
                        <Button
                          type="button"
                          variant="icon"
                          class="user-questionnaire-editor__remove-option"
                          aria-label={`Удалить вариант «${option.label}»`}
                          onClick={() =>
                            persist(
                              replaceQuestion(draft(), question.id, (current) => ({
                                ...current,
                                options: current.options.filter((item) => item.id !== option.id),
                              })),
                            )
                          }
                          icon={
                            <AppGlyph name="minus" class="user-questionnaire-editor__button-icon" />
                          }
                        />
                      </Show>
                    </div>
                  )}
                </For>
                <Button
                  type="button"
                  variant="primary"
                  class="user-questionnaire-editor__add-option"
                  disabled={question.options.length >= 12}
                  onClick={() =>
                    persist(
                      replaceQuestion(draft(), question.id, (current) => ({
                        ...current,
                        options: [...current.options, createUserQuestionnaireOption()],
                      })),
                    )
                  }
                  icon={<AppGlyph name="plus" class="user-questionnaire-editor__button-icon" />}
                >
                  Вариант ответа
                </Button>
              </section>
            </article>
          )}
        </For>
      </section>

      <Button
        type="button"
        variant="primary"
        class="user-questionnaire-editor__add-question"
        disabled={draft().questions.length >= 50}
        onClick={() =>
          persist({
            ...draft(),
            questions: [...draft().questions, createUserQuestionnaireQuestion()],
          })
        }
        icon={<AppGlyph name="plus" class="user-questionnaire-editor__button-icon" />}
      >
        Добавить вопрос
      </Button>

      <p
        class="user-questionnaire-editor__save-state"
        classList={{ 'user-questionnaire-editor__save-state--error': saveState() === 'error' }}
        role="status"
      >
        {saveState() === 'saving'
          ? 'Сохраняем черновик…'
          : saveState() === 'error'
            ? error()
            : (readinessError() ?? 'Черновик сохранён')}
      </p>
    </div>
  );
}
