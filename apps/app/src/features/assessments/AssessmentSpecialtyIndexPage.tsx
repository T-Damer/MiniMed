import { createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { FileDropZone } from '@/components/FileDropZone';
import { NavBack } from '@/components/NavBack';
import { OverlayDialog } from '@/components/OverlayDialog';
import { Page } from '@/components/Page';
import { QueryEmptyState } from '@/components/QueryEmptyState';
import { SearchField } from '@/components/SearchField';
import { Heading } from '@/components/Text';
import {
  assessmentsInSpecialty,
  findAssessmentById,
  type searchAssessments,
  visibleAssessmentSpecialties,
} from '@/features/assessments/assessment-catalog';
import {
  type AssessmentInstallationState,
  moduleIdForAssessmentSpecialty,
} from '@/features/assessments/assessment-packs';
import type { AssessmentRecord } from '@/features/assessments/assessment-types';
import { ToolAgeBadge } from '@/features/tools/ToolAgeBadge';
import { ToolAgeFilterBar } from '@/features/tools/ToolAgeFilterBar';
import { type ToolAgeFilter, toolMatchesAgeFilter } from '@/features/tools/tool-age-filter';
import { assessmentCountLabel, pluralRu } from '@/i18n/labels';
import { userQuestionnaireReadinessError } from '@/state/user-questionnaire-rules';
import {
  type StoredUserQuestionnaire,
  userQuestionnaireAgeScope,
} from '@/state/user-questionnaires';

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function questionCountLabel(count: number): string {
  return `${count} ${pluralRu(count, 'вопрос', 'вопроса', 'вопросов')}`;
}

export function AssessmentSpecialtyIndexPage(props: {
  readonly mineOnly: boolean;
  /** The tests to count and list: the age filter already applied. */
  readonly definitions: ReturnType<typeof searchAssessments>;
  /** The same catalog before the age filter. */
  readonly allDefinitions: ReturnType<typeof searchAssessments>;
  readonly ageFilter: ToolAgeFilter;
  readonly onAgeFilter: (filter: ToolAgeFilter) => void;
  readonly matches: ReturnType<typeof searchAssessments>;
  readonly installation: AssessmentInstallationState;
  readonly query: string;
  readonly recentRecords: readonly AssessmentRecord[];
  readonly userQuestionnaires: readonly StoredUserQuestionnaire[];
  readonly onQuery: (value: string) => void;
  readonly onBack: () => void;
  readonly onOpenSpecialty: (specialtyId: string) => void;
  readonly onOpenUserQuestionnaires: () => void;
  readonly onCreateUserQuestionnaire: () => void;
  readonly onOpenUserQuestionnaire: (fileId: string) => void;
  readonly onEditUserQuestionnaire: (fileId: string) => void;
  readonly onExportUserQuestionnaire: (fileId: string) => void;
  readonly onDuplicateUserQuestionnaire: (fileId: string) => void;
  readonly onDeleteUserQuestionnaire: (fileId: string) => void;
  readonly onImportUserQuestionnaire: (file: File) => void;
  readonly onOpenRecord: (
    definition: ReturnType<typeof searchAssessments>[number],
    record: AssessmentRecord,
  ) => void;
}): JSX.Element {
  const installed = (id: string): boolean => props.installation.installedIds.has(id);
  const hasQuery = () => props.query.trim().length > 0;
  const visibleSpecialties = () =>
    visibleAssessmentSpecialties(props.query, props.definitions, props.matches);
  const userQuestionnairesForAge = () =>
    props.userQuestionnaires.filter((stored) =>
      toolMatchesAgeFilter(userQuestionnaireAgeScope(stored.questionnaire), props.ageFilter),
    );
  const visibleUserQuestionnaires = () => {
    const query = props.query.trim();
    if (!query) return userQuestionnairesForAge();
    const normalizedQuery = query.toLocaleLowerCase('ru-RU');
    return userQuestionnairesForAge().filter((stored) =>
      [
        stored.file.title,
        stored.questionnaire.description,
        ...stored.questionnaire.questions.flatMap((question) => [
          question.prompt,
          ...question.options.map((option) => option.label),
        ]),
      ].some((value) => value.toLocaleLowerCase('ru-RU').includes(normalizedQuery)),
    );
  };
  const [importOpen, setImportOpen] = createSignal(false);

  return (
    <>
      <Page
        class="assessment-catalog-page-header"
        {...(props.mineOnly
          ? {
              navigation: (
                <NavBack
                  class="assessment-user-questionnaires__back"
                  aria-label="К тестам и опросникам"
                  onClick={props.onBack}
                />
              ),
              actions: (
                <>
                  <Button
                    type="button"
                    variant="icon"
                    class="assessment-user-questionnaires__import"
                    aria-label="Импортировать опросник"
                    title="Импортировать опросник"
                    onClick={() => setImportOpen(true)}
                    icon={
                      <AppGlyph
                        name="file-arrow-down"
                        class="assessment-user-questionnaires__icon"
                      />
                    }
                  />
                  <Button
                    type="button"
                    variant="icon"
                    class="assessment-user-questionnaires__create ui-button--primary"
                    aria-label="Создать опросник"
                    title="Создать опросник"
                    onClick={props.onCreateUserQuestionnaire}
                    icon={<AppGlyph name="plus" class="assessment-user-questionnaires__icon" />}
                  />
                </>
              ),
            }
          : {})}
        icon={
          <AppGlyph name={props.mineOnly ? 'notepad' : 'list-checks'} class="page__icon-glyph" />
        }
        title={
          <Heading depth={1}>{props.mineOnly ? 'Мои опросники' : 'Тесты и опросники'}</Heading>
        }
        {...(props.mineOnly ? {} : { description: 'Тесты и шкалы, работают без сети.' })}
      />

      <ToolAgeFilterBar
        class="assessment-index__age-filter"
        value={props.ageFilter}
        onChange={props.onAgeFilter}
        hidden={
          props.mineOnly
            ? props.userQuestionnaires.length - userQuestionnairesForAge().length
            : props.allDefinitions.length - props.definitions.length
        }
      />

      <div class="assessment-search-row">
        <SearchField
          class="assessment-search"
          value={props.query}
          placeholder={
            props.mineOnly
              ? 'Название, описание или вопрос'
              : 'Например: Белбин, темперамент, эгограмма'
          }
          label={props.mineOnly ? 'Найти опросник' : 'Найти тест'}
          hideLabel
          onInput={props.onQuery}
          onClear={() => props.onQuery('')}
        />
      </div>

      <Show
        when={
          props.mineOnly ||
          !hasQuery() ||
          visibleSpecialties().length > 0 ||
          visibleUserQuestionnaires().length > 0
        }
        fallback={<QueryEmptyState />}
      >
        <Show when={!props.mineOnly}>
          <div class="assessment-specialty-grid">
            <Show when={!hasQuery()}>
              <button
                type="button"
                class="assessment-specialty-card assessment-specialty-card--user paper-card"
                onClick={props.onOpenUserQuestionnaires}
              >
                <AppGlyph name="notepad" class="assessment-specialty-card__icon" />
                <p class="archive-kicker assessment-specialty-card__kicker">Локальные файлы</p>
                <h2 class="assessment-specialty-card__title">Мои опросники</h2>
                <p class="assessment-specialty-card__description">
                  Создавайте, открывайте и редактируйте свои опросники.
                </p>
              </button>
            </Show>
            <For each={visibleSpecialties()}>
              {(specialty) => {
                const specialtyDefinitions = () =>
                  assessmentsInSpecialty(specialty.id, props.definitions);
                const installedCount = () =>
                  specialtyDefinitions().filter((definition) => installed(definition.id)).length;
                const empty = () => specialtyDefinitions().length === 0;
                // Tests exist for the specialty but the age choice hides all of them.
                const hiddenByAge = () =>
                  empty() && assessmentsInSpecialty(specialty.id, props.allDefinitions).length > 0;
                const emptyLabel = () =>
                  hiddenByAge()
                    ? 'Нет тестов для выбранного возраста'
                    : moduleIdForAssessmentSpecialty(specialty.id)
                      ? 'Набор тестов не загружен'
                      : 'Тесты появятся позже';
                return (
                  <button
                    type="button"
                    class="assessment-specialty-card paper-card"
                    classList={{ 'assessment-specialty-card--empty': empty() }}
                    disabled={empty()}
                    data-testid={`assessment-specialty-${specialty.id}`}
                    onClick={() => props.onOpenSpecialty(specialty.id)}
                  >
                    <p class="archive-kicker assessment-specialty-card__kicker">Раздел тестов</p>
                    <h2 class="assessment-specialty-card__title">{specialty.title}</h2>
                    <p class="assessment-specialty-card__description">{specialty.description}</p>
                    <small class="assessment-specialty-card__meta">
                      {empty()
                        ? emptyLabel()
                        : installedCount() === specialtyDefinitions().length
                          ? assessmentCountLabel(specialtyDefinitions().length)
                          : `${installedCount()}/${assessmentCountLabel(specialtyDefinitions().length)} на устройстве`}
                    </small>
                  </button>
                );
              }}
            </For>
          </div>
        </Show>
      </Show>

      <Show when={props.mineOnly}>
        <section class="assessment-user-questionnaires">
          <OverlayDialog
            open={importOpen()}
            title="Импорт опросника"
            class="assessment-import-dialog"
            bodyClass="assessment-import-dialog__body"
            onClose={() => setImportOpen(false)}
          >
            <FileDropZone
              accept=".json,.minimed-questionnaire,application/vnd.minimed.questionnaire+json,application/json"
              title="Файл опросника MiniMed"
              onFile={(file) => {
                setImportOpen(false);
                props.onImportUserQuestionnaire(file);
              }}
            />
            <div class="assessment-import-dialog__format">
              <p class="assessment-import-dialog__text">
                Подходит файл, который вы или коллега выгрузили кнопкой «Экспорт» у своего
                опросника. Это JSON-файл: название, для кого опросник, разделы, вопросы с вариантами
                ответов, баллы и диапазоны результата.
              </p>
              <pre class="assessment-import-dialog__example">{`{
  "format": "minimed-questionnaire",
  "version": 2,
  "title": "Мой опросник",
  "population": { "group": "adults" },
  "questions": [
    { "prompt": "Вопрос 1",
      "options": [
        { "label": "Нет", "weight": 0 },
        { "label": "Да", "weight": 1 }
      ] }
  ]
}`}</pre>
              <p class="assessment-import-dialog__text">
                Импортированный опросник появится в списке и откроется для правки. Если в файле не
                указано, для кого он, выберите возраст пациентов — без этого опросник не откроется.
              </p>
            </div>
          </OverlayDialog>
          <Show when={visibleUserQuestionnaires().length === 0}>
            <p class="assessment-user-questionnaires__empty" role="status">
              {props.userQuestionnaires.length > 0 && !hasQuery()
                ? 'Для выбранного возраста своих опросников нет. Выберите «Все», чтобы увидеть остальные.'
                : hasQuery()
                  ? 'По этому запросу своих опросников не найдено.'
                  : 'Своих опросников пока нет. Создайте первый кнопкой «+» или импортируйте файл.'}
            </p>
          </Show>
          <div class="assessment-user-questionnaires__grid">
            <For each={visibleUserQuestionnaires()}>
              {(stored) => {
                const readinessError = () => userQuestionnaireReadinessError(stored.questionnaire);
                return (
                  <article class="assessment-user-questionnaire paper-card">
                    <div class="assessment-user-questionnaire__topline">
                      <span class="assessment-user-questionnaire__file">Локальный файл</span>
                      <div class="assessment-user-questionnaire__actions">
                        <Button
                          type="button"
                          variant="icon"
                          class="assessment-user-questionnaire__action"
                          aria-label={`Редактировать «${stored.file.title}»`}
                          title="Редактировать"
                          onClick={() => props.onEditUserQuestionnaire(stored.file.id)}
                          icon={
                            <AppGlyph name="edit" class="assessment-user-questionnaire__icon" />
                          }
                        />
                        <Button
                          type="button"
                          variant="icon"
                          class="assessment-user-questionnaire__action"
                          aria-label={`Экспортировать «${stored.file.title}»`}
                          title="Экспортировать"
                          onClick={() => props.onExportUserQuestionnaire(stored.file.id)}
                          icon={
                            <AppGlyph name="share" class="assessment-user-questionnaire__icon" />
                          }
                        />
                        <Button
                          type="button"
                          variant="icon"
                          class="assessment-user-questionnaire__action"
                          aria-label={`Создать копию «${stored.file.title}»`}
                          title="Создать копию"
                          onClick={() => props.onDuplicateUserQuestionnaire(stored.file.id)}
                          icon={
                            <AppGlyph
                              name="squares-four"
                              class="assessment-user-questionnaire__icon"
                            />
                          }
                        />
                        <Button
                          type="button"
                          variant="icon"
                          class="assessment-user-questionnaire__action"
                          aria-label={`Удалить «${stored.file.title}»`}
                          title="Удалить"
                          onClick={() => props.onDeleteUserQuestionnaire(stored.file.id)}
                          icon={
                            <AppGlyph name="trash" class="assessment-user-questionnaire__icon" />
                          }
                        />
                      </div>
                    </div>
                    <h3 class="assessment-user-questionnaire__title">{stored.file.title}</h3>
                    <p class="assessment-user-questionnaire__description">
                      {stored.questionnaire.description || 'Без вводного текста'}
                    </p>
                    <small class="assessment-user-questionnaire__meta">
                      {questionCountLabel(stored.questionnaire.questions.length)}
                    </small>
                    <Show
                      when={stored.questionnaire.population}
                      fallback={
                        <span class="assessment-user-questionnaire__population-missing">
                          Не указано, для кого опросник
                        </span>
                      }
                    >
                      <ToolAgeBadge scope={userQuestionnaireAgeScope(stored.questionnaire)} />
                    </Show>
                    <Button
                      type="button"
                      class="assessment-user-questionnaire__open"
                      disabled={Boolean(readinessError())}
                      title={readinessError() ?? 'Открыть опросник'}
                      onClick={() => props.onOpenUserQuestionnaire(stored.file.id)}
                      icon={
                        <AppGlyph name="list-checks" class="assessment-user-questionnaire__icon" />
                      }
                    >
                      Пройти
                    </Button>
                  </article>
                );
              }}
            </For>
          </div>
        </section>
      </Show>

      <Show when={!props.mineOnly && props.recentRecords.length > 0}>
        <section class="assessment-history">
          <header class="assessment-history__header">
            <p class="archive-kicker">Локальная история</p>
            <h2 class="assessment-history__heading">Последние результаты</h2>
          </header>
          <div class="assessment-history-list">
            <For each={props.recentRecords}>
              {(record) => {
                const definition = () => findAssessmentById(record.assessmentId);
                return (
                  <Show when={definition()}>
                    {(resolved) => (
                      <button
                        class="assessment-history__entry"
                        type="button"
                        onClick={() => props.onOpenRecord(resolved(), record)}
                      >
                        <span class="assessment-history__title">{resolved().shortTitle}</span>
                        <strong class="assessment-history__subject">
                          {record.subjectLabel || 'Без подписи'} · {formatDate(record.createdAt)}
                        </strong>
                        <small class="assessment-history__summary">
                          {record.kind === 'completed' && record.result.headline}
                          {record.kind === 'manual' && 'Результат внесён вручную'}
                          {record.kind === 'incomplete' && (
                            <>
                              <span class="assessment-history__tag">Черновик</span>{' '}
                              <span class="assessment-history__count">
                                {Object.keys(record.answers).length}/{record.totalQuestions}{' '}
                                отвечено
                              </span>
                            </>
                          )}
                        </small>
                      </button>
                    )}
                  </Show>
                );
              }}
            </For>
          </div>
        </section>
      </Show>
    </>
  );
}
