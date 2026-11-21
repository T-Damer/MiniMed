import type { ContentModuleCatalogEntry } from '@localmed/contracts';
import type { DocumentTitleRow, MedicalStore } from '@localmed/storage';
import { createEffect, createSignal, For, type JSX, onCleanup, Show, untrack } from 'solid-js';
import { WindowVirtualizer } from 'virtua/solid';
import { AppGlyph } from '@/components/AppGlyph';
import { SkeletonLines } from '@/components/PageSkeleton';
import { ICD11_SOURCE_TYPE, icd11ChapterDocuments } from '@/features/icd11/icd11-document';
import { loadInstalledModuleMount } from '@/features/modules/browser-module-runtime';
import { pluralRu } from '@/i18n/labels';
import { openDocumentOverlay } from '@/state/document-navigation';
import '@/features/icd11/icd11-catalog.css';

const PAGE_SIZE = 40;
const RESIDENT_PAGES = 3;
const ROW_HEIGHT = 56;

function CatalogRow(props: { readonly row: DocumentTitleRow }): JSX.Element {
  return (
    <button
      type="button"
      class="icd11-catalog__row"
      data-document-id={props.row.id}
      onClick={() => openDocumentOverlay(props.row.id, null, { title: props.row.title })}
    >
      <span class="icd11-catalog__title">{props.row.title}</span>
      <AppGlyph name="caret-right" class="icd11-catalog__arrow" />
    </button>
  );
}

export function Icd11Catalog(props: { readonly module: ContentModuleCatalogEntry }): JSX.Element {
  const [pages, setPages] = createSignal<ReadonlyMap<number, readonly DocumentTitleRow[]>>(
    new Map(),
  );
  const [chapters, setChapters] = createSignal<readonly DocumentTitleRow[]>();
  const [chaptersOpen, setChaptersOpen] = createSignal(false);
  const [error, setError] = createSignal(false);
  const [chapterError, setChapterError] = createSignal(false);
  const count = props.module.previewDocumentCount;
  const indices = Array.from({ length: count }, (_, index) => index);
  let disposed = false;
  let lease: Promise<MedicalStore | undefined> | undefined;
  let draining = false;
  const pending = new Set<number>();

  const readStore = (): Promise<MedicalStore | undefined> => {
    lease ??= loadInstalledModuleMount(props.module).then(async (mount) => {
      if (!mount) return undefined;
      try {
        await mount.store.initialize();
        return mount.store;
      } catch (cause) {
        await mount.store.close();
        throw cause;
      }
    });
    return lease;
  };

  onCleanup(() => {
    disposed = true;
    pending.clear();
    void lease
      ?.then((store) => store?.close())
      .catch((cause: unknown) => {
        console.warn('Unable to release the ICD-11 catalog lease.', cause);
      });
  });

  async function drainPages(): Promise<void> {
    if (disposed || draining || error()) return;
    draining = true;
    let reading: number | undefined;
    try {
      const store = await readStore();
      if (!store?.listDocumentTitles) throw new Error('ICD-11 catalog store is unavailable.');
      while (!disposed && pending.size > 0) {
        const page = [...pending].at(-1);
        if (page === undefined) break;
        pending.delete(page);
        if (pages().has(page)) continue;
        reading = page;
        const rows = await store.listDocumentTitles({ offset: page * PAGE_SIZE, limit: PAGE_SIZE });
        if (disposed) return;
        reading = undefined;
        setPages((current) => {
          const next = new Map(current).set(page, rows);
          if (next.size > RESIDENT_PAGES) {
            const farthest = [...next.keys()].reduce((a, b) =>
              Math.abs(a - page) >= Math.abs(b - page) ? a : b,
            );
            next.delete(farthest);
          }
          return next;
        });
      }
    } catch (cause) {
      if (!disposed) {
        if (reading !== undefined) pending.add(reading);
        console.warn('Unable to read an ICD-11 catalog page.', cause);
        setError(true);
      }
    } finally {
      draining = false;
    }
  }

  const requestPage = (index: number): void => {
    const page = Math.floor(index / PAGE_SIZE);
    if (pages().has(page) || pending.has(page)) return;
    for (const queued of pending) if (Math.abs(queued - page) > 1) pending.delete(queued);
    pending.add(page);
    void drainPages();
  };

  const retry = (): void => {
    // A failed open must start a fresh lease. A page error can reuse the open store.
    void lease
      ?.then(
        (store) => {
          if (!store) lease = undefined;
        },
        () => {
          lease = undefined;
        },
      )
      .then(() => {
        if (disposed) return;
        setError(false);
        void drainPages();
      });
  };

  async function openChapters(): Promise<void> {
    setChaptersOpen(!chaptersOpen());
    if (!chaptersOpen() || chapters()) return;
    setChapterError(false);
    try {
      const store = await readStore();
      if (!store?.listDocumentTitles) throw new Error('ICD-11 catalog store is unavailable.');
      const rows = await store.listDocumentTitles({ titlePrefix: 'Глава ', offset: 0, limit: 40 });
      if (!disposed)
        setChapters(
          icd11ChapterDocuments(rows.map((row) => ({ ...row, sourceType: ICD11_SOURCE_TYPE }))),
        );
    } catch (cause) {
      if (!disposed) {
        console.warn('Unable to read the ICD-11 chapters.', cause);
        setChapterError(true);
      }
    }
  }

  return (
    <section class="icd11-catalog" aria-label="Записи МКБ-11">
      <div class="icd11-catalog__summary">
        <span class="icd11-catalog__count">
          {count.toLocaleString('ru-RU')} {pluralRu(count, 'запись', 'записи', 'записей')}
        </span>
        <button
          class="icd11-catalog__chapters"
          type="button"
          aria-expanded={chaptersOpen()}
          onClick={() => void openChapters()}
        >
          Главы
          <AppGlyph
            name={chaptersOpen() ? 'caret-up' : 'caret-down'}
            class="icd11-catalog__arrow"
          />
        </button>
      </div>
      <Show when={chaptersOpen()}>
        <div class="icd11-catalog__chapter-list">
          <Show
            when={chapters()}
            fallback={
              chapterError() ? (
                <p role="alert">Не удалось открыть главы.</p>
              ) : (
                <SkeletonLines label="Открываем главы" lines={2} />
              )
            }
          >
            {(items) => <For each={items()}>{(row) => <CatalogRow row={row} />}</For>}
          </Show>
        </div>
      </Show>
      <Show when={error()}>
        <div class="error-card" role="alert">
          Не удалось открыть записи МКБ-11.
          <button type="button" class="icd11-catalog__retry" onClick={retry}>
            Повторить
          </button>
        </div>
      </Show>
      <WindowVirtualizer data={indices} itemSize={ROW_HEIGHT} bufferSize={480}>
        {(index) => {
          createEffect(() => untrack(() => requestPage(index)));
          const row = () => pages().get(Math.floor(index / PAGE_SIZE))?.[index % PAGE_SIZE];
          return (
            <div class="icd11-catalog__slot">
              <Show
                when={row()}
                fallback={<span class="icd11-catalog__placeholder" aria-hidden="true" />}
              >
                {(value) => <CatalogRow row={value()} />}
              </Show>
            </div>
          );
        }}
      </WindowVirtualizer>
    </section>
  );
}
