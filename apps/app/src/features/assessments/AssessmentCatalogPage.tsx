import { For, type JSX, Show } from 'solid-js';

import {
  findAssessmentById,
  type searchAssessments,
} from '@/features/assessments/assessment-catalog';
import { printBlankAssessment } from '@/features/assessments/assessment-print';
import type {
  AssessmentDefinition,
  AssessmentRecord,
} from '@/features/assessments/assessment-types';

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function AssessmentCatalogPage(props: {
  readonly definitions: ReturnType<typeof searchAssessments>;
  readonly query: string;
  readonly recentRecords: readonly AssessmentRecord[];
  readonly onQuery: (value: string) => void;
  readonly onOpen: (definition: AssessmentDefinition) => void;
  readonly onOpenRecord: (definition: AssessmentDefinition, record: AssessmentRecord) => void;
}): JSX.Element {
  return (
    <>
      <header class="subpage-heading assessments-heading">
        <div>
          <p class="archive-kicker">Психометрия и самонаблюдение</p>
          <h1>Тесты и опросники</h1>
          <p>
            Пройти на устройстве, записать внешний результат, сохранить в карточку,
            распечатать или отправить.
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

      <div class="assessment-catalog-grid">
        <For each={props.definitions}>
          {(definition) => (
            <article class="assessment-card paper-card">
              <div class="assessment-card-meta">
                <span>{definition.bankLabel}</span>
                <span>{definition.estimatedMinutes} мин</span>
                <span>{definition.questions.length} пунктов</span>
              </div>
              <h2>{definition.title}</h2>
              <p>{definition.description}</p>
              <small>{definition.audience}</small>
              <div class="assessment-card-actions">
                <button
                  type="button"
                  data-testid={`assessment-open-${definition.slug}`}
                  onClick={() => props.onOpen(definition)}
                >
                  Пройти
                </button>
                <button type="button" onClick={() => printBlankAssessment(definition)}>
                  Распечатать бланк
                </button>
              </div>
            </article>
          )}
        </For>
      </div>

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
                      <button
                        type="button"
                        onClick={() => props.onOpenRecord(resolved(), record)}
                      >
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
