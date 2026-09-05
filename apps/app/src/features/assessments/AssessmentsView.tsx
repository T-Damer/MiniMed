import {
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Button } from '@/components/Button';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { AssessmentCatalogPage } from '@/features/assessments/AssessmentCatalogPage';
import { AssessmentMissingPage } from '@/features/assessments/AssessmentMissingPage';
import { AssessmentQuestionnairePage } from '@/features/assessments/AssessmentQuestionnairePage';
import { AssessmentResultPage } from '@/features/assessments/AssessmentResultPage';
import { AssessmentSpecialtyIndexPage } from '@/features/assessments/AssessmentSpecialtyIndexPage';
import {
  type AssessmentCatalogEntry,
  assessmentsInSpecialty,
  clearDownloadedAssessments,
  findAssessmentSpecialty,
  getAssessmentCatalog,
  loadAssessmentDefinition,
  preloadAssessmentDefinitions,
  registerDownloadedAssessment,
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
  moduleIdForAssessmentSection,
  moduleIdForAssessmentSpecialty,
  removeAssessmentIds,
  removeAssessmentSection,
  setDatabaseAssessmentIds,
} from '@/features/assessments/assessment-packs';
import { printBlankAssessment } from '@/features/assessments/assessment-print';
import {
  type AssessmentRoute,
  assessmentHomePath,
  assessmentPath,
  readAssessmentRoute,
  resultPath,
  resumePath,
  sectionPath,
  specialtyPath,
  userQuestionnaireEditPath,
  userQuestionnaireHomePath,
  userQuestionnaireNewPath,
  userQuestionnairePath,
  userQuestionnaireResultPath,
} from '@/features/assessments/assessment-routing';
import type {
  AssessmentDefinition,
  AssessmentRecord,
} from '@/features/assessments/assessment-types';
import { UserQuestionnaireEditorPage } from '@/features/assessments/UserQuestionnaireEditorPage';
import { MODULE_CATALOG, moduleForTool } from '@/features/modules/module-catalog';
import { getContentModuleRuntime } from '@/features/modules/module-runtime-service';
import {
  ASSESSMENT_RESULTS_EVENT,
  ASSESSMENT_RESULTS_KEY,
  latestIncompleteAssessmentRecord,
  loadAssessmentRecords,
  removeAssessmentRecord,
} from '@/state/assessment-results';
import { matchesFuzzyQuery } from '@/state/fuzzy-text';
import { shareSystemFile } from '@/state/native-share';
import {
  loadPatientNotes,
  PATIENT_NOTES_EVENT,
  type PatientNotesSnapshot,
} from '@/state/patient-notes';
import { acknowledgePatientVaultUiCleared, PATIENT_VAULT_LOCK_EVENT } from '@/state/patient-vault';
import { USER_LIBRARY_EVENT } from '@/state/user-library';
import {
  createUserQuestionnaire,
  ensureUserQuestionnaireSample,
  exportUserQuestionnaire,
  importUserQuestionnaire,
  listUserQuestionnaires,
  loadUserQuestionnaire,
  type StoredUserQuestionnaire,
  userQuestionnaireReadinessError,
  userQuestionnaireToAssessmentDefinition,
} from '@/state/user-questionnaires';

function filterAssessments(
  query: string,
  catalog: readonly AssessmentCatalogEntry[],
): readonly AssessmentCatalogEntry[] {
  const trimmed = query.trim();
  if (!trimmed) return catalog;
  return catalog.filter((assessment) => {
    const specialty = findAssessmentSpecialty(assessment.bankId);
    const section = ASSESSMENT_SECTIONS.find((item) => item.id === assessment.category);
    return matchesFuzzyQuery(trimmed, [
      assessment.title,
      assessment.shortTitle,
      assessment.description,
      ...assessment.aliases,
      ...(specialty ? [specialty.title, specialty.description] : []),
      ...(section ? [section.title, section.description] : []),
    ]);
  });
}

