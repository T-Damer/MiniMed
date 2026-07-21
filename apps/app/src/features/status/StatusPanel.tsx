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
          0.3.1
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
              <article class="metric-card paper-card">
                <span>ПЛАТФОРМА</span>
                <strong>{value().platform.toUpperCase()}</strong>
                <small>Capacitor shell</small>
              </article>
              <article class="metric-card paper-card">
                <span>РАЗБОР ЗАПРОСА</span>
                <strong>{value().queryAnalysis ? 'READY' : 'OFF'}</strong>
                <small>deterministic, local</small>
              </article>
              <article class="metric-card paper-card muted">
                <span>SEMANTIC</span>
                <strong>{value().semanticSearch ? 'READY' : 'NEXT'}</strong>
                <small>{value().embeddingProfileIds.join(', ') || 'lexical fallback only'}</small>
              </article>
            </>
          )}
        </Show>
      </div>

      <div class="scope-card paper-sheet">
        <div class="scope-stamp">ПРОВЕРЕНО</div>
        <h2>Что уже делает ядро</h2>
        <ol>
          <li>
            <span>01</span>загружает готовый SQLite content pack без сервера;
          </li>
          <li>
            <span>02</span>разбирает возраст, пол, длительность, температуру и измерения;
          </li>
          <li>
            <span>03</span>учитывает отрицания и не продвигает их как положительные симптомы;
          </li>
          <li>
            <span>04</span>строит несколько веток длинного запроса и объединяет выдачу;
          </li>
          <li>
            <span>05</span>объединяет точный FTS5-поиск и локальные векторные кандидаты;
          </li>
          <li>
            <span>06</span>возвращает точный anchor, раздел и соседний исходный контекст.
          </li>
        </ol>
      </div>
    </section>
  );
}
