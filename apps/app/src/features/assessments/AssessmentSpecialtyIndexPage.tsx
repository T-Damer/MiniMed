import { For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { AssessmentCard } from '@/features/assessments/AssessmentCatalogPage';
import {
  ASSESSMENT_SPECIALTIES,
  assessmentsInSpecialty,
  findAssessmentById,
  type searchAssessments,
} from '@/features/assessments/assessment-catalog';
import {
  type AssessmentInstallationState,
  assessmentRequiredByModules,
} from '@/features/assessments/assessment-packs';
import type { AssessmentRecord } from '@/features/assessments/assessment-types';

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function AssessmentSpecialtyIndexPage(props: {
  readonly definitions: ReturnType<typeof searchAssessments>;
  readonly matches: ReturnType<typeof searchAssessments>;
  readonly installation: AssessmentInstallationState;
  readonly query: string;
  readonly recentRecords: readonly AssessmentRecord[];
  readonly onQuery: (value: string) => void;
  readonly onOpenSpecialty: (specialtyId: string) => void;
  readonly onOpen: (definition: ReturnType<typeof searchAssessments>[number]) => void;
  readonly onOpenRecord: (
    definition: ReturnType<typeof searchAssessments>[number],
    record: AssessmentRecord,
  ) => void;
  readonly onInstall: (definition: ReturnType<typeof searchAssessments>[number]) => void;
  readonly onRemove: (definition: ReturnType<typeof searchAssessments>[number]) => void;
  readonly onPrint: (definition: ReturnType<typeof searchAssessments>[number]) => void;
}): JSX.Element {
  const installed = (id: string): boolean => props.installation.installedIds.has(id);
  const hasQuery = () => props.query.trim().length > 0;

  return (
    <>
      <header class="subpage-heading assessments-heading">
        <div>
          <p class="archive-kicker">Тесты и опросники</p>
          <div class="tool-page-title">
            <AppGlyph name="list-checks" />
            <h1>Тесты и опросники</h1>
          </div>
          <p>
            Выберите раздел медицины, скачайте нужные тесты на устройство и проходите их без сети.
            Результаты сохраняются локально и не отправляются в интернет.
          </p>
        </div>
      </header>

      <label class="assessment-search">
        <span>Найти тест</span>
        <input
          type="search"
          value={props.query}
          placeholder="Например: Белбин, темперамент, эгограмма"
          onInput={(event) => props.onQuery(event.currentTarget.value)}
        />
      </label>

      <Show
        when={hasQuery()}
        fallback={
          <div class="assessment-specialty-grid">
            <For each={ASSESSMENT_SPECIALTIES}>
              {(specialty) => {
                const specialtyDefinitions = () =>
                  assessmentsInSpecialty(specialty.id, props.definitions);
                const installedCount = () =>
                  specialtyDefinitions().filter((definition) => installed(definition.id)).length;
                const empty = () => specialtyDefinitions().length === 0;
                return (
                  <button
                    type="button"
                    class="assessment-specialty-card paper-card"
                    classList={{ 'assessment-specialty-card-empty': empty() }}
                    disabled={empty()}
                    data-testid={`assessment-specialty-${specialty.id}`}
                    onClick={() => props.onOpenSpecialty(specialty.id)}
                  >
                    <p class="archive-kicker">Раздел тестов</p>
                    <h2>{specialty.title}</h2>
                    <p>{specialty.description}</p>
                    <small>
                      {empty()
                        ? 'Тесты появятся позже'
                        : `${installedCount()}/${specialtyDefinitions().length} тестов на устройстве`}
                    </small>
                  </button>
                );
              }}
            </For>
          </div>
        }
      >
        <Show when={props.matches.length > 0} fallback={<p>По этому запросу ничего не найдено.</p>}>
          <div class="assessment-catalog-grid">
            <For each={props.matches}>
              {(definition) => {
                const requiredModules = () =>
                  assessmentRequiredByModules(definition.id, props.installation);
                const hasUserManagedSource = () =>
                  props.installation.manualIds.has(definition.id) ||
                  (props.installation.sectionIds.has(definition.category) &&
                    !props.installation.excludedIds.has(definition.id));
                return (
                  <AssessmentCard
                    definition={definition}
                    installed={installed(definition.id)}
                    canDelete={hasUserManagedSource()}
                    requiredModules={requiredModules()}
                    onOpen={props.onOpen}
                    onInstall={props.onInstall}
                    onRemove={props.onRemove}
                    onPrint={props.onPrint}
                  />
                );
              }}
            </For>
          </div>
        </Show>
      </Show>

      <Show when={props.recentRecords.length > 0}>
        <section class="assessment-history">
          <header>
            <p class="archive-kicker">Локальная история</p>
            <h2>Последние результаты</h2>
          </header>
          <div class="assessment-history-list">
            <For each={props.recentRecords}>
              {(record) => {
                const definition = () => findAssessmentById(record.assessmentId);
                return (
                  <Show when={definition()}>
                    {(resolved) => (
                      <button type="button" onClick={() => props.onOpenRecord(resolved(), record)}>
                        <span>{resolved().shortTitle}</span>
                        <strong>
                          {record.subjectLabel || 'Без подписи'} · {formatDate(record.createdAt)}
                        </strong>
                        <small>
                          {record.kind === 'completed'
                            ? record.result.headline
                            : 'Результат внесён вручную'}
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