export function AssessmentsView(props: { readonly active: boolean }): JSX.Element {
  const [route, setRoute] = createSignal<AssessmentRoute>(readAssessmentRoute());
  const [query, setQuery] = createSignal('');
  const [records, setRecords] = createSignal<readonly AssessmentRecord[]>(loadAssessmentRecords());
  const [transientRecord, setTransientRecord] = createSignal<AssessmentRecord>();
  const [notes, setNotes] = createSignal<PatientNotesSnapshot>({ cards: [], notes: [] });
  const [installation, setInstallation] = createSignal<AssessmentInstallationState>(
    loadAssessmentInstallationState(getAssessmentCatalog()),
  );
  const [assessmentCatalog, setAssessmentCatalog] = createSignal(getAssessmentCatalog());
  const [loadedDefinition, setLoadedDefinition] = createSignal<AssessmentDefinition>();
  const [definitionLoading, setDefinitionLoading] = createSignal(false);
  const [definitionError, setDefinitionError] = createSignal('');
  const [userQuestionnaires, setUserQuestionnaires] = createSignal<
    readonly StoredUserQuestionnaire[]
  >([]);
  const [loadedUserQuestionnaire, setLoadedUserQuestionnaire] =
    createSignal<StoredUserQuestionnaire>();
  const [userQuestionnaireLoading, setUserQuestionnaireLoading] = createSignal(false);
  const [userQuestionnaireError, setUserQuestionnaireError] = createSignal('');
  const [message, setMessage] = createSignal('');

  createEffect(() => {
    if (!message()) return;
    const timer = window.setTimeout(() => setMessage(''), 4000);
    onCleanup(() => window.clearTimeout(timer));
  });
  const [pendingDeletion, setPendingDeletion] = createSignal<{
    readonly kind: 'assessment' | 'section' | 'result';
    readonly id: string;
    readonly title: string;
  } | null>(null);
  let definitionRequest = 0;
  let userQuestionnaireRequest = 0;
  let unsubscribeToolTasks: (() => void) | undefined;
  let downloadedToolsRefresh: Promise<void> | undefined;

  const refreshRecords = (): void => {
    setRecords(loadAssessmentRecords());
  };
  const refreshUserQuestionnaires = (): void => {
    void ensureUserQuestionnaireSample()
      .then(() => listUserQuestionnaires())
      .then(setUserQuestionnaires)
      .catch((cause: unknown) => {
        setMessage(
          cause instanceof Error ? cause.message : 'Не удалось прочитать локальные опросники.',
        );
      });
  };
  const refreshNotes = (): void => {
    setNotes(loadPatientNotes());
  };
  const refreshPacks = (): void => {
    setInstallation(loadAssessmentInstallationState(assessmentCatalog()));
  };
  const refreshDownloadedTools = (): Promise<void> => {
    if (downloadedToolsRefresh) return downloadedToolsRefresh;
    downloadedToolsRefresh = (async () => {
      const runtime = getContentModuleRuntime(MODULE_CATALOG);
      await runtime.whenLocalPackagedModulesReady();
      const definitions = await runtime.listInstalledToolDefinitions();
      clearDownloadedAssessments();
      definitions.forEach(registerDownloadedAssessment);
      setAssessmentCatalog(getAssessmentCatalog());
      setDatabaseAssessmentIds(
        definitions
          .filter((definition) => definition.kind === 'assessment')
          .map((definition) => definition.id),
      );
      refreshPacks();
    })().finally(() => {
      downloadedToolsRefresh = undefined;
    });
    return downloadedToolsRefresh;
  };
  const handleHashChange = (): void => {
    const route = window.location.hash.replace(/^#\/?/u, '');
    // Every root tab shares one global location.hash, and this view stays mounted (hidden, not
    // unmounted) while another tab is active — a hashchange for a different tab is not our concern.
    // Reacting to it would reset `route()` to the index and unmount the open questionnaire page,
    // silently discarding whatever answers the user had already entered.
    if (route !== '' && route !== 'assessments' && !route.startsWith('assessments/')) return;
    setRoute(readAssessmentRoute());
    setMessage('');
    if (!document.documentElement.classList.contains('using-root-view-transition')) {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  };
  const handleStorage = (event: StorageEvent): void => {
    if (!event.key || event.key.startsWith('minimed.assessment-packs.')) refreshPacks();
    if (event.key === ASSESSMENT_RESULTS_KEY) refreshRecords();
  };
  const clearProtectedResult = (): void => {
    if (transientRecord()?.patientId) {
      setTransientRecord(undefined);
      acknowledgePatientVaultUiCleared();
    }
  };

  onMount(() => {
    refreshRecords();
    refreshNotes();
    refreshPacks();
    refreshUserQuestionnaires();
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('storage', handleStorage);
    window.addEventListener(ASSESSMENT_RESULTS_EVENT, refreshRecords);
    window.addEventListener(PATIENT_NOTES_EVENT, refreshNotes);
    window.addEventListener(ASSESSMENT_PACKS_EVENT, refreshPacks);
    window.addEventListener(USER_LIBRARY_EVENT, refreshUserQuestionnaires);
    window.addEventListener(PATIENT_VAULT_LOCK_EVENT, clearProtectedResult);
    unsubscribeToolTasks = getContentModuleRuntime(MODULE_CATALOG).subscribe((task) => {
      if (task.state === 'completed') void refreshDownloadedTools();
    });
    const initialToolsFrame = requestAnimationFrame(() => {
      void refreshDownloadedTools().catch((cause: unknown) => {
        setMessage(
          cause instanceof Error ? cause.message : 'Не удалось прочитать скачанные инструменты.',
        );
      });
    });
    onCleanup(() => cancelAnimationFrame(initialToolsFrame));
  });

  onCleanup(() => {
    definitionRequest += 1;
    userQuestionnaireRequest += 1;
    unsubscribeToolTasks?.();
    window.removeEventListener('hashchange', handleHashChange);
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(ASSESSMENT_RESULTS_EVENT, refreshRecords);
    window.removeEventListener(PATIENT_NOTES_EVENT, refreshNotes);
    window.removeEventListener(ASSESSMENT_PACKS_EVENT, refreshPacks);
    window.removeEventListener(USER_LIBRARY_EVENT, refreshUserQuestionnaires);
    window.removeEventListener(PATIENT_VAULT_LOCK_EVENT, clearProtectedResult);
  });

  const catalogEntry = createMemo(() => {
    const current = route();
    return current.kind === 'assessment' || current.kind === 'result'
      ? assessmentCatalog().find((entry) => entry.slug === current.slug)
      : undefined;
  });
  const record = createMemo(() => {
    const current = route();
    if (current.kind !== 'result') return undefined;
    return (
      records().find(
        (candidate) =>
          candidate.id === current.recordId && candidate.assessmentId === catalogEntry()?.id,
      ) ??
      (transientRecord()?.id === current.recordId &&
      transientRecord()?.assessmentId === catalogEntry()?.id
        ? transientRecord()
        : undefined)
    );
  });
  const draftRecord = createMemo(() => {
    const current = route();
    if (current.kind !== 'assessment') return undefined;
    const assessmentId = catalogEntry()?.id;
    if (!assessmentId) return undefined;
    if (current.recordId) {
      const candidate = records().find(
        (entry) => entry.id === current.recordId && entry.assessmentId === assessmentId,
      );
      return candidate?.kind === 'incomplete' ? candidate : undefined;
    }
    return latestIncompleteAssessmentRecord(records(), assessmentId);
  });
  const userQuestionnaireFileId = createMemo(() => {
    const current = route();
    switch (current.kind) {
      case 'user-editor':
        return current.fileId;
      case 'user-assessment':
      case 'user-result':
        return current.fileId;
      default:
        return undefined;
    }
  });
  const userDefinition = createMemo(() => {
    const stored = loadedUserQuestionnaire();
    if (!stored || stored.file.id !== userQuestionnaireFileId()) return undefined;
    return userQuestionnaireToAssessmentDefinition(stored);
  });
  const userReadinessError = createMemo(() => {
    const stored = loadedUserQuestionnaire();
    return stored && stored.file.id === userQuestionnaireFileId()
      ? userQuestionnaireReadinessError(stored.questionnaire)
      : null;
  });
  const userRecord = createMemo(() => {
    const current = route();
    const definition = userDefinition();
    if (current.kind !== 'user-result' || !definition) return undefined;
    return (
      records().find(
        (candidate) =>
          candidate.id === current.recordId && candidate.assessmentId === definition.id,
      ) ??
      (transientRecord()?.id === current.recordId &&
      transientRecord()?.assessmentId === definition.id
        ? transientRecord()
        : undefined)
    );
  });
  const userDraftRecord = createMemo(() => {
    const current = route();
    const definition = userDefinition();
    if (current.kind !== 'user-assessment' || !definition) return undefined;
    if (current.recordId) {
      const candidate = records().find(
        (entry) => entry.id === current.recordId && entry.assessmentId === definition.id,
      );
      return candidate?.kind === 'incomplete' ? candidate : undefined;
    }
    return latestIncompleteAssessmentRecord(records(), definition.id);
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

  createEffect(() => {
    const current = route();
    const request = ++userQuestionnaireRequest;
    setLoadedUserQuestionnaire(undefined);
    setUserQuestionnaireError('');
    setUserQuestionnaireLoading(false);
    if (current.kind === 'user-editor' && !current.fileId) {
      setUserQuestionnaireLoading(true);
      void createUserQuestionnaire()
        .then((stored) => {
          if (request !== userQuestionnaireRequest) return;
          setUserQuestionnaires((items) => [stored, ...items]);
          window.location.hash = userQuestionnaireEditPath(stored.file.id);
        })
        .catch((cause: unknown) => {
          if (request !== userQuestionnaireRequest) return;
          setUserQuestionnaireError(
            cause instanceof Error ? cause.message : 'Не удалось создать опросник.',
          );
        })
        .finally(() => {
          if (request === userQuestionnaireRequest) setUserQuestionnaireLoading(false);
        });
      return;
    }
    const fileId = userQuestionnaireFileId();
    if (!fileId) return;
    setUserQuestionnaireLoading(true);
    void loadUserQuestionnaire(fileId)
      .then((stored) => {
        if (request !== userQuestionnaireRequest) return;
        setLoadedUserQuestionnaire(stored);
      })
      .catch((cause: unknown) => {
        if (request !== userQuestionnaireRequest) return;
        setUserQuestionnaireError(
          cause instanceof Error ? cause.message : 'Не удалось открыть опросник.',
        );
      })
      .finally(() => {
        if (request === userQuestionnaireRequest) setUserQuestionnaireLoading(false);
      });
  });

  const navigate = (hash: string): void => {
    window.location.hash = hash;
  };

  const installToolModule = async (moduleId: string | undefined): Promise<void> => {
    if (!moduleId) return;
    const runtime = getContentModuleRuntime(MODULE_CATALOG);
    if (runtime.listInstalled().some((item) => item.moduleId === moduleId)) return;
    const module = MODULE_CATALOG.modules.find((entry) => entry.id === moduleId);
    if (!module) throw new Error('Модуль инструментов не найден в каталоге.');
    const task = runtime.install(module);
    const completed = await runtime.wait(task.id);
    if (completed.state !== 'completed') {
      throw new Error('Не удалось скачать модуль инструментов.');
    }
    await refreshDownloadedTools();
  };

  const installIds = async (
    ids: readonly string[],
    commit: () => AssessmentInstallationState,
    successMessage: string,
    moduleId?: string,
  ): Promise<void> => {
    setMessage('Скачиваем опросник…');
    try {
      await installToolModule(moduleId);
      await preloadAssessmentDefinitions(ids);
      setInstallation(commit());
      setMessage(successMessage);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Не удалось скачать опросник.');
    }
  };

  const installDefinition = (id: string): void => {
    const entry = assessmentCatalog().find((definition) => definition.id === id);
    const moduleId = entry
      ? (moduleForTool(entry.id)?.id ??
        moduleIdForAssessmentSection(entry.category) ??
        moduleIdForAssessmentSpecialty(entry.bankId))
      : undefined;
    void installIds(
      [id],
      () => installAssessmentIds([id], assessmentCatalog()),
      'Опросник скачан на устройство.',
      moduleId,
    );
  };
  const removeDefinition = (id: string): void => {
    const next = removeAssessmentIds([id], assessmentCatalog());
    setInstallation(next);
    const requiredBy = assessmentRequiredByModules(id, next);
    setMessage(
      requiredBy.length > 0
        ? 'Ручная копия отключена, но опросник сохранён: он нужен установленной базе знаний.'
        : 'Опросник отключён. Сохранённые результаты не изменены.',
    );
  };
  const installSection = (sectionId: AssessmentSectionId): void => {
    void (async () => {
      setMessage('Скачиваем опросник…');
      try {
        const section = assessmentCatalog().find((entry) => entry.category === sectionId);
        await installToolModule(
          moduleIdForAssessmentSection(sectionId) ??
            (section ? moduleIdForAssessmentSpecialty(section.bankId) : undefined),
        );
        const ids = assessmentIdsInSection(sectionId, assessmentCatalog());
        await preloadAssessmentDefinitions(ids);
        setInstallation(installAssessmentSection(sectionId, assessmentCatalog()));
        setMessage('Раздел опросников скачан на устройство.');
      } catch (cause) {
        setMessage(cause instanceof Error ? cause.message : 'Не удалось скачать опросник.');
      }
    })();
  };
  const removeSection = (sectionId: AssessmentSectionId): void => {
    const next = removeAssessmentSection(sectionId, assessmentCatalog());
    setInstallation(next);
    setMessage(
      'Раздел удалён с устройства. Отдельно скачанные и необходимые базе знаний опросники сохранены.',
    );
  };
  const requestDeleteDefinition = (id: string): void => {
    const title = assessmentCatalog().find((definition) => definition.id === id)?.shortTitle ?? id;
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
      if (transientRecord()?.id === pending.id) setTransientRecord(undefined);
      refreshRecords();
      const current = route();
      navigate(
        current.kind === 'user-result' ? userQuestionnairePath(current.fileId) : '#/assessments',
      );
    }
  };
  const printDefinition = (id: string): void => {
    setMessage('Подготавливаем бланк…');
    void loadAssessmentDefinition(id)
      .then((definition) => {
        setMessage(
          printBlankAssessment(definition)
            ? 'Бланк подготовлен к печати.'
            : 'Не удалось открыть окно печати.',
        );
      })
      .catch((cause: unknown) => {
        setMessage(cause instanceof Error ? cause.message : 'Не удалось подготовить бланк.');
      });
  };
  const exportUserQuestionnaireFile = (fileId: string): void => {
    void exportUserQuestionnaire(fileId)
      .then((file) =>
        shareSystemFile({
          title: file.name.replace(/\.minimed-questionnaire$/u, ''),
          fileName: file.name,
          mimeType: file.type,
          blob: file,
        }),
      )
      .then((result) => {
        if (result === 'cancelled') return;
        setMessage(result === 'shared' ? 'Опросник передан.' : 'Опросник экспортирован в файл.');
      })
      .catch((cause: unknown) => {
        setMessage(cause instanceof Error ? cause.message : 'Не удалось экспортировать опросник.');
      });
  };
  const importUserQuestionnaireFile = (file: File): void => {
    void importUserQuestionnaire(file)
      .then((stored) => {
        setUserQuestionnaires((items) => [stored, ...items]);
        setLoadedUserQuestionnaire(stored);
        setMessage('Опросник импортирован в «Мои файлы».');
        navigate(userQuestionnaireEditPath(stored.file.id));
      })
      .catch((cause: unknown) => {
        setMessage(cause instanceof Error ? cause.message : 'Не удалось импортировать опросник.');
      });
  };

  return (
    <section class="assessments-page page-surface page-grain" aria-label="Тесты и опросники">
      <Show when={message()}>
        {(value) => (
          <div class="assessment-message" role="status">
            <span class="assessment-message__text">{value()}</span>
            <button
              class="assessment-message__close"
              type="button"
              aria-label="Скрыть уведомление"
              onClick={() => setMessage('')}
            >
              ×
            </button>
          </div>
        )}
      </Show>

      <Show when={route().kind === 'index' || route().kind === 'user-index'}>
        <AssessmentSpecialtyIndexPage
          mineOnly={route().kind === 'user-index'}
          definitions={assessmentCatalog()}
          matches={query().trim() ? filterAssessments(query(), assessmentCatalog()) : []}
          installation={installation()}
          query={query()}
          recentRecords={records().slice(0, 8)}
          userQuestionnaires={userQuestionnaires()}
          onQuery={setQuery}
          onBack={() => navigate('#/assessments')}
          onOpenSpecialty={(specialtyId) => navigate(specialtyPath(specialtyId))}
          onOpenUserQuestionnaires={() => navigate(userQuestionnaireHomePath())}
          onCreateUserQuestionnaire={() => navigate(userQuestionnaireNewPath())}
          onOpenUserQuestionnaire={(fileId) => navigate(userQuestionnairePath(fileId))}
          onEditUserQuestionnaire={(fileId) => navigate(userQuestionnaireEditPath(fileId))}
          onExportUserQuestionnaire={exportUserQuestionnaireFile}
          onImportUserQuestionnaire={importUserQuestionnaireFile}
          onOpenRecord={(selected, selectedRecord) =>
            navigate(
              selectedRecord.kind === 'incomplete'
                ? resumePath(selected.bankId, selected.slug, selectedRecord.id)
                : resultPath(selected.bankId, selected.slug, selectedRecord.id),
            )
          }
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
            definitions={assessmentsInSpecialty(
              specialty().id,
              filterAssessments(query(), assessmentCatalog()),
            )}
            installation={installation()}
            query={query()}
            onQuery={setQuery}
            onBack={() => {
              setQuery('');
              navigate('#/assessments');
            }}
            onOpenSection={(sectionId) => navigate(sectionPath(specialty().id, sectionId))}
            onOpen={(selected) => {
              const draft = latestIncompleteAssessmentRecord(records(), selected.id);
              navigate(
                draft
                  ? resumePath(specialty().id, selected.slug, draft.id)
                  : assessmentPath(specialty().id, selected.slug),
              );
            }}
            onInstall={(selected) => installDefinition(selected.id)}
            onRemove={(selected) => requestDeleteDefinition(selected.id)}
            onPrint={(selected) => printDefinition(selected.id)}
            onInstallSection={installSection}
            onRemoveSection={requestDeleteSection}
          />
        )}
      </Show>

      <Show
        when={
          route().kind === 'section'
            ? findAssessmentSpecialty((route() as { specialtyId: string }).specialtyId)
            : undefined
        }
      >
        {(specialty) => (
          <AssessmentCatalogPage
            specialty={specialty()}
            sectionId={(route() as { sectionId: AssessmentSectionId }).sectionId}
            definitions={assessmentsInSpecialty(
              specialty().id,
              filterAssessments(query(), assessmentCatalog()),
            )}
            installation={installation()}
            query={query()}
            onQuery={setQuery}
            onBack={() => {
              setQuery('');
              navigate(specialtyPath(specialty().id));
            }}
            onOpenSection={(sectionId) => navigate(sectionPath(specialty().id, sectionId))}
            onOpen={(selected) => {
              const draft = latestIncompleteAssessmentRecord(records(), selected.id);
              navigate(
                draft
                  ? resumePath(specialty().id, selected.slug, draft.id)
                  : assessmentPath(specialty().id, selected.slug),
              );
            }}
            onInstall={(selected) => installDefinition(selected.id)}
            onRemove={(selected) => requestDeleteDefinition(selected.id)}
            onPrint={(selected) => printDefinition(selected.id)}
            onInstallSection={installSection}
            onRemoveSection={requestDeleteSection}
          />
        )}
      </Show>

      <Show when={userQuestionnaireLoading()}>
        <section class="assessment-pack-required paper-card" aria-live="polite">
          <h1 class="assessment-pack-required__title">Открываем опросник</h1>
          <p class="assessment-pack-required__text">
            Читаем локальный файл и восстанавливаем черновик.
          </p>
        </section>
      </Show>

      <Show when={userQuestionnaireError()}>
        {(error) => (
          <section class="assessment-pack-required paper-card" role="alert">
            <h1 class="assessment-pack-required__title">Не удалось открыть опросник</h1>
            <p class="assessment-pack-required__text">{error()}</p>
            <Button
              type="button"
              class="assessment-pack-required__button"
              onClick={() => navigate(userQuestionnaireHomePath())}
            >
              К моим опросникам
            </Button>
          </section>
        )}
      </Show>

      <Show
        when={
          route().kind === 'user-editor' && loadedUserQuestionnaire()
            ? loadedUserQuestionnaire()
            : undefined
        }
      >
        {(stored) => (
          <UserQuestionnaireEditorPage
            stored={stored()}
            onBack={() => navigate(userQuestionnaireHomePath())}
            onRun={() => navigate(userQuestionnairePath(stored().file.id))}
            onMessage={setMessage}
            onSaved={(saved) => {
              setLoadedUserQuestionnaire(saved);
              setUserQuestionnaires((items) => [
                saved,
                ...items.filter((item) => item.file.id !== saved.file.id),
              ]);
            }}
          />
        )}
      </Show>

      <Show
        when={
          route().kind === 'user-assessment' && userDefinition() && !userReadinessError()
            ? userDefinition()
            : undefined
        }
      >
        {(definition) => (
          <AssessmentQuestionnairePage
            active={props.active}
            definition={definition()}
            {...(userDraftRecord() ? { initialRecord: userDraftRecord() } : {})}
            sectionTitle="Мои опросники"
            onBack={() => navigate(userQuestionnaireHomePath())}
            onDraftSaved={refreshRecords}
            onMessage={setMessage}
            onSaved={(saved) => {
              setTransientRecord(saved);
              refreshRecords();
              navigate(userQuestionnaireResultPath(userQuestionnaireFileId() ?? '', saved.id));
            }}
          />
        )}
      </Show>

      <Show
        when={
          route().kind === 'user-assessment' && loadedUserQuestionnaire()
            ? userReadinessError()
            : undefined
        }
      >
        {(error) => (
          <section class="assessment-pack-required paper-card" role="alert">
            <h1 class="assessment-pack-required__title">Опросник ещё не готов</h1>
            <p class="assessment-pack-required__text">{error()}</p>
            <Button
              type="button"
              class="assessment-pack-required__button"
              onClick={() => navigate(userQuestionnaireEditPath(userQuestionnaireFileId() ?? ''))}
            >
              Редактировать
            </Button>
          </section>
        )}
      </Show>

      <Show
        when={route().kind === 'user-result' && userDefinition() ? userDefinition() : undefined}
      >
        {(definition) => (
          <Show when={userRecord()}>
            {(selectedRecord) => (
              <AssessmentResultPage
                definition={definition()}
                record={selectedRecord()}
                notes={notes()}
                onBack={() => navigate(userQuestionnairePath(userQuestionnaireFileId() ?? ''))}
                onMessage={setMessage}
                onNotesChanged={setNotes}
                onDelete={() =>
                  requestDeleteResult(
                    selectedRecord().id,
                    selectedRecord().subjectLabel || definition().shortTitle,
                  )
                }
              />
            )}
          </Show>
        )}
      </Show>

      <Show when={definitionLoading()}>
        <section class="assessment-pack-required paper-card" aria-live="polite">
          <h1 class="assessment-pack-required__title">Подключаем опросник</h1>
          <p class="assessment-pack-required__text">
            Загружаем только выбранное определение и проверяем его идентификатор.
          </p>
        </section>
      </Show>

      <Show when={definitionError()}>
        {(error) => (
          <section class="assessment-pack-required paper-card" role="alert">
            <h1 class="assessment-pack-required__title">Не удалось открыть опросник</h1>
            <p class="assessment-pack-required__text">{error()}</p>
            <button
              class="assessment-pack-required__button"
              type="button"
              onClick={() => navigate('#/assessments')}
            >
              К разделам
            </button>
          </section>
        )}
      </Show>

      <Show when={route().kind === 'assessment' ? loadedDefinition() : undefined}>
        {(selected) => (
          <AssessmentQuestionnairePage
            active={props.active}
            definition={selected()}
            {...(draftRecord() ? { initialRecord: draftRecord() } : {})}
            sectionTitle={
              ASSESSMENT_SECTIONS.find((section) => section.id === selected().category)?.title ??
              selected().bankLabel
            }
            onBack={() => navigate(assessmentHomePath(selected().slug))}
            onDraftSaved={refreshRecords}
            onMessage={setMessage}
            onSaved={(saved) => {
              setTransientRecord(saved);
              refreshRecords();
              navigate(resultPath(selected().bankId, selected().slug, saved.id));
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
          <AssessmentMissingPage
            sectionTitle={
              ASSESSMENT_SECTIONS.find((section) => section.id === selected().category)?.title ??
              selected().bankLabel
            }
            title={selected().title}
            onBack={() => navigate(assessmentHomePath(selected().slug))}
            onInstall={() => installDefinition(selected().id)}
          />
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
                onBack={() =>
                  navigate(assessmentPath(selectedDefinition().bankId, selectedDefinition().slug))
                }
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

      <Show
        when={
          route().kind !== 'index' &&
          route().kind !== 'user-index' &&
          route().kind !== 'user-editor' &&
          route().kind !== 'user-assessment' &&
          route().kind !== 'user-result' &&
          route().kind !== 'specialty' &&
          route().kind !== 'section' &&
          !catalogEntry()
        }
      >
        <section class="assessment-not-found paper-card">
          <h1 class="assessment-not-found__title">Опросник не найден</h1>
          <p class="assessment-not-found__text">
            Возможно, каталог был обновлён или ссылка устарела.
          </p>
          <button
            class="assessment-not-found__button"
            type="button"
            onClick={() => navigate('#/assessments')}
          >
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
