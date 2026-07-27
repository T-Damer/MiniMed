import type { CoreStatus } from '@localmed/contracts';
import type { JSX } from 'solid-js';

interface StatusPanelProps {
  readonly initialStatus: CoreStatus;
}

export function StatusPanel(props: StatusPanelProps): JSX.Element {
  return (
    <section class="core-status-card">
      <header>
        <div>
          <p class="archive-kicker">Диагностика сборки</p>
          <h2>Состояние ядра</h2>
          <p>Документы, доступные локальному поиску на этом устройстве.</p>
        </div>
        <span class="core-status-version">Core 0.6.3</span>
      </header>

      <div class="core-status-count">
        <strong>{props.initialStatus.documentCount}</strong>
        <span>
          Документов
          <small>доступно без сети</small>
        </span>
      </div>
    </section>
  );
}
