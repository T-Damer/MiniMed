import type { CoreStatus, MedicalCore, MedicalDocumentSummary } from '@localmed/contracts';
import { createMemo, createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { ReleaseLinks } from '@/components/ReleaseLinks';
import { knowledgeDocumentBackHash } from '@/features/knowledge/knowledge-routing';
import { MedicationCatalogView } from '@/features/medications/MedicationCatalogView';
import type { LocalModelController } from '@/features/models/controller';
import { ModelSettings } from '@/features/models/ModelSettings';
import type { LocalModelState } from '@/features/models/types';
import { ModuleCatalogView } from '@/features/modules/ModuleCatalogView';
import { StatusPanel } from '@/features/status/StatusPanel';
import { loadPatientNotes } from '@/state/patient-notes';

type KnowledgeRoute = 'overview' | 'documents' | 'medications' | 'model';

interface KnowledgeBaseViewProps {
  readonly core: MedicalCore;
  readonly status: CoreStatus;
  readonly controller: LocalModelController;
  readonly active: boolean;
  readonly onContentChanged?: () => Promise<void>;
  readonly onAvailableUpdates?: (count: number) => void;
}

function routeFromLocation(): KnowledgeRoute {
  const route = window.location.hash.replace(/^#\/?/u, '');
  if (
    route === 'modules/documents/medications' ||
    route.startsWith('modules/documents/medications/')
  ) {
    return 'medications';
  }
  if (route === 'modules/documents' || route.startsWith('modules/documents/')) return 'documents';
  if (route === 'modules/model' || route === 'status') return 'model';
  return 'overview';
}

function documentCounts(documents: readonly MedicalDocumentSummary[]) {
  return {
    clinical: documents.filter((document) =>
      ['clinical_recommendation', 'clinical_recommendation_summary'].includes(document.sourceType),
    ).length,
    medications: documents.filter((document) =>
      ['allmed_reference', 'official_drug_instruction', 'official_registry_summary'].includes(
        document.sourceType,
      ),
    ).length,
    legal: documents.filter((document) =>
      ['regulatory_act', 'regulatory_act_summary'].includes(document.sourceType),
    ).length,
    reference: documents.filter((document) => document.sourceType === 'medical_reference').length,
  };
}

function modelStatus(state: LocalModelState): string {
  if (state.phase === 'ready') return `${state.activeModelId ?? 'Локальная модель'} используется`;
  if (['downloading', 'loading', 'benchmarking'].includes(state.phase)) {
    const progress = state.progress === null ? '' : ` · ${Math.round(state.progress * 100)}%`;
    return `${state.selectedModelId ?? state.recommendedModelId ?? 'Модель'} загружается${progress}`;
  }
  if (state.phase === 'error') return 'Модель недоступна — обычный поиск работает';
  return 'Модель отключена';
}

export function KnowledgeBaseView(props: KnowledgeBaseViewProps): JSX.Element {
  const [route, setRoute] = createSignal<KnowledgeRoute>(routeFromLocation());
  const [documents, setDocuments] = createSignal<readonly MedicalDocumentSummary[]>([]);
  const [model, setModel] = createSignal<LocalModelState>(props.controller.getState());
  let unsubscribeModel: (() => void) | undefined;

  const counts = createMemo(() => documentCounts(documents()));
  const noteCount = createMemo(() => loadPatientNotes().notes.length);

  const navigate = (next: KnowledgeRoute): void => {
    setRoute(next);
    const hash = next === 'overview' ? '#/modules' : `#/modules/${next}`;
    window.history.replaceState({ view: 'modules', route: next }, '', hash);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const navigateBack = (): void => {
    const route = window.location.hash.replace(/^#\/?/u, '');
    if (route.startsWith('modules/documents/') && window.history.state?.view === 'modules') {
      window.history.back();
      return;
    }
    const backHash = knowledgeDocumentBackHash(route);
    if (backHash) {
      window.location.hash = backHash;
      return;
    }
    navigate('overview');
  };

  const handleHashChange = (): void => {
    setRoute(routeFromLocation());
  };

  onMount(() => {
    window.addEventListener('hashchange', handleHashChange);
    unsubscribeModel = props.controller.subscribe((state) => {
      setModel(state);
    });
    void props.core.listDocuments().then((result) => {
      if (result.ok) setDocuments(result.value);
    });
  });

  onCleanup(() => {
    window.removeEventListener('hashchange', handleHashChange);
    unsubscribeModel?.();
  });

  return (
    <section class="knowledge-base-page page-surface page-grain">
      <Show when={route() === 'overview'}>
        <header class="subpage-heading knowledge-base-heading">
          <div>
            <p class="archive-kicker">Всё локальное — в одном месте</p>
            <h1>База знаний и модель</h1>
          </div>
        </header>

        <div class="knowledge-status-grid">
          <button
            type="button"
            class="knowledge-status-card paper-card"
            onClick={() => navigate('documents')}
          >
            <AppGlyph name="book-open" class="knowledge-status-card-icon" />
            <span>Документы</span>
            <strong>{documents().length} доступно</strong>
            <ul class="knowledge-document-counts">
              <li>{counts().clinical} клинических</li>
              <li>{counts().medications} лекарственных</li>
              <li>{counts().legal} правовых</li>
              <li>{counts().reference} норм и расчётов</li>
              <li>{noteCount()} заметок</li>
            </ul>
            <em>Открыть каталог →</em>
          </button>
          <button
            type="button"
            class="knowledge-status-card paper-card"
            onClick={() => navigate('model')}
          >
            <AppGlyph name="brain" class="knowledge-status-card-icon" />
            <span>Локальная модель</span>
            <strong>{modelStatus(model())}</strong>
            <p>Используется только после локального поиска по установленным источникам.</p>
            <em>Настроить модель →</em>
          </button>
        </div>
      </Show>

      <Show when={route() === 'documents'}>
        <ModuleCatalogView
          core={props.core}
          status={props.status}
          active={props.active && route() === 'documents'}
          embedded
          onBack={navigateBack}
          {...(props.onContentChanged ? { onContentChanged: props.onContentChanged } : {})}
          {...(props.onAvailableUpdates ? { onAvailableUpdates: props.onAvailableUpdates } : {})}
        />
      </Show>

      <Show when={route() === 'medications'}>
        <MedicationCatalogView core={props.core} onBack={() => navigate('documents')} />
      </Show>

      <Show when={route() === 'model'}>
        <div class="knowledge-subroute-heading">
          <button
            type="button"
            class="knowledge-back-button"
            aria-label="Назад"
            onClick={() => navigate('overview')}
          >
            <AppGlyph name="arrow-left" />
          </button>
          <nav class="knowledge-subroute-links" aria-label="Ссылки приложения">
            <ReleaseLinks />
          </nav>
        </div>
        <ModelSettings controller={props.controller} />
        <details class="system-technical-panel">
          <summary>Техническая информация о приложении</summary>
          <section class="system-model-technical">
            <h3>Локальная модель</h3>
            <div class="model-settings-summary">
              <div>
                <span>Режим</span>
                <strong>
                  {props.controller.getPreference().automatic ? 'автоматический' : 'ручной'}
                </strong>
              </div>
              <div>
                <span>Каталог</span>
                <strong>{model().catalogSource ?? 'не загружен'}</strong>
              </div>
              <div>
                <span>Устройство</span>
                <strong>
                  {model().device
                    ? `${model().device?.platform} · ${model().device?.deviceMemoryGb ?? '?'} ГБ`
                    : 'не проверено'}
                </strong>
              </div>
              <Show when={model().benchmark}>
                {(benchmark) => (
                  <div>
                    <span>Последний тест</span>
                    <strong>
                      {Math.round(benchmark().loadMs)} мс / {Math.round(benchmark().generationMs)}{' '}
                      мс
                    </strong>
                  </div>
                )}
              </Show>
            </div>
          </section>
          <StatusPanel initialStatus={props.status} />
        </details>
      </Show>
    </section>
  );
}
