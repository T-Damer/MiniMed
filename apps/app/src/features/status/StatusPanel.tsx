import type { CoreCapabilities, CoreStatus, MedicalCore } from '@localmed/contracts';
import { createSignal, type JSX, onMount, Show } from 'solid-js';

interface StatusPanelProps {
  readonly core: MedicalCore;
  readonly initialStatus: CoreStatus;
}

function formatStorageSize(sizeBytes: number | null): string {
  return sizeBytes === null ? 'MEMORY' : `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
}

export function StatusPanel(props: StatusPanelProps): JSX.Element {
  const [capabilities, setCapabilities] = createSignal<CoreCapabilities>();
  const [error, setError] = createSignal<string>();

  onMount(async () => {
    const result = await props.core.getCapabilities();
    if (result.ok) setCapabilities(result.value);
    else setError(result.error.message);
  });

  return (
    <section class="status-page archive-status-page">
      <div class="folder-tab">СИСТЕМА / ПРОТОКОЛ</div>
      <header class="status-heading">
        <div>
          <p class="archive-kicker">Диагностика сборки</p>
          <h1>Состояние ядра</h1>
          <p>
            Этот лист показывает, какой SQLite-адаптер выбран на устройстве и прошёл ли локальный
            FTS5 smoke test.
          </p>
        </div>
        <span class="offline-stamp">
          CORE
          <br />
          0.3.3
        </span>
      </header>

      <Show when={error()}>{(message) => <div class="error-card">{message()}</div>}</Show>

      <div class="status-grid">
        <article class="metric-card paper-card">
          <span>СОСТОЯНИЕ</span>
          <strong>{props.initialStatus.state.toUpperCase()}</strong>
          <small>MedicalCore initialized</small>
        </article>
        <article class="metric-card paper-card">
          <span>ДОКУМЕНТЫ</span>
          <strong>{props.initialStatus.documentCount.toString().padStart(3, '0')}</strong>
          <small>{props.initialStatus.contentPackIds.join(', ')}</small>
        </article>
        <article class="metric-card paper-card">
          <span>SCHEMA</span>
          <strong>V{props.initialStatus.schemaVersion}</strong>
          <small>SQLite contract</small>
        </article>
        <Show when={capabilities()}>
          {(value) => (
            <>
              <article class="metric-card paper-card">
                <span>SQLITE</span>
                <strong>{value().sqliteVersion}</strong>
                <small>FTS5: {value().fts5Available ? 'available' : 'missing'}</small>
              </article>
              <article class="metric-card paper-card">
                <span>ХРАНИЛИЩЕ</span>
                <strong>{value().storageBackend.toUpperCase()}</strong>
                <small>
                  {value().persistentStorage ? 'persistent native file' : 'session memory'} ·{' '}
                  {value().storageInstallation}
                </small>
              </article>
              <article class="metric-card paper-card">
                <span>ПАКЕТ</span>
                <strong>{formatStorageSize(value().storageSizeBytes)}</strong>
                <small>installation: {value().storageInstallation}</small>
              </article>
            </>
          )}
        </Show>
      </div>
    </section>
  );
}
