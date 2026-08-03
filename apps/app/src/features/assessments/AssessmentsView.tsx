import { createMemo, createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AssessmentCatalogPage } from '@/features/assessments/AssessmentCatalogPage';
import { AssessmentQuestionnairePage } from '@/features/assessments/AssessmentQuestionnairePage';
import { AssessmentResultPage } from '@/features/assessments/AssessmentResultPage';
import {
  ASSESSMENT_CATALOG,
  findAssessmentBySlug,
  searchAssessments,
} from '@/features/assessments/assessment-catalog';
import {
  ASSESSMENT_PACKS_EVENT,
  installAssessmentIds,
  installAssessmentSection,
  loadInstalledAssessmentIds,
  removeAssessmentIds,
  removeAssessmentSection,
  type AssessmentSectionId,
} from '@/features/assessments/assessment-packs';
import type { AssessmentRecord } from '@/features/assessments/assessment-types';
import {
  ASSESSMENT_RESULTS_EVENT,
  loadAssessmentRecords,
  removeAssessmentRecord,
} from '@/state/assessment-results';
import {
  loadPatientNotes,
  PATIENT_NOTES_EVENT,
  type PatientNotesSnapshot,
} from '@/state/patient-notes';

type AssessmentRoute =
  | { readonly kind: 'index' }
  | { readonly kind: 'assessment'; readonly slug: string }
  | { readonly kind: 'result'; readonly slug: string; readonly recordId: string };

