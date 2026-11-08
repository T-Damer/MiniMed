import { For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Disclosure } from '@/components/Disclosure';
import { type HelpSource, helpSourceRow } from '@/components/help-sources';
import { openDocumentOverlay } from '@/state/document-navigation';

import '@/components/HelpSources.css';

export type { HelpSource } from '@/components/help-sources';

function SourceRowBody(props: { readonly source: HelpSource }): JSX.Element {
  const row = (): ReturnType<typeof helpSourceRow> => helpSourceRow(props.source);
  return (
    <>
      <span class="help-sources__text">
        <span class="help-sources__name">
          <Show when={row().kind}>
            {(kind) => <span class="help-sources__kind">{kind()}</span>}
          </Show>
          {row().name}
        </span>
        <Show when={row().meta || row().site}>
          <span class="help-sources__meta">
            {[row().meta, row().site].filter(Boolean).join(' · ')}
          </span>
        </Show>
      </span>
      <Show when={props.source.document || props.source.url}>
        <AppGlyph
          name={props.source.document ? 'book-open' : 'arrow-square-up-right'}
          class="help-sources__icon"
        />
      </Show>
    </>
  );
}

/**
 * The sources behind a tool, folded under «Источники» at the end of its «?» help (owner
 * 2026-11-08). A source the app has opens in the reader; any other opens on its site, shown by name.
 * `Page` renders it from `helpSources`, so every tool's «?» lists sources the same way.
 */
export function HelpSources(props: {
  readonly sources: readonly HelpSource[];
  readonly defaultOpen?: boolean;
}): JSX.Element {
  return (
    <Show when={props.sources.length > 0}>
      <Disclosure
        variant="inline"
        class="help-sources"
        title="Источники"
        meta={<span class="help-sources__count">{props.sources.length}</span>}
        defaultOpen={props.defaultOpen ?? false}
      >
        <ul class="help-sources__list">
          <For each={props.sources}>
            {(source) => (
              <li class="help-sources__item">
                <Show
                  when={source.document}
                  fallback={
                    <Show
                      when={source.url}
                      fallback={
                        <div class="help-sources__row help-sources__row--static">
                          <SourceRowBody source={source} />
                        </div>
                      }
                    >
                      {(url) => (
                        <a
                          class="help-sources__row"
                          href={url()}
                          target="_blank"
                          rel="noreferrer"
                          title={source.title}
                        >
                          <SourceRowBody source={source} />
                        </a>
                      )}
                    </Show>
                  }
                >
                  {(target) => (
                    <button
                      type="button"
                      class="help-sources__row"
                      title={source.title}
                      data-testid="help-source-document"
                      onClick={() =>
                        openDocumentOverlay(target().documentId, target().anchor ?? null)
                      }
                    >
                      <SourceRowBody source={source} />
                    </button>
                  )}
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Disclosure>
    </Show>
  );
}
