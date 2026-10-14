import type { JSX } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { NavBack } from '@/components/NavBack';

import './document-not-found.css';

/**
 * What a document address that cannot be read (a damaged or hand-typed link) shows: the way back
 * and one line, instead of an empty screen.
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
        <h1 class="document-not-found__title">Документ не найден</h1>
      </header>
      <p class="document-not-found__text" role="alert">
        Ссылка повреждена или документа нет на этом устройстве.
      </p>
      <Button
        type="button"
        variant="primary"
        class="document-not-found__search"
        onClick={props.onSearch}
        icon={<AppGlyph name="search" />}
      >
        Искать в базе
      </Button>
    </section>
  );
}
