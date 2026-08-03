import { createEffect, createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { AssessmentsView } from '@/features/assessments/AssessmentsView';

function routeIsAssessment(): boolean {
  return window.location.hash.replace(/^#\/?/u, '').startsWith('assessments');
}

export function AssessmentHost(): JSX.Element {
  const [open, setOpen] = createSignal(routeIsAssessment());

  const refresh = (): void => {
    setOpen(routeIsAssessment());
  };

  onMount(() => window.addEventListener('hashchange', refresh));
  onCleanup(() => window.removeEventListener('hashchange', refresh));

  createEffect(() => {
    document.documentElement.classList.toggle('assessment-route-open', open());
  });
  onCleanup(() => document.documentElement.classList.remove('assessment-route-open'));

  return (
    <Show
      when={open()}
      fallback={
        <button
          class="assessment-launch-button"
          type="button"
          aria-label="Открыть тесты и опросники"
          onClick={() => {
            window.location.hash = '#/assessments';
          }}
        >
          <AppGlyph name="brain" />
          <span>Тесты</span>
        </button>
      }
    >
      <div class="assessment-overlay-shell">
        <button
          class="assessment-overlay-close"
          type="button"
          aria-label="Закрыть тесты"
          onClick={() => {
            window.location.hash = '#/search';
          }}
        >
          <AppGlyph name="close" />
        </button>
        <AssessmentsView />
      </div>
    </Show>
  );
}
