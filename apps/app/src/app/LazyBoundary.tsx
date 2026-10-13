import { ErrorBoundary, type JSX } from 'solid-js';

import { Button } from '@/components/Button';
import { reloadFromNetwork } from '@/state/chunk-recovery';

import './lazy-boundary.css';

/**
 * Failure of a lazily loaded screen, shown where the screen would be. Without it the Suspense
 * spinner stays on forever. Online, the page has usually just been replaced by chunk recovery;
 * «Повторить» is the manual way out (it also drops the cached shell).
 */
function LazyLoadFailed(props: { readonly error: unknown }): JSX.Element {
  console.error('Экран не загрузился.', props.error);
  const offline = !navigator.onLine;
  return (
    <div
      class="lazy-load-failed page-surface page-grain"
      role="alert"
      data-testid="lazy-load-error"
    >
      <p class="lazy-load-failed__title">Экран не загрузился</p>
      <p class="lazy-load-failed__detail">
        {offline ? 'Нет сети. Повторите, когда подключитесь.' : 'Страница будет перезагружена.'}
      </p>
      <Button
        class="lazy-load-failed__action"
        variant="secondary"
        onClick={() => {
          void reloadFromNetwork();
        }}
      >
        Повторить
      </Button>
    </div>
  );
}

export function LazyBoundary(props: { readonly children: JSX.Element }): JSX.Element {
  return (
    <ErrorBoundary fallback={(error) => <LazyLoadFailed error={error} />}>
      {props.children}
    </ErrorBoundary>
  );
}
