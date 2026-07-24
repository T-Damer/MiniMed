import type { CoreStatus, MedicalCore } from '@localmed/contracts';
import { createSignal, type JSX, Show } from 'solid-js';

import { DocumentLibrary } from '../library/DocumentLibrary';
import { ModuleCatalogView } from '../modules/ModuleCatalogView';

type KnowledgeTab = 'installed' | 'download';

interface KnowledgeBaseViewProps {
  readonly core: MedicalCore;
  readonly status: CoreStatus;
  readonly active: boolean;
  readonly onContentChanged?: () => Promise<void>;
  readonly onAvailableUpdates?: (count: number) => void;
}

export function KnowledgeBaseView(props: KnowledgeBaseViewProps): JSX.Element {
  const [tab, setTab] = createSignal<KnowledgeTab>('installed');

  return (
    <section class="knowledge-base-page page-surface">
      <header class="subpage-heading knowledge-base-heading">
        <div>
          <p class="archive-kicker">Локальная медицинская библиотека</p>
          <h1>База знаний</h1>
          <p>
            Откройте уже установленные документы или скачайте новые наборы. После установки они
            работают без интернета и участвуют в поиске.
          </p>
        </div>
      </header>

      <div class="knowledge-base-tabs" role="tablist" aria-label="Разделы базы знаний">
        <button
          type="button"
          role="tab"
          aria-selected={tab() === 'installed'}
          classList={{ active: tab() === 'installed' }}
          onClick={() => setTab('installed')}
        >
          На устройстве
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab() === 'download'}
          classList={{ active: tab() === 'download' }}
          onClick={() => setTab('download')}
        >
          Скачать наборы
        </button>
      </div>

      <Show when={tab() === 'installed'}>
        <DocumentLibrary core={props.core} embedded />
      </Show>
      <Show when={tab() === 'download'}>
        <ModuleCatalogView
          status={props.status}
          active={props.active && tab() === 'download'}
          embedded
          {...(props.onContentChanged ? { onContentChanged: props.onContentChanged } : {})}
          {...(props.onAvailableUpdates ? { onAvailableUpdates: props.onAvailableUpdates } : {})}
        />
      </Show>
    </section>
  );
}
