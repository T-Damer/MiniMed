import {
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';

import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { AssessmentCatalogPage } from '@/features/assessments/AssessmentCatalogPage';
import { AssessmentQuestionnairePage } from '@/features/assessments/AssessmentQuestionnairePage';
import { AssessmentResultPage } from '@/features/assessments/AssessmentResultPage';
import { AssessmentSpecialtyIndexPage } from '@/features/assessments/AssessmentSpecialtyIndexPage';
import {
  ASSESSMENT_CATALOG,
  assessmentsInSpecialty,
  findAssessmentBySlug,
  findAssessmentSpecialty,
  loadAssessmentDefinition,
  preloadAssessmentDefinitions,
  searchAssessments,
} from '@/features/assessments/assessment-catalog';
import {
  ASSESSMENT_PACKS_EVENT,
  ASSESSMENT_SECTIONS,
  type AssessmentInstallationState,
  type AssessmentSectionId,
  assessmentIdsInSection,
  assessmentRequiredByModules,
  installAssessmentIds,
  installAssessmentSection,
  loadAssessmentInstallationState,
  removeAssessmentIds,
  removeAssessmentSection,
} from '@/features/assessments/assessment-packs';
import { printBlankAssessment } from '@/features/assessments/assessment-print';
import type {
  AssessmentDefinition,
  AssessmentRecord,
} from '@/features/assessments/assessment-types';
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
  | { readonly kind: 'specialty'; readonly specialtyId: string }
  | { readonly kind: 'assessment'; readonly slug: string }
  | { readonly kind: 'result'; readonly slug: string; readonly recordId: string };

function readRoute(): AssessmentRoute {
  const parts = window.location.hash.replace(/^#\/?/u, '').split('/');
  if (parts[0] !== 'assessments' || !parts[1]) return { kind: 'index' };
  try {
    const slug = decodeURIComponent(parts[1]);
    if (findAssessmentSpecialty(slug)) return { kind: 'specialty', specialtyId: slug };
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

function specialtyPath(specialtyId: string): string {
  return `#/assessments/${encodeURIComponent(specialtyId)}`;
}

function resultPath(slug: string, recordId: string): string {
  return `${assessmentPath(slug)}/results/${encodeURIComponent(recordId)}`;
}

export function AssessmentsView(): JSX.Element {
  const [route, setRoute] = createSignal<AssessmentRoute>(readRoute());
  const [query, setQuery] = createSignal('');
  const [records, setRecords] = createSignal<readonly AssessmentRecord[]>([]);
  const [notes, setNotes] = createSignal<PatientNotesSnapshot>({ cards: [], notes: [] });
  const [installation, setInstallation] = createSignal<AssessmentInstallationState>(
    loadAssessmentInstallationState(ASSESSMENT_CATALOG),
  );
  const [loadedDefinition, setLoadedDefinition] = createSignal<AssessmentDefinition>();
  const [definitionLoading, setDefinitionLoading] = createSignal(false);
  const [definitionError, setDefinitionError] = createSignal('');
  const [message, setMessage] = createSignal('');
  const [pendingDeletion, setPendingDeletion] = createSignal<{
    readonly kind: 'assessment' | 'section' | 'result';
    readonly id: string;
    readonly title: string;
  } | null>(null);
  let definitionRequest = 0;

  const refreshRecords = (): void => {
    setRecords(loadAssessmentRecords());
  };
  const refreshNotes = (): void => {
    setNotes(loadPatientNotes());
  };
  const refreshPacks = (): void => {
    setInstallation(loadAssessmentInstallationState(ASSESSMENT_CATALOG));
  };
  const handleHashChange = (): void => {
    setRoute(readRoute());
    setMessage('');
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const handleStorage = (event: StorageEvent): void => {
    if (!event.key || event.key.startsWith('minimed.assessment-packs.')) refreshPacks();
  };

  onMount(() => {
    refreshRecords();
    refreshNotes();
    refreshPacks();
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('storage', handleStorage);
    window.addEventListener(ASSESSMENT_RESULTS_EVENT, refreshRecords);
    window.addEventListener(PATIENT_NOTES_EVENT, refreshNotes);
    window.addEventListener(ASSESSMENT_PACKS_EVENT, refreshPacks);
  });

  onCleanup(() => {
    definitionRequest += 1;
    window.removeEventListener('hashchange', handleHashChange);
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(ASSESSMENT_RESULTS_EVENT, refreshRecords);
    window.removeEventListener(PATIENT_NOTES_EVENT, refreshNotes);
    window.removeEventListener(ASSESSMENT_PACKS_EVENT, refreshPacks);
  });

  const catalogEntry = createMemo(() => {
    const current = route();
    return current.kind === 'assessment' || current.kind === 'result'
      ? findAssessmentBySlug(current.slug)
      : undefined;
  });
  const record = createMemo(() => {
    const current = route();
    if (current.kind !== 'result') return undefined;
    return records().find(
      (candidate) =>
        candidate.id === current.recordId && candidate.assessmentId === catalogEntry()?.id,
    );
  });

  createEffect(() => {
    const current = route();
    const entry = catalogEntry();
    const shouldLoad = Boolean(
      entry &&
        (current.kind === 'result' ||
          (current.kind === 'assessment' && installation().installedIds.has(entry.id))),
    );
    const request = ++definitionRequest;
    setLoadedDefinition(undefined);
    setDefinitionError('');
    setDefinitionLoading(shouldLoad);
    if (!entry || !shouldLoad) return;
    void loadAssessmentDefinition(entry.id)
      .then((definition) => {
        if (request !== definitionRequest) return;
        setLoadedDefinition(definition);
      })
      .catch((cause: unknown) => {
        if (request !== definitionRequest) return;
        setDefinitionError(cause instanceof Error ? cause.message : 'Не удалось скачать опросник.');
      })
      .finally(() => {
        if (request === definitionRequest) setDefinitionLoading(false);
      });
  });

  const navigate = (hash: string): void => {
    window.location.hash = hash;
  };

  const installIds = async (
    ids: readonly string[],
    commit: () => AssessmentInstallationState,
    successMessage: string,
  ): Promise<void> => {
    setMessage('Скачиваем опросник…');
    try {
      await preloadAssessmentDefinitions(ids);
      setInstallation(commit());
      setMessage(successMessage);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Не удалось скачать опросник.');
    }
  };

  const installDefinition = (id: string): void => {
    void installIds(
      [id],
      () => installAssessmentIds([id], ASSESSMENT_CATALOG),
      'Опросник скачан на устройство.',
    );
  };
  const removeDefinition = (id: string): void => {
    const next = removeAssessmentIds([id], ASSESSMENT_CATALOG);
    setInstallation(next);
    const requiredBy = assessmentRequiredByModules(id, next);
    setMessage(
      requiredBy.length > 0
        ? 'Ручная копия отключена, но опросник сохранён: он нужен установленной базе знаний.'
        : 'Опросник отключён. Сохранённые результаты не изменены.',
    );
  };
  const installSection = (sectionId: AssessmentSectionId): void => {
    const ids = assessmentIdsInSection(sectionId, ASSESSMENT_CATALOG);
    void installIds(
      ids,
      () => installAssessmentSection(sectionId, ASSESSMENT_CATALOG),
      'Раздел опросников скачан на устройство.',
    );
  };
  const removeSection = (sectionId: AssessmentSectionId): void => {
    const next = removeAssessmentSection(sectionId, ASSESSMENT_CATALOG);
    setInstallation(next);
    setMessage(
      'Раздел удалён с устройства. Отдельно скачанные и необходимые базе знаний опросники сохранены.',
    );
  };
  const requestDeleteDefinition = (id: string): void => {
    const title = ASSESSMENT_CATALOG.find((definition) => definition.id === id)?.shortTitle ?? id;
    setPendingDeletion({ kind: 'assessment', id, title });
  };
  const requestDeleteSection = (sectionId: AssessmentSectionId): void => {
    const title =
      ASSESSMENT_SECTIONS.find((section) => section.id === sectionId)?.title ?? sectionId;
    setPendingDeletion({ kind: 'section', id: sectionId, title });
  };
  const requestDeleteResult = (recordId: string, title: string): void => {
    setPendingDeletion({ kind: 'result', id: recordId, title });
  };
  const confirmDeletion = (): void => {
    const pending = pendingDeletion();
    setPendingDeletion(null);
    if (!pending) return;
    if (pending.kind === 'assessment') removeDefinition(pending.id);
    if (pending.kind === 'section') removeSection(pending.id as AssessmentSectionId);
    if (pending.kind === 'result') {
      removeAssessmentRecord(pending.id);
      refreshRecords();
      navigate('#/assessments');
    }
  };
  const printDefinition = (id: string): void => {
    setMessage('Подготавливаем бланк…');
    void loadAssessmentDefinition(id)
      .then((definition) => {
        printBlankAssessment(definition);
        setMessage('Бланк подготовлен к печати.');
      })
      .catch((cause: unknown) => {
        setMessage(cause instanceof Error ? cause.message : 'Не удалось подготовить бланк.');
      });
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
        <AssessmentSpecialtyIndexPage
          definitions={ASSESSMENT_CATALOG}
          matches={query().trim() ? searchAssessments(query()) : []}
          installation={installation()}
          query={query()}
          recentRecords={records().slice(0, 8)}
          onQuery={setQuery}
          onOpenSpecialty={(specialtyId) => navigate(specialtyPath(specialtyId))}
          onOpen={(selected) => navigate(assessmentPath(selected.slug))}
          onOpenRecord={(selected, selectedRecord) =>
            navigate(resultPath(selected.slug, selectedRecord.id))
          }
          onInstall={(selected) => installDefinition(selected.id)}
          onRemove={(selected) => requestDeleteDefinition(selected.id)}
          onPrint={(selected) => printDefinition(selected.id)}
        />
      </Show>

      <Show
        when={
          route().kind === 'specialty'
            ? findAssessmentSpecialty((route() as { specialtyId: string }).specialtyId)
            : undefined
        }
      >
        {(specialty) => (
          <AssessmentCatalogPage
            specialty={specialty()}
            definitions={assessmentsInSpecialty(specialty().id, searchAssessments(query()))}
            installation={installation()}
            query={query()}
            onQuery={setQuery}
            onBack={() => {
              setQuery('');
              navigate('#/assessments');
            }}
            onOpen={(selected) => navigate(assessmentPath(selected.slug))}
            onInstall={(selected) => installDefinition(selected.id)}
            onRemove={(selected) => requestDeleteDefinition(selected.id)}
            onPrint={(selected) => printDefinition(selected.id)}
            onInstallSection={installSection}
            onRemoveSection={requestDeleteSection}
          />
        )}
      </Show>

      <Show when={definitionLoading()}>
        <section class="assessment-pack-required paper-card" aria-live="polite">
          <h1>Подключаем опросник</h1>
          <p>Загружаем только выбранное определение и проверяем его идентификатор.</p>
        </section>
      </Show>

      <Show when={definitionError()}>
        {(error) => (
          <section class="assessment-pack-required paper-card" role="alert">
            <h1>Не удалось открыть опросник</h1>
            <p>{error()}</p>
            <button type="button" onClick={() => navigate('#/assessments')}>
              К разделам
            </button>
          </section>
        )}
      </Show>

      <Show when={route().kind === 'assessment' ? loadedDefinition() : undefined}>
        {(selected) => (
          <AssessmentQuestionnairePage
            definition={selected()}
            sectionTitle={
              ASSESSMENT_SECTIONS.find((section) => section.id === selected().category)?.title ??
              selected().bankLabel
            }
            onBack={() => navigate('#/assessments')}
            onMessage={setMessage}
            onSaved={(saved) => {
              refreshRecords();
              navigate(resultPath(selected().slug, saved.id));
            }}
          />
        )}
      </Show>

      <Show
        when={
          route().kind === 'assessment' &&
          catalogEntry() &&
          !installation().installedIds.has(catalogEntry()?.id ?? '')
            ? catalogEntry()
            : undefined
        }
      >
        {(selected) => (
          <section class="assessment-pack-required paper-card">
            <p class="archive-kicker">
              {ASSESSMENT_SECTIONS.find((section) => section.id === selected().category)?.title ??
                selected().bankLabel}
            </p>
            <h1>{selected().title}</h1>
            <p>
              Этот тест входит в скачиваемый раздел. Сначала скачайте раздел, чтобы пройти его без
              сети.
            </p>
            <div>
              <button type="button" onClick={() => installDefinition(selected().id)}>
                Скачать только этот тест
              </button>
              <button type="button" onClick={() => navigate('#/assessments')}>
                К разделам
              </button>
            </div>
          </section>
        )}
      </Show>

      <Show when={route().kind === 'result' ? loadedDefinition() : undefined}>
        {(selectedDefinition) => (
          <Show when={record()}>
            {(selectedRecord) => (
              <AssessmentResultPage
                definition={selectedDefinition()}
                record={selectedRecord()}
                notes={notes()}
                onBack={() => navigate(assessmentPath(selectedDefinition().slug))}
                onMessage={setMessage}
                onNotesChanged={setNotes}
                onDelete={() =>
                  requestDeleteResult(
                    selectedRecord().id,
                    selectedRecord().subjectLabel || selectedDefinition().shortTitle,
                  )
                }
              />
            )}
          </Show>
        )}
      </Show>

      <Show when={route().kind !== 'index' && route().kind !== 'specialty' && !catalogEntry()}>
        <section class="assessment-not-found paper-card">
          <h1>Опросник не найден</h1>
          <p>Возможно, каталог был обновлён или ссылка устарела.</p>
          <button type="button" onClick={() => navigate('#/assessments')}>
            К каталогу
          </button>
        </section>
      </Show>

      <ConfirmationDialog
        open={pendingDeletion() !== null}
        title="Удалить?"
        description={`«${pendingDeletion()?.title ?? ''}» будет удалён. Сохранённые результаты не изменятся.`}
        confirmLabel="Удалить"
        danger
        onConfirm={confirmDeletion}
        onOpenChange={(open) => {
          if (!open) setPendingDeletion(null);
        }}
      />
    </section>
  );
}
