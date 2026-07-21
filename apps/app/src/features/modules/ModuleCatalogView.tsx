import type { ContentModuleCatalogEntry, CoreStatus } from '@localmed/contracts';
import { For, type JSX } from 'solid-js';

import { MODULE_CATALOG } from './module-catalog';

interface ModuleCatalogViewProps {
  readonly status: CoreStatus;
}

const COLLECTION_TITLES: Readonly<Record<string, string>> = {
  core: 'Обязательное ядро',
  pediatrics: 'Клиническая педиатрия',
  shared: 'Общие медицинские данные',
};

const RELEASE_LABELS: Readonly<Record<ContentModuleCatalogEntry['releaseState'], string>> = {
  bundled: 'Встроено',
  published: 'Можно загрузить',
  preview: 'Пилотные данные',
  planned: 'Запланировано',
};

function formatBytes(value: number | null): string {
  if (value === null) return 'размер появится при публикации';
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} КБ`;
  return `${(value / 1024 / 1024).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} МБ`;
}

function moduleDetail(module: ContentModuleCatalogEntry): string {
  if (module.releaseState === 'bundled') return 'Обязательный минимальный каталог';
  if (module.previewDocumentCount > 0) {
    return `${module.previewDocumentCount} док. сейчас входят в общий pilot-pack`;
  }
  return 'Отдельный пакет ещё не опубликован';
}

function capabilityLabels(module: ContentModuleCatalogEntry): readonly string[] {
  const labels: string[] = [];
  if (module.capabilities.fullText) labels.push('полный текст');
  if (module.capabilities.structuredTables) labels.push('таблицы');
  if (module.capabilities.originalPdf) labels.push('PDF отдельно');
  if (module.capabilities.structuredKnowledge) labels.push('связи');
  if (module.capabilities.calculations) labels.push('расчёты');
  return labels;
}

export function ModuleCatalogView(props: ModuleCatalogViewProps): JSX.Element {
  const collections = [...new Set(MODULE_CATALOG.modules.map((module) => module.collection))];

  return (
    <section class="module-page page-surface">
      <header class="subpage-heading module-heading">
        <div>
          <p class="archive-kicker">CONTENT PACKS / OFFLINE</p>
          <h1>Модули знаний</h1>
          <p>
            Ядро остаётся маленьким и знает, какие темы и связи существуют. Полные документы,
            таблицы и оригинальные PDF будут загружаться отдельными проверяемыми пакетами.
          </p>
        </div>
        <div class="module-catalog-version">
          <span>КАТАЛОГ</span>
          <strong>{MODULE_CATALOG.catalogVersion}</strong>
        </div>
      </header>

      <div class="module-transition-note paper-sheet">
        <div>
          <strong>Текущее состояние 0.3.1</strong>
          <p>
            Сейчас приложение использует один общий pack: {props.status.contentPackIds.join(', ')}.
            Эта страница фиксирует целевое разбиение; кнопки загрузки появятся после атомарной
            установки, проверки checksum и rollback.
          </p>
        </div>
        <span>{props.status.documentCount} документов</span>
      </div>

      <For each={collections}>
        {(collection) => (
          <section class="module-collection">
            <div class="module-collection-heading">
              <h2>{COLLECTION_TITLES[collection] ?? collection}</h2>
              <span>
                {MODULE_CATALOG.modules.filter((module) => module.collection === collection).length}
              </span>
            </div>
            <div class="module-grid">
              <For
                each={MODULE_CATALOG.modules.filter((module) => module.collection === collection)}
              >
                {(module) => (
                  <article class="module-card paper-card">
                    <div class="module-card-topline">
                      <span class={`module-state state-${module.releaseState}`}>
                        {RELEASE_LABELS[module.releaseState]}
                      </span>
                      <code>{module.id}</code>
                    </div>
                    <h3>{module.title}</h3>
                    <p>{module.description}</p>
                    <div class="module-facts">
                      <span>{moduleDetail(module)}</span>
                      <span>Индекс: {formatBytes(module.sizes.downloadBytes)}</span>
                      <span>Оригиналы: {formatBytes(module.sizes.sourceAssetsDownloadBytes)}</span>
                    </div>
                    <div class="module-capabilities">
                      <For each={capabilityLabels(module)}>{(label) => <span>{label}</span>}</For>
                    </div>
                    <button type="button" disabled>
                      {module.releaseState === 'bundled'
                        ? 'Обязательный модуль'
                        : 'Установка следующим этапом'}
                    </button>
                  </article>
                )}
              </For>
            </div>
          </section>
        )}
      </For>

      <section class="module-download-plan paper-sheet">
        <h2>Как будет происходить установка</h2>
        <ol>
          <li>скачивание в staging без остановки поиска;</li>
          <li>проверка версии приложения, schema, SHA-256 и SQLite integrity;</li>
          <li>атомарное переключение активной версии с сохранением предыдущей;</li>
          <li>фоновые уведомления Android/iOS и возможность отката.</li>
        </ol>
      </section>
    </section>
  );
}
