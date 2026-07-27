import type { CoreStatus, MedicalCore } from '@localmed/contracts';
import type { JSX } from 'solid-js';

interface StatusPanelProps {
  readonly core: MedicalCore;
  readonly initialStatus: CoreStatus;
}

export function StatusPanel(props: StatusPanelProps): JSX.Element {
  void props.core;

  return (
    <section class="status-page archive-status-page">
      <div class="folder-tab">СИСТЕМА / ПРОТОКОЛ</div>
      <header class="status-heading">
        <div>
          <p class="archive-kicker">Диагностика сборки</p>
          <h1>Состояние ядра</h1>
          <p>Документы, доступные локальному поиску на этом устройстве.</p>
        </div>
        <span class="offline-stamp">
          CORE
          <br />
          0.6.1
        </span>
      </header>

      <div class="status-grid">
        <article class="metric-card paper-card">
          <span>ДОКУМЕНТЫ</span>
          <strong>{props.initialStatus.documentCount.toString().padStart(3, '0')}</strong>
          <small>доступно без сети</small>
        </article>
      </div>
    </section>
  );
}