function readRoute(): AssessmentRoute {
  const parts = window.location.hash.replace(/^#\/?/u, '').split('/');
  if (parts[0] !== 'assessments' || !parts[1]) return { kind: 'index' };
  try {
    const slug = decodeURIComponent(parts[1]);
    if (parts[2] === 'results' && parts[3]) {
      return { kind: 'result', slug, recordId: decodeURIComponent(parts[3]) };
    }
    return { kind: 'assessment', slug };
  } catch {
    return { kind: 'index' };
  }
}

function assessmentPath(slug: string): string {
  return `#/assessments/${encodeURIComponent(slug)}`;
}

function resultPath(slug: string, recordId: string): string {
  return `${assessmentPath(slug)}/results/${encodeURIComponent(recordId)}`;
}

export function AssessmentsView(): JSX.Element {
  const [route, setRoute] = createSignal<AssessmentRoute>(readRoute());
  const [query, setQuery] = createSignal('');
  const [records, setRecords] = createSignal<readonly AssessmentRecord[]>([]);
  const [notes, setNotes] = createSignal<PatientNotesSnapshot>({ cards: [], notes: [] });
  const [installedIds, setInstalledIds] = createSignal<ReadonlySet<string>>(
    loadInstalledAssessmentIds(ASSESSMENT_CATALOG),
  );
  const [message, setMessage] = createSignal('');

  const refreshRecords = (): void => {
    setRecords(loadAssessmentRecords());
  };
  const refreshNotes = (): void => {
    setNotes(loadPatientNotes());
  };
  const refreshPacks = (): void => {
    setInstalledIds(loadInstalledAssessmentIds(ASSESSMENT_CATALOG));
  };
  const handleHashChange = (): void => {
    setRoute(readRoute());
    setMessage('');
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  onMount(() => {
    refreshRecords();
    refreshNotes();
    refreshPacks();
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener(ASSESSMENT_RESULTS_EVENT, refreshRecords);
    window.addEventListener(PATIENT_NOTES_EVENT, refreshNotes);
    window.addEventListener(ASSESSMENT_PACKS_EVENT, refreshPacks);
  });

  onCleanup(() => {
    window.removeEventListener('hashchange', handleHashChange);
    window.removeEventListener(ASSESSMENT_RESULTS_EVENT, refreshRecords);
    window.removeEventListener(PATIENT_NOTES_EVENT, refreshNotes);
    window.removeEventListener(ASSESSMENT_PACKS_EVENT, refreshPacks);
  });

  const definition = createMemo(() => {
    const current = route();
    return current.kind === 'index' ? undefined : findAssessmentBySlug(current.slug);
  });
  const definitionInstalled = createMemo(() => {
    const current = definition();
    return Boolean(current && installedIds().has(current.id));
  });
  const record = createMemo(() => {
    const current = route();
    if (current.kind !== 'result') return undefined;
    return records().find(
      (candidate) =>
        candidate.id === current.recordId && candidate.assessmentId === definition()?.id,
    );
  });
  const navigate = (hash: string): void => {
    window.location.hash = hash;
  };
  const installDefinition = (id: string): void => {
    setInstalledIds(installAssessmentIds([id], ASSESSMENT_CATALOG));
    setMessage('Опросник добавлен на устройство.');
  };
  const removeDefinition = (id: string): void => {
    setInstalledIds(removeAssessmentIds([id], ASSESSMENT_CATALOG));
    setMessage('Опросник удалён с устройства. Сохранённые результаты не изменены.');
  };
  const installSection = (sectionId: AssessmentSectionId): void => {
    setInstalledIds(installAssessmentSection(sectionId, ASSESSMENT_CATALOG));
    setMessage('Раздел опросников добавлен на устройство.');
  };
  const removeSection = (sectionId: AssessmentSectionId): void => {
    if (!window.confirm('Удалить все опросники этого раздела с устройства?')) return;
    setInstalledIds(removeAssessmentSection(sectionId, ASSESSMENT_CATALOG));
    setMessage('Раздел удалён. Сохранённые результаты не изменены.');
  };

  return (
    <section class="assessments-page page-surface" aria-label="Тесты и опросники">
      <Show when={message()}>
        {(value) => (
          <div class="assessment-message" role="status">
            {value()}
          </div>
        )}
      </Show>

      <Show when={route().kind === 'index'}>
        <AssessmentCatalogPage
          definitions={searchAssessments(query())}
          installedIds={installedIds()}
          query={query()}
          recentRecords={records().slice(0, 8)}
          onQuery={setQuery}
          onOpen={(selected) => navigate(assessmentPath(selected.slug))}
          onOpenRecord={(selected, selectedRecord) =>
            navigate(resultPath(selected.slug, selectedRecord.id))
          }
          onInstall={(selected) => installDefinition(selected.id)}
          onRemove={(selected) => removeDefinition(selected.id)}
          onInstallSection={installSection}
          onRemoveSection={removeSection}
        />
      </Show>

      <Show when={route().kind === 'assessment' && definition() && definitionInstalled()}>
        {(selected) => (
          <AssessmentQuestionnairePage
            definition={selected()}
            onBack={() => navigate('#/assessments')}
            onMessage={setMessage}
            onSaved={(saved) => {
              refreshRecords();
              navigate(resultPath(selected().slug, saved.id));
            }}
          />
        )}
      </Show>

      <Show when={route().kind === 'assessment' && definition() && !definitionInstalled()}>
        {(selected) => (
          <section class="assessment-pack-required paper-card">
            <h1>{selected().title}</h1>
            <p>Опросник не установлен. Его можно добавить отдельно, не загружая весь раздел.</p>
            <div>
              <button type="button" onClick={() => installDefinition(selected().id)}>
                Скачать опросник
              </button>
              <button type="button" onClick={() => navigate('#/assessments')}>
                К разделам
              </button>
            </div>
          </section>
        )}
      </Show>

      <Show when={route().kind === 'result' && definition() && record()}>
        {(selectedRecord) => (
          <AssessmentResultPage
            definition={definition() as NonNullable<ReturnType<typeof definition>>}
            record={selectedRecord()}
            notes={notes()}
            onBack={() => navigate(assessmentPath(definition()?.slug ?? ''))}
            onMessage={setMessage}
            onNotesChanged={setNotes}
            onDelete={() => {
              removeAssessmentRecord(selectedRecord().id);
              refreshRecords();
              navigate('#/assessments');
            }}
          />
        )}
      </Show>

      <Show when={route().kind !== 'index' && !definition()}>
        <section class="assessment-not-found paper-card">
          <h1>Опросник не найден</h1>
          <p>Возможно, банк знаний был обновлён или ссылка устарела.</p>
          <button type="button" onClick={() => navigate('#/assessments')}>
            К каталогу
          </button>
        </section>
      </Show>
    </section>
  );
}
