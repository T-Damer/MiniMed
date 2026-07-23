import type { MedicalDocument } from '@localmed/contracts';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';

import { OverlayDialog } from '../../components/OverlayDialog';

interface DocumentReaderDialogProps {
  readonly document: MedicalDocument | undefined;
  readonly initialAnchor?: string | null;
  readonly onClose: () => void;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').trim();
}

function statusLabel(status: string): string {
  if (status === 'active' || status === 'current') return 'Действующая редакция';
  if (status === 'superseded') return 'Заменённая редакция';
  if (status === 'historical') return 'Исторический документ';
  return status;
}

export function DocumentReaderDialog(props: DocumentReaderDialogProps): JSX.Element {
  const [query, setQuery] = createSignal('');

  const matchingSections = createMemo(() => {
    const document = props.document;
    if (!document) return [];
    const value = normalize(query());
    if (!value) return document.sections;
    return document.sections.filter((section) =>
      normalize(
        [
          section.title,
          section.sectionPath.join(' '),
          ...section.chunks.map((chunk) => chunk.originalText),
        ].join(' '),
      ).includes(value),
    );
  });

  const scrollTo = (anchor: string): void => {
    requestAnimationFrame(() => {
      document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const close = (): void => {
    setQuery('');
    props.onClose();
  };

  return (
    <OverlayDialog
      open={Boolean(props.document)}
      title={props.document?.shortTitle ?? props.document?.title ?? 'Документ'}
      subtitle="Полный текст открывается поверх текущего рабочего экрана"
      class="document-overlay"
      onClose={close}
    >
      <Show when={props.document}>
        {(documentValue) => (
          <div class="document-overlay-layout">
            <aside class="document-overlay-outline">
              <label class="document-overlay-search">
                <span>Поиск в документе</span>
                <input
                  value={query()}
                  onInput={(event) => setQuery(event.currentTarget.value)}
                  placeholder="Слово или фраза"
                  autocomplete="off"
                />
              </label>

              <details open>
                <summary>Оглавление</summary>
                <nav aria-label="Разделы документа">
                  <For each={matchingSections()}>
                    {(section, index) => (
                      <button type="button" onClick={() => scrollTo(section.anchor)}>
                        <span>{String(index() + 1).padStart(2, '0')}</span>
                        {section.title}
                      </button>
                    )}
                  </For>
                </nav>
              </details>

              <details class="doctor-technical-details">
                <summary>Сведения об источнике</summary>
                <dl>
                  <div>
                    <dt>Редакция</dt>
                    <dd>{documentValue().versionLabel}</dd>
                  </div>
                  <div>
                    <dt>Статус</dt>
                    <dd>{statusLabel(documentValue().status)}</dd>
                  </div>
                  <div>
                    <dt>Тип</dt>
                    <dd>{documentValue().sourceType.replaceAll('_', ' ')}</dd>
                  </div>
                </dl>
              </details>
            </aside>

            <article class="document-overlay-paper">
              <header>
                <p>{documentValue().sourceType.replaceAll('_', ' ')}</p>
                <h1>{documentValue().title}</h1>
              </header>

              <For each={matchingSections()}>
                {(section) => (
                  <section class="document-overlay-section" id={section.anchor}>
                    <p class="document-overlay-path">{section.sectionPath.join(' / ')}</p>
                    <h2>{section.title}</h2>
                    <For each={section.chunks}>
                      {(chunk) => (
                        <p
                          id={chunk.anchor}
                          classList={{
                            'document-initial-anchor': props.initialAnchor === chunk.anchor,
                          }}
                        >
                          {chunk.originalText}
                        </p>
                      )}
                    </For>
                  </section>
                )}
              </For>

              <Show when={matchingSections().length === 0}>
                <div class="document-overlay-empty">
                  <h2>Совпадений нет</h2>
                  <p>Очистите поиск внутри документа или попробуйте другую формулировку.</p>
                </div>
              </Show>
            </article>
          </div>
        )}
      </Show>
    </OverlayDialog>
  );
}
