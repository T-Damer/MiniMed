import type { CoreStatus, MedicalCore, MedicalDocumentSummary } from '@localmed/contracts';
import { createMemo, createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

import type { LocalModelController } from '@/features/models/controller';
import { ModelSettings } from '@/features/models/ModelSettings';
import type { LocalModelState } from '@/features/models/types';
import { ModuleCatalogView } from '@/features/modules/ModuleCatalogView';
import { StatusPanel } from '@/features/status/StatusPanel';
import { loadPatientNotes } from '@/state/patient-notes';

type KnowledgeRoute = 'overview' | 'documents' | 'model';

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
      ['official_drug_instruction', 'official_registry_summary'].includes(document.sourceType),
    ).length,
    legal: documents.filter((document) => document.sourceType === 'regulatory_act').length,
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
    if (route.startsWith('modules/documents/')) {
      window.location.hash = '#/modules/documents';
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
    <section class="knowledge-base-page page-surface">
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
            <span>Документы</span>
            <strong>{documents().length} доступно</strong>
            <p>
              {counts().clinical} клинических · {counts().medications} лекарственных ·{' '}
              {counts().legal} правовых · {noteCount()} заметок
            </p>
            <em>Открыть каталог →</em>
          </button>
          <button
            type="button"
            class="knowledge-status-card paper-card"
            onClick={() => navigate('model')}
          >
            <span>Локальная модель</span>
            <strong>{modelStatus(model())}</strong>
            <p>Используется только после локального поиска по установленным источникам.</p>
            <em>Настроить модель →</em>
          </button>
        </div>
      </Show>

      <Show when={route() === 'documents'}>
        <div class="knowledge-subroute-heading">
          <button
            type="button"
            class="knowledge-back-button"
            aria-label="Назад"
            onClick={navigateBack}
          >
            ←
          </button>
          <div>
            <p class="archive-kicker">Установленные и доступные источники</p>
            <h1>Документы</h1>
          </div>
        </div>
        <ModuleCatalogView
          core={props.core}
          status={props.status}
          active={props.active && route() === 'documents'}
          embedded
          {...(props.onContentChanged ? { onContentChanged: props.onContentChanged } : {})}
          {...(props.onAvailableUpdates ? { onAvailableUpdates: props.onAvailableUpdates } : {})}
        />
      </Show>

      <Show when={route() === 'model'}>
        <div class="knowledge-subroute-heading">
          <button
            type="button"
            class="knowledge-back-button"
            aria-label="Назад"
            onClick={() => navigate('overview')}
          >
            ←
          </button>
          <div>
            <p class="archive-kicker">Необязательное локальное дополнение</p>
            <h1>Модель</h1>
          </div>
        </div>
        <ModelSettings controller={props.controller} />
        <details class="system-technical-panel">
          <summary>Техническая информация о приложении</summary>
          <StatusPanel core={props.core} initialStatus={props.status} />
        </details>
      </Show>
    </section>
  );
}
