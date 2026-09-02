import { For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { NavBack } from '@/components/NavBack';
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
import { assessmentCountLabel } from '@/i18n/labels';
import {
  type StoredUserQuestionnaire,
  userQuestionnaireReadinessError,
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
  const plural = new Intl.PluralRules('ru-RU').select(count);
  return `${count} ${plural === 'one' ? 'вопрос' : plural === 'few' ? 'вопроса' : 'вопросов'}`;
}

export function AssessmentSpecialtyIndexPage(props: {
  readonly mineOnly: boolean;
  readonly definitions: ReturnType<typeof searchAssessments>;
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
  const visibleUserQuestionnaires = () => {
    const query = props.query.trim();
    if (!query) return props.userQuestionnaires;
    const normalizedQuery = query.toLocaleLowerCase('ru-RU');
    return props.userQuestionnaires.filter((stored) =>
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
  let importInput: HTMLInputElement | undefined;

  return (
    <>
      <Show when={props.mineOnly}>
        <div class="assessment-user-questionnaires__search-chrome knowledge-subroute-heading knowledge-subroute-heading--blurred">
          <NavBack
            class="assessment-user-questionnaires__back knowledge-subroute-heading__control"
            aria-label={hasQuery() ? 'Очистить поиск' : 'К тестам и опросникам'}
            onClick={() => (hasQuery() ? props.onQuery('') : props.onBack())}
            icon={<AppGlyph name={hasQuery() ? 'close' : 'arrow-left'} />}
          />
          <SearchField
            class="assessment-search route-search knowledge-subroute-heading__control"
            value={props.query}
            placeholder="Название, описание или вопрос"
            label="Найти опросник"
            hideLabel
            onInput={props.onQuery}
          />
          <Button
            type="button"
            variant="icon"
            class="assessment-user-questionnaires__create knowledge-subroute-heading__control ui-button--primary"
            aria-label="Создать опросник"
            title="Создать опросник"
            onClick={props.onCreateUserQuestionnaire}
            icon={<AppGlyph name="plus" class="assessment-user-questionnaires__icon" />}
          />
        </div>
      </Show>

      <Page
        class="assessment-catalog-page-header"
        actions={
          props.mineOnly ? (
            <Button
              type="button"
              variant="primary"
              class="assessment-user-questionnaires__import"
              onClick={() => importInput?.click()}
              icon={
                <AppGlyph name="file-arrow-down" class="assessment-user-questionnaires__icon" />
              }
            >
              Импорт
            </Button>
          ) : undefined
        }
        icon={
          <AppGlyph name={props.mineOnly ? 'notepad' : 'list-checks'} class="page__icon-glyph" />
        }
        title={
          <Heading depth={1}>{props.mineOnly ? 'Мои опросники' : 'Тесты и опросники'}</Heading>
        }
        description={
          props.mineOnly
            ? 'Создавайте свои опросники, проходите их и редактируйте локально.'
            : 'Выберите раздел медицины и проходите тесты без сети. Результаты сохраняются локально и не отправляются в интернет.'
        }
      />

      <Show when={!props.mineOnly}>
        <div class="assessment-search-row">
          <SearchField
            class="assessment-search"
            value={props.query}
            placeholder="Например: Белбин, темперамент, эгограмма"
            label="Найти тест"
            hideLabel
            onInput={props.onQuery}
            onClear={() => props.onQuery('')}
          />
        </div>
      </Show>

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
                const emptyLabel = () =>
                  moduleIdForAssessmentSpecialty(specialty.id)
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
          <input
            ref={(element) => {
              importInput = element;
            }}
            class="assessment-user-questionnaires__input"
            type="file"
            accept=".minimed-questionnaire,application/vnd.minimed.questionnaire+json,application/json"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) props.onImportUserQuestionnaire(file);
            }}
          />
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
                      </div>
                    </div>
                    <h3 class="assessment-user-questionnaire__title">{stored.file.title}</h3>
                    <p class="assessment-user-questionnaire__description">
                      {stored.questionnaire.description || 'Без вводного текста'}
                    </p>
                    <small class="assessment-user-questionnaire__meta">
                      {questionCountLabel(stored.questionnaire.questions.length)}
                    </small>
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
                              <span class="assessment-history__tag">incomplete</span>{' '}
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
