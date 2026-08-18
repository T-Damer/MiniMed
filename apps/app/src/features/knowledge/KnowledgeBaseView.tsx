import type { CoreStatus, MedicalCore } from '@localmed/contracts';
import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

import {
  knowledgeDocumentBackHash,
  shouldResetKnowledgeCatalogScroll,
} from '@/features/knowledge/knowledge-routing';
import { UserLibraryPage } from '@/features/library/UserLibraryPage';
import {
  isUserLibraryCatalogRoute,
  migrateLegacyUserDocumentHash,
} from '@/features/library/user-library-routing';
import { MedicationCatalogView } from '@/features/medications/MedicationCatalogView';
import { isMedicationCatalogRoute } from '@/features/medications/medication-routing';
import { ModuleCatalogView } from '@/features/modules/ModuleCatalogView';

type KnowledgeRoute = 'documents' | 'medications';

interface KnowledgeBaseViewProps {
  readonly core: MedicalCore;
  readonly status: CoreStatus;
  readonly active: boolean;
  readonly onContentChanged?: () => Promise<void>;
  readonly onAvailableUpdates?: (count: number) => void;
}

function routeFromLocation(): KnowledgeRoute {
  if (isMedicationCatalogRoute(window.location.hash)) {
    return 'medications';
  }
  return 'documents';
}

function documentsRouteFromLocation(): string {
  return window.location.hash.replace(/^#\/?/u, '');
}

export function KnowledgeBaseView(props: KnowledgeBaseViewProps): JSX.Element {
  const [route, setRoute] = createSignal<KnowledgeRoute>(routeFromLocation());
  const [documentsRoute, setDocumentsRoute] = createSignal(documentsRouteFromLocation());

  const canonicalizeDocumentsHash = (): void => {
    const currentRoute = window.location.hash.replace(/^#\/?/u, '');
    if (currentRoute !== 'modules') return;
    window.history.replaceState({ view: 'modules', route: 'documents' }, '', '#/modules/documents');
  };

  const navigateBack = (): void => {
    const currentRoute = window.location.hash.replace(/^#\/?/u, '');
    const backHash = knowledgeDocumentBackHash(currentRoute);
    if (backHash) window.location.hash = backHash;
  };

  const handleHashChange = (): void => {
    migrateLegacyUserDocumentHash();
    canonicalizeDocumentsHash();
    const nextHash = window.location.hash;
    if (!shouldResetKnowledgeCatalogScroll(nextHash)) return;
    setRoute(routeFromLocation());
    setDocumentsRoute(documentsRouteFromLocation());
    if (!document.documentElement.classList.contains('using-root-view-transition')) {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  };

  onMount(() => {
    migrateLegacyUserDocumentHash();
    canonicalizeDocumentsHash();
    window.addEventListener('hashchange', handleHashChange);
  });

  onCleanup(() => {
    window.removeEventListener('hashchange', handleHashChange);
  });

  return (
    <section class="knowledge-base-page page-surface page-grain">
      <Show when={route() === 'documents'}>
        <Show when={isUserLibraryCatalogRoute(documentsRoute())}>
          <UserLibraryPage />
        </Show>
        <Show when={!isUserLibraryCatalogRoute(documentsRoute())}>
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
      </Show>

      <Show when={route() === 'medications'}>
        <MedicationCatalogView core={props.core} onBack={navigateBack} />
      </Show>
    </section>
  );
}
