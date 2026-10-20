import { type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { NavBack } from '@/components/NavBack';

import './document-not-found.css';

/**
 * What a document address that cannot be read (a damaged or hand-typed link) shows: the way back in
 * the header row, and in the middle of the screen a mark, one line and a search button — a calm
 * «404» instead of a page that looks broken (owner 2026-10-20).
 */
export function DocumentNotFound(props: {
  readonly onBack: () => void;
  readonly onSearch: () => void;
}): JSX.Element {
  return (
    <section class="document-not-found page-surface page-grain" aria-label="Документ не найден">
      <header class="document-not-found__bar">
        <NavBack
          class="document-page__back"
          aria-label="Назад"
          onClick={props.onBack}
          icon={<AppGlyph name="arrow-left" class="document-page__back-icon" />}
        />
      </header>
      <NotFoundState
        title="Документ не найден"
        text="Ссылка повреждена или документа нет на этом устройстве."
        onSearch={props.onSearch}
      />
    </section>
  );
}

/**
 * The centred part of a «not found» screen: a document mark with «?», the title, one line and,
 * when given, «Искать в базе». Shared by a damaged address and by a reader whose document is gone.
 */
export function NotFoundState(props: {
  readonly title: string;
  readonly text?: string | undefined;
  readonly onSearch?: (() => void) | undefined;
  readonly class?: string;
}): JSX.Element {
  return (
    <div class={`document-not-found__body ${props.class ?? ''}`.trim()} role="alert">
      <span class="document-not-found__mark" aria-hidden="true">
        <AppGlyph name="file-text" class="document-not-found__glyph" />
        <span class="document-not-found__badge">?</span>
      </span>
      <h1 class="document-not-found__title">{props.title}</h1>
      <Show when={props.text}>{(text) => <p class="document-not-found__text">{text()}</p>}</Show>
      <Show when={props.onSearch}>
        {(search) => (
          <Button
            type="button"
            variant="primary"
            class="document-not-found__search"
            onClick={() => search()()}
            icon={<AppGlyph name="search" />}
          >
            Искать в базе
          </Button>
        )}
      </Show>
    </div>
  );
}
