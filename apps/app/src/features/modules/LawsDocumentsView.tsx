import type { ContentModuleCatalogEntry, ContentModuleDownloadTask } from '@localmed/contracts';
import { createMemo, createSignal, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { LayoutVirtualizedGrid } from '@/components/LayoutVirtualizedGrid';
import { NavBack } from '@/components/NavBack';
import { SearchField } from '@/components/SearchField';
import { useStickySurface } from '@/components/sticky-surface';
import {
  matchesCatalogQuery,
  openCatalogDocument,
} from '@/features/modules/laws-documents-helpers';
import { contentModuleTaskProgress } from '@/features/modules/module-display';
import { openDocumentOverlay } from '@/state/document-navigation';

interface LawsDocumentsViewProps {
  readonly module: ContentModuleCatalogEntry;
  readonly installed: boolean;
  readonly downloadAvailable: boolean;
  readonly task: ContentModuleDownloadTask | undefined;
  readonly installError: string | undefined;
  readonly documentTitle: (document: ContentModuleCatalogEntry['documents'][number]) => string;
  readonly documentDate: (documentVersionId: string) => string;
  readonly onInstall: () => Promise<boolean>;
  readonly onRemove: () => void;
  readonly onBack: () => void;
}

export function LawsDocumentsView(props: LawsDocumentsViewProps): JSX.Element {
  const [query, setQuery] = createSignal('');
  const [requestedDocumentId, setRequestedDocumentId] = createSignal<string | null>(null);
  const [installRequested, setInstallRequested] = createSignal(false);
  let headingElement: HTMLElement | undefined;

  useStickySurface(() => headingElement);

  const downloading = createMemo(() =>
    Boolean(
      props.task && ['queued', 'downloading', 'verifying', 'installing'].includes(props.task.state),
    ),
  );
  const working = createMemo(() => downloading() || installRequested());
  const progress = createMemo(() => (props.task ? contentModuleTaskProgress(props.task) : null));
  const documents = createMemo(() => {
    const trimmed = query().trim();
    if (!trimmed) return props.module.documents;
    return props.module.documents.filter((document) =>
      matchesCatalogQuery(trimmed, [
        props.documentTitle(document),
        document.documentId,
        document.status,
      ]),
    );
  });
  const installCollection = async (): Promise<void> => {
    if (working()) return;
    setInstallRequested(true);
    try {
      await props.onInstall();
    } finally {
      setInstallRequested(false);
    }
  };
  const openDocument = async (documentId: string): Promise<void> => {
    if (working()) return;
    setRequestedDocumentId(documentId);
    setInstallRequested(true);
    try {
      await openCatalogDocument({
        installed: props.installed,
        install: props.onInstall,
        open: () => openDocumentOverlay(documentId),
      });
    } finally {
      setInstallRequested(false);
      setRequestedDocumentId(null);
    }
  };

  return (
    <section class="laws-documents-page module-documents-page" aria-label={props.module.title}>
      <header
        ref={headingElement}
        class="laws-documents-page__header knowledge-subroute-heading knowledge-subroute-heading--blurred route-sticky-chrome"
      >
        <NavBack
          class="laws-documents-page__back knowledge-back-button knowledge-subroute-heading__control"
          aria-label="Назад к наборам документов"
          onClick={props.onBack}
          icon={<AppGlyph name="arrow-left" class="laws-documents-page__back-icon" />}
        />
        <SearchField
          class="laws-documents-page__search route-search knowledge-subroute-heading__control"
          id="laws-documents-search"
          label="Поиск по документам"
          hideLabel
          value={query()}
          onInput={setQuery}
          placeholder="Название или номер документа"
        />
        <Show when={!props.installed && props.downloadAvailable}>
          <button
            type="button"
            class="module-download-all laws-documents-page__download"
            aria-label={working() ? 'Скачиваем документы' : 'Скачать все документы'}
            disabled={working()}
            onClick={() => void installCollection()}
          >
            <Show when={!working()} fallback={<span class="module-action-spinner" />}>
              <AppGlyph name="download" class="module-download-all__icon" />
            </Show>
            <span class="laws-documents-page__download-label">
              {working() && progress() !== null
                ? `Скачиваем ${Math.round((progress() ?? 0) * 100)}%`
                : 'Скачать всё'}
            </span>
          </button>
        </Show>
        <Show when={props.installed}>
          <Button
            type="button"
            variant="primary"
            class="recommendation-delete-button laws-documents-page__remove"
            aria-label={`Удалить «${props.module.title}»`}
            title="Удалить"
            onClick={props.onRemove}
            icon={<AppGlyph name="trash" class="recommendation-delete-button__icon" />}
          />
        </Show>
      </header>
      <div class="laws-documents-page__body">
        <Show when={props.installError}>
          {(message) => (
            <p class="laws-documents-page__error" role="alert">
              {message()}
            </p>
          )}
        </Show>
        <Show
          when={documents().length > 0}
          fallback={<p class="laws-documents-page__empty">Документы не найдены.</p>}
        >
          <div class="laws-documents-page__list">
            <LayoutVirtualizedGrid data={documents()} maxColumns={2} minTwoColumnWidth={320}>
              {(document) => {
                const canActivate = () => props.installed || props.downloadAvailable;
                const documentWorking = () =>
                  working() && requestedDocumentId() === document.documentId;
                const status =
                  document.status === 'active'
                    ? 'действующая редакция'
                    : document.status === 'historical'
                      ? 'историческая редакция'
                      : 'предыдущая редакция';
                return (
                  <button
                    type="button"
                    class="medication-product-card paper-card module-document-card"
                    classList={{ 'module-document-card--disabled': !canActivate() }}
                    aria-label={`${props.installed ? 'Открыть' : 'Скачать'} «${props.documentTitle(document)}»`}
                    disabled={!canActivate() || (working() && !documentWorking())}
                    onClick={() => void openDocument(document.documentId)}
                  >
                    <Show
                      when={!documentWorking()}
                      fallback={
                        <span class="module-action-spinner module-document-card__action-spinner" />
                      }
                    >
                      <AppGlyph
                        name={props.installed ? 'arrow-up-right' : 'download'}
                        class="medication-product-card__open-icon module-document-card__action-icon"
                      />
                    </Show>
                    <strong class="medication-product-card__title module-document-card__title">
                      {props.documentTitle(document)}
                    </strong>
                    <p class="medication-product-card-meta module-document-card__meta">
                      {props.documentDate(document.documentVersionId)}
                    </p>
                    <span class="module-document-card__status">{status}</span>
                  </button>
                );
              }}
            </LayoutVirtualizedGrid>
          </div>
        </Show>
      </div>
    </section>
  );
}
